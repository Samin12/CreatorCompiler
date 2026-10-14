import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createProject,defaultEffects,defaultTransform} from '../shared/types.ts';
import {startExport,getJob,getCapabilities,probeMedia} from './media.ts';

test('fractional timeline endpoints keep the final encoded frame in direct and chunked exports', {timeout:90000}, async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-final-frame-'));
 try{
  const cap=await getCapabilities();
  for(const [duration,hardware]of [[2.001,false],[2.017,false],[2.0363,false],[20.001,false],...(cap.hardwareEncode?[[2.0363,true],[20.001,true]]:[])]as[number,boolean][]){
   const p=createProject('Fractional last frame');p.canvas={width:160,height:90,fps:30,background:'#e83c21',padding:0,radius:0};p.scenes[0].duration=duration;
   const job=startExport(p,{format:'mp4',quality:'draft',hardware,burnCaptions:false},dir);
   const deadline=Date.now()+20000;while(!['complete','failed','cancelled'].includes(getJob(job.id)!.status)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
   const done=getJob(job.id)!;assert.equal(done.status,'complete',done.error||done.message);
   const probe=spawnSync(process.env.SCENEFORGE_FFPROBE||'ffprobe',['-v','error','-count_packets','-show_streams','-of','json',done.outputPath!],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);
   const streams=JSON.parse(probe.stdout).streams,video=streams.find((s:any)=>s.codec_type==='video'),audio=streams.find((s:any)=>s.codec_type==='audio');
   const frames=Math.ceil(duration*30-1e-7);assert.equal(Number(video.nb_read_packets),frames,`${duration}s hardware=${hardware}`);assert.ok(Math.abs(Number(video.duration)-duration)<1/30+1e-6);assert.ok(Math.abs(Number(audio.duration)-duration)<1/30+1e-6);
   const decoded=spawnSync(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-v','error','-i',done.outputPath!,'-vf',`select=eq(n\\,${frames-1}),scale=1:1`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);assert.equal(decoded.status,0,decoded.stderr.toString());assert.equal(decoded.stdout.length,3);assert.ok(decoded.stdout[0]>200&&decoded.stdout[1]<90&&decoded.stdout[2]<80,'The final frame contains the canvas, not a blank or omitted sample.');
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('still and moving layers remain visible through a partial final frame without leaking past their end', {timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-layer-final-frame-'));
 const run=(args:string[])=>{const r=spawnSync(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-v','error','-y',...args]);assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
 try{
  const files=[path.join(dir,'blue.png'),path.join(dir,'green.png'),path.join(dir,'yellow.png'),path.join(dir,'red.mp4')];
  for(const [index,color]of ['blue','lime','yellow'].entries())run(['-f','lavfi','-i',`color=c=${color}:s=160x90`,'-frames:v','1',files[index]]);
  run(['-f','lavfi','-i','color=c=red:s=160x90:r=24:d=3','-c:v','libx264','-preset','ultrafast',files[3]]);
  const p=createProject('Layer terminal pixels'),duration=2.0363;p.canvas={width:320,height:180,fps:30,background:'#151515',padding:0,radius:0};p.scenes[0].duration=duration;p.media=await Promise.all(files.map(file=>probeMedia(file,path.join(dir,'cache'))));
  p.clips=p.media.map((m,i)=>({id:`layer-${i}`,mediaId:m.id,name:m.name,track:i===3?'screen' as const:'overlay' as const,zIndex:i===0?-1:i===3?0:i,start:0,sourceIn:0,sourceOut:i===2?1:duration,speed:1,gain:1,muted:true,transform:{...defaultTransform(),...(i===3?{width:.5}:i===1?{x:.75,width:.25,height:.4}:i===2?{x:.75,y:.5,width:.25,height:.4}:{})},effects:defaultEffects()}));
  const job=startExport(p,{format:'mp4',quality:'high',burnCaptions:false},dir);while(!['complete','failed','cancelled'].includes(getJob(job.id)!.status))await new Promise(r=>setTimeout(r,25));const done=getJob(job.id)!;assert.equal(done.status,'complete',done.error);
  const rgb=run(['-i',done.outputPath!,'-vf','select=eq(n\\,61)','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);assert.equal(rgb.length,320*180*3);
  const at=(x:number,y:number)=>[...rgb.subarray((y*320+x)*3,(y*320+x)*3+3)];
  const red=at(80,90),green=at(280,30),blue=at(280,130);assert.ok(red[0]>220&&red[1]<30,`Moving source remains: ${red}`);assert.ok(green[1]>220&&green[0]<30,`Still badge remains: ${green}`);assert.ok(blue[2]>220&&blue[0]<30&&blue[1]<30,`Background remains; finished yellow overlay stays removed: ${blue}`);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
