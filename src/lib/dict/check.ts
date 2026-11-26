import "server-only";
import { KHMER_DIGIT, hasKhmer, isKhmerWord, normalizeKey, toCodePoints } from "@/lib/khmer/normalize";
import { getStore } from "./store";
import { getCorrections } from "@/lib/khmerdict/store";
import { completions, prefixes, suggest, toClusters, toSkeleton } from "./suggest";
import { checkGrammar } from "@/lib/grammar";
import { biCount, getPhraseStore, uniCount } from "@/lib/context/store";
import type { CheckPart, CheckResponse, CheckSummary, CheckToken, GrammarIssue, Suggestion } from "./types";

const MAX_TEXT = 5000;
const MAX_MERGE = 3;
const MAX_PARTS = 4;
const MAX_DP_LENGTH = 60; // code points
const MAX_PART_LENGTH = 14; // code points
const MAX_RUN_SUGGEST = 16; // code points
const MAX_WINDOW_SIDE = 2; // known neighbours an unknown stretch may be re-split with, per side
/** Occurrences in the reference texts (≈2.1M words) from which a short word is a common word that stands on its own. */
const COMMON_WORD = 3000;

/**
 * A frequent short word (ថា, ពី, ទី, នៅ, បាន …) is never treated as a fragment
 * of a misspelt neighbour. Without the phrase statistics every word counts as
 * uncommon, which is the checker's historical behaviour.
 */
function isCommonWord(text: string): boolean {
  const s = getPhraseStore();
  return s !== null && uniCount(s, normalizeKey(text)) >= COMMON_WORD;
}

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter {
  return (segmenter ??= new Intl.Segmenter("km", { granularity: "word" }));
}

/** Normalized keys of the approved words for the check in progress (set by `checkText`, which is synchronous). */
let approvedKeys: ReadonlySet<string> = new Set();

type Raw = { text: string; kind: CheckToken["kind"] };
type Unit = { text: string; status: "dict" | "unknown"; ids?: number[] };

/** A range of offsets into a text: [start, end). */
type Span = [number, number];

/** A segment of at least this many clusters can be a word the segmenter itself knows, not a shard of unknown text. */
const MIN_WHOLE_CLUSTERS = 3;

/**
 * An unknown segment that is a word in the segmenter's own lexicon: a natural
 * word boundary, so it is judged whole and no known word is carved out of it
 * (សហគមន៍, never សហ + គមន៍). Next to unknown text the segmenter also emits
 * shards, the last consonant of one word stuck to the next (ប៉ូលី|សមួយ): a
 * lone consonant followed by a known word is one of those, not a word.
 */
function isWholeWord(text: string): boolean {
  const clusters = toClusters(text);
  if (clusters.length < MIN_WHOLE_CLUSTERS) return false;
  if (isLoneConsonant(clusters[0]) && lookup(normalizeKey(clusters.slice(1).join("")))) return false;
  return dpCover(text) === null;
}

function classify(seg: Intl.SegmentData): Raw {
  const text = seg.segment;
  if (!seg.isWordLike) {
    // Zero-width spaces are commonly typed between Khmer words; treat them as spaces.
    if (/^[\s​‌‍﻿]+$/.test(text)) return { text, kind: "space" };
    return { text, kind: "punct" };
  }
  if (KHMER_DIGIT.test(text) || !hasKhmer(text)) return { text, kind: "other" };
  if (!isKhmerWord(text)) return { text, kind: "other" };
  return { text, kind: "word" };
}

/**
 * Look a normalized key up in the Chuon Nath dictionary and the approved
 * words (see `checkText`), the only word lists the checker accepts. The sign ៗ repeats the word before it (សាមញ្ញៗ = សាមញ្ញ
 * សាមញ្ញ), so a known word keeps its status with ៗ attached.
 */
function lookup(key: string): { status: "dict"; ids?: number[] } | null {
  const ids = getStore().byKey.get(key);
  if (ids) return { status: "dict", ids };
  // An approved word has no dictionary entry, so no ids.
  if (approvedKeys.has(key)) return { status: "dict" };
  // The repetition sign standing alone (after a space) is punctuation, not a misspelt word.
  if (key === "ៗ") return { status: "dict" };
  if (key.length > 1 && key.endsWith("ៗ")) return lookup(key.slice(0, -1));
  return null;
}

function classifyWord(text: string): Unit {
  const found = lookup(normalizeKey(text));
  return found ? { text, ...found } : { text, status: "unknown" };
}

const isIndependentVowel = (cp: number) => cp >= 0x17a3 && cp <= 0x17b3;

/** Cost of one part in a segmentation: very short parts carry a small penalty so splits are not made frivolously. */
function partCost(len: number): number {
  return len <= 2 ? 1.15 : 1;
}

/**
 * Cover `text` with known words using dynamic programming (minimum `partCost`).
 * Parts must be at least two code points, or a single independent vowel, so a
 * misspelt word cannot be "explained" as a string of single letters.
 */
function dpCover(text: string): { parts: Unit[]; cost: number } | null {
  const cps = [...text];
  const n = cps.length;
  if (n === 0 || n > MAX_DP_LENGTH) return null;

  type Cell = { cost: number; from: number; unit: Unit };
  const best = new Array<Cell | null>(n + 1).fill(null);
  best[0] = { cost: 0, from: 0, unit: { text: "", status: "dict" } };

  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - MAX_PART_LENGTH); j < i; j++) {
      const prev = best[j];
      if (!prev) continue;
      const len = i - j;
      if (len < 2 && !isIndependentVowel(cps[j].codePointAt(0)!)) continue;
      const chunk = cps.slice(j, i).join("");
      const key = normalizeKey(chunk);
      if (!key) continue;
      const found = lookup(key);
      if (!found) continue;
      const unit: Unit = { text: chunk, ...found };
      const total = prev.cost + partCost(len);
      const cur = best[i];
      if (!cur || total < cur.cost) best[i] = { cost: total, from: j, unit };
    }
  }

  const end = best[n];
  if (!end) return null;
  const parts: Unit[] = [];
  let i = n;
  while (i > 0) {
    const c = best[i]!;
    parts.unshift(c.unit);
    i = c.from;
  }
  return { parts, cost: end.cost };
}

function toPart(p: Unit): CheckPart {
  return { text: p.text, status: "dict", ids: p.ids };
}

