import { z } from "zod";
import type { Response } from "express";
import path from "path";
import os from "os";

// --- Zod Schemas ---

export const SessionIdSchema = z.string().regex(/^[a-f0-9-]{36}$/i, "Invalid session ID format");

export const IdsArraySchema = z.array(SessionIdSchema).min(1).max(1000);

export const SessionListSchema = z.object({
  q: z.string().max(500).optional(),
  sort: z.enum(["lastTs", "firstTs", "sizeBytes", "messageCount", "slug"]).default("lastTs"),
  order: z.enum(["asc", "desc"]).default("desc"),
  hideEmpty: z.enum(["true", "false"]).default("false"),
  activeOnly: z.enum(["true", "false"]).default("false"),
  project: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const AgentExecListSchema = z.object({
  type: z.string().max(100).optional(),
  sessionId: z.string().max(200).optional(),
  q: z.string().max(500).optional(),
  sort: z.enum(["firstTs", "lastTs", "sizeBytes", "messageCount"]).default("firstTs"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const DeepSearchSchema = z.object({
  q: z.string().min(1).max(500),
  field: z.enum(["all", "user", "assistant"]).default("all"),
  dateFrom: z.string().max(30).optional(),
  dateTo: z.string().max(30).optional(),
  project: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const DiscoveryQuerySchema = z.object({
  q: z.string().min(1, "Query parameter 'q' is required").max(200),
});

// --- Helpers ---

/** Extract a single string from Express query param (handles array case) */
export function qstr(v: unknown): string | undefined {
  return Array.isArray(v) ? (v[0] as string) : (v as string | undefined);
}

/** Validate that a path is under the user's home directory. Returns normalized path or null. */
export function validateMarkdownPath(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  if (!resolved.startsWith(home + path.sep) && resolved !== home) {
    return null;
  }
  return resolved;
}

/** Validate a request body/query against a Zod schema. Returns parsed data or sends 400. */
export function validate<T extends z.ZodType>(
  schema: T,
  data: unknown,
  res: Response,
): z.infer<T> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(400).json({ message: messages });
    return null;
  }
  return result.data;
}

