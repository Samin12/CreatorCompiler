import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createProject,defaultTransform,defaultEffects,type Project} from '../shared/types';
import {moveRecordingScene} from '../src/recording-scenes';
import {startExport,probeMedia} from './media';

const ffmpeg=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
function command(args:string[]){const result=spawnSync(ffmpeg,['-v','error','-nostdin','-y',...args],{maxBuffer:100*1024*1024,timeout:60000});assert.equal(result.status,0,result.stderr.toString());return result.stdout;}
async function render(p:Project,out:string){const job=startExport(p,{format:'mp4',quality:'high',burnCaptions:false},out);while(['queued','running'].includes(job.status))await new Promise(r=>setTimeout(r,20));assert.equal(job.status,'complete',job.error);return job.outputPath!;}
test('actual scene-reordered export preserves a cross-boundary zoom ramp in every corresponding frame',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-zoom-phase-'));
 try{
  const image=path.join(dir,'grid.png');command(['-f','lavfi','-i','testsrc=size=320x180:rate=30','-frames:v','1',image]);
  const p=createProject('Zoom phase');p.canvas={width:320,height:180,fps:30,background:'#121212',padding:0,radius:0};p.scenes=['a','b','c'].map((id,i)=>({id,name:id,start:i*2,duration:2,script:'',notes:''}));const media=await probeMedia(image,path.join(dir,'cache'));p.media=[media];p.clips=[{id:'clip',name:'Grid',mediaId:media.id,track:'screen',start:0,sourceIn:0,sourceOut:6,speed:1,gain:0,muted:true,transform:defaultTransform(),effects:defaultEffects()}];p.zooms=[{id:'zoom',start:1.8,duration:1,scale:1.8,x:.5,y:.5,target:'screen',easing:'smooth'}];
  const original=await render(p,path.join(dir,'before'));moveRecordingScene(p,'b','a');const moved=await render(p,path.join(dir,'after'));
  const frames=(file:string)=>command(['-i',file,'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1']),a=frames(original),b=frames(moved),size=320*180*3;assert.equal(a.length,size*180);assert.equal(b.length,a.length);
  let maxMae=0,worstFrame=0;const values:number[]=[];
  for(let frame=0;frame<180;frame++){const sourceFrame=frame<60?frame+60:frame<120?frame-60:frame;let sum=0;for(let i=0;i<size;i++)sum+=Math.abs(b[frame*size+i]-a[sourceFrame*size+i]);const mae=sum/size;values.push(mae);if(mae>maxMae){maxMae=mae;worstFrame=frame;}}
  assert.ok(maxMae<1.5,`largest H264 frame MAE=${maxMae} at reordered frame${worstFrame}; a reset zoom shifts the test grid visibly`);
  const evidence=path.resolve('../evidence/qa/moving-background');await fs.mkdir(evidence,{recursive:true});await fs.copyFile(original,path.join(evidence,'zoom-original.mp4'));await fs.copyFile(moved,path.join(evidence,'zoom-reordered.mp4'));await fs.writeFile(path.join(evidence,'zoom-acceptance.json'),JSON.stringify({pass:true,frames:180,maxMae,worstFrame,values,zooms:p.zooms},null,2));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
