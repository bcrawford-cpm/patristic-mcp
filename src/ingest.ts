import fs from "node:fs";
import path from "node:path";
import * as toml from "@iarna/toml";
import { getDb, initSchema, resetCommentariesData } from "./db.js";
import { parseFilenameRef } from "./verse-ref.js";
import type Database from "better-sqlite3";

const REPO_PATH = process.env.COMMENTARIES_DATA_PATH ?? path.resolve(process.cwd(), "commentaries-data");

// NT and OT book directories to skip (they contain cross-references, not commentaries)
const BOOK_DIRS = new Set([
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans",
  "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
  "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John",
  "Jude", "Revelation",
]);

interface CommentaryEntry {
  quote: string;
  source_url?: string;
  source_title?: string;
  append_to_author_name?: string;
}

interface TomlData {
  commentary?: CommentaryEntry[];
}

function loadMetadata(authorDir: string): { default_year?: number; wiki?: string } {
  const metaPath = path.join(authorDir, "metadata.toml");
  if (!fs.existsSync(metaPath)) {
    return {};
  }
  const raw = fs.readFileSync(metaPath, "utf-8");
  const parsed = toml.parse(raw) as Record<string, unknown>;
  return {
    default_year: typeof parsed.default_year === "number" ? parsed.default_year : undefined,
    wiki: typeof parsed.wiki === "string" ? parsed.wiki : undefined,
  };
}

function ingest(): void {
  if (!fs.existsSync(REPO_PATH) || !fs.statSync(REPO_PATH).isDirectory()) {
    throw new Error(
      `Commentaries data directory not found at ${REPO_PATH}. Set COMMENTARIES_DATA_PATH or clone Commentaries-Database into ./commentaries-data.`
    );
  }

  const db = getDb();
  initSchema(db);

  const insertAuthor = db.prepare(
    `INSERT OR IGNORE INTO authors (name, default_year, wiki_url) VALUES (?, ?, ?)`
  );
  const getAuthorId = db.prepare(`SELECT id FROM authors WHERE name = ?`);
  const insertCommentary = db.prepare(
    `INSERT INTO commentaries (author_id, book, chapter, verse_start, verse_end, quote, source_url, source_title, append_to_author_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const entries = fs.readdirSync(REPO_PATH, { withFileTypes: true });
  const authorDirs = entries.filter(
    (e) => e.isDirectory() && !BOOK_DIRS.has(e.name) && !e.name.startsWith(".")
  );

  let totalFiles = 0;
  let totalCommentaries = 0;
  let skippedFiles = 0;

  const insertMany = db.transaction(() => {
    resetCommentariesData(db);

    for (const dir of authorDirs) {
      const authorName = dir.name;
      const authorPath = path.join(REPO_PATH, authorName);
      const meta = loadMetadata(authorPath);

      insertAuthor.run(authorName, meta.default_year ?? null, meta.wiki ?? null);
      const authorRow = getAuthorId.get(authorName) as { id: number } | undefined;
      if (!authorRow) {
        throw new Error(`Failed to create or fetch author row for ${authorName}.`);
      }
      const authorId = authorRow.id;

      const files = fs.readdirSync(authorPath).filter(
        (f) => f.endsWith(".toml") && f !== "metadata.toml"
      );

      for (const file of files) {
        totalFiles++;
        const ref = parseFilenameRef(file);
        if (!ref) {
          skippedFiles++;
          continue;
        }

        const filePath = path.join(authorPath, file);
        let raw: string;
        try {
          raw = fs.readFileSync(filePath, "utf-8");
        } catch (err) {
          console.warn(`Skipping unreadable commentary file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
          skippedFiles++;
          continue;
        }

        let parsed: TomlData;
        try {
          parsed = toml.parse(raw) as unknown as TomlData;
        } catch (err) {
          console.warn(`Skipping invalid TOML file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
          skippedFiles++;
          continue;
        }

        const commentaries = parsed.commentary;
        if (!Array.isArray(commentaries)) {
          skippedFiles++;
          continue;
        }

        for (const entry of commentaries) {
          if (!entry.quote || entry.quote.trim().length === 0) {
            continue;
          }
          insertCommentary.run(
            authorId,
            ref.book,
            ref.chapter,
            ref.verseStart,
            ref.verseEnd ?? null,
            entry.quote.trim(),
            entry.source_url ?? null,
            entry.source_title ?? null,
            entry.append_to_author_name ?? null,
          );
          totalCommentaries++;
        }
      }
    }
  });

  insertMany();
  db.close();

  console.log(`Ingestion complete:`);
  console.log(`  Authors: ${authorDirs.length}`);
  console.log(`  Files processed: ${totalFiles}`);
  console.log(`  Commentaries inserted: ${totalCommentaries}`);
  console.log(`  Files skipped: ${skippedFiles}`);
}

ingest();
