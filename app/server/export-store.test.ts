import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {ExportStore} from './export-store.js';
import {createProject,defaultEffects,defaultTransform,type Project,type ExportOptions,type Job} from '../shared/types.js';
import type {RenderLifecycle} from './media.js';
async function fixture(){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'sceneforge-export-store-')),root=path.join(dir,'receipts'),output=path.join(dir,'outputs'),source=path.join(dir,'source.bin');await fs.writeFile(source,'source version one');await fs.mkdir(output);
 const project=createProject('Frozen export');project.media=[{id:'media',name:'Source',path:source,kind:'video',duration:20,width:320,height:180}];project.clips=[{id:'clip',mediaId:'media',name:'Source',track:'screen',start:0,sourceIn:0,sourceOut:20,speed:1,gain:1,muted:true,transform:defaultTransform(),effects:defaultEffects()}];
 const calls:Array<{p:Project;o:ExportOptions;job:Job;life:RenderLifecycle}>=[];let runtime='runtime-A';
 const renderer={start:(p:Project,o:ExportOptions,_out:string,life:RenderLifecycle)=>{const job=life.initialJob!;calls.push({p:structuredClone(p),o:structuredClone(o),job,life});return job;},cancel:(id:string)=>{const c=calls.find(c=>c.job.id===id);if(c)c.job.status='cancelled';return c?.job;}};
 const store=new ExportStore(root,output,renderer,async()=>runtime);await store.init();
 return {dir,root,output,source,project,calls,renderer,store,setRuntime:(r:string)=>{runtime=r;},runtime:async()=>runtime,cleanup:async()=>{await store.shutdown(async()=>{});await fs.rm(dir,{recursive:true,force:true});}};
}
async function complete(f:Awaited<ReturnType<typeof fixture>>,index=0){const c=f.calls[index];c.job.status='running';await c.life.onUpdate!(c.job);c.job.outputPath=path.join(f.output,c.job.id+'.mp4');await fs.writeFile(c.job.outputPath,'verified final output');try{await c.life.beforeComplete!(c.job);c.job.status='complete';c.job.progress=1;}catch(e){c.job.status='failed';c.job.error=(e as Error).message;}await c.life.onUpdate!(c.job);return c;}
test('receipt and deep immutable snapshot precede queue; restart uses saved version and options',async()=>{
 const f=await fixture();try{const options:ExportOptions={format:'mp4',range:{start:1,end:3}};const initial=await f.store.create(f.project,options);const saved=JSON.parse(await fs.readFile(path.join(f.root,initial.id+'.json'),'utf8'));assert.equal(saved.record.status,'queued');assert.equal(JSON.parse(await fs.readFile(path.join(f.root,initial.id+'.snapshot.json'),'utf8')).name,'Frozen export');options.range!.start=9;f.project.name='Current changed project';f.project.clips[0].gain=.1;await complete(f);const next=await f.store.restart(initial.id);assert.notEqual(next.id,initial.id);assert.equal(next.restartOf,initial.id);assert.equal(f.calls[1].p.name,'Frozen export');assert.equal(f.calls[1].p.clips[0].gain,1);assert.equal(f.calls[1].o.range!.start,1);assert.equal((await f.store.get(initial.id)).restartedAs,next.id);}finally{await f.cleanup();}
});
test('active receipts restore interrupted without auto-start, and a second live owner is rejected',async()=>{
 const f=await fixture();try{const job=await f.store.create(f.project,{format:'mp4'});f.calls[0].job.status='running';await f.calls[0].life.onUpdate!(f.calls[0].job);const other=new ExportStore(f.root,f.output,f.renderer,f.runtime);await assert.rejects(other.init(),/already has a running/);assert.equal((await f.store.get(job.id)).status,'running');await f.store.shutdown(async()=>{});const restored=new ExportStore(f.root,f.output,f.renderer,f.runtime);await restored.init();assert.equal((await restored.get(job.id)).status,'interrupted');assert.equal(f.calls.length,1);await restored.shutdown(async()=>{});}finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('same-size source rewrite with preserved mtime blocks restart and completion',async()=>{
 const f=await fixture();try{const j=await f.store.create(f.project,{format:'mp4'}),stat=await fs.stat(f.source);await fs.writeFile(f.source,'source version TWO');await fs.utimes(f.source,stat.atime,stat.mtime);await complete(f);assert.equal((await f.store.get(j.id)).status,'failed');assert.match((await f.store.get(j.id)).error!,/Source files changed/);await assert.rejects(f.store.restart(j.id),/changed or are missing/);assert.equal(f.calls.length,1);assert.deepEqual((await f.store.get(j.id)).recovery.changedSources,['Source']);}finally{await f.cleanup();}
});
test('runtime change requires explicit acknowledgment, and concurrent retries cannot double queue',async()=>{
 const f=await fixture();try{const j=await f.store.create(f.project,{format:'mp4'});await complete(f);f.setRuntime('runtime-B');await assert.rejects(f.store.restart(j.id),/Explicitly acknowledge/);assert.equal((await f.store.get(j.id)).recovery.runtimeChanged,true);const results=await Promise.allSettled([f.store.restart(j.id,true),f.store.restart(j.id,true)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.length,2);await assert.rejects(f.store.restart(j.id,true),/already active/);}finally{await f.cleanup();}
});
test('completed history survives restart; deleted or rewritten outputs cannot be downloaded',async()=>{
 const f=await fixture();try{const j=await f.store.create(f.project,{format:'mp4'});const c=await complete(f);await f.store.shutdown(async()=>{});const next=new ExportStore(f.root,f.output,f.renderer,f.runtime);await next.init();assert.equal((await next.get(j.id)).status,'complete');assert.equal((await next.get(j.id)).output.status,'available');const download=await next.openDownload(j.id);assert.equal((await download.handle.readFile()).toString(),'verified final output');await download.handle.close();const stat=await fs.stat(c.job.outputPath!);await fs.writeFile(c.job.outputPath!,'modified final output');await fs.utimes(c.job.outputPath!,stat.atime,stat.mtime);await assert.rejects(next.openDownload(j.id),/changed/);assert.equal((await next.get(j.id)).output.status,'changed');await fs.rm(c.job.outputPath!);assert.equal((await next.get(j.id)).output.status,'missing');await next.shutdown(async()=>{});}finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('serialized writes retain terminal state and cancel remains durable',async()=>{
 const f=await fixture();try{const j=await f.store.create(f.project,{format:'mp4'}),c=f.calls[0];c.job.status='running';const writes=[];for(let i=0;i<8;i++){c.job.progress=i/10;writes.push(c.life.onUpdate!(structuredClone(c.job)));}await f.store.cancel(j.id);await Promise.all(writes);await f.store.flush();const disk=JSON.parse(await fs.readFile(path.join(f.root,j.id+'.json'),'utf8'));assert.equal(disk.record.status,'cancelled');assert.ok(disk.record.revision>=10);}finally{await f.cleanup();}
});

test('replacing a pathname during hashing is rejected even when realpath text is unchanged',async()=>{
 const {fingerprintFile}=await import('./export-store.js');const f=await fixture();const originalOpen=fs.open;const sourceReal=await fs.realpath(f.source);let replaced=false;
 try{
  fs.open=(async(...args:Parameters<typeof fs.open>)=>{const handle=await originalOpen(...args);if(args[0]===sourceReal){const read=handle.createReadStream.bind(handle);handle.createReadStream=((opts:any)=>{const stream=read(opts);const iterator=stream[Symbol.asyncIterator].bind(stream);(stream as any)[Symbol.asyncIterator]=async function*(){for await(const bytes of {[Symbol.asyncIterator]:iterator}){if(!replaced){replaced=true;await fs.writeFile(f.source+'.new','source version TWO');await fs.rename(f.source+'.new',f.source);}yield bytes;}};return stream;}) as any;}return handle;}) as typeof fs.open;
  await assert.rejects(fingerprintFile(f.source),/changed while/);assert.equal(replaced,true);
 }finally{fs.open=originalOpen;await f.cleanup();}
});

test('two actual processes cannot both take over a dead owner or delete the winner lock',async()=>{
 const {spawn}=await import('node:child_process');const dir=await fs.mkdtemp(path.join(tmpdir(),'sceneforge-export-lock-'));const root=path.join(dir,'receipts');await fs.mkdir(path.join(root,'.owner'),{recursive:true});
 const dead=spawn(process.execPath,['-e','process.exit(0)']);await new Promise<void>(resolve=>dead.once('exit',()=>resolve()));await fs.writeFile(path.join(root,'.owner','owner.json'),JSON.stringify({pid:dead.pid,token:'dead-owner'}));
 const code=`import {ExportStore} from './server/export-store.ts';const s=new ExportStore(process.env.TEST_ROOT,process.env.TEST_ROOT,{start(){throw Error('unused')},cancel(){}},async()=>'runtime');try{await s.init();console.log('READY '+process.pid);setInterval(()=>{},1000);process.on('SIGTERM',()=>s.shutdown(async()=>{}).then(()=>process.exit()));}catch(e){console.log('ERROR '+e.message);process.exit(2);}`;
 const children=[0,1].map(()=>spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),env:{...process.env,TEST_ROOT:root},stdio:['ignore','pipe','pipe']}));
 try{
  const outputs=await Promise.all(children.map(child=>new Promise<string>((resolve,reject)=>{let value='';const timer=setTimeout(()=>reject(Error('Lock child timed out')),10000);child.stdout.on('data',b=>{value+=b;if(value.includes('\n')){clearTimeout(timer);resolve(value.trim());}});child.stderr.on('data',b=>{value+=b;});child.on('error',reject);})));assert.equal(outputs.filter(s=>s.startsWith('READY')).length,1);assert.equal(outputs.filter(s=>s.startsWith('ERROR')).length,1);const owner=JSON.parse(await fs.readFile(path.join(root,'.owner','owner.json'),'utf8'));assert.ok(outputs.includes('READY '+owner.pid));process.kill(owner.pid,0);
 }finally{for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise<void>(resolve=>child.once('exit',()=>resolve()))));await fs.rm(dir,{recursive:true,force:true});}
});

