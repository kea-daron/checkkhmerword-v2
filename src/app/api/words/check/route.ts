import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getStore } from '@/lib/dict/store';
import { cleanWord, isRedLine } from '@/lib/words/redline';

/**
 * Called by the n8n review workflow for every word it segments out of a
 * submitted text. `exists` is true unless the editor would underline the word
 * in red, so only red-line words reach `kh_verify_word`.
 */
export async function POST(req: Request) {
  try {
    const { word } = await req.json();
    const clean = cleanWord(word);
    if (!clean) {
      return NextResponse.json({ exists: false, word: '' });
    }

    const dictSize = getStore().entries.length;
    if (!(await isRedLine(clean))) {
      return NextResponse.json({ exists: true, word: clean, dictSize, source: 'dictionary' });
    }

    // The approved list is cached for a few seconds; ask the table directly too.
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT 1 FROM kh_dictionary_new_word WHERE word = ${clean} LIMIT 1
    `;

    return NextResponse.json({
      exists: rows.length > 0,
      word: clean,
      dictSize,
      source: rows.length > 0 ? 'new_dictionary' : 'unknown',
    });
  } catch (error: any) {
    return NextResponse.json(
      { exists: false, error: error?.message || 'Check failed' },
      { status: 500 }
    );
  }
}