function toTokens(u: Unit): CheckToken[] {
  if (u.status === "dict") return [{ text: u.text, kind: "word", status: "dict", ids: u.ids }];
  return unknownTokens(u.text);
}

/**
 * An unknown stretch that splits exactly into known words (e.g. ជា + ទេ) is a
 * compound, not a misspelling, unless some headword is a single edit away:
 * a one-letter slip (កំពង -> កំពុង) is likelier than a chance compound.
 */
const coverBeatsTypo = (text: string) => coverBeatingTypo(text) !== null;

/** The parts of that cover, or null when there is none or a one-letter slip is likelier. */
function coverBeatingTypo(text: string): Unit[] | null {
  const cover = dpCover(text);
  if (!cover || cover.parts.length < 2 || cover.parts.length > MAX_PARTS) return null;
  const close = closeHeadwords(text, 1);
  if (!close.length) return cover.parts;
  // A headword that is just this text minus one of its parts (ឬមិន -> មិន)
  // is no evidence of a slip: the dropped part is a word in its own right.
  const minusOnePart = new Set(
    cover.parts.map((_, i) =>
      normalizeKey(
        cover.parts
          .filter((__, j) => j !== i)
          .map((p) => p.text)
          .join(""),
      ),
    ),
  );
  return close.every((g) => minusOnePart.has(normalizeKey(g.word))) ? cover.parts : null;
}

function bestDistance(list: Suggestion[]): number {
  return list.reduce((m, x) => Math.min(m, x.distance), Infinity);
}

const MAX_SUGGESTIONS = 6;

/**
 * What the user may have meant by `text`: known words it begins with, known
 * words that begin with it, and close lookalikes, nearest first.
 */
function suggestionsFor(text: string, fuzzy: Suggestion[]): Suggestion[] {
  const key = normalizeKey(text);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const g of [...completions(key), ...prefixes(key), ...fuzzy, ...prefixSplitFixes(key)]) {
    if (seen.has(g.word)) continue;
    seen.add(g.word);
    out.push(g);
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, MAX_SUGGESTIONS);
}

/**
 * A known word followed by a misspelt one, glued together: គោលបំនង is គោល +
 * បំនង, and បំនង is one edit from បំណង, so offer គោលបំណង. Only a rest long
 * enough to be a word of its own (more than SHORT_PART code points) counts,
 * so ក្រៅពីន is not read as ក្រៅ + a slip for ពីរ. `key` must be normalized.
 */
function prefixSplitFixes(key: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of prefixes(key)) {
    const head = normalizeKey(p.word);
    if (!key.startsWith(head)) continue;
    const rest = key.slice(head.length);
    if (toCodePoints(rest).length <= SHORT_PART) continue;
    const fixes = closeHeadwords(rest, 1).map((fix) => ({ word: p.word + fix.word, distance: fix.distance }));
    // Every lookalike of the rest would make a composite; keep the ones that
    // are themselves known words (គោលបំណង), else only the rest's best match.
    const known = fixes.filter((g) => lookup(normalizeKey(g.word)));
    out.push(...(known.length ? known : fixes.slice(0, 1)));
  }
  return out;
}

const SHORT_PART = 3; // code points
const isShort = (t: string) => toCodePoints(t).length <= SHORT_PART;

/**
 * Two adjacent short parts of a cover that, joined, are one edit from a
 * headword are more likely that word misspelt than two tiny words in a row
 * (ការ + សរ + សើ -> ការ + សរសើរ). Returns the index of the first part.
 */
function suspiciousPair(parts: Unit[]): { index: number; close: Suggestion[] } | null {
  for (let i = 0; i + 1 < parts.length; i++) {
    const a = parts[i].text;
    const b = parts[i + 1].text;
    if (toCodePoints(a).length > SHORT_PART || toCodePoints(b).length > SHORT_PART) continue;
    // ពី + ទី are two common words in a row, not a slip for ពីសី.
    if (isCommonWord(a) || isCommonWord(b)) continue;
    const own = new Set([normalizeKey(a), normalizeKey(b)]);
    const close = closeHeadwords(a + b, 1).filter((g) => !own.has(normalizeKey(g.word)));
    if (close.length) return { index: i, close };
  }
  return null;
}

/** A pair's candidate must be seen this many times more often than the written pair, and at least this often. */
const KNOWN_PAIR_RATIO = 10;
const KNOWN_PAIR_MIN_COUNT = 20;

/**
 * Like suspiciousPair, for a run where every piece is a known word: ICU cuts
 * ចំនាយ into ចំ + នាយ, two dictionary words, so no part is unknown, yet the
 * texts use ចំណាយ hundreds of times and the pair ចំ នាយ almost never. Only
 * with the phrase statistics, and only when both pieces are tiny, uncommon
 * words and their join is not itself a known word.
 */
function suspiciousKnownPair(parts: Unit[]): { index: number; close: Suggestion[] } | null {
  const s = getPhraseStore();
  if (!s) return null;
  for (let i = 0; i + 1 < parts.length; i++) {
    const a = parts[i].text;
    const b = parts[i + 1].text;
    const la = toCodePoints(a).length;
    const lb = toCodePoints(b).length;
    // One-letter pieces are too common a cut (នំខេក -> ខេ|ក, a loanword) to judge.
    if (la < 2 || lb < 2 || la > SHORT_PART || lb > SHORT_PART) continue;
    if (isCommonWord(a) || isCommonWord(b)) continue;
    const ka = normalizeKey(a);
    const kb = normalizeKey(b);
    if (lookup(ka + kb)) continue;
    // The pair may be the tail or head of a longer word ICU cut through
    // (ជាប់ពន្ធ|នា|គារ is ពន្ធនាគារ): then the pair itself is not the problem.
    if (extendsIntoNeighbour(parts[i - 1]?.text, ka + kb, parts[i + 2]?.text)) continue;
    const written = biCount(s, ka, kb);
    const own = new Set([ka, kb]);
    const length = toCodePoints(ka + kb).length;
    const close = closeHeadwords(a + b, 1).filter((g) => {
      const k = normalizeKey(g.word);
      // Only a letter swapped for another (ន/ណ, រ/ល): a dropped or added letter
      // is too easily matched by chance in text that is otherwise all known.
      if (own.has(k) || toCodePoints(k).length !== length) return false;
      const seen = uniCount(s, k);
      return seen >= KNOWN_PAIR_MIN_COUNT && seen >= KNOWN_PAIR_RATIO * Math.max(1, written);
    });
    if (close.length) return { index: i, close };
  }
  return null;
}

