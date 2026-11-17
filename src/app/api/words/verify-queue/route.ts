import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function POST(req: Request) {
  const { word, status = 'pending' } = await req.json();
  const cleanWord = word?.trim();
  if (!cleanWord) return NextResponse.json({ ok: false }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    INSERT INTO kh_verify_word (word, status)
    VALUES (${cleanWord}, ${status})
    ON CONFLICT (word) DO NOTHING
  `;

  return NextResponse.json({ ok: true, word: cleanWord });
}