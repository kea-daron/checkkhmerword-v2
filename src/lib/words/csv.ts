import fs from "fs/promises";
import path from "path";
import { normalizeKey } from "@/lib/khmer/normalize";

/**
 * File-backed word lists used by the n8n review automation
 * (/api/words/check, /api/words/verify-queue, /api/words/approve).
 *
 *   kh_dictionary.csv           _id,word,definition   read-only (Chuon Nath)
 *   kh_dictionary_new_word.csv  word                  approved additions
 *   kh_verify_word.csv          word,status           words awaiting review
 */
const RAW_DIR = path.join(process.cwd(), "data", "raw");
export const DICT_PATH = path.join(RAW_DIR, "kh_dictionary.csv");
export const NEW_WORD_PATH = path.join(RAW_DIR, "kh_dictionary_new_word.csv");
export const VERIFY_PATH = path.join(RAW_DIR, "kh_verify_word.csv");

const NEW_WORD_HEADER = "word";
const VERIFY_HEADER = "word,status";
const MAX_WORD_LENGTH = 100;

/** Trimmed word from a request body, or null when it is not usable. */
export function cleanWord(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const word = input.trim();
  if (!word || word.length > MAX_WORD_LENGTH || /[\r\n]/.test(word)) return null;
  return word;
}

/** Comparison key: the same spelling normalization the spell checker uses. */
export function wordKey(word: string): string {
  return normalizeKey(word) || word.trim();
}

/** First `count` fields of one CSV line, honouring double-quoted fields. */
function parseFields(line: string, count: number): string[] {
  const fields: string[] = [];
  let i = 0;
  while (fields.length < count && i <= line.length) {
    let value = "";
    if (line[i] === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] !== '"') break;
          value += '"';
          i += 2;
        } else {
          value += line[i++];
        }
      }
      i = line.indexOf(",", i);
      if (i === -1) i = line.length;
    } else {
      const end = line.indexOf(",", i);
      value = line.slice(i, end === -1 ? line.length : end);
      i = end === -1 ? line.length : end;
    }
    fields.push(value.trim());
    i++; // skip the comma
  }
  return fields;
}

function csvField(value: string): string {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function readLines(file: string): Promise<string[]> {
  const content = await fs.readFile(file, "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "";
    throw err;
  });
  return content.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
}

/** Replace a file's contents without ever leaving it half-written. */
async function writeAtomic(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, file);
}

// The main dictionary is large and never written by these routes, so its keys
// are cached until the file changes on disk.
let dictCache: { mtimeMs: number; keys: Set<string> } | null = null;

async function dictionaryKeys(): Promise<Set<string>> {
  const { mtimeMs } = await fs.stat(DICT_PATH);
  if (dictCache?.mtimeMs === mtimeMs) return dictCache.keys;
  const keys = new Set<string>();
  // Line 0 is the `_id,word,definition` header; the word is the second column.
  for (const line of (await readLines(DICT_PATH)).slice(1)) {
    const word = parseFields(line, 2)[1];
    if (word) keys.add(wordKey(word));
  }
  dictCache = { mtimeMs, keys };
  return keys;
}

async function readNewWords(): Promise<string[]> {
  const words = (await readLines(NEW_WORD_PATH)).map((line) => parseFields(line, 1)[0]);
  return words.filter((word, i) => word && !(i === 0 && word === NEW_WORD_HEADER));
}

export type QueueEntry = { word: string; status: string };

export async function readQueue(): Promise<QueueEntry[]> {
  const rows = (await readLines(VERIFY_PATH)).map((line) => parseFields(line, 2));
  return rows
    .filter(([word], i) => word && !(i === 0 && word === "word"))
    .map(([word, status]) => ({ word, status: status || "pending" }));
}

function serializeQueue(entries: QueueEntry[]): string {
  const rows = entries.map((e) => `${csvField(e.word)},${csvField(e.status)}`);
  return [VERIFY_HEADER, ...rows].join("\n") + "\n";
}

/** Where a word is already known: the main dictionary, the approved list, or neither. */
export async function findWord(word: string): Promise<"dictionary" | "new_word" | null> {
  const key = wordKey(word);
  if ((await dictionaryKeys()).has(key)) return "dictionary";
  if ((await readNewWords()).some((w) => wordKey(w) === key)) return "new_word";
  return null;
}

// n8n sends one request per word, often in parallel. Every read-modify-write
// goes through this chain so two requests cannot clobber each other's change.
let writeChain: Promise<unknown> = Promise.resolve();

function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

/** Add a word to the review queue. Returns false when it was already queued. */
export function enqueueWord(word: string, status: string): Promise<boolean> {
  return withWriteLock(async () => {
    const queue = await readQueue();
    const key = wordKey(word);
    if (queue.some((e) => wordKey(e.word) === key)) return false;
    queue.push({ word, status });
    await writeAtomic(VERIFY_PATH, serializeQueue(queue));
    return true;
  });
}

/**
 * Move a word from the review queue to the approved list. `wasPending` tells
 * whether it was in the queue; `added` is false when a dictionary already had it.
 */
export function approveWord(word: string): Promise<{ wasPending: boolean; added: boolean }> {
  return withWriteLock(async () => {
    const key = wordKey(word);
    const added = (await findWord(word)) === null;
    // Write the approved list first: if the second write fails, the word is in
    // both files (harmless) rather than in neither.
    if (added) {
      const words = [...(await readNewWords()), word];
      await writeAtomic(NEW_WORD_PATH, [NEW_WORD_HEADER, ...words.map(csvField)].join("\n") + "\n");
    }
    const queue = await readQueue();
    const remaining = queue.filter((e) => wordKey(e.word) !== key);
    const wasPending = remaining.length !== queue.length;
    if (wasPending) await writeAtomic(VERIFY_PATH, serializeQueue(remaining));
    return { wasPending, added };
  });
}