/** Some tail of `before` + `key`, or `key` + some head of `after`, is a known word (cuts on cluster boundaries). */
function extendsIntoNeighbour(before: string | undefined, key: string, after: string | undefined): boolean {
  if (before) {
    const c = toClusters(normalizeKey(before));
    for (let i = c.length - 1; i >= 0; i--) if (lookup(c.slice(i).join("") + key)) return true;
  }
  if (after) {
    const c = toClusters(normalizeKey(after));
    for (let i = 1; i <= c.length; i++) if (lookup(key + c.slice(0, i).join(""))) return true;
  }
  return false;
}

/** How many trailing clusters of the word before may be handed to the unknown stretch after it. */
const MAX_SHIFT = 2;

/**
 * A misspelt word can end in letters that, with the start of the next word,
 * happen to form another headword: បំផុ|សម្រាប់ is cut as បំផុស + ម្រាប់, and the
 * blame lands on the innocent second word. When giving the last cluster(s) of
 * the known word back to the unknown stretch makes a known word, and what is
 * left is one edit from a headword the texts often put right before it
 * (បំផុត សម្រាប់), the slip is in the first word. Needs the phrase statistics.
 */
function shiftedBoundary(prev: string, rest: string): { head: string; fixes: Suggestion[]; tail: Unit } | null {
  const s = getPhraseStore();
  if (!s) return null;
  const clusters = toClusters(prev);
  for (let k = 1; k <= MAX_SHIFT && k < clusters.length; k++) {
    const head = clusters.slice(0, clusters.length - k).join("");
    const tail = classifyWord(clusters.slice(clusters.length - k).join("") + rest);
    if (tail.status === "unknown" || lookup(normalizeKey(head))) continue;
    const tailKey = normalizeKey(tail.text);
    const written = biCount(s, normalizeKey(prev), tailKey);
    const min = Math.max(KNOWN_PAIR_MIN_COUNT, KNOWN_PAIR_RATIO * Math.max(1, written));
    const fixes = rankedByCount(closeHeadwords(head, 1), (k) => biCount(s, k, tailKey), min);
    if (fixes.length) return { head, fixes, tail };
  }
  return null;
}

/** The suggestions whose normalized word `count` puts at `min` or more, highest count first. */
function rankedByCount(list: Suggestion[], count: (key: string) => number, min: number): Suggestion[] {
  return list
    .map((g) => ({ g, n: count(normalizeKey(g.word)) }))
    .filter((x) => x.n >= min)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.g);
}

/**
 * Headwords one edit from an unknown stretch that the texts often put right
 * after the word before it, or right before the word after it (មាន + ភា:
 * មាន ភាព occurs hundreds of times). Most frequent first. Needs the phrase statistics.
 */
function neighbourFixes(prev: string | undefined, text: string, next: string | undefined): Suggestion[] {
  const s = getPhraseStore();
  if (!s) return [];
  const pk = prev ? normalizeKey(prev) : null;
  const nk = next ? normalizeKey(next) : null;
  const seen = (k: string) => Math.max(pk ? biCount(s, pk, k) : 0, nk ? biCount(s, k, nk) : 0);
  return rankedByCount(closeHeadwords(text, 1), seen, KNOWN_PAIR_MIN_COUNT);
}

function unknownTokens(text: string, whole: Span[] = []): CheckToken[] {
  const cover = dpCover(text);
  if (cover && cover.parts.length >= 2 && cover.parts.length <= MAX_PARTS) {
    const pair = suspiciousPair(cover.parts);
    if (pair) {
      const { index, close } = pair;
      const joined = cover.parts[index].text + cover.parts[index + 1].text;
      return [
        ...cover.parts.slice(0, index).flatMap(toTokens),
        { text: joined, kind: "word", status: "unknown", suggestions: suggestionsFor(joined, close) },
        ...cover.parts.slice(index + 2).flatMap(toTokens),
      ];
    }
    return [{ text, kind: "word", status: "compound", parts: cover.parts.map(toPart) }];
  }
  // No cover and nothing close: often a foreign name ICU cut together with the words around it
  // (កូ|រ៉ូ|សបា|នកា|ត់ is កូរ៉ូស + បាន + កាត់). Give the common words back; only the rest is unknown.
  const pieces = splitOffCommonWords(text, whole);
  if (pieces) return pieces.flatMap((p) => (p.known ? toTokens(classifyWord(p.text)) : [plainUnknown(p.text)]));
  return [plainUnknown(text)];
}

function plainUnknown(text: string): CheckToken {
  const key = normalizeKey(text);
  const fuzzy = toCodePoints(key).length >= 2 ? suggest(key, 5) : [];
  return { text, kind: "word", status: "unknown", suggestions: suggestionsFor(text, fuzzy) };
}

/** A word of two syllables or more is trusted from this many occurrences; a one-syllable word must be a common word. */
const FREQUENT_WORD = 300;

/** Cost of leaving one syllable unexplained, against 1 for a common word. */
const UNKNOWN_CLUSTER_COST = 3;

/**
 * Cut `text` into frequent known words and unexplained rests, cheapest first
 * (dynamic programming over syllable boundaries). Only words the texts use
 * often count, so a name is not shredded into chance headwords. Returns null
 * when no common word is found inside, or without the phrase statistics.
 */
/**
 * `whole`: ranges of `text` that are words by the segmenter's own boundaries
 * (see `isWholeWord`); no known word is taken from inside one.
 */
function splitOffCommonWords(text: string, whole: Span[] = []): { text: string; known: boolean }[] | null {
  const s = getPhraseStore();
  if (!s) return null;
  const clusters = toClusters(text);
  const n = clusters.length;
  if (n < 2 || text.length > MAX_DP_LENGTH) return null;
  type Cell = { cost: number; from: number; known: boolean };
  const best: Cell[] = [{ cost: 0, from: 0, known: false }];
  /** Offset in `text` at which each cluster starts. */
  const at: number[] = [0];
  for (const c of clusters) at.push(at[at.length - 1] + c.length);
  for (let i = 1; i <= n; i++) {
    best[i] = { cost: best[i - 1].cost + UNKNOWN_CLUSTER_COST, from: i - 1, known: false };
    for (let j = Math.max(0, i - MAX_PART_LENGTH); j < i; j++) {
      const chunk = clusters.slice(j, i).join("");
      if (toCodePoints(chunk).length < 2) continue;
      if (whole.some(([a, b]) => at[j] < b && a < at[i])) continue;
      const key = normalizeKey(chunk);
      if (uniCount(s, key) < (i - j >= 2 ? FREQUENT_WORD : COMMON_WORD) || !lookup(key)) continue;
      const cost = best[j].cost + 1;
      if (cost < best[i].cost) best[i] = { cost, from: j, known: true };
    }
  }
  const out: { text: string; known: boolean }[] = [];
  for (let i = n; i > 0; ) {
    const c = best[i];
    const piece = clusters.slice(c.from, i).join("");
    if (!c.known && out[0] && !out[0].known) out[0].text = piece + out[0].text;
    else out.unshift({ text: piece, known: c.known });
    i = c.from;
  }
  return out.some((p) => p.known) && out.some((p) => !p.known) ? out : null;
}

