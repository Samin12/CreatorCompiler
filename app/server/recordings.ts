import {promises as fs} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {UPLOAD_DIR,CACHE_DIR,atomicJSON,safeId,registerMedia} from './storage.js';
import {probeMedia,waveform} from './media.js';
import {captureActivity} from './capture-activity.js';
import {isAudioRole,type AudioRole,type Media} from '../shared/types.js';
const directory=path.join(UPLOAD_DIR,'recordings');
const queues=new Map<string,Promise<unknown>>();
async function serial<T>(id:string,run:()=>Promise<T>){const old=queues.get(id)||Promise.resolve();const task=old.catch(()=>{}).then(run);queues.set(id,task);try{return await task;}finally{if(queues.get(id)===task)queues.delete(id);}}
// MediaRecorder MP4 is fragmented, so its chunks concatenate byte-wise exactly like streamed WebM.
const isMP4=(mimeType:unknown)=>typeof mimeType==='string'&&/^(video|audio)\/mp4(?=$|;)/.test(mimeType);
export async function createRecording(name:string,mimeType:string,audioRole?:AudioRole){if(typeof mimeType!=='string'||!/^(video|audio)\/(webm|mp4)(?=$|;)/.test(mimeType))throw new Error('Only WebM or MP4 recording chunks are supported');if(audioRole!==undefined&&!isAudioRole(audioRole))throw new Error('Invalid recording audio role');const id=randomUUID(),folder=path.join(directory,id);await fs.mkdir(folder,{recursive:true});await atomicJSON(path.join(folder,'metadata.json'),{id,name:String(name||'Recording').slice(0,200),mimeType,...(audioRole?{audioRole}:{}),startedAt:new Date().toISOString(),status:'recording'});captureActivity.open(id);return{id};}
export async function appendRecording(id:string,index:number,bytes:Buffer){return serial(safeId(id),async()=>{if(!Number.isSafeInteger(index)||index<0||index>1_000_000||!bytes.length)throw new Error('Invalid recording chunk');const folder=path.join(directory,id);const metadata=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));if(metadata.status==='complete')throw new Error('Recording is already complete');const file=path.join(folder,String(index).padStart(9,'0')+'.chunk');const digest=createHash('sha256').update(bytes).digest('hex');
 try{const previous=await fs.readFile(file);if(createHash('sha256').update(previous).digest('hex')!==digest)throw new Error('A different chunk already occupies this index');return{ok:true,index};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(index>0)await fs.access(path.join(folder,String(index-1).padStart(9,'0')+'.chunk'));
 const disk=await fs.statfs(folder);if(disk.bavail*disk.bsize<bytes.length+50*1024*1024)throw new Error('Not enough disk space to safely continue recording');
 const temp=file+'.tmp';await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,file);captureActivity.open(id);return{ok:true,index};});}
/** Losslessly remuxes the ordered chunks. cat streams them straight into ffmpeg's stdin, one open file at a time
 * (the concat: protocol opens every chunk at once and can exceed the descriptor limit), with no intermediate copy. */
export async function remuxChunks(folder:string,chunks:string[],output:string[],batch=1000){
 const child=spawn(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-nostdin','-v','error','-y','-i','pipe:0','-map','0','-c','copy',...output],{cwd:folder,stdio:['pipe','ignore','pipe']});
 let error='',copyError:Error|undefined;child.stderr.on('data',d=>{error=(error+d).slice(-6000);});child.stdin.on('error',()=>{});
 const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});exited.catch(()=>{});
 try{for(let i=0;i<chunks.length&&child.exitCode===null&&child.signalCode===null;i+=batch){const cat=spawn('/bin/cat',chunks.slice(i,i+batch),{cwd:folder,stdio:['ignore',child.stdin,'ignore']});const code=await new Promise<number|null>((resolve,reject)=>{cat.once('error',reject);cat.once('close',resolve);});if(code){copyError=Error('Recording chunks could not be read');break;}}}
 catch(e){copyError=e as Error;}finally{child.stdin.end();}
 const code=await exited;if(code)throw new Error(error||'Recording finalization failed');if(copyError)throw copyError;
}
let warming=Promise.resolve();
/** Warms an audio take's review waveform in the background, one at a time so probes keep a free slot. */
export function warmTakeWaveform(media:Media){if(media.kind==='audio')warming=warming.then(()=>waveform(media,CACHE_DIR)).then(()=>{},()=>{});}
export const waveformWarmup=()=>warming;
async function removeChunks(folder:string,files:string[]){for(const file of files)await fs.rm(path.join(folder,file),{force:true}).catch(()=>{});}
export async function finishRecording(id:string){captureActivity.close(safeId(id));return serial(id,async()=>{
 const folder=path.join(directory,id),metadata=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));
 if(metadata.media)return metadata.media;
 const chunks=(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')).sort();if(!chunks.length)throw new Error('No completed recording chunks available');
 const mp4=isMP4(metadata.mimeType),final=path.join(folder,mp4?'take.mp4':'take.webm'),temp=final+'.tmp';
 // Streaming MediaRecorder WebM omits Duration and seek cues; fragmented MP4 has no front index. A lossless remux writes both.
 await remuxChunks(folder,chunks,[...(mp4?['-movflags','+faststart','-f','mp4']:['-f','webm']),path.basename(temp)]);
 const media=await probeMedia(temp,CACHE_DIR);if(!Number.isFinite(media.duration)||media.duration<=0)throw new Error('The recorded take contains no playable duration');
 await fs.rename(temp,final);media.path=final;media.name=metadata.name;if(isAudioRole(metadata.audioRole))media.audioRole=metadata.audioRole;await registerMedia(media);
 await atomicJSON(path.join(folder,'metadata.json'),{...metadata,status:'complete',media,completedAt:new Date().toISOString()});
 // Completed folders are never recovered, so chunk cleanup and the review waveform run after the response.
 void removeChunks(folder,[...chunks,'capture.webm']);warmTakeWaveform(media);
 return media;
});}
/** Removes chunks left behind in completed recordings when the service stopped before cleanup finished. */
export async function cleanupCompletedRecordings(){const ids=await fs.readdir(directory).catch(()=>[]);for(const id of ids){try{const folder=path.join(directory,id);const meta=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));if(meta.status==='complete'&&meta.media&&!queues.has(id))await removeChunks(folder,(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')||f==='capture.webm'));}catch{}}}
export async function recoverableRecordings(){const ids=await fs.readdir(directory).catch(()=>[]);const results=[];for(const id of ids){try{const folder=path.join(directory,id);const meta=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));if(meta.status!=='complete'){const count=(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')).length;if(count)results.push({...meta,chunks:count});}}catch{}}return results;}
