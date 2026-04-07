import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findCommentariesByVerse, type CommentaryLookupRow } from "./commentary-tools.js";
import { getDb, getWritingsDb, validateCommentariesSchema, validateWritingsSchema } from "./db.js";
import { parseVerseRef, normalizeBook, type VerseRef } from "./verse-ref.js";
import { registerWritingsTools } from "./writings-tools.js";
import type Database from "better-sqlite3";

let db: Database.Database;

function ensureDb(): Database.Database {
  if (!db) {
    db = getDb();
  }
  return db;
}

interface CommentaryRow extends CommentaryLookupRow {
  highlighted?: string | null;
}

interface AuthorRow {
  name: string;
  default_year: number | null;
  wiki_url: string | null;
  commentary_count: number;
}

function formatRef(row: CommentaryRow): string {
  const verse = row.verse_end
    ? `${row.verse_start}-${row.verse_end}`
    : `${row.verse_start}`;
  return `${row.book} ${row.chapter}:${verse}`;
}

function formatRequestedRef(ref: VerseRef): string {
  const verse = ref.verseEnd
    ? `${ref.verseStart}-${ref.verseEnd}`
    : `${ref.verseStart}`;
  return `${ref.book} ${ref.chapter}:${verse}`;
}

function formatCommentary(row: CommentaryRow, preferHighlighted = false): string {
  const authorLabel = row.append_to_author_name
    ? `${row.author_name}${row.append_to_author_name}`
    : row.author_name;
  const yearStr = row.default_year ? ` (d. ${row.default_year})` : "";
  const sourceStr = row.source_title ? `\nSource: ${row.source_title}` : "";
  const urlStr = row.source_url ? `\nURL: ${row.source_url}` : "";
  const body = preferHighlighted && row.highlighted ? row.highlighted : row.quote;

  return `--- ${authorLabel}${yearStr} on ${formatRef(row)} ---\n${body}${sourceStr}${urlStr}`;
}

function validateDatabaseSetup(): void {
  const commentaryDb = getDb();
  try {
    const missingTables = validateCommentariesSchema(commentaryDb);
    if (missingTables.length > 0) {
      throw new Error(
        `Commentary database is not initialized. Missing tables: ${missingTables.join(", ")}. Run npm run ingest first.`
      );
    }
  } finally {
    commentaryDb.close();
  }

  const writingsDb = getWritingsDb();
  try {
    const missingTables = validateWritingsSchema(writingsDb);
    if (missingTables.length > 0) {
      throw new Error(
        `Writings database is not initialized. Missing tables: ${missingTables.join(", ")}. Run npm run ingest-writings first.`
      );
    }
  } finally {
    writingsDb.close();
  }
}

const server = new McpServer({
  name: "patristic-commentaries",
  version: "1.0.0",
});

server.tool(
  "patristic_by_verse",
  "Get all patristic commentaries for a Bible verse reference (e.g. 'Romans 9:13', 'Rom 9:13', 'John 1:1')",
  {
    reference: z.string().describe("Bible verse reference, e.g. 'Romans 9:13', 'Rom. 9:13', 'Jn 1:1'"),
    limit: z.number().optional().default(20).describe("Max results to return (default 20)"),
  },
  async ({ reference, limit }) => {
    const ref = parseVerseRef(reference);
    if (!ref) {
      return {
        content: [{
          type: "text" as const,
          text: `Could not parse verse reference: "${reference}". Try format like "Romans 9:13" or "Rom 9:13".`,
        }],
      };
    }

    const d = ensureDb();
    const requestedRef = formatRequestedRef(ref);

    let rows: CommentaryRow[];
    try {
      rows = findCommentariesByVerse(d, ref, limit) as CommentaryRow[];
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Commentary lookup error: ${err instanceof Error ? err.message : String(err)}.`,
        }],
      };
    }

    if (rows.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `No commentaries found for ${requestedRef}.`,
        }],
      };
    }

    const formatted = rows.map((row) => formatCommentary(row)).join("\n\n");
    return {
      content: [{
        type: "text" as const,
        text: `Found ${rows.length} commentaries on ${requestedRef}:\n\n${formatted}`,
      }],
    };
  },
);

server.tool(
  "patristic_by_author",
  "Get commentaries by a specific church father, optionally filtered by book or verse",
  {
    author: z.string().describe("Author name or partial name, e.g. 'Augustine', 'Chrysostom'"),
    book: z.string().optional().describe("Bible book name to filter by, e.g. 'Romans', 'Rom'"),
    reference: z.string().optional().describe("Full verse reference to filter by, e.g. 'Romans 9:13'"),
    limit: z.number().optional().default(20).describe("Max results to return (default 20)"),
  },
  async ({ author, book, reference, limit }) => {
    const d = ensureDb();

    let query = `
      SELECT c.*, a.name as author_name, a.default_year
      FROM commentaries c
      JOIN authors a ON c.author_id = a.id
      WHERE a.name LIKE ?
    `;
    const params: unknown[] = [`%${author}%`];

    if (reference) {
      const ref = parseVerseRef(reference);
      if (!ref) {
        return {
          content: [{
            type: "text" as const,
            text: `Could not parse verse reference: "${reference}". Try format like "Romans 9:13" or "Rom 9:13".`,
          }],
        };
      }

      const requestVerseEnd = ref.verseEnd ?? ref.verseStart;
      query += ` AND c.book = ? AND c.chapter = ? AND c.verse_start <= ? AND COALESCE(c.verse_end, c.verse_start) >= ?`;
      params.push(ref.book, ref.chapter, requestVerseEnd, ref.verseStart);
    } else if (book) {
      const canonical = normalizeBook(book);
      if (canonical) {
        query += ` AND c.book = ?`;
        params.push(canonical);
      } else {
        query += ` AND c.book LIKE ?`;
        params.push(`%${book}%`);
      }
    }

    query += ` ORDER BY c.book, c.chapter, c.verse_start LIMIT ?`;
    params.push(limit);

    let rows: CommentaryRow[];
    try {
      rows = d.prepare(query).all(...params) as CommentaryRow[];
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Author lookup error: ${err instanceof Error ? err.message : String(err)}.`,
        }],
      };
    }

    if (rows.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `No commentaries found for author matching "${author}".`,
        }],
      };
    }

    const formatted = rows.map((row) => formatCommentary(row)).join("\n\n");
    return {
      content: [{
        type: "text" as const,
        text: `Found ${rows.length} commentaries by "${author}":\n\n${formatted}`,
      }],
    };
  },
);

