#!/usr/bin/env node
/**
 * Build script: converts the Chuon Nath dictionary database into compact JSON
 * files consumed by the app.
 *
 *   Input  (data/raw/):
 *     khmer-dictionary.sqlite   lexicalentry / sense / synset / statement
 *                               (22,203 entries; committed to the repository)
 *     ipa_dic.txt               word<TAB>/ipa/  (downloaded from
 *                               interscript/khmer-dict-spice if missing)
 *
 *   Output (data/generated/):
 *     entries.json   [{ id, word, pos?, pron? }]   one per lexicalentry row
 *     defs.json      { [id]: definition }          senses joined by newlines,
 *                                                  examples on their own line
 *     ipa.json       { [word]: [ipa, ...] }
 *     meta.json      { entries, maxId, ipa, builtAt, source, license }
 *
 * Needs Node 22.5+ (node:sqlite).
 * Usage: node scripts/build-data.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rawDir = path.join(root, "data", "raw");
const outDir = path.join(root, "data", "generated");

const DB_NAME = "khmer-dictionary.sqlite";
const DB_PATH = path.join(rawDir, DB_NAME);
/** Marks a usage example line inside a definition. */
const EXAMPLE_LABEL = "ឧទាហរណ៍៖";
const RAW_BASE =
  "https://raw.githubusercontent.com/interscript/khmer-dict-spice/master/";
const RAW_FILES = [
  "ipa_dic.txt",
  "LICENSE",
];

async function ensureRaw() {
  fs.mkdirSync(rawDir, { recursive: true });
  for (const name of RAW_FILES) {
    const target = path.join(rawDir, name);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) continue;
    const url = RAW_BASE + name;
    process.stdout.write(`Downloading ${url} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log("done");
  }
}

/** Strip the key-only noise so `normalize` on both sides agrees. */
function stripInvisible(s) {
  return s.replace(/[​‌‍﻿]/g, "");
}

/**
 * The database stores the part of speech without dots ("កិវិ"); the app shows
 * it the way the dictionary prints it ("កិ. វិ.").
 */
const POS_PRINTED = {
  "កិវិ": "កិ. វិ.",
  "អានិ": "អា. និ.",
  "បសំ": "ប. សំ.",
  "កិនុ": "កិ. នុ.",
};

function printedPos(raw) {
  const pos = (raw ?? "").replace(/[\s.]+/g, "");
  if (!pos) return null;
  return POS_PRINTED[pos] ?? `${pos}.`;
}

/** Headword as typed in running text: "នែ !" and "អចិរ —" are listed with their punctuation. */
function cleanHeadword(raw) {
  return stripInvisible(raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\s!?—–-]+$/u, "")
    .trim();
}

function cleanText(raw) {
  return (raw ?? "").replace(/\r/g, "").trim();
}

/** "4728-10" -> 10, so senses come out in printed order rather than string order. */
function senseOrder(senseId) {
  const n = Number(String(senseId).split("-").pop());
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  await ensureRaw();
  fs.mkdirSync(outDir, { recursive: true });

  // ---- dictionary --------------------------------------------------------
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Missing ${path.relative(root, DB_PATH)}: copy the dictionary database there.`);
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const lexical = db
    .prepare("SELECT id, writtenForm, partOfSpeech, pronunciation FROM lexicalentry ORDER BY id")
    .all();
  const senseRows = db
    .prepare(
      `SELECT s.id AS senseId, s.lexicalEntryId AS entryId, y.definition, st.example
         FROM sense s
         JOIN synset y ON y.id = s.synsetid
         LEFT JOIN statement st ON st.synsetId = y.id`,
    )
    .all();
  db.close();

  const sensesOf = new Map();
  for (const row of senseRows) {
    const list = sensesOf.get(row.entryId);
    if (list) list.push(row);
    else sensesOf.set(row.entryId, [row]);
  }

  const entries = [];
  const defs = {};
  for (const row of lexical) {
    const id = Number(row.id);
    const word = cleanHeadword(row.writtenForm);
    if (!Number.isFinite(id) || !word) continue;

    const entry = { id, word };
    const pos = printedPos(row.partOfSpeech);
    if (pos) entry.pos = pos;
    const pron = cleanText(row.pronunciation);
    if (pron) entry.pron = pron;
    entries.push(entry);

    const senses = (sensesOf.get(id) ?? []).sort(
      (a, b) => senseOrder(a.senseId) - senseOrder(b.senseId),
    );
    const lines = [];
    for (const sense of senses) {
      const definition = cleanText(sense.definition);
      const example = cleanText(sense.example);
      if (definition) lines.push(definition);
      if (example) lines.push(`${EXAMPLE_LABEL} ${example}`);
    }
    defs[id] = lines.join("\n");
  }

  // ---- IPA ----------------------------------------------------------------
  const ipaRaw = fs.readFileSync(path.join(rawDir, "ipa_dic.txt"), "utf8");
  const ipa = {};
  for (const line of ipaRaw.split(/\r?\n/)) {
    const [w, p] = line.split("\t");
    if (!w || !p) continue;
    const word = stripInvisible(w).trim();
    const pron = p.trim();
    if (!word || !pron) continue;
    const list = (ipa[word] ??= []);
    if (!list.includes(pron)) list.push(pron);
  }

  // ---- write --------------------------------------------------------------
  const meta = {
    entries: entries.length,
    maxId: entries.reduce((m, e) => Math.max(m, e.id), 0),
    ipa: Object.keys(ipa).length,
    builtAt: new Date().toISOString(),
    source: `data/raw/${DB_NAME}`,
    license: "unknown",
  };
  const write = (name, data) => {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, JSON.stringify(data));
    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    console.log(`  wrote ${name.padEnd(14)} ${kb.padStart(7)} KB`);
  };
  console.log(`Entries: ${entries.length}, IPA: ${meta.ipa}`);
  write("entries.json", entries);
  write("defs.json", defs);
  write("ipa.json", ipa);
  write("meta.json", meta);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
