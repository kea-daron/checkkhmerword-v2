import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  const { word } = await req.json();
  const cleanWord = word?.trim();
  if (!cleanWord) return NextResponse.json({ exists: false });

  const csvPath = path.join(process.cwd(), 'data', 'raw', 'kh_dictionary.csv');
  const csvContent = await fs.readFile(csvPath, 'utf-8');
  const baseWords = new Set(
    csvContent.split(/\r?\n/).map((line) => line.split(',')[0]?.trim()).filter(Boolean)
  );

  if (baseWords.has(cleanWord)) {
    return NextResponse.json({ exists: true });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT 1 FROM kh_dictionary_new_word WHERE word = ${cleanWord} LIMIT 1`;

  return NextResponse.json({ exists: rows.length > 0 });
}