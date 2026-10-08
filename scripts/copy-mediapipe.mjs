// Self-host the MediaPipe runtime and the pinned model for production builds.
import { createHash } from "node:crypto";
import { cp, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const publicDirectory = join(root, "public/mediapipe");
const wasmDestination = join(publicDirectory, "wasm");

const DEFAULT_FACE_MODEL_URL = "/mediapipe/face_landmarker.task";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const FACE_MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
const faceModelDestination = join(publicDirectory, "face_landmarker.task");
const cacheDirectory = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
  "going-head-surface",
);
const faceModelCache = join(cacheDirectory, "face_landmarker.task");

function isSelfHostedModelUrl(value) {
  if (!value) return true;
  return value.replace(/^\.\//, "/") === DEFAULT_FACE_MODEL_URL;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function hasExpectedModel(path) {
  try {
    return (await stat(path)).isFile() && (await hashFile(path)) === FACE_MODEL_SHA256;
  } catch {
    return false;
  }
}

async function writeFileAtomically(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, contents, { mode: 0o644 });
  await rename(temporary, path);
}

async function copyFileAtomically(source, destination) {
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, temporary);
  await rename(temporary, destination);
}

async function replaceWasmDirectory() {
  await stat(wasmSource);
  const staged = `${wasmDestination}.${process.pid}.tmp`;
  const backup = `${wasmDestination}.${process.pid}.previous`;
  await rm(staged, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(publicDirectory, { recursive: true });
  await cp(wasmSource, staged, { recursive: true, force: true });

  let movedExisting = false;
  try {
    try {
      await rename(wasmDestination, backup);
      movedExisting = true;
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
    await rename(staged, wasmDestination);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    if (movedExisting) await rename(backup, wasmDestination);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
  console.log("Copied MediaPipe WASM to public/mediapipe/wasm.");
}

async function downloadVerifiedModel() {
  await mkdir(cacheDirectory, { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const temporary = `${faceModelCache}.${process.pid}.${attempt}.part`;
    try {
      const response = await fetch(FACE_MODEL_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${FACE_MODEL_URL}`);
      await writeFileAtomically(temporary, new Uint8Array(await response.arrayBuffer()));
      if (!(await hasExpectedModel(temporary))) {
        throw new Error("downloaded model SHA-256 did not match the pinned value");
      }
      await rename(temporary, faceModelCache);
      console.log("Downloaded and verified the pinned MediaPipe face model.");
      return;
    } catch (error) {
      await rm(temporary, { force: true });
      if (attempt === 3) throw error;
      const delay = attempt * 500;
      console.warn(`Model download attempt ${attempt} failed; retrying in ${delay} ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function prepareFaceModel() {
  if (!(await hasExpectedModel(faceModelCache))) {
    try {
      await stat(faceModelCache);
      console.warn("Discarding a MediaPipe model cache entry with an unexpected SHA-256.");
      await rm(faceModelCache, { force: true });
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
    await downloadVerifiedModel();
  } else {
    console.log("Using verified cached MediaPipe face model.");
  }

  await copyFileAtomically(faceModelCache, faceModelDestination);
  if (!(await hasExpectedModel(faceModelDestination))) {
    throw new Error("Copied MediaPipe face model did not pass SHA-256 verification.");
  }
  console.log("Prepared public/mediapipe/face_landmarker.task.");
}

await replaceWasmDirectory();

const modelOverride = process.env.VITE_FACE_MODEL_URL?.trim();
if (isSelfHostedModelUrl(modelOverride)) {
  await prepareFaceModel();
} else {
  // A custom browser-visible model URL is intentionally respected; do not
  // download or bundle the default model when it cannot be used by this build.
  await rm(faceModelDestination, { force: true });
  console.log("VITE_FACE_MODEL_URL override supplied; skipped default model download.");
}
