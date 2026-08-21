import OpenAI from 'openai';

export const MASTER_RULES = `You are the Endovel Story Engine, a professional serialized-fiction writing system for episodic novels with premium mini stories.

ABSOLUTE LAWS:
1. THE PLAN IS LAW. Stay strictly inside the assigned block outline. Never pull a later reveal, romance milestone, villain exposure, or payoff forward. Foreshadowing is allowed; premature payoff is not.
2. LENGTH. The main episode runs 2,000-2,500 words of meaningful material. The premium mini story runs 500+ words.
3. CONTINUITY. Open from the consequences of the previous episode. Characters never reset between episodes and act only on information they actually possess.
4. NO FILLER. No repeated thoughts, restated facts, duplicated paragraphs, or dialogue that has already made its point.
5. HOOKS. The first 100-200 words must grip. End on a natural cliffhanger woven into the final scene - never labeled "Cliffhanger", and vary the device between episodes.
6. PREMIUM EXCLUSIVE VALUE. The premium mini story must have an exclusive reason to exist - another POV, a parallel scene, a private conversation the protagonist never hears, a hidden consequence, or a clue readers get first. Never a summary of the episode.
7. PACING. Every episode changes something: information, emotion, risk, relationship, or decision. Romance and reveals advance only at the stage the block plan permits. Major events get aftermath.
8. STYLE. Immersive in-world prose. Show, don't tell. Character-specific dialogue. Visual, cinematic scenes. No author notes or meta commentary inside story text.
9. ORIGINALITY. Every story is a fresh concept with its own identity.`;

export function wordCount(text: string): number {
  return ((text || '').trim().match(/\S+/g) || []).length;
}

export function tag(text: string, name: string): string {
  const match = (text || '').match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? match[1].trim() : '';
}

export function seg(text: string, name: string): string {
  if (!text) return '';
  const cleaned = text.trim().replace(/^```[a-zA-Z]*\s*/i, '').replace(/```\s*$/i, '');
  const open = new RegExp(`<${name}>`, 'i');
  const index = cleaned.search(open);
  if (index === -1) return '';
  let value = cleaned.slice(index).replace(open, '');
  const close = new RegExp(`</${name}>`, 'i');
  const closeIndex = value.search(close);
  value = closeIndex === -1 ? value.replace(/<[A-Za-z_/][^>]*$/, '') : value.slice(0, closeIndex);
  return value.trim();
}

export function sanitize(text: string): string {
  return (text || '')
    .replace(/<\/?[A-Z][A-Z_]*>/g, '')
    .replace(/^\s*(TITLE|BODY|PREMIUM_TITLE|PREMIUM_BODY|MEMORY|HOOK_TYPE|CONT)\s*:?\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function dedupeParagraphs(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length < 4) return text;
  const seen = new Set<string>();
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    const key = paragraph.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key.length > 80) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    output.push(paragraph);
  }
  return output.length === paragraphs.length ? text : output.join('\n\n');
}

export function removeDouble(text: string): string {
  if (text.length < 600) return text;
  const probe = text.slice(100, 220);
  const second = text.indexOf(probe, 300);
  return probe.length >= 80 && second > 300 ? text.slice(0, second).trim() : text;
}

export function isRestart(body: string, continuation: string): boolean {
  const existing = body.toLowerCase().replace(/\s+/g, ' ');
  const next = continuation.toLowerCase().replace(/\s+/g, ' ');
  const head = existing.slice(0, Math.floor(existing.length * 0.6));
  for (let index = 0; index + 80 <= Math.min(next.length, 200); index += 1) {
    if (head.includes(next.slice(index, index + 80))) return true;
  }
  return false;
}

export function stripOverlap(body: string, continuation: string): string {
  const bodyWords = body.trim().split(/\s+/);
  const continuationWords = continuation.trim().split(/\s+/);
  for (let count = Math.min(bodyWords.length, continuationWords.length, 100); count >= 12; count -= 1) {
    if (bodyWords.slice(-count).join(' ').toLowerCase() === continuationWords.slice(0, count).join(' ').toLowerCase()) {
      return continuationWords.slice(count).join(' ').trim() || continuation.trim();
    }
  }
  return continuation.trim();
}

export function isCutOff(text: string): boolean {
  const value = (text || '').trim();
  return !value || !/[.!?…"'”’)]$/.test(value);
}

export function polish(text: string): string {
  return dedupeParagraphs(removeDouble(sanitize(text)));
}

export async function chat(
  model: string,
  system: string,
  user: string,
  maxTokens = 8192,
): Promise<{ content: string; finishReason: string }> {
  if (!process.env.CUSTOM_API_KEY) throw new Error('CUSTOM_API_KEY is not set.');
  const client = new OpenAI({
    apiKey: process.env.CUSTOM_API_KEY,
    baseURL: 'https://api.hcnsec.cn/v1',
  });
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  type Payload = Parameters<typeof client.chat.completions.create>[0];
  const attempts: Record<string, unknown>[] = [
    { model: model || 'auto', max_tokens: maxTokens, messages, thinking: { type: 'disabled' } },
    { model: model || 'auto', max_tokens: maxTokens, messages },
    { model: model || 'auto', max_completion_tokens: maxTokens, messages },
    { model: model || 'auto', max_tokens: Math.min(maxTokens, 8192), messages },
    { model: model || 'auto', max_tokens: 4096, messages },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const response = await client.chat.completions.create(attempt as unknown as Payload);
      if (!('choices' in response)) throw new Error('The gateway returned a streaming response unexpectedly.');
      return {
        content: response.choices?.[0]?.message?.content || '',
        finishReason: response.choices?.[0]?.finish_reason || '',
      };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      lastError = error;
      if (message.includes('api key') || message.includes('auth') || message.includes('401') || message.includes('quota') || message.includes('balance')) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function chatStream(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  onChunk: (text: string) => void,
): Promise<{ content: string; finishReason: string }> {
  if (!process.env.CUSTOM_API_KEY) throw new Error('CUSTOM_API_KEY is not set.');
  const client = new OpenAI({ apiKey: process.env.CUSTOM_API_KEY, baseURL: 'https://api.hcnsec.cn/v1' });
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  type Payload = Parameters<typeof client.chat.completions.create>[0];
  type StreamPart = { choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }> };
  const attempts: Record<string, unknown>[] = [
    { model: model || 'auto', max_tokens: maxTokens, messages, thinking: { type: 'disabled' }, stream: true },
    { model: model || 'auto', max_tokens: maxTokens, messages, stream: true },
    { model: model || 'auto', max_completion_tokens: maxTokens, messages, stream: true },
    { model: model || 'auto', max_tokens: Math.min(maxTokens, 8192), messages, stream: true },
    { model: model || 'auto', max_tokens: 4096, messages, stream: true },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    let content = '';
    let finishReason = '';
    let receivedAny = false;
    try {
      const stream = await client.chat.completions.create(attempt as unknown as Payload);
      for await (const part of stream as AsyncIterable<StreamPart>) {
        const delta = part.choices?.[0]?.delta?.content || '';
        if (delta) { receivedAny = true; content += delta; onChunk(delta); }
        const reason = part.choices?.[0]?.finish_reason;
        if (reason) finishReason = reason;
      }
      return { content, finishReason };
    } catch (error) {
      if (receivedAny) return { content, finishReason: 'length' };
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      lastError = error;
      if (message.includes('api key') || message.includes('auth') || message.includes('401') || message.includes('quota') || message.includes('balance')) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
