import {promises as fs,createReadStream} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {UPLOAD_DIR,CACHE_DIR,atomicJSON,safeId,registerMedia} from './storage.js';
import {probeMedia,waveform} from './media.js';
import {captureActivity} from './capture-activity.js';
import {isAudioRole,type AudioRole} from '../shared/types.js';
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
/** ffmpeg input for the ordered chunks. Relative 15-character names keep the concat: argument short;
 * only an extremely long take falls back to one joined intermediate file. */
export async function chunkInput(folder:string,chunks:string[],extension:string,limit=200_000){
 const list='concat:'+chunks.join('|');if(list.length<=limit)return list;
 const raw='capture.'+extension,output=await fs.open(path.join(folder,raw),'w',0o600);
 try{for(const chunk of chunks)for await(const data of createReadStream(path.join(folder,chunk)))await output.writeFile(data);}finally{await output.close();}
 return raw;
}
let warming=Promise.resolve();
async function removeChunks(folder:string,files:string[]){for(const file of files)await fs.rm(path.join(folder,file),{force:true}).catch(()=>{});}
export async function finishRecording(id:string){captureActivity.close(safeId(id));return serial(id,async()=>{
 const folder=path.join(directory,id),metadata=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));
 if(metadata.media)return metadata.media;
 const chunks=(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')).sort();if(!chunks.length)throw new Error('No completed recording chunks available');
 const mp4=isMP4(metadata.mimeType),extension=mp4?'mp4':'webm',final=path.join(folder,'take.'+extension),temp=final+'.tmp',input=await chunkInput(folder,chunks,extension);
 // Streaming MediaRecorder WebM omits Duration and seek cues; fragmented MP4 has no front index. A lossless remux writes both.
 await new Promise<void>((resolve,reject)=>{const child=spawn(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-nostdin','-v','error','-y','-i',input,'-map','0','-c','copy',...(mp4?['-movflags','+faststart','-f','mp4']:['-f','webm']),path.basename(temp)],{cwd:folder});let error='';child.stderr.on('data',d=>{error=(error+d).slice(-6000);});child.once('error',reject);child.once('close',code=>code?reject(new Error(error||'Recording finalization failed')):resolve());});
 const media=await probeMedia(temp,CACHE_DIR);if(!Number.isFinite(media.duration)||media.duration<=0)throw new Error('The recorded take contains no playable duration');
 await fs.rename(temp,final);media.path=final;media.name=metadata.name;if(isAudioRole(metadata.audioRole))media.audioRole=metadata.audioRole;await registerMedia(media);
 await atomicJSON(path.join(folder,'metadata.json'),{...metadata,status:'complete',media,completedAt:new Date().toISOString()});
 // Completed folders are never recovered, so chunk cleanup and the review waveform run after the response; one warm at a time leaves probe capacity free.
 void removeChunks(folder,[...chunks,'capture.webm','capture.mp4']);if(media.kind==='audio')warming=warming.then(()=>waveform(media,CACHE_DIR)).then(()=>{},()=>{});
 return media;
});}
/** Removes chunks left behind in completed recordings when the service stopped before cleanup finished. */
export async function cleanupCompletedRecordings(){const ids=await fs.readdir(directory).catch(()=>[]);for(const id of ids){try{const folder=path.join(directory,id);const meta=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));if(meta.status==='complete'&&meta.media&&!queues.has(id))await removeChunks(folder,(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')||f==='capture.webm'||f==='capture.mp4'));}catch{}}}
export async function recoverableRecordings(){const ids=await fs.readdir(directory).catch(()=>[]);const results=[];for(const id of ids){try{const folder=path.join(directory,id);const meta=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));if(meta.status!=='complete'){const count=(await fs.readdir(folder)).filter(f=>f.endsWith('.chunk')).length;if(count)results.push({...meta,chunks:count});}}catch{}}return results;}
