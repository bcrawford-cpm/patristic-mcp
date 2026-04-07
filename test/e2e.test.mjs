import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DUMMY_COMMENTARIES_TOML = `
[[commentary]]
quote = "Jacob have I loved."
source_title = "Book"
source_url = "http://example.com"
`;

test("e2e mcp server capabilities", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-e2e-test-"));
  const commDir = path.join(tempDir, "commentaries");
  const writDir = path.join(tempDir, "writings");
  const patristicDbPath = path.join(tempDir, "patristic.db");
  const writingsDbPath = path.join(tempDir, "writings.db");
  
  await fs.mkdir(commDir, { recursive: true });
  const commAuthorDir = path.join(commDir, "Augustine of Hippo (430)");
  await fs.mkdir(commAuthorDir, { recursive: true });
  
  await fs.mkdir(writDir, { recursive: true }); // Just need dummy dir
  
  // Write dummy data
  await fs.writeFile(path.join(commAuthorDir, "Romans 9_15.toml"), DUMMY_COMMENTARIES_TOML);
  
  // ingest it first using the compiled scripts, injecting standard DB vars
  const { execFileSync } = await import("child_process");
  execFileSync("node", ["dist/ingest.js"], {
    env: { 
      ...process.env, 
      COMMENTARIES_DATA_PATH: commDir, 
      PATRISTIC_DB_PATH: patristicDbPath 
    }
  });

  execFileSync("node", ["dist/ingest-writings.js"], {
    env: { 
      ...process.env, 
      WRITINGS_DATA_PATH: writDir, 
      WRITINGS_DB_PATH: writingsDbPath 
    }
  });

  // Start the server with the SDK client's Stdio Transport
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    env: {
      ...process.env,
      PATRISTIC_DB_PATH: patristicDbPath,
      WRITINGS_DB_PATH: writingsDbPath
    } // it should be completely isolated
  });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  try {
    // 1. Check tools list
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);
    assert.ok(toolNames.includes("patristic_by_verse"), "Server should have patristic_by_verse tool");
    assert.ok(toolNames.includes("patristic_writings_read"), "Server should have patristic_writings_read tool");

    // 2. Call a tool
    const result = await client.callTool({
      name: "patristic_by_verse",
      arguments: { reference: "Romans 9:15" },
    });

    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /Jacob have I loved/);
    assert.match(result.content[0].text, /Augustine/);
  } finally {
    // Shutdown server
    await transport.close();
  }
});