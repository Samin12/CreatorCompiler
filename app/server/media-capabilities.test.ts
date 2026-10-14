import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mediaCapabilityProbe } from './media-capabilities.ts';
const execute=promisify(execFile);

async function fixture(mode:'working'|'failed'|'hanging'|'oversized') {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-capability-')),
    binary=path.join(dir,'ffmpeg.cjs'),log=path.join(dir,'calls.jsonl');
  await fs.writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args.includes('-encoders')){console.log(' V..... h264_videotoolbox');process.exit(0)}
if(args.includes('-version')){console.log('ffprobe fixture');process.exit(0)}
${mode==='working'?'process.exit(0)':mode==='failed'?"console.error('Cannot create compression session: -12903');process.exit(187)":mode==='hanging'?'setInterval(()=>{},1000)':"process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000)"}
`,{mode:0o700});
  return {dir,binary,log};
}

test('a listed but unusable VideoToolbox encoder is not advertised as hardware',async()=>{
  const f=await fixture('failed');try{
    const get=mediaCapabilityProbe(f.binary,f.binary),results=await Promise.all(Array.from({length:20},()=>get()));
    assert.ok(results.every(r=>r.ffmpeg&&r.ffprobe&&!r.hardwareEncode));
    const calls=(await fs.readFile(f.log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(calls.length,3,'Concurrent callers share one metadata and hardware probe');
    const encode=calls.find(a=>a.includes('-c:v'));assert.ok(encode);
    assert.equal(encode[encode.indexOf('-allow_sw')+1],'0');
    assert.equal(encode[encode.indexOf('-frames:v')+1],'1');
    await get();assert.equal((await fs.readFile(f.log,'utf8')).trim().split('\n').length,3);
  }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('successful real-session probe retains hardware acceleration',async()=>{
  const f=await fixture('working');try{assert.deepEqual(await mediaCapabilityProbe(f.binary,f.binary)(),{ffmpeg:true,ffprobe:true,hardwareEncode:true});}
  finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('hardware probe deadlines and output bounds fall back without hanging callers',{timeout:10000},async()=>{
  for(const mode of ['hanging','oversized']as const){const f=await fixture(mode);try{
    const began=Date.now(),result=await mediaCapabilityProbe(f.binary,f.binary,500)();
    assert.equal(result.hardwareEncode,false);assert.ok(Date.now()-began<4000);
  }finally{await fs.rm(f.dir,{recursive:true,force:true});}}
  assert.deepEqual(await mediaCapabilityProbe('/nonexistent/sceneforge-ffmpeg','/nonexistent/sceneforge-ffprobe')(),{ffmpeg:false,ffprobe:false,hardwareEncode:false});
});
test('hardware-requested export completes through libx264 when VideoToolbox cannot start',{timeout:30000},async()=>{
  const f=await fixture('failed');try{
    const real=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
    await fs.writeFile(f.binary,`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(f.log)},JSON.stringify(args)+'\\n');if(args.includes('-encoders')){console.log(' V..... h264_videotoolbox');process.exit(0)}if(args.includes('h264_videotoolbox')){console.error('Cannot create compression session: -12903');process.exit(187)}const c=cp.spawn(${JSON.stringify(real)},args,{stdio:'inherit'});c.on('error',()=>process.exit(1));c.on('exit',code=>process.exit(code??1));`,{mode:0o700});
    const script=`import {getCapabilities,startExport,getJob} from './server/media.ts';import {createProject} from './shared/types.ts';const p=createProject('CPU fallback');p.canvas={width:160,height:90,fps:30,background:'#e83c21',padding:0,radius:0};p.scenes[0].duration=.2;const job=startExport(p,{format:'mp4',hardware:true,quality:'draft'},process.env.TEST_OUTPUT);while(!['complete','failed'].includes(getJob(job.id).status))await new Promise(r=>setTimeout(r,25));console.log(JSON.stringify({cap:await getCapabilities(),job:getJob(job.id)}));`;
    const {stdout}=await execute(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SCENEFORGE_FFMPEG:f.binary,TEST_OUTPUT:f.dir},timeout:25000,maxBuffer:1024*1024});
    const result=JSON.parse(stdout.trim());assert.equal(result.cap.hardwareEncode,false);assert.equal(result.job.status,'complete',result.job.error);
    const calls=(await fs.readFile(f.log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(calls.filter(a=>a.includes('h264_videotoolbox')).length,1);
    assert.ok(calls.some(a=>a.includes('libx264')));
    const probe=await execute(process.env.SCENEFORGE_FFPROBE||'ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0',result.job.outputPath]);assert.equal(Number(probe.stdout.trim()),6);
  }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
