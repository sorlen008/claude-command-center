import { describe, it, expect } from "vitest";

// We need to test the parsers that are not directly exported.
// Import the modules and test their exported scanner functions indirectly,
// or test the patterns they use.

// Since parseSimpleYaml and parseGraphConfigYaml are not exported,
// we test the exported functions that use them, and test the helper functions
// that ARE exported (inferSubType, extractPorts via the scanner).

// For now, test the MCP scanner's type guard and DB pattern matching
import { isMCPServerConfig } from "../server/scanner/mcp-scanner";

describe("isMCPServerConfig", () => {
  it("accepts config with command", () => {
    expect(isMCPServerConfig({ command: "npx", args: ["-y", "server"] })).toBe(true);
  });

  it("accepts config with url", () => {
    expect(isMCPServerConfig({ url: "http://localhost:3000" })).toBe(true);
  });

  it("rejects null", () => {
    expect(isMCPServerConfig(null)).toBe(false);
  });

  it("rejects array", () => {
    expect(isMCPServerConfig(["not", "a", "config"])).toBe(false);
  });

  it("rejects object without command or url", () => {
    expect(isMCPServerConfig({ name: "test" })).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isMCPServerConfig("string")).toBe(false);
    expect(isMCPServerConfig(42)).toBe(false);
    expect(isMCPServerConfig(undefined)).toBe(false);
  });
});

// Test the DB URL patterns used by extractDbNodesFromMcps
describe("DB URL pattern matching", () => {
  const DB_URL_PATTERNS = [
    { pattern: /postgresql:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, label: "PostgreSQL" },
    { pattern: /postgres:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, label: "PostgreSQL" },
    { pattern: /mysql:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, label: "MySQL" },
    { pattern: /mongodb(\+srv)?:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, label: "MongoDB" },
    { pattern: /redis:\/\/([^@]+@)?([^:/]+)(:\d+)?\/?/, label: "Redis" },
    { pattern: /amqp:\/\/([^@]+@)?([^:/]+)(:\d+)?\//, label: "RabbitMQ" },
  ];

  it("matches PostgreSQL URLs", () => {
    const url = "postgresql://user:pass@localhost:5432/mydb";
    const match = url.match(DB_URL_PATTERNS[0].pattern);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("localhost");
    expect(match![4]).toBe("mydb");
  });

  it("matches postgres:// (short form)", () => {
    const url = "postgres://localhost:5434/myappdb";
    const match = url.match(DB_URL_PATTERNS[1].pattern);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("localhost");
    expect(match![4]).toBe("myappdb");
  });

  it("matches MySQL URLs", () => {
    const url = "mysql://root:secret@db-host:3306/appdb";
    const match = url.match(DB_URL_PATTERNS[2].pattern);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("db-host");
  });

  it("matches MongoDB URLs", () => {
    const url = "mongodb://admin:pass@mongo.example.com:27017/orders";
    const match = url.match(DB_URL_PATTERNS[3].pattern);
    expect(match).not.toBeNull();
  });

  it("matches MongoDB+srv URLs", () => {
    const url = "mongodb+srv://user:pass@cluster.mongodb.net/mydb";
    const match = url.match(DB_URL_PATTERNS[3].pattern);
    expect(match).not.toBeNull();
  });

  it("matches Redis URLs", () => {
    const url = "redis://localhost:6379/";
    const match = url.match(DB_URL_PATTERNS[4].pattern);
    expect(match).not.toBeNull();
  });

  it("matches RabbitMQ URLs", () => {
    const url = "amqp://guest:guest@rabbitmq:5672/";
    const match = url.match(DB_URL_PATTERNS[5].pattern);
    expect(match).not.toBeNull();
  });

  it("does not match regular HTTP URLs", () => {
    const url = "https://api.example.com/v1/users";
    for (const { pattern } of DB_URL_PATTERNS) {
      expect(url.match(pattern)).toBeNull();
    }
  });
});
