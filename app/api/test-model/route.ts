import { NextResponse } from 'next/server';
import { chatStream } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { model } = await req.json();
    const name = String(model || '').trim();
    if (!name) return NextResponse.json({ ok: false, error: 'Pick or type a model name first.' }, { status: 400 });

    const start = Date.now();
    let firstTokenMs = 0;
    let content = '';
    await chatStream(name, 'You are a novelist.', 'Write exactly one vivid, atmospheric sentence (maximum 25 words) describing rain falling on a harbor at midnight. Return only the sentence - no quotes, no explanation.', 300, (text) => {
      if (!firstTokenMs) firstTokenMs = Date.now() - start;
      content += text;
    });

    const totalMs = Date.now() - start;
    const sample = content.replace(/<[^>]*>/g, '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
    const words = sample.split(/\s+/).filter(Boolean).length;
    const generationSeconds = Math.max((totalMs - firstTokenMs) / 1000, 0.1);
    const wordsPerSecond = words > 3 ? Math.round(words / generationSeconds) : null;
    if (!sample) return NextResponse.json({ ok: false, error: `"${name}" responded with empty text. Try another model.` }, { status: 502 });
    return NextResponse.json({ ok: true, sample, ttftMs: firstTokenMs || totalMs, totalMs, wps: wordsPerSecond });
  } catch (error) {
    return NextResponse.json({ ok: false, error: `Could not reach the model: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
