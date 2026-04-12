import { describe, it, expect } from "vitest";
import os from "os";
import path from "path";
import {
  SessionIdSchema,
  IdsArraySchema,
  SessionListSchema,
  AgentExecListSchema,
  DiscoveryQuerySchema,
  qstr,
  validateMarkdownPath,
} from "../server/routes/validation";

describe("SessionIdSchema", () => {
  it("accepts valid UUID", () => {
    expect(SessionIdSchema.safeParse("a1b2c3d4-e5f6-7890-abcd-ef1234567890").success).toBe(true);
  });

  it("rejects short strings", () => {
    expect(SessionIdSchema.safeParse("abc").success).toBe(false);
  });

  it("rejects strings with invalid chars", () => {
    expect(SessionIdSchema.safeParse("a1b2c3d4-e5f6-7890-abcd-ef123456789g").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(SessionIdSchema.safeParse("").success).toBe(false);
  });

  it("accepts uppercase hex", () => {
    expect(SessionIdSchema.safeParse("A1B2C3D4-E5F6-7890-ABCD-EF1234567890").success).toBe(true);
  });
});

describe("IdsArraySchema", () => {
  const validUuid1 = "66f313df-a17e-402b-90bd-f213951be4f3";
  const validUuid2 = "a09f1a21-0f9d-4c10-9a9c-2570817071ce";

  it("accepts array of valid UUIDs", () => {
    expect(IdsArraySchema.safeParse([validUuid1, validUuid2]).success).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(IdsArraySchema.safeParse(["not-a-uuid"]).success).toBe(false);
  });

  it("rejects empty array", () => {
    expect(IdsArraySchema.safeParse([]).success).toBe(false);
  });

  it("rejects non-array", () => {
    expect(IdsArraySchema.safeParse("not-an-array").success).toBe(false);
  });

  it("rejects array with empty strings", () => {
    expect(IdsArraySchema.safeParse([""]).success).toBe(false);
  });
});

describe("SessionListSchema", () => {
  it("accepts empty object (uses defaults)", () => {
    const result = SessionListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe("lastTs");
      expect(result.data.order).toBe("desc");
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(50);
    }
  });

  it("coerces page and limit from strings", () => {
    const result = SessionListSchema.safeParse({ page: "3", limit: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(25);
    }
  });

  it("rejects limit > 200", () => {
    expect(SessionListSchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it("rejects page < 1", () => {
    expect(SessionListSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it("rejects invalid sort field", () => {
    expect(SessionListSchema.safeParse({ sort: "invalid" }).success).toBe(false);
  });

  it("rejects q longer than 500 chars", () => {
    expect(SessionListSchema.safeParse({ q: "a".repeat(501) }).success).toBe(false);
  });

  it("accepts valid query", () => {
    const result = SessionListSchema.safeParse({ q: "search term", sort: "sizeBytes", order: "asc" });
    expect(result.success).toBe(true);
  });
});

describe("AgentExecListSchema", () => {
  it("uses defaults for empty object", () => {
    const result = AgentExecListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe("firstTs");
      expect(result.data.order).toBe("desc");
      expect(result.data.limit).toBe(100);
    }
  });

  it("rejects limit > 1000", () => {
    expect(AgentExecListSchema.safeParse({ limit: 2000 }).success).toBe(false);
  });
});

describe("DiscoveryQuerySchema", () => {
  it("accepts valid query", () => {
    expect(DiscoveryQuerySchema.safeParse({ q: "mcp server" }).success).toBe(true);
  });

  it("rejects empty q", () => {
    expect(DiscoveryQuerySchema.safeParse({ q: "" }).success).toBe(false);
  });

  it("rejects missing q", () => {
    expect(DiscoveryQuerySchema.safeParse({}).success).toBe(false);
  });

  it("rejects q > 200 chars", () => {
    expect(DiscoveryQuerySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("qstr", () => {
  it("returns string as-is", () => {
    expect(qstr("hello")).toBe("hello");
  });

  it("returns first element of array", () => {
    expect(qstr(["first", "second"])).toBe("first");
  });

  it("returns undefined for undefined", () => {
    expect(qstr(undefined)).toBeUndefined();
  });
});

describe("validateMarkdownPath", () => {
  const home = os.homedir();

  it("accepts path under home directory", () => {
    const result = validateMarkdownPath(path.join(home, "documents", "test.md"));
    expect(result).not.toBeNull();
    expect(result!.startsWith(home)).toBe(true);
  });

  it("rejects path outside home directory", () => {
    expect(validateMarkdownPath("/etc/passwd")).toBeNull();
    // Windows-style paths only rejected on Windows; on Linux, path.resolve treats them as relative
    if (process.platform === "win32") {
      expect(validateMarkdownPath("C:\\Windows\\System32\\test.md")).toBeNull();
    }
  });

  it("rejects path traversal attempts", () => {
    expect(validateMarkdownPath(path.join(home, "..", "..", "etc", "passwd"))).toBeNull();
  });

  it("returns resolved path", () => {
    const result = validateMarkdownPath(path.join(home, "test.md"));
    expect(result).toBe(path.resolve(home, "test.md"));
  });
});
