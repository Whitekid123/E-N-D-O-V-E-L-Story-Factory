import { NextResponse } from 'next/server';
import { chat, MASTER_RULES, seg } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

type QCReport = {
  verdict: string;
  summary: string;
  episodes: Array<{ number: number; title: string; score?: number; issues: string[] }>;
  crossEpisode: string[];
  fixes: Array<{ episode: number; problem: string; instruction: string }>;
};

export async function POST(req: Request) {
  try {
    const { model, bible, storyState, blockSpec, blockNumber, episodes } = await req.json();
    if (!Array.isArray(episodes) || !episodes.length) return NextResponse.json({ error: 'No episodes to check.' }, { status: 400 });
    const episodeText = episodes.map((episode: { number: number; title: string; body: string; premiumTitle: string; premiumBody: string; episodeWords?: number; premiumWords?: number }) => `=== EPISODE ${episode.number}: ${episode.title} (${episode.episodeWords || 0} words) ===\n${episode.body}\n\n--- PREMIUM: ${episode.premiumTitle} (${episode.premiumWords || 0} words) ---\n${episode.premiumBody}`).join('\n\n');
    const prompt = `Grade Block ${blockNumber} against this serialized-fiction checklist. Check block purpose and pacing, premature reveals, canon and knowledge, word counts, change per episode, cliffhanger variety, premium exclusivity, repetition, romance stage, bridge into the next block, and opening hooks.

BLOCK SPEC:\n${blockSpec}\n\n${storyState ? `LIVING STATE:\n${storyState}\n` : ''}EPISODES:\n${episodeText}

Score each episode 0-100. Return ONLY JSON inside <REPORT> tags:
<REPORT>{"verdict":"PASS or FIX","summary":"2-3 sentences","episodes":[{"number":1,"title":"","score":88,"issues":[]}],"crossEpisode":[],"fixes":[{"episode":1,"problem":"","instruction":""}]}</REPORT>`;
    const response = await chat(model || 'auto', `${MASTER_RULES}\n\nSTORY BIBLE:\n${bible}`, prompt, 8192);
    const raw = seg(response.content, 'REPORT') || response.content;
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) return NextResponse.json({ error: 'QC report could not be parsed - try again.' }, { status: 502 });
    let report: QCReport;
    try { report = JSON.parse(raw.slice(start, end + 1)) as QCReport; }
    catch { return NextResponse.json({ error: 'QC report was malformed - try again.' }, { status: 502 }); }
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json({ error: `QC failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}