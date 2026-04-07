import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { parseVerseRef } = require("../dist/verse-ref.js");
const { findCommentariesByVerse } = require("../dist/commentary-tools.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patristic-mcp-test-"));
}

function runNodeScript(scriptPath, args = [], env = {}) {
  execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "pipe",
  });
}

function createSampleData(baseDir) {
  runNodeScript(path.join(repoRoot, "dist", "create-sample-data.js"), [baseDir]);
}

function writeRangeFixture(commentariesDir) {
  const authorDir = path.join(commentariesDir, "Augustine of Hippo");
  const filePath = path.join(authorDir, "Romans 9_13-14.toml");
  const content = [
    "[[commentary]]",
    'quote = "This range fixture covers both verses to verify overlap queries."',
    'source_title = "Test Fixture"',
    'source_url = "https://example.invalid/range"',
    "",
  ].join("\n");
  fs.writeFileSync(filePath, content, "utf8");
}

function getCount(dbPath, tableName) {
  const db = new Database(dbPath);
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
    return row.count;
  } finally {
    db.close();
  }
}

test("commentary and writings ingest remain idempotent across reruns", async () => {
  const tempDir = makeTempDir();
  const sampleDir = path.join(tempDir, "sample-data");
  const commentariesDir = path.join(sampleDir, "commentaries");
  const writingsDir = path.join(sampleDir, "writings");
  const commentaryDbPath = path.join(tempDir, "patristic.db");
  const writingsDbPath = path.join(tempDir, "writings.db");

  try {
    createSampleData(sampleDir);

    runNodeScript(path.join(repoRoot, "dist", "ingest.js"), [], {
      COMMENTARIES_DATA_PATH: commentariesDir,
      PATRISTIC_DB_PATH: commentaryDbPath,
    });
    const commentaryCountAfterFirst = getCount(commentaryDbPath, "commentaries");

    runNodeScript(path.join(repoRoot, "dist", "ingest.js"), [], {
      COMMENTARIES_DATA_PATH: commentariesDir,
      PATRISTIC_DB_PATH: commentaryDbPath,
    });
    const commentaryCountAfterSecond = getCount(commentaryDbPath, "commentaries");

    runNodeScript(path.join(repoRoot, "dist", "ingest-writings.js"), [], {
      WRITINGS_DATA_PATH: writingsDir,
      WRITINGS_DB_PATH: writingsDbPath,
    });
    const sectionsAfterFirst = getCount(writingsDbPath, "sections");

    runNodeScript(path.join(repoRoot, "dist", "ingest-writings.js"), [], {
      WRITINGS_DATA_PATH: writingsDir,
      WRITINGS_DB_PATH: writingsDbPath,
    });
    const sectionsAfterSecond = getCount(writingsDbPath, "sections");

    assert.equal(commentaryCountAfterFirst, commentaryCountAfterSecond);
    assert.ok(commentaryCountAfterFirst > 0);
    assert.equal(sectionsAfterFirst, sectionsAfterSecond);
    assert.ok(sectionsAfterFirst > 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("range lookups include overlapping verse-span commentaries", async () => {
  const tempDir = makeTempDir();
  const sampleDir = path.join(tempDir, "sample-data");
  const commentariesDir = path.join(sampleDir, "commentaries");
  const commentaryDbPath = path.join(tempDir, "patristic.db");

  try {
    createSampleData(sampleDir);
    writeRangeFixture(commentariesDir);

    runNodeScript(path.join(repoRoot, "dist", "ingest.js"), [], {
      COMMENTARIES_DATA_PATH: commentariesDir,
      PATRISTIC_DB_PATH: commentaryDbPath,
    });

    const db = new Database(commentaryDbPath, { readonly: true });
    try {
      const verse14Rows = findCommentariesByVerse(db, parseVerseRef("Romans 9:14"), 20);
      assert.equal(verse14Rows.length, 1);
      assert.equal(verse14Rows[0].verse_start, 13);
      assert.equal(verse14Rows[0].verse_end, 14);

      const rangeRows = findCommentariesByVerse(db, parseVerseRef("Romans 9:13-14"), 20);
      assert.equal(rangeRows.length, 4);
      assert.ok(rangeRows.some((row) => row.verse_start === 13 && row.verse_end === 14));
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});