server.tool(
  "patristic_search",
  "Full-text search across all patristic commentaries",
  {
    query: z.string().describe("Search terms (supports FTS5 syntax: AND, OR, NOT, phrases in quotes)"),
    author: z.string().optional().describe("Optional author filter"),
    book: z.string().optional().describe("Optional Bible book filter"),
    limit: z.number().optional().default(20).describe("Max results (default 20)"),
  },
  async ({ query, author, book, limit }) => {
    const d = ensureDb();

    let sql = `
      SELECT c.*, a.name as author_name, a.default_year,
             highlight(commentaries_fts, 0, '>>>', '<<<') as highlighted
      FROM commentaries_fts fts
      JOIN commentaries c ON fts.rowid = c.id
      JOIN authors a ON c.author_id = a.id
      WHERE commentaries_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (author) {
      sql += ` AND a.name LIKE ?`;
      params.push(`%${author}%`);
    }

    if (book) {
      const canonical = normalizeBook(book);
      if (canonical) {
        sql += ` AND c.book = ?`;
        params.push(canonical);
      } else {
        sql += ` AND c.book LIKE ?`;
        params.push(`%${book}%`);
      }
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    let rows: CommentaryRow[];
    try {
      rows = d.prepare(sql).all(...params) as CommentaryRow[];
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Search error: ${err instanceof Error ? err.message : String(err)}. Try simpler search terms.`,
        }],
      };
    }

    if (rows.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `No results found for "${query}".`,
        }],
      };
    }

    const formatted = rows.map((row) => formatCommentary(row, true)).join("\n\n");
    return {
      content: [{
        type: "text" as const,
        text: `Found ${rows.length} results for "${query}":\n\n${formatted}`,
      }],
    };
  },
);

server.tool(
  "patristic_list_authors",
  "List all available church fathers with commentary counts",
  {
    search: z.string().optional().describe("Optional name filter"),
    sort_by: z.enum(["name", "count", "year"]).optional().default("name").describe("Sort order"),
  },
  async ({ search, sort_by }) => {
    const d = ensureDb();

    let query = `
      SELECT a.name, a.default_year, a.wiki_url,
             COUNT(c.id) as commentary_count
      FROM authors a
      LEFT JOIN commentaries c ON a.id = c.author_id
    `;
    const params: unknown[] = [];

    if (search) {
      query += ` WHERE a.name LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY a.id`;

    const orderMap = {
      name: "a.name ASC",
      count: "commentary_count DESC",
      year: "a.default_year ASC",
    };
    query += ` ORDER BY ${orderMap[sort_by ?? "name"]}`;

    let rows: AuthorRow[];
    try {
      rows = d.prepare(query).all(...params) as AuthorRow[];
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Author list error: ${err instanceof Error ? err.message : String(err)}.`,
        }],
      };
    }

    const lines = rows.map((r) => {
      const year = r.default_year ? ` (d. ${r.default_year})` : "";
      return `${r.name}${year}: ${r.commentary_count} commentaries`;
    });

    return {
      content: [{
        type: "text" as const,
        text: `${rows.length} authors found:\n\n${lines.join("\n")}`,
      }],
    };
  },
);

registerWritingsTools(server);

async function main(): Promise<void> {
  validateDatabaseSetup();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
