import { chat, chatStream, MASTER_RULES, seg, sanitize, polish, isRestart, stripOverlap, isCutOff, wordCount } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const STATE_FORMAT = `TIMELINE - story-world time
CHARACTER STATUS - location, condition, emotional state, current goal for each recurring character
RELATIONSHIP STAGE - exact stage and last milestone
KNOWLEDGE TRACKER - what each character has personally learned
READER-ONLY KNOWLEDGE - premium-story information
OPEN THREADS - active mysteries with episode numbers
LIVE CLIFFHANGER - latest hook
ESTABLISHED FACTS - names, rooms, objects, dates, rules, injuries, locations`;

type Input = Record<string, unknown>;

export async function POST(req: Request) {
  let input: Input;
  try { input = await req.json() as Input; }
  catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }

  const episodeNumber = Number(input.episodeNumber) || 1;
  const totalEpisodes = Number(input.totalEpisodes) || 100;
  const model = String(input.model || 'auto');
  const bible = String(input.bible || '');
  const blockSpec = String(input.blockSpec || '');
  const storyState = String(input.storyState || '');
  const memories = Array.isArray(input.memories) ? input.memories.map(String) : [];
  const recentHooks = Array.isArray(input.recentHooks) ? input.recentHooks.map(String) : [];
  const lastEnding = String(input.lastEnding || '');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* Client disconnected. */ } };
      try {
        const system = `${MASTER_RULES}\n\nSTORY BIBLE (canon):\n${bible}\n\nLIVING STORY STATE (never contradict it):\n${storyState || '(Not initialized - Episode 1.)'}\n\nCURRENT BLOCK SPEC:\n${blockSpec}`;
        const prompt = `Write EPISODE ${episodeNumber} of ${totalEpisodes}.

RECENT CONTINUITY:\n${memories.length ? memories.join('\n') : '(Episode 1 - establish the world and hook the reader.)'}

LAST EPISODE FINAL SCENE - open from its consequences, never repeat it:\n${lastEnding || '(Episode 1 - no previous episode.)'}

RECENT CLIFFHANGER DEVICES:\n${recentHooks.length ? recentHooks.join('; ') : '(none)'}

Requirements:
- One clear objective and purposeful scenes that change information, emotion, risk, relationship, or decision.
- Preserve names, genders, ages, roles, rooms, locations, knowledge ownership, and timeline. Never invent an event not shown or established.
- Do not repeat previous scenes, warnings, confrontations, opening imagery, or first lines.
- Main body: 2,000-2,500 words. Complete final sentence and varied cliffhanger.

Return exactly:
<TITLE>episode title</TITLE>
<BODY>full episode</BODY>
<MEMORY>3-5 sentence continuity summary</MEMORY>
<HOOK_TYPE>cliffhanger device</HOOK_TYPE>`;
        send({ type: 'status', message: `Writing Episode ${episodeNumber} of ${totalEpisodes}...` });
        const first = await chatStream(model, system, prompt, 12288, (text) => send({ type: 'chunk', text }));
        let body = sanitize(seg(first.content, 'BODY'));
        const title = sanitize(seg(first.content, 'TITLE')) || `Episode ${episodeNumber}`;
        let memory = seg(first.content, 'MEMORY');
        const hookType = seg(first.content, 'HOOK_TYPE') || 'unknown';
        let bodyChanged = false;

        for (let attempt = 0; attempt < 2 && body && (first.finishReason === 'length' || isCutOff(body)); attempt += 1) {
          send({ type: 'status', message: 'Completing the episode...' });
          const continuation = await chat(model, MASTER_RULES, `Continue this episode exactly where it stops. Do not repeat or restart. Return only <CONT>...</CONT>.\n\n${body.slice(-1200)}`, 4096);
          let next = sanitize(seg(continuation.content, 'CONT'));
          if (!next) continue;
          next = stripOverlap(body, next); if (isRestart(body, next)) continue;
          body = `${body.replace(/\s+$/, '')} ${next}`; bodyChanged = true; send({ type: 'body', text: body });
        }
        if (!body || wordCount(body) < 800 || isCutOff(body)) { send({ type: 'error', message: 'The episode could not be completed. Retry this episode.' }); return; }

        if (wordCount(body) < 1900) {
          send({ type: 'status', message: 'Episode is short - expanding with meaningful material...' });
          const expanded = await chat(model, MASTER_RULES, `Rewrite this episode in full at 2,000-2,500 words. Keep every event and beat; add meaningful scenes only. Return <BODY>...</BODY>.\n\n${body}`, 12288);
          const expandedBody = sanitize(seg(expanded.content, 'BODY'));
          if (expandedBody && wordCount(expandedBody) > wordCount(body)) { body = expandedBody; bodyChanged = true; send({ type: 'body', text: body }); }
        }
        body = polish(body);

        send({ type: 'status', message: 'Running continuity check against the bible and story memory...' });
        const check = await chat(model, MASTER_RULES, `Check this episode for knowledge, name, gender, age, role, room, location, timeline, invented-event, and pacing contradictions. If clean return <CLEAN>clean</CLEAN>. Otherwise return the full corrected text in <BODY>...</BODY>, changing only contradictory passages.

BIBLE:\n${bible}\n\nSTATE:\n${storyState || '(none)'}\n\nBLOCK:\n${blockSpec}\n\nEPISODE:\n${body}`, 12288);
        if (!seg(check.content, 'CLEAN').toLowerCase().includes('clean')) {
          const fixed = sanitize(seg(check.content, 'BODY'));
          if (fixed && wordCount(fixed) > 800 && wordCount(fixed) > wordCount(body) * 0.7) { body = polish(fixed); bodyChanged = true; send({ type: 'body', text: body }); }
        }
        if (!memory || bodyChanged) {
          send({ type: 'status', message: 'Updating episode memory...' });
          const summary = await chat(model, MASTER_RULES, `Summarize this episode in 3-4 sentences. Return only <MEMORY>...</MEMORY>.\n\n${body.slice(0, 12000)}`, 600);
          memory = seg(summary.content, 'MEMORY') || memory || '';
        }

        let premiumTitle = 'Premium Mini Story'; let premiumBody = '';
        const premiumPrompt = `Write a 500-700 word premium mini story for Episode ${episodeNumber} using exclusive POV, parallel scene, private conversation, hidden consequence, or early clue. Do not summarize or repeat the episode. Return <PREMIUM_TITLE>title</PREMIUM_TITLE><PREMIUM_BODY>story</PREMIUM_BODY>.\n\nEPISODE:\n${body}`;
        for (let attempt = 0; attempt < 2 && wordCount(premiumBody) < 400; attempt += 1) {
          send({ type: 'premium_reset' }); send({ type: 'status', message: 'Writing the premium mini story...' });
          const premium = await chatStream(model, `${MASTER_RULES}\n\nBIBLE:\n${bible}`, premiumPrompt, 4096, (text) => send({ type: 'premium_chunk', text }));
          premiumTitle = sanitize(seg(premium.content, 'PREMIUM_TITLE')) || premiumTitle; premiumBody = polish(seg(premium.content, 'PREMIUM_BODY'));
        }
        if (wordCount(premiumBody) < 400) { send({ type: 'error', message: 'The premium mini story failed. Retry this episode.' }); return; }

        send({ type: 'status', message: 'Updating the living story memory...' });
        const stateResponse = await chat(model, MASTER_RULES, `Update the living story state under 1,200 words. Preserve hard canon. Track timeline, character status, relationship stage, knowledge ownership, reader-only premium knowledge, open threads with episode numbers, live cliffhanger, and established facts. Return only <STATE>...</STATE>.

FORMAT:\n${STATE_FORMAT}\n\nCURRENT STATE:\n${storyState || '(none)'}\n\nBIBLE:\n${bible}\n\nEPISODE:\n${body}\n\nPREMIUM STORY:\n${premiumBody}`, 3000);
        send({ type: 'done', data: { title, body, premiumTitle, premiumBody, memory, hookType, state: seg(stateResponse.content, 'STATE') || storyState, episodeWords: wordCount(body), premiumWords: wordCount(premiumBody) } });
      } catch (error) { send({ type: 'error', message: `Episode generation failed: ${error instanceof Error ? error.message : String(error)}` }); }
      finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}
