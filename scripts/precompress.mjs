import { gzipSync } from "node:zlib";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const dist = resolve(process.argv[2] ?? "dist");
const compressibleExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".task",
  ".txt",
  ".wasm",
  ".webmanifest",
  ".xml",
]);

let sourceBytes = 0;
let compressedBytes = 0;
let compressedFiles = 0;

async function writeAtomically(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, contents, { mode: 0o644 });
  await rename(temporary, path);
}

async function compressDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compressDirectory(path);
      continue;
    }

    if (!entry.isFile() || entry.name.endsWith(".gz") || !compressibleExtensions.has(extname(entry.name))) {
      continue;
    }

    const source = await readFile(path);
    const compressed = gzipSync(source, { level: 9 });
    const gzipPath = `${path}.gz`;

    // Do not keep an obsolete precompressed sibling when compression is not useful.
    if (compressed.length >= source.length) {
      await rm(gzipPath, { force: true });
      continue;
    }

    await writeAtomically(gzipPath, compressed);
    compressedFiles += 1;
    sourceBytes += source.length;
    compressedBytes += compressed.length;
  }
}

try {
  if (!(await stat(dist)).isDirectory()) {
    throw new Error(`Static output directory does not exist: ${dist}`);
  }
  await compressDirectory(dist);
  console.log(
    `Precompressed ${compressedFiles} static files (${sourceBytes} B -> ${compressedBytes} B).`,
  );
} catch (error) {
  console.error(`Unable to precompress static assets: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
