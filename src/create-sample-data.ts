/**
 * Creates sample commentary TOML and writings HTML files so you can verify
 * the server works before you have real data.
 *
 * Usage:
 *   node dist/create-sample-data.js [output-dir]
 *
 * Writes to ./sample-data by default. Pass a path to write elsewhere.
 * After running, ingest with:
 *   COMMENTARIES_DATA_PATH=./sample-data/commentaries npm run ingest
 *   WRITINGS_DATA_PATH=./sample-data/writings npm run ingest-writings
 */

import fs from "node:fs";
import path from "node:path";

const BASE = path.resolve(process.argv[2] ?? "./sample-data");
const COMMENTARIES = path.join(BASE, "commentaries");
const WRITINGS = path.join(BASE, "writings");

// ---------------------------------------------------------------------------
// Commentary sample data (verse-indexed TOML)
// ---------------------------------------------------------------------------

const commentaryAuthors: Array<{
  name: string;
  year: number;
  wiki: string;
  entries: Array<{ file: string; quotes: Array<{ quote: string; source_title: string; source_url: string }> }>;
}> = [
  {
    name: "Augustine of Hippo",
    year: 430,
    wiki: "https://en.wikipedia.org/wiki/Augustine_of_Hippo",
    entries: [
      {
        file: "Romans 9_13.toml",
        quotes: [
          {
            quote: "Jacob I have loved, but Esau I have hated. This was said before either had done anything good or evil, that the purpose of God according to election might stand.",
            source_title: "On Grace and Free Will",
            source_url: "https://ccel.org/ccel/augustine/grace",
          },
        ],
      },
      {
        file: "John 1_1.toml",
        quotes: [
          {
            quote: "In the Beginning was the Word. What beginning? He made the beginning; the beginning did not make Him.",
            source_title: "Tractates on John",
            source_url: "https://ccel.org/ccel/augustine/tractates",
          },
        ],
      },
      {
        file: "Matthew 5_3.toml",
        quotes: [
          {
            quote: "Blessed are the poor in spirit. Poverty of spirit is humility; the proud cannot belong to the kingdom of heaven.",
            source_title: "Our Lord's Sermon on the Mount",
            source_url: "https://ccel.org/ccel/augustine/sermon_mount",
          },
        ],
      },
    ],
  },
  {
    name: "John Chrysostom",
    year: 407,
    wiki: "https://en.wikipedia.org/wiki/John_Chrysostom",
    entries: [
      {
        file: "Romans 9_13.toml",
        quotes: [
          {
            quote: "God foreknew which way each man's will would lean, and according to that foreknowledge He called and elected, having ordered all things to work together for good.",
            source_title: "Homilies on Romans",
            source_url: "https://ccel.org/ccel/chrysostom/hom_romans",
          },
        ],
      },
      {
        file: "John 1_1.toml",
        quotes: [
          {
            quote: "In the beginning was the Word — not 'became,' not 'was created,' but was eternally. He who always is needs no beginning.",
            source_title: "Homilies on John",
            source_url: "https://ccel.org/ccel/chrysostom/hom_john",
          },
        ],
      },
    ],
  },
  {
    name: "Origen of Alexandria",
    year: 253,
    wiki: "https://en.wikipedia.org/wiki/Origen",
    entries: [
      {
        file: "Romans 9_13.toml",
        quotes: [
          {
            quote: "The election of Jacob before his birth shows that God's purposes are not on account of works but of calling, and that the calling is according to foreknowledge.",
            source_title: "Commentary on Romans",
            source_url: "https://ccel.org/ccel/origen/romans",
          },
        ],
      },
      {
        file: "John 1_1.toml",
        quotes: [
          {
            quote: "The beginning in which the Word was, is wisdom. For the Word was in the beginning, as wisdom is the beginning of the ways of God.",
            source_title: "Commentary on John",
            source_url: "https://ccel.org/ccel/origen/john",
          },
        ],
      },
    ],
  },
];

function writeCommentaryData(): void {
  for (const author of commentaryAuthors) {
    const dir = path.join(COMMENTARIES, author.name);
    fs.mkdirSync(dir, { recursive: true });

    // metadata.toml
    const meta = `default_year = ${author.year}\nwiki = "${author.wiki}"\n`;
    fs.writeFileSync(path.join(dir, "metadata.toml"), meta);

    // verse files
    for (const entry of author.entries) {
      const lines: string[] = [];
      for (const q of entry.quotes) {
        lines.push(`[[commentary]]`);
        lines.push(`quote = ${JSON.stringify(q.quote)}`);
        lines.push(`source_title = ${JSON.stringify(q.source_title)}`);
        lines.push(`source_url = ${JSON.stringify(q.source_url)}`);
        lines.push("");
      }
      fs.writeFileSync(path.join(dir, entry.file), lines.join("\n"));
    }
  }
  console.log(`Wrote commentaries for ${commentaryAuthors.length} authors to ${COMMENTARIES}`);
}

