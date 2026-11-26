import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { cleanWord, isRedLine } from '@/lib/words/redline';

/**
 * Queue a word for review. Called by the n8n workflow; words the editor does
 * not underline in red are skipped, so the queue holds red-line words only.
 */
export async function POST(req: Request) {
  const { word, status = 'pending' } = await req.json();
  const clean = cleanWord(word);
  if (!clean) return NextResponse.json({ ok: false }, { status: 400 });

  if (!(await isRedLine(clean))) {
    return NextResponse.json({ ok: true, word: clean, queued: false, reason: 'known' });
  }

  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    INSERT INTO kh_verify_word (word, status)
    VALUES (${clean}, ${status})
    ON CONFLICT (word) DO NOTHING
  `;

  return NextResponse.json({ ok: true, word: clean, queued: true });
}
