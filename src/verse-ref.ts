/**
 * Flexible Bible verse reference parser.
 * Handles "Romans 9:13", "Rom 9:13", "Rom. 9:13", "1 Cor 1:1", etc.
 */

const BOOK_ALIASES: Record<string, string> = {
  // Old Testament
  "gen": "Genesis", "ge": "Genesis", "gn": "Genesis",
  "ex": "Exodus", "exod": "Exodus", "exo": "Exodus",
  "lev": "Leviticus", "le": "Leviticus", "lv": "Leviticus",
  "num": "Numbers", "nu": "Numbers", "nm": "Numbers",
  "deut": "Deuteronomy", "de": "Deuteronomy", "dt": "Deuteronomy",
  "josh": "Joshua", "jos": "Joshua",
  "judg": "Judges", "jdg": "Judges",
  "ruth": "Ruth", "ru": "Ruth",
  "1sam": "1 Samuel", "1sa": "1 Samuel",
  "2sam": "2 Samuel", "2sa": "2 Samuel",
  "1kgs": "1 Kings", "1ki": "1 Kings",
  "2kgs": "2 Kings", "2ki": "2 Kings",
  "1chr": "1 Chronicles", "1ch": "1 Chronicles",
  "2chr": "2 Chronicles", "2ch": "2 Chronicles",
  "ezra": "Ezra", "ezr": "Ezra",
  "neh": "Nehemiah", "ne": "Nehemiah",
  "esth": "Esther", "est": "Esther",
  "job": "Job",
  "ps": "Psalms", "psa": "Psalms", "psalm": "Psalms",
  "prov": "Proverbs", "pr": "Proverbs", "pro": "Proverbs",
  "eccl": "Ecclesiastes", "ec": "Ecclesiastes", "ecc": "Ecclesiastes",
  "song": "Song of Solomon", "sos": "Song of Solomon", "sg": "Song of Solomon",
  "isa": "Isaiah", "is": "Isaiah",
  "jer": "Jeremiah", "je": "Jeremiah",
  "lam": "Lamentations", "la": "Lamentations",
  "ezek": "Ezekiel", "eze": "Ezekiel", "ezk": "Ezekiel",
  "dan": "Daniel", "da": "Daniel", "dn": "Daniel",
  "hos": "Hosea", "ho": "Hosea",
  "joel": "Joel", "joe": "Joel",
  "amos": "Amos", "am": "Amos",
  "obad": "Obadiah", "ob": "Obadiah",
  "jonah": "Jonah", "jon": "Jonah",
  "mic": "Micah", "mi": "Micah",
  "nah": "Nahum", "na": "Nahum",
  "hab": "Habakkuk",
  "zeph": "Zephaniah", "zep": "Zephaniah",
  "hag": "Haggai",
  "zech": "Zechariah", "zec": "Zechariah",
  "mal": "Malachi",

  // New Testament
  "mt": "Matthew", "matt": "Matthew", "mat": "Matthew",
  "mk": "Mark", "mr": "Mark",
  "lk": "Luke", "lu": "Luke",
  "jn": "John", "joh": "John",
  "acts": "Acts", "ac": "Acts",
  "rom": "Romans", "ro": "Romans",
  "1cor": "1 Corinthians", "1co": "1 Corinthians",
  "2cor": "2 Corinthians", "2co": "2 Corinthians",
  "gal": "Galatians", "ga": "Galatians",
  "eph": "Ephesians",
  "phil": "Philippians", "php": "Philippians",
  "col": "Colossians",
  "1thess": "1 Thessalonians", "1th": "1 Thessalonians",
  "2thess": "2 Thessalonians", "2th": "2 Thessalonians",
  "1tim": "1 Timothy", "1ti": "1 Timothy",
  "2tim": "2 Timothy", "2ti": "2 Timothy",
  "tit": "Titus",
  "phlm": "Philemon", "phm": "Philemon",
  "heb": "Hebrews",
  "jas": "James", "jm": "James",
  "1pet": "1 Peter", "1pe": "1 Peter", "1pt": "1 Peter",
  "2pet": "2 Peter", "2pe": "2 Peter", "2pt": "2 Peter",
  "1jn": "1 John", "1jo": "1 John",
  "2jn": "2 John", "2jo": "2 John",
  "3jn": "3 John", "3jo": "3 John",
  "jude": "Jude",
  "rev": "Revelation", "re": "Revelation",
};

