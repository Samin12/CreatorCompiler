import {promises as fs,createReadStream} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {UPLOAD_DIR,CACHE_DIR,atomicJSON,safeId,registerMedia} from './storage.js';
import {probeMedia} from './media.js';
import {isAudioRole,type AudioRole} from '../shared/types.js';
const directory=path.join(UPLOAD_DIR,'recordings');
const queues=new Map<string,Promise<unknown>>();
async function serial<T>(id:string,run:()=>Promise<T>){const old=queues.get(id)||Promise.resolve();const task=old.catch(()=>{}).then(run);queues.set(id,task);try{return await task;}finally{if(queues.get(id)===task)queues.delete(id);}}
export async function createRecording(name:string,mimeType:string,audioRole?:AudioRole){if(!/^(video|audio)\/webm/.test(mimeType))throw new Error('Only WebM recording chunks are supported');if(audioRole!==undefined&&!isAudioRole(audioRole))throw new Error('Invalid recording audio role');const id=randomUUID(),folder=path.join(directory,id);await fs.mkdir(folder,{recursive:true});await atomicJSON(path.join(folder,'metadata.json'),{id,name:String(name||'Recording').slice(0,200),mimeType,...(audioRole?{audioRole}:{}),startedAt:new Date().toISOString(),status:'recording'});return{id};}
export async function appendRecording(id:string,index:number,bytes:Buffer){return serial(safeId(id),async()=>{if(!Number.isSafeInteger(index)||index<0||index>1_000_000||!bytes.length)throw new Error('Invalid recording chunk');const folder=path.join(directory,id);const metadata=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));if(metadata.status==='complete')throw new Error('Recording is already complete');const file=path.join(folder,String(index).padStart(9,'0')+'.chunk');const digest=createHash('sha256').update(bytes).digest('hex');
 try{const previous=await fs.readFile(file);if(createHash('sha256').update(previous).digest('hex')!==digest)throw new Error('A different chunk already occupies this index');return{ok:true,index};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(index>0)await fs.access(path.join(folder,String(index-1).padStart(9,'0')+'.chunk'));
 const disk=await fs.statfs(folder);if(disk.bavail*disk.bsize<bytes.length+50*1024*1024)throw new Error('Not enough disk space to safely continue recording');
 const temp=file+'.tmp';await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,file);return{ok:true,index};});}
export async function finishRecording(id:string){return serial(safeId(id),async()=>{
 const folder=path.join(directory,id),metadata=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));
 if(metadata.media)return metadata.media;
 const chunks=(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')).sort();if(!chunks.length)throw new Error('No completed recording chunks available');
 const final=path.join(folder,'take.webm'),raw=path.join(folder,'capture.webm'),temp=path.join(folder,'take.webm.tmp');
 const output=await fs.open(raw,'w',0o600);
 try{for(const chunk of chunks)for await(const data of createReadStream(path.join(folder,chunk)))await output.writeFile(data);await output.sync();}finally{await output.close();}
 // Streaming MediaRecorder WebM omits Duration and seek cues. A lossless remux writes both.
 await new Promise<void>((resolve,reject)=>{const child=spawn(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-nostdin','-v','error','-y','-i',raw,'-map','0','-c','copy','-f','webm',temp]);let error='';child.stderr.on('data',d=>{error=(error+d).slice(-6000);});child.once('error',reject);child.once('close',code=>code?reject(new Error(error||'Recording finalization failed')):resolve());});
 const media=await probeMedia(temp,CACHE_DIR);if(!Number.isFinite(media.duration)||media.duration<=0)throw new Error('The recorded take contains no playable duration');
 await fs.rename(temp,final);media.path=final;media.name=metadata.name;if(isAudioRole(metadata.audioRole))media.audioRole=metadata.audioRole;await registerMedia(media);
 await atomicJSON(path.join(folder,'metadata.json'),{...metadata,status:'complete',media,completedAt:new Date().toISOString()});
 for(const chunk of chunks)await fs.rm(path.join(folder,chunk));await fs.rm(raw,{force:true});return media;
});}
export async function recoverableRecordings(){const ids=await fs.readdir(directory).catch(()=>[]);const results=[];for(const id of ids){try{const folder=path.join(directory,id);const meta=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));if(meta.status!=='complete'){const count=(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')).length;if(count)results.push({...meta,chunks:count});}}catch{}}return results;}
