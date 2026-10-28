import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { personMask } from "./vision.ts";
import { getFaceTrack } from "./face-tracking.ts";
import { faceCropCommands } from "./face-crop.ts";
import type { FaceTrack } from "../shared/face-tracking.ts";
import { filterSum } from "./filter-expression.ts";
import { mediaCapabilityProbe } from "./media-capabilities.ts";
import { clipCompositeOrder } from "../shared/timeline-layers.ts";
import { clipShadow } from "../shared/clip-shadow.ts";
import { canvasBackgroundBMP, canvasBackgroundGeometry, canvasBackgroundRepeatSize, MOVING_DOTS } from "../shared/canvas-background.ts";
import { zoomTiming } from "../shared/zoom-timing.ts";
import {
  clipDuration,
  clipEffectTiming,
  projectDuration,
  type Media,
  type Project,
  type ExportOptions,
  type Job,
  type Clip,
} from "../shared/types.ts";

const FFMPEG = process.env.SCENEFORGE_FFMPEG || "ffmpeg",
  FFPROBE = process.env.SCENEFORGE_FFPROBE || "ffprobe";
const pending = new Map<string, Promise<unknown>>();
let activeWork = 0;
const workWaiters: Array<() => void> = [];
async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (activeWork >= 2)
    await new Promise<void>((resolve) => workWaiters.push(resolve));
  else activeWork++;
  try {
    return await work();
  } finally {
    const next = workWaiters.shift();
    if (next) next();
    else activeWork--;
  }
}
export interface RenderLifecycle {
  initialJob?: Job;
  onUpdate?: (job: Job) => Promise<void>;
  beforeComplete?: (job: Job) => Promise<void>;
}
const lifecycles = new Map<string, RenderLifecycle>();
const stopped = (job?: Job) => job?.status === "cancelled" || job?.status === "interrupted";
const jobs = new Map<string, Job>();
const peakRss = new Map<string, number>();
const children = new Map<string, ChildProcess>();
const queue: Array<{ job: Job; run: () => Promise<void> }> = [];
let busy = false;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 24);
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const TIME_EPSILON = 1e-8;
const cleanTime = (n: number) => Math.abs(n) < TIME_EPSILON ? 0 : Math.round(n * 1e9) / 1e9;
// FFmpeg's duration parser does not accept JS scientific notation.
const seconds = (n: number) => cleanTime(n).toFixed(9);
const frameCountFor = (duration: number, fps: number) => Math.max(1, Math.ceil((duration - TIME_EPSILON) * fps));
type AudioOriginClip = Clip & { _audioSourceIn?: number; _audioSourceOut?: number };
const audioCacheDir = path.join(tmpdir(), "sceneforge-audio-effects-v1");
const pinnedAudioFiles = new Set<string>();
let audioRuntimeKey: Promise<string> | undefined;
const exists = async (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );
function unique<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const p = run().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
function command(
  binary: string,
  args: string[],
  job?: Job,
  onLine?: (line: string) => void,
  limit = 4 * 1024 * 1024,
): Promise<string> {
  return limited(
    () =>
      new Promise((resolve, reject) => {
        if (
          job &&
          (stopped(job) || stopped(getJob(job.id)))
        ) {
          reject(new Error("Cancelled"));
          return;
        }
        const child = spawn(binary, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const began = Date.now();
        let lastOutput = began, timedOut = false;
        const watchdog = setInterval(() => {
          if (Date.now() - began > (job ? 30 : 5) * 60000 || (job && Date.now() - lastOutput > 180000)) {
            timedOut = true;
            child.kill("SIGKILL");
          }
        }, 10000);
        watchdog.unref();
        if (job) children.set(job.id, child);
        const sample = job
          ? setInterval(() => {
              if (!child.pid) return;
              const ps = spawn("ps", ["-p", String(child.pid), "-o", "rss="]);
              let value = "";
              ps.stdout.on("data", (b) => (value += b));
              ps.once("close", () => {
                const kb = Number(value.trim());
                if (Number.isFinite(kb))
                  peakRss.set(job.id, Math.max(peakRss.get(job.id) || 0, kb));
              });
              ps.on("error", () => {});
            }, 250)
          : undefined;
        sample?.unref();
        let out = "",
          err = "",
          lines = "";
        child.stdout.on("data", (d: Buffer) => {
          lastOutput = Date.now();
          out = (out + d.toString()).slice(-limit);
        });
        child.stderr.on("data", (d: Buffer) => {
          lastOutput = Date.now();
          err = (err + d.toString()).slice(-16000);
          lines += d.toString();
          const split = lines.split("\n");
          lines = split.pop() || "";
          for (const l of split) onLine?.(l);
        });
        child.once("error", (e) => {
          clearInterval(watchdog);
          if (sample) clearInterval(sample);
          if (job) children.delete(job.id);
          reject(e);
        });
        child.once("close", (code) => {
          clearInterval(watchdog);
          if (sample) clearInterval(sample);
          if (job) children.delete(job.id);
          if (
            job &&
            (stopped(job) || stopped(getJob(job.id)))
          )
            reject(new Error("Cancelled"));
          else if (timedOut) reject(new Error(`${path.basename(binary)} exceeded the process time limit or stopped producing progress for three minutes`));
          else if (code !== 0)
            reject(
              new Error(
                `${path.basename(binary)} exited ${code}: ${err.slice(-5000)}`,
              ),
            );
          else resolve(out);
        });
      }),
  );
}
export const getCapabilities = mediaCapabilityProbe(FFMPEG, FFPROBE);
async function identity(input: string) {
  if (!path.isAbsolute(input)) throw new Error("Media path must be absolute");
  const real = await fs.realpath(input),
    stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error("Media must be a regular local file");
  return { real, stat, key: hash(`${real}:${stat.size}:${stat.mtimeMs}`) };
}
export async function probeMedia(
  input: string,
  cacheDir: string,
): Promise<Media> {
  const { real, stat, key } = await identity(input);
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${key}.probe.json`);
  return unique(file, async () => {
    if (await exists(file))
      return JSON.parse(await fs.readFile(file, "utf8")) as Media;
    const p = JSON.parse(
      await command(FFPROBE, [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        real,
      ]),
    );
    const v = p.streams?.find((s: any) => s.codec_type === "video"),
      a = p.streams?.find((s: any) => s.codec_type === "audio");
    if (!v && !a) throw new Error("No supported audio/video streams");
    const image = /\.(png|jpe?g|webp|bmp|tiff?|heic|avif)$/i.test(real);
    const r = (v?.avg_frame_rate || "0/1").split("/").map(Number);
    const duration =
      Number(p.format?.duration || v?.duration || a?.duration) || 0;
    const m: Media = {
      id: key,
      name: path.basename(real),
      path: real,
      kind: image ? "image" : v ? "video" : "audio",
      duration: image ? 5 : duration,
      width: v?.width || 0,
      height: v?.height || 0,
      fps: r[1] ? r[0] / r[1] : 0,
      hasAudio: !!a,
      size: stat.size,
      thumbnail: `/api/media/${key}/thumbnail`,
    };
    await fs.writeFile(file, JSON.stringify(m));
    return m;
  });
}
export async function thumbnail(m: Media, cacheDir: string): Promise<string> {
  await fs.mkdir(cacheDir, { recursive: true });
  const key = (await identity(m.path)).key,
    file = path.join(cacheDir, `${key}.thumb.jpg`);
  return unique(file, async () => {
    if (await exists(file)) return file;
    const tmp = path.join(cacheDir, `${key}.${randomUUID()}.tmp.jpg`);
    const input =
      m.kind === "audio"
        ? [
            "-i",
            m.path,
            "-filter_complex",
            "showwavespic=s=480x270:colors=70a5ff",
          ]
        : [
            "-ss",
            String(m.kind === "image" ? 0 : Math.min(1, m.duration / 4)),
            "-i",
            m.path,
            "-vf",
            "scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=0x171b27",
          ];
    try {
      await command(FFMPEG, [
        "-v",
        "error",
        "-nostdin",
        "-y",
        ...input,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        tmp,
      ]);
      await fs.rename(tmp, file);
      return file;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  });
}
/** Absolute source-level peaks, uniformly covering [0, duration), never normalized. */
export async function waveform(m: Media, cacheDir: string): Promise<number[]> {
  if (!m.hasAudio && m.kind !== "audio") return [];
  if (!Number.isFinite(m.duration) || m.duration <= 0 || m.duration > 86400)
    throw new Error("Waveform requires a source duration between zero and 24 hours");
  await fs.mkdir(cacheDir, { recursive: true });
  const source = await identity(m.path),
    count = Math.min(1600, Math.max(64, Math.ceil(m.duration * 20))),
    key = hash(`${source.key}:absolute-channel-peaks-v2:${m.duration}:${count}`),
    file = path.join(cacheDir, `${key}.wave-v2.json`);
  return unique(file, async () => {
    try {
      const cached: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (Array.isArray(cached) && cached.length === count &&
          cached.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1))
        return cached as number[];
    } catch { /* Absent or damaged disposable cache: regenerate from the source. */ }
    const info = JSON.parse(await command(FFPROBE, ["-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=channels", "-of", "json", source.real]));
    const channels = info.streams?.[0]?.channels;
    if (!Number.isInteger(channels) || channels < 1 || channels > 32)
      throw new Error("Waveform requires a supported audio stream with at most 32 channels");
    const bins = new Array<number>(count).fill(0), frameBytes = channels * 4;
    let sample = 0, pendingBytes: Buffer = Buffer.alloc(0);
    await limited(() => new Promise<void>((resolve, reject) => {
      const child = spawn(FFMPEG, ["-v", "error", "-nostdin", "-threads", "2", "-i", source.real,
        "-map", "0:a:0", "-vn", "-sn", "-dn", "-filter_threads", "1",
        "-af", "aresample=8000:async=1:first_pts=0", "-t", String(m.duration),
        "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"], {stdio: ["ignore", "pipe", "pipe"]});
      let error = "", settled = false, timedOut = false, lastData = Date.now();
      const began = lastData;
      const timer = setInterval(() => {
        if (Date.now() - began > 300000 || Date.now() - lastData > 30000) {
          timedOut = true; child.kill("SIGKILL");
        }
      }, 1000);
      timer.unref();
      const finish = (failure?: Error) => {
        if (settled) return; settled = true; clearInterval(timer);
        if (failure) reject(failure); else resolve();
      };
      child.stdout.on("data", (buf: Buffer) => {
        lastData = Date.now();
        const bytes = pendingBytes.length ? Buffer.concat([pendingBytes, buf]) : buf;
        const end = bytes.length - bytes.length % frameBytes;
        for (let i = 0; i < end; i += frameBytes) {
          const index = Math.floor(sample++ * count / (m.duration * 8000));
          if (index >= count) continue;
          let peak = bins[index];
          for (let channel = 0; channel < channels; channel++) {
            const value = Math.abs(bytes.readFloatLE(i + channel * 4));
            if (Number.isFinite(value)) peak = Math.max(peak, Math.min(1, value));
          }
          bins[index] = peak;
        }
        pendingBytes = Buffer.from(bytes.subarray(end));
      });
      child.stderr.on("data", (bytes: Buffer) => { error = (error + bytes).slice(-2000); });
      child.once("error", finish);
      child.once("close", code => finish(timedOut ? new Error("Waveform analysis exceeded its time limit") :
        code !== 0 ? new Error(`Waveform audio decode failed: ${error}`) :
        !sample || pendingBytes.length ? new Error("Waveform audio decode returned incomplete samples") : undefined));
    }));
    if ((await identity(m.path)).key !== source.key)
      throw new Error("Media changed during waveform analysis; try again");
    const temporary = file + `.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(bins));
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, {force: true}); }
    return bins;
  });
}

