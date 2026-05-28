import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

const allowlist = [
  "chokidar",
  "express",
  "gray-matter",
  "zod",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    // CJS bundle needs an import.meta.url shim: esbuild lowers ESM source to
    // CJS but leaves import.meta.url undefined, which crashes fileURLToPath()
    // on Node 24. __filename is valid in the CJS output.
    banner: {
      js: "#!/usr/bin/env node\nconst { pathToFileURL: __ccPathToFileURL } = require('node:url');\nvar __ccImportMetaUrl = __ccPathToFileURL(__filename).href;",
    },
    define: { "import.meta.url": "__ccImportMetaUrl" },
    minify: true,
    external: [...externals, "./vite"],
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
