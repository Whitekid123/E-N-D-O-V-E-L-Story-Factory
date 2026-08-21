import { NextResponse } from 'next/server';
import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, TextRun } from 'docx';

export const runtime = 'nodejs';

const GOLD = 'A87A2E';
const GRAY = '6E6656';
const INK = '1F1B16';

function clean(text: string): string {
  return (text || '')
    .replace(/<\/?[A-Z][A-Z_]*>/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

function isSceneBreak(line: string): boolean {
  return /^\s*([-*•#]\s*){3,}$/.test(line) || /^\s*[-—–]\s*[-—–]\s*[-—–]\s*$/.test(line);
}

function bodyParagraphs(text: string): Paragraph[] {
  const lines = clean(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out: Paragraph[] = [];
  let first = true;
  for (const line of lines) {
    if (isSceneBreak(line)) {
      out.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
        children: [new TextRun({ text: '❖', color: GOLD, size: 22 })],
      }));
      first = true;
      continue;
    }
    out.push(new Paragraph({
      indent: first ? undefined : { firstLine: 360 },
      spacing: { after: 140, line: 340 },
      children: [new TextRun({ text: line, size: 24 })],
    }));
    first = false;
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const { storyTitle, storyGenre, blockNumber, blockTitle, blockDescription, episodes } = await req.json();
    const eps = (Array.isArray(episodes) ? episodes : []).slice().sort((a, b) => a.number - b.number);
    if (!eps.length) {
      return NextResponse.json({ error: 'No episodes to export.' }, { status: 400 });
    }

    const first = eps[0].number;
    const last = eps[eps.length - 1].number;
    const title = String(storyTitle || 'Untitled Story');
    const bTitle = String(blockTitle || `Block ${blockNumber}`);
    const genre = String(storyGenre || '').trim();
    const description = clean(blockDescription || '').replace(/\n+/g, ' ');

    // ---------- front matter, exactly like the sample ----------
    const front: Paragraph[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 1000, after: 140 },
        children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 44 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({ text: `Block ${blockNumber} — Episodes ${first}–${last}`, bold: true, color: GOLD, size: 22 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: genre ? 100 : 160 },
        children: [new TextRun({ text: `Block ${blockNumber}: ${bTitle}`, bold: true, size: 26 })],
      }),
      ...(genre ? [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: genre, italics: true, color: GRAY, size: 20 })],
      })] : []),
    ];

    // ---------- block description section ----------
    const descSection: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 480, after: 200 },
        children: [new TextRun({ text: `Block ${blockNumber}: ${bTitle}`, bold: true, size: 26 })],
      }),
      ...(description ? [new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 200, line: 340 },
        children: [new TextRun({ text: description, italics: true, color: GRAY, size: 22 })],
      })] : []),
    ];

    // ---------- episodes: "Episode N: Title" + body + premium right after ----------
    const episodeBlocks: Paragraph[] = eps.flatMap((e: any, i: number) => [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: i > 0,
        spacing: { before: i === 0 ? 480 : 360, after: 240 },
        border: { bottom: { color: GOLD, style: BorderStyle.SINGLE, size: 4, space: 6 } },
        children: [new TextRun({ text: `Episode ${e.number}: ${String(e.title || '')}`, bold: true, size: 30 })],
      }),
      ...bodyParagraphs(e.body || ''),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 480, after: 200 },
        border: { top: { color: GOLD, style: BorderStyle.SINGLE, size: 4, space: 8 } },
        children: [new TextRun({ text: `Premium Mini Story: ${String(e.premiumTitle || '')}`, bold: true, color: GOLD, size: 26 })],
      }),
      ...bodyParagraphs(e.premiumBody || ''),
    ]);

    const doc = new Document({
      creator: 'Endovel Story Factory',
      title: `${title} — Block ${blockNumber}`,
      styles: {
        default: { document: { run: { font: 'Georgia', size: 24, color: INK } } },
      },
      sections: [{
        properties: {},
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `${title} · Block ${blockNumber}   ·   Page `, size: 18, color: GRAY }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18, color: GRAY }),
              ],
            })],
          }),
        },
        children: [...front, ...descSection, ...episodeBlocks],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = String(bTitle).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 50) || 'story';
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="Block_${blockNumber}_${safeName}.docx"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Word file build failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}