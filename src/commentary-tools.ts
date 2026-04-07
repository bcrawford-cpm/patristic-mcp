import type Database from "better-sqlite3";
import type { VerseRef } from "./verse-ref.js";

export interface CommentaryLookupRow {
  id: number;
  author_id: number;
  author_name: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number | null;
  quote: string;
  source_url: string | null;
  source_title: string | null;
  append_to_author_name: string | null;
  default_year: number | null;
}

export function findCommentariesByVerse(
  db: Database.Database,
  ref: VerseRef,
  limit: number,
): CommentaryLookupRow[] {
  const requestVerseEnd = ref.verseEnd ?? ref.verseStart;

  return db.prepare(`
    SELECT c.*, a.name as author_name, a.default_year
    FROM commentaries c
    JOIN authors a ON c.author_id = a.id
    WHERE c.book = ? AND c.chapter = ?
      AND c.verse_start <= ?
      AND COALESCE(c.verse_end, c.verse_start) >= ?
    ORDER BY a.default_year ASC, a.name ASC
    LIMIT ?
  `).all(
    ref.book,
    ref.chapter,
    requestVerseEnd,
    ref.verseStart,
    limit,
  ) as CommentaryLookupRow[];
}