export type Entry = {
  id: number;
  word: string;
  /** Part-of-speech abbreviation as printed in the dictionary, e.g. "ន." */
  pos?: string;
  /** Pronunciation respelled in Khmer script, e.g. "ចិត-តៈ" */
  pron?: string;
};

export type MatchType = "exact" | "prefix" | "contains" | "fuzzy";

export type SearchResult = {
  id: number;
  word: string;
  pos?: string;
  match: MatchType;
  /** Short plain-text preview of the definition. */
  excerpt: string;
};

export type SearchResponse = {
  query: string;
  normalized: string;
  total: number;
  results: SearchResult[];
};

/** `distance`: how many code points separate the typed text from this word. */
export type Suggestion = { word: string; id?: number; distance: number };

export type TokenKind = "word" | "space" | "punct" | "other";

/**
 * dict      – headword found in the Chuon Nath dictionary
 * compound  – not an entry itself, but splits cleanly into headwords
 * unknown   – not in the dictionary
 */
export type TokenStatus = "dict" | "compound" | "unknown";

export type CheckPart = { text: string; status: "dict"; ids?: number[] };

export type CheckToken = {
  text: string;
  kind: TokenKind;
  status?: TokenStatus;
  ids?: number[];
  parts?: CheckPart[];
  suggestions?: Suggestion[];
  /** A correction safe to apply without asking (see `confidentFix`). */
  fix?: string;
};

export type CheckSummary = {
  words: number;
  dict: number;
  compound: number;
  unknown: number;
  /** Grammar issues found by the rule engine (see `@/lib/grammar`). */
  issues: number;
};

export type IssueType = "spelling" | "grammar" | "word-choice" | "punctuation" | "spacing";

/**
 * error   – the text is wrong by a rule with no known exceptions
 * warning – very likely wrong; a suggestion is offered
 * hint    – worth a look; the rule has known exceptions
 */
export type IssueSeverity = "error" | "warning" | "hint";

/**
 * Why the phrase-context check prefers its suggestion: the phrase the
 * suggestion forms with a neighbouring word, where that phrase is known from,
 * and how often the texts contain it against the phrase as written.
 */
export type PhraseEvidence = {
  /** The phrase with the suggestion in place, e.g. បណ្ដុះបណ្ដាល. */
  phrase: string;
  /** The same phrase as the text has it, e.g. បណ្ដុះបណ្ដា. */
  written: string;
  /** dictionary: the phrase is one headword; corpus: only the word-pair counts speak for it. */
  kind: "dictionary" | "corpus";
  /** Chuon Nath entry id when the phrase (or, for corpus evidence, the suggested word) is a headword. */
  id?: number;
  /** Short meaning, when a dictionary has one. */
  gloss?: string;
  /** Occurrences in the reference texts of `phrase` and of `written`. */
  seen: number;
  seenWritten: number;
};

/** One match of a grammar rule, as an offset range into the checked text. */
export type GrammarIssue = {
  /** Rule id from the catalog in `@/lib/grammar/catalog`. */
  rule: string;
  type: IssueType;
  severity: IssueSeverity;
  start: number;
  end: number;
  /** `text.slice(start, end)`, kept so a client can re-find it after edits. */
  text: string;
  /** Replacements for the range, best first. Empty when the rule only points out a problem. */
  suggestions: string[];
  /** One sentence in Khmer. */
  message: string;
  /** The same in English. */
  messageEn: string;
  /** Set by the phrase-context rule only. */
  evidence?: PhraseEvidence;
};

export type CheckResponse = {
  tokens: CheckToken[];
  summary: CheckSummary;
  issues: GrammarIssue[];
};

export type DefinitionSegment =
  | { t: "text"; v: string }
  | { t: "link"; v: string; id: number }
  | { t: "pos"; v: string };

export type ParsedDefinition = {
  lines: DefinitionSegment[][];
};

export type LetterInfo = { letter: string; count: number };
