import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// simple in-memory throttle: 5 fails = 10-minute lockout per visitor
const attempts = new Map<string, { count: number; until: number }>();

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: 'APP_PASSWORD is not set in .env.local — protection is currently OFF.' }, { status: 500 });
  }

  const key = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.until > now) {
    return NextResponse.json(
      { error: `Too many attempts — try again in ${Math.ceil((record.until - now) / 60000)} minute(s).` },
      { status: 429 }
    );
  }

  const { passcode } = await req.json().catch(() => ({}));
  if (String(passcode || '') !== password) {
    const current = attempts.get(key) || { count: 0, until: 0 };
    current.count += 1;
    if (current.count >= 5) { current.count = 0; current.until = now + 10 * 60 * 1000; }
    attempts.set(key, current);
    return NextResponse.json({ error: 'Wrong passcode.' }, { status: 401 });
  }

  attempts.delete(key);
  const token = await sha256(`endovel::${password}`);
  const cookie = `endovel_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

  return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
}