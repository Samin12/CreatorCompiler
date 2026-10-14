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
test('fragmented MP4 chunks finalize to a front-indexed take.mp4 with unchanged frames, then release capture and chunks',async()=>{
 const {captureActivity}=await import('./capture-activity.js'),{readdir}=await import('node:fs/promises'),run=promisify(execFile),input=path.join(folder,'fragmented.mp4');
 await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=15:duration=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-g','15','-c:a','libopus','-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','-y',input]);
 const data=await readFile(input),third=Math.floor(data.length/3);const session=await r.createRecording('Camera take','video/mp4;codecs=avc1.640028');assert.ok(captureActivity.remaining()>0,'an open browser capture defers background work');
 for(const [index,part] of [data.subarray(0,third),data.subarray(third,2*third),data.subarray(2*third)].entries())await r.appendRecording(session.id,index,part);
 const media=await r.finishRecording(session.id);assert.match(media.path,/take\.mp4$/);assert.equal(media.kind,'video');assert.equal(media.hasAudio,true);assert.ok(media.duration>.9&&media.duration<1.2);
 const bytes=await readFile(media.path);assert.ok(bytes.indexOf('moov')>0&&bytes.indexOf('moov')<bytes.indexOf('mdat'),'faststart index precedes media data');
 const frames=async(file:string)=>(await run('ffmpeg',['-v','error','-i',file,'-map','0:v','-fps_mode','passthrough','-f','framemd5','-'])).stdout.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1));
 assert.deepEqual(await frames(media.path),await frames(input));assert.ok(captureActivity.remaining()<=4000,'finishing closes the capture lease');
 for(let i=0;i<100&&(await readdir(path.dirname(media.path))).some(f=>f.endsWith('.chunk'));i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal((await readdir(path.dirname(media.path))).some(f=>f.endsWith('.chunk')),false);assert.equal((await r.finishRecording(session.id)).path,media.path);
 await assert.rejects(r.createRecording('Matroska','video/x-matroska;codecs=avc1'),/WebM or MP4/);
});
test('very long chunk lists join into one intermediate, and startup cleanup removes only completed leftovers',async()=>{
 const {writeFile,readdir}=await import('node:fs/promises');const dir=await mkdtemp(path.join(folder,'join-'));
 for(const [i,text] of ['ab','cd','e'].entries())await writeFile(path.join(dir,String(i).padStart(9,'0')+'.chunk'),text);
 const chunks=(await readdir(dir)).sort();assert.equal(await r.chunkInput(dir,chunks,'webm'),'concat:'+chunks.join('|'));assert.equal(await r.chunkInput(dir,chunks,'webm',10),'capture.webm');assert.equal(await readFile(path.join(dir,'capture.webm'),'utf8'),'abcde');
 const input=path.join(folder,'cleanup.webm');await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.3','-c:a','libopus','-y',input]);const bytes=await readFile(input);
 const done=await r.createRecording('Done','audio/webm'),open=await r.createRecording('Open','audio/webm');await r.appendRecording(done.id,0,bytes);await r.appendRecording(open.id,0,bytes);const media=await r.finishRecording(done.id);
 const stray=path.join(path.dirname(media.path),'000000000.chunk');await writeFile(stray,'left behind');await r.cleanupCompletedRecordings();
 await assert.rejects(readFile(stray));assert.equal((await r.recoverableRecordings()).find(x=>x.id===open.id)?.chunks,1);await r.finishRecording(open.id);
});