export function getJob(id: string) {
  return jobs.get(id);
}
export function listJobs() {
  return [...jobs.values()].reverse();
}

export interface InspectedFrame {
  time: number;
  requestedTime: number;
  path: string;
  width: number;
  height: number;
}

/** Render evidence from the actual composition, including the export-only effects. */
export async function inspectFrames(
  project: Project,
  times: number[],
  cacheDir: string,
  options: { width?: number } = {},
): Promise<InspectedFrame[]> {
  if (!Array.isArray(times) || !times.length || times.length > 6 || times.some((time) => !Number.isFinite(time)))
    throw new Error("Frame inspection requires between one and six finite times");
  if (options.width !== undefined && (!Number.isFinite(options.width) || options.width <= 0))
    throw new Error("Invalid frame inspection width");
  const snapshot = structuredClone(project), duration = projectDuration(snapshot);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("The project has no visible timeline duration");
  const fps = clamp(snapshot.canvas.fps, 1, 120);
  let width = even(clamp(options.width ?? 960, 64, 1920));
  const aspect = snapshot.canvas.height / snapshot.canvas.width;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("Invalid project canvas dimensions");
  if (width * aspect > 4320) width = even(4320 / aspect);
  const height = even(Math.min(4320, width * aspect));
  // A changed source file invalidates images even if the edit JSON is unchanged.
  const mediaKeys: string[] = [];
  for (const media of snapshot.media) {
    try { mediaKeys.push((await identity(media.path)).key); }
    catch { mediaKeys.push(`unavailable:${media.path}`); }
  }
  const projectKey = hash(JSON.stringify({ renderer: "composed-frame-v5-moving-background", project: snapshot, mediaKeys, width, height }));
  await fs.mkdir(cacheDir, { recursive: true });
  const frames: InspectedFrame[] = [];
  for (const requestedTime of times) {
    const frame = Math.min(Math.max(0, Math.ceil(duration * fps) - 1), Math.max(0, Math.floor(requestedTime * fps)));
    const time = frame / fps;
    const target = path.join(cacheDir, `${projectKey}-${frame}.frame.png`);
    await unique(`frame:${path.resolve(target)}`, async () => {
      if (await exists(target)) return target;
      const workDir = path.join(cacheDir, `.frame-${randomUUID()}`);
      let job: Job | undefined;
      try {
        job = startExport(snapshot, {
          format: "mp4", width, height, fps, quality: "high", burnCaptions: true,
          range: { start: time, end: Math.min(duration, time + 2 / fps) },
        }, workDir);
        job.type = "analysis";
        while (job.status === "queued" || job.status === "running")
          await new Promise((resolve) => setTimeout(resolve, 30));
        if (job.status !== "complete" || !job.outputPath)
          throw new Error(job.error || `Frame inspection ${job.status}`);
        const temp = path.join(workDir, "frame.png");
        await command(FFMPEG, ["-v", "error", "-nostdin", "-y", "-i", job.outputPath,
          "-frames:v", "1", "-threads", "1", temp]);
        if ((await fs.stat(temp)).size < 50) throw new Error("Frame renderer produced an empty image");
        await fs.rename(temp, target);
        return target;
      } finally {
        if (job) { jobs.delete(job.id); peakRss.delete(job.id); }
        await fs.rm(workDir, { recursive: true, force: true });
      }
    });
    frames.push({ time, requestedTime, path: target, width, height });
  }
  return frames;
}

