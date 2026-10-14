import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createProject,defaultEffects,defaultTransform,type Project,type ExportOptions} from '../shared/types';
import {canvasBackgroundGeometry} from '../shared/canvas-background';
import {startExport,getJob,inspectFrames,probeMedia} from './media';

const ffmpeg=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
function command(args:string[]){const r=spawnSync(ffmpeg,['-hide_banner','-v','error','-nostdin','-y',...args],{maxBuffer:100*1024*1024,timeout:60000});assert.equal(r.status,0,r.stderr.toString()||String(r.error));return r.stdout;}
async function render(p:Project,out:string,options:Partial<ExportOptions>={}){const j=startExport(p,{format:'mp4',quality:'high',burnCaptions:false,...options},out),deadline=Date.now()+90000;while(['queued','running'].includes(j.status)){if(Date.now()>deadline)throw Error('Background test render timed out');await new Promise(r=>setTimeout(r,15));}assert.equal(getJob(j.id)?.status,'complete',j.error);return j.outputPath!;}
const frame=(file:string,time=0)=>command(['-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
const difference=(a:Buffer,b:Buffer)=>{assert.equal(a.length,b.length);let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
function fixture(){const p=createProject('Moving background');p.canvas={...p.canvas,width:960,height:540,fps:30,padding:0,radius:0,background:'#121212',backgroundPattern:'moving-dots'};p.scenes[0].duration=17;return p;}

test('real MP4 keeps smooth pattern phase across chunk, range, loop and inspection boundaries',{timeout:120000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-grid-'));
 try{
  const p=fixture(),before=JSON.stringify(p),full=await render(p,path.join(dir,'full')),metrics=JSON.parse(await fs.readFile(full+'.metrics.json','utf8'));
  assert.equal(metrics.chunkCount,2);assert.equal(metrics.videoFrames,510);assert.equal(JSON.stringify(p),before,'render context never leaks into project JSON');
  const initial=frame(full,0),at10=frame(full,10),at16=frame(full,16);assert.ok(difference(initial,at16)<.75,`16-second loop returns to the same phase (H264 I/P-frame quantization): ${difference(initial,at16)}`);
  const exact=await render(p,path.join(dir,'range'),{range:{start:10,end:10+2/30}}),reference=frame(exact);
  assert.ok(difference(reference,at10)<.75,`chunk must not reset: ${difference(reference,at10)}`);assert.ok(difference(reference,at10)<difference(initial,at10)*.6,'matching absolute time is closer than a reset phase');assert.ok(difference(initial,at10)>.5,'pattern visibly advanced from t=0');
  const ranges=await render(p,path.join(dir,'nested-range'),{range:{start:3,end:16}}),nested=frame(ranges,7);assert.ok(difference(reference,nested)<.75,'range origin plus second chunk remains absolute project time');
  const inspected=await inspectFrames(p,[10,16],path.join(dir,'inspect'),{width:960});assert.ok(difference(frame(inspected[0].path),reference)<.15);assert.ok(difference(frame(inspected[1].path),initial)<.75);
  const second=command(['-i',full,'-frames:v','30','-f','rawvideo','-pix_fmt','gray','pipe:1']),size=960*540;
  let changed=0;for(let n=1;n<30;n++)if(!second.subarray((n-1)*size,n*size).equals(second.subarray(n*size,(n+1)*size)))changed++;
  assert.ok(changed>=25,`subpixel travel should change almost every frame, got ${changed}/29`);
  const evidence=path.resolve('../evidence/qa/moving-background');await fs.mkdir(evidence,{recursive:true});await fs.copyFile(full,path.join(evidence,'moving-grid-960.mp4'));await fs.writeFile(path.join(evidence,'render-acceptance.json'),JSON.stringify({pass:true,frames:metrics.videoFrames,chunks:metrics.chunkCount,chunkRangeMae:difference(reference,at10),loopMae:difference(initial,at16),nestedRangeMae:difference(reference,nested),changedAdjacentFrames:changed,metrics},null,2));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('background stays behind clip layers, scales to custom output sizes, and disabling it restores solid pixels',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-grid-layer-'));
 try{
  const p=fixture();p.scenes[0].duration=.2;const source=path.join(dir,'white.mp4');command(['-f','lavfi','-i','color=c=white:s=160x90:r=30:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',source]);const media=await probeMedia(source,path.join(dir,'cache'));p.media=[media];p.clips=[{id:'panel',mediaId:media.id,name:'Panel',track:'screen',zIndex:-1000,start:0,sourceIn:0,sourceOut:.2,speed:1,gain:0,muted:true,transform:{...defaultTransform(),x:.25,y:.25,width:.5,height:.5},effects:defaultEffects()}];
  const width=640,height=360,actual=frame(await render(p,path.join(dir,'dots'),{width,height})),at=(bytes:Buffer,x:number,y:number)=>bytes[(y*width+x)*3];
  assert.ok(at(actual,320,180)>240,'even a negative-z background clip stays above the generated canvas');
  const g=canvasBackgroundGeometry(p.canvas,0,width,height);assert.ok(Math.abs(g.pitchX-40/3)<1e-9);
  // Far edge position must use the fractional pitch, not 48 rounded 13-pixel tiles.
  let peak=0;for(let y=0;y<3;y++)for(let x=638;x<640;x++)peak=Math.max(peak,at(actual,x,y));assert.ok(peak>18,'last column retains the expected origin-aligned dot');
  delete p.canvas.backgroundPattern;const solid=frame(await render(p,path.join(dir,'solid'),{width,height}));for(const [x,y]of [[0,0],[40,20],[639,0]])assert.ok(Math.abs(at(solid,x,y)-18)<=2);assert.ok(at(solid,320,180)>240);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
