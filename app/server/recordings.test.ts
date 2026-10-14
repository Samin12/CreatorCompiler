import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const folder=await mkdtemp(path.join(os.tmpdir(),'sceneforge-recording-'));process.env.SCENEFORGE_DATA_DIR=folder;
const s=await import('./storage.js'),r=await import('./recordings.js');await s.initStorage();
after(()=>rm(folder,{recursive:true,force:true}));
test('streaming recording chunks are retry-safe, recoverable and finalize with duration and unchanged decoded frames',async()=>{
 const input=path.join(folder,'fixture.webm');await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=15:duration=1','-c:v','libvpx','-live','1','-y',input]);const data=await readFile(input),middle=Math.floor(data.length/2);const session=await r.createRecording('Recovered take','video/webm');
 const before=JSON.parse((await promisify(execFile)('ffprobe',['-v','error','-show_format','-of','json',input])).stdout);assert.equal(before.format.duration,undefined);
 await assert.rejects(()=>r.appendRecording(session.id,1,data.subarray(middle)));
 await r.appendRecording(session.id,0,data.subarray(0,middle));await r.appendRecording(session.id,0,data.subarray(0,middle));
 await assert.rejects(()=>r.appendRecording(session.id,0,Buffer.from('different')));
 await r.appendRecording(session.id,1,data.subarray(middle));assert.equal((await r.recoverableRecordings())[0].chunks,2);
 const media=await r.finishRecording(session.id);assert.ok(media.duration>.9&&media.duration<1.1);assert.equal(media.kind,'video');
 const hash=async(file:string)=>(await promisify(execFile)('ffmpeg',['-v','error','-i',file,'-f','md5','-'])).stdout;
 assert.equal(await hash(media.path),await hash(input));assert.equal((await r.finishRecording(session.id)).id,media.id);assert.equal((await r.recoverableRecordings()).length,0);
});


test('audio provenance survives unfinished recovery, finalization, catalog reread and reimport',async()=>{
 const input=path.join(folder,'tone.webm');await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.5','-c:a','libopus','-y',input]);const bytes=await readFile(input);
 for(const role of ['microphone','system'] as const){
  const created=await r.createRecording('Arbitrary name','audio/webm',role);await r.appendRecording(created.id,0,bytes);
  assert.equal((await r.recoverableRecordings()).find(entry=>entry.id===created.id)?.audioRole,role);
  const media=await r.finishRecording(created.id);assert.equal(media.audioRole,role);assert.equal((await s.readMedia(media.id)).audioRole,role);assert.equal((await r.finishRecording(created.id)).audioRole,role);
  const {audioRole:_,...reprobed}=media;assert.equal((await s.registerMedia(reprobed)).audioRole,role);
 }
 await assert.rejects(r.createRecording('bad','audio/webm','filename-inference' as any),/audio role/);
});