test('terminal checkpoint failure does not advertise completion or strand the next render',async()=>{
 const {startExport}=await import('./media.js');const dir=await fs.mkdtemp(path.join(tmpdir(),'sceneforge-export-terminal-'));const p=createProject('Checkpoint failure');let terminalAttempts=0;
 try{
  const first=startExport(p,{format:'json'},dir,{onUpdate:async job=>{if(job.status==='complete'){terminalAttempts++;throw Error('Disk unavailable at terminal checkpoint');}}});
  const next=startExport(p,{format:'json'},dir);
  const deadline=Date.now()+10000;while(['queued','running'].includes(first.status)||['queued','running'].includes(next.status)){if(Date.now()>deadline)throw Error('Renderer queue stranded');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(terminalAttempts,1);assert.equal(first.status,'failed');assert.match(first.message,/receipt could not be saved/);assert.equal(next.status,'complete');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('history is paginated and old receipts stay loadable without loading project snapshots',async()=>{
 const f=await fixture();let restored:ExportStore|undefined;try{
  const initial=await f.store.create(f.project,{format:'mp4'});await complete(f);await f.store.shutdown(async()=>{});const saved=JSON.parse(await fs.readFile(path.join(f.root,initial.id+'.json'),'utf8'));
  for(let i=0;i<505;i++){const copy=structuredClone(saved);copy.record.id='archive-'+String(i).padStart(4,'0');copy.record.startedAt=new Date(1700000000000+i*1000).toISOString();await fs.writeFile(path.join(f.root,copy.record.id+'.json'),JSON.stringify(copy));}
  restored=new ExportStore(f.root,f.output,f.renderer,f.runtime);await restored.init();assert.equal((await restored.list()).length,200);assert.equal((await restored.list(undefined,200)).length,200);assert.equal((await restored.list(undefined,400)).length,106);assert.equal((await restored.get('archive-0000')).status,'complete');assert.equal((await restored.get(initial.id)).projectName,'Frozen export');
 }finally{await restored?.shutdown(async()=>{});await fs.rm(f.dir,{recursive:true,force:true});}
});

test('malformed and unsupported history is preserved while valid exports remain available',async()=>{
 const f=await fixture();let next:ExportStore|undefined;try{
  const job=await f.store.create(f.project,{format:'mp4'});await complete(f);await f.store.shutdown(async()=>{});const corrupt='{not json';const future=JSON.stringify({version:999});await fs.writeFile(path.join(f.root,'malformed.json'),corrupt);await fs.writeFile(path.join(f.root,'future.json'),future);
  next=new ExportStore(f.root,f.output,f.renderer,f.runtime);await next.init();assert.equal((await next.get(job.id)).status,'complete');assert.equal((await next.list()).length,1);assert.equal(next.diagnostics().unavailableCount,2);assert.match(next.diagnostics().message!,/left unchanged/);assert.equal(await fs.readFile(path.join(f.root,'malformed.json'),'utf8'),corrupt);assert.equal(await fs.readFile(path.join(f.root,'future.json'),'utf8'),future);
 }finally{await next?.shutdown(async()=>{});await fs.rm(f.dir,{recursive:true,force:true});}
});

test('public export options cannot inject internal render controls and resolved settings match output geometry',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.store.create(f.project,{format:'mp4',frameCount:1} as any),/Unsupported export option/);await assert.rejects(f.store.create(f.project,{format:'mp4',range:{start:5,end:2}}),/range/);await assert.rejects(f.store.create(f.project,{format:'mp4',width:NaN}),/finite/);assert.equal(f.calls.length,0);
  const job=await f.store.create(f.project,{format:'mp4',width:641,height:359});assert.equal(job.options.width,642);assert.equal(job.options.height,360);
 }finally{await f.cleanup();}
});

async function fingerprintRace<T>(mutate:(file:string,attempt:number)=>Promise<void>,run:(file:string,attempts:()=>number)=>Promise<T>,beforeOpen?:(file:string,attempt:number)=>Promise<void>){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'sceneforge-renderer-metadata-')),file=path.join(directory,'renderer.bin');await fs.writeFile(file,'original renderer bytes');await fs.chmod(file,0o600);
 const originalOpen=fs.open,real=await fs.realpath(file);let attempts=0;
 try{
  fs.open=(async(...args:Parameters<typeof fs.open>)=>{const match=args[0]===real,attempt=match?++attempts:0;if(match)await beforeOpen?.(file,attempt);const handle=await originalOpen(...args);if(match){const read=handle.createReadStream.bind(handle);handle.createReadStream=((opts:any)=>{const stream=read(opts),iterator=stream[Symbol.asyncIterator].bind(stream);let once=false;stream[Symbol.asyncIterator]=async function*(){for await(const chunk of {[Symbol.asyncIterator]:iterator}){if(!once){once=true;await mutate(file,attempt);}yield chunk;}return undefined;};return stream;}) as any;}return handle;}) as typeof fs.open;
  return await run(file,()=>attempts);
 }finally{fs.open=originalOpen;await fs.rm(directory,{recursive:true,force:true});}
}
test('source fingerprint remains strict for a real metadata-only race',async()=>{
 const {fingerprintFile}=await import('./export-store.js');
 await fingerprintRace(async(file)=>{await fs.chmod(file,0o640);},async(file,attempts)=>{await assert.rejects(fingerprintFile(file),/changed while/);assert.equal(attempts(),1);assert.equal(await fs.readFile(file,'utf8'),'original renderer bytes');});
});
test('renderer rehash tolerates one provenance-like metadata change only when full bytes match',async()=>{
 const {fingerprintRendererFile}=await import('./export-store.js');const {createHash}=await import('node:crypto');
 await fingerprintRace(async(file,attempt)=>{if(attempt===1)await fs.chmod(file,0o640);},async(file,attempts)=>{const identity=await fingerprintRendererFile(file);assert.equal(attempts(),2);assert.equal(identity.sha256,createHash('sha256').update('original renderer bytes').digest('hex'));assert.equal(identity.realPath,await fs.realpath(file));});
});
test('renderer metadata that keeps changing fails after three reads and stays within the deadline',async()=>{
 const {fingerprintRendererFile}=await import('./export-store.js');
 await fingerprintRace(async(file,attempt)=>{await fs.chmod(file,attempt%2?0o640:0o600);},async(file,attempts)=>{const start=Date.now();await assert.rejects(fingerprintRendererFile(file),error=>error instanceof Error&&error.message.includes(file)&&error.message.includes('changed while'));assert.equal(attempts(),3);assert.ok(Date.now()-start<1000);});
 await assert.rejects(fingerprintRendererFile('/never-opened',Date.now()-1),/timed out/);
});
test('renderer content, size, and pathname races do not become accepted startup baselines',async()=>{
 const {fingerprintRendererFile}=await import('./export-store.js');
 for(const kind of ['content','size','pathname'])await fingerprintRace(async(file,attempt)=>{if(attempt!==1)return;if(kind==='pathname'){await fs.writeFile(file+'.new','original renderer bytes');await fs.rename(file+'.new',file);}else await fs.writeFile(file,kind==='size'?'different longer renderer contents':'modified renderer bytes');},async(file,attempts)=>{await assert.rejects(fingerprintRendererFile(file),/changed while/);assert.equal(attempts(),1);});
});
test('metadata retry requires identical full hashes even if later content has stable metadata',async()=>{
 const {fingerprintRendererFile}=await import('./export-store.js');
 await fingerprintRace(async(file,attempt)=>{if(attempt===1)await fs.chmod(file,0o640);},async(file,attempts)=>{
  await assert.rejects(fingerprintRendererFile(file),/Renderer content changed/);assert.equal(attempts(),2);
 },async(file,attempt)=>{if(attempt===2)await fs.writeFile(file,'modified renderer bytes');});
});