/**
 * Resolve a run of adjacent Khmer word tokens (no spaces or punctuation between them).
 */
function resolveRun(tokens: string[]): CheckToken[] {
  // 1. Merge adjacent tokens when the concatenation is itself a headword.
  const merged: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    let took = 1;
    let joined = tokens[i];
    for (let k = 2; k <= MAX_MERGE && i + k - 1 < tokens.length; k++) {
      joined += tokens[i + k - 1];
      if (lookup(normalizeKey(joined))) took = k;
    }
    merged.push(tokens.slice(i, i + took).join(""));
    i += took;
  }

  const runText = merged.join("");
  // The whole run is one known word, however ICU cut it.
  const wholeRun = classifyWord(runText);
  if (merged.length > 1 && wholeRun.status === "dict") return toTokens(wholeRun);

  const units = merged.map(classifyWord);
  const hasUnknown = units.some((u) => u.status === "unknown");

  // 2. Everything is known: keep ICU's segmentation, unless two tiny pieces
  //    in a row are a misspelt word the texts know far better (ចំ|នាយ -> ចំណាយ).
  if (!hasUnknown) {
    const pair = suspiciousKnownPair(units);
    if (!pair) return units.flatMap(toTokens);
    const { index, close } = pair;
    const joined = units[index].text + units[index + 1].text;
    return [
      ...units.slice(0, index).flatMap(toTokens),
      { text: joined, kind: "word", status: "unknown", suggestions: suggestionsFor(joined, close) },
      ...units.slice(index + 2).flatMap(toTokens),
    ];
  }

  // 3. A short run with something unknown may be one misspelt word that ICU
  //    shattered: look for a close dictionary headword for the whole run. Keep
  //    the known neighbours intact, though, when an unknown part explains
  //    itself at least as well on its own (ក្រៅ|ពីន is ក្រៅ + a slip, not ក្រពេន).
  const runLen = toCodePoints(runText).length;
  if (runLen <= MAX_RUN_SUGGEST && merged.length <= 4) {
    const close = closeHeadwords(runText, runLen <= 4 ? 1 : 2);
    if (close.length) {
      const dRun = bestDistance(close);
      const partExplainsItself = units.some(
        (u) => u.status === "unknown" && (coverBeatsTypo(u.text) || bestDistance(closeHeadwords(u.text)) < dRun),
      );
      if (!partExplainsItself) return [{ text: runText, kind: "word", status: "unknown", suggestions: suggestionsFor(runText, close) }];
    }
  }

  // 4. General case: group known stretches and unknown stretches.
  //    An unknown stretch may absorb one known neighbour when the combination is
  //    within edit distance 1 of a headword (e.g. "វចនា|នុក្|រុម" -> "វចនានុក្រុម").
  //    `ranked` suggestions are already in their final order.
  type Group = { kind: "known"; units: Unit[] } | { kind: "unknown"; text: string; suggestions: Suggestion[]; ranked?: boolean; whole?: Span[] };
  const groups: Group[] = [];
  let i = 0;
  while (i < units.length) {
    if (units[i].status !== "unknown") {
      const last = groups[groups.length - 1];
      if (last && last.kind === "known") last.units.push(units[i]);
      else groups.push({ kind: "known", units: [units[i]] });
      i++;
      continue;
    }
    let j = i;
    while (j < units.length && units[j].status === "unknown") j++;

    const text = (a: number, b: number) => units.slice(a, b).map((u) => u.text).join("");

    // ICU can cut a known word into more pieces than step 1 rejoins (a loanword
    // like វេបសាយ): the stretch as a whole is that word.
    const whole = classifyWord(text(i, j));
    if (whole.status === "dict") {
      const last = groups[groups.length - 1];
      if (last && last.kind === "known") last.units.push(whole);
      else groups.push({ kind: "known", units: [whole] });
      i = j;
      continue;
    }

    // An exact split into known words beats any fuzzy lookalike.
    if (coverBeatsTypo(text(i, j))) {
      groups.push({ kind: "unknown", text: text(i, j), suggestions: [] });
      i = j;
      continue;
    }
    // Several segments in a row, each a compound of known words on its own
    // (អ្នកនាង|សុភាពរាបសារ): the segmenter's boundaries stand, one compound each.
    if (j - i > 1 && units.slice(i, j).every((u) => coverBeatsTypo(u.text))) {
      for (const u of units.slice(i, j)) groups.push({ kind: "unknown", text: u.text, suggestions: [] });
      i = j;
      continue;
    }
    const tryWindow = (a: number, b: number, maxDistance?: number): Suggestion[] => {
      const t = text(a, b);
      if (toCodePoints(t).length > MAX_RUN_SUGGEST) return [];
      return closeHeadwords(t, maxDistance);
    };

    const prevGroup = groups[groups.length - 1];
    const canLeft = prevGroup?.kind === "known" && prevGroup.units.length > 0;
    const canRight = j < units.length;
    /** The known word right before this stretch. Every branch below that changes `prevGroup` moves on to the next stretch. */
    const prevUnit = canLeft ? prevGroup.units[prevGroup.units.length - 1] : undefined;
    /** Take `count` known words back from the group before this stretch. */
    const takeLeft = (count: number) => {
      if (count <= 0 || prevGroup?.kind !== "known") return;
      prevGroup.units.splice(prevGroup.units.length - count, count);
      if (prevGroup.units.length === 0) groups.pop();
    };

    // ICU's boundaries are unreliable: the stretch may split cleanly into
    // known words only together with its neighbours (សួ|រសាម|ញ្ញៗ -> សួរ + សាមញ្ញៗ,
    // ជាស|មា|ជិ|ក -> ជា + សមាជិក). Try the smallest window first, up to two
    // known words on either side.
    const maxLeft = canLeft ? Math.min(MAX_WINDOW_SIDE, prevGroup.units.length) : 0;
    let maxRight = 0;
    while (maxRight < MAX_WINDOW_SIDE && j + maxRight < units.length && units[j + maxRight].status !== "unknown") maxRight++;
    const windows: [number, number][] = [];
    for (let size = 1; size <= maxLeft + maxRight; size++) {
      for (let l = Math.min(size, maxLeft); l >= 0 && size - l <= maxRight; l--) windows.push([i - l, j + size - l]);
    }
    // A window cover that cuts a common neighbour into rarer words (មាន|ភា -> មា + នភា) loses to a
    // one-letter fix of the stretch that the texts often put next to that neighbour (មាន ភាព).
    let fixes: Suggestion[] | undefined;
    const breaksCommonWord = (cover: Unit[], a: number, b: number) => {
      fixes ??= neighbourFixes(prevUnit?.text, text(i, j), canRight ? units[j].text : undefined);
      if (!fixes.length) return false;
      const parts = cover.map((p) => normalizeKey(p.text));
      // The cover already contains the fix (ពីរ|ដ្ឋ -> ពី + រដ្ឋ): it is the right reading.
      if (fixes.some((g) => parts.includes(normalizeKey(g.word)))) return false;
      // Broken: no part of the cover holds the neighbour whole (មួយ inside មួយៗ is intact).
      return [...units.slice(a, i), ...units.slice(j, b)].some((u) => isCommonWord(u.text) && !parts.some((k) => k.includes(normalizeKey(u.text))));
    };
    let covered: [number, number] | undefined;
    for (const [a, b] of windows) {
      const cover = coverBeatingTypo(text(a, b));
      if (cover && !breaksCommonWord(cover, a, b)) {
        covered = [a, b];
        break;
      }
    }
    if (covered) {
      const [a, b] = covered;
      takeLeft(i - a);
      groups.push({ kind: "unknown", text: text(a, b), suggestions: [] });
      i = b;
      continue;
    }
    // Every cover found broke a common word (so `fixes` was computed, and is not empty).
    if (fixes?.length) {
      groups.push({ kind: "unknown", text: text(i, j), suggestions: fixes, ranked: true });
      i = j;
      continue;
    }

    // The word before may have taken this stretch's first letters
    // (បំផុស|ម្រាប់ is បំផុ + សម្រាប់): then the slip is in that word.
    if (prevUnit) {
      const shifted = shiftedBoundary(prevUnit.text, text(i, j));
      if (shifted) {
        takeLeft(1);
        groups.push({ kind: "unknown", text: shifted.head, suggestions: shifted.fixes, ranked: true });
        groups.push({ kind: "known", units: [shifted.tail] });
        i = j;
        continue;
      }
    }

    // The word before plus this stretch may be the start of a longer known
    // form (ក្រៅ|ពីន -> ក្រៅពី, ក្រៅពីនោះ): then offer those for the whole. Only
    // for a stretch short enough to be one word, not a phrase with a name in it.
    if (prevUnit && toCodePoints(prevUnit.text + text(i, j)).length <= MAX_RUN_SUGGEST) {
      const combined = prevUnit.text + text(i, j);
      const key = normalizeKey(combined);
      const prevLen = toCodePoints(normalizeKey(prevUnit.text)).length;
      const longer = prefixes(key).filter((g) => toCodePoints(normalizeKey(g.word)).length > prevLen);
      if (longer.length) {
        takeLeft(1);
        groups.push({ kind: "unknown", text: combined, suggestions: suggestionsFor(combined, suggest(key, 5, 1)) });
        i = j;
        continue;
      }
    }

    /** The whole words (see `isWholeWord`) among units [a, b), as ranges of their joined text. */
    const wholeWords = (a: number, b: number): Span[] => {
      const spans: Span[] = [];
      let pos = 0;
      for (const u of units.slice(a, b)) {
        const end = pos + u.text.length;
        if (u.status === "unknown" && isWholeWord(u.text)) spans.push([pos, end]);
        pos = end;
      }
      return spans;
    };

    let from = i;
    let to = j;
    let suggestions = tryWindow(i, j);
    const absorb = (a: number, b: number) => {
      const s = tryWindow(a, b, 1);
      if (!s.length) return false;
      suggestions = s;
      from = a;
      to = b;
      return true;
    };
    // A tiny fragment (ICU rarely produces real words of this size) that the
    // texts seldom use on its own, next to an unknown stretch.
    const isFragment = (t: string) => toCodePoints(t).length <= SHORT_PART && getPhraseStore() !== null && !isCommonWord(t);
    const prevFragment = prevUnit !== undefined && isFragment(prevUnit.text);
    const nextFragment = canRight && isFragment(units[j].text);
    // Two tiny fragments in a row (គំ|និ) are likelier one misspelt word
    // (គំនិត) than a tiny word followed by a slip (គំ + និង), even when the
    // fragment alone is also one edit from some headword. A common word
    // (សាស|នៅ) is left alone: it is not a fragment.
    if (isShort(text(i, j)) && ((prevFragment && absorb(i - 1, j)) || (nextFragment && absorb(i, j + 1)))) {
      /* joined with a short neighbour */
    } else if (bestDistance(suggestions) > 1) {
      // Nothing within one edit on its own: a neighbour may be the rest of the
      // word ICU split off (វចនា|នុក្រុម -> វចនានុក្រម).
      if (canLeft && absorb(i - 1, j)) {
        /* took the word before */
      } else if (canRight && absorb(i, j + 1)) {
        /* took the word after */
      } else if (canLeft && canRight) absorb(i - 1, j + 1);
    }
    takeLeft(i - from);
    groups.push({ kind: "unknown", text: text(from, to), suggestions, whole: wholeWords(from, to) });
    i = to;
  }

  const out: CheckToken[] = [];
  for (const g of groups) {
    if (g.kind === "known") out.push(...g.units.flatMap(toTokens));
    else if (g.ranked) out.push({ text: g.text, kind: "word", status: "unknown", suggestions: g.suggestions });
    else if (g.suggestions.length) out.push({ text: g.text, kind: "word", status: "unknown", suggestions: suggestionsFor(g.text, g.suggestions) });
    else out.push(...unknownTokens(g.text, g.whole));
  }
  return out;
}

