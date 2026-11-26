import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getStore } from '@/lib/dict/store';

let cachedBaseWords: Set<string> | null = null;

function normalizeKhmer(str: string): string {
  return str
    .replace(/[\u200B-\u200D\uFEFF"'\r\n]/g, '')
    .trim()
    .normalize('NFC');
}

async function getBaseWords(): Promise<Set<string>> {
  if (cachedBaseWords) return cachedBaseWords;
  const words = new Set<string>();

  // Headwords of the dictionary database (data/generated/entries.json,
  // built from data/raw/khmer-dictionary.sqlite by `npm run build:data`).
  try {
    for (const entry of getStore().entries) {
      const clean = normalizeKhmer(entry.word);
      if (clean) words.add(clean);
    }
  } catch (err) {
    console.error('Dictionary load error:', err);
  }

  cachedBaseWords = words;
  return cachedBaseWords;
}

export async function POST(req: Request) {
  try {
    const { word } = await req.json();
    const cleanWord = normalizeKhmer(word || '');
    if (!cleanWord) {
      return NextResponse.json({ exists: false, word: '' });
    }

    const baseWords = await getBaseWords();
    if (baseWords.has(cleanWord)) {
      return NextResponse.json({
        exists: true,
        word: cleanWord,
        dictSize: baseWords.size,
        source: 'dictionary',
      });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT 1 FROM kh_dictionary_new_word WHERE word = ${cleanWord} LIMIT 1
    `;

    return NextResponse.json({
      exists: rows.length > 0,
      word: cleanWord,
      dictSize: baseWords.size,
      source: rows.length > 0 ? 'new_dictionary' : 'unknown',
    });
  } catch (error: any) {
    return NextResponse.json(
      { exists: false, error: error?.message || 'Check failed' },
      { status: 500 }
    );
  }
}