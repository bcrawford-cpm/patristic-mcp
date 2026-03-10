import fs from "node:fs";
import path from "node:path";
import * as toml from "@iarna/toml";
import { getWritingsDb, initWritingsSchema } from "./db.js";
import type Database from "better-sqlite3";

const REPO_PATH = "/tmp/writings-db";

const SKIP_DIRS = new Set([".", "..", ".git"]);
const SKIP_FILES = new Set(["metadata.toml", "menu.html", "highlight.js"]);

interface AuthorMeta {
  default_year?: number;
  wiki?: string;
}

function loadMetadata(authorDir: string): AuthorMeta {
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

function stripHtml(html: string): string {
  // Remove script/style blocks entirely
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Replace <br>, <p>, <div>, heading, <li> tags with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&mdash;/g, "--");
  text = text.replace(/&ndash;/g, "-");
  text = text.replace(/&rsquo;/g, "'");
  text = text.replace(/&lsquo;/g, "'");
  text = text.replace(/&rdquo;/g, '"');
  text = text.replace(/&ldquo;/g, '"');
  text = text.replace(/&#\d+;/g, "");
  // Collapse whitespace but preserve paragraph breaks
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

/**
 * Extract chapter sections from HTML content.
 * Looks for chapter headings (H2, H3 with "Chapter" or numbered patterns).
 * Falls back to treating entire content as one section.
 */
function extractSections(html: string): Array<{ title: string; number: number; content: string }> {
  // Try splitting on chapter headings
  const chapterPattern = /<H[23][^>]*>.*?<FONT[^>]*>(.*?)<\/FONT>.*?<\/H[23]>/gi;
  const matches: Array<{ title: string; index: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = chapterPattern.exec(html)) !== null) {
    const title = stripHtml(m[1]).trim();
    if (title.length > 0) {
      matches.push({ title, index: m.index });
    }
  }

  if (matches.length <= 1) {
    // Try alternative heading patterns
    const altPattern = /<H[234][^>]*>(.*?)<\/H[234]>/gi;
    const altMatches: Array<{ title: string; index: number }> = [];
    while ((m = altPattern.exec(html)) !== null) {
      const title = stripHtml(m[1]).trim();
      if (title.length > 2 && !title.startsWith("Footnote")) {
        altMatches.push({ title, index: m.index });
      }
    }
    if (altMatches.length > 1) {
      matches.length = 0;
      matches.push(...altMatches);
    }
  }

  if (matches.length === 0) {
    const fullText = stripHtml(html);
    if (fullText.length < 50) {
      return [];
    }
    return [{ title: "", number: 0, content: fullText }];
  }

  const sections: Array<{ title: string; number: number; content: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const chunk = html.slice(start, end);
    const content = stripHtml(chunk);
    if (content.length < 20) {
      continue;
    }
    sections.push({
      title: matches[i].title,
      number: i + 1,
      content,
    });
  }

  return sections;
}

/**
 * Recursively collect all HTML files from a directory tree.
 */
function collectHtmlFiles(dir: string, relBase: string): Array<{ absPath: string; relPath: string }> {
  const results: Array<{ absPath: string; relPath: string }> = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) {
      continue;
    }
    const absPath = path.join(dir, entry.name);
    const relPath = path.join(relBase, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectHtmlFiles(absPath, relPath));
    } else if (entry.name.endsWith(".html")) {
      results.push({ absPath, relPath });
    }
  }

  return results;
}

/**
 * Derive work title and optional book/section info from file path relative to author dir.
 * Examples:
 *   "Confessions/Book 1.html" -> work="Confessions", section from file
 *   "On Lying.html" -> work="On Lying", content is the whole file
 *   "Homilies/On Matthew/Homily 1.html" -> work="Homilies - On Matthew", section from file
 */
function deriveWorkInfo(relPath: string): { workTitle: string; sectionHint: string | null } {
  const parts = relPath.replace(/\.html$/, "").split(path.sep);
  if (parts.length === 1) {
    return { workTitle: parts[0], sectionHint: null };
  }
  // Use all directory parts as the work title, last part as section hint
  const workParts = parts.slice(0, -1);
  const sectionHint = parts[parts.length - 1];
  return {
    workTitle: workParts.join(" - "),
    sectionHint,
  };
}

