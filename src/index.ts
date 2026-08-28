#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

// Read version from package.json so McpServer.version stays in sync with npm.
function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "mcppedia", version: readPackageVersion() },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
        logging: {},
      },
      instructions:
        "Catalog of 17K+ MCP servers with security, maintenance, efficiency, documentation, and compatibility scores. " +
        "Use `search_servers` or `get_trending` to discover, `get_server_details` (with security=true) to evaluate, " +
        "`compare_servers` to pick between candidates, `get_install_config` to hand off setup. " +
        "Prompts: `audit-my-mcp-setup`, `find-alternative`, `security-review`.",
    }
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

async function main() {
  const mode = process.argv.includes("--http") ? "http" : "stdio";
  const port = parseInt(process.env.PORT || "8080", 10);

  if (mode === "http") {
    const MAX_SESSIONS = 100;
    const SESSION_TTL_MS = 30 * 60 * 1000;
    const sessions = new Map<
      string,
      { transport: StreamableHTTPServerTransport; createdAt: number }
    >();
    const corsOrigin = process.env.CORS_ORIGIN || "*";

    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL_MS) {
          session.transport.close();
          sessions.delete(id);
        }
      }
    }, 5 * 60 * 1000);

    const httpServer = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id, mcp-protocol-version"
      );
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
        return;
      }

      if (req.url !== "/mcp") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST" && !sessionId) {
        if (sessions.size >= MAX_SESSIONS) {
          res.writeHead(503);
          res.end("Too many sessions. Try again later.");
          return;
        }

        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, createdAt: Date.now() });
            },
            onsessionclosed: (id) => {
              sessions.delete(id);
            },
          });
          const server = buildServer();
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (err) {
          console.error("Failed to bootstrap session:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
              })
            );
          } else {
            res.end();
          }
        }
        return;
      }

      if (sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
          await session.transport.handleRequest(req, res);
        } else {
          res.writeHead(404);
          res.end("Session not found");
        }
        return;
      }

      res.writeHead(400);
      res.end("Missing mcp-session-id header");
    });

    httpServer.listen(port, () => {
      console.error(`MCPpedia server (HTTP) listening on port ${port}`);
    });

    // Graceful shutdown — close active sessions before exiting.
    const shutdown = (signal: string) => {
      console.error(`Received ${signal}, shutting down...`);
      for (const [id, session] of sessions) {
        session.transport.close();
        sessions.delete(id);
      }
      httpServer.close(() => process.exit(0));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } else {
    const transport = new StdioServerTransport();
    const server = buildServer();
    await server.connect(transport);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