/** Dictionary headwords (only) within edit distance of `text`. */
function closeHeadwords(text: string, maxDistance?: number): Suggestion[] {
  const key = normalizeKey(text);
  if (toCodePoints(key).length < 2) return [];
  return suggest(key, 5, maxDistance).filter((x) => x.id !== undefined);
}

/* ------------------------------------------------------------------------- *
 * Whole-word merging
 *
 * Khmer is written without spaces, so a word nobody has listed yet (a
 * loanword, a new coinage, a name, a typo) reaches this point shredded: the
 * segmenter cuts it into syllables, some of which happen to be headwords
 * (ស្មាតហ្វូន -> ស្មា | ត | ហ្វូ | ន, where only ហ្វូ is unknown). Marking just
 * the unknown syllable is useless to the reader. The pass below rebuilds the
 * word from the token stream with four rules that look only at the shape of
 * the tokens and at how common a word is, never at a list of words. First,
 * an unknown token that forms a known word with a neighbour is that word.
 * Then:
 *
 *  1. unknown tokens that touch are one word;
 *  2. a lone consonant touching an unknown token belongs to it (the final
 *     consonant of its last syllable, or the first letter of its first);
 *  3. a short, uncommon known word caught between two unknown tokens is a
 *     syllable of the same word;
 *  4. an unknown token that is still a single syllable is a leftover: it takes
 *     the short, rare known word beside it (the rarer one when there are
 *     two), unless it has a correction of its own that fits the words around
 *     it (តើ|អ្ន -> អ្នក), which makes it a plain typo. A leftover of a single
 *     cluster with no such word beside it takes any neighbour that is not a
 *     common word, so one letter is never marked by itself inside a word;
 *  5. a lone, uncommon consonant between known words is a misspelt word with
 *     the rare neighbour it completes to within one edit (ធ|នាគា -> ធនាគារ).
 *
 * Whitespace, punctuation, digits and Latin text end a word, so nothing is
 * ever merged across them.
 * ------------------------------------------------------------------------- */

/** A known word of at most this many orthographic clusters can be a syllable of a longer unknown word. */
const MAX_ORPHAN_CLUSTERS = 2;

type Piece = {
  text: string;
  unknown: boolean;
  token?: CheckToken;
  /** The unknown text itself, without the lone consonants rule 2 attached. */
  core?: string;
  /** The first and the last unknown token in the piece, when it was joined from several: what its two ends are made of. */
  head?: string;
  tail?: string;
  /** Rule 4 has been applied. */
  grown?: boolean;
};

const isConsonant = (cp: number) => cp >= 0x1780 && cp <= 0x17a2;

/** A single consonant with no vowel, subscript or sign. */
function isLoneConsonant(text: string): boolean {
  const cps = toCodePoints(normalizeKey(text));
  return cps.length === 1 && isConsonant(cps[0]);
}

/**
 * Written syllables, roughly. A cluster with a vowel, subscript or sign is the
 * heart of one. A bare consonant after it closes it (ឆេ|ន); otherwise the bare
 * consonant opens a syllable, which a second bare consonant closes (ខ|ញ) and
 * a cluster without a subscript completes (ស|ប៊ុ). Before a subscript the
 * consonant is a syllable of its own: ក|ន្ត្រ is កន់ + ត្រ.
 */
function syllableCount(text: string): number {
  let n = 0;
  let state: "closed" | "open" | "bare" = "closed";
  for (const c of toClusters(normalizeKey(text))) {
    if (toCodePoints(c).length > 1) {
      if (state !== "bare" || c.includes("\u17d2")) n++;
      state = "open";
    } else if (state === "closed") {
      n++;
      state = "bare";
    } else state = "closed";
  }
  return n;
}

/**
 * A known word short and rare enough to be a fragment of the unknown word next
 * to it. The bar is the one `splitOffCommonWords` uses to trust a word inside
 * an unknown stretch: a one-cluster word must be a common word, a two-cluster
 * word a frequent one. `strict` asks for a rare word whatever its length, for
 * when only one side speaks for it (rule 4). Without the phrase statistics
 * nothing can be judged rare, so only lone consonants (rule 2) are ever taken.
 */
function isOrphan(p: Piece | undefined, strict = false): p is Piece {
  if (!p || p.unknown || p.token?.status !== "dict") return false;
  const s = getPhraseStore();
  if (!s) return false;
  const clusters = toClusters(normalizeKey(p.text)).length;
  if (clusters > MAX_ORPHAN_CLUSTERS) return false;
  return uniCount(s, normalizeKey(p.text)) < (strict || clusters >= 2 ? FREQUENT_WORD : COMMON_WORD);
}

/** A known word the texts seldom use (never true without the phrase statistics). */
function isRareWord(p: Piece | undefined): p is Piece {
  const s = getPhraseStore();
  if (!s || !p || p.unknown || p.token?.status !== "dict") return false;
  return uniCount(s, normalizeKey(p.text)) < FREQUENT_WORD;
}

/**
 * The unknown text is a word in its own right, misspelt: some headword one
 * edit away is what the texts put next to its neighbours (តើ អ្ន -> អ្នក), or
 * khmerdict.com lists it as a known slip. Without the phrase statistics any
 * headword one edit away counts.
 */
function isAnchoredTypo(prev: Piece | undefined, text: string, next: Piece | undefined): boolean {
  if (getCorrections().has(normalizeKey(text))) return true;
  if (!getPhraseStore()) return closeHeadwords(text, 1).length > 0;
  return neighbourFixes(prev?.text, text, next?.text).length > 0;
}

/** Occurrences of a word in the reference texts (0 without them). */
function seenCount(text: string): number {
  const s = getPhraseStore();
  return s ? uniCount(s, normalizeKey(text)) : 0;
}

