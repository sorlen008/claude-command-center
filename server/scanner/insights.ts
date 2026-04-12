import type { CostInsight } from "@shared/types";
import { storage } from "../storage";

interface DailyCost {
  date: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

interface ModelBreakdown {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  sessions: number;
}

/**
 * Generate actionable insights from existing cached analytics data.
 * No JSONL re-parsing — uses aggregated cost/model/error data.
 */
export function generateInsights(costData: {
  dailyCosts: DailyCost[];
  byModel: Record<string, ModelBreakdown>;
  totalCost: number;
  errors?: { type: string; count: number; lastSeen: string }[];
}): CostInsight[] {
  const insights: CostInsight[] = [];
  const { dailyCosts, byModel, totalCost, errors } = costData;

  // --- 1. Cost optimization suggestions ---
  const opus = byModel["opus"];
  const sonnet = byModel["sonnet"];
  if (opus && opus.cost > 10) {
    // Calculate what Opus sessions would cost on Sonnet (5x cheaper input, 5x cheaper output)
    const sonnetEquivCost = (opus.inputTokens / 1_000_000) * 3 + (opus.outputTokens / 1_000_000) * 15;
    const savings = opus.cost - sonnetEquivCost;
    if (savings > 5) {
      insights.push({
        type: "optimization",
        severity: "info",
        title: "Model optimization opportunity",
        message: `Switching ${opus.sessions} Opus sessions to Sonnet would save ~$${savings.toFixed(0)}/mo. Sonnet handles most coding tasks well at 1/5 the cost.`,
        metric: savings,
        baseline: opus.cost,
      });
    }
  }

  if (opus && sonnet) {
    const opusPct = totalCost > 0 ? (opus.cost / totalCost) * 100 : 0;
    if (opusPct > 90) {
      insights.push({
        type: "optimization",
        severity: "info",
        title: "Heavy Opus usage",
        message: `${opusPct.toFixed(0)}% of spend is on Opus. Consider using Sonnet for routine tasks (file edits, searches) and reserving Opus for complex reasoning.`,
        metric: opusPct,
      });
    }
  }

  // --- 2. Anomaly detection ---
  if (dailyCosts.length >= 7) {
    const last7 = dailyCosts.slice(-7);
    const avg7d = last7.reduce((s, d) => s + d.cost, 0) / 7;
    const today = dailyCosts[dailyCosts.length - 1];

    if (today && avg7d > 0 && today.cost > avg7d * 2) {
      insights.push({
        type: "anomaly",
        severity: "warning",
        title: "Cost spike detected",
        message: `Today's spend ($${today.cost.toFixed(2)}) is ${(today.cost / avg7d).toFixed(1)}x your 7-day average ($${avg7d.toFixed(2)}).`,
        metric: today.cost,
        baseline: avg7d,
      });
    }

    // Week-over-week trend
    if (dailyCosts.length >= 14) {
      const prevWeek = dailyCosts.slice(-14, -7).reduce((s, d) => s + d.cost, 0);
      const thisWeek = last7.reduce((s, d) => s + d.cost, 0);
      if (prevWeek > 0 && thisWeek > prevWeek * 1.5) {
        insights.push({
          type: "anomaly",
          severity: "warning",
          title: "Spending trending up",
          message: `This week ($${thisWeek.toFixed(2)}) is ${((thisWeek / prevWeek - 1) * 100).toFixed(0)}% higher than last week ($${prevWeek.toFixed(2)}).`,
          metric: thisWeek,
          baseline: prevWeek,
        });
      }
    }
  }

  // Error rate anomaly
  if (errors && errors.length > 0) {
    const totalErrors = errors.reduce((s, e) => s + e.count, 0);
    if (totalErrors > 50) {
      const topError = errors[0];
      insights.push({
        type: "anomaly",
        severity: totalErrors > 100 ? "critical" : "warning",
        title: "High error rate",
        message: `${totalErrors} tool errors in the last 30 days. Most common: "${topError.type}" (${topError.count} occurrences).`,
        metric: totalErrors,
      });
    }
  }

  // --- 3. Budget alerts ---
  const settings = storage.getAppSettings();
  const budget = settings.monthlyBudget;
  if (budget && budget > 0 && totalCost > 0) {
    const pct = (totalCost / budget) * 100;
    if (pct >= 100) {
      insights.push({
        type: "budget",
        severity: "critical",
        title: "Budget exceeded",
        message: `You've spent $${totalCost.toFixed(2)} against a $${budget} monthly budget (${pct.toFixed(0)}%).`,
        metric: totalCost,
        baseline: budget,
      });
    } else if (pct >= 80) {
      insights.push({
        type: "budget",
        severity: "warning",
        title: "Approaching budget limit",
        message: `$${totalCost.toFixed(2)} of $${budget} budget used (${pct.toFixed(0)}%). ${Math.ceil(budget - totalCost)} remaining.`,
        metric: totalCost,
        baseline: budget,
      });
    }
  }

  // --- 4. Duplicate work detection ---
  const summaries = storage.getSummaries();
  const summaryList = Object.values(summaries);
  if (summaryList.length >= 5) {
    // Group by topic similarity (Jaccard on topics[])
    const topicGroups = new Map<string, string[]>();
    for (const s of summaryList) {
      if (!s.topics || s.topics.length === 0) continue;
      const key = s.topics.sort().join("|");
      if (!topicGroups.has(key)) topicGroups.set(key, []);
      topicGroups.get(key)!.push(s.sessionId);
    }
    // Find groups with 3+ sessions doing the same thing
    for (const [topics, sessionIds] of Array.from(topicGroups.entries())) {
      if (sessionIds.length >= 3) {
        const topicNames = topics.split("|").slice(0, 3).join(", ");
        insights.push({
          type: "duplicate",
          severity: "info",
          title: "Repeated work pattern",
          message: `${sessionIds.length} sessions share topics "${topicNames}". Consider creating a reusable skill or prompt template.`,
          metric: sessionIds.length,
        });
        break; // Only show top duplicate
      }
    }
  }

  return insights;
}
