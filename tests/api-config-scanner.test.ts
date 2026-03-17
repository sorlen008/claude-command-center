import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Create a temp directory to act as HOME for the scanner
const tmpHome = path.join(os.tmpdir(), "cc-api-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
fs.mkdirSync(tmpHome, { recursive: true });

// We need COMMAND_CENTER_DATA set so db.ts doesn't write into the real home dir
const tmpData = path.join(tmpHome, ".cc-data");
process.env.COMMAND_CENTER_DATA = tmpData;

// Mock the utils module to override HOME / CLAUDE_DIR / fileExists so the scanner
// looks in our temp directory instead of the real home directory.
vi.mock("../server/scanner/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/scanner/utils")>();
  const homePath = tmpHome.replace(/\\/g, "/");
  const claudePath = homePath + "/.claude";
  return {
    ...original,
    HOME: homePath,
    CLAUDE_DIR: claudePath,
    normPath: (...args: string[]) => path.join(...args).replace(/\\/g, "/"),
    fileExists: (filePath: string) => {
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    },
  };
});

// Dynamic import after mocks are set up
const { scanApiConfig } = await import("../server/scanner/api-config-scanner");

const SAMPLE_YAML = `# API Configuration
apis:
  - id: twilio
    name: Twilio
    description: Voice and SMS communication
    baseUrl: https://api.twilio.com
    authMethod: api-key
    category: voice
    status: active
    website: https://twilio.com
    color: "#F22F46"
    envKeys:
      - TWILIO_ACCOUNT_SID
      - TWILIO_AUTH_TOKEN
    consumers:
      - project-automation
      - project-voice

  - id: vapi
    name: Vapi.ai
    description: AI voice assistant platform
    baseUrl: https://api.vapi.ai
    authMethod: api-key
    category: ai-llm
    status: active
    envKeys:
      - VAPI_API_KEY
    consumers:
      - project-voice
      - project-webhook

  - id: openai
    name: OpenAI
    description: Language model API
    authMethod: api-key
    category: ai-llm
    status: inactive
    consumers:
      - project-chat
`;

describe("scanApiConfig", () => {
  beforeEach(() => {
    // Clean up any yaml files from previous test
    const yamlPath = path.join(tmpHome, "apis-config.yaml");
    const ymlPath = path.join(tmpHome, "apis-config.yml");
    if (fs.existsSync(yamlPath)) fs.unlinkSync(yamlPath);
    if (fs.existsSync(ymlPath)) fs.unlinkSync(ymlPath);
  });

  afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns empty results when no config file exists", () => {
    const result = scanApiConfig();
    expect(result.apis).toHaveLength(0);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("parses the correct number of APIs", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    expect(result.apis).toHaveLength(3);
  });

  it("parses API properties correctly", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    const twilio = result.apis.find((a) => a.id === "twilio");
    expect(twilio).toBeDefined();
    expect(twilio!.name).toBe("Twilio");
    expect(twilio!.description).toBe("Voice and SMS communication");
    expect(twilio!.baseUrl).toBe("https://api.twilio.com");
    expect(twilio!.authMethod).toBe("api-key");
    expect(twilio!.category).toBe("voice");
    expect(twilio!.status).toBe("active");
    expect(twilio!.website).toBe("https://twilio.com");
  });

  it("parses consumers as arrays", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    const twilio = result.apis.find((a) => a.id === "twilio");
    expect(twilio!.consumers).toEqual(["project-automation", "project-voice"]);

    const vapi = result.apis.find((a) => a.id === "vapi");
    expect(vapi!.consumers).toEqual(["project-voice", "project-webhook"]);

    const openai = result.apis.find((a) => a.id === "openai");
    expect(openai!.consumers).toEqual(["project-chat"]);
  });

  it("parses envKeys as arrays", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    const twilio = result.apis.find((a) => a.id === "twilio");
    expect(twilio!.envKeys).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);

    const vapi = result.apis.find((a) => a.id === "vapi");
    expect(vapi!.envKeys).toEqual(["VAPI_API_KEY"]);
  });

  it("creates graph nodes with correct subType and source", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    expect(result.nodes).toHaveLength(3);

    for (const node of result.nodes) {
      expect(node.subType).toBe("api");
      expect(node.source).toBe("api-config");
    }
  });

  it("creates graph nodes with correct id prefix and label", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    const twilioNode = result.nodes.find((n) => n.id === "config-twilio");
    expect(twilioNode).toBeDefined();
    expect(twilioNode!.label).toBe("Twilio");

    const vapiNode = result.nodes.find((n) => n.id === "config-vapi");
    expect(vapiNode).toBeDefined();
    expect(vapiNode!.label).toBe("Vapi.ai");
  });

  it("creates edges with correct uses_api label and source_origin", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    // Twilio has 2 consumers, Vapi has 2, OpenAI has 1 = 5 edges total
    expect(result.edges).toHaveLength(5);

    for (const edge of result.edges) {
      expect(edge.label).toBe("uses_api");
      expect(edge.source_origin).toBe("api-config");
    }
  });

  it("creates edges linking API node to consumer entity", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    const twilioEdges = result.edges.filter((e) => e.source === "config-twilio");
    expect(twilioEdges).toHaveLength(2);

    const targets = twilioEdges.map((e) => e.target).sort();
    expect(targets).toEqual(["project-automation", "project-voice"]);
  });

  it("passes node properties from API definition (url, color)", () => {
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), SAMPLE_YAML, "utf-8");

    const result = scanApiConfig();
    const twilioNode = result.nodes.find((n) => n.id === "config-twilio");
    expect(twilioNode!.url).toBe("https://twilio.com");
    expect(twilioNode!.color).toBe("#F22F46");
    expect(twilioNode!.description).toBe("Voice and SMS communication");
  });

  it("skips APIs without an id", () => {
    const yaml = `apis:
  - name: NoId Service
    description: Missing id field
    consumers:
      - something
  - id: valid
    name: Valid API
    description: Has an id
    consumers:
      - consumer-a
`;
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), yaml, "utf-8");

    const result = scanApiConfig();
    expect(result.apis).toHaveLength(1);
    expect(result.apis[0].id).toBe("valid");
  });

  it("deduplicates APIs by id", () => {
    // Write to both .yaml and .yml with overlapping ids
    const yaml1 = `apis:
  - id: dup-api
    name: First Copy
    description: From yaml
    consumers: []
`;
    const yaml2 = `apis:
  - id: dup-api
    name: Second Copy
    description: From yml
    consumers: []
`;
    fs.writeFileSync(path.join(tmpHome, "apis-config.yaml"), yaml1, "utf-8");
    fs.writeFileSync(path.join(tmpHome, "apis-config.yml"), yaml2, "utf-8");

    const result = scanApiConfig();
    // Only the first one found should be kept (yaml is searched before yml)
    const dupes = result.apis.filter((a) => a.id === "dup-api");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].name).toBe("First Copy");
  });
});
