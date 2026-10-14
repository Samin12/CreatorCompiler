import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=net.createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(r=>server.close(()=>r()));return port;}
test('ready answers without probing, autosave can opt into a minimal echo whose revision the client reproduces, and abandoned previews are not errors',{timeout:30000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-project-api-')),port=await freePort(),base=`http://127.0.0.1:${port}/api`;
 const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SCENEFORGE_PORT:String(port),SCENEFORGE_DATA_DIR:path.join(dir,'data')},stdio:'pipe'});let stderr='';child.stderr?.on('data',b=>stderr+=b);child.stdout?.resume();
 try{
  let ready:any;for(let i=0;i<200&&!ready;i++){try{ready=await (await fetch(base+'/ready')).json();}catch{await delay(25);}}assert.deepEqual(ready,{application:'SceneForge',version:'0.1.0'},stderr);
  const health=await (await fetch(base+'/health')).json();assert.equal(health.application,'SceneForge');assert.equal(typeof health.hardwareEncode,'boolean');assert.ok(health.dataDir);
  const created=await (await fetch(base+'/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Minimal echo'})})).json();
  const opened=await fetch(base+'/projects/'+created.id),etag=opened.headers.get('etag')!,project=await opened.json();assert.deepEqual(project,created);
  const edited={...project,name:'Renamed',notes:'kept'},put=await fetch(base+'/projects/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag,'Prefer':'return=minimal'},body:JSON.stringify(edited)});
  const minimal=await put.json(),revision=put.headers.get('etag')!.replaceAll('"','');assert.equal(put.status,200);assert.deepEqual(Object.keys(minimal),['minimal','id','updatedAt']);assert.equal(minimal.minimal,true);assert.equal(minimal.id,project.id);
  const adopted={...edited,updatedAt:minimal.updatedAt};assert.equal(createHash('sha256').update(JSON.stringify(adopted)).digest('hex'),revision);
  const reread=await fetch(base+'/projects/'+project.id);assert.equal(reread.headers.get('etag'),put.headers.get('etag'));assert.equal(reread.headers.get('content-type'),'application/json; charset=utf-8');assert.deepEqual(await reread.json(),adopted);
  const full=await fetch(base+'/projects/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':put.headers.get('etag')!},body:JSON.stringify({...adopted,name:'Full body'})}),body=await full.json();
  assert.equal(body.name,'Full body');assert.equal(createHash('sha256').update(JSON.stringify(body)).digest('hex'),full.headers.get('etag')!.replaceAll('"',''));
  const stale=await fetch(base+'/projects/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag,'Prefer':'return=minimal'},body:JSON.stringify(edited)});assert.equal(stale.status,409);
  assert.equal((await fetch(base+'/projects/'+project.id+'/automation')).status,200);assert.equal((await fetch(base+'/projects/missing-project/automation')).status,404);
  if(process.platform==='darwin'){
   const clip=path.join(dir,'clip.mp4');await new Promise<void>((resolve,reject)=>spawn(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=15:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-y',clip]).once('close',code=>code?reject(Error('fixture')):resolve()));
   const [clipMedia]=await (await fetch(base+'/media/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[clip]})})).json();
   for(const route of ['vision','vision-mask.png']){const abort=new AbortController(),request=fetch(`${base}/media/${clipMedia.id}/${route}?time=1`,{signal:abort.signal}).catch(()=>{});await delay(30);abort.abort();await request;}
   await delay(1000);assert.doesNotMatch(stderr,/aborted/i,'abandoned scrub previews are not logged as errors');
  }
 }finally{child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(2000)]);if(child.exitCode===null)child.kill('SIGKILL');await fs.rm(dir,{recursive:true,force:true});}
});
