import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Set-Cookie': 'endovel_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' } }
  );
}