import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {visionHelper} from './vision.ts';
import {FACE_TILE_SECONDS,isFaceBounds,smoothFaceSamples,type FaceTrack,type FaceTrackPoint} from '../shared/face-tracking.ts';
import type {Media} from '../shared/types.ts';
const VERSION='source-face-4hz-v1',MAX_TILES=256;
const memory=new Map<string,FaceTrackPoint[]>();
const remember=(key:string,points:FaceTrackPoint[])=>{memory.delete(key);memory.set(key,points);while(memory.size>MAX_TILES)memory.delete(memory.keys().next().value!);};
type Pending={promise:Promise<FaceTrackPoint[]>;controller:AbortController;users:number};
const pending=new Map<string,Pending>();
let queue=Promise.resolve(),writes=0;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const abortError=()=>new DOMException('Face tracking cancelled','AbortError');
export function validateFaceTrackSamples(value:unknown):FaceTrackPoint[]{
 if(!Array.isArray(value)||value.length>70)throw Error('Invalid face tracking sample count');
 let last=-Infinity;
 return value.map(point=>{if(!point||!Number.isFinite(point.time)||point.time<0||point.time<=last||(point.face!==null&&!isFaceBounds(point.face)))throw Error('Invalid face tracking sample');last=point.time;return {time:point.time,face:point.face};});
}
async function run(binary:string,args:string[],signal:AbortSignal){
 signal.throwIfAborted();
 return new Promise<any>((resolve,reject)=>{
  const child=spawn(binary,args,{stdio:['ignore','pipe','pipe']}),stop=()=>child.kill('SIGKILL');let output='',errors='',failure:Error|undefined;
  const timeout=setTimeout(()=>{failure=Error('Face tracking exceeded its 45-second tile deadline');stop();},45000);
  signal.addEventListener('abort',stop,{once:true});
  if(signal.aborted)stop();
  child.stdout.on('data',b=>{output+=b;if(output.length>256*1024){failure=Error('Face tracking output exceeded its bound');stop();}});
  child.stderr.on('data',b=>errors=(errors+b).slice(-4000));
  child.once('error',error=>{failure=error;});
  child.once('close',code=>{clearTimeout(timeout);signal.removeEventListener('abort',stop);if(signal.aborted)return reject(abortError());if(failure)return reject(failure);if(code!==0)return reject(Error(errors||`Face tracker exited ${code}`));try{resolve(JSON.parse(output));}catch{reject(Error('Invalid face tracker response'));}});
 });
}
async function acquire(record:Pending,signal?:AbortSignal){
 signal?.throwIfAborted();record.users++;
 return new Promise<FaceTrackPoint[]>((resolve,reject)=>{
  let done=false;
  const release=()=>{if(done)return false;done=true;signal?.removeEventListener('abort',cancel);record.users--;return true;};
  const cancel=()=>{if(release()){reject(abortError());if(record.users===0)record.controller.abort();}};
  signal?.addEventListener('abort',cancel,{once:true});
  record.promise.then(value=>{if(release())resolve(value);},error=>{if(release())reject(error);});
 });
}
async function tile(media:Media,index:number,cacheDir:string,identity:string,binary:string,signal?:AbortSignal){
 const start=index*FACE_TILE_SECONDS,end=Math.min(media.duration,start+FACE_TILE_SECONDS),key=digest(`${identity}:${index}`),folder=path.join(cacheDir,'face-tracks-v1'),file=path.join(folder,key+'.json');
 signal?.throwIfAborted();const cached=memory.get(key);if(cached){memory.delete(key);memory.set(key,cached);return cached;}
 let task=pending.get(key);
 if(!task||task.controller.signal.aborted){
  if(pending.size>=128)throw Error('Too many pending face tracking windows. Wait for the current requests to finish.');
  const controller=new AbortController();
  const promise=queue.catch(()=>{}).then(async()=>{
   controller.signal.throwIfAborted();
   try {if((await fs.stat(file)).size>256*1024)throw Error('Oversized tracking cache');const points=validateFaceTrackSamples(JSON.parse(await fs.readFile(file,'utf8')));remember(key,points);return points;}catch{}
   const left=media.kind==='image'?0:Math.max(0,start-.75),right=media.kind==='image'?0:Math.min(media.duration,end+.75);
   const result=await run(binary,['track',media.path,String(left),String(right-left),String(4)],controller.signal);
   const raw=validateFaceTrackSamples(result.samples),points=media.kind==='image'?raw:smoothFaceSamples(raw).filter(p=>p.time>=start-1e-7&&p.time<end-1e-7);
   if(!points.length&&raw.length)points.push(raw[raw.length-1]);
   controller.signal.throwIfAborted();await fs.mkdir(folder,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
   try{await fs.writeFile(temp,JSON.stringify(points),{mode:0o600});controller.signal.throwIfAborted();await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
   remember(key,points);
   if(++writes%32===0){const entries=await fs.readdir(folder);if(entries.length>2048){const files=await Promise.all(entries.filter(n=>n.endsWith('.json')).map(async name=>({name,time:(await fs.stat(path.join(folder,name))).mtimeMs})));for(const old of files.sort((a,b)=>a.time-b.time).slice(0,files.length-2048))await fs.rm(path.join(folder,old.name),{force:true});}}
   return points;
  });
  queue=promise.then(()=>{},()=>{});task={promise,controller,users:0};pending.set(key,task);
  const entry=task;void promise.finally(()=>{if(pending.get(key)===entry)pending.delete(key);}).catch(()=>{});
 }
 return acquire(task,signal);
}
/** Tracks are keyed to absolute source time, never timeline positions or clip identities. */
export async function getFaceTrack(media:Media,options:{start:number;end:number;cacheDir?:string;signal?:AbortSignal}):Promise<FaceTrack>{
 if(media.kind==='audio'||!Number.isFinite(options.start)||!Number.isFinite(options.end)||options.start<0||options.end<=options.start||options.end-options.start>600)throw Error('Face tracking requires a video/image source interval of up to 600 seconds');
 options.signal?.throwIfAborted();const file=await fs.realpath(media.path),stat=await fs.stat(file,{bigint:true}),binary=await visionHelper(),helperStat=await fs.stat(binary);
 const identity=`${VERSION}:${file}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${media.width}:${media.height}:${media.duration}:${helperStat.size}:${helperStat.mtimeMs}`;
 const start=media.kind==='image'?0:Math.min(options.start,Math.max(0,media.duration-.001)),end=media.kind==='image'?Math.max(1,options.end):Math.min(options.end,media.duration);
 const first=media.kind==='image'?0:Math.floor(Math.max(0,start-.5)/FACE_TILE_SECONDS),last=media.kind==='image'?0:Math.floor(Math.max(0,Math.min(media.duration-.001,end+.5))/FACE_TILE_SECONDS);
 const points:FaceTrackPoint[]=[];
 for(let i=first;i<=last;i++)points.push(...await tile({...media,path:file},i,options.cacheDir??path.join(tmpdir(),'sceneforge-vision'),identity,binary,options.signal));
 points.sort((a,b)=>a.time-b.time);const unique=points.filter((p,i)=>!i||p.time>points[i-1].time);
 return {version:1,sampleRate:4,start,end,points:unique,subject:'largest-face'};
}
