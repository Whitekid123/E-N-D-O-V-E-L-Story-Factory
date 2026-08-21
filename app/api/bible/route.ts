import { NextResponse } from 'next/server';
import { chat, MASTER_RULES, tag } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { title, genre, episodes, notes, model } = await req.json();
    const total = Math.max(10, parseInt(episodes, 10) || 100);
    const blockCount = Math.ceil(total / 10);
    const genreText = genre && String(genre).trim() ? String(genre).trim() : 'Choose the genre/subgenre that best fits this title.';
    const prompt = `Create the complete master plan for a new serialized novel.

WORKING TITLE: ${title}
GENRE: ${genreText}
TOTAL EPISODES: ${total} (${blockCount} blocks of 10 episodes)
EXTRA CREATIVE NOTES: ${notes && String(notes).trim() ? String(notes).trim() : 'None - invent freely.'}

Build a fresh, original concept from this title - its own hook, characters, world, central conflict, twist architecture, and ending. Decide EVERYTHING now: the true solution to any mystery, every character secret, the full relationship arc, all major turning points, and the ending.

Return EXACTLY this format:
<HOOK>the one-sentence hook of the story</HOOK>
<BIBLE>
Official Title and Genre
One-Sentence Hook
Premise
Tone and Reader Promise
Setting / World
Protagonist (personality, history, strengths, flaws, goals, fears)
Co-Lead / Love Interest (or N/A)
Antagonist / Opposing Force
Supporting Cast (name - role, one line each)
Relationship Map
Past Events Timeline
Secrets Characters KNOW
Secrets Characters DO NOT Know
World Rules
Central Mystery and True Solution (or N/A)
False Leads and Apparent Suspects
Romance Progression (each milestone with its episode range, or N/A)
Major Turning Points
Final Climax
Ending and Aftermath
Non-Negotiable Canon (facts that must never be contradicted)
</BIBLE>`;

    const response = await chat(model, MASTER_RULES, prompt, 8192);
    const bible = tag(response.content, 'BIBLE');
    if (!bible) return NextResponse.json({ error: 'The model returned an incomplete bible. Try again.' }, { status: 502 });
    return NextResponse.json({ bible, hook: tag(response.content, 'HOOK') });
  } catch (error) {
    return NextResponse.json({ error: `Bible generation failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
