import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTranscription,parseSilences,analyze} from './ai.js';
import {createProject,defaultEffects,defaultTransform,type Clip} from '../shared/types.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('Whisper token times become words without attaching sentence punctuation to a new caption',()=>{
 const result=parseTranscription({transcription:[{tokens:[{text:'[_BEG_]',offsets:{from:0,to:0}},{text:' Hello',offsets:{from:10,to:200}},{text:' world',offsets:{from:210,to:500}},{text:'.',offsets:{from:600,to:700}}]}]});
 assert.equal(result[0].text,'Hello world.');assert.equal(result[0].words?.[1].end,.5);assert.equal(result[0].start,.01);
});
test('Speech API words retain precise source boundaries',()=>{const result=parseTranscription({words:[{word:'um',start:1.2,end:1.4},{word:'hello',start:1.8,end:2}]});assert.deepEqual(result[0].words?.[0],{text:'um',start:1.2,end:1.4});assert.throws(()=>parseTranscription({text:'No timestamps'}),/no timed transcript/)});
test('Silence parser includes a trailing quiet section and clamps to media duration',()=>assert.deepEqual(parseSilences('silence_start: -0.01\nsilence_end: 0.9\nsilence_start: 4.1',5),[[0,.9],[4.1,5]]));
test('Filler analysis proposes exact word ranges and never edits captions',async()=>{const p=createProject();p.captions=[{id:'c',start:0,end:2,text:'um I like this',words:[{text:'um',start:.2,end:.4},{text:'like',start:1,end:1.2}]}];const original=structuredClone(p);const result=await analyze(p,'fillers',{provider:'local',baseUrl:'',model:'',language:'en'});assert.equal(result.suggestions.length,1);assert.equal(result.suggestions[0].start,.2);assert.deepEqual(p,original)});
test('silence analysis maps audible video through cuts and speed, prioritizes narration, and ignores disabled audio',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sceneforge-silence-')),file=path.join(dir,'synthetic.mp4');
 try{
  await promisify(execFile)(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-v','error','-nostdin','-y','-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=6','-f','lavfi','-i','aevalsrc=if(between(t\\,2\\,3)\\,0\\,0.12*sin(2*PI*440*t)):s=48000:d=6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);
  const p=createProject(),settings={provider:'local' as const,baseUrl:'',model:'',language:'en'};
  p.media=[{id:'video',path:file,name:'Audible video',kind:'video',hasAudio:true,duration:6,width:64,height:64},{id:'disabled',path:path.join(dir,'must-not-read.mp4'),name:'No audio',kind:'video',hasAudio:false,duration:6,width:64,height:64}];
  const clip=(id:string,changes:Partial<Clip>={}):Clip=>({id,mediaId:'video',name:id,track:'screen',start:4,sourceIn:1,sourceOut:5,speed:2,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects(),...changes});
  p.clips=[clip('screen'),clip('muted',{muted:true}),clip('zero',{gain:0}),clip('no-audio',{mediaId:'disabled'})];
  const before=structuredClone(p),video=await analyze(p,'silence',settings);
  assert.equal(video.suggestions.length,1);assert.ok(Math.abs(video.suggestions[0].start!-4.5)<.04);assert.ok(Math.abs(video.suggestions[0].end!-5)<.04);assert.deepEqual(p,before);
  p.clips=[clip('first',{start:0,sourceIn:0,sourceOut:2.4,speed:1}),clip('repeat',{start:3,sourceIn:2.6,sourceOut:6,speed:.5})];
  const cuts=await analyze(p,'silence',settings);assert.equal(cuts.suggestions.length,2);
  assert.ok(Math.abs(cuts.suggestions[0].start!-2)<.04);assert.ok(Math.abs(cuts.suggestions[0].end!-2.4)<.04);
  assert.ok(Math.abs(cuts.suggestions[1].start!-3)<.04);assert.ok(Math.abs(cuts.suggestions[1].end!-3.8)<.05);
  const narration=clip('narration',{track:'audio',start:4.4,sourceIn:0,sourceOut:1,speed:1});
  p.clips=[clip('screen'),narration];assert.equal((await analyze(p,'silence',settings)).suggestions.length,0,'audible primary narration prevents a screen-silence cut');
  p.clips=[clip('screen'),{...narration,muted:true}];assert.equal((await analyze(p,'silence',settings)).suggestions.length,1,'muted narration does not mask video audio');
  p.clips=[clip('screen'),{...narration,track:'screen'}];assert.equal((await analyze(p,'silence',settings)).suggestions.length,0,'all simultaneous equal-priority sources must be quiet');
  p.clips=[clip('camera',{track:'camera'}),{...narration,track:'screen'}];assert.equal((await analyze(p,'silence',settings)).suggestions.length,1,'camera narration takes priority over system/screen audio');
  p.clips=[clip('overlay',{track:'overlay'})];assert.equal((await analyze(p,'silence',settings)).suggestions.length,1);
  p.clips=[clip('quiet-mic',{track:'audio',audioRole:'microphone',start:4,sourceIn:2,sourceOut:3,speed:1}),clip('desktop-talkover',{track:'audio',audioRole:'system',start:4,sourceIn:0,sourceOut:1,speed:1})];
  const micQuiet=await analyze(p,'silence',settings);assert.equal(micQuiet.suggestions.length,1,'quiet microphone retains priority while desktop speech plays');assert.ok(Math.abs(micQuiet.suggestions[0].start!-4)<.04);assert.ok(Math.abs(micQuiet.suggestions[0].end!-5)<.04);
  p.clips=[clip('music',{track:'music'})];await assert.rejects(analyze(p,'silence',settings),/audible narration/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('local transcription cancellation terminates the actual worker and removes its temporary audio',async()=>{
 const {writeFile,readFile,readdir}=await import('node:fs/promises');const {transcribe}=await import('./ai.js');
 const dir=await mkdtemp(path.join(tmpdir(),'sceneforge-transcribe-cancel-')),file=path.join(dir,'tone.wav'),worker=path.join(dir,'whisper'),model=path.join(dir,'model.bin'),pidfile=path.join(dir,'worker.pid');
 try{
  await promisify(execFile)(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1',file]);await writeFile(model,'fixture');
  await writeFile(worker,`#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));setInterval(()=>{},1000);`,{mode:0o700});
  const abort=new AbortController(),promise=transcribe({id:'tone',name:'tone',path:file,kind:'audio',duration:1,width:0,height:0},{provider:'local',baseUrl:'',model,localCommand:worker,language:'en'},dir,{signal:abort.signal});
  for(let i=0;i<100;i++){if(await readFile(pidfile,'utf8').catch(()=>''))break;await new Promise(r=>setTimeout(r,20));}
  const pid=Number(await readFile(pidfile,'utf8'));abort.abort();await assert.rejects(promise,/cancelled/);assert.throws(()=>process.kill(pid,0));assert.ok(!(await readdir(dir)).some(n=>n.startsWith('transcribe-')));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('delayed punctuation does not stretch a spoken word across a quiet gap',()=>{
 const parsed=parseTranscription({transcription:[{tokens:[{text:' statement',offsets:{from:2880,to:3190}},{text:'.',offsets:{from:5450,to:5540}},{text:' This',offsets:{from:5560,to:5800}},{text:',',offsets:{from:5800,to:5800}}]}]});
 assert.equal(parsed[0].words![0].end,3.19);assert.equal(parsed[0].text,'statement.');assert.equal(parsed[1].words![0].text,'This,');assert.equal(parsed[1].words![0].end,5.8);
});
