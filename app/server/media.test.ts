import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  createProject,
  defaultEffects,
  defaultTransform,
  type Clip,
} from "../shared/types.ts";
import {
  probeMedia,
  thumbnail,
  waveform,
  startExport,
  startProxy,
  cancelJob,
  getJob,
  getCapabilities,
  proxyFile,
  inspectFrames,
} from "./media.ts";
const ffmpegBinary = process.env.SCENEFORGE_FFMPEG || "ffmpeg";
const ffprobeBinary = process.env.SCENEFORGE_FFPROBE || "ffprobe";
await fs.mkdir(path.resolve("../evidence"), { recursive: true });
const exec = (args: string[]) => {
  const r = spawnSync(
    ffmpegBinary,
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
};
async function wait(id: string) {
  const begin = Date.now();
  while (Date.now() - begin < 180000) {
    const j = getJob(id)!;
    if (["complete", "failed", "cancelled"].includes(j.status)) {
      assert.equal(j.status, "complete", j.error || j.message);
      return j;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Job timeout");
}

test("continuous audio effects preserve whole-clip timing, gain, cache identity and cancellation", { timeout: 90000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-continuous-audio-"));
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegBinary, ["-v", "error", "-nostdin", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr.toString()); return result.stdout;
  };
  const samples = (file: string, filter?: string) => {
    const bytes = run(["-i", file, "-vn", ...(filter ? ["-af", filter + ",aformat=channel_layouts=stereo"] : []), "-ar", "48000", "-ac", "1", "-f", "f32le", "pipe:1"]);
    return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
  };
  const rms = (x: Float32Array) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
  const relativeError = (a: Float32Array, b: Float32Array) => {
    assert.equal(a.length, b.length, "Audio sample count must match the full-interval reference");
    let error = 0, signal = 0;
    for (let i = 0; i < a.length; i++) { error += (a[i] - b[i]) ** 2; signal += b[i] ** 2; }
    return Math.sqrt(error / signal);
  };
  try {
    const source = path.join(dir, "variable-voice.wav"), duration = 24.3;
    run(["-f", "lavfi", "-i", `aevalsrc=(0.07+0.04*sin(2*PI*t/17))*(sin(2*PI*233*t)+0.3*sin(2*PI*521*t)+0.1*sin(2*PI*997*t)):s=48000:d=${duration}`, "-c:a", "pcm_f32le", source]);
    const m = await probeMedia(source, path.join(dir, "cache")), p = createProject("Continuous audio");
    p.scenes[0].duration = duration; p.media = [m]; p.clips = [{
      id: "voice", name: "Variable voice", mediaId: m.id, track: "audio", start: 0,
      sourceIn: 0, sourceOut: duration, speed: 1, gain: 1, muted: false,
      transform: defaultTransform(), effects: { ...defaultEffects(), normalize: true },
    }];
    const first = await wait(startExport(p, { format: "wav", quality: "high" }, path.join(dir, "out")).id);
    const actual = samples(first.outputPath!), reference = samples(source,
      `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad=whole_len=${Math.round(duration * 48000)},atrim=end_sample=${Math.round(duration * 48000)},alimiter=limit=0.95:latency=1`);
    if (relativeError(actual, reference) >= .001) {
      await fs.copyFile(first.outputPath!, path.resolve("../evidence/native-continuous-debug.wav"));
      await fs.writeFile(path.resolve("../evidence/native-continuous-reference.f32"), Buffer.from(reference.buffer));
    }
    assert.ok(relativeError(actual, reference) < .001, `Chunked normalization must match one continuous full-clip filter run: ${relativeError(actual, reference)}`);
    const joinErrors = [10, 20].map((t) => relativeError(actual.slice((t - .1) * 48000, (t + .1) * 48000), reference.slice((t - .1) * 48000, (t + .1) * 48000)));
    assert.ok(joinErrors.every((e) => e < .001), `Continuous join errors: ${joinErrors}`);
    const firstMetrics = JSON.parse(await fs.readFile(first.outputPath! + ".metrics.json", "utf8"));
    assert.equal(firstMetrics.chunks.reduce((n: number, c: any) => n + c.audioCacheMisses, 0), 1);
    p.clips = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(p.clips[0]), id: `overlap-${i}` }));
    const limited = await wait(startExport(p, { format: "wav", quality: "high" }, path.join(dir, "out")).id);
    const limitedReference = samples(source,
      `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad=whole_len=${Math.round(duration * 48000)},atrim=end_sample=${Math.round(duration * 48000)},volume=4,alimiter=limit=.95:latency=1`);
    const limitedError = relativeError(samples(limited.outputPath!), limitedReference);
    assert.ok(limitedError < .001, `Overlapping tracks must retain full-timeline limiter state and float headroom: ${limitedError}`);
    p.clips = [p.clips[0]];
    p.clips[0].gain = .25;
    const quiet = await wait(startExport(p, { format: "wav", quality: "high" }, path.join(dir, "out")).id);
    const quietSamples = samples(quiet.outputPath!), gainDb = 20 * Math.log10(rms(quietSamples) / rms(actual));
    assert.ok(Math.abs(gainDb - 20 * Math.log10(.25)) < .01, `User gain after normalization: ${gainDb}dB`);
    const quietMetrics = JSON.parse(await fs.readFile(quiet.outputPath! + ".metrics.json", "utf8"));
    assert.equal(quietMetrics.chunks.reduce((n: number, c: any) => n + c.audioCacheMisses, 0), 0, "Gain changes reuse preprocessing");
    p.clips[0].effects.denoise = true; p.clips[0].speed = 1.25; p.scenes[0].duration = duration / 1.25;
    const ranged = await wait(startExport(p, { format: "wav", quality: "high", range: { start: 7.5, end: 12.5 } }, path.join(dir, "out")).id);
    const spedReference = samples(source, "atempo=1.25,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,atrim=start=7.5:end=12.5,asetpts=PTS-STARTPTS,volume=.25,alimiter=limit=.95:latency=1");
    assert.ok(relativeError(samples(ranged.outputPath!), spedReference) < .001, "Range seek must preserve full-interval denoising, speed and normalization state");
    const changedMetrics = JSON.parse(await fs.readFile(ranged.outputPath! + ".metrics.json", "utf8"));
    assert.equal(changedMetrics.audioCacheMisses, 1, "Effect/speed changes invalidate the processed cache");
    const now = new Date(Date.now() + 2000); await fs.utimes(source, now, now);
    const touched = await wait(startExport(p, { format: "wav", quality: "high", range: { start: 7.5, end: 12.5 } }, path.join(dir, "out")).id);
    assert.equal(JSON.parse(await fs.readFile(touched.outputPath! + ".metrics.json", "utf8")).audioCacheMisses, 1, "Source mtime invalidates the processed cache");
    p.clips[0].speed = .05; p.scenes[0].duration = duration / .05;
    const cache = path.join(os.tmpdir(), "sceneforge-audio-effects-v1");
    const before = new Set(await fs.readdir(cache));
    const cancelled = startExport(p, { format: "wav", quality: "high" }, path.join(dir, "out"));
    let sawTemp = false;
    for (let i = 0; i < 500; i++) {
      if ((await fs.readdir(cache)).some((name) => name.endsWith(".tmp") && !before.has(name))) { sawTemp = true; break; }
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(sawTemp, "Cancellation check must reach active preprocessing"); cancelJob(cancelled.id);
    for (let i = 0; i < 500; i++) {
      if (!(await fs.readdir(cache)).some((name) => !before.has(name))) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(getJob(cancelled.id)?.status, "cancelled");
    assert.deepEqual(new Set(await fs.readdir(cache)), before, "Cancelled preprocessing must remove its temporary output without publishing a cache entry");
    await fs.writeFile(path.resolve("../evidence/native-continuous-audio-acceptance.json"), JSON.stringify({
      duration, samples: actual.length, wholeRelativeError: relativeError(actual, reference), joinErrors, limitedRelativeError: limitedError,
      quarterGainDb: gainDb, firstCacheMisses: 1, gainCacheMisses: 0, effectsAndMtimeInvalidation: true, activeCancellationCleanup: true,
    }, null, 2));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("fractional cuts keep frame-grid joins, audio and captions aligned without float-dust clips", { timeout: 90000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-fractional-"));
  const run = (args: string[]) => {
    const r = spawnSync(ffmpegBinary, ["-v", "error", "-nostdin", "-y", ...args], { maxBuffer: 32 * 1024 * 1024 });
    assert.equal(r.status, 0, r.stderr.toString());
    return r.stdout;
  };
  try {
    const blue = path.join(dir, "blue.mp4"), red = path.join(dir, "red.mp4");
    for (const [file, color, frequency] of [[blue, "blue", "440"], [red, "red", "880"]])
      run(["-f", "lavfi", "-i", `color=c=${color}:s=160x90:r=30:d=12`, "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=12`, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", file]);
    const cache = path.join(dir, "cache"), b = await probeMedia(blue, cache), r = await probeMedia(red, cache);
    const p = createProject("Fractional boundary acceptance");
    const duration = 23.017;
    p.canvas = { width: 160, height: 90, fps: 30, background: "#000000", padding: 0, radius: 0 };
    p.scenes[0].duration = duration;
    p.media = [b, r];
    const cuts = [0, 10.01, 10.2 + 7.105427357601002e-15, 20.023, duration];
    p.clips = cuts.slice(0, -1).map((start, i) => ({
      id: `fraction-${i}`, name: `Fraction ${i}`, mediaId: i % 2 ? r.id : b.id, track: "screen" as const,
      start, sourceIn: 0, sourceOut: cuts[i + 1] - start, speed: 1, gain: 1, muted: false,
      transform: defaultTransform(), effects: defaultEffects(),
    }));
    p.clips.push({ ...p.clips[0], id: "dust-audio", name: "Float dust at ten seconds", track: "audio", sourceOut: 10 + 7.105427357601002e-15, gain: 0.00001 });
    p.captions = Array.from({ length: 200 }, (_, i) => ({ id: `unused-${i}`, start: i * 0.1, end: i * 0.1 + 0.075, text: "Disabled caption" }));
    const job = await wait(startExport(p, { format: "mp4", quality: "draft", burnCaptions: false }, path.join(dir, "out")).id);
    const metrics = JSON.parse(await fs.readFile(job.outputPath! + ".metrics.json", "utf8"));
    assert.equal(metrics.chunkCount, 3, "Disabled captions and cuts must not force extra chunks");
    assert.equal(metrics.videoFrames, 691);
    const probe = spawnSync(ffprobeBinary, ["-v", "error", "-count_packets", "-show_format", "-show_streams", "-of", "json", job.outputPath!]);
    assert.equal(probe.status, 0, probe.stderr.toString());
    const metadata = JSON.parse(probe.stdout.toString());
    const video = metadata.streams.find((s: any) => s.codec_type === "video"), audio = metadata.streams.find((s: any) => s.codec_type === "audio");
    assert.equal(Number(video.nb_read_packets), 691);
    assert.ok(Math.abs(Number(video.duration) - duration) <= 1 / 30);
    assert.ok(Math.abs(Number(audio.duration) - duration) <= 1 / 30);
    const pixelAt = (frame: number) => {
      const pixels = run(["-i", job.outputPath!, "-vf", `select='eq(n,${frame})'`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      return [...pixels.subarray((45 * 160 + 80) * 3, (45 * 160 + 80) * 3 + 3)];
    };
    const lastBlue = pixelAt(300), firstRed = pixelAt(301), blueAgain = pixelAt(307);
    assert.ok(lastBlue[2] > 200 && lastBlue[0] < 30, `10.000s remains blue: ${lastBlue}`);
    assert.ok(firstRed[0] > 200 && firstRed[2] < 30, `10.033s turns red: ${firstRed}`);
    assert.ok(blueAgain[2] > 200 && blueAgain[0] < 30, `10.233s returns blue: ${blueAgain}`);
    const toneRatio = (time: number) => {
      const pcm = run(["-ss", String(time), "-i", job.outputPath!, "-t", "0.06", "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"]);
      const energy = (hz: number) => {
        let re = 0, im = 0;
        for (let i = 0; i < pcm.length / 4; i++) { const v = pcm.readFloatLE(i * 4), a = i * 2 * Math.PI * hz / 48000; re += v * Math.cos(a); im += v * Math.sin(a); }
        return re * re + im * im;
      };
      return energy(880) / Math.max(1e-12, energy(440));
    };
    assert.ok(toneRatio(10.07) > 20, "880Hz segment survives the fractional audio cut");
    assert.ok(toneRatio(10.24) < 0.05, "440Hz audio returns at the matching timeline time");
    const fractionalRate = await wait(startExport(p, { format: "mp4", quality: "draft", burnCaptions: false, fps: 30000 / 1001 }, path.join(dir, "fractional-fps")).id);
    const fractionalMetrics = JSON.parse(await fs.readFile(fractionalRate.outputPath! + ".metrics.json", "utf8"));
    assert.equal(fractionalMetrics.videoFrames, Math.ceil(duration * 30000 / 1001));
    assert.ok(Math.abs(Number(fractionalMetrics.videoDuration) - duration) <= 1001 / 30000);
    assert.ok(Math.abs(Number(fractionalMetrics.audioDuration) - duration) <= 1001 / 30000);
    p.captions = [{ id: "caption-boundary", start: 9.99, end: 10.055, text: "SYNC" }];
    p.captionStyle = { ...p.captionStyle, fontSize: 12, position: "top", color: "#ffffff", background: "#000000" };
    const frames = await inspectFrames(p, [9.97, 10.0, 10.07], path.join(dir, "frames"), { width: 160 });
    const whites = frames.map((frame) => {
      const pixels = run(["-i", frame.path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      let count = 0; for (let i = 0; i < pixels.length; i += 3) if (pixels[i] > 190 && pixels[i + 1] > 190 && pixels[i + 2] > 190) count++;
      return count;
    });
    assert.equal(whites[0], 0); assert.ok(whites[1] > 10); assert.equal(whites[2], 0);
    p.captions = [{ id: "multi-word", start: 9, end: 11, text: "WIDE I" }];
    p.captionStyle.maxWords = 1;
    const grouped = await inspectFrames(p, [9.5, 10.5], path.join(dir, "word-timing"), { width: 160 });
    const reference = structuredClone(p);
    reference.captions = [{ id: "first", start: 9, end: 10, text: "WIDE" }, { id: "second", start: 10, end: 11, text: "I" }];
    const expected = await inspectFrames(reference, [9.5, 10.5], path.join(dir, "word-timing"), { width: 160 });
    for (let i = 0; i < 2; i++) {
      const decode = (file: string) => run(["-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      assert.deepEqual(decode(grouped[i].path), decode(expected[i].path), "Caption word timing survives range/chunk slicing");
    }
    await fs.writeFile(path.resolve("../evidence/native-fractional-acceptance.json"), JSON.stringify({ duration, metrics, fractionalRateMetrics: fractionalMetrics, videoDuration: video.duration, audioDuration: audio.duration, cuts, pixels: { lastBlue, firstRed, blueAgain }, captionWhitePixels: whites, toneRatios: { red: toneRatio(10.07), blue: toneRatio(10.24) } }, null, 2));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test(
  "media pipeline produces real cached artifacts and composed A/V export",
  { timeout: 180000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-media-"));
    try {
      const source = path.join(dir, "source.mp4"),
        camera = path.join(dir, "camera.mp4");
      exec([
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180:r=15:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        source,
      ]);
      exec([
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=160x90:r=15:d=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        camera,
      ]);
      const cache = path.join(dir, "cache"),
        m = await probeMedia(source, cache),
        cam = await probeMedia(camera, cache);
      assert.equal(m.width, 320);
      assert.ok(m.hasAudio);
      assert.ok((await getCapabilities()).ffmpeg);
      assert.deepEqual(await probeMedia(source, cache), m);
      const [t1, t2] = await Promise.all([
        thumbnail(m, cache),
        thumbnail(m, cache),
      ]);
      assert.equal(t1, t2);
      assert.ok((await fs.stat(t1)).size > 0);
      const peaks = await waveform(m, cache);
      assert.ok(peaks.some((v) => v > 0.01));
      assert.ok(peaks.length <= 1600);
      const proxy = await wait(startProxy(m, cache).id);
      assert.ok(proxy.outputPath && (await fs.stat(proxy.outputPath)));
      assert.equal(
        await proxyFile({ ...m, id: "foreign-uuid" }, cache),
        proxy.outputPath,
      );
      const p = createProject("Acceptance");
      p.canvas = {
        width: 320,
        height: 180,
        fps: 15,
        background: "#101010",
        padding: 0,
        radius: 0,
      };
      p.media = [m, cam];
      p.scenes[0].duration = 2;
      p.clips = [
        {
          id: "screen",
          mediaId: m.id,
          name: "Blue screen",
          track: "screen",
          start: 0,
          sourceIn: 0,
          sourceOut: 2,
          speed: 1,
          gain: 1,
          muted: false,
          transform: defaultTransform(),
          effects: defaultEffects(),
        },
        {
          id: "camera",
          mediaId: cam.id,
          name: "Red PiP",
          track: "camera",
          start: 0.5,
          sourceIn: 0,
          sourceOut: 1,
          speed: 1,
          gain: 0,
          muted: true,
          transform: {
            ...defaultTransform(),
            x: 0.6,
            y: 0.6,
            width: 0.35,
            height: 0.35,
          },
          effects: defaultEffects(),
        },
      ];
      p.captions = [
        { id: "caption", start: 0, end: 2, text: "Hello timeline" },
      ];
      p.captionStyle.fontSize = 18;
      p.captionStyle.position = "top";
      p.elements = [
        {
          id: "box",
          type: "rectangle",
          text: "",
          start: 0,
          duration: 2,
          x: 0.1,
          y: 0.6,
          width: 0.2,
          height: 0.2,
          color: "#00ff00",
          background: "#000000",
          fontSize: 18,
          opacity: 1,
          rotation: 0,
        },
      ];
      const j = await wait(
        startExport(
          p,
          { format: "mp4", width: 320, height: 180, fps: 15, quality: "draft" },
          path.join(dir, "out"),
        ).id,
      );
      const result = await probeMedia(j.outputPath!, cache);
      assert.equal(result.width, 320);
      assert.equal(result.height, 180);
      assert.ok(result.hasAudio);
      assert.ok(Math.abs(result.duration - 2) < 0.15);
      assert.ok((await fs.stat(j.outputPath!)).size > 1000);
      const sample = spawnSync(
        ffmpegBinary,
        [
          "-v",
          "error",
          "-ss",
          "1",
          "-i",
          j.outputPath!,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { maxBuffer: 2e6 },
      );
      assert.equal(sample.status, 0, sample.stderr.toString());
      const pixel = (x: number, y: number) => [
        ...sample.stdout.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3),
      ];
      const blue = pixel(160, 100),
        red = pixel(240, 140),
        green = pixel(55, 125);
      assert.ok(blue[2] > 150 && blue[0] < 70, `blue=${blue}`);
      assert.ok(red[0] > 150 && red[2] < 80, `red=${red}`);
      assert.ok(green[1] > 120 && green[0] < 80, `green=${green}`);
      const srt = await wait(
        startExport(p, { format: "srt" }, path.join(dir, "out")).id,
      );
      assert.match(
        await fs.readFile(srt.outputPath!, "utf8"),
        /00:00:00,000 --> 00:00:02,000/,
      );
      const ranged = await wait(
        startExport(
          p,
          {
            format: "mp4",
            width: 320,
            height: 180,
            fps: 15,
            quality: "draft",
            range: { start: 0.5, end: 1.5 },
          },
          path.join(dir, "out"),
        ).id,
      );
      const rangedProbe = await probeMedia(ranged.outputPath!, cache);
      assert.ok(Math.abs(rangedProbe.duration - 1) < 0.15);
      const rangedSrt = await wait(
        startExport(
          p,
          { format: "srt", range: { start: 0.5, end: 1.5 } },
          path.join(dir, "out"),
        ).id,
      );
      assert.match(
        await fs.readFile(rangedSrt.outputPath!, "utf8"),
        /00:00:00,000 --> 00:00:01,000/,
      );
      const smallTitle = structuredClone(p);
      smallTitle.clips = [smallTitle.clips[0]];
      smallTitle.captionStyle.enabled = false;
      smallTitle.elements = [{ ...smallTitle.elements[0], type: "text", text: "Small title", x: 0.1, y: 0.1, width: 0.8, height: 0.14, color: "#ffffff", fontSize: 18 }];
      const frameDir = path.join(dir, "frames");
      const inspected = await inspectFrames(smallTitle, [0.25, 1.999], frameDir, { width: 320 });
      assert.equal(inspected[0].width, 320);
      assert.equal(inspected[0].height, 180);
      assert.equal(inspected[0].time, 0.2);
      assert.ok(inspected[1].time < 2);
      const frameStat = await fs.stat(inspected[0].path);
      assert.equal((await inspectFrames(smallTitle, [0.25], frameDir, { width: 320 }))[0].path, inspected[0].path);
      assert.equal((await fs.stat(inspected[0].path)).mtimeMs, frameStat.mtimeMs);
      const framePixels = (file: string) => {
        const r = spawnSync(ffmpegBinary, ["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
        assert.equal(r.status, 0, r.stderr.toString());
        assert.equal(r.stdout.length, 320 * 180 * 3);
        return r.stdout;
      };
      const titlePixels = framePixels(inspected[0].path), titleRows = new Set<number>();
      let titlePixelCount = 0;
      for (let i = 0; i < titlePixels.length; i += 3) if (titlePixels[i] > 180 && titlePixels[i + 1] > 180 && titlePixels[i + 2] > 180) {
        titleRows.add(Math.floor(i / 3 / 320)); titlePixelCount++;
      }
      assert.ok(titleRows.size >= 10 && titlePixelCount > 100, `Short text box must retain full glyphs: ${titleRows.size} rows, ${titlePixelCount} pixels`);
      smallTitle.elements[0].color = "#ff0000";
      const editedFrame = (await inspectFrames(smallTitle, [0.25], frameDir, { width: 320 }))[0];
      assert.notEqual(editedFrame.path, inspected[0].path, "An edit must invalidate composed frame cache");
      const editedPixels = framePixels(editedFrame.path);
      let redTitlePixels = 0;
      for (let i = 0; i < editedPixels.length; i += 3)
        if (editedPixels[i] > 150 && editedPixels[i + 1] < 90 && editedPixels[i + 2] < 90) redTitlePixels++;
      assert.ok(redTitlePixels > 100, "Inspected frame includes the edited red title");
      await assert.rejects(() => inspectFrames(smallTitle, Array(7).fill(0), frameDir), /one and six/);
      await fs.copyFile(inspected[0].path, path.resolve("../evidence/native-small-title.png"));
      await fs.copyFile(editedFrame.path, path.resolve("../evidence/native-small-title-edited.png"));
      // Two jobs exercise queued cancellation without leaving partial output.
      const long = structuredClone(p);
      long.scenes[0].duration = 22;
      long.canvas.padding = 4;
      long.canvas.radius = 6;
      long.clips = [];
      for (let i = 0; i < 11; i++)
        long.clips.push({
          ...structuredClone(p.clips[0]),
          id: "repeat-" + i,
          start: i * 2,
        });
      long.cursor = {
        enabled: true,
        size: 10,
        color: "#ffffff",
        highlight: true,
        smoothing: 0,
        points: [
          { time: 0, x: 0.1, y: 0.5 },
          { time: 2, x: 0.1, y: 0.5, visible: false },
          { time: 12, x: 0.8, y: 0.5, visible: true },
          { time: 22, x: 0.2, y: 0.5 },
        ],
      };
      long.zooms = [
        {
          id: "z1",
          target: "screen",
          start: 1,
          duration: 2,
          scale: 1.5,
          x: 0.5,
          y: 0.5,
          easing: "smooth",
        },
        {
          id: "z2",
          target: "screen",
          start: 11,
          duration: 2,
          scale: 2,
          x: 0.5,
          y: 0.5,
          easing: "linear",
        },
      ];
      const first = startExport(
        long,
        { format: "mp4", quality: "draft", burnCaptions: false },
        path.join(dir, "out"),
      );
      const second = startExport(p, { format: "mp4" }, path.join(dir, "out"));
      cancelJob(second.id);
      assert.equal(getJob(second.id)?.status, "cancelled");
      const chunked = await wait(first.id);
      const chunkMetrics = JSON.parse(
        await fs.readFile(chunked.outputPath! + ".metrics.json", "utf8"),
      );
      assert.equal(chunkMetrics.chunkCount, 3);
      assert.ok(chunkMetrics.maxSimultaneousClips <= 5);
      const chunkProbe = await probeMedia(chunked.outputPath!, cache);
      assert.ok(
        Math.abs(chunkProbe.duration - 22) < 0.12,
        `Chunk duration ${chunkProbe.duration}`,
      );
      const countWhite = (time: number) => {
        const frame = spawnSync(ffmpegBinary, ["-v", "error", "-ss", String(time), "-i", chunked.outputPath!, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
        assert.equal(frame.status, 0, frame.stderr.toString());
        let count = 0;
        for (let i = 0; i < frame.stdout.length; i += 3)
          if (frame.stdout[i] > 210 && frame.stdout[i + 1] > 210 && frame.stdout[i + 2] > 210) count++;
        return count;
      };
      assert.equal(countWhite(10.5), 0, "Cursor stays hidden through a chunk boundary");
      assert.ok(countWhite(12.5) > 5, "Cursor returns in the next visible interval");
      const audioCheck = spawnSync(ffmpegBinary, [
        "-v",
        "error",
        "-ss",
        "9.9",
        "-i",
        chunked.outputPath!,
        "-t",
        "0.2",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "pipe:1",
      ]);
      assert.equal(audioCheck.status, 0);
      let energy = 0;
      for (let n = 0; n < audioCheck.stdout.length; n += 2)
        energy += audioCheck.stdout.readInt16LE(n) ** 2;
      assert.ok(
        Math.sqrt(energy / (audioCheck.stdout.length / 2)) > 100,
        "Audio survives chunk boundary",
      );
      const evidence = path.resolve(
        "../evidence/native-rebuild-media-acceptance.json",
      );
      await fs.writeFile(
        evidence,
        JSON.stringify(
          {
            validatedAt: new Date().toISOString(),
            fixture:
              "synthetic 2s blue screen + 0.5s-offset red camera + green shape + text captions + 440Hz audio",
            output: result,
            pixels: { blue, red, green },
            waveformBins: peaks.length,
            probeCache: true,
            proxy: true,
            cancelledQueuedJob: true,
            frameInspection: { time: inspected[0].time, titleRows: titleRows.size, titlePixelCount, redTitlePixels, cacheReused: true, cacheInvalidatedByEdit: true },
            chunking: chunkMetrics,
            chunkBoundaryAudioRms: Math.sqrt(
              energy / (audioCheck.stdout.length / 2),
            ),
            metrics: JSON.parse(
              await fs.readFile(j.outputPath! + ".metrics.json", "utf8"),
            ),
          },
          null,
          2,
        ),
      );
      await fs.copyFile(
        j.outputPath!,
        path.resolve("../evidence/native-rebuild-export.mp4"),
      );
      await fs.copyFile(
        chunked.outputPath!,
        path.resolve("../evidence/native-rebuild-chunked-export.mp4"),
      );
      const preview = path.resolve("../evidence/native-rebuild-export.png");
      exec(["-ss", "1", "-i", j.outputPath!, "-frames:v", "1", preview]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test('transcript ripple cuts keep normalized audio and fades on their original continuous source', {timeout:60000},async()=>{
 const {cutTimelineRange}=await import('../shared/timeline-edits.ts');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-word-cut-'));
 const run=(args:string[])=>{const r=spawnSync(ffmpegBinary,['-v','error','-nostdin','-y',...args],{maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
 try{
  const source=path.join(dir,'voice.wav');run(['-f','lavfi','-i','aevalsrc=(0.02+0.01*sin(t))*sin(2*PI*223*t):s=48000:d=6','-c:a','pcm_f32le',source]);
  const m=await probeMedia(source,path.join(dir,'cache')),p=createProject('Word cut DSP');p.media=[m];p.scenes[0].duration=6;p.clips=[{id:'voice',mediaId:m.id,name:'Voice',track:'audio',start:0,sourceIn:0,sourceOut:6,speed:1,gain:.5,muted:false,transform:defaultTransform(),effects:{...defaultEffects(),normalize:true,fadeIn:4,fadeOut:4}}];
  const base=await wait(startExport(p,{format:'wav',quality:'high'},path.join(dir,'out')).id);cutTimelineRange(p,2,3);
  const result=await wait(startExport(p,{format:'wav',quality:'high'},path.join(dir,'out')).id);
  const decode=(file:string)=>run(['-i',file,'-ac','1','-ar','48000','-f','f32le','pipe:1']);
  const raw=decode(base.outputPath!),expected=Buffer.concat([raw.subarray(0,2*48000*4),raw.subarray(3*48000*4)]),actual=decode(result.outputPath!);assert.equal(actual.length,5*48000*4);
  let error=0,energy=0;for(let i=0;i<actual.length;i+=4){const a=actual.readFloatLE(i),b=expected.readFloatLE(i);error+=(a-b)**2;energy+=b*b;}const relativeError=Math.sqrt(error/energy);assert.ok(relativeError<.012,`Cut must preserve original DSP/fade phase rather than restart it: ${relativeError}`);
  const metrics=JSON.parse(await fs.readFile(result.outputPath!+'.metrics.json','utf8'));const misses=metrics.chunks?metrics.chunks.reduce((sum:number,c:any)=>sum+c.audioCacheMisses,0):metrics.audioCacheMisses;assert.equal(misses,0,'Both cut pieces reuse the unchanged complete-source effect cache');
  await fs.writeFile(path.resolve('../evidence/native-transcript-cut-audio.json'),JSON.stringify({samples:actual.length/4,duration:5,relativeError,cacheMisses:misses},null,2));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('word deletion exports exact shorter frame count and preserves source video and fade phase', {timeout:60000},async()=>{
 const {cutTimelineRange}=await import('../shared/timeline-edits.ts');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-word-video-'));
 const run=(args:string[])=>{const r=spawnSync(ffmpegBinary,['-v','error','-nostdin','-y',...args],{maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
 try{const source=path.join(dir,'white.mp4');run(['-f','lavfi','-i','color=c=white:s=160x90:r=30:d=6','-c:v','libx264','-pix_fmt','yuv420p',source]);const m=await probeMedia(source,path.join(dir,'cache')),p=createProject('Word video');p.canvas={...p.canvas,width:160,height:90,fps:30,padding:0,radius:0,background:'#000000'};p.scenes[0].duration=6;p.media=[m];p.clips=[{id:'screen',mediaId:m.id,name:'White',track:'screen',start:0,sourceIn:0,sourceOut:6,speed:1,gain:0,muted:true,transform:defaultTransform(),effects:{...defaultEffects(),fadeIn:4,fadeOut:4}}];
 const full=await wait(startExport(p,{format:'mp4',quality:'high'},path.join(dir,'out')).id);cutTimelineRange(p,2,3);const cut=await wait(startExport(p,{format:'mp4',quality:'high'},path.join(dir,'out')).id);
 const probe=spawnSync(ffprobeBinary,['-v','error','-count_frames','-show_streams','-of','json',cut.outputPath!],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);const streams=JSON.parse(probe.stdout).streams,video=streams.find((s:any)=>s.codec_type==='video');assert.equal(Number(video.nb_read_frames),150);assert.ok(Math.abs(Number(video.duration)-5)<1/30);
 const frame=(file:string,time:number)=>run(['-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1']);const differences=[];for(const [outTime,sourceTime] of [[.5,.5],[1.5,1.5],[2.5,3.5],[4.5,5.5]]){const a=frame(cut.outputPath!,outTime),b=frame(full.outputPath!,sourceTime);assert.equal(a.length,b.length);const mae=a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;differences.push({outTime,sourceTime,mae});assert.ok(mae<=3,`Fade phase at ${outTime}s must match original ${sourceTime}s: ${mae}/255`);}
 await fs.writeFile(path.resolve('../evidence/native-transcript-cut-video.json'),JSON.stringify({frames:150,duration:5,differences},null,2));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('MCP split and range cuts retain original effect origins without changing untouched clips',async()=>{
 const {splitClip,trimProject}=await import('./mcp.ts'),p=createProject('Effect origins');
 const original:Clip={id:'source',mediaId:'media',name:'Source',track:'audio',start:2,sourceIn:10,sourceOut:22,speed:2,gain:.5,muted:false,transform:defaultTransform(),effects:{...defaultEffects(),normalize:true,fadeIn:3}};
 p.clips=[original,{...structuredClone(original),id:'later',start:20}];const before=JSON.stringify(p);
 const split=splitClip(original,4),again=splitClip(split[1],6);
 assert.deepEqual([...split.slice(0,1),...again].map(c=>c.effectTiming),Array.from({length:3},()=>({sourceIn:10,sourceOut:22})));
 assert.equal(original.effectTiming,undefined);
 const cut=trimProject(p,[[3,4],[6,7]]),cutAgain=trimProject(cut,[[3.5,4]]);
 assert.deepEqual(cut.clips.filter(c=>c.id!=='later').map(c=>[c.start,c.sourceIn,c.sourceOut]),[[2,10,12],[3,14,18],[5,20,22]]);
 assert.ok(cutAgain.clips.filter(c=>c.id!=='later').every(c=>c.effectTiming?.sourceIn===10&&c.effectTiming.sourceOut===22));
 assert.equal(cut.clips.find(c=>c.id==='later')!.effectTiming,undefined);
 const leaveGap=trimProject(p,[[3,4]],false);assert.deepEqual(leaveGap.clips.slice(0,2).map(c=>[c.start,c.effectTiming?.sourceIn,c.effectTiming?.sourceOut]),[[2,10,22],[4,10,22]]);
 assert.equal(JSON.stringify(p),before,'MCP planning functions must not mutate their input');
});

test('UI and MCP splits preserve normalized waveform and fade phase at non-unit speed', {timeout:60000},async()=>{
 const {splitAt}=await import('../src/editing.ts'),{splitClip,trimProject}=await import('./mcp.ts');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-split-audio-'));
 const run=(args:string[])=>{const r=spawnSync(ffmpegBinary,['-v','error','-nostdin','-y',...args],{maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
 const report:Array<Record<string,unknown>>=[];
 try{
  const source=path.join(dir,'variable.wav');run(['-f','lavfi','-i','aevalsrc=(0.025+0.012*sin(t))*sin(2*PI*223*t):s=48000:d=8','-c:a','pcm_f32le',source]);
  const m=await probeMedia(source,path.join(dir,'cache')),p=createProject('Split DSP');p.media=[m];p.scenes[0].duration=4;p.clips=[{id:'voice',mediaId:m.id,name:'Voice',track:'audio',start:0,sourceIn:1,sourceOut:7,speed:1.5,gain:.5,muted:false,transform:defaultTransform(),effects:{...defaultEffects(),normalize:true,denoise:true,fadeIn:3,fadeOut:3}}];
  const decode=(file:string)=>run(['-i',file,'-ac','1','-ar','48000','-f','f32le','pipe:1']);
  const full=await wait(startExport(p,{format:'wav',quality:'high'},path.join(dir,'out')).id),reference=decode(full.outputPath!);
  const ui=structuredClone(p);for(const at of [1.2,2.8])splitAt(ui,at,new Set());
  const mcp=structuredClone(p);for(const at of [1.2,2.8]){const i=mcp.clips.findIndex(c=>at>c.start&&at<c.start+(c.sourceOut-c.sourceIn)/c.speed);mcp.clips.splice(i,1,...splitClip(mcp.clips[i],at));}
  const cut=trimProject(p,[[1.2,1.8],[2.8,3.2]],true),samples=(from:number,to:number)=>reference.subarray(Math.round(from*48000)*4,Math.round(to*48000)*4);
  for(const [name,project,expected]of [['ui',ui,reference],['mcp',mcp,reference],['mcp-ripple',cut,Buffer.concat([samples(0,1.2),samples(1.8,2.8),samples(3.2,4)])]]as const){
   const rendered=await wait(startExport(project,{format:'wav',quality:'high'},path.join(dir,'out')).id),actual=decode(rendered.outputPath!);assert.equal(actual.length,expected.length,`${name} sample count`);
   let error=0,energy=0;for(let i=0;i<actual.length;i+=4){const a=actual.readFloatLE(i),b=expected.readFloatLE(i);error+=(a-b)**2;energy+=b*b;}const relativeError=Math.sqrt(error/energy);
   const metrics=JSON.parse(await fs.readFile(rendered.outputPath!+'.metrics.json','utf8')),cacheMisses=metrics.chunks?metrics.chunks.reduce((n:number,c:any)=>n+c.audioCacheMisses,0):metrics.audioCacheMisses;
   report.push({name,samples:actual.length/4,relativeError,cacheMisses});assert.ok(relativeError<.012,`${name} must preserve continuous normalization/denoise/fades: ${relativeError}`);assert.equal(cacheMisses,0,`${name} reuses the original complete-source DSP cache`);
  }
 }finally{await fs.writeFile(path.resolve('../evidence/split-dsp-audio.json'),JSON.stringify(report,null,2));await fs.rm(dir,{recursive:true,force:true});}
});

test('unsplit audio fades follow the requested envelope at sample resolution', {timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-sample-fade-'));
 const run=(args:string[])=>{const r=spawnSync(ffmpegBinary,['-v','error','-nostdin','-y',...args],{maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
 try{
  const source=path.join(dir,'constant.wav');run(['-f','lavfi','-i','aevalsrc=0.1:s=48000:d=4','-c:a','pcm_f32le',source]);const media=await probeMedia(source,path.join(dir,'cache')),p=createProject('Sample fade');p.media=[media];p.scenes[0].duration=4;p.clips=[{id:'audio',mediaId:media.id,name:'Constant reference',track:'audio',start:0,sourceIn:0,sourceOut:4,speed:1,gain:.5,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
  const control=await wait(startExport(p,{format:'wav',quality:'high'},path.join(dir,'out')).id);p.clips[0].effects.fadeIn=3;p.clips[0].effects.fadeOut=3;const faded=await wait(startExport(p,{format:'wav',quality:'high'},path.join(dir,'out')).id);
  const decode=(file:string)=>run(['-i',file,'-ac','1','-ar','48000','-f','f32le','pipe:1']),base=decode(control.outputPath!),actual=decode(faded.outputPath!);assert.equal(actual.length,base.length);
  let maxError=0,error=0,energy=0;for(let i=0;i<actual.length;i+=4){const t=i/4/48000,expected=base.readFloatLE(i)*Math.min(1,t/3)*Math.min(1,(4-t)/3),difference=actual.readFloatLE(i)-expected;maxError=Math.max(maxError,Math.abs(difference));error+=difference*difference;energy+=expected*expected;}
  const relativeError=Math.sqrt(error/energy);assert.ok(relativeError<.002,`Unsplit fades must be smooth, not decoder-frame steps: ${relativeError}`);assert.ok(maxError<4/32768,`Sample envelope maximum absolute error: ${maxError}`);
  await fs.writeFile(path.resolve('../evidence/split-dsp-unsplit-fade.json'),JSON.stringify({samples:actual.length/4,relativeError,maxError},null,2));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('UI and MCP split exports preserve every video fade frame and ripple phase', {timeout:60000},async()=>{
 const {splitAt}=await import('../src/editing.ts'),{splitClip,trimProject}=await import('./mcp.ts');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-split-video-'));
 const run=(args:string[])=>{const r=spawnSync(ffmpegBinary,['-v','error','-nostdin','-y',...args],{maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};const report:Array<Record<string,unknown>>=[];
 try{
  const source=path.join(dir,'white.mp4');run(['-f','lavfi','-i','color=c=white:s=160x90:r=30:d=8','-c:v','libx264','-pix_fmt','yuv420p',source]);const m=await probeMedia(source,path.join(dir,'cache')),p=createProject('Split video');p.canvas={...p.canvas,width:160,height:90,fps:30,padding:0,radius:0,background:'#000000'};p.media=[m];p.scenes[0].duration=4;p.clips=[{id:'screen',mediaId:m.id,name:'White',track:'screen',start:0,sourceIn:1,sourceOut:7,speed:1.5,gain:0,muted:true,transform:defaultTransform(),effects:{...defaultEffects(),fadeIn:3,fadeOut:3}}];
  const decode=(file:string)=>run(['-i',file,'-an','-f','rawvideo','-pix_fmt','gray','pipe:1']),frameSize=160*90;
  const full=await wait(startExport(p,{format:'mp4',quality:'high'},path.join(dir,'out')).id),reference=decode(full.outputPath!);assert.equal(reference.length,120*frameSize);
  const ui=structuredClone(p);for(const at of [1.2,2.8])splitAt(ui,at,new Set());const mcp=structuredClone(p);for(const at of [1.2,2.8]){const i=mcp.clips.findIndex(c=>at>c.start&&at<c.start+(c.sourceOut-c.sourceIn)/c.speed);mcp.clips.splice(i,1,...splitClip(mcp.clips[i],at));}
  const cut=trimProject(p,[[1.2,1.8],[2.8,3.2]],true),expectedCut=Buffer.concat([reference.subarray(0,36*frameSize),reference.subarray(54*frameSize,84*frameSize),reference.subarray(96*frameSize)]);
  for(const [name,project,expected]of [['ui',ui,reference],['mcp',mcp,reference],['mcp-ripple',cut,expectedCut]]as const){
   const rendered=await wait(startExport(project,{format:'mp4',quality:'high'},path.join(dir,'out')).id),actual=decode(rendered.outputPath!);assert.equal(actual.length,expected.length,`${name} exact frame count`);
   const frameErrors=[];for(let offset=0;offset<actual.length;offset+=frameSize){let difference=0;for(let i=0;i<frameSize;i++)difference+=Math.abs(actual[offset+i]-expected[offset+i]);frameErrors.push(difference/frameSize);}
   const maximumFrameMAE=Math.max(...frameErrors);report.push({name,frames:frameErrors.length,maximumFrameMAE});assert.ok(maximumFrameMAE<=3,`${name} fade phase differs by ${maximumFrameMAE}/255`);
  }
 }finally{await fs.writeFile(path.resolve('../evidence/split-dsp-video.json'),JSON.stringify(report,null,2));await fs.rm(dir,{recursive:true,force:true});}
});

test('splitting preserves video fades longer than the original clip duration', {timeout:60000},async()=>{
 const {splitAt}=await import('../src/editing.ts'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-long-fade-'));
 const run=(args:string[])=>{const r=spawnSync(ffmpegBinary,['-v','error','-nostdin','-y',...args],{maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
 try{
  const source=path.join(dir,'white.mp4');run(['-f','lavfi','-i','color=c=white:s=160x90:r=30:d=3','-c:v','libx264','-pix_fmt','yuv420p',source]);const media=await probeMedia(source,path.join(dir,'cache')),p=createProject('Long fade');p.canvas={...p.canvas,width:160,height:90,fps:30,padding:0,radius:0,background:'#000000'};p.media=[media];p.scenes[0].duration=3;p.clips=[{id:'screen',mediaId:media.id,name:'White',track:'screen',start:0,sourceIn:0,sourceOut:3,speed:1,gain:0,muted:true,transform:defaultTransform(),effects:{...defaultEffects(),fadeIn:6,fadeOut:8}}];
  const full=await wait(startExport(p,{format:'mp4',quality:'high'},path.join(dir,'out')).id);splitAt(p,1.5,new Set());const split=await wait(startExport(p,{format:'mp4',quality:'high'},path.join(dir,'out')).id);
  const decode=(file:string)=>run(['-i',file,'-an','-f','rawvideo','-pix_fmt','gray','pipe:1']),base=decode(full.outputPath!),actual=decode(split.outputPath!),frameSize=160*90;assert.equal(actual.length,base.length);let maximumFrameMAE=0;
  for(let offset=0;offset<actual.length;offset+=frameSize){let error=0;for(let i=0;i<frameSize;i++)error+=Math.abs(actual[offset+i]-base[offset+i]);maximumFrameMAE=Math.max(maximumFrameMAE,error/frameSize);}
  await fs.writeFile(path.resolve('../evidence/split-dsp-long-video-fade.json'),JSON.stringify({frames:actual.length/frameSize,maximumFrameMAE},null,2));assert.ok(maximumFrameMAE<=3,`Oversized fade must retain original clamped duration: ${maximumFrameMAE}/255`);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