// ---------------------------------------------------------------------------
// Writings sample data (chapter-split HTML)
// ---------------------------------------------------------------------------

const writingsAuthors: Array<{
  name: string;
  year: number;
  wiki: string;
  works: Array<{ dir: string; title: string; chapters: Array<{ file: string; title: string; body: string }> }>;
}> = [
  {
    name: "Augustine of Hippo",
    year: 430,
    wiki: "https://en.wikipedia.org/wiki/Augustine_of_Hippo",
    works: [
      {
        dir: "Confessions",
        title: "Confessions",
        chapters: [
          {
            file: "Book 1.html",
            title: "Book I",
            body: `<H2><FONT>Book I</FONT></H2>
<p>Thou madest us for Thyself, and our heart is restless, until it repose in Thee.
Grant me, Lord, to know and understand which is first, to call on Thee or to praise Thee?
And, again, to know Thee or to call on Thee?</p>
<p>For who can call on Thee, not knowing Thee? For he that knoweth Thee not,
may call on Thee as other than Thou art. Or is it rather, that we call on Thee that
we may know Thee?</p>`,
          },
          {
            file: "Book 2.html",
            title: "Book II",
            body: `<H2><FONT>Book II</FONT></H2>
<p>I will now call to mind my past foulness, and the carnal corruptions of my soul;
not because I love them, but that I may love Thee, O my God. For love of Thy love
I do it; reviewing my most wicked ways in the very bitterness of my remembrance.</p>`,
          },
        ],
      },
      {
        dir: "On the Trinity",
        title: "On the Trinity",
        chapters: [
          {
            file: "Book 1.html",
            title: "Book I — The Rule of Faith",
            body: `<H2><FONT>Book I — The Rule of Faith</FONT></H2>
<p>The following dissertation concerning the Trinity, as the reader ought to be informed,
has been written in order to guard against the sophistries of those who disdain to
begin with faith, and are deceived by a crude and perverse love of reason.</p>`,
          },
        ],
      },
    ],
  },
  {
    name: "Irenaeus of Lyon",
    year: 202,
    wiki: "https://en.wikipedia.org/wiki/Irenaeus",
    works: [
      {
        dir: "Against Heresies",
        title: "Against Heresies",
        chapters: [
          {
            file: "Book 1 Chapter 1.html",
            title: "Chapter I — Their Manner of Working Conversions",
            body: `<H2><FONT>Chapter I — Their Manner of Working Conversions</FONT></H2>
<p>Inasmuch as certain men have set the truth aside, and bring in lying words and
vain genealogies, which, as the apostle says, minister questions rather than godly
edifying which is in faith, and by means of their craftily-constructed plausibilities
draw away the minds of the inexperienced and take them captive.</p>`,
          },
          {
            file: "Book 1 Chapter 2.html",
            title: "Chapter II — Their Doctrine of a Pleroma of Thirty Aeons",
            body: `<H2><FONT>Chapter II — Their Doctrine of a Pleroma of Thirty Aeons</FONT></H2>
<p>They maintain that in the invisible and ineffable heights above there exists a certain
perfect, pre-existent Aeon, whom they call Proarche, Propator, and Bythus. He is invisible
and incomprehensible.</p>`,
          },
        ],
      },
    ],
  },
];

function writeWritingsData(): void {
  for (const author of writingsAuthors) {
    const authorDir = path.join(WRITINGS, author.name);
    fs.mkdirSync(authorDir, { recursive: true });

    const meta = `default_year = ${author.year}\nwiki = "${author.wiki}"\n`;
    fs.writeFileSync(path.join(authorDir, "metadata.toml"), meta);

    for (const work of author.works) {
      const workDir = path.join(authorDir, work.dir);
      fs.mkdirSync(workDir, { recursive: true });

      for (const ch of work.chapters) {
        const html = `<!DOCTYPE html>\n<html><body>\n${ch.body}\n</body></html>\n`;
        fs.writeFileSync(path.join(workDir, ch.file), html);
      }
    }
  }
  console.log(`Wrote writings for ${writingsAuthors.length} authors to ${WRITINGS}`);
}

// ---------------------------------------------------------------------------

writeCommentaryData();
writeWritingsData();
console.log("\nNext steps:");
console.log(`  set COMMENTARIES_DATA_PATH=${COMMENTARIES}`);
console.log(`  set WRITINGS_DATA_PATH=${WRITINGS}`);
console.log("  npm run ingest");
console.log("  npm run ingest-writings");
