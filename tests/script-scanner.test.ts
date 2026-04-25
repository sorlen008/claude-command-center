import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { scanScripts, extractPythonDocstring, firstMeaningfulLine } from "../server/scanner/script-scanner";
import type { Entity } from "@shared/types";

const tmpRoot = path.join(os.tmpdir(), `cc-scripts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

function mkProject(absPath: string, id = `proj-${path.basename(absPath)}`): Entity {
  fs.mkdirSync(absPath, { recursive: true });
  return {
    id,
    type: "project",
    name: path.basename(absPath),
    path: absPath.replace(/\\/g, "/"),
    description: null,
    lastModified: null,
    tags: [],
    health: "ok",
    data: { projectKey: path.basename(absPath), sessionCount: 0, sessionSize: 0, hasClaudeMd: false, hasMemory: false },
    scannedAt: new Date().toISOString(),
  };
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

beforeAll(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("extractPythonDocstring", () => {
  it("returns null for empty input", () => {
    expect(extractPythonDocstring("")).toBeNull();
  });

  it("extracts a triple-quoted module docstring at the very top", () => {
    const src = `"""Polls the inbox for new PDFs."""\nimport os\n`;
    expect(extractPythonDocstring(src)).toBe("Polls the inbox for new PDFs.");
  });

  it("skips a shebang then matches the docstring", () => {
    const src = `#!/usr/bin/env python3\n"""Watches for filesystem changes."""\n`;
    expect(extractPythonDocstring(src)).toBe("Watches for filesystem changes.");
  });

  it("tolerates leading comments and from __future__ imports", () => {
    const src = `# coding: utf-8\n# License: MIT\nfrom __future__ import annotations\n"""Helpers for caption rendering."""\n`;
    expect(extractPythonDocstring(src)).toBe("Helpers for caption rendering.");
  });

  it("handles single-quoted triple-string", () => {
    const src = `'''Generate the morning brief.'''\n`;
    expect(extractPythonDocstring(src)).toBe("Generate the morning brief.");
  });

  it("returns the first non-empty line of a multi-line docstring", () => {
    const src = `"""\nFirst summary line.\n\nLong-form description below.\n"""\n`;
    expect(extractPythonDocstring(src)).toBe("First summary line.");
  });

  it("returns null when no docstring is present", () => {
    const src = `import sys\n\nprint("hi")\n`;
    expect(extractPythonDocstring(src)).toBeNull();
  });

  it("caps very long docstrings at 200 chars with ellipsis", () => {
    const long = "x".repeat(500);
    const src = `"""${long}"""\n`;
    const result = extractPythonDocstring(src)!;
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("firstMeaningfulLine", () => {
  it("falls back to the first non-comment, non-import line", () => {
    const src = `# top comment\nimport os\nfrom pathlib import Path\n\nprint("starting up")\n`;
    expect(firstMeaningfulLine(src)).toBe(`print("starting up")`);
  });

  it("returns null when the file is only comments and imports", () => {
    const src = `# comment\nimport os\nfrom pathlib import Path\n`;
    expect(firstMeaningfulLine(src)).toBeNull();
  });
});

describe("scanScripts", () => {
  it("returns an empty result when there are no projects", () => {
    const r = scanScripts([]);
    expect(r.scripts).toEqual([]);
    expect(r.countsByProject.size).toBe(0);
  });

  it("finds .py files in a project root with the correct ownership", () => {
    const projectDir = path.join(tmpRoot, "p1");
    const project = mkProject(projectDir);
    writeFile(path.join(projectDir, "watcher.py"), `"""Watches the inbox."""\n`);
    writeFile(path.join(projectDir, "helper.py"), `import sys\n\ndef main(): pass\n`);

    const r = scanScripts([project]);
    expect(r.scripts.length).toBe(2);
    expect(r.countsByProject.get(project.id)).toBe(2);
    const watcher = r.scripts.find((s) => s.name === "watcher.py")!;
    expect(watcher.data.language).toBe("python");
    expect(watcher.data.docstring).toBe("Watches the inbox.");
    expect(watcher.data.projectId).toBe(project.id);
    expect(watcher.data.relativePath).toBe("watcher.py");
  });

  it("ignores node_modules, __pycache__, venv, .git, dist", () => {
    const projectDir = path.join(tmpRoot, "p-ignore");
    const project = mkProject(projectDir);
    writeFile(path.join(projectDir, "real.py"), `"""real."""\n`);
    for (const ignored of ["node_modules", "__pycache__", "venv", ".git", "dist", ".venv"]) {
      writeFile(path.join(projectDir, ignored, "junk.py"), `"""junk."""\n`);
    }

    const r = scanScripts([project]);
    const names = r.scripts.map((s) => s.name);
    expect(names).toEqual(["real.py"]);
  });

  it("respects deepest-project-wins ownership for nested projects", () => {
    const outerDir = path.join(tmpRoot, "outer");
    const innerDir = path.join(outerDir, "nested");
    const outer = mkProject(outerDir, "outer-id");
    const inner = mkProject(innerDir, "inner-id");

    writeFile(path.join(outerDir, "outer-only.py"), `"""outer."""\n`);
    writeFile(path.join(innerDir, "inner-only.py"), `"""inner."""\n`);

    const r = scanScripts([outer, inner]);
    const outerOnly = r.scripts.find((s) => s.name === "outer-only.py")!;
    const innerOnly = r.scripts.find((s) => s.name === "inner-only.py")!;
    expect(outerOnly.data.projectId).toBe("outer-id");
    expect(innerOnly.data.projectId).toBe("inner-id");
    // Each script counted exactly once, and the inner-only script does NOT
    // double-count under the outer project even though outer's path is a prefix.
    expect(r.countsByProject.get("outer-id")).toBe(1);
    expect(r.countsByProject.get("inner-id")).toBe(1);
  });

  it("explores nested non-project directories within a project", () => {
    const projectDir = path.join(tmpRoot, "p-nested");
    const project = mkProject(projectDir);
    writeFile(path.join(projectDir, "a", "b", "c", "deep.py"), `"""deep."""\n`);
    const r = scanScripts([project]);
    expect(r.scripts.length).toBe(1);
    expect(r.scripts[0].data.relativePath).toBe("a/b/c/deep.py");
  });

  it("respects the depth cap (>6 levels)", () => {
    const projectDir = path.join(tmpRoot, "p-deep");
    const project = mkProject(projectDir);
    // 8 levels deep — past the cap of 6.
    const tooDeep = path.join(projectDir, "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "buried.py");
    writeFile(tooDeep, `"""buried."""\n`);
    // 5 levels deep — within the cap.
    const shallow = path.join(projectDir, "l1", "l2", "l3", "l4", "l5", "shallow.py");
    writeFile(shallow, `"""shallow."""\n`);

    const r = scanScripts([project]);
    const names = r.scripts.map((s) => s.name);
    expect(names).toContain("shallow.py");
    expect(names).not.toContain("buried.py");
  });

  it("flags projects that hit the per-project cap", () => {
    const projectDir = path.join(tmpRoot, "p-cap");
    const project = mkProject(projectDir);
    // Create slightly more than the 200 cap so we can assert the flag is set.
    for (let i = 0; i < 205; i++) {
      writeFile(path.join(projectDir, `script-${i}.py`), `"""s ${i}."""\n`);
    }

    const r = scanScripts([project]);
    expect(r.cappedProjects.has(project.id)).toBe(true);
    expect(r.scripts.length).toBe(200);
    expect(r.countsByProject.get(project.id)).toBe(200);
  });
});