// Full names (lowercase) map to canonical form
const FULL_NAMES: Record<string, string> = {
  "genesis": "Genesis", "exodus": "Exodus", "leviticus": "Leviticus",
  "numbers": "Numbers", "deuteronomy": "Deuteronomy", "joshua": "Joshua",
  "judges": "Judges", "ruth": "Ruth",
  "1 samuel": "1 Samuel", "2 samuel": "2 Samuel",
  "1 kings": "1 Kings", "2 kings": "2 Kings",
  "1 chronicles": "1 Chronicles", "2 chronicles": "2 Chronicles",
  "ezra": "Ezra", "nehemiah": "Nehemiah", "esther": "Esther",
  "job": "Job", "psalms": "Psalms", "proverbs": "Proverbs",
  "ecclesiastes": "Ecclesiastes", "song of solomon": "Song of Solomon",
  "isaiah": "Isaiah", "jeremiah": "Jeremiah", "lamentations": "Lamentations",
  "ezekiel": "Ezekiel", "daniel": "Daniel", "hosea": "Hosea",
  "joel": "Joel", "amos": "Amos", "obadiah": "Obadiah",
  "jonah": "Jonah", "micah": "Micah", "nahum": "Nahum",
  "habakkuk": "Habakkuk", "zephaniah": "Zephaniah", "haggai": "Haggai",
  "zechariah": "Zechariah", "malachi": "Malachi",
  "matthew": "Matthew", "mark": "Mark", "luke": "Luke", "john": "John",
  "acts": "Acts", "romans": "Romans",
  "1 corinthians": "1 Corinthians", "2 corinthians": "2 Corinthians",
  "galatians": "Galatians", "ephesians": "Ephesians",
  "philippians": "Philippians", "colossians": "Colossians",
  "1 thessalonians": "1 Thessalonians", "2 thessalonians": "2 Thessalonians",
  "1 timothy": "1 Timothy", "2 timothy": "2 Timothy",
  "titus": "Titus", "philemon": "Philemon", "hebrews": "Hebrews",
  "james": "James",
  "1 peter": "1 Peter", "2 peter": "2 Peter",
  "1 john": "1 John", "2 john": "2 John", "3 john": "3 John",
  "jude": "Jude", "revelation": "Revelation",
};

export interface VerseRef {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
}

/**
 * Normalize a book name from user input to canonical form.
 * Handles abbreviations with or without trailing periods.
 */
export function normalizeBook(input: string): string | null {
  const cleaned = input.trim().replace(/\.$/, "").toLowerCase();

  // Try full name match first
  if (FULL_NAMES[cleaned]) {
    return FULL_NAMES[cleaned];
  }

  // Try alias match
  if (BOOK_ALIASES[cleaned]) {
    return BOOK_ALIASES[cleaned];
  }

  // Try prefix matching on full names (e.g., "Revel" -> "Revelation")
  const matches = Object.entries(FULL_NAMES)
    .filter(([key]) => key.startsWith(cleaned))
    .map(([, val]) => val);

  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

/**
 * Parse a verse reference string into structured form.
 * Handles: "Romans 9:13", "Rom 9:13", "Rom. 9:13", "1 Cor 1:1-3"
 */
export function parseVerseRef(input: string): VerseRef | null {
  const trimmed = input.trim();

  // Pattern: optional number prefix, book name, chapter:verse(-verse)
  // "1 Corinthians 10:13", "Rom 9:13", "Gen. 1:1-3"
  const match = trimmed.match(
    /^(\d\s+)?([A-Za-z][A-Za-z\s.]*?)\s+(\d+):(\d+)(?:-(\d+))?$/
  );

  if (!match) {
    return null;
  }

  const numPrefix = match[1]?.trim() ?? "";
  const bookPart = (numPrefix ? numPrefix + " " : "") + match[2].trim();
  const chapter = parseInt(match[3], 10);
  const verseStart = parseInt(match[4], 10);
  const verseEnd = match[5] ? parseInt(match[5], 10) : null;

  const book = normalizeBook(bookPart);
  if (!book) {
    return null;
  }

  return { book, chapter, verseStart, verseEnd };
}

/**
 * Parse a filename like "Romans 9_13.toml" or "Genesis 1_1-3.toml"
 * into a structured verse reference.
 */
export function parseFilenameRef(filename: string): VerseRef | null {
  const withoutExt = filename.replace(/\.toml$/, "");
  // Convert underscore to colon format and parse
  const asRef = withoutExt.replace(/_/, ":");
  return parseVerseRef(asRef);
}
