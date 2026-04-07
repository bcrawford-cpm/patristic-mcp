# patristic-mcp

An MCP (Model Context Protocol) server that exposes patristic Bible commentaries and early church father writings to AI assistants. Query verse-level commentary snippets from 300+ church fathers, or full-text-search and read complete works like Augustine's *City of God*, Irenaeus' *Against Heresies*, and Origen's *On First Principles*.

## Tools

| Tool | Description |
|------|-------------|
| `patristic_by_verse` | Get all commentaries on a Bible verse (e.g. `Romans 9:13`, `Jn 1:1`) |
| `patristic_by_author` | Get commentaries by a specific author, optionally filtered by book or verse |
| `patristic_search` | Full-text search across all 74,000+ commentary snippets |
| `patristic_list_authors` | List all authors with commentary counts and death years |
| `patristic_writings_search` | Full-text search across complete patristic works (treatises, letters, etc.) |
| `patristic_writings_by_author` | List all works by a specific author |
| `patristic_writings_read` | Read a section of a work by section ID (supports `start_position` for chunking) |

## How It Works

- **Commentary database** (`patristic.db`): Verse-indexed SQLite table. Each row is a commentary snippet on a specific Bible verse, with author, source title, URL, and death year. Sourced from TOML files in the Commentaries-Database repo.
- **Writings database** (`writings.db`): Hierarchical SQLite tables (authors → works → sections). Each section is one HTML chapter/letter converted to plain text. FTS5 with Porter stemming enables full-text search across 10,000+ sections.
- **Ingest pipeline**: `ingest.ts` reads `Book Chapter_Verse.toml` files; `ingest-writings.ts` reads HTML works with `metadata.toml` author metadata.
- **MCP server**: `server.ts` registers all tools using `@modelcontextprotocol/sdk` over stdio transport. Compiled output is `dist/server.js`.

## Setup

### 1. Install and Build

```bash
npm install
npm run build
```

### 2. Set Up Data

**Option A — Sample data (for testing)**

```bash
npm run create-sample-data
# Follow the printed instructions to set env vars, then run:
npm run ingest
npm run ingest-writings
```

**Option B — Full dataset (~74k commentaries, ~10k writing sections)**

Clone both source repos into the project directory:

```bash
git clone --depth=1 https://github.com/HistoricalChristianFaith/Commentaries-Database commentaries-data
git clone --depth=1 https://github.com/HistoricalChristianFaith/Writings-Database writings-data
```

> **Windows note:** The Writings-Database contains 16 files with `:` in their names, which Windows disallows. Git checkout will fail mid-way. To work around this, after cloning run `node extract-writings.mjs` (see below) before ingesting.

<details>
<summary>Windows workaround: extract-writings.mjs</summary>

Create a file named `extract-writings.mjs` in the project root with the following content, then run `node extract-writings.mjs`. It streams all valid blobs from the git object store and writes them to disk, skipping the 16 files with illegal characters.

```js
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

const REPO = "./writings-data";
const ILLEGAL = /[:<>"|?*]/;

const lines = execFileSync("git", ["-C", REPO, "ls-tree", "-r", "--format=%(objectname) %(path)", "HEAD"], { encoding: "utf8" }).trim().split("\n");

const entries = lines.map(l => { const sp = l.indexOf(" "); return { hash: l.slice(0, sp), filePath: l.slice(sp + 1) }; }).filter(e => !ILLEGAL.test(e.filePath));

const catFile = spawn("git", ["-C", REPO, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = Buffer.alloc(0);
let i = 0;

catFile.stdin.write(entries.map(e => e.hash).join("\n") + "\n");
catFile.stdin.end();

catFile.stdout.on("data", chunk => { buf = Buffer.concat([buf, chunk]); process.stdout.write("."); });
catFile.stdout.on("end", () => {
  let pos = 0;
  for (const entry of entries) {
    const nl = buf.indexOf(10, pos); const header = buf.slice(pos, nl).toString(); pos = nl + 1;
    const size = parseInt(header.split(" ")[2]);
    const content = buf.slice(pos, pos + size); pos += size + 1;
    const absPath = path.join(REPO, entry.filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
    i++;
  }
  console.log(`\nExtracted ${i} files.`);
});
```
</details>

Then ingest both datasets:

If you cloned into `./commentaries-data` and `./writings-data`, the ingest scripts now use those paths by default. Re-running either ingest command rebuilds the corresponding SQLite database instead of appending duplicate rows.

**PowerShell:**
```powershell
$env:COMMENTARIES_DATA_PATH = ".\commentaries-data"
node dist/ingest.js

$env:WRITINGS_DATA_PATH = ".\writings-data"
node dist/ingest-writings.js
```

**bash/zsh:**
```bash
COMMENTARIES_DATA_PATH=./commentaries-data node dist/ingest.js
WRITINGS_DATA_PATH=./writings-data node dist/ingest-writings.js
```

### 3. Run the Server

```bash
npm start
```

### 4. Running Tests

The server includes a fast, native `node:test` suite that automatically runs isolated databases by testing environment variables `PATRISTIC_DB_PATH` and `WRITINGS_DB_PATH`.

```bash
npm test
```

## MCP Client Configuration

This is a pure stdio MCP server (no browser UI required). Run `npm run build` first, then add this to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json` or LM Studio's MCP settings):

```json
{
  "mcpServers": {
    "patristic": {
      "command": "node",
      "args": ["C:/path/to/dist/server.js"]
    }
  }
}
```

> **Important:** Point to `dist/server.js` (the compiled output), not `src/server.ts`. Node.js cannot run TypeScript files directly.

## Data Sources

- **Commentaries**: [HistoricalChristianFaith/Commentaries-Database](https://github.com/HistoricalChristianFaith/Commentaries-Database) — 317 authors, 74,378 entries
- **Writings**: [HistoricalChristianFaith/Writings-Database](https://github.com/HistoricalChristianFaith/Writings-Database) — 338 authors, 810 works, 10,251 sections

All source material is in the public domain.

### Pull Requests

See a typo/mistake? Please send a pull request to fix it! 

Know of a work you feel should be added to this collection? Open a pull request!