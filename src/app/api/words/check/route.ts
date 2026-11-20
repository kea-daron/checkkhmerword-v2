import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import fs from 'fs/promises';
import path from 'path';

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

  try {
    const csvPath = path.join(process.cwd(), 'data', 'raw', 'kh_dictionary.csv');
    const csvContent = await fs.readFile(csvPath, 'utf-8');
    const lines = csvContent.split(/\r?\n/);

    // ចាប់ផ្តើមពី i = 1 ដើម្បីរំលងជួរទី 1 (_id,word,definition)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const parts = line.split(',');
      // យកតែ Column ទី 2 (index 1) ដែលជា column "word"
      if (parts.length >= 2) {
        const clean = normalizeKhmer(parts[1]);
        if (clean) {
          words.add(clean);
        }
      }
    }
  } catch (err) {
    console.error('CSV load error:', err);
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