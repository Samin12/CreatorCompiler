import {createHash,randomUUID} from 'node:crypto';
import {promises as fs,constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {FileHandle} from 'node:fs/promises';
import {projectDuration,type Project,type ExportOptions,type Job} from '../shared/types.js';
import type {ExportRecord} from '../shared/export-history.js';
import type {RenderLifecycle} from './media.js';

type Identity={path:string;realPath:string;size:number;mtimeMs:number;ctimeMs:number;dev:number;ino:number;sha256:string};
type Source={mediaId:string;name:string;identity:Identity};
type Saved={version:1;record:ExportRecord;sources:Source[];runtime:string;output?:Identity};
type Renderer={start:(p:Project,o:ExportOptions,dir:string,lifecycle:RenderLifecycle)=>Job;cancel:(id:string)=>Job|undefined};
const active=(s:string)=>s==='queued'||s==='running';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const conflict=(message:string)=>Object.assign(Error(message),{status:409});
const jobFields=(j:Job)=>({id:j.id,type:j.type,status:j.status,progress:j.progress,message:j.message,outputPath:j.outputPath,startedAt:j.startedAt,completedAt:j.completedAt,error:j.error});
const stamp=(s:{size:number|bigint;mtimeMs:number|bigint;ctimeMs:number|bigint;dev:number|bigint;ino:number|bigint})=>({size:Number(s.size),mtimeMs:Number(s.mtimeMs),ctimeMs:Number(s.ctimeMs),dev:Number(s.dev),ino:Number(s.ino)});
class FingerprintChanged extends Error {
 constructor(readonly metadataOnly:boolean,readonly readSha256:string){super('File changed while its fingerprint was being read');}
}

/** Hash through an open descriptor and reject a file that changes while read. */
export async function fingerprintFile(file:string,signal?:AbortSignal):Promise<Identity>{
 signal?.throwIfAborted();
 const realPath=await fs.realpath(file),handle=await fs.open(realPath,'r');
 try{
  const before=await handle.stat();if(!before.isFile())throw Error('Expected a regular media file');
  const digest=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false,signal}))digest.update(chunk);
  const after=await handle.stat(),current=await fs.stat(file),currentRealPath=await fs.realpath(file),sha256=digest.digest('hex');
  const beforeStamp=stamp(before),afterStamp=stamp(after),currentStamp=stamp(current);
  if(JSON.stringify(beforeStamp)!==JSON.stringify(afterStamp)||JSON.stringify(currentStamp)!==JSON.stringify(afterStamp)||currentRealPath!==realPath){
   const withoutCtime=({ctimeMs:_ctime,...identity}:ReturnType<typeof stamp>)=>JSON.stringify(identity);
   throw new FingerprintChanged(currentRealPath===realPath&&withoutCtime(beforeStamp)===withoutCtime(afterStamp)&&withoutCtime(currentStamp)===withoutCtime(afterStamp),sha256);
  }
  signal?.throwIfAborted();return {path:file,realPath,...afterStamp,sha256};
 }finally{await handle.close();}
}
/** macOS may attach provenance metadata on first launch. Rehash only that narrow race,
 * require the same digest on every read, and retain strict source-media fingerprinting. */
