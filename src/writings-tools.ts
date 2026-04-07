import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getWritingsDb } from "./db.js";
import type Database from "better-sqlite3";

let writingsDb: Database.Database;

function ensureWritingsDb(): Database.Database {
  if (!writingsDb) {
    writingsDb = getWritingsDb();
  }
  return writingsDb;
}

interface WritingsSearchRow {
  section_id: number;
  section_title: string;
  section_number: number;
  content: string;
  work_title: string;
  author_name: string;
  death_year: number | null;
}

interface WritingsWorkRow {
  work_id: number;
  title: string;
  author_name: string;
  death_year: number | null;
  section_count: number;
}

function truncate(text: string, startPos: number, maxLen: number): string {
  const start = Math.max(0, startPos);
  const chunk = text.slice(start, start + maxLen);
  
  if (start + maxLen >= text.length) {
    return chunk;
  }
  return chunk + `\n\n... (text omitted, continue reading by passing start_position: ${start + maxLen})`;
}

function writingsErrorResponse(prefix: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{
      type: "text" as const,
      text: `${prefix} error: ${err instanceof Error ? err.message : String(err)}.`,
    }],
  };
}

export function registerWritingsTools(server: McpServer): void {
  server.tool(
    "patristic_writings_search",
    "Full-text search across all patristic treatises and full works (City of God, Confessions, Against Heresies, etc.)",
    {
      query: z.string().describe("Search terms (supports FTS5 syntax: AND, OR, NOT, phrases in quotes)"),
      author: z.string().optional().describe("Optional author name filter"),
      limit: z.number().optional().default(10).describe("Max results (default 10)"),
    },
    async ({ query, author, limit }) => {
      const d = ensureWritingsDb();

      let sql = `
        SELECT s.id as section_id, s.section_title, s.section_number,
               snippet(writings_fts, 0, '>>>', '<<<', '...', 64) as content,
               w.title as work_title,
               a.name as author_name, a.death_year
        FROM writings_fts fts
        JOIN sections s ON fts.rowid = s.id
        JOIN works w ON s.work_id = w.id
        JOIN authors a ON w.author_id = a.id
        WHERE writings_fts MATCH ?
      `;
      const params: unknown[] = [query];

      if (author) {
        sql += ` AND a.name LIKE ?`;
        params.push(`%${author}%`);
      }

      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);

      let rows: WritingsSearchRow[];
      try {
        rows = d.prepare(sql).all(...params) as WritingsSearchRow[];
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Search error: ${err instanceof Error ? err.message : String(err)}. Try simpler terms.`,
          }],
        };
      }

      if (rows.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No results found for "${query}" in patristic writings.`,
          }],
        };
      }

      const formatted = rows.map((r) => {
        const yearStr = r.death_year ? ` (d. ${r.death_year})` : "";
        const sectionStr = r.section_title ? ` > ${r.section_title}` : "";
        return `--- ${r.author_name}${yearStr}, "${r.work_title}"${sectionStr} [section_id: ${r.section_id}] ---\n${r.content}`;
      }).join("\n\n");

      return {
        content: [{
          type: "text" as const,
          text: `Found ${rows.length} results for "${query}":\n\n${formatted}`,
        }],
      };
    },
  );

  server.tool(
    "patristic_writings_by_author",
    "List all full works/treatises by a specific church father (use with patristic_writings_read to read sections)",
    {
      author: z.string().describe("Author name or partial name, e.g. 'Augustine', 'Chrysostom'"),
    },
    async ({ author }) => {
      const d = ensureWritingsDb();

      let rows: WritingsWorkRow[];
      try {
        rows = d.prepare(`
          SELECT w.id as work_id, w.title, a.name as author_name, a.death_year,
                 COUNT(s.id) as section_count
          FROM works w
          JOIN authors a ON w.author_id = a.id
          LEFT JOIN sections s ON s.work_id = w.id
          WHERE a.name LIKE ?
          GROUP BY w.id
          ORDER BY w.title
        `).all(`%${author}%`) as WritingsWorkRow[];
      } catch (err) {
        return writingsErrorResponse("Works lookup", err);
      }

      if (rows.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No works found for author matching "${author}".`,
          }],
        };
      }

      const authorName = rows[0].author_name;
      const yearStr = rows[0].death_year ? ` (d. ${rows[0].death_year})` : "";

      const lines = rows.map((r) =>
        `  [work_id: ${r.work_id}] ${r.title} (${r.section_count} sections)`
      );

      return {
        content: [{
          type: "text" as const,
          text: `${rows.length} works by ${authorName}${yearStr}:\n\n${lines.join("\n")}\n\nUse patristic_writings_read with a work_id to read sections.`,
        }],
      };
    },
  );

  server.tool(
    "patristic_writings_read",
    "Read a specific section of a patristic work by section_id or work_id. Returns full text content.",
    {
      work_id: z.number().optional().describe("Work ID (from patristic_writings_by_author). Lists sections if no section specified."),
      section_id: z.number().optional().describe("Section ID (from search results). Reads that specific section."),
      section_number: z.number().optional().describe("Section number within a work (use with work_id)"),
      start_position: z.number().optional().default(0).describe("Character offset to start reading from (for chunking long texts)"),
      max_length: z.number().optional().default(8000).describe("Max characters to return (default 8000)"),
    },
    async ({ work_id, section_id, section_number, start_position, max_length }) => {
      const d = ensureWritingsDb();

      if (section_id) {
        let row: (WritingsSearchRow & { work_title: string }) | undefined;
        try {
          row = d.prepare(`
            SELECT s.id, s.section_title, s.section_number, s.content,
                   w.title as work_title, a.name as author_name, a.death_year
            FROM sections s
            JOIN works w ON s.work_id = w.id
            JOIN authors a ON w.author_id = a.id
            WHERE s.id = ?
          `).get(section_id) as (WritingsSearchRow & { work_title: string }) | undefined;
        } catch (err) {
          return writingsErrorResponse("Section lookup", err);
        }

        if (!row) {
          return {
            content: [{ type: "text" as const, text: `Section ${section_id} not found.` }],
          };
        }

        const yearStr = row.death_year ? ` (d. ${row.death_year})` : "";
        const secTitle = row.section_title ? ` > ${row.section_title}` : "";

        return {
          content: [{
            type: "text" as const,
            text: `${row.author_name}${yearStr}, "${row.work_title}"${secTitle}\n\n${truncate(row.content, start_position, max_length)}`,
          }],
        };
      }

      if (!work_id) {
        return {
          content: [{
            type: "text" as const,
            text: "Provide either section_id or work_id. Use patristic_writings_by_author to find work IDs.",
          }],
        };
      }

      if (section_number !== undefined) {
        let row: (WritingsSearchRow & { work_title: string }) | undefined;
        try {
          row = d.prepare(`
            SELECT s.id, s.section_title, s.section_number, s.content,
                   w.title as work_title, a.name as author_name, a.death_year
            FROM sections s
            JOIN works w ON s.work_id = w.id
            JOIN authors a ON w.author_id = a.id
            WHERE s.work_id = ? AND s.section_number = ?
          `).get(work_id, section_number) as (WritingsSearchRow & { work_title: string }) | undefined;
        } catch (err) {
          return writingsErrorResponse("Section lookup", err);
        }

        if (!row) {
          return {
            content: [{
              type: "text" as const,
              text: `Section ${section_number} not found in work ${work_id}.`,
            }],
          };
        }

        const yearStr = row.death_year ? ` (d. ${row.death_year})` : "";
        const secTitle = row.section_title ? ` > ${row.section_title}` : "";

        return {
          content: [{
            type: "text" as const,
            text: `${row.author_name}${yearStr}, "${row.work_title}"${secTitle}\n\n${truncate(row.content, start_position, max_length)}`,
          }],
        };
      }

      // List sections for the work
      let sections: Array<{ id: number; section_title: string; section_number: number; content_length: number }>;
      try {
        sections = d.prepare(`
          SELECT s.id, s.section_title, s.section_number,
                 LENGTH(s.content) as content_length
          FROM sections s
          WHERE s.work_id = ?
          ORDER BY s.section_number
        `).all(work_id) as Array<{ id: number; section_title: string; section_number: number; content_length: number }>;
      } catch (err) {
        return writingsErrorResponse("Work sections lookup", err);
      }

      if (sections.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No sections found for work ${work_id}.` }],
        };
      }

      let workInfo: { title: string; author_name: string; death_year: number | null } | undefined;
      try {
        workInfo = d.prepare(`
          SELECT w.title, a.name as author_name, a.death_year
          FROM works w JOIN authors a ON w.author_id = a.id
          WHERE w.id = ?
        `).get(work_id) as { title: string; author_name: string; death_year: number | null } | undefined;
      } catch (err) {
        return writingsErrorResponse("Work lookup", err);
      }

      const header = workInfo
        ? `${workInfo.author_name}${workInfo.death_year ? ` (d. ${workInfo.death_year})` : ""}, "${workInfo.title}"`
        : `Work ${work_id}`;

      const lines = sections.map((s) => {
        const title = s.section_title || `Section ${s.section_number}`;
        const kb = (s.content_length / 1024).toFixed(1);
        return `  [section_id: ${s.id}] #${s.section_number}: ${title} (${kb} KB)`;
      });

      return {
        content: [{
          type: "text" as const,
          text: `${header}\n${sections.length} sections:\n\n${lines.join("\n")}\n\nUse section_id or section_number with work_id to read.`,
        }],
      };
    },
  );
}
