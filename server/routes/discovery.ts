import { Router, type Request, type Response } from "express";
import { storage } from "../storage";

const router = Router();

router.get("/api/discovery/search", async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ message: "Query parameter 'q' is required" });

  // Check cache
  const cached = storage.getCachedDiscovery(q);
  if (cached) {
    return res.json(JSON.parse(cached));
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "claude-command-center",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=20&sort=stars&order=desc`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ message: `GitHub API error: ${text}` });
    }

    const data = await response.json();
    const results = (data.items || []).map((repo: any) => {
      // Classify the repo
      const text = `${repo.name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();
      let category = "other";
      if (text.includes("mcp") || text.includes("model context protocol")) category = "mcp";
      else if (text.includes("plugin")) category = "plugin";
      else if (text.includes("skill")) category = "skill";

      return {
        id: repo.id,
        name: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        stars: repo.stargazers_count,
        language: repo.language,
        topics: repo.topics || [],
        category,
        updatedAt: repo.updated_at,
      };
    });

    // Cache results
    storage.setCachedDiscovery(q, JSON.stringify(results));
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Failed to search GitHub" });
  }
});

export default router;
