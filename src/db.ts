import Database from "better-sqlite3";
import path from "node:path";

function resolveDbPath(envVarName: string, fallbackFilename: string): string {
  const configuredPath = process.env[envVarName];
  if (!configuredPath) {
    return path.join(__dirname, "..", fallbackFilename);
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
}

const DB_PATH = resolveDbPath("PATRISTIC_DB_PATH", "patristic.db");
const WRITINGS_DB_PATH = resolveDbPath("WRITINGS_DB_PATH", "writings.db");

function findMissingTables(db: Database.Database, requiredTables: string[]): string[] {
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type IN ('table', 'view')
  `).all() as Array<{ name: string }>;

  const existing = new Set(rows.map((row) => row.name));
  return requiredTables.filter((tableName) => !existing.has(tableName));
}

export function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function getWritingsDb(): Database.Database {
  const db = new Database(WRITINGS_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function validateCommentariesSchema(db: Database.Database): string[] {
  return findMissingTables(db, ["authors", "commentaries", "commentaries_fts"]);
}

export function validateWritingsSchema(db: Database.Database): string[] {
  return findMissingTables(db, ["authors", "works", "sections", "writings_fts"]);
}

export function resetCommentariesData(db: Database.Database): void {
  db.exec(`
    DELETE FROM commentaries;
    DELETE FROM authors;
  `);
}

export function resetWritingsData(db: Database.Database): void {
  db.exec(`
    DELETE FROM sections;
    DELETE FROM works;
    DELETE FROM authors;
  `);
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      default_year INTEGER,
      wiki_url TEXT
    );

    CREATE TABLE IF NOT EXISTS commentaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES authors(id),
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse_start INTEGER NOT NULL,
      verse_end INTEGER,
      quote TEXT NOT NULL,
      source_url TEXT,
      source_title TEXT,
      append_to_author_name TEXT,
      FOREIGN KEY (author_id) REFERENCES authors(id)
    );

    CREATE INDEX IF NOT EXISTS idx_commentaries_book_chapter_verse
      ON commentaries(book, chapter, verse_start);

    CREATE INDEX IF NOT EXISTS idx_commentaries_author
      ON commentaries(author_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS commentaries_fts USING fts5(
      quote,
      source_title,
      content='commentaries',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS commentaries_ai AFTER INSERT ON commentaries BEGIN
      INSERT INTO commentaries_fts(rowid, quote, source_title)
      VALUES (new.id, new.quote, new.source_title);
    END;

    CREATE TRIGGER IF NOT EXISTS commentaries_ad AFTER DELETE ON commentaries BEGIN
      INSERT INTO commentaries_fts(commentaries_fts, rowid, quote, source_title)
      VALUES ('delete', old.id, old.quote, old.source_title);
    END;

    CREATE TRIGGER IF NOT EXISTS commentaries_au AFTER UPDATE ON commentaries BEGIN
      INSERT INTO commentaries_fts(commentaries_fts, rowid, quote, source_title)
      VALUES ('delete', old.id, old.quote, old.source_title);
      INSERT INTO commentaries_fts(rowid, quote, source_title)
      VALUES (new.id, new.quote, new.source_title);
    END;
  `);
}

export function initWritingsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      death_year INTEGER,
      wiki_url TEXT
    );

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES authors(id),
      title TEXT NOT NULL,
      source_path TEXT,
      UNIQUE(author_id, title)
    );

    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL REFERENCES works(id),
      section_title TEXT,
      section_number INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sections_work ON sections(work_id);
    CREATE INDEX IF NOT EXISTS idx_works_author ON works(author_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS writings_fts USING fts5(
      content,
      section_title,
      content='sections',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS writings_ai AFTER INSERT ON sections BEGIN
      INSERT INTO writings_fts(rowid, content, section_title)
      VALUES (new.id, new.content, new.section_title);
    END;

    CREATE TRIGGER IF NOT EXISTS writings_ad AFTER DELETE ON sections BEGIN
      INSERT INTO writings_fts(writings_fts, rowid, content, section_title)
      VALUES ('delete', old.id, old.content, old.section_title);
    END;
  `);
}
