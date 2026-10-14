import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { probeMedia, waveform } from './media.ts';
const ffmpeg = process.env.SCENEFORGE_FFMPEG || 'ffmpeg';
async function writeWave(file: string, duration: number, amplitude: (t: number) => number, channels = 2) {
  const rate = 8000, samples = Math.round(duration * rate), data = Buffer.alloc(44 + samples * channels * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22); data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * channels * 2, 28); data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < samples; i++) for (let c = 0; c < channels; c++)
    data.writeInt16LE(Math.round(32767 * amplitude(i / rate) * Math.sin(2 * Math.PI * 500 * i / rate) * (c % 2 ? -1 : 1)), 44 + (i * channels + c) * 2);
  await fs.writeFile(file, data);
}
const largest = (a: number[]) => Math.max(...a);
test('full-source peaks retain quiet microphone levels, silence and opposite-phase stereo without normalization', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sceneforge-waveform-'));
  try {
    const source = path.join(dir, 'long.wav'), cache = path.join(dir, 'cache');
    await writeWave(source, 100, t => t >= 90 ? .6 : t >= 20 && t < 40 ? .006 : 0);
    const media = await probeMedia(source, cache), [peaks, concurrent] = await Promise.all([waveform(media, cache), waveform(media, cache)]);
    assert.equal(peaks.length, 1600); assert.deepEqual(peaks, concurrent); assert.equal(largest(peaks.slice(0, 300)), 0);
    const quiet = largest(peaks.slice(321, 639)), loud = largest(peaks.slice(1450));
    assert.ok(quiet > .0059 && quiet < .0061, `quiet source must stay quiet: ${quiet}`);
    assert.ok(loud > .59 && loud < .61, `last ten seconds and opposite stereo channels must survive: ${loud}`);
    assert.ok(loud / quiet > 98 && loud / quiet < 102); assert.equal(largest(peaks.slice(650, 1430)), 0);
    const evidence = path.resolve('../evidence/qa/waveform'); await fs.mkdir(evidence, {recursive: true});
    await fs.writeFile(path.join(evidence, 'backend-acceptance.json'), JSON.stringify({pass: true, duration: media.duration, bins: peaks.length, quietPeak: quiet, loudPeak: loud, ratio: loud / quiet, tailFirstSecond: 90, channels: 'opposite-phase stereo', analysisRate: 8000, amplitude: 'absolute, not normalized'}, null, 2));
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
test('waveform cache validates contents and duration, replaces damaged cache, and invalidates changed media', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sceneforge-wave-cache-'));
  try {
    const source = path.join(dir, 'voice.wav'), cache = path.join(dir, 'cache'); await writeWave(source, 5, () => .1);
    const media = await probeMedia(source, cache), first = await waveform(media, cache);
    const file = (await fs.readdir(cache)).find(f => f.endsWith('.wave-v2.json'))!;
    await fs.writeFile(path.join(cache, file), JSON.stringify(first.map(() => 12)));
    assert.deepEqual(await waveform(media, cache), first, 'invalid amplitude cache regenerated');
    const longer = await waveform({...media, duration: 10}, cache);
    assert.equal(longer.length, 200); assert.ok(largest(longer.slice(0, 100)) > .09); assert.equal(largest(longer.slice(101)), 0);
    await writeWave(source, 5, () => .2); const future = new Date(Date.now() + 2000); await fs.utimes(source, future, future);
    const updated = await waveform(media, cache); assert.ok(largest(updated) > .19 && largest(updated) < .21);
    assert.equal((await fs.readdir(cache)).filter(f => f.endsWith('.wave-v2.json')).length, 3);
    assert.equal((await fs.readdir(cache)).filter(f => f.endsWith('.tmp')).length, 0);
    await assert.rejects(waveform({...media, duration: NaN}, cache), /duration/);
    await assert.rejects(waveform({...media, duration: 90000}, cache), /duration/);
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
test('video audio waveform preserves delayed audio start on the full video source clock', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sceneforge-wave-video-'));
  try {
    const audio = path.join(dir, 'voice.wav'), source = path.join(dir, 'screen.mov'), cache = path.join(dir, 'cache'); await writeWave(audio, 1.5, () => .25);
    const result = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=10:d=3', '-itsoffset', '0.5', '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'pcm_s16le', source], {timeout: 30000});
    assert.equal(result.status, 0, result.stderr.toString());
    const media = await probeMedia(source, cache); assert.equal(media.kind, 'video'); assert.equal(media.hasAudio, true);
    const peaks = await waveform(media, cache), at = (seconds: number) => Math.floor(seconds / media.duration * peaks.length);
    assert.equal(largest(peaks.slice(0, at(.4))), 0, 'delayed audio is not shifted to source zero');
    assert.ok(largest(peaks.slice(at(.6), at(1.8))) > .24);
    assert.equal(largest(peaks.slice(at(2.2))), 0, 'video tail remains represented');
    assert.deepEqual(await waveform({...media, hasAudio: false}, cache), []);
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
