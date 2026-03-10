import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "./db.js";
import { parseVerseRef, normalizeBook } from "./verse-ref.js";
import { registerWritingsTools } from "./writings-tools.js";
import type Database from "better-sqlite3";

let db: Database.Database;

function ensureDb(): Database.Database {
  if (!db) {
    db = getDb();
  }
  return db;
}

interface CommentaryRow {
  id: number;
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

function formatCommentary(row: CommentaryRow): string {
  const authorLabel = row.append_to_author_name
    ? `${row.author_name}${row.append_to_author_name}`
    : row.author_name;
  const yearStr = row.default_year ? ` (d. ${row.default_year})` : "";
  const sourceStr = row.source_title ? `\nSource: ${row.source_title}` : "";
  const urlStr = row.source_url ? `\nURL: ${row.source_url}` : "";

  return `--- ${authorLabel}${yearStr} on ${formatRef(row)} ---\n${row.quote}${sourceStr}${urlStr}`;
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
    const rows = d.prepare(`
      SELECT c.*, a.name as author_name, a.default_year
      FROM commentaries c
      JOIN authors a ON c.author_id = a.id
      WHERE c.book = ? AND c.chapter = ?
        AND (c.verse_start = ? OR (c.verse_start <= ? AND c.verse_end >= ?))
      ORDER BY a.default_year ASC, a.name ASC
      LIMIT ?
    `).all(
      ref.book, ref.chapter,
      ref.verseStart, ref.verseStart, ref.verseStart,
      limit,
    ) as CommentaryRow[];

    if (rows.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `No commentaries found for ${ref.book} ${ref.chapter}:${ref.verseStart}.`,
        }],
      };
    }

    const formatted = rows.map(formatCommentary).join("\n\n");
    return {
      content: [{
        type: "text" as const,
        text: `Found ${rows.length} commentaries on ${ref.book} ${ref.chapter}:${ref.verseStart}:\n\n${formatted}`,
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
      if (ref) {
        query += ` AND c.book = ? AND c.chapter = ? AND (c.verse_start = ? OR (c.verse_start <= ? AND c.verse_end >= ?))`;
        params.push(ref.book, ref.chapter, ref.verseStart, ref.verseStart, ref.verseStart);
      }
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

    const rows = d.prepare(query).all(...params) as CommentaryRow[];

    if (rows.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `No commentaries found for author matching "${author}".`,
        }],
      };
    }

    const formatted = rows.map(formatCommentary).join("\n\n");
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

    const formatted = rows.map(formatCommentary).join("\n\n");
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

    const rows = d.prepare(query).all(...params) as AuthorRow[];

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