export async function fingerprintRendererFile(file:string,deadline=Date.now()+5000):Promise<Identity>{
 const failure=(error:unknown)=>new Error(`Could not verify renderer ${file}: ${error instanceof Error?error.message:String(error)}`,{cause:error});
 let firstDigest:string|undefined;
 for(let attempt=0;attempt<3;attempt++){
  const remaining=deadline-Date.now();if(remaining<=0)throw failure(Error('Renderer verification timed out. Try opening SceneForge again.'));
  try{
   const identity=await fingerprintFile(file,AbortSignal.timeout(remaining));
   if(firstDigest!==undefined&&identity.sha256!==firstDigest)throw Error('Renderer content changed while its fingerprint was being read');
   return identity;
  }catch(error){
   if(!(error instanceof FingerprintChanged)||!error.metadataOnly||attempt===2)throw failure(error);
   if(firstDigest!==undefined&&error.readSha256!==firstDigest)throw failure(Error('Renderer content changed while its fingerprint was being read'));
   firstDigest=error.readSha256;
   const delay=25*(attempt+1);if(Date.now()+delay>=deadline)throw failure(Error('Renderer verification timed out. Try opening SceneForge again.'));
   await new Promise(resolve=>setTimeout(resolve,delay));
  }
 }
 throw failure(Error('Renderer verification did not settle. Try opening SceneForge again.'));
}
async function atomic(file:string,value:unknown){
 const tmp=file+'.'+randomUUID()+'.tmp';let handle:FileHandle|undefined;
 try{handle=await fs.open(tmp,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=undefined;await fs.rename(tmp,file);const dir=await fs.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}
 finally{await handle?.close();await fs.rm(tmp,{force:true});}
}
async function resolveBinary(name:string){
 if(path.isAbsolute(name)||name.includes(path.sep))return path.resolve(name);
 for(const dir of (process.env.PATH||'').split(path.delimiter)){const file=path.join(dir,name);try{await fs.access(file,constants.X_OK);return file;}catch{}}
 return undefined;
}
/** Conservative signature: renderer sources/bundle, native helpers, encoders and host runtime. */
export async function rendererFingerprint():Promise<string>{
 const deadline=Date.now()+5000;
 const dir=path.dirname(fileURLToPath(import.meta.url));const files:string[]=[];
 for(const file of await fs.readdir(dir))if(/\.(?:ts|swift)$/.test(file)&&!file.endsWith('.test.ts')||file==='index.mjs'||file==='sceneforge-vision'||file==='sceneforge-text-renderer')files.push(path.join(dir,file));
 const shared=path.resolve(dir,'../shared');try{for(const file of await fs.readdir(shared))if(file.endsWith('.ts'))files.push(path.join(shared,file));}catch{}
 const signatures:unknown[]=[];
 for(const file of files.sort())signatures.push([path.basename(file),(await fingerprintRendererFile(file,deadline)).sha256]);
 for(const name of [process.env.SCENEFORGE_FFMPEG||'ffmpeg',process.env.SCENEFORGE_FFPROBE||'ffprobe']){const file=await resolveBinary(name);signatures.push([path.basename(name),file?(await fingerprintRendererFile(file,deadline)).sha256:'missing']);}
 signatures.push(['runtime',process.platform,process.arch,process.version,process.versions.electron||null]);
 return hash(signatures);
}
function resolvedOptions(project:Project,input:ExportOptions):ExportOptions{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Export options must be an object');
 const allowed=new Set(['format','width','height','fps','quality','hardware','burnCaptions','range']);
 if(Object.keys(input).some(key=>!allowed.has(key)))throw Error('Unsupported export option');
 if(!['mp4','webm','wav','srt','txt','md','json'].includes(input.format))throw Error('Unsupported export format');
 for(const key of ['width','height','fps'] as const)if(input[key]!==undefined&&(!Number.isFinite(input[key])||input[key]!<=0))throw Error('Export dimensions and frame rate must be positive finite numbers');
 if(input.quality!==undefined&&!['draft','balanced','high'].includes(input.quality))throw Error('Invalid export quality');
 for(const key of ['hardware','burnCaptions'] as const)if(input[key]!==undefined&&typeof input[key]!=='boolean')throw Error('Export flags must be boolean');
 if(input.range!==undefined){const range=input.range;if(!range||typeof range!=='object'||Object.keys(range).some(key=>!['start','end'].includes(key))||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start||range.end>projectDuration(project)+.001)throw Error('Export range must be within the saved project timeline');}
 const even=(n:number,min:number,max:number)=>2*Math.round(Math.min(max,Math.max(min,n))/2);
 return {format:input.format,width:even(input.width??project.canvas.width,64,7680),height:even(input.height??project.canvas.height,64,4320),fps:Math.min(120,Math.max(1,input.fps??project.canvas.fps)),quality:input.quality??'balanced',hardware:input.hardware??false,burnCaptions:input.burnCaptions??true,...(input.range?{range:structuredClone(input.range)}:{})};
}
export class ExportStore{
 private records=new Map<string,Saved>();private summaries=new Map<string,{projectId:string;startedAt:string}>();private writes:Promise<unknown>=Promise.resolve();private retrying=new Set<string>();
 private unreadableCount=0;
 private lockToken=randomUUID();private owned=false;private closing=false;private currentRuntime='';
 constructor(private root:string,private outputDir:string,private renderer:Renderer,private getRuntime=rendererFingerprint){}
 private file(id:string){return path.join(this.root,id+'.json');}
 private persist(saved:Saved){const snapshot=structuredClone(saved);const next=this.writes.catch(()=>{}).then(()=>atomic(this.file(snapshot.record.id),snapshot));this.writes=next;return next;}
 async init(){
  await fs.mkdir(this.root,{recursive:true,mode:0o700});const lock=path.join(this.root,'.owner');
  for(let attempt=0;attempt<3;attempt++){
   try{await fs.mkdir(lock);await atomic(path.join(lock,'owner.json'),{pid:process.pid,token:this.lockToken});this.owned=true;break;}
   catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    // Serialize reclamation separately: a stale read must never rename a new owner's lock.
    const claim=lock+'.reclaim';try{await fs.mkdir(claim);}catch(err){if((err as NodeJS.ErrnoException).code==='EEXIST')throw Error('Export ownership recovery is in progress or incomplete. Retry after the other service exits.');throw err;}
    try{
     let owner:{pid:number;token:string};try{owner=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));}catch(err){if((err as NodeJS.ErrnoException).code==='ENOENT'){try{await fs.stat(lock);}catch(missing){if((missing as NodeJS.ErrnoException).code==='ENOENT')continue;} }throw Error('Export history ownership is incomplete. Another service may be starting; retry after it exits.');}
     if(!Number.isInteger(owner.pid)||owner.pid<=0||typeof owner.token!=='string')throw Error('Export owner record is invalid; refusing to replace it.');
     let alive=true;try{process.kill(owner.pid,0);}catch(err){if((err as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
     if(alive)throw Error('This data folder already has a running export service. Close it or choose a separate data folder.');
     const stale=lock+'.stale-'+randomUUID();await fs.rename(lock,stale);await fs.rm(stale,{recursive:true,force:true});
    }finally{await fs.rm(claim,{recursive:true});}
   }
  }
  if(!this.owned)throw Error('Could not acquire export history ownership');
  try{
   this.currentRuntime=await this.getRuntime();
   for(const file of (await fs.readdir(this.root)).filter(f=>/^[a-zA-Z0-9_-]+\.json$/.test(f))){
    let saved:Saved;try{saved=JSON.parse(await fs.readFile(path.join(this.root,file),'utf8'));if(saved.version!==1||saved.record?.id+'.json'!==file||typeof saved.record.projectId!=='string'||typeof saved.record.startedAt!=='string'||!saved.record.options||!saved.record.output||!saved.record.recovery||!Array.isArray(saved.sources)||typeof saved.runtime!=='string')throw Error('Unsupported receipt');}catch{this.unreadableCount++;continue;}
    this.records.set(saved.record.id,saved);this.summaries.set(saved.record.id,{projectId:saved.record.projectId,startedAt:saved.record.startedAt});this.trimCache();
    if(active(saved.record.status)){saved.record.status='interrupted';saved.record.message='Interrupted when the export service stopped. Restart uses the saved project and settings.';saved.record.completedAt=new Date().toISOString();this.touch(saved);await this.persist(saved);}
   }
  }catch(e){await this.release();throw e;}
 }
 diagnostics(){return {unavailableCount:this.unreadableCount,message:this.unreadableCount?`${this.unreadableCount} export history record(s) could not be read or use an unsupported format. Their files were left unchanged.`:undefined};}
 private touch(saved:Saved){saved.record.updatedAt=new Date().toISOString();saved.record.revision++;}
 private trimCache(){if(this.records.size<=500)return;for(const [id,saved] of this.records){if(!active(saved.record.status)){this.records.delete(id);if(this.records.size<=500)break;}}}
 private async require(id:string){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Object.assign(Error('Export receipt not found'),{status:404});
  let saved=this.records.get(id);if(!saved){try{saved=JSON.parse(await fs.readFile(this.file(id),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw Object.assign(Error('Export receipt not found'),{status:404});throw e;}if(!saved||saved.record.id!==id||saved.version!==1)throw Error('Invalid export receipt');this.records.set(id,saved);this.trimCache();}return saved;
 }
 private assertOpen(){if(!this.owned||this.closing)throw conflict('Export service is shutting down');}
 private async sources(project:Project):Promise<Source[]>{
  const used=new Set(project.clips.map(c=>c.mediaId));if(project.canvas.backgroundMediaId)used.add(project.canvas.backgroundMediaId);
  const result:Source[]=[];for(const id of used){const media=project.media.find(m=>m.id===id);if(!media)throw Error('Project refers to missing media '+id);result.push({mediaId:id,name:media.name,identity:await fingerprintFile(media.path)});}return result;
 }
 private async changedSources(saved:Saved){const changed:string[]=[];for(const source of saved.sources){try{const now=await fingerprintFile(source.identity.path);if(now.sha256!==source.identity.sha256||now.realPath!==source.identity.realPath)changed.push(source.name);}catch{changed.push(source.name);}}return changed;}
 async create(project:Project,options:ExportOptions,restartOf?:string,expectedSources?:Source[],expectedRuntime?:string):Promise<ExportRecord>{
  this.assertOpen();const snapshot=structuredClone(project),o=resolvedOptions(snapshot,options),now=new Date().toISOString();
  if(!['mp4','webm','wav','srt','txt','md','json'].includes(o.format))throw Error('Unsupported export format');
  const sources=await this.sources(snapshot),runtime=await this.getRuntime();this.assertOpen();if(expectedSources&&sources.some(source=>{const expected=expectedSources.find(s=>s.mediaId===source.mediaId);return !expected||expected.identity.sha256!==source.identity.sha256||expected.identity.realPath!==source.identity.realPath;}))throw conflict('Source files changed while preparing restart.');if(expectedRuntime&&runtime!==expectedRuntime)throw conflict('Renderer changed while preparing restart. Review again.');this.currentRuntime=runtime;
  const record:ExportRecord={id:randomUUID(),type:'export',status:'queued',progress:0,message:'Queued',startedAt:now,projectId:snapshot.id,projectName:snapshot.name,projectRevision:hash(snapshot),snapshotCreatedAt:now,options:o,updatedAt:now,revision:1,restartOf,output:{status:'pending'},recovery:{status:'blocked',reason:'This export is active.',runtimeChanged:false}};
  const saved:Saved={version:1,record,sources,runtime};await atomic(path.join(this.root,record.id+'.snapshot.json'),snapshot);this.records.set(record.id,saved);this.summaries.set(record.id,{projectId:record.projectId,startedAt:record.startedAt});this.trimCache();try{await this.persist(saved);}catch(e){this.records.delete(record.id);this.summaries.delete(record.id);throw e;}
  if(this.closing){record.status='interrupted';record.message='Service stopped before export could start';this.touch(saved);await this.persist(saved);return this.public(saved);}
  try{this.renderer.start(snapshot,o,this.outputDir,{
   initialJob:structuredClone(record),
   onUpdate:async(job)=>{Object.assign(record,jobFields(job));this.touch(saved);await this.persist(saved);},
   beforeComplete:async(job)=>{const changed=await this.changedSources(saved);if(changed.length){record.recovery={status:'blocked',runtimeChanged:false,changedSources:changed,reason:'Source files changed during export: '+changed.join(', ')};throw Error(record.recovery.reason);}
    if(await this.getRuntime()!==saved.runtime)throw Error('Renderer runtime changed during export; output cannot be verified.');
    if(!job.outputPath)throw Error('Export produced no output file');saved.output=await fingerprintFile(job.outputPath);record.output={status:'available'};
   },
  });}catch(e){record.status='failed';record.error=String(e);record.message='Could not start export';this.touch(saved);await this.persist(saved);}
  return this.public(saved);
 }
 private async public(saved:Saved):Promise<ExportRecord>{
  const r=structuredClone(saved.record);r.recovery.runtimeChanged=saved.runtime!==this.currentRuntime;
  if(active(r.status)){r.recovery.status='blocked';r.recovery.reason='This export is active.';}
  else if(!r.recovery.changedSources?.length){r.recovery.status='available';r.recovery.reason=r.recovery.runtimeChanged?'Renderer runtime changed. Review and acknowledge before restarting.':'Restart revalidates original source files and renders the saved project from the beginning.';}
  if(r.status==='complete'){
   if(!saved.output)r.output={status:'unreadable',reason:'Output fingerprint is missing.'};
   else try{const s=await fs.stat(saved.output.path);const real=await fs.realpath(saved.output.path);r.output=JSON.stringify(stamp(s))===JSON.stringify({size:saved.output.size,mtimeMs:saved.output.mtimeMs,ctimeMs:saved.output.ctimeMs,dev:saved.output.dev,ino:saved.output.ino})?{status:'available'}:{status:'changed'};if(real!==saved.output.realPath)r.output={status:'changed',reason:'Output file identity changed.'};}catch(e){r.output={status:(e as NodeJS.ErrnoException).code==='ENOENT'?'missing':'unreadable',reason:'The completed output file is no longer available.'};}
  }
  return r;
 }
 async list(projectId?:string,offset=0,limit=200){const ids=[...this.summaries].filter(([,s])=>!projectId||s.projectId===projectId).sort((a,b)=>b[1].startedAt.localeCompare(a[1].startedAt)).slice(Math.max(0,offset),Math.max(0,offset)+Math.min(200,Math.max(1,limit))).map(([id])=>id);return Promise.all(ids.map(async id=>this.public(await this.require(id))));}
 async get(id:string){return this.public(await this.require(id));}
 async cancel(id:string){const saved=await this.require(id);if(active(saved.record.status)){const job=this.renderer.cancel(id);if(job){Object.assign(saved.record,jobFields(job));this.touch(saved);await this.persist(saved);}}return this.public(saved);}
 async restart(id:string,acknowledgeRuntimeChange=false){
  this.assertOpen();if(this.retrying.has(id))throw conflict('This export is already active or restarting.');this.retrying.add(id);let saved:Saved;try{saved=await this.require(id);}catch(e){this.retrying.delete(id);throw e;}if(active(saved.record.status)){this.retrying.delete(id);throw conflict('This export is already active or restarting.');}
  if(saved.record.restartedAs&&active(this.records.get(saved.record.restartedAs)?.record.status||'')){this.retrying.delete(id);throw conflict('A restart of this export is already active.');}
  this.retrying.add(id);
  try{
   const changed=await this.changedSources(saved);if(changed.length){saved.record.recovery={status:'blocked',runtimeChanged:saved.runtime!==this.currentRuntime,changedSources:changed,reason:'Original source files changed or are missing: '+changed.join(', ')};this.touch(saved);await this.persist(saved);throw conflict(saved.record.recovery.reason!);}
   this.currentRuntime=await this.getRuntime();if(saved.runtime!==this.currentRuntime&&!acknowledgeRuntimeChange)throw conflict('Renderer runtime changed. Explicitly acknowledge using the current runtime to restart.');
   const snapshot:Project=JSON.parse(await fs.readFile(path.join(this.root,id+'.snapshot.json'),'utf8'));if(hash(snapshot)!==saved.record.projectRevision)throw conflict('Saved project snapshot changed or is corrupt; restart is blocked.');const next=await this.create(snapshot,saved.record.options,id,saved.sources,this.currentRuntime);saved.record.restartedAs=next.id;this.touch(saved);await this.persist(saved);return next;
  }finally{this.retrying.delete(id);}
 }
 async openDownload(id:string):Promise<{handle:FileHandle;name:string;size:number}>{
  const saved=await this.require(id);if(saved.record.status!=='complete'||!saved.output)throw conflict('Export is not complete.');
  const now=await fingerprintFile(saved.output.path);if(now.sha256!==saved.output.sha256||now.realPath!==saved.output.realPath)throw conflict('Completed output changed; download is unavailable.');
  const handle=await fs.open(now.realPath,'r');const stat=await handle.stat();if(JSON.stringify(stamp(stat))!==JSON.stringify(stamp(await fs.stat(now.path)))){await handle.close();throw conflict('Completed output changed while opening.');}
  if(stat.ino!==now.ino||stat.dev!==now.dev||stat.size!==now.size||stat.ctimeMs!==now.ctimeMs){await handle.close();throw conflict('Completed output changed while opening.');}
  return {handle,name:path.basename(now.path),size:now.size};
 }
 async flush(){for(;;){const pending=this.writes;await pending;if(pending===this.writes)return;}}
 async shutdown(interrupt:()=>Promise<void>){if(this.closing)return;this.closing=true;await interrupt();await this.flush();await this.release();}
 private async release(){if(!this.owned)return;const lock=path.join(this.root,'.owner');const owner=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));if(owner.token===this.lockToken)await fs.rm(lock,{recursive:true});this.owned=false;}
}