export function cancelJob(id: string) {
  const j = jobs.get(id);
  if (j && (j.status === "queued" || j.status === "running")) {
    j.status = "cancelled";
    j.message = "Cancelled";
    j.completedAt = new Date().toISOString();
    const c = children.get(id);
    c?.kill("SIGTERM");
    if (c) {
      const t = setTimeout(() => {
        if (c.exitCode === null) c.kill("SIGKILL");
      }, 3000);
      t.unref();
    }
  }
  return j;
}
export async function shutdownJobs(): Promise<void> {
  for (const job of jobs.values()) {
    if (job.status !== "queued" && job.status !== "running") continue;
    job.status = "interrupted";
    job.message = "Interrupted when the export service stopped";
    job.completedAt = new Date().toISOString();
    await lifecycles.get(job.id)?.onUpdate?.(structuredClone(job));
  }
  for (const child of children.values()) child.kill("SIGTERM");
  const deadline = Date.now() + 4000;
  while (busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  for (const child of children.values()) if (child.exitCode === null) child.kill("SIGKILL");
  while (busy && Date.now() < deadline + 3000) await new Promise(resolve => setTimeout(resolve, 25));
  if (busy) throw new Error("Export work has not stopped; retaining data-folder ownership until process exit.");
}
function enqueue(type: Job["type"], run: (job: Job) => Promise<void>, lifecycle: RenderLifecycle = {}): Job {
  const j: Job = lifecycle.initialJob ?? {
    id: randomUUID(),
    type,
    status: "queued",
    progress: 0,
    message: "Queued",
    startedAt: new Date().toISOString(),
  };
  jobs.set(j.id, j);
  lifecycles.set(j.id, lifecycle);
  queue.push({ job: j, run: () => run(j) });
  void drain().catch(error => console.error("Export queue failure", error));
  return j;
}
async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const { job, run } = queue.shift()!;
      if (stopped(job)) { lifecycles.delete(job.id); continue; }
      job.status = "running";
      job.message = "Preparing";
      const lifecycle = lifecycles.get(job.id);
      let persistenceError: unknown;
      const timer = lifecycle?.onUpdate ? setInterval(() => {
        void lifecycle.onUpdate!(structuredClone(job)).catch(error => { persistenceError = error; });
      }, 1000) : undefined;
      timer?.unref();
      try {
        await lifecycle?.onUpdate?.(structuredClone(job));
        await run();
        if (persistenceError) throw persistenceError;
        if (!stopped(getJob(job.id))) await lifecycle?.beforeComplete?.(job);
        if (!stopped(getJob(job.id))) {
          job.status = "complete";
          job.progress = 1;
          job.message = "Complete";
        }
      } catch (e) {
        if (!stopped(getJob(job.id))) {
          job.status = "failed";
          job.message = "Failed";
          job.error = e instanceof Error ? e.message : String(e);
        }
      } finally {
        if (timer) clearInterval(timer);
        job.completedAt = new Date().toISOString();
        try { await lifecycle?.onUpdate?.(structuredClone(job)); }
        catch (error) {
          job.status = "failed";
          job.message = "Export receipt could not be saved";
          job.error = error instanceof Error ? error.message : String(error);
          try { await lifecycle?.onUpdate?.(structuredClone(job)); }
          catch (retryError) { console.error("Could not persist failed export receipt", retryError); }
        }
        lifecycles.delete(job.id);
      }
    }
  } finally {
    busy = false;
  }
}
function progress(j: Job, duration: number) {
  return (line: string) => {
    if (line.startsWith("out_time_us=")) {
      const s = Number(line.slice(12)) / 1e6;
      j.progress = clamp(s / duration, 0, 0.99);
      j.message = `Rendering ${Math.round(j.progress * 100)}%`;
    }
  };
}
export function startProxy(m: Media, cacheDir: string): Job {
  return enqueue("proxy", async (j) => {
    if (m.kind !== "video") throw new Error("Proxies require video");
    await fs.mkdir(cacheDir, { recursive: true });
    const key = (await identity(m.path)).key,
      out = path.join(cacheDir, `${key}.proxy.mp4`);
    if (await exists(out)) {
      m.proxyPath = out;
      j.outputPath = out;
      return;
    }
    const tmp = path.join(cacheDir, `${key}.${j.id}.tmp.mp4`);
    try {
      await command(
        FFMPEG,
        [
          "-nostdin",
          "-y",
          "-i",
          m.path,
          "-vf",
          "scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "25",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          "-progress",
          "pipe:2",
          "-nostats",
          tmp,
        ],
        j,
        progress(j, m.duration),
      );
      await fs.rename(tmp, out);
      m.proxyPath = out;
      j.outputPath = out;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  });
}
const color = (s: string, fallback = "171b27") =>
  /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(s)
    ? `0x${s.slice(1, 7)}${s.length === 9 ? "@" + (parseInt(s.slice(7), 16) / 255).toFixed(3) : ""}`
    : `0x${fallback}`;
function tempo(n: number) {
  const parts: string[] = [];
  n = clamp(n, 0.05, 16);
  while (n > 2) {
    parts.push("atempo=2");
    n /= 2;
  }
  while (n < 0.5) {
    parts.push("atempo=0.5");
    n *= 2;
  }
  if (Math.abs(n - 1) > 1e-12) parts.push(`atempo=${n}`);
  return parts;
}
function stamp(t: number, sep = ",") {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
}
export function subtitleText(p: Project) {
  return p.captions
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/\r/g, "")}\n`,
    )
    .join("\n");
}
let rasterizer: Promise<string> | undefined;
async function rasterize(
  config: unknown,
  dir: string,
  job: Job,
): Promise<string> {
  if (!rasterizer)
    rasterizer = (async () => {
      const bundled = fileURLToPath(
        new URL("./creator-compiler-text-renderer", import.meta.url),
      );
      try {
        await fs.access(bundled, 1);
        return bundled;
      } catch {}
      const source = fileURLToPath(
        new URL("./media-text.swift", import.meta.url),
      );
      const cache = path.join(
        tmpdir(),
        `creator-compiler-text-renderer-${hash(await fs.readFile(source, "utf8"))}`,
      );
      if (!(await exists(cache)))
        await command(
          "swiftc",
          ["-O", source, "-o", cache],
          undefined,
          undefined,
        );
      return cache;
    })().catch((e) => {
      rasterizer = undefined;
      throw e;
    });
  const binary = await rasterizer;
  const cacheDir = path.join(tmpdir(), "sceneforge-raster-v3");
  const key = hash(JSON.stringify({ config, helper: (await identity(binary)).key }));
  const out = path.join(cacheDir, key + ".png");
  return unique(`raster:${key}`, async () => {
    if (await exists(out)) return out;
    await fs.mkdir(cacheDir, { recursive: true });
    const json = path.join(dir, `${randomUUID()}.json`), temp = path.join(cacheDir, `${key}.${randomUUID()}.png`);
    try {
      await fs.writeFile(json, JSON.stringify({ ...(config as object), output: temp }));
      await command(binary, [json], job);
      await fs.rename(temp, out);
      return out;
    } finally { await fs.rm(temp, { force: true }); }
  });
}
async function createGraphics(
  p: Project,
  w: number,
  h: number,
  dir: string,
  j: Job,
  burn: boolean,
) {
  const result: Array<{ file: string; start: number; duration: number }> = [];
  for (const e of p.elements) {
    if (e.duration <= 0 || e.type === "blur") continue;
    const file = await rasterize(
      {
        width: w,
        height: h,
        type: e.type,
        text: e.text,
        x: e.x,
        y: e.y,
        boxWidth: e.width,
        boxHeight: e.height,
        color: e.color,
        background: e.background,
        fontSize: e.fontSize * (w / p.canvas.width),
        opacity: e.opacity,
        rotation: e.rotation,
      },
      dir,
      j,
    );
    result.push({ file, start: e.start, duration: e.duration });
  }
  if (burn && p.captionStyle.enabled)
    for (const c of p.captions) {
      if (c.end <= c.start || !c.text.trim()) continue;
      for (const part of captionParts(c, p.captionStyle.maxWords)) {
        const y =
          p.captionStyle.position === "top"
            ? 0.05
            : p.captionStyle.position === "center"
              ? 0.4
              : 0.78;
        const file = await rasterize(
          {
            width: w,
            height: h,
            type: "text",
            text: part.text,
            x: 0.08,
            y,
            boxWidth: 0.84,
            boxHeight: 0.18,
            color: p.captionStyle.color,
            background: p.captionStyle.background,
            fontSize: p.captionStyle.fontSize * (w / p.canvas.width),
            opacity: 1,
            rotation: 0,
          },
          dir,
          j,
        );
        result.push({ file, start: part.start, duration: part.end - part.start });
      }
    }
  return result;
}
/** Keep caption word timing stable when a render window cuts through a caption. */
function captionParts(c: Project["captions"][number], maxWords: number) {
  const timed = c as typeof c & { _wordStart?: number; _wordEnd?: number };
  const words = c.text.trim().split(/\s+/), max = Math.max(1, Math.floor(maxWords));
  const count = Math.ceil(words.length / max);
  const start = timed._wordStart ?? c.start, end = timed._wordEnd ?? c.end;
  return Array.from({ length: count }, (_, i) => ({
    text: words.slice(i * max, (i + 1) * max).join(" "),
    start: cleanTime(Math.max(c.start, start + (end - start) * i / count)),
    end: cleanTime(Math.min(c.end, start + (end - start) * (i + 1) / count)),
  })).filter((part) => part.end - part.start > TIME_EPSILON);
}
async function pruneAudioCache() {
  const entries = await Promise.all((await fs.readdir(audioCacheDir)).filter((name) => name.endsWith(".wav")).map(async (name) => {
    const file = path.join(audioCacheDir, name), stat = await fs.stat(file);
    return { file, bytes: stat.size, time: stat.mtimeMs };
  }));
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const entry of entries.sort((a, b) => a.time - b.time)) {
    if (bytes <= 4 * 1024 ** 3) break;
    if (pinnedAudioFiles.has(entry.file)) continue;
    await fs.rm(entry.file, { force: true });
    bytes -= entry.bytes;
  }
}
/** Process the entire original interval once so stateful effects never reset at render joins. */
async function processedAudio(c: AudioOriginClip, media: Media, job: Job) {
  const source = await identity(media.path), speed = clamp(c.speed, 0.05, 16);
  const origin = clipEffectTiming(c);
  const start = c._audioSourceIn ?? origin.sourceIn, end = c._audioSourceOut ?? origin.sourceOut;
  const duration = (end - start) / speed, samples = Math.round(duration * 48000);
  if (!Number.isFinite(duration) || duration <= 0) throw Error("Invalid audio processing interval");
  const runtime = await (audioRuntimeKey ??= command(FFMPEG, ["-version"]).then(hash));
  const key = hash(JSON.stringify({ version: 2, source: source.key, runtime, start, end, speed,
    denoise: c.effects.denoise, normalize: c.effects.normalize, rate: 48000, channels: 2 }));
  const file = path.join(audioCacheDir, `${key}.wav`);
  await fs.mkdir(audioCacheDir, { recursive: true });
  // Current render windows may hold several files; eviction must not remove any
  // input already added to the pending FFmpeg graph.
  pinnedAudioFiles.add(file);
  let cacheHit = false;
  try {
    await unique(`audio-effects:${key}`, async () => {
      if (await exists(file)) { cacheHit = true; const now = new Date(); await fs.utimes(file, now, now); return; }
      const temp = path.join(audioCacheDir, `${key}.${randomUUID()}.tmp`);
      const filters = [`atrim=duration=${seconds(end - start)}`, "asetpts=PTS-STARTPTS", ...tempo(speed),
        "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"];
      if (c.effects.denoise) filters.push("afftdn=nf=-25");
      if (c.effects.normalize) filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
      filters.push("aresample=48000", `apad=whole_len=${samples}`, `atrim=end_sample=${samples}`, "asetpts=N/SR/TB");
      job.message = "Preparing continuous audio effects";
      try {
        await command(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-threads", "2", "-ss", seconds(start),
          "-t", seconds(end - start), "-i", source.real, "-map", "0:a:0", "-vn", "-af", filters.join(","),
          "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", "-rf64", "auto", "-f", "wav",
          "-threads", "2", "-progress", "pipe:2", "-nostats", temp], job);
        if (stopped(getJob(job.id))) throw Error("Cancelled");
        const stat = await fs.stat(temp);
        if (stat.size < samples * 8) throw Error("Continuous audio cache is truncated");
        await fs.rename(temp, file);
      } finally { await fs.rm(temp, { force: true }); }
    });
    await pruneAudioCache().catch(() => {});
    return { file, offset: Math.max(0, (c.sourceIn - start) / speed), cacheHit };
  } catch (error) {
    pinnedAudioFiles.delete(file);
    throw error;
  }
}
async function executeExport(
  project: Project,
  options: ExportOptions & { losslessAudio?: boolean; frameCount?: number; audioSamples?: number },
  outputDir: string,
  j: Job,
  context: { timelineStart?: number; backgroundCacheDir?: string } = {},
): Promise<void> {
  const p = structuredClone(project),
    o = { ...options };
  const exportBegan = performance.now();
  await fs.mkdir(outputDir, { recursive: true });
  const safe =
    p.name
      .replace(/[^\p{L}\p{N}._ -]/gu, "")
      .trim()
      .slice(0, 70) || "export";
  const out = path.join(outputDir, `${safe}-${j.id}.${o.format}`);
  const dir = path.join(outputDir, `.render-${j.id}`);
  await fs.mkdir(dir);
  const audioFiles = new Set<string>();
  let audioCacheHits = 0, audioCacheMisses = 0;
  try {
    if (["srt", "txt", "md", "json"].includes(o.format)) {
      const text =
        o.format === "srt"
          ? subtitleText(p)
          : o.format === "json"
            ? JSON.stringify(p, null, 2)
            : o.format === "md"
              ? p.scenes.map((s) => `## ${s.name}\n\n${s.script}`).join("\n\n")
              : p.captions.length
                ? p.captions.map((c) => c.text).join("\n")
                : p.scenes.map((s) => s.script).join("\n\n");
      const tmp = path.join(dir, "output");
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, out);
      j.outputPath = out;
      return;
    }
    const duration = projectDuration(p);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
      throw new Error(
        "Project needs a finite timeline duration between 0 and 24 hours",
      );
    const w = even(clamp(o.width || p.canvas.width, 64, 7680)),
      h = even(clamp(o.height || p.canvas.height, 64, 4320)),
      fps = clamp(o.fps || p.canvas.fps, 1, 120);
    const video = o.format !== "wav";
    const expectedFrames = o.frameCount ?? frameCountFor(duration, fps);
    const audioSamples = o.audioSamples ?? Math.round(duration * 48000);
    const args = [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-filter_complex_threads",
      "2",
    ];
    const filters: string[] = [], audioFilters: string[] = [];
    let input = 0;
    let base = "";
    const audio: string[] = [];
    if (video) {
      if (p.canvas.backgroundPattern === "moving-dots") {
        const geometry = canvasBackgroundGeometry(p.canvas, 0, w, h);
        const repeat = canvasBackgroundRepeatSize(p.canvas, geometry);
        const key = hash(JSON.stringify({ version: MOVING_DOTS.version, canvas: p.canvas, w, h }));
        const sheet = path.join(context.backgroundCacheDir ?? dir, `background-${key}.bmp`);
        await unique(sheet, async () => {
          if (await exists(sheet)) return;
          const temp = sheet + "." + randomUUID() + ".tmp";
          try {
            await fs.writeFile(temp, canvasBackgroundBMP(p.canvas, { ...geometry, width: repeat.width, height: repeat.height }, true));
            await fs.rename(temp, sheet);
          } finally { await fs.rm(temp, { force: true }); }
        });
        const origin = seconds(context.timelineStart ?? 0);
        // Translate the smallest exact repeating raster, with bilinear subpixel sampling for slow motion.
        // The extra row/column of tiles covers both axes at every phase. Planar RGB prevents
        // chroma-subsampling shifts. Absolute project time survives chunks, ranges and inspection.
        const phase = `mod(on/${fps}+${origin},${MOVING_DOTS.period})/${MOVING_DOTS.period}`;
        const x = `${geometry.pitchX}*(1-(${phase}))`;
        const y = `${geometry.pitchY}*(1-(${phase}))`;
        args.push("-loop", "1", "-framerate", String(fps), "-i", sheet);
        filters.push(`[${input++}:v]trim=end_frame=${expectedFrames},setpts=PTS-STARTPTS,format=gbrp,perspective=x0='${x}':y0='${y}':x1='W+${x}':y1='${y}':x2='${x}':y2='H+${y}':x3='W+${x}':y3='H+${y}':eval=frame:interpolation=linear,crop=${repeat.width}:${repeat.height}:0:0:exact=1[background0]`);
        let backgroundLabel = 'background0', backgroundIndex = 0;
        let currentWidth = repeat.width, currentHeight = repeat.height;
        // At most 13 doublings per axis within the existing 8K canvas bound. There is one
        // decoder and no delayed branch: every stack consumes duplicates of the same frame.
        while (currentWidth < w || currentHeight < h) {
          const horizontal = currentWidth < w, nextWidth = horizontal ? Math.min(w, currentWidth * 2) : currentWidth,
            nextHeight = horizontal ? currentHeight : Math.min(h, currentHeight * 2), next = `background${++backgroundIndex}`;
          filters.push(`[${backgroundLabel}]split=2[${next}a][${next}b];[${next}a][${next}b]${horizontal ? 'hstack' : 'vstack'}=inputs=2,crop=${nextWidth}:${nextHeight}:0:0:exact=1[${next}]`);
          backgroundLabel = next; currentWidth = nextWidth; currentHeight = nextHeight;
        }
        filters.push(`[${backgroundLabel}]format=rgba[base0]`);
      } else {
        args.push(
          "-f", "lavfi", "-i",
          `color=c=${color(p.canvas.background)}:s=${w}x${h}:r=${fps}:d=${seconds(expectedFrames / fps)}`,
        );
        filters.push(`[${input++}:v]format=rgba[base0]`);
      }
      base = "base0";
    }
    args.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${duration}`);
    audio.push(`[${input++}:a]`);
    let layer = 0;
    const sourceInputs = new Map<string, number>();
    const order = { screen: 0, camera: 1, audio: 2, music: 3, overlay: 4 };
    const clips = p.clips
      .map((clip, index) => ({ clip, index }))
      .sort(
        (a, b) =>
          clipCompositeOrder(a.clip,p) - clipCompositeOrder(b.clip,p) || a.index - b.index,
      );
    for (const { clip: c, index: ci } of clips) {
      const m = p.media.find((m) => m.id === c.mediaId);
      if (!m) throw new Error(`Clip ${c.name} has missing media`);
      const d = clipDuration(c);
      if (d <= TIME_EPSILON) continue;
      await identity(m.path);
      if (
        !Number.isFinite(c.start) ||
        c.start < 0 ||
        !Number.isFinite(c.sourceIn) ||
        c.sourceIn < 0
      )
        throw new Error(`Invalid clip time: ${c.name}`);
      const speed = clamp(c.speed, 0.05, 16),
        sourceDur = d * speed;
      // Sharing a decoder across delayed branches retains frames for future
      // timeline positions. Reuse only simultaneous equal source ranges.
      const sourceKey = JSON.stringify([
        m.path,
        c.start,
        m.kind === "image" ? 0 : c.sourceIn,
        m.kind === "image" ? 0 : sourceDur,
      ]);
      let idx = sourceInputs.get(sourceKey);
      if (idx === undefined) {
        if (m.kind === "image")
          args.push(
            "-threads",
            "2",
            "-loop",
            "1",
            "-framerate",
            String(fps),
            "-t",
            String(Math.max(1 / fps, ...p.clips.filter((clip) => clip.mediaId === m.id).map((clip) => clip.sourceOut - clip.sourceIn)) + 1 / fps),
            "-i",
            m.path,
          );
        else
          args.push(
            "-threads",
            "2",
            "-ss",
            seconds(c.sourceIn),
            "-t",
            seconds(sourceDur),
            "-i",
            m.path,
          );
        idx = input++;
        sourceInputs.set(sourceKey, idx);
      }
      if (
        video &&
        m.kind !== "audio" &&
        c.track !== "audio" &&
        c.track !== "music"
      ) {
        const t = { ...c.transform },
          fx = c.effects;
        const full =
          t.width === 1 &&
          t.height === 1 &&
          t.x === 0 &&
          t.y === 0 &&
          (c.zIndex ?? 0) >= 0;
        const pad = full
          ? (clamp(
              p.canvas.padding,
              0,
              Math.min(p.canvas.width, p.canvas.height) / 3,
            ) *
              w) /
            p.canvas.width
          : 0;
        if (pad) {
          t.x = pad / w;
          t.y = pad / h;
          t.width = (w - pad * 2) / w;
          t.height = (h - pad * 2) / h;
        }
        const tw = even(clamp(t.width, 0.001, 4) * w),
          th = even(clamp(t.height, 0.001, 4) * h);
        const abort = new AbortController();
        const cancelWatch = setInterval(() => {
          if (["cancelled","interrupted"].includes(getJob(j.id)?.status??'')) abort.abort();
        }, 100);
        cancelWatch.unref();
        let faceTrack: FaceTrack | undefined,
          maskFile: string | undefined;
        try {
          if (fx.faceCenter) {
            j.message = "Tracking subject face";
            faceTrack = await getFaceTrack(m, {
              start: m.kind === "image" ? 0 : c.sourceIn,
              end: m.kind === "image" ? 1 : c.sourceIn + sourceDur,
              signal: abort.signal,
            });
          }
          if (fx.background && fx.background !== "none") {
            j.message = "Generating local person mask";
            const maskWidth = 320,
              maskHeight = even(
                Math.min(
                  720,
                  Math.max(32, (320 * (m.height || 180)) / (m.width || 320)),
                ),
              );
            maskFile = await personMask(
              m.path,
              path.join(tmpdir(), "creator-compiler-vision-masks-v1"),
              {
                start: m.kind === "image" ? 0 : c.sourceIn,
                end: (m.kind === "image" ? 0 : c.sourceIn) + sourceDur,
                fps: 8,
                width: maskWidth,
                height: maskHeight,
                signal: abort.signal,
              },
            );
          }
        } finally {
          clearInterval(cancelWatch);
        }
        const fit = faceTrack ? "cover" : t.fit;
        const sizingFor = async (target:string) => {
          let crop=`crop=${tw}:${th}`,commandFilter='';
          if(faceTrack){
            const position=faceCropCommands(faceTrack,{sourceIn:m.kind==='image'?0:c.sourceIn,sourceOut:m.kind==='image'?sourceDur:c.sourceIn+sourceDur,speed,sourceWidth:m.width,sourceHeight:m.height,width:tw,height:th,target});
            const file=path.join(dir,`${target}.cmd`);await fs.writeFile(file,position.commands);
            const escaped=file.replaceAll('\\','\\\\').replaceAll("'","'\\''").replaceAll(':','\\:');
            commandFilter=`sendcmd=filename='${escaped}',`;
            crop=`crop@${target}=${tw}:${th}:x=${position.initial.x.toFixed(6)}:y=${position.initial.y.toFixed(6)}`;
          }
          return `${commandFilter}scale=${tw}:${th}:force_original_aspect_ratio=${fit === "cover" ? "increase" : "decrease"}:force_divisible_by=2,format=rgba,${fit === "cover" ? crop : `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black@0`},setsar=1,format=rgba`;
        };
        const sizing=await sizingFor(`face${ci}`);
        // Hold the final sampled image through its partially occupied frame.
        // Timestamp rounding at input EOF must not reveal the canvas early.
        const frameCadence = `fps=${fps}:eof_action=pass,tpad=stop_mode=clone:stop_duration=${seconds(1 / fps)}`;
        let chain = `[${idx}:v]trim=duration=${seconds(sourceDur)},setpts=(PTS-STARTPTS)/${speed},${frameCadence},${sizing}`;
        if (maskFile) {
          const mi = input++;
          args.push("-threads", "2", "-i", maskFile);
          filters.push(
            `[${mi}:v]trim=duration=${seconds(sourceDur)},setpts=(PTS-STARTPTS)/${speed},${frameCadence},${await sizingFor(`faceMask${ci}`)},format=gray[personMask${ci}]`,
          );
          if (fx.background === "remove") {
            filters.push(`${chain}[subject${ci}]`);
            chain = `[subject${ci}][personMask${ci}]alphamerge=shortest=1`;
          } else {
            filters.push(
              `${chain},format=gbrap,split[personSharp${ci}][personBlurInput${ci}]`,
              `[personMask${ci}]format=gbrap[personRgbMask${ci}]`,
              `[personBlurInput${ci}]gblur=sigma=18[personBlur${ci}]`,
              `[personBlur${ci}][personSharp${ci}][personRgbMask${ci}]maskedmerge[personResult${ci}]`,
            );
            chain = `[personResult${ci}]null`;
          }
        }
        if (fx.flipX) chain += ",hflip";
        if (
          fx.brightness ||
          fx.contrast !== 1 ||
          fx.saturation !== 1 ||
          fx.grayscale
        )
          chain += `,eq=brightness=${clamp(fx.brightness, -1, 1)}:contrast=${clamp(fx.contrast, 0, 3)}:saturation=${fx.grayscale ? 0 : clamp(fx.saturation, 0, 3)}`;
        if (fx.blur > 0) chain += `,gblur=sigma=${clamp(fx.blur, 0, 50)}`;
        const zooms = p.zooms.filter(
          (z) =>
            z.target === c.track &&
            z.start < c.start + d &&
            z.start + z.duration > c.start &&
            z.scale > 1,
        );
        if (zooms.length) {
          let zexpr = "1",
            xexpr = "0.5",
            yexpr = "0.5";
          for (const z of zooms) {
            const timing = zoomTiming(z);
            const zs = cleanTime(z.start - c.start),
              ze = cleanTime(zs + z.duration),
              scale = clamp(z.scale, 1, 8),
              ramp = timing.ramp,
              originalStart = cleanTime(zs - timing.offset),
              originalEnd = cleanTime(originalStart + timing.duration);
            const amount =
              z.easing === "smooth"
                ? `1+${scale - 1}*max(0,min(1,min((it-(${originalStart}))/${ramp},(${originalEnd}-it)/${ramp})))`
                : String(scale);
            const active = `gte(it,${zs})*lt(it,${ze})`;
            // Equivalent source-time arithmetic can differ by one floating-point bit
            // after a split. Canonicalize before zoompan's integer crop conversion.
            const stableAmount = `floor((${amount})*1000000000+0.5)/1000000000`;
            zexpr = `if(${active},${stableAmount},${zexpr})`;
            xexpr = `if(${active},${clamp(z.x, 0, 1)},${xexpr})`;
            yexpr = `if(${active},${clamp(z.y, 0, 1)},${yexpr})`;
          }
          chain += `,zoompan=z='${zexpr}':x='max(0,min(iw-iw/zoom,iw*(${xexpr})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${yexpr})-ih/zoom/2))':d=1:s=${tw}x${th}:fps=${fps},format=rgba`;
        }
        const radius = clamp(
            ((t.borderRadius || (full ? p.canvas.radius : 0)) * w) /
              p.canvas.width,
            0,
            Math.min(tw, th) / 2,
          ),
          elapsed = (c as Clip & { _elapsed?: number })._elapsed ?? clipEffectTiming(c).offset,
          whole = (c as Clip & { _fullDuration?: number })._fullDuration ?? clipEffectTiming(c).duration;
        let alpha = "alpha(X,Y)";
        if (radius > 0) {
          const key = `mask:${tw}:${th}:${radius}:${c.start}:${d}`;
          let mask = sourceInputs.get(key);
          if (mask === undefined) {
            const file = await rasterize(
              {
                width: tw,
                height: th,
                type: "mask",
                x: 0,
                y: 0,
                boxWidth: 1,
                boxHeight: 1,
                color: "#ffffff",
                background: "#000000",
                fontSize: 12,
                opacity: 1,
                rotation: 0,
                radius,
              },
              dir,
              j,
            );
            args.push(
              "-threads",
              "2",
              "-loop",
              "1",
              "-framerate",
              String(fps),
              "-t",
              seconds(d + 1 / fps),
              "-i",
              file,
            );
            mask = input++;
            sourceInputs.set(key, mask);
          }
          filters.push(
            `${chain}[unmasked${ci}]`,
            `[${mask}:v]format=rgba[roundMask${ci}]`,
          );
          chain = `[unmasked${ci}][roundMask${ci}]lut2=c0=x:c1=x:c2=x:c3=x*y/255:shortest=1`;
        }
        if ((c.effectTiming || elapsed > 0) && fx.fadeIn > elapsed)
          alpha += `*min(1,(T+${elapsed})/${Math.min(fx.fadeIn, whole)})`;
        if ((c.effectTiming || elapsed > 0) && fx.fadeOut > 0)
          alpha += `*min(1,max(0,(${whole}-T-${elapsed})/${Math.min(fx.fadeOut, whole)}))`;
        if (alpha !== "alpha(X,Y)")
          chain += `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'`;
        if (t.rotation)
          chain += `,rotate=${clamp(t.rotation, -360, 360)}*PI/180:c=none:ow=rotw(iw):oh=roth(ih)`;
        if (t.opacity < 1)
          chain += `,colorchannelmixer=aa=${clamp(t.opacity, 0, 1)}`;
        if (!c.effectTiming && fx.fadeIn > 0 && elapsed === 0)
          chain += `,fade=t=in:st=0:d=${Math.min(fx.fadeIn, d)}:alpha=1`;
        if (!c.effectTiming && fx.fadeOut > 0 && elapsed === 0 && d >= whole)
          chain += `,fade=t=out:st=${Math.max(0, d - fx.fadeOut)}:d=${Math.min(fx.fadeOut, d)}:alpha=1`;
        chain += `,setpts=PTS+${c.start}/TB[v${ci}]`;
        filters.push(chain);
        const shadow=clipShadow(t,w/p.canvas.width);
        let foreground=`v${ci}`;
        if(shadow){
          // Blur only the padded alpha plane. RGB stays the requested shadow
          // color, avoiding black edge halos and preserving rounded corners.
          const margin=Math.max(2,Math.ceil(shadow.blur*1.5)+2);
          filters.push(`[v${ci}]split[foreground${ci}][shadowInput${ci}]`);
          const blur=shadow.blur>0?`,gblur=sigma=${shadow.blur/2}:steps=2:planes=8`:'';
          filters.push(`[shadowInput${ci}]pad=iw+${margin*2}:ih+${margin*2}:${margin}:${margin}:color=black@0,format=rgba,lutrgb=r=${shadow.r}:g=${shadow.g}:b=${shadow.b},colorchannelmixer=aa=${shadow.alpha}${blur}[shadow${ci}]`);
          const shadowBase=`base${++layer}`;
          filters.push(`[${base}][shadow${ci}]overlay=x=${Math.round(t.x*w+shadow.x-margin)}:y=${Math.round(t.y*h+shadow.y-margin)}:enable='gte(t,${c.start})*lt(t,${c.start+d})':eof_action=pass:repeatlast=0[${shadowBase}]`);
          base=shadowBase;foreground=`foreground${ci}`;
        }
        const next = `base${++layer}`;
        filters.push(
          `[${base}][${foreground}]overlay=x=${Math.round(t.x * w)}:y=${Math.round(t.y * h)}:enable='gte(t,${c.start})*lt(t,${c.start + d})':eof_action=pass:repeatlast=0[${next}]`,
        );
        base = next;
      }
      if (m.hasAudio && !c.muted && c.gain > 0) {
        const fx = c.effects;
        let audioInput = idx, audioDuration = sourceDur, audioTempo = tempo(speed);
        if (fx.denoise || fx.normalize) {
          const prepared = await processedAudio(c, m, j);
          if (prepared.cacheHit) audioCacheHits++; else audioCacheMisses++;
          audioFiles.add(prepared.file);
          args.push("-threads", "2", "-ss", seconds(prepared.offset), "-t", seconds(d), "-i", prepared.file);
          audioInput = input++;
          audioDuration = d;
          audioTempo = [];
        }
        const parts = [
          `[${audioInput}:a]atrim=duration=${seconds(audioDuration)}`,
          "asetpts=PTS-STARTPTS",
          ...audioTempo,
          "aresample=48000",
          `aformat=sample_fmts=fltp:channel_layouts=stereo`,
          `volume=${clamp(c.gain, 0, 8)}`,
        ];
        const elapsed = (c as Clip & { _elapsed?: number })._elapsed ?? clipEffectTiming(c).offset,
          whole = (c as Clip & { _fullDuration?: number })._fullDuration ?? clipEffectTiming(c).duration;
        if (fx.fadeIn > 0 || fx.fadeOut > 0) {
          let envelope = "1";
          if (fx.fadeIn > 0) envelope += `*min(1,(t+${elapsed})/${fx.fadeIn})`;
          if (fx.fadeOut > 0)
            envelope += `*min(1,max(0,(${whole}-t-${elapsed})/${fx.fadeOut}))`;
          // Evaluate at each sample: decoder-frame boundaries change when a clip
          // is split, but the envelope must keep the same source-time phase.
          parts.push(`aeval=exprs='val(ch)*(${envelope})':c=same`);
        }
        parts.push(`adelay=${Math.round(c.start * 48000)}S:all=1`);
        audioFilters.push(parts.join(",") + `[a${ci}]`);
        audio.push(`[a${ci}]`);
      }
    }
    if (video) {
      for (const e of p.elements.filter(
        (e) => e.type === "blur" && e.duration > 0,
      )) {
        const bw = even(clamp(e.width, 0.01, 1) * w),
          bh = even(clamp(e.height, 0.01, 1) * h),
          x = Math.round(clamp(e.x, 0, 1 - bw / w) * w),
          y = Math.round(clamp(e.y, 0, 1 - bh / h) * h),
          n = ++layer;
        filters.push(
          `[${base}]split[before${n}][region${n}]`,
          `[region${n}]crop=${bw}:${bh}:${x}:${y},gblur=sigma=15[blur${n}]`,
          `[before${n}][blur${n}]overlay=${x}:${y}:enable='between(t,${e.start},${e.start + e.duration})'[base${n}]`,
        );
        base = `base${n}`;
      }
      const graphics = await createGraphics(
        p,
        w,
        h,
        dir,
        j,
        o.burnCaptions !== false,
      );
      for (const g of graphics) {
        args.push(
          "-threads",
          "2",
          "-loop",
          "1",
          "-framerate",
          String(fps),
          "-t",
          String(duration + 1 / fps),
          "-i",
          g.file,
        );
        const n = ++layer;
        filters.push(
          `[${input++}:v]format=rgba[g${n}]`,
          `[${base}][g${n}]overlay=0:0:enable='between(t,${g.start},${g.start + g.duration})':eof_action=pass[base${n}]`,
        );
        base = `base${n}`;
      }
      if (p.cursor.enabled && p.cursor.points.length) {
        const pts = [...p.cursor.points].sort((a, b) => a.time - b.time);
        const size = even(clamp((p.cursor.size * w) / p.canvas.width, 8, 256));
        const file = await rasterize(
          {
            width: size * 2,
            height: size * 2,
            type: "cursor",
            x: 0,
            y: 0,
            boxWidth: 1,
            boxHeight: 1,
            color: p.cursor.color,
            background: p.cursor.highlight ? "#ffff0060" : "#00000000",
            fontSize: size,
            opacity: 1,
            rotation: 0,
          },
          dir,
          j,
        );
        args.push(
          "-threads",
          "2",
          "-loop",
          "1",
          "-framerate",
          String(fps),
          "-t",
          String(duration + 1 / fps),
          "-i",
          file,
        );
        const expr = (key: "x" | "y", dimension: number) => {
          const terms = [String(pts[0][key] * dimension)];
          let previous = pts[0][key];
          for (let k = 1; k < pts.length; k++) {
            const point = pts[k],
              last = pts[k - 1],
              reset = last.visible === false || point.visible === false,
              next =
                reset ? point[key] : previous +
                (point[key] - previous) *
                  (1 - clamp(p.cursor.smoothing, 0, 1) * 0.8),
              delta = (next - previous) * dimension,
              dt = Math.max(0.001, point.time - last.time);
            if (delta !== 0) terms.push(reset
              ? `(${delta})*gte(t,${point.time})`
              : `(${delta})*min(1,max(0,(t-${last.time})/${dt}))`);
            previous = next;
          }
          return filterSum(terms);
        };
        const visible = filterSum(pts.flatMap((point, index) => {
          const end = pts[index + 1]?.time ?? duration;
          return point.visible === false || end <= point.time ? [] : [`gte(t,${point.time})*lt(t,${end})`];
        }));
        const n = ++layer;
        filters.push(
          `[${base}][${input++}:v]overlay=x='${expr("x", w)}':y='${expr("y", h)}':enable='${visible}':eof_action=pass[base${n}]`,
        );
        base = `base${n}`;
      }
      filters.push(`[${base}]format=yuv420p[vout]`);
    }
    audioFilters.push(
      `${audio.join("")}amix=inputs=${audio.length}:duration=longest:normalize=0${o.losslessAudio ? "" : ",alimiter=limit=0.95:latency=1"},atrim=end_sample=${audioSamples}[aout]`,
    );
    // A joint A/V graph sporadically deadlocks in this FFmpeg scheduler when
    // finite media and looped graphics reach EOF together. Separate graphs
    // remove the shared decoder/backpressure dependency; mux does stream copy.
    const inputArgs = [...args];
    const audioFilterFile = path.join(dir, "audio-filters.txt");
    await fs.writeFile(audioFilterFile, audioFilters.join(";\n"));
    const filterFile = path.join(dir, "filters.txt");
    await fs.writeFile(filterFile, (video ? filters : audioFilters).join(";\n"));
    args.push("-/filter_complex", filterFile);
    args.push("-map", video ? "[vout]" : "[aout]");
    // Video duration is an integer number of frames. FFmpeg rounds an output
    // -t to the encoder time base, which drops the last frame when a timeline
    // ends early within that frame. Keep its exact count; audio/mux keep the
    // original continuous timeline duration.
    if (video) args.push("-frames:v", String(expectedFrames));
    else args.push("-t", seconds(duration));
    if (o.format === "wav") args.push("-c:a", o.losslessAudio ? "pcm_f32le" : "pcm_s16le");
    else if (o.format === "webm")
      args.push(
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-crf",
        o.quality === "high" ? "22" : "32",
        "-b:v",
        "0",
      );
    else {
      const hw = o.hardware && (await getCapabilities()).hardwareEncode;
      args.push("-c:v", hw ? "h264_videotoolbox" : "libx264");
      if (hw)
        args.push(
          "-b:v",
          String(
            Math.round(w * h * fps * (o.quality === "high" ? 0.16 : 0.09)),
          ),
        );
      else
        args.push(
          "-preset",
          o.quality === "draft" ? "ultrafast" : "veryfast",
          "-crf",
          o.quality === "high" ? "17" : o.quality === "draft" ? "28" : "22",
        );
    }
    const tmp = path.join(dir, `output.${o.format}`);
    const videoTemp = path.join(dir, "video.mkv"), audioTemp = path.join(dir, "audio.mkv");
    if (video) args.push("-an", "-f", "matroska");
    args.push("-threads", "4", "-progress", "pipe:2", "-nostats", video ? videoTemp : tmp);
    const begin = performance.now();
    await command(FFMPEG, args, j, progress(j, duration));
    if (video) {
      j.message = "Mixing audio";
      await command(FFMPEG, [...inputArgs, "-/filter_complex", audioFilterFile,
        "-map", "[aout]", "-vn", "-t", String(duration), "-c:a", o.losslessAudio ? "pcm_f32le" : "pcm_s16le", "-threads", "2", audioTemp], j);
      j.message = "Finalizing media";
      const mux = ["-hide_banner", "-nostdin", "-y", "-i", videoTemp, "-i", audioTemp,
        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-t", String(duration)];
      if (o.losslessAudio) mux.push("-c:a", "copy", "-f", "matroska");
      else if (o.format === "webm") mux.push("-c:a", "libopus", "-b:a", "192k");
      else mux.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart");
      await command(FFMPEG, [...mux, tmp], j);
    }
    const check = JSON.parse(
      await command(
        FFPROBE,
        ["-v", "error", "-count_packets", "-show_format", "-show_streams", "-of", "json", tmp],
        j,
      ),
    );
    if (
      !check.streams?.length ||
      Math.abs(Number(check.format.duration) - duration) >
        1 / fps + 1e-6
    )
      throw new Error(
        "Output validation failed: incorrect duration or missing streams",
      );
    if (video && Number(check.streams.find((s: any) => s.codec_type === "video")?.nb_read_packets) !== expectedFrames)
      throw new Error(`Output validation failed: expected ${expectedFrames} video frames, got ${check.streams.find((s: any) => s.codec_type === "video")?.nb_read_packets} (${duration}s at ${fps}fps)`);
    if (
      video &&
      !check.streams.some(
        (s: any) => s.codec_type === "video" && s.width === w && s.height === h,
      )
    )
      throw new Error("Output validation failed: canvas dimensions");
    if (stopped(j)) throw new Error("Cancelled");
    await fs.rename(tmp, out);
    await fs.writeFile(
      out + ".metrics.json",
      JSON.stringify(
        {
          wallSeconds: (performance.now() - exportBegan) / 1000,
          encodingWallSeconds: (performance.now() - begin) / 1000,
          peakChildRssKiB: peakRss.get(j.id) || null,
          timelineSeconds: duration,
          width: w,
          height: h,
          fps,
          clipCount: p.clips.length,
          uniqueSourceInputs: sourceInputs.size,
          audioCacheHits,
          audioCacheMisses,
          streams: check.streams.map((s: any) => ({
            codec: s.codec_name,
            type: s.codec_type,
            width: s.width,
            height: s.height,
            duration: s.duration,
          })),
          limitations: [
            "Cursor position interpolation and smoothing are independently implemented; exact original animation parity is unverified.",
            "Preview/export fonts and exact appearance require visual comparison.",
          ],
        },
        null,
        2,
      ),
    );
    j.outputPath = out;
  } finally {
    for (const file of audioFiles) pinnedAudioFiles.delete(file);
    if (audioFiles.size) await pruneAudioCache().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Bound simultaneous decoders and raster inputs by rendering time windows, then stream-copying them. */
function sliceProject(p: Project, start: number, end: number): Project {
  const q = structuredClone(p);
  q.scenes = [
    {
      id: "render-window",
      name: "Render window",
      script: "",
      notes: "",
      start: 0,
      duration: cleanTime(end - start),
    },
  ];
  q.clips = p.clips.flatMap((c) => {
    const duration = clipDuration(c),
      left = Math.max(start, c.start),
      right = Math.min(end, c.start + duration);
    if (right - left <= TIME_EPSILON) return [];
    const elapsed = left - c.start;
    return [
      {
        ...structuredClone(c),
        start: cleanTime(left - start),
        sourceIn: cleanTime(c.sourceIn + elapsed * c.speed),
        sourceOut: cleanTime(c.sourceIn + (right - c.start) * c.speed),
        _audioSourceIn: (c as AudioOriginClip)._audioSourceIn ?? clipEffectTiming(c).sourceIn,
        _audioSourceOut: (c as AudioOriginClip)._audioSourceOut ?? clipEffectTiming(c).sourceOut,
        _elapsed: elapsed + ((c as Clip & { _elapsed?: number })._elapsed ?? clipEffectTiming(c).offset),
        _fullDuration:
          (c as Clip & { _fullDuration?: number })._fullDuration ?? clipEffectTiming(c).duration,
      },
    ];
  });
  q.captions = p.captions
    .filter((c) => Math.min(c.end, end) - Math.max(c.start, start) > TIME_EPSILON)
    .map((c) => ({
      ...c,
      _wordStart: ((c as typeof c & { _wordStart?: number })._wordStart ?? c.start) - start,
      _wordEnd: ((c as typeof c & { _wordEnd?: number })._wordEnd ?? c.end) - start,
      start: cleanTime(Math.max(0, c.start - start)),
      end: cleanTime(Math.min(end - start, c.end - start)),
    }));
  q.elements = p.elements
    .filter((e) => Math.min(end, e.start + e.duration) - Math.max(start, e.start) > TIME_EPSILON)
    .map((e) => ({
      ...e,
      start: cleanTime(Math.max(0, e.start - start)),
      duration: cleanTime(Math.min(end, e.start + e.duration) - Math.max(start, e.start)),
    }));
  q.zooms = p.zooms
    .filter((z) => Math.min(end, z.start + z.duration) - Math.max(start, z.start) > TIME_EPSILON)
    .map((z) => ({ ...z, start: z.start - start }));
  const pts = [...p.cursor.points].sort((a, b) => a.time - b.time);
  const at = (time: number) => {
    if (!pts.length) return undefined;
    if (time < pts[0].time) return { ...pts[0], time: time - start, visible: false };
    let index = 0;
    while (index + 1 < pts.length && pts[index + 1].time <= time) index++;
    const a = pts[index], b = pts[index + 1] ?? a;
    const ratio = clamp(
      (time - a.time) / Math.max(0.0001, b.time - a.time),
      0,
      1,
    );
    return {
      time: time - start,
      x: a.visible === false || b.visible === false ? a.x : a.x + (b.x - a.x) * ratio,
      y: a.visible === false || b.visible === false ? a.y : a.y + (b.y - a.y) * ratio,
      pressed: a.pressed,
      visible: a.visible,
    };
  };
  q.cursor.points = pts
    .filter((c) => c.time > start && c.time < end)
    .map((c) => ({ ...c, time: c.time - start }));
  if (pts.length) q.cursor.points = [at(start)!, ...q.cursor.points, at(end)!];
  return q;
}
export function startExport(
  project: Project,
  options: ExportOptions,
  outputDir: string,
  lifecycle: RenderLifecycle = {},
): Job {
  const p = structuredClone(project),
    o = structuredClone(options);
  let timelineStart = 0;
  return enqueue("export", async (j) => {
    if (o.range) {
      const { start, end } = o.range,
        total = projectDuration(p);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start ||
        end > total + 0.001
      )
        throw new Error(
          "Export range must satisfy 0 <= start < end <= project duration",
        );
      Object.assign(p, sliceProject(p, start, end));
      timelineStart = start;
      delete o.range;
    }
    const duration = projectDuration(p);
    const fps = clamp(o.fps || p.canvas.fps, 1, 120);
    const totalFrames = frameCountFor(duration, fps);
    const burnCaptions = o.burnCaptions !== false && p.captionStyle.enabled;
    const graphicCount = (q: Project) => (burnCaptions ? q.captions.reduce((sum, c) => sum + captionParts(c, q.captionStyle.maxWords).length, 0) : 0) + q.elements.length;
    const visualCount = (q: Project) => q.clips.filter((c) => c.track !== "audio" && c.track !== "music").length;
    if (
      !["mp4", "webm", "wav"].includes(o.format) ||
      (duration <= 10 &&
        p.clips.length <= 12 && visualCount(p) <= 6 &&
        graphicCount(p) <= 40 &&
        p.cursor.points.length <= 512)
    ) {
      await executeExport(p, o, outputDir, j, { timelineStart });
      return;
    }
    await fs.mkdir(outputDir, { recursive: true });
    const root = path.join(outputDir, `.chunks-${j.id}`);
    await fs.mkdir(root);
    const files: string[] = [], chunkFrames: number[] = [],
      metrics: unknown[] = [];
    const begin = performance.now();
    let maxClips = 0,
      maxGraphics = 0;
    try {
      for (let startFrame = 0; startFrame < totalFrames;) {
        if (stopped(j)) throw new Error("Cancelled");
        const start = startFrame / fps;
        let endFrame = Math.min(totalFrames, startFrame + Math.max(1, Math.floor(10 * fps))),
          end = Math.min(duration, endFrame / fps),
          q = sliceProject(p, start, end);
        while (
          (q.clips.length > 12 || visualCount(q) > 6 || graphicCount(q) > 40 ||
            q.cursor.points.length > 512) &&
          endFrame - startFrame > Math.ceil(fps)
        ) {
          endFrame = startFrame + Math.max(1, Math.floor((endFrame - startFrame) / 2));
          end = Math.min(duration, endFrame / fps);
          q = sliceProject(p, start, end);
        }
        if (
          q.clips.length > 64 || visualCount(q) > 32 ||
          graphicCount(q) > 128 ||
          q.cursor.points.length > 2000
        )
          throw new Error(
            "Too many simultaneous clips/graphics in a render window; simplify layers",
          );
        maxClips = Math.max(maxClips, q.clips.length);
        maxGraphics = Math.max(
          maxGraphics,
          graphicCount(q),
        );
        const childJob = { ...j, id: j.id, progress: 0 };
        const dir = path.join(root, String(files.length));
        await executeExport(q, { ...o, losslessAudio: true, frameCount: endFrame - startFrame,
          audioSamples: Math.round(end * 48000) - Math.round(start * 48000) }, dir, childJob,
          { timelineStart: timelineStart + start, backgroundCacheDir: root });
        if (stopped(getJob(j.id))) throw new Error("Cancelled");
        files.push(childJob.outputPath!);
        chunkFrames.push(endFrame - startFrame);
        metrics.push(
          JSON.parse(
            await fs.readFile(childJob.outputPath! + ".metrics.json", "utf8"),
          ),
        );
        j.progress = (end / duration) * 0.96;
        j.message = `Rendered ${end.toFixed(1)} of ${duration.toFixed(1)} seconds`;
        startFrame = endFrame;
      }
      const concat = path.join(root, "concat.txt");
      await fs.writeFile(
        concat,
        files.map((f, i) => `file '${f.replace(/'/g, "'\\''")}'\nduration ${(chunkFrames[i] / fps).toFixed(12)}`).join("\n"),
      );
      const temp = path.join(root, `joined.${o.format}`);
      const args = [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concat,
        "-c:v",
        "copy",
        "-c:a",
        o.format === "mp4"
          ? "aac"
          : o.format === "webm"
            ? "libopus"
            : "pcm_s16le",
      ];
      if (o.format !== "wav") args.push("-b:a", "192k");
      if (o.format === "mp4") args.push("-movflags", "+faststart");
      args.push("-af", `aresample=48000:async=1:first_pts=0,alimiter=limit=0.95:latency=1,atrim=end_sample=${Math.round(duration * 48000)}`, "-t", seconds(duration));
      args.push(temp);
      await command(FFMPEG, args, j);
      const probe = JSON.parse(
        await command(
          FFPROBE,
          ["-v", "error", "-count_packets", "-show_format", "-show_streams", "-of", "json", temp],
          j,
        ),
      );
      if (
        Math.abs(Number(probe.format.duration) - duration) >
        1 / fps + 1e-6
      )
        throw new Error(
          "Joined output validation failed: timeline duration drift",
        );
      const videoStream = probe.streams.find((s: any) => s.codec_type === "video");
      const audioStream = probe.streams.find((s: any) => s.codec_type === "audio");
      if (o.format !== "wav" && Number(videoStream?.nb_read_packets) !== totalFrames)
        throw new Error(`Joined output validation failed: expected ${totalFrames} video frames, got ${videoStream?.nb_read_packets}`);
      for (const stream of [videoStream, audioStream].filter(Boolean)) {
        const actual = Number(stream.duration);
        if (Number.isFinite(actual) && Math.abs(actual - duration) > 1 / fps + 1e-6)
          throw new Error(`Joined output validation failed: ${stream.codec_type} duration drift`);
      }
      const safe =
          p.name
            .replace(/[^\p{L}\p{N}._ -]/gu, "")
            .trim()
            .slice(0, 70) || "export",
        out = path.join(outputDir, `${safe}-${j.id}.${o.format}`);
      await fs.rename(temp, out);
      await fs.writeFile(
        out + ".metrics.json",
        JSON.stringify(
          {
            wallSeconds: (performance.now() - begin) / 1000,
            peakChildRssKiB: peakRss.get(j.id) || null,
            timelineSeconds: duration,
            videoFrames: o.format === "wav" ? undefined : Number(videoStream.nb_read_packets),
            videoDuration: videoStream?.duration,
            audioDuration: audioStream?.duration,
            expectedVideoFrames: totalFrames,
            frameGridFps: fps,
            chunkCount: files.length,
            maxSimultaneousClips: maxClips,
            maxGraphicsPerChunk: maxGraphics,
            chunks: metrics,
            limitations: [
              "Cursor path smoothing differs from the original app until comparison is measured.",
              "Chunk intermediates use float PCM audio; final audio is limited and encoded once for continuous audio timing.",
            ],
          },
          null,
          2,
        ),
      );
      j.outputPath = out;
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, lifecycle);
}
/** Resolve proxies by fingerprint, including imported media whose IDs are independent UUIDs. */
export async function proxyFile(
  media: Media,
  cacheDir: string,
): Promise<string | undefined> {
  const file = path.join(
    cacheDir,
    `${(await identity(media.path)).key}.proxy.mp4`,
  );
  return (await exists(file)) ? file : undefined;
}
