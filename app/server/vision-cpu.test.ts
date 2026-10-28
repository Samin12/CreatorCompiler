import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { visionHelper } from './vision.ts';
const execute=promisify(execFile);

test('native CPU-only Vision detects, tracks actual frames and segments without an accelerator',{skip:process.platform!=='darwin',timeout:90000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-compiler-vision-cpu-'));
  try{
    const file=path.join(dir,'blank.mp4');
    await execute(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-v','error','-nostdin','-y','-f','lavfi','-i','color=blue:size=160x90:rate=2:duration=2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',file]);
    const binary=await visionHelper(),env={...process.env,SCENEFORGE_VISION_CPU_ONLY:'1'};
    const face=await execute(binary,['face',file,'0'],{env,timeout:15000});assert.deepEqual(JSON.parse(face.stdout).faces,[]);
    const track=await execute(binary,['track',file,'0','2','4'],{env,timeout:15000}),samples=JSON.parse(track.stdout).samples;
    assert.deepEqual(samples.map((s:any)=>s.time),[0,.5,1,1.5]);assert.ok(samples.every((s:any)=>s.face===null));
    const mask=await execute(binary,['segment',file,'0','.5','2','32','18'],{env,encoding:'buffer',timeout:15000,maxBuffer:1024*1024});
    assert.equal(mask.stdout.length,32*18);assert.ok(mask.stdout.every(value=>value===0),'Blank frames have no person mask');
    await assert.rejects(execute(binary,['face',path.join(dir,'missing.mp4'),'0'],{env,timeout:15000}),error=>error instanceof Error&&/Vision error:/.test(error.message));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
