import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Media } from "../shared/types.ts";
export interface FaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}
export interface MaskOptions {
  start: number;
  end: number;
  fps?: number;
  width?: number;
  height?: number;
  signal?: AbortSignal;
}
let helper: Promise<string> | undefined;
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 24);
function processResult(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "",
      stderr = "";
    child.stdout?.on("data", (b) => (stdout += b));
    child.stderr?.on("data", (b) => (stderr = (stderr + b).slice(-8000)));
    child.once("error", reject);
    child.once("close", (code) =>
      code
        ? reject(Error(stderr || `Process exited ${code}`))
        : resolve(stdout),
    );
  });
}
async function compileHelper() {
  if (process.platform !== "darwin")
    throw Error("Local person segmentation requires macOS Vision");
  return (helper ??= (async () => {
    const bundled = fileURLToPath(new URL("./sceneforge-vision", import.meta.url));
    try {
      await fs.access(bundled, 1);
      return bundled;
    } catch {}
    const source = fileURLToPath(
        new URL("./vision-helper.swift", import.meta.url),
      ),
      target = path.join(
        tmpdir(),
        `sceneforge-vision-${hash(await fs.readFile(source, "utf8"))}`,
      );
    try {
      await fs.access(target);
      return target;
    } catch {}
    const temp = target + "." + randomUUID();
    try {
      await processResult(spawn("swiftc", ["-O", source, "-o", temp]));
      await fs.rename(temp, target);
      return target;
    } finally {
      await fs.rm(temp, { force: true });
    }
  })().catch((e) => {
    helper = undefined;
    throw e;
  }));
}
export const visionHelper=compileHelper;
export async function getVisionCapabilities() {
  return {
    personSegmentation: process.platform === "darwin",
    faceDetection: process.platform === "darwin",
    engine: "Apple Vision",
    limitations: [
      "Person-only masks at reduced resolution and cadence.",
      "Face centering follows the largest detected face at four samples per second with interpolation; it is not identity recognition.",
    ],
  };
}
const faces = new Map<string, Promise<FaceBounds | null>>();
export async function detectFace(
  input: string,
  options: { time?: number; signal?: AbortSignal } = {},
): Promise<FaceBounds | null> {
  const file = await fs.realpath(input),
    stat = await fs.stat(file),
    time = options.time || 0,
    key = hash(`${file}:${stat.size}:${stat.mtimeMs}:${time}`);
  if (faces.has(key)) return faces.get(key)!;
  const task = (async () => {
    const binary = await compileHelper();
    const child = spawn(binary, ["face", file, String(time)], {
      signal: options.signal,
    });
    const result = JSON.parse(await processResult(child));
    return (
      [...result.faces].sort(
        (a: FaceBounds, b: FaceBounds) =>
          b.width * b.height - a.width * a.height,
      )[0] || null
    );
  })();
  faces.set(key, task);
  task.catch(() => faces.delete(key));
  return task;
}
const masks = new Map<string, Promise<string>>();
let active = false;
const waiting: Array<() => void> = [];
async function exclusive<T>(fn: () => Promise<T>) {
  if (active) await new Promise<void>((r) => waiting.push(r));
  else active = true;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active = false;
  }
}
export async function personMask(
  input: string,
  cacheDir: string,
  options: MaskOptions,
): Promise<string> {
  const file = await fs.realpath(input),
    stat = await fs.stat(file),
    duration = options.end - options.start,
    fps = Math.max(1, Math.min(15, options.fps || 8)),
    width = Math.round(options.width || 320),
    height = Math.round(options.height || 180);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600)
    throw Error("Segmentation range must be between 0 and 600 seconds");
  if (width < 2 || height < 2 || width > 1920 || height > 1080)
    throw Error("Invalid mask dimensions");
  await fs.mkdir(cacheDir, { recursive: true });
  const key = hash(
      `vision-balanced-v1:${file}:${stat.size}:${stat.mtimeMs}:${options.start}:${duration}:${fps}:${width}:${height}`,
    ),
    out = path.join(cacheDir, `${key}.mask.mkv`);
  try {
    await fs.access(out);
    return out;
  } catch {}
  if (masks.has(key)) return masks.get(key)!;
  const task = exclusive(async () => {
    options.signal?.throwIfAborted();
    const binary = await compileHelper(),
      temp = out + "." + randomUUID() + ".tmp.mkv";
    let native: ChildProcess | undefined, encoder: ChildProcess | undefined;
    try {
      native = spawn(
        binary,
        [
          "segment",
          file,
          String(options.start),
          String(duration),
          String(fps),
          String(width),
          String(height),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      encoder = spawn(
        process.env.SCENEFORGE_FFMPEG || "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-f",
          "rawvideo",
          "-pixel_format",
          "gray",
          "-video_size",
          `${width}x${height}`,
          "-framerate",
          String(fps),
          "-i",
          "pipe:0",
          "-frames:v",
          String(Math.ceil(duration * fps)),
          "-c:v",
          "ffv1",
          "-threads",
          "2",
          temp,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const stop = () => {
        native?.kill("SIGKILL");
        encoder?.kill("SIGKILL");
      };
      options.signal?.addEventListener("abort", stop, { once: true });
      let nativeError = "",
        encoderError = "";
      native.stderr!.on(
        "data",
        (b) => (nativeError = (nativeError + b).slice(-8000)),
      );
      encoder.stderr!.on(
        "data",
        (b) => (encoderError = (encoderError + b).slice(-8000)),
      );
      encoder.stdout!.resume();
      native.stdout!.pipe(encoder.stdin!);
      encoder.stdin!.on("error", () => {});
      const done = (c: ChildProcess) =>
        new Promise<number | null>((resolve, reject) => {
          c.once("error", (error) => { stop(); reject(error); });
          c.once("close", (code) => { if (code !== 0) stop(); resolve(code); });
        });
      try {
        const codes = await Promise.all([done(native), done(encoder)]);
        options.signal?.throwIfAborted();
        if (codes.some((c) => c !== 0))
          throw Error(`Vision mask failed: ${nativeError} ${encoderError}`);
      } finally {
        options.signal?.removeEventListener("abort", stop);
      }
      if ((await fs.stat(temp)).size < 100) throw Error("Empty person mask");
      await fs.rename(temp, out);
      return out;
    } finally {
      native?.kill("SIGTERM");
      encoder?.kill("SIGTERM");
      await fs.rm(temp, { force: true });
    }
  });
  masks.set(key, task);
  try {
    return await task;
  } finally {
    masks.delete(key);
  }
}

/** A source-frame mask for an interactive canvas preview. White is person alpha. */
export async function visionPreview(
  media: Media,
  time: number,
  cacheDir: string,
): Promise<{ maskPath: string; face: FaceBounds | null; time: number; width: number; height: number }> {
  if (media.kind === "audio") throw Error("Vision preview requires a video or image");
  if (!Number.isFinite(time)) throw Error("Invalid vision preview time");
  const at = media.kind === "image" ? 0 : Math.max(0, Math.min(Math.max(0, media.duration - 0.125), time));
  // Bucketing bounds cache growth during scrubbing and agrees with export mask cadence.
  const sampleTime = Math.floor(at * 8) / 8;
  const scale = Math.min(1, 320 / Math.max(media.width, media.height, 1));
  const width = Math.max(2, Math.round(media.width * scale));
  const height = Math.max(2, Math.round(media.height * scale));
  const [mask, face] = await Promise.all([
    personMask(media.path, cacheDir, { start: sampleTime, end: sampleTime + 0.125, fps: 8, width, height }),
    detectFace(media.path, { time: sampleTime }),
  ]);
  const maskPath = mask.replace(/\.mkv$/, ".png");
  try { await fs.access(maskPath); }
  catch {
    const temp = maskPath + "." + randomUUID() + ".png";
    try {
      await processResult(spawn(process.env.SCENEFORGE_FFMPEG || "ffmpeg", [
        "-v", "error", "-nostdin", "-y", "-i", mask,
        "-frames:v", "1", "-pix_fmt", "gray", "-threads", "1", temp,
      ]));
      await fs.rename(temp, maskPath);
    } finally { await fs.rm(temp, { force: true }); }
  }
  return { maskPath, face, time: sampleTime, width, height };
}
