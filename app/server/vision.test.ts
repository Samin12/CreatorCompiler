import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { detectFace, personMask, getVisionCapabilities, visionPreview } from "./vision.ts";
import { probeMedia, startExport, getJob } from "./media.ts";
import {
  createProject,
  defaultTransform,
  defaultEffects,
} from "../shared/types.ts";
const fixture = path.resolve("../evidence/native-vision-person.png");
async function wait(id: string) {
  for (let i = 0; i < 600; i++) {
    const j = getJob(id)!;
    if (j.status === "complete") return j;
    if (j.status === "failed") throw Error(j.error);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Vision export timeout");
}
function run(args: string[]) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr.toString());
  return r.stdout;
}
test(
  "Vision local person masks and face centering affect actual exported pixels",
  { skip: process.platform !== "darwin", timeout: 90000 },
  async (t) => {
    try {
      await fs.access(fixture);
    } catch {
      t.skip("Local consented portrait fixture absent");
      return;
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creator-compiler-vision-"));
    try {
      assert.ok((await getVisionCapabilities()).personSegmentation);
      const face = await detectFace(fixture);
      assert.ok(face && face.confidence > 0.5);
      assert.ok(face.x > 0 && face.x + face.width < 1);
      const source = path.join(dir, "person.mp4");
      run([
        "-loop",
        "1",
        "-i",
        fixture,
        "-t",
        "1",
        "-r",
        "8",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        source,
      ]);
      const mask = await personMask(source, dir, {
        start: 0,
        end: 1,
        fps: 8,
        width: 320,
        height: 180,
      });
      assert.equal(
        await personMask(source, dir, {
          start: 0,
          end: 1,
          fps: 8,
          width: 320,
          height: 180,
        }),
        mask,
      );
      const raw = run([
        "-i",
        mask,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
      ]);
      assert.equal(raw.length, 320 * 180);
      assert.ok(raw[5 * 320 + 5] < 20);
      const fx = Math.round((face.x + face.width * 0.5) * 320),
        fy = Math.round((face.y + face.height * 0.5) * 180);
      assert.ok(raw[fy * 320 + fx] > 200, `face mask=${raw[fy * 320 + fx]}`);
      const m = await probeMedia(source, dir),
        p = createProject("Vision acceptance");
      const preview = await visionPreview(m, 0.03, dir);
      const previewAgain = await visionPreview(m, 0.06, dir);
      assert.equal(preview.maskPath, previewAgain.maskPath);
      assert.equal(preview.time, 0);
      assert.ok(preview.face && preview.face.confidence > 0.5);
      const previewRaw = run(["-i", preview.maskPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
      assert.equal(previewRaw.length, preview.width * preview.height);
      assert.ok(previewRaw[5 * preview.width + 5] < 20);
      assert.ok(previewRaw[fy * preview.width + fx] > 200);
      p.canvas = {
        width: 320,
        height: 180,
        fps: 8,
        background: "#00ff00",
        padding: 0,
        radius: 0,
      };
      p.scenes[0].duration = 1;
      p.media = [m];
      p.captionStyle.enabled = false;
      p.clips = [
        {
          id: "person",
          mediaId: m.id,
          name: "Person",
          track: "camera",
          start: 0,
          sourceIn: 0,
          sourceOut: 1,
          speed: 1,
          gain: 0,
          muted: true,
          transform: defaultTransform(),
          effects: { ...defaultEffects(), background: "remove" },
        },
      ];
      const removed = await wait(
        startExport(
          p,
          { format: "mp4", quality: "high" },
          path.join(dir, "out"),
        ).id,
      );
      const pixels = run([
        "-i",
        removed.outputPath!,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      const bg = [...pixels.subarray((5 * 320 + 5) * 3, (5 * 320 + 5) * 3 + 3)],
        fg = [...pixels.subarray((fy * 320 + fx) * 3, (fy * 320 + fx) * 3 + 3)];
      assert.ok(
        bg[1] > 180 && bg[0] < 50 && bg[2] < 50,
        `background pixel=${bg}`,
      );
      assert.ok(fg[0] > 40 && fg[1] < 220, `subject pixel=${fg}`);
      p.clips[0].effects.background = "blur";
      const blurred = await wait(
        startExport(
          p,
          { format: "mp4", quality: "high" },
          path.join(dir, "out"),
        ).id,
      );
      const blurPixels = run([
        "-i",
        blurred.outputPath!,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      assert.notDeepEqual(blurPixels, pixels);
      const blurFace = [
        ...blurPixels.subarray((fy * 320 + fx) * 3, (fy * 320 + fx) * 3 + 3),
      ];
      assert.ok(
        blurFace[0] > blurFace[1] + 15,
        `Blur must preserve subject color: ${blurFace}`,
      );
      p.clips[0].effects.background = "none";
      p.clips[0].effects.faceCenter = true;
      p.canvas.width = 180;
      p.canvas.height = 320;
      p.clips[0].transform.fit = "cover";
      const centered = await wait(
        startExport(
          p,
          { format: "mp4", quality: "high" },
          path.join(dir, "out"),
        ).id,
      );
      const faceAfter = await detectFace(centered.outputPath!);
      assert.ok(faceAfter);
      assert.ok(
        Math.abs(faceAfter.x + faceAfter.width / 2 - 0.5) < 0.12,
        JSON.stringify(faceAfter),
      );
      const evidence = path.resolve("../evidence");
      await fs.copyFile(
        removed.outputPath!,
        path.join(evidence, "native-vision-remove.mp4"),
      );
      await fs.copyFile(
        blurred.outputPath!,
        path.join(evidence, "native-vision-blur.mp4"),
      );
      await fs.copyFile(
        centered.outputPath!,
        path.join(evidence, "native-vision-face-center.mp4"),
      );
      run([
        "-i",
        removed.outputPath!,
        "-frames:v",
        "1",
        path.join(evidence, "native-vision-remove.png"),
      ]);
      run([
        "-i",
        blurred.outputPath!,
        "-frames:v",
        "1",
        path.join(evidence, "native-vision-blur.png"),
      ]);
      await fs.writeFile(
        path.join(evidence, "native-vision-acceptance.json"),
        JSON.stringify(
          {
            face,
            faceAfter,
            maskSize: [320, 180],
            maskFps: 8,
            maskForegroundValue: raw[fy * 320 + fx],
            maskBackgroundValue: raw[5 * 320 + 5],
            exportBackgroundRGB: bg,
            exportFaceRGB: fg,
            engine:
              "Apple Vision VNGeneratePersonSegmentationRequest balanced; VNDetectFaceRectanglesRequest",
            limits:
              "Reduced mask resolution/cadence; one-frame face anchoring, not continuous tracking.",
          },
          null,
          2,
        ),
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
