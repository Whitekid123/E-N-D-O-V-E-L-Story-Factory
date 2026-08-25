import { task } from "@trigger.dev/sdk";
import {
  chat,
  MASTER_RULES,
  seg,
  sanitize,
  polish,
  isRestart,
  stripOverlap,
  isCutOff,
  wordCount,
} from "@/lib/ai";

const STATE_FORMAT = `TIMELINE — where we are in story-world time
CHARACTER STATUS — each recurring character: location, condition, emotional state, current goal
RELATIONSHIP STAGE — exact stage between the leads; last milestone reached
KNOWLEDGE TRACKER — what each character has personally learned so far (facts, secrets, suspicions)
READER-ONLY KNOWLEDGE — things only readers know via premium stories
OPEN THREADS — active mysteries/plot threads, each tagged with the episode it appeared in
LIVE CLIFFHANGER — the hook the latest episode ended on
ESTABLISHED FACTS — hard canon details established so far (names, rooms, objects, dates, rules, injuries, who is where)`;

export const generateEpisode = task({
  id: "generate-episode",
  // Allow longer runs for full episode generation
  maxDuration: 1800,
  run: async (payload: {
    episodeNumber: number;
    totalEpisodes: number;
    model: string;
    bible: string;
    blockSpec: string;
    storyState?: string;
    memories?: string[];
    recentHooks?: string[];
    lastEnding?: string;
    fastMode?: boolean;
  }) => {
    const {
      episodeNumber,
      totalEpisodes,
      model,
      bible,
      blockSpec,
      storyState = "",
      memories = [],
      recentHooks = [],
      lastEnding = "",
      fastMode = true,
    } = payload;

    if (!process.env.CUSTOM_API_KEY) {
      throw new Error("CUSTOM_API_KEY is missing in Trigger.dev Environment Variables");
    }

    const system = `${MASTER_RULES}

STORY BIBLE (canon — never contradict it):
${bible}

LIVING STORY STATE (the novel's accumulated memory — established facts, character knowledge, open threads; never contradict it):
${storyState && String(storyState).trim() ? storyState : "(Not yet initialized — this is Episode 1. The state will be created after this episode.)"}

CURRENT BLOCK SPEC (obey it — do not pull later-block material forward):
${blockSpec}`;

    const memTxt = memories.length
      ? memories.join("\n")
      : "(This is Episode 1 — establish the world and hook the reader within the first 150 words.)";
    const hookTxt = recentHooks.length ? recentHooks.join("; ") : "(none yet)";
    const endingTxt = lastEnding || "(Episode 1 — no previous episode.)";

    const user1 = `Write EPISODE ${episodeNumber} of ${totalEpisodes}.

RECENT CONTINUITY (summaries of recent episodes):
${memTxt}

LAST EPISODE'S FINAL SCENE (the exact text of how it ended — open from these consequences; never re-narrate, repeat, or rewrite it):
${endingTxt}

CLIFFHANGER DEVICES USED RECENTLY (end this episode differently):
${hookTxt}

Requirements:
- One clear objective for this episode inside the block. Multiple purposeful scenes; each changes information, emotion, risk, relationship, or decision.
- Show how events affect the characters. Friction even in quiet scenes. No filler.
- CONTINUITY LAWS: keep every character's name, gender, age, role, and assigned room/location EXACTLY as established in the bible and story state. Never mention an event that was not shown in a previous episode or present in the state. Do not repeat a scene, warning, threat, or confrontation from a previous episode, and do not reuse a previous episode's opening imagery or first line.
- Main body: 2,000-2,500 words. End on a natural, varied cliffhanger woven into the final scene. The final sentence must be complete.

Return EXACTLY this format:
<TITLE>curiosity-producing episode title</TITLE>
<BODY>the full episode</BODY>
<MEMORY>3-5 sentences: what happened, and the emotional/practical state of the leads at the end</MEMORY>
<HOOK_TYPE>short phrase naming the cliffhanger device used (e.g. "phone call", "betrayal clue")</HOOK_TYPE>`;

    // Stage 1: the episode (NON-STREAMING — more reliable with custom gateways)
    let r1: { content: string; finishReason: string };
    try {
      r1 = await chat(model, system, user1, 12288);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Model call failed: ${msg}`);
    }

    if (!r1.content || !r1.content.trim()) {
      throw new Error(
        `Model returned empty content. finishReason=${r1.finishReason || "none"}. ` +
        `Check CUSTOM_API_KEY and that model "${model}" is valid on your gateway.`
      );
    }

    let body = sanitize(seg(r1.content, "BODY"));
    // Fallback: if tags missing, treat whole response as body
    if (!body && r1.content.trim().length > 500) {
      body = sanitize(r1.content);
    }
    let title = sanitize(seg(r1.content, "TITLE")) || `Episode ${episodeNumber}`;
    let memory = seg(r1.content, "MEMORY");
    const hookType = seg(r1.content, "HOOK_TYPE") || "unknown";

    // continue if cut off
    if (body && (r1.finishReason === "length" || isCutOff(body))) {
      for (let attempt = 0; attempt < 2 && isCutOff(body); attempt++) {
        const rc = await chat(
          model,
          MASTER_RULES,
          `An episode was cut off mid-sentence by an output limit. It stopped here:\n\n...\n${body.slice(-1200)}\n\nContinue from EXACTLY where it stops, beginning by completing the interrupted word or sentence. Do not repeat any text above, do not restart the episode, do not add headings. Finish the episode naturally on its cliffhanger. Return ONLY the continuation inside <CONT>...</CONT>.`,
          4096
        );
        let c = sanitize(seg(rc.content, "CONT"));
        if (!c) continue;
        c = stripOverlap(body, c);
        if (isRestart(body, c)) continue;
        body = body.replace(/\s+$/, "") + " " + c;
      }
    }

    if (!body || wordCount(body) < 800) {
      const rawPreview = (r1.content || "(empty)").slice(0, 1200);
      const words = wordCount(body);
      throw new Error(
        `The model could not finish the episode. ` +
        `Parsed BODY words=${words}. finishReason=${r1.finishReason || "none"}. ` +
        `Raw model output (first 1200 chars):\n${rawPreview}`
      );
    }
    if (isCutOff(body)) {
      throw new Error("The episode ended mid-sentence and could not be completed.");
    }

    // expand if short
    if (wordCount(body) < 1850) {
      const ex = await chat(
        model,
        MASTER_RULES,
        `This episode is only ${wordCount(body)} words; the standard is 2,000-2,500. Rewrite it in full at proper length, adding only meaningful material (deeper scenes, interiority, sharper dialogue, consequences). Keep every event and beat. No padding or repetition. Return only <BODY>...</BODY>.\n\n${body}`,
        12288
      );
      const b2 = sanitize(seg(ex.content, "BODY"));
      if (b2 && wordCount(b2) > wordCount(body)) {
        body = b2;
      }
    }

    // Stage 2: continuity (skipped in fastMode)
    if (!fastMode) {
      const rr = await chat(
        model,
        MASTER_RULES,
        `You are the continuity editor of a serialized novel. Do not comment on style. Check ONLY for these errors:
1. A character knowing or acting on information they have not learned.
2. Wrong names, genders, ages, roles, rooms, or locations versus the bible or state.
3. References to events that never happened on-screen and are not in the state.
4. Romance or reveal progression beyond what the block spec allows.

STORY BIBLE (canon):
${bible}

LIVING STORY STATE:
${storyState && String(storyState).trim() ? storyState : "(none yet — first episode)"}

BLOCK SPEC (pacing limits):
${blockSpec}

EPISODE:
${body}

If you find issues, return ONLY <PATCHES>[{"find":"an exact sentence fragment copied from the episode","replace":"the corrected fragment"}]</PATCHES> — 1 to 4 patches, each replacing the smallest possible fragment, matching the episode text exactly.
If you find none, return only <CLEAN>clean</CLEAN>.`,
        1000
      );

      if (!seg(rr.content, "CLEAN").toLowerCase().includes("clean")) {
        let raw = seg(rr.content, "PATCHES").replace(/```[a-zA-Z]*|```/g, "");
        const s = raw.indexOf("[");
        const e2 = raw.lastIndexOf("]");
        if (s !== -1 && e2 !== -1) {
          try {
            const patches = JSON.parse(raw.slice(s, e2 + 1));
            for (const p of patches) {
              if (p && typeof p.find === "string" && p.find.length > 5 && body.includes(p.find)) {
                body = body.split(p.find).join(String(p.replace ?? ""));
              }
            }
          } catch {
            /* keep original */
          }
        }
      }
    }

    // Stage 3: premium + state (also non-streaming)
    const premiumPrompt = `Here is Episode ${episodeNumber} ("${title}") that was just written:

${body}

Write its PREMIUM MINI STORY: 500-700 words of EXCLUSIVE value the main episode cannot give — another character's POV of an event, a simultaneous scene elsewhere, a private conversation the protagonist never hears, a hidden consequence, or a clue readers receive before the protagonist. It must NOT summarize or retell the episode, and must not repeat any paragraph or line from it.

Return EXACTLY:
<PREMIUM_TITLE>premium story title</PREMIUM_TITLE>
<PREMIUM_BODY>the premium mini story</PREMIUM_BODY>`;

    const statePrompt = `You maintain the living memory (STORY STATE) of a serialized novel. It is injected into every future episode to guarantee continuity.

${
      storyState && String(storyState).trim()
        ? `CURRENT STORY STATE:\n${storyState}`
        : "There is no state yet — initialize it now from the bible and this episode."
    }

STORY BIBLE (canon):
${bible}

JUST-WRITTEN EPISODE ${episodeNumber} ("${title}"):
${body}

Produce the UPDATED STORY STATE with exactly these sections:
${STATE_FORMAT}

Rules:
- Keep it under 1,200 words. Prune resolved threads and stale detail, but NEVER drop hard canon facts.
- Update KNOWLEDGE TRACKER only with things characters personally learned in this episode.
- If this episode contradicted the previous state or bible, keep the CORRECT fact under ESTABLISHED FACTS and add one line "DRIFT WARNING: ..." describing what future episodes must avoid.
${!memory ? "- Also return a 3-4 sentence summary of the episode inside <MEMORY>...</MEMORY> tags." : ""}

Return ONLY <STATE>...</STATE>${!memory ? " and <MEMORY>...</MEMORY>" : ""}.`;

    let premiumTitle = "Premium Mini Story";
    let premiumBody = "";
    let newState = "";

    const runPremium = async () => {
      for (let attempt = 0; attempt < 2 && wordCount(premiumBody) < 400; attempt++) {
        const r2 = await chat(
          model,
          `${MASTER_RULES}\n\nSTORY BIBLE:\n${bible}`,
          premiumPrompt,
          4096
        );
        const t = sanitize(seg(r2.content, "PREMIUM_TITLE"));
        if (t) premiumTitle = t;
        premiumBody = polish(seg(r2.content, "PREMIUM_BODY"));
        // fallback if tags missing
        if (wordCount(premiumBody) < 400 && r2.content.trim().length > 400) {
          premiumBody = polish(r2.content);
        }
      }
    };

    const runState = async () => {
      const rs = await chat(model, MASTER_RULES, statePrompt, 3000);
      newState = seg(rs.content, "STATE");
      if (!memory) memory = seg(rs.content, "MEMORY") || "";
    };

    if (fastMode) {
      await Promise.all([runPremium(), runState()]);
    } else {
      await runPremium();
      await runState();
    }

    if (wordCount(premiumBody) < 400) {
      throw new Error("The episode was written but the premium mini story failed.");
    }

    return {
      title,
      body,
      premiumTitle,
      premiumBody,
      memory,
      hookType,
      state: newState || storyState,
      episodeWords: wordCount(body),
      premiumWords: wordCount(premiumBody),
    };
  },
});
