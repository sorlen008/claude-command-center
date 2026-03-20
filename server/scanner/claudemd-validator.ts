import fs from "fs";
import path from "path";

export interface ValidationIssue {
  type: "broken-path" | "broken-link" | "unknown-port" | "missing-section";
  line?: number;
  message: string;
  value: string;
}

export interface ValidationResult {
  validPaths: string[];
  brokenPaths: string[];
  ports: Array<{ port: number; line: number }>;
  brokenLinks: string[];
  missingSections: string[];
  issues: ValidationIssue[];
}

const RECOMMENDED_SECTIONS = [
  "Architecture",
  "Key Commands",
  "File Structure",
  "Commit Format",
];

// Match file paths: ~/..., C:/..., ./..., /Users/..., absolute unix paths
const PATH_PATTERN = /(?:~\/[\w./-]+|[A-Z]:\/[\w ./-]+|\.\/[\w./-]+|\/(?:Users|home|opt|var|etc)\/[\w ./-]+)/g;

// Match markdown links to .md files: [text](file.md)
const MD_LINK_PATTERN = /\[(?:[^\]]*)\]\(([^)]+\.md)\)/g;

// Match port references like :5000, :5434, port 5100
const PORT_PATTERN = /(?::(\d{4,5})(?:\b|\/)|port\s+(\d{4,5}))/gi;

export function validateClaudeMd(filePath: string): ValidationResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const dir = path.dirname(filePath);

  const validPaths: string[] = [];
  const brokenPaths: string[] = [];
  const ports: Array<{ port: number; line: number }> = [];
  const brokenLinks: string[] = [];
  const missingSections: string[] = [];
  const issues: ValidationIssue[] = [];

  // Check file paths
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;

    // Extract and check file paths
    PATH_PATTERN.lastIndex = 0;
    while ((match = PATH_PATTERN.exec(line)) !== null) {
      let p = match[0];
      // Expand ~ to home dir
      if (p.startsWith("~/")) {
        p = path.join(process.env.HOME || process.env.USERPROFILE || "", p.slice(2));
      }
      // Resolve relative paths against the CLAUDE.md directory
      if (p.startsWith("./")) {
        p = path.join(dir, p);
      }
      const resolved = path.resolve(p);
      try {
        if (fs.existsSync(resolved)) {
          validPaths.push(match[0]);
        } else {
          brokenPaths.push(match[0]);
          issues.push({
            type: "broken-path",
            line: i + 1,
            message: `Path does not exist: ${match[0]}`,
            value: match[0],
          });
        }
      } catch {
        // Permission error or similar — treat as broken
        brokenPaths.push(match[0]);
        issues.push({
          type: "broken-path",
          line: i + 1,
          message: `Cannot access path: ${match[0]}`,
          value: match[0],
        });
      }
    }

    // Extract markdown links
    MD_LINK_PATTERN.lastIndex = 0;
    while ((match = MD_LINK_PATTERN.exec(line)) !== null) {
      const linkTarget = match[1];
      // Skip URLs
      if (linkTarget.startsWith("http://") || linkTarget.startsWith("https://")) continue;
      const resolved = path.resolve(dir, linkTarget);
      try {
        if (!fs.existsSync(resolved)) {
          brokenLinks.push(linkTarget);
          issues.push({
            type: "broken-link",
            line: i + 1,
            message: `Broken link: [${linkTarget}] — file not found`,
            value: linkTarget,
          });
        }
      } catch {
        brokenLinks.push(linkTarget);
      }
    }

    // Extract port numbers
    PORT_PATTERN.lastIndex = 0;
    while ((match = PORT_PATTERN.exec(line)) !== null) {
      const port = parseInt(match[1] || match[2], 10);
      if (port >= 1024 && port <= 65535) {
        // Avoid duplicates
        if (!ports.some((p) => p.port === port)) {
          ports.push({ port, line: i + 1 });
        }
      }
    }
  }

  // Check recommended sections
  const contentLower = content.toLowerCase();
  for (const section of RECOMMENDED_SECTIONS) {
    // Look for heading with this text
    const hasSection = lines.some((l) => {
      const headingMatch = l.match(/^#{1,4}\s+(.+)$/);
      return headingMatch && headingMatch[1].toLowerCase().includes(section.toLowerCase());
    });
    if (!hasSection) {
      missingSections.push(section);
      issues.push({
        type: "missing-section",
        message: `Recommended section missing: ${section}`,
        value: section,
      });
    }
  }

  return { validPaths, brokenPaths, ports, brokenLinks, missingSections, issues };
}
