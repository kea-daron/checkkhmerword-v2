import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import fs from 'fs/promises';
import path from 'path';

// សម្អាត Zero-Width Space (\u200B), BOM (\uFEFF), និងសញ្ញាអញ្ញប្រកាស
function normalizeKhmer(str: string): string {
  return str
    .replace(/[\u200B-\u200D\uFEFF"']/g, '')
    .trim()
    .normalize('NFC');
}

export async function POST(req: Request) {
  try {
    const { word } = await req.json();
    const cleanWord = normalizeKhmer(word || '');
    if (!cleanWord) {
      return NextResponse.json({ exists: false, word: '' });
    }

    const csvPath = path.join(process.cwd(), 'data', 'raw', 'kh_dictionary.csv');
    const csvContent = await fs.readFile(csvPath, 'utf-8');
    const baseWords = new Set(
      csvContent
        .split(/\r?\n/)
        .map((line) => normalizeKhmer(line.split(',')[0] || ''))
        .filter(Boolean)
    );

    if (baseWords.has(cleanWord)) {
      return NextResponse.json({ exists: true, word: cleanWord, source: 'dictionary' });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT 1 FROM kh_dictionary_new_word WHERE word = ${cleanWord} LIMIT 1
    `;

    return NextResponse.json({
      exists: rows.length > 0,
      word: cleanWord,
      source: rows.length > 0 ? 'new_dictionary' : 'unknown',
    });
  } catch (error: any) {
    return NextResponse.json(
      { exists: false, error: error?.message || 'Check failed' },
      { status: 500 }
    );
  }
}