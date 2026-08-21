import { NextResponse } from 'next/server';
import { chat, chatStream, MASTER_RULES, seg, sanitize, polish, isRestart, stripOverlap, isCutOff, wordCount } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const STATE_FORMAT = `TIMELINE — where we are in story-world time
CHARACTER STATUS — each recurring character: location, condition, emotional state, current goal
RELATIONSHIP STAGE — exact stage between the leads; last milestone reached
KNOWLEDGE TRACKER — what each character has personally learned so far (facts, secrets, suspicions)
READER-ONLY KNOWLEDGE — things only readers know via premium stories
OPEN THREADS — active mysteries/plot threads, each tagged with the episode it appeared in
LIVE CLIFFHANGER — the hook the latest episode ended on
ESTABLISHED FACTS — hard canon details established so far (names, rooms, objects, dates, rules, injuries, who is where)`;

export async function POST(req: Request) {
  let input: Record<string, any>;
  try { input = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  const {
    episodeNumber, totalEpisodes, model, bible, blockSpec, storyState = '',
    memories = [], recentHooks = [], lastEnding = '', fastMode = false,
  } = input;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); }
        catch { /* client disconnected */ }
      };
      const pingTimer = setInterval(() => send({ type: 'ping' }), 10_000);

      try {
        const system = `${MASTER_RULES}

STORY BIBLE (canon — never contradict it):
 ${bible}

LIVING STORY STATE (the novel's accumulated memory — established facts, character knowledge, open threads; never contradict it):
 ${storyState && String(storyState).trim() ? storyState : '(Not yet initialized — this is Episode 1. The state will be created after this episode.)'}

CURRENT BLOCK SPEC (obey it — do not pull later-block material forward):
 ${blockSpec}`;

        const memTxt = memories.length
          ? memories.join('\n')
          : '(This is Episode 1 — establish the world and hook the reader within the first 150 words.)';
        const hookTxt = recentHooks.length ? recentHooks.join('; ') : '(none yet)';
        const endingTxt = lastEnding || '(Episode 1 — no previous episode.)';

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

        // ---------- Stage 1: the episode (streamed live) ----------
        send({ type: 'status', message: `Writing Episode ${episodeNumber} of ${totalEpisodes}...` });
        const r1 = await chatStream(model, system, user1, 12288, (t) => send({ type: 'chunk', text: t }));

        let body = sanitize(seg(r1.content, 'BODY'));
        let title = sanitize(seg(r1.content, 'TITLE')) || `Episode ${episodeNumber}`;
        let memory = seg(r1.content, 'MEMORY');
        const hookType = seg(r1.content, 'HOOK_TYPE') || 'unknown';
        let bodyChanged = false;

        // ---------- continue if cut off ----------
        if (body && (r1.finishReason === 'length' || isCutOff(body))) {
          for (let attempt = 0; attempt < 2 && isCutOff(body); attempt++) {
            send({ type: 'status', message: 'Output hit the model limit — completing the episode...' });
            const rc = await chat(model, MASTER_RULES,
`An episode was cut off mid-sentence by an output limit. It stopped here:

...
 ${body.slice(-1200)}

Continue from EXACTLY where it stops, beginning by completing the interrupted word or sentence. Do not repeat any text above, do not restart the episode, do not add headings. Finish the episode naturally on its cliffhanger. Return ONLY the continuation inside <CONT>...</CONT>.`,
              4096);
            let c = sanitize(seg(rc.content, 'CONT'));
            if (!c) continue;
            c = stripOverlap(body, c);
            if (isRestart(body, c)) continue;
            body = body.replace(/\s+$/, '') + ' ' + c;
            bodyChanged = true;
            send({ type: 'body', text: body });
          }
        }

        if (!body || wordCount(body) < 800) {
          send({ type: 'error', message: 'The model could not finish the episode. Try again, or set a specific model name (e.g. glm-5.2).' });
          return;
        }
        if (isCutOff(body)) {
          send({ type: 'error', message: 'The episode ended mid-sentence and could not be completed automatically. Click the button again to retry this episode.' });
          return;
        }

        // ---------- expand only if genuinely short ----------
        if (wordCount(body) < 1850) {
          send({ type: 'status', message: `Episode came in short (${wordCount(body)} words) — expanding...` });
          const ex = await chat(model, MASTER_RULES,
`This episode is only ${wordCount(body)} words; the standard is 2,000-2,500. Rewrite it in full at proper length, adding only meaningful material (deeper scenes, interiority, sharper dialogue, consequences). Keep every event and beat. No padding or repetition. Return only <BODY>...</BODY>.

 ${body}`, 12288);
          const b2 = sanitize(seg(ex.content, 'BODY'));
          if (b2 && wordCount(b2) > wordCount(body)) {
            body = b2; bodyChanged = true;
            send({ type: 'body', text: body });
          }
        }

        // ---------- Stage 2: continuity check (PATCH mode — tiny output, seconds not minutes) ----------
        if (!fastMode) {
          send({ type: 'status', message: 'Continuity check against bible and story memory...' });
          const rr = await chat(model, MASTER_RULES,
`You are the continuity editor of a serialized novel. Do not comment on style. Check ONLY for these errors:
1. A character knowing or acting on information they have not learned.
2. Wrong names, genders, ages, roles, rooms, or locations versus the bible or state.
3. References to events that never happened on-screen and are not in the state.
4. Romance or reveal progression beyond what the block spec allows.

STORY BIBLE (canon):
 ${bible}

LIVING STORY STATE:
 ${storyState && String(storyState).trim() ? storyState : '(none yet — first episode)'}

BLOCK SPEC (pacing limits):
 ${blockSpec}

EPISODE:
 ${body}

If you find issues, return ONLY <PATCHES>[{"find":"an exact sentence fragment copied from the episode","replace":"the corrected fragment"}]</PATCHES> — 1 to 4 patches, each replacing the smallest possible fragment, matching the episode text exactly.
If you find none, return only <CLEAN>clean</CLEAN>.`,
            1000);

          if (!seg(rr.content, 'CLEAN').toLowerCase().includes('clean')) {
            let raw = seg(rr.content, 'PATCHES').replace(/```[a-zA-Z]*|```/g, '');
            const s = raw.indexOf('[');
            const e2 = raw.lastIndexOf(']');
            if (s !== -1 && e2 !== -1) {
              try {
                const patches = JSON.parse(raw.slice(s, e2 + 1));
                let applied = 0;
                for (const p of patches) {
                  if (p && typeof p.find === 'string' && p.find.length > 5 && body.includes(p.find)) {
                    body = body.split(p.find).join(String(p.replace ?? ''));
                    applied++;
                  }
                }
                if (applied) {
                  bodyChanged = true;
                  send({ type: 'body', text: body });
                  send({ type: 'status', message: `Continuity: ${applied} correction${applied > 1 ? 's' : ''} applied.` });
                }
              } catch { /* malformed patches — keep original */ }
            }
          }
        }

        // ---------- Stage 3: premium + state update ----------
        const premiumPrompt = `Here is Episode ${episodeNumber} ("${title}") that was just written:

 ${body}

Write its PREMIUM MINI STORY: 500-700 words of EXCLUSIVE value the main episode cannot give — another character's POV of an event, a simultaneous scene elsewhere, a private conversation the protagonist never hears, a hidden consequence, or a clue readers receive before the protagonist. It must NOT summarize or retell the episode, and must not repeat any paragraph or line from it.

Return EXACTLY:
<PREMIUM_TITLE>premium story title</PREMIUM_TITLE>
<PREMIUM_BODY>the premium mini story</PREMIUM_BODY>`;

        const statePrompt = `You maintain the living memory (STORY STATE) of a serialized novel. It is injected into every future episode to guarantee continuity.

 ${storyState && String(storyState).trim()
          ? `CURRENT STORY STATE:\n${storyState}`
          : 'There is no state yet — initialize it now from the bible and this episode.'}

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
 ${!memory ? '- Also return a 3-4 sentence summary of the episode inside <MEMORY>...</MEMORY> tags.' : ''}

Return ONLY <STATE>...</STATE>${!memory ? ' and <MEMORY>...</MEMORY>' : ''}.`;

        let premiumTitle = 'Premium Mini Story';
        let premiumBody = '';
        let newState = '';

        const runPremium = async () => {
          for (let attempt = 0; attempt < 2 && wordCount(premiumBody) < 400; attempt++) {
            send({ type: 'premium_reset' });
            send({ type: 'status', message: 'Writing the premium mini story...' });
            const r2 = await chatStream(model, `${MASTER_RULES}\n\nSTORY BIBLE:\n${bible}`, premiumPrompt, 4096,
              (t) => send({ type: 'premium_chunk', text: t }));
            const t = sanitize(seg(r2.content, 'PREMIUM_TITLE'));
            if (t) premiumTitle = t;
            premiumBody = polish(seg(r2.content, 'PREMIUM_BODY'));
          }
        };

        const runState = async () => {
          send({ type: 'status', message: 'Updating the living story memory...' });
          const rs = await chat(model, MASTER_RULES, statePrompt, 3000);
          newState = seg(rs.content, 'STATE');
          if (!memory) memory = seg(rs.content, 'MEMORY') || '';
        };

        if (fastMode) {
          // premium and state run at the same time — saves one full round-trip
          send({ type: 'status', message: 'Writing premium story + updating memory in parallel...' });
          await Promise.all([runPremium(), runState()]);
        } else {
          await runPremium();
          await runState();
        }

        if (wordCount(premiumBody) < 400) {
          send({ type: 'error', message: 'The episode was written but the premium mini story failed — click the button again to retry this episode.' });
          return;
        }

        send({ type: 'done', data: {
          title, body, premiumTitle, premiumBody, memory, hookType,
          state: newState || storyState,
          episodeWords: wordCount(body),
          premiumWords: wordCount(premiumBody),
        }});
      } catch (e) {
        send({ type: 'error', message: `Episode generation failed: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        clearInterval(pingTimer);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}