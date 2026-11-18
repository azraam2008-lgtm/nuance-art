import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return clearSession(NextResponse.json({ ok: true }));
}
