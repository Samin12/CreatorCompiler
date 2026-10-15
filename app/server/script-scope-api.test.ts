import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('script analysis sends only the requested scene and rejects a missing target without contacting the provider',{timeout:30000},async()=>{
 const requests:any[]=[];
 const provider=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Revised second scene.'}}]}));});
 await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
 const providerPort=(provider.address() as {port:number}).port;
 const portFinder=createServer();await new Promise<void>(resolve=>portFinder.listen(0,'127.0.0.1',resolve));const port=(portFinder.address() as {port:number}).port;await new Promise<void>(resolve=>portFinder.close(()=>resolve()));
 const dir=await mkdtemp(path.join(tmpdir(),'sceneforge-script-scope-'));
 const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SCENEFORGE_PORT:String(port),SCENEFORGE_DATA_DIR:dir},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}/api`,json=(body:unknown,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  let ready=false;for(let i=0;i<200&&!ready;i++){try{ready=(await fetch(base+'/ready')).ok;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}assert.ok(ready,'server ready');
  const p=await (await fetch(base+'/projects',json({name:'Scoped scripts'}))).json();
  p.scenes=[{id:'first',name:'Intro',script:'Private first scene.',notes:'',start:0,duration:0},{id:'second',name:'Demo',script:'Second scene to improve.',notes:'',start:0,duration:0}];
  const revision=(await fetch(base+'/projects/'+p.id)).headers.get('etag')!;
  assert.equal((await fetch(base+'/projects/'+p.id,{...json(p,'PUT'),headers:{'Content-Type':'application/json','If-Match':revision}})).status,200);
  assert.equal((await fetch(base+'/ai/settings',json({provider:'openai-compatible',baseUrl:`http://127.0.0.1:${providerPort}/v1`,model:'fixture-chat',language:'en'},'PUT'))).status,200);
  const response=await fetch(base+'/ai/analyze',json({projectId:p.id,kind:'script',sceneId:'second',prompt:'Shorten this scene'}));
  assert.equal(response.status,200);assert.equal((await response.json()).suggestions[0].text,'Revised second scene.');
  const sent=JSON.parse(requests[0].messages[1].content);assert.deepEqual(sent.scenes,[{name:'Demo',script:'Second scene to improve.'}]);
  const missing=await fetch(base+'/ai/analyze',json({projectId:p.id,kind:'script',sceneId:'missing'}));assert.equal(missing.status,404);assert.equal(requests.length,1);
  const invalid=await fetch(base+'/ai/analyze',json({projectId:p.id,kind:'script',sceneId:42}));assert.equal(invalid.status,400);assert.equal(requests.length,1);
  const stored=await (await fetch(base+'/projects/'+p.id)).json();assert.deepEqual(stored.scenes,p.scenes,'analysis never applies its proposal');
 }finally{
  child.kill('SIGTERM');await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',()=>resolve());});
  await new Promise<void>(resolve=>provider.close(()=>resolve()));await rm(dir,{recursive:true,force:true});
 }
});