/** Apply the four rules to one run of touching Khmer word tokens. */
function mergeRun(run: CheckToken[]): CheckToken[] {
  if (run.length < 2) return run;
  const pieces: Piece[] = run.map((t) => ({ text: t.text, unknown: t.status === "unknown", token: t, core: t.status === "unknown" ? t.text : undefined }));
  // Longest match first: an unknown piece that makes a known word with the
  // piece beside it is that word (ប៊ូស|បាន|និ|យាយ -> និយាយ), however it was cut.
  for (let i = 0; i < pieces.length; i++) {
    if (!pieces[i].unknown) continue;
    for (const at of [i, i - 1]) {
      const a = pieces[at];
      const b = pieces[at + 1];
      if (!a || !b || (a.unknown && b.unknown)) continue;
      const word = classifyWord(a.text + b.text);
      if (word.status !== "dict") continue;
      pieces.splice(at, 2, { text: word.text, unknown: false, token: { text: word.text, kind: "word", status: "dict", ids: word.ids } });
      i = at;
      break;
    }
  }
  // The same when only the first cluster of the unknown piece is needed: the
  // one-cluster word before it was cut short (លោ|កដេននីស -> លោក, តា|មហ្ស៊ូម -> តាម).
  // Only when the texts use the longer word more than the short one, so ពី
  // does not become ពីរ at the cost of the word after it.
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    const prev = pieces[i - 1];
    if (!p.unknown || prev.unknown || prev.token?.status !== "dict" || toClusters(prev.text).length !== 1) continue;
    const clusters = toClusters(p.text);
    if (clusters.length < 2) continue;
    const word = classifyWord(prev.text + clusters[0]);
    if (word.status !== "dict" || seenCount(word.text) <= seenCount(prev.text)) continue;
    const rest = clusters.slice(1).join("");
    pieces.splice(i - 1, 2, { text: word.text, unknown: false, token: { text: word.text, kind: "word", status: "dict", ids: word.ids } }, { text: rest, unknown: true, core: rest });
  }
  // A shard: next to unknown text the segmenter sticks the last consonant of
  // one word onto the next (ត្រេ|សឺ|រនេះ). The known word is given back and the
  // consonant left for the unknown word before it.
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    if (!p.unknown || !(pieces[i - 1].unknown || isOrphan(pieces[i - 1]))) continue;
    const clusters = toClusters(p.text);
    if (clusters.length < 2 || !isLoneConsonant(clusters[0])) continue;
    const rest = classifyWord(clusters.slice(1).join(""));
    if (rest.status !== "dict") continue;
    pieces.splice(i, 1, { text: clusters[0], unknown: true, core: clusters[0] }, { text: rest.text, unknown: false, token: { text: rest.text, kind: "word", status: "dict", ids: rest.ids } });
  }
  // Rule 5, before the others so the word it finds can grow like any unknown word.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const prev = pieces[i - 1];
    const next = pieces[i + 1];
    // Next to an unknown token the consonant is that token's (rule 2).
    if (p.unknown || prev?.unknown || next?.unknown || !isLoneConsonant(p.text) || isCommonWord(p.text)) continue;
    if (isRareWord(next) && closeHeadwords(p.text + next.text, 1).length) pieces.splice(i, 2, { text: p.text + next.text, unknown: true, core: p.text + next.text });
    else if (isRareWord(prev) && closeHeadwords(prev.text + p.text, 1).length) pieces.splice(--i, 2, { text: prev.text + p.text, unknown: true, core: prev.text + p.text });
  }
  if (!pieces.some((p) => p.unknown)) return pieces.map((p) => p.token!);
  /** Replace pieces [a, b) with one unknown piece. `rule2`: the known pieces are lone consonants, kept out of the core. */
  const join = (a: number, b: number, grown: boolean, rule2 = false) => {
    const part = pieces.slice(a, b);
    const core = part.map((p) => (p.unknown ? p.core : rule2 ? "" : p.text)).join("");
    const text = part.map((p) => p.text).join("");
    // An end that took a known word in (other than a lone consonant) is no longer a bare leftover.
    const end = (list: Piece[], side: "head" | "tail") => {
      const edge = rule2 ? list.find((p) => p.unknown)! : list[0];
      return edge.unknown ? (edge[side] ?? edge.core) : text;
    };
    pieces.splice(a, b - a, { text, unknown: true, core, head: end(part, "head"), tail: end([...part].reverse(), "tail"), grown: grown || part.some((p) => p.grown) });
  };

  for (let changed = true; changed; ) {
    changed = false;
    // Rules 1-3, to a fixed point.
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i].unknown) continue;
      const next = pieces[i + 1];
      const after = pieces[i + 2];
      const prev = pieces[i - 1];
      if (next?.unknown) join(i, i + 2, false);
      else if (next && isLoneConsonant(next.text)) join(i, i + 2, false, true);
      else if (prev && !prev.unknown && isLoneConsonant(prev.text)) join(i - 1, i + 1, false, true);
      else if (after?.unknown && isOrphan(next)) join(i, i + 3, false);
      else continue;
      changed = true;
      i = Math.max(-1, i - 2);
    }
    if (changed) continue;
    // Rule 4, one leftover at a time, then back to rules 1-3.
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.unknown || p.grown) continue;
      // Each end is judged by the unknown token it is made of (ស្មា|ត|ហ្វូ|ន|អោយ: the front is ហ្វូ).
      const leftover = (end: string | undefined) => syllableCount(end ?? p.core ?? p.text) <= 1;
      if (!leftover(p.head) && !leftover(p.tail)) continue;
      p.grown = true;
      let prev = leftover(p.head) && isOrphan(pieces[i - 1], true) ? pieces[i - 1] : undefined;
      let next = leftover(p.tail) && isOrphan(pieces[i + 1], true) ? pieces[i + 1] : undefined;
      if (!prev && !next) {
        // No fragment beside it. A single cluster still cannot stand as a word:
        // a lone consonant closes the syllable before it (រដ្ឋាភិ|បា|ល), any other
        // cluster goes with a neighbour that is not a common word (ព្រ|លាន).
        const core = p.core ?? p.text;
        if (toClusters(normalizeKey(core)).length > 1) continue;
        const usable = (q: Piece | undefined) => (q && !q.unknown && q.token?.status === "dict" && (isLoneConsonant(core) || !isCommonWord(q.text)) ? q : undefined);
        prev = usable(pieces[i - 1]);
        next = isLoneConsonant(core) && prev ? undefined : usable(pieces[i + 1]);
        if (!prev && !next) continue;
      }
      // With a neighbour it is one edit from a headword (កម្ពុ|ជាា): that word, misspelt.
      const nearPrev = prev !== undefined && closeHeadwords(prev.text + p.text, 1).length > 0;
      const nearNext = next !== undefined && closeHeadwords(p.text + next.text, 1).length > 0;
      if (nearPrev) join(i - 1, i + 1, true);
      else if (nearNext) join(i, i + 2, true);
      else if (isAnchoredTypo(pieces[i - 1], p.text, pieces[i + 1])) continue;
      else if (prev && (!next || seenCount(prev.text) <= seenCount(next.text))) join(i - 1, i + 1, true);
      else join(i, i + 2, true);
      changed = true;
      break;
    }
  }
  return pieces.map((p) => p.token ?? plainUnknown(p.text));
}

