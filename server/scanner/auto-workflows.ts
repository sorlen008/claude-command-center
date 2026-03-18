import type { SessionData, WorkflowConfig } from "@shared/types";
import { storage } from "../storage";
import { summarizeBatch } from "./session-summarizer";

interface WorkflowResult {
  ran: string[];
  skipped: string[];
  errors: string[];
}

/** Run auto-workflows based on config */
export async function runAutoWorkflows(sessions: SessionData[]): Promise<WorkflowResult> {
  const config = storage.getWorkflowConfig();
  const ran: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // Auto-summarize: summarize unsummarized sessions
  if (config.autoSummarize) {
    try {
      const result = await summarizeBatch(sessions, 5);
      if (result.summarized.length > 0) {
        ran.push(`auto-summarize: ${result.summarized.length} sessions summarized`);
      } else {
        skipped.push("auto-summarize: no unsummarized sessions");
      }
      if (result.failed.length > 0) {
        errors.push(`auto-summarize: ${result.failed.length} failed`);
      }
    } catch (err) {
      errors.push(`auto-summarize: ${(err as Error).message}`);
    }
  }

  // Auto-tag: tag sessions by file paths
  if (config.autoTagByPath) {
    // This is a read-only operation — we annotate the session list response
    // with tags derived from file paths. No actual mutation needed here.
    ran.push("auto-tag: enabled (tags computed on-the-fly)");
  }

  // Auto-archive: report stale sessions (we don't delete without confirmation)
  if (config.autoArchiveStale) {
    const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const stale = sessions.filter(s => !s.isEmpty && s.messageCount < 5 && (s.lastTs || "") < THIRTY_DAYS_AGO);
    const empty = sessions.filter(s => s.isEmpty);
    if (stale.length > 0 || empty.length > 0) {
      ran.push(`auto-archive: found ${stale.length} stale + ${empty.length} empty candidates`);
    } else {
      skipped.push("auto-archive: nothing to archive");
    }
  }

  // Cost alert: check if today's spend exceeds threshold
  if (config.costAlertThreshold && config.costAlertThreshold > 0) {
    // We need cost data, but importing getCostAnalytics would create a circular dependency
    // So we just report the config. The frontend polls and shows the alert.
    ran.push(`cost-alert: threshold set at $${config.costAlertThreshold}`);
  }

  return { ran, skipped, errors };
}
