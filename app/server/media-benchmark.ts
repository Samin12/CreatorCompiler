import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createProject,
  defaultEffects,
  defaultTransform,
} from "../shared/types.ts";
import { probeMedia, startExport, getJob } from "./media.ts";
const dir = path.resolve("../evidence/native-benchmark");
await fs.mkdir(dir, { recursive: true });
const source = path.join(dir, "fixture.mp4");
const r = spawnSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ],
  { encoding: "utf8" },
);
if (r.status) throw Error(r.stderr);
const m = await probeMedia(source, path.join(dir, "cache")),
  p = createProject("720p-30sec-16layers-benchmark");
p.canvas = {
  width: 1280,
  height: 720,
  fps: 30,
  background: "#171b27",
  padding: 24,
  radius: 12,
};
p.media = [m];
p.scenes[0].duration = 30;
for (let i = 0; i < 15; i++)
  p.clips.push({
    id: `screen-${i}`,
    mediaId: m.id,
    name: `Screen ${i}`,
    track: "screen",
    start: i * 2,
    sourceIn: 0,
    sourceOut: 2,
    speed: 1,
    gain: 0.6,
    muted: false,
    transform: defaultTransform(),
    effects: defaultEffects(),
  });
p.clips.push({
  id: "camera",
  mediaId: m.id,
  name: "PiP overlay",
  track: "camera",
  start: 0,
  sourceIn: 0,
  sourceOut: 2,
  speed: 1,
  gain: 0,
  muted: true,
  transform: {
    ...defaultTransform(),
    x: 0.7,
    y: 0.62,
    width: 0.26,
    height: 0.3,
    borderRadius: 24,
  },
  effects: defaultEffects(),
});
p.captions = Array.from({ length: 15 }, (_, i) => ({
  id: `caption-${i}`,
  start: i * 2,
  end: (i + 1) * 2,
  text: `Synthetic benchmark chapter ${i + 1}`,
}));
p.captionStyle.fontSize = 32;
p.cursor = {
  enabled: true,
  size: 24,
  color: "#ffffff",
  highlight: true,
  smoothing: 0.5,
  points: Array.from({ length: 61 }, (_, i) => ({
    time: i * 0.5,
    x: 0.15 + (i % 12) * 0.05,
    y: 0.35,
  })),
};
const job = startExport(
  p,
  { format: "mp4", quality: "balanced" },
  path.join(dir, "outputs"),
);
let previous = "";
for (;;) {
  const j = getJob(job.id)!;
  const status = `${j.status} ${Math.round(j.progress * 100)}% ${j.message}`;
  if (status !== previous) {
    console.log(status);
    previous = status;
  }
  if (j.status === "complete") {
    const metadata = JSON.parse(
      await fs.readFile(j.outputPath! + ".metrics.json", "utf8"),
    );
    await fs.writeFile(
      path.join(dir, "benchmark-result.json"),
      JSON.stringify(
        {
          scenario:
            "30s 1280x720 30fps, 15 sequential repeated source clips, one PiP, 15 captions, rounded padded screen, cursor path",
          output: j.outputPath,
          ...metadata,
          comparison:
            "No controlled Borumi workload was run; this result does not establish relative speed or quality.",
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(metadata, null, 2));
    break;
  }
  if (j.status === "failed" || j.status === "cancelled")
    throw Error(j.error || j.message);
  await new Promise((r) => setTimeout(r, 250));
}