/** Rebuild whole words in every run of Khmer word tokens that has nothing between them. */
function mergeUnknownWords(tokens: CheckToken[]): CheckToken[] {
  const out: CheckToken[] = [];
  for (let i = 0; i < tokens.length; ) {
    let j = i;
    while (j < tokens.length && tokens[j].kind === "word") j++;
    if (j === i) out.push(tokens[i++]);
    else {
      out.push(...mergeRun(tokens.slice(i, j)));
      i = j;
    }
  }
  return out;
}

/**
 * A correction that can be applied without asking: exactly one dictionary
 * headword is a single edit away, and it keeps every consonant the user typed,
 * so only a vowel or sign changes. A name like ជួនណាត is never "fixed" to ជួនណា.
 */
function confidentFix(t: CheckToken): string | undefined {
  if (t.status !== "unknown" || !t.suggestions?.length) return undefined;
  const [top, ...rest] = t.suggestions;
  if (!top.id || top.distance !== 1) return undefined;
  if (rest.some((g) => g.id && g.distance === 1)) return undefined;
  const a = toSkeleton(normalizeKey(t.text));
  const b = toSkeleton(normalizeKey(top.word));
  if (a.length !== b.length || a.some((ch, i) => ch !== b[i])) return undefined;
  return top.word;
}

/**
 * khmerdict.com publishes the misspellings its users typed most and the entry
 * they then opened (ម៉ូដ -> ម៉ូត). That is observed behaviour, not a rule, so
 * the pair is offered as a suggestion, right after any confident fix, and is
 * never applied on its own. Only words this app knows are offered.
 */
function addKhmerDictCorrection(t: CheckToken): void {
  const fix = getCorrections().get(normalizeKey(t.text));
  if (!fix || fix === t.fix) return;
  const id = getStore().byKey.get(normalizeKey(fix))?.[0];
  if (id === undefined) return;
  const rest = (t.suggestions ?? []).filter((g) => g.word !== fix);
  const at = t.fix ? 1 : 0;
  rest.splice(at, 0, { word: fix, id, distance: 1 });
  t.suggestions = rest.slice(0, MAX_SUGGESTIONS);
}

/**
 * Check `input`. `approved` holds the normalized keys of words accepted on top
 * of the dictionary (the admin-approved words, see src/lib/words/approved.ts).
 */
export function checkText(input: string, approved: ReadonlySet<string> = new Set()): CheckResponse {
  approvedKeys = approved;
  // Keep the text byte-for-byte so token offsets map back onto the editor.
  const text = input.slice(0, MAX_TEXT);

  const raws: Raw[] = [];
  for (const seg of getSegmenter().segment(text)) raws.push(classify(seg));

  const resolved: CheckToken[] = [];
  for (let i = 0; i < raws.length; ) {
    if (raws[i].kind !== "word") {
      resolved.push({ text: raws[i].text, kind: raws[i].kind });
      i++;
      continue;
    }
    let j = i;
    while (j < raws.length && raws[j].kind === "word") j++;
    resolved.push(...resolveRun(raws.slice(i, j).map((r) => r.text)));
    i = j;
  }
  // An unknown word is marked whole, never as one of its syllables.
  const tokens = mergeUnknownWords(resolved);

  for (const t of tokens) {
    if (t.kind !== "word" || !t.status) continue;
    const fix = confidentFix(t);
    if (fix) t.fix = fix;
    if (t.status === "unknown") addKhmerDictCorrection(t);
  }

  // May split a token, so the words are counted afterwards.
  const issues = adoptSpellingIssues(tokens, checkGrammar(text, tokens));
  const summary: CheckSummary = { words: 0, dict: 0, compound: 0, unknown: 0, issues: issues.length };
  for (const t of tokens) {
    if (t.kind !== "word" || !t.status) continue;
    summary.words++;
    summary[t.status]++;
  }
  return { tokens, summary, issues };
}

/**
 * A variant spelling the grammar rules know (កំលាំង -> កម្លាំង) that fell on a
 * word the dictionary does not have becomes that word's first suggestion and
 * its confident fix, instead of a second underline on the same word.
 */
function adoptSpellingIssues(tokens: CheckToken[], issues: GrammarIssue[]): GrammarIssue[] {
  const s = getStore();
  return issues.filter((it) => {
    if (it.rule !== "variant-spelling" || !it.suggestions.length) return true;
    // The unknown token the issue lies in.
    let start = 0;
    let index = -1;
    for (let i = 0; i < tokens.length; i++) {
      const end = start + tokens[i].text.length;
      if (start <= it.start && it.end <= end) {
        index = i;
        break;
      }
      start = end;
    }
    const t = tokens[index];
    if (!t || t.kind !== "word" || t.status !== "unknown") return true;
    const word = it.suggestions[0];
    const id = s.byKey.get(normalizeKey(word))?.[0];
    const adopt = (u: CheckToken) => {
      u.suggestions = [{ word, id, distance: 1 }, ...(u.suggestions ?? []).filter((g) => g.word !== word)];
      u.fix = word;
    };
    if (t.text.length === it.end - it.start) {
      adopt(t);
      return false;
    }
    // The variant is part of a longer unknown token (ធ្វើអោយ). When everything
    // around it is known, the variant is all that is wrong with the token.
    const before = knownTokens(t.text.slice(0, it.start - start));
    const after = knownTokens(t.text.slice(it.end - start));
    // Otherwise the token stays whole and the variant goes unreported: it is inside a misspelt word.
    if (!before || !after) return false;
    const variant: CheckToken = { text: it.text, kind: "word", status: "unknown" };
    adopt(variant);
    tokens.splice(index, 1, ...before, variant, ...after);
    return false;
  });
}

/** `text` as known tokens: nothing, one known word, or one compound of known words. Null when it is neither. */
function knownTokens(text: string): CheckToken[] | null {
  if (!text) return [];
  const unit = classifyWord(text);
  if (unit.status === "dict") return toTokens(unit);
  const cover = dpCover(text);
  if (!cover || cover.parts.length > MAX_PARTS) return null;
  return [{ text, kind: "word", status: "compound", parts: cover.parts.map(toPart) }];
}
