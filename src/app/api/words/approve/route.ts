import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { invalidateApprovedWords } from '@/lib/words/approved';

export async function POST(req: Request) {
  const { word } = await req.json();
  const cleanWord = word?.trim();
  if (!cleanWord) return NextResponse.json({ ok: false }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL!);
  await sql`DELETE FROM kh_verify_word WHERE word = ${cleanWord}`;
  await sql`
    INSERT INTO kh_dictionary_new_word (word)
    VALUES (${cleanWord})
    ON CONFLICT (word) DO NOTHING
  `;

  invalidateApprovedWords();

  return NextResponse.json({ ok: true, approved: cleanWord });
}