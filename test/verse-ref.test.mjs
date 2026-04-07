import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeBook, parseFilenameRef, parseVerseRef } = require("../dist/verse-ref.js");

test("normalizeBook handles abbreviations and full names", () => {
  assert.equal(normalizeBook("Rom"), "Romans");
  assert.equal(normalizeBook("1 Corinthians"), "1 Corinthians");
  assert.equal(normalizeBook("Jn."), "John");
  assert.equal(normalizeBook("Unknown"), null);
});

test("parseVerseRef supports ranged references", () => {
  assert.deepEqual(parseVerseRef("Romans 9:13-14"), {
    book: "Romans",
    chapter: 9,
    verseStart: 13,
    verseEnd: 14,
  });
});

test("parseVerseRef rejects malformed references", () => {
  assert.equal(parseVerseRef("Romans nine:13"), null);
  assert.equal(parseVerseRef(""), null);
});

test("parseFilenameRef converts filename format into verse ranges", () => {
  assert.deepEqual(parseFilenameRef("Romans 9_13-14.toml"), {
    book: "Romans",
    chapter: 9,
    verseStart: 13,
    verseEnd: 14,
  });
});