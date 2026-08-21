import { NextResponse } from 'next/server';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

export const runtime = 'nodejs';

function clean(text: string): string {
  return (text || '')
    .replace(/<\/?[A-Z][A-Z_]*>/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

function paragraphs(text: string): Paragraph[] {
  return clean(text)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new Paragraph({
      children: [new TextRun({ text: s, size: 24 })],
      spacing: { after: 160, line: 300 },
    }));
}

export async function POST(req: Request) {
  try {
    const { storyTitle, blockNumber, blockTitle, blockDescription, episodes } = await req.json();

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: `${storyTitle} - BLOCK ${blockNumber}: ${blockTitle}`, heading: HeadingLevel.TITLE }),
            ...(blockDescription ? [new Paragraph({ children: [new TextRun({ text: blockDescription, italics: true, size: 22 })], spacing: { after: 300 } })] : []),
            ...(episodes as Array<{ number: number; title: string; body: string; premiumTitle: string; premiumBody: string }>).flatMap((episode, index) => [
              new Paragraph({ text: `EPISODE ${episode.number}: ${episode.title}`, heading: HeadingLevel.HEADING_1, pageBreakBefore: index > 0 }),
              ...paragraphs(episode.body),
              new Paragraph({ text: `PREMIUM MINI STORY: ${episode.premiumTitle}`, heading: HeadingLevel.HEADING_2, pageBreakBefore: true }),
              ...paragraphs(episode.premiumBody),
            ]),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="block.docx"',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `Word file build failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}