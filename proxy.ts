import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE = 'endovel_auth';

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const expected = await sha256(`endovel::${password}`);
  const token = request.cookies.get(COOKIE)?.value;
  if (token === expected) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized — reload the page and sign in.' }, { status: 401 });
  }

  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|login|api/login|api/logout).*)'],
};