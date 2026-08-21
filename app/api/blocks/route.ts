import { NextResponse } from 'next/server';
import { chat, MASTER_RULES } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { bible, episodes, model } = await req.json();
    const total = Math.max(10, parseInt(episodes, 10) || 100);
    const blockCount = Math.ceil(total / 10);
    const blockList = Array.from({ length: blockCount }, (_, index) => {
      const start = index * 10 + 1;
      const end = Math.min((index + 1) * 10, total);
      return `Block ${index + 1} = Episodes ${start}-${end}`;
    }).join(', ');
    const prompt = `Based on this story bible, write the complete BLOCK PLAN for all ${blockCount} blocks. Block ranges: ${blockList}. The final block may be shorter than 10 episodes.

STORY BIBLE:
${bible}

For EVERY block from 1 to ${blockCount}, in order, return it wrapped in tags exactly like this:

<BLOCK_1>
BLOCK 1: BLOCK TITLE
EPISODES: 1-10
PURPOSE: what this block must accomplish
STARTING STATE: where the characters are emotionally and practically
MAIN CONFLICTS ALLOWED:
RELATIONSHIP PROGRESSION ALLOWED:
CLUES / REVEALS ALLOWED:
MUST NOT REVEAL YET: later-block material that must stay out of this block
KEY TURNING POINTS:
ENDING STATE:
BLOCK-END HOOK: what pushes readers into the next ten episodes
</BLOCK_1>

Rules:
- Follow the bible exactly: its mystery solution, reveal layering, romance progression, turning points, climax, and ending.
- Distribute the material so EVERY block has real content - no empty stretch blocks, and no dumping the ending into the last block.
- The final blocks must space out climax, confrontation, consequences, emotional processing, and aftermath.`;
    const response = await chat(model, MASTER_RULES, prompt, 8192);
    const missing: number[] = [];
    for (let index = 1; index <= blockCount; index += 1) {
      if (!new RegExp(`<block_${index}\\b`, 'i').test(response.content)) missing.push(index);
    }
    if (missing.length) {
      return NextResponse.json({ error: `The block plan was cut off - block${missing.length > 1 ? 's' : ''} ${missing.join(', ')} missing. Retry; your story bible is safe.` }, { status: 502 });
    }
    return NextResponse.json({ blocks: response.content });
  } catch (error) {
    return NextResponse.json({ error: `Block planning failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
