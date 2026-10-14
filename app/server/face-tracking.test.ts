import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {faceCrop,isFaceBounds,trackedCrop,smoothFaceSamples,type FaceTrack} from '../shared/face-tracking.ts';
import {faceCropCommands} from './face-crop.ts';
import {getFaceTrack,validateFaceTrackSamples} from './face-tracking.ts';
const ffmpeg=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
const face=(x:number)=>({x,y:.25,width:.12,height:.3,confidence:.9});
const track:FaceTrack={version:1,sampleRate:4,start:0,end:2,subject:'largest-face',points:[{time:0,face:face(.14)},{time:1,face:face(.44)},{time:2,face:face(.74)}]};
function run(args:string[]){const result=spawnSync(ffmpeg,['-v','error','-nostdin',...args],{timeout:30000,maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr?.toString());return result.stdout;}
test('tracking interpolation clamps crop, follows source time and handles loss without out-of-frame positions',()=>{
 const start=trackedCrop(track.points,0,320,180,90,180),middle=trackedCrop(track.points,.5,320,180,90,180),end=trackedCrop(track.points,1,320,180,90,180);
 assert.equal(middle.x,(start.x+end.x)/2);assert.ok(start.x<end.x);
 for(const x of [-.2,0,.5,.95,2]){const p=faceCrop(face(x),320,180,90,180);assert.ok(p.x>=0&&p.x<=p.maxX);assert.ok(p.y>=0&&p.y<=p.maxY);}
 const missing=trackedCrop([{time:0,face:null}],0,320,180,90,180);assert.equal(missing.x,115);
 const source=1.25,speed=.5,sourceIn=.5,elapsed=(source-sourceIn)/speed;
 assert.deepEqual(trackedCrop(track.points,sourceIn+elapsed*speed,320,180,90,180),trackedCrop(track.points,source,320,180,90,180));
});
test('finite-support smoothing gives identical interior samples across independently computed windows',()=>{
 const points=Array.from({length:60},(_,i)=>({time:i/4,face:face(.3+Math.sin(i)*.03)}));
 const all=smoothFaceSamples(points),window=smoothFaceSamples(points.slice(15,45));
 assert.deepEqual(window.slice(1,-1),all.slice(16,44));
 const loss=smoothFaceSamples([{time:0,face:face(.2)},{time:.25,face:null},{time:.5,face:face(.8)}]);assert.equal(loss[1].face,null);
});
test('partial face observations retain their center while crops stay inside all source edges',()=>{
 const left={x:-.04,y:.31,width:.15,height:.27,confidence:.77},right={...left,x:.93},top={...left,x:.3,y:-.1},bottom={...left,x:.3,y:.9};
 const samples=[left,right,top,bottom].map((face,time)=>({time,face}));assert.deepEqual(validateFaceTrackSamples(samples),samples);
 for(const f of [left,right,top,bottom])assert.equal(isFaceBounds(f),true);
 assert.equal(faceCrop(left,320,180,90,180).x,0);assert.equal(faceCrop(right,320,180,90,180).x,230);
 assert.equal(faceCrop(left,320,180,90,180,true).x,230);
 assert.equal(faceCrop(top,320,180,320,90).y,0);assert.equal(faceCrop(bottom,320,180,320,90).y,90);
 // Retain an actual partially visible face center, rather than the center of its intersection.
 const narrow=faceCrop(left,320,180,10,180);assert.ok(Math.abs(narrow.x-((left.x+left.width/2)*320-5))<1e-9);
 const smoothed=smoothFaceSamples([{time:0,face:left},{time:.25,face:{...left,x:-.03}},{time:.5,face:{...left,x:.01}}]);
 assert.ok(smoothed.every(p=>isFaceBounds(p.face)));assert.ok(smoothed[1].face!.x<0);
});
test('partial-box support still rejects invalid geometry, confidence, timestamps, and no visible area',()=>{
 for(const patch of [{x:NaN},{x:Infinity},{x:-1.1,width:1.2},{x:1},{x:-.2,width:.2},{width:0},{height:-.1},{width:2.01},{y:1},{y:-.2,height:.2},{height:2.01},{confidence:.49},{confidence:1.01}]){
  const f={...face(.3),...patch};assert.equal(isFaceBounds(f),false,JSON.stringify(patch));assert.throws(()=>validateFaceTrackSamples([{time:0,face:f}]),/Invalid face tracking sample/);
 }
 for(const points of [[{time:NaN,face:null}],[{time:0,face:face(.3)},{time:0,face:face(.4)}],[{time:1,face:null},{time:.5,face:null}]])assert.throws(()=>validateFaceTrackSamples(points),/Invalid face tracking sample/);
});
test('actual FFmpeg commands hold partial offscreen faces at valid source edges',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-track-edges-'));
 try{const edgeTrack:FaceTrack={...track,points:validateFaceTrackSamples([{time:0,face:face(-.04)},{time:1,face:face(.94)},{time:2,face:face(.94)}])};
  const compiled=faceCropCommands(edgeTrack,{sourceIn:0,sourceOut:2,speed:1,sourceWidth:320,sourceHeight:180,width:90,height:180,target:'edges'}),file=path.join(dir,'edge-commands.txt');await fs.writeFile(file,compiled.commands);
  const data=run(['-f','lavfi','-i',"nullsrc=size=320x180:rate=10,format=rgb24,geq=r='X/2':g='Y':b=0",'-t','2','-vf',`sendcmd=filename='${file}',crop@edges=90:180:x=${compiled.initial.x}:y=${compiled.initial.y}`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  const bytes=90*180*3;assert.equal(data.length,20*bytes);for(let n=0;n<20;n++){const expected=trackedCrop(edgeTrack.points,n/10,320,180,90,180);assert.ok(Math.abs(data[n*bytes]-expected.x/2)<2);}assert.equal(data[0],0);assert.equal(data[19*bytes],115);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('actual FFmpeg crop commands interpolate and preserve source position across speed and trimmed windows',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-track-commands-'));
 try{
  for(const [sourceIn,sourceOut,speed] of [[0,2,1],[.5,1.5,.5]]){
   const compiled=faceCropCommands(track,{sourceIn,sourceOut,speed,sourceWidth:320,sourceHeight:180,width:90,height:180,target:'tracking'});
   const file=path.join(dir,'commands.txt');await fs.writeFile(file,compiled.commands);
   const data=run(['-f','lavfi','-i',"nullsrc=size=320x180:rate=10,format=rgb24,geq=r='X/2':g='Y':b=0",'-t',String((sourceOut-sourceIn)/speed),'-vf',`sendcmd=filename='${file}',crop@tracking=90:180:x=${compiled.initial.x}:y=${compiled.initial.y}`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
   const bytes=90*180*3;assert.equal(data.length/bytes,20);
   for(let n=0;n<20;n++){const expected=trackedCrop(track.points,sourceIn+n/10*speed,320,180,90,180);assert.ok(Math.abs(data[n*bytes]-expected.x/2)<2,`frame ${n}: ${data[n*bytes]} vs ${expected.x/2}`);}
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('native batch has ordered actual timestamps, cache reuse, and independent cancellation of shared consumers',{skip:process.platform!=='darwin',timeout:90000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-native-track-'));
 try{
  const file=path.join(dir,'blank.mp4');run(['-y','-f','lavfi','-i','color=blue:size=320x180:rate=30:duration=2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',file]);
  const media={id:'blank',name:'generated',kind:'video' as const,path:file,width:320,height:180,duration:2},controller=new AbortController();
  const cancelled=getFaceTrack(media,{start:0,end:1,cacheDir:dir,signal:controller.signal}),retained=getFaceTrack(media,{start:.5,end:1.5,cacheDir:dir});
  await new Promise(resolve=>setTimeout(resolve,50));controller.abort();await assert.rejects(cancelled,{name:'AbortError'});
  const result=await retained;assert.ok(result.points.length>=7);assert.ok(result.points.every((p,i)=>p.face===null&&(!i||p.time>result.points[i-1].time)));
  assert.ok(result.points.every(p=>Math.abs(p.time*30-Math.round(p.time*30))<.01));
  const again=await getFaceTrack(media,{start:.5,end:1.5,cacheDir:dir});assert.deepEqual(again,result);
  const files=await fs.readdir(path.join(dir,'face-tracks-v1'));assert.equal(files.filter(f=>f.endsWith('.json')).length,1);assert.ok(files.every(f=>!f.endsWith('.tmp')));
  await fs.utimes(file,new Date(),new Date(Date.now()+2000));await getFaceTrack(media,{start:0,end:1,cacheDir:dir});
  assert.equal((await fs.readdir(path.join(dir,'face-tracks-v1'))).filter(f=>f.endsWith('.json')).length,2,'changed source identity must invalidate a cached track');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('low-frame-rate and variable-frame-rate native samples retain unique actual timestamps',{skip:process.platform!=='darwin',timeout:45000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-track-cadence-'));
 try{
  for(const kind of ['low','variable']){
   const file=path.join(dir,kind+'.mp4');
   run(['-y','-f','lavfi','-i',`color=green:size=320x180:rate=${kind==='low'?2:30}:duration=2`,...(kind==='variable'?['-vf',"select='eq(mod(n,7),0)+eq(mod(n,11),0)'",'-fps_mode','vfr']:[]),'-c:v','libx264','-threads','1',file]);
   const result=await getFaceTrack({id:kind,name:kind,kind:'video',path:file,width:320,height:180,duration:2},{start:0,end:2,cacheDir:dir});
   assert.ok(result.points.length>=3);assert.equal(new Set(result.points.map(p=>p.time)).size,result.points.length);
   if(kind==='low')assert.equal(result.points.length,4);
   else assert.ok(result.points.some(p=>Math.abs(p.time*4-Math.round(p.time*4))>.05),'actual PTS must not be relabeled as a fixed4Hz grid');
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('native decode failure and cancelled requests remain errors rather than empty successful tracking',{skip:process.platform!=='darwin',timeout:15000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-track-errors-'));
 try{const file=path.join(dir,'invalid.mp4');await fs.writeFile(file,'not a video');const media={id:'bad',name:'bad',kind:'video' as const,path:file,width:320,height:180,duration:2};
  await assert.rejects(getFaceTrack(media,{start:0,end:1,cacheDir:dir}),/No video track|Reader|Vision/);
  const controller=new AbortController();controller.abort();await assert.rejects(getFaceTrack(media,{start:0,end:1,cacheDir:dir,signal:controller.signal}),{name:'AbortError'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