function ingestWritings(): void {
  const db = getWritingsDb();
  initWritingsSchema(db);

  const insertAuthor = db.prepare(
    `INSERT OR IGNORE INTO authors (name, death_year, wiki_url) VALUES (?, ?, ?)`
  );
  const getAuthorId = db.prepare(`SELECT id FROM authors WHERE name = ?`);
  const insertWork = db.prepare(
    `INSERT OR IGNORE INTO works (author_id, title, source_path) VALUES (?, ?, ?)`
  );
  const getWorkId = db.prepare(`SELECT id FROM works WHERE author_id = ? AND title = ?`);
  const insertSection = db.prepare(
    `INSERT INTO sections (work_id, section_title, section_number, content) VALUES (?, ?, ?, ?)`
  );

  const topEntries = fs.readdirSync(REPO_PATH, { withFileTypes: true });
  const authorDirs = topEntries.filter(
    (e) => e.isDirectory() && !SKIP_DIRS.has(e.name)
  );

  let totalAuthors = 0;
  let totalWorks = 0;
  let totalSections = 0;
  let skippedEmpty = 0;

  const insertAll = db.transaction(() => {
    for (const dir of authorDirs) {
      const authorName = dir.name;
      const authorPath = path.join(REPO_PATH, authorName);
      const meta = loadMetadata(authorPath);

      insertAuthor.run(authorName, meta.default_year ?? null, meta.wiki ?? null);
      const authorRow = getAuthorId.get(authorName) as { id: number } | undefined;
      if (!authorRow) {
        continue;
      }
      const authorId = authorRow.id;
      totalAuthors++;

      const htmlFiles = collectHtmlFiles(authorPath, "");

      // Group files by work
      const workFiles = new Map<string, Array<{ absPath: string; sectionHint: string | null }>>();

      for (const { absPath, relPath } of htmlFiles) {
        const { workTitle, sectionHint } = deriveWorkInfo(relPath);
        if (!workFiles.has(workTitle)) {
          workFiles.set(workTitle, []);
        }
        workFiles.get(workTitle)!.push({ absPath, sectionHint });
      }

      for (const [workTitle, files] of workFiles) {
        const sourcePath = `${authorName}/${workTitle}`;
        insertWork.run(authorId, workTitle, sourcePath);
        const workRow = getWorkId.get(authorId, workTitle) as { id: number } | undefined;
        if (!workRow) {
          continue;
        }
        const workId = workRow.id;
        totalWorks++;

        // Sort files naturally (Book 1 before Book 10)
        files.sort((a, b) => {
          const numA = a.sectionHint?.match(/(\d+)/)?.[1];
          const numB = b.sectionHint?.match(/(\d+)/)?.[1];
          if (numA && numB) {
            return parseInt(numA, 10) - parseInt(numB, 10);
          }
          return (a.sectionHint ?? "").localeCompare(b.sectionHint ?? "");
        });

        let sectionCounter = 0;

        for (const { absPath, sectionHint } of files) {
          let raw: string;
          try {
            raw = fs.readFileSync(absPath, "utf-8");
          } catch {
            continue;
          }

          if (files.length === 1 && !sectionHint) {
            // Monolithic file: try to extract chapter sections from HTML
            const sections = extractSections(raw);
            if (sections.length === 0) {
              const text = stripHtml(raw);
              if (text.length < 50) {
                skippedEmpty++;
                continue;
              }
              insertSection.run(workId, workTitle, 0, text);
              totalSections++;
            } else {
              for (const sec of sections) {
                insertSection.run(workId, sec.title, sec.number, sec.content);
                totalSections++;
              }
            }
          } else {
            // Multi-file work: each file is a section
            sectionCounter++;
            const text = stripHtml(raw);
            if (text.length < 50) {
              skippedEmpty++;
              continue;
            }
            const title = sectionHint ?? `Section ${sectionCounter}`;
            insertSection.run(workId, title, sectionCounter, text);
            totalSections++;
          }
        }
      }
    }
  });

  insertAll();
  db.close();

  console.log("Writings ingestion complete:");
  console.log(`  Authors: ${totalAuthors}`);
  console.log(`  Works: ${totalWorks}`);
  console.log(`  Sections: ${totalSections}`);
  console.log(`  Skipped (empty): ${skippedEmpty}`);
}

ingestWritings();
