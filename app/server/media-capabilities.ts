import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export type MediaCapabilities = { ffmpeg: boolean; ffprobe: boolean; hardwareEncode: boolean };

/** One bounded probe per service, shared by concurrent callers. An encoder name
 * only describes how FFmpeg was built; virtual Macs may not expose its hardware. */
export function mediaCapabilityProbe(ffmpeg: string, ffprobe: string, timeoutMs = 5000) {
  let cached: Promise<MediaCapabilities> | undefined;
  const run = (binary: string, args: string[]) => execute(binary, args, {
    encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  return () => cached ??= (async () => {
    const [encoderList, probe] = await Promise.allSettled([
      run(ffmpeg, ['-hide_banner', '-encoders']), run(ffprobe, ['-version']),
    ]);
    let hardwareEncode = false;
    if (encoderList.status === 'fulfilled' && /\bh264_videotoolbox\b/.test(encoderList.value.stdout)) {
      try {
        // Do not let VideoToolbox's software implementation masquerade as HW.
        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin',
          '-f', 'lavfi', '-i', 'color=black:size=160x90:rate=30', '-frames:v', '1',
          '-an', '-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-pix_fmt', 'yuv420p',
          '-f', 'null', '-']);
        hardwareEncode = true;
      } catch { /* The existing export path falls back to libx264. */ }
    }
    return { ffmpeg: encoderList.status === 'fulfilled', ffprobe: probe.status === 'fulfilled', hardwareEncode };
  })();
}
