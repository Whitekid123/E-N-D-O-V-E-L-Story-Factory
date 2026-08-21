import { NextResponse } from 'next/server';
import { chat, MASTER_RULES, seg } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { bible, eps, model } = await req.json();
    if (!Array.isArray(eps) || !eps.length) return NextResponse.json({ error: 'No episodes to build memory from.' }, { status: 400 });
    const summaries = eps.map((episode: { number: number; title: string; memory?: string }) => `Ep${episode.number} - ${episode.title}: ${episode.memory || '(no summary)'}`).join('\n');
    const latest = eps[eps.length - 1] as { body?: string; premiumBody?: string };
    const response = await chat(model || 'auto', MASTER_RULES, `Build the living STORY STATE for this serialized novel.

STORY BIBLE:
${bible}

EPISODE SUMMARIES:
${summaries}

LATEST EPISODE:
${String(latest.body || '').slice(0, 10000)}

LATEST PREMIUM STORY (reader-only):
${String(latest.premiumBody || '').slice(0, 3000)}

Return only <STATE>...</STATE> with sections for timeline, character status, relationship stage, knowledge tracker, reader-only knowledge, open threads, live cliffhanger, and established facts. Keep it under 1,200 words and preserve all hard canon.`, 3000);
    const state = seg(response.content, 'STATE');
    if (!state) return NextResponse.json({ error: 'Memory rebuild failed - try again.' }, { status: 502 });
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: `Memory rebuild failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}