import { promises as fs, constants as fsConstants, type Stats } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import {EventEmitter} from 'node:events';
import { createProject, projectDuration, isAudioRole, type Project, type Media, type AISettings } from '../shared/types.js';
import type {TrashProjectSummary,TrashRestoreResult} from '../shared/recovery.js';

export const DATA_DIR=path.resolve(process.env.SCENEFORGE_DATA_DIR||path.join(os.homedir(),'Library/Application Support/SceneForge/studio'));
export const CACHE_DIR=path.join(DATA_DIR,'cache');
export const OUTPUT_DIR=path.join(DATA_DIR,'exports');
export const UPLOAD_DIR=path.join(DATA_DIR,'media');
const PROJECT_DIR=path.join(DATA_DIR,'projects');
const MEDIA_DIR=path.join(DATA_DIR,'catalog');
const HISTORY_DIR=path.join(DATA_DIR,'history');
const TRASH_DIR=path.join(DATA_DIR,'trash');
export async function initStorage(){await Promise.all([DATA_DIR,CACHE_DIR,OUTPUT_DIR,UPLOAD_DIR,PROJECT_DIR,MEDIA_DIR,HISTORY_DIR,path.join(DATA_DIR,'trash')].map(p=>fs.mkdir(p,{recursive:true})));}
export const safeId=(s:string)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(s))throw new Error('Invalid identifier');return s;};
const digest=(json:string)=>createHash('sha256').update(json).digest('hex');
export const revision=(p:Project)=>digest(JSON.stringify(p));
export async function atomicJSON(file:string,value:unknown){const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(temp,file);}catch(e){await fs.rm(temp,{force:true});throw e;}}
export async function readProject(id:string):Promise<Project>{return JSON.parse(await fs.readFile(path.join(PROJECT_DIR,safeId(id)+'.json'),'utf8'));}
export async function listProjects(){const files=await fs.readdir(PROJECT_DIR);const projects=await Promise.all(files.filter(f=>f.endsWith('.json')).map(async f=>{try{const p:Project=JSON.parse(await fs.readFile(path.join(PROJECT_DIR,f),'utf8'));return {id:p.id,name:p.name,updatedAt:p.updatedAt,duration:projectDuration(p),mediaCount:p.media.length,sceneCount:p.scenes.length,thumbnailMediaId:(p.clips.find(c=>c.track==='screen')??p.clips.find(c=>c.track==='camera')??p.clips.find(c=>c.track==='overlay'))?.mediaId};}catch{return null;}}));return projects.filter(Boolean).sort((a,b)=>b!.updatedAt.localeCompare(a!.updatedAt));}
const lastHistory=new Map<string,number>();
const writeQueues=new Map<string,Promise<unknown>>();
const trashQueues=new Map<string,Promise<unknown>>();
async function serialize<T>(queues:Map<string,Promise<unknown>>,id:string,work:()=>Promise<T>):Promise<T>{
 const next=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(work);queues.set(id,next);
 try{return await next;}finally{if(queues.get(id)===next)queues.delete(id);}
}
/** `source` marks a save whose only content change is `captions`, made by local transcription. */
export type ProjectEvent={id:string;revision:string;updatedAt:string;action:'saved'|'trashed';source?:'automatic-captions'};
/** `project` events are public (SSE); `committed` carries the in-memory saved Project to server observers. */
export const projectEvents=new EventEmitter();
projectEvents.setMaxListeners(0);
// Committed compact JSON (the revision's hash input) keyed by file identity: an unchanged file needs no read, parse or hash.
type Committed={key:string;json:string;revision:string;updatedAt:string};
const committed=new Map<string,Committed>();
const fileKey=(stat:Stats)=>`${stat.ino}:${stat.size}:${stat.mtimeMs}`;
function remember(id:string,entry:Committed){committed.delete(id);committed.set(id,entry);while(committed.size>8)committed.delete(committed.keys().next().value!);}
/** Committed JSON and revision; `project` is present only when the file had to be read and parsed. */
export async function projectState(id:string):Promise<Committed&{project?:Project}>{
 const handle=await fs.open(path.join(PROJECT_DIR,safeId(id)+'.json'),'r');
 try{const key=fileKey(await handle.stat()),cached=committed.get(id);if(cached?.key===key){remember(id,cached);return cached;}
  const project:Project=JSON.parse(await handle.readFile('utf8')),json=JSON.stringify(project),entry={key,json,revision:digest(json),updatedAt:project.updatedAt};remember(id,entry);return {...entry,project};}
 finally{await handle.close();}
}
export async function projectExists(id:string){await fs.access(path.join(PROJECT_DIR,safeId(id)+'.json'));}
type SaveOptions={checkpoint?:boolean;expectedRevision?:string;source?:ProjectEvent['source']};
/** Saves and returns the committed project with its revision and exact JSON. `clone:false` is for callers that never reuse the input. */
export async function commitProject(project:Project,options:SaveOptions&{clone?:boolean}={}){
 const id=safeId(project.id),snapshot=options.clone===false?project:structuredClone(project);
 return serialize(writeQueues,id,()=>writeProject(snapshot,options));
}
export async function saveProject(project:Project,options:SaveOptions={}){return (await commitProject(project,options)).project;}
async function writeProject(project:Project,{checkpoint=false,expectedRevision,source}:SaveOptions={}){
 const p=validateProject(project),id=safeId(p.id),file=path.join(PROJECT_DIR,id+'.json');
 let previous:Committed|undefined;try{previous=await projectState(id);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(expectedRevision && (!previous||previous.revision!==expectedRevision)){const e=new Error('Project changed in another window. Reload before applying this edit.');Object.assign(e,{status:409});throw e;}
 if(previous && (checkpoint || Date.now()-(lastHistory.get(id)||0)>30000)){
  // The committed bytes are the snapshot: a copy-on-write clone where supported, never a re-serialization.
  const dir=path.join(HISTORY_DIR,id);await fs.mkdir(dir,{recursive:true});const target=path.join(dir,Date.now()+'-'+randomUUID()+'.json'),temp=target+'.'+randomUUID()+'.tmp';
  try{await fs.copyFile(file,temp,fsConstants.COPYFILE_FICLONE);await fs.rename(temp,target);}catch(e){await fs.rm(temp,{force:true});throw e;}lastHistory.set(id,Date.now());
 }
 p.updatedAt=new Date().toISOString();const json=JSON.stringify(p),hash=digest(json),temp=file+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(temp,json,{mode:0o600});const key=fileKey(await fs.stat(temp));await fs.rename(temp,file);remember(id,{key,json,revision:hash,updatedAt:p.updatedAt});}catch(e){await fs.rm(temp,{force:true});throw e;}
 projectEvents.emit('project',{id,revision:hash,updatedAt:p.updatedAt,action:'saved',...(source?{source}:{})} satisfies ProjectEvent);projectEvents.emit('committed',p);
 return {project:p,revision:hash,json};
}
export async function newProject(name?:string){return saveProject(createProject(name?.trim()||'Untitled project'));}
export async function trashProject(id:string){
 safeId(id);return serialize(writeQueues,id,async()=>{const p=await projectState(id);await fs.rename(path.join(PROJECT_DIR,id+'.json'),path.join(TRASH_DIR,id+'-'+Date.now()+'-'+randomUUID()+'.json'));committed.delete(id);projectEvents.emit('project',{id,revision:p.revision,updatedAt:p.updatedAt,action:'trashed'} satisfies ProjectEvent);});
}
// Legacy tokens contain project-id + timestamp; never use the project-id limit for these filenames.
const safeTrashId=(id:string)=>{if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,220}$/.test(id))throw Error('Invalid trash identifier');return id;};
export async function listTrash():Promise<TrashProjectSummary[]>{
 const live=new Set((await fs.readdir(PROJECT_DIR)).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5)));
 const items=await Promise.all((await fs.readdir(TRASH_DIR)).filter(f=>f.endsWith('.json')).map(async file=>{
  try{const id=safeTrashId(file.slice(0,-5)),p=validateProject(JSON.parse(await fs.readFile(path.join(TRASH_DIR,file),'utf8'))),stat=await fs.stat(path.join(TRASH_DIR,file));
   const timestamp=id.match(/-(\d{13})(?:-[0-9a-f-]{36})?$/)?.[1];
   return {id,projectId:p.id,name:p.name,trashedAt:new Date(timestamp?Number(timestamp):stat.mtimeMs).toISOString(),revision:revision(p),duration:projectDuration(p),mediaCount:p.media.length,sceneCount:p.scenes.length,collision:live.has(p.id)} satisfies TrashProjectSummary;
  }catch{return null;}
 }));return items.filter((item):item is TrashProjectSummary=>item!==null).sort((a,b)=>b.trashedAt.localeCompare(a.trashedAt));
}
export async function restoreTrash(trashId:string,expectedRevision:string,options:{asCopy?:boolean}={}):Promise<TrashRestoreResult>{
 safeTrashId(trashId);if(!expectedRevision)throw Object.assign(Error('Review this trash item before restoring.'),{status:409});
 return serialize(trashQueues,trashId,async()=>{
  const source=path.join(TRASH_DIR,trashId+'.json');
  let original:Project;try{original=validateProject(JSON.parse(await fs.readFile(source,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw Object.assign(Error('This trash item was already restored or is no longer available.'),{status:409});throw error;}
  if(revision(original)!==expectedRevision)throw Object.assign(Error('This trash item changed. Refresh before restoring.'),{status:409});
  return serialize(writeQueues,original.id,async()=>{
   const restoredAsCopy=options.asCopy===true;
   let restored=restoredAsCopy?{...structuredClone(original),id:randomUUID(),name:original.name+' (recovered copy)'}:structuredClone(original);
   // Exclusive publication cannot replace a live file, including one written by another process.
   for(;;){
    restored.updatedAt=new Date().toISOString();const target=path.join(PROJECT_DIR,safeId(restored.id)+'.json'),temp=target+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temp,JSON.stringify(restored),{mode:0o600,flag:'wx'});await fs.link(temp,target);}
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){if(!restoredAsCopy)throw Object.assign(Error('A project with this identity already exists. Review and choose Restore as copy to keep both.'),{status:409});restored={...structuredClone(original),id:randomUUID(),name:original.name+' (recovered copy)'};continue;}throw error;}
    finally{await fs.rm(temp,{force:true});}
    break;
   }
   // The restored project is durable before consuming the trash entry; original history and catalog stay intact.
   await fs.unlink(source);
   const restoredRevision=revision(restored);projectEvents.emit('project',{id:restored.id,revision:restoredRevision,updatedAt:restored.updatedAt,action:'saved'} satisfies ProjectEvent);projectEvents.emit('committed',restored);
   return {project:restored,revision:restoredRevision,restoredAsCopy};
  });
 });
}
export async function duplicateProject(id:string){const p=await readProject(id);p.id=randomUUID();p.name+=' copy';p.createdAt=new Date().toISOString();return saveProject(p);}
// Projects serialize version, id, name, createdAt, updatedAt first, so a snapshot's name and date are in its first bytes.
const snapshotHead=/^\s*\{\s*"version"\s*:\s*1\s*,\s*"id"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"name"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"createdAt"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"updatedAt"\s*:\s*("(?:[^"\\]|\\.)*")/;
export async function snapshotSummary(file:string):Promise<{name:string;updatedAt:string}>{
 const handle=await fs.open(file,'r');let head='';try{const {bytesRead,buffer}=await handle.read(Buffer.alloc(4096),0,4096,0);head=buffer.toString('utf8',0,bytesRead);}finally{await handle.close();}
 const match=snapshotHead.exec(head);if(match)return {name:JSON.parse(match[1]),updatedAt:JSON.parse(match[2])};
 const p:Project=JSON.parse(await fs.readFile(file,'utf8'));return {name:p.name,updatedAt:p.updatedAt};
}
export async function history(id:string){
 const dir=path.join(HISTORY_DIR,safeId(id)),files=(await fs.readdir(dir).catch(()=>[])).filter(f=>f.endsWith('.json')).sort().reverse().slice(0,100),items:Array<{id:string;createdAt:string;name:string}>=new Array(files.length);let next=0;
 await Promise.all(Array.from({length:Math.min(4,files.length)},async()=>{while(next<files.length){const i=next++,s=await snapshotSummary(path.join(dir,files[i]));items[i]={id:files[i].slice(0,-5),createdAt:s.updatedAt,name:s.name};}}));
 return items;
}
export async function restoreProject(id:string,historyId:string,expectedRevision:string){if(!expectedRevision)throw Object.assign(Error('Reload and review the current project before restoring history.'),{status:409});const p:Project=JSON.parse(await fs.readFile(path.join(HISTORY_DIR,safeId(id),safeId(historyId)+'.json'),'utf8'));p.id=id;return saveProject(p,{checkpoint:true,expectedRevision});}
export async function registerMedia(media:Media){safeId(media.id);if(media.audioRole!==undefined&&!isAudioRole(media.audioRole))throw new Error('Invalid media audio role');if(media.audioRole===undefined){const previous=await readMedia(media.id).catch(()=>undefined);if(previous?.path===media.path&&isAudioRole(previous.audioRole))media={...media,audioRole:previous.audioRole};}await atomicJSON(path.join(MEDIA_DIR,media.id+'.json'),media);return media;}
export async function readMedia(id:string):Promise<Media>{return JSON.parse(await fs.readFile(path.join(MEDIA_DIR,safeId(id)+'.json'),'utf8'));}
export const defaultAISettings:AISettings={provider:'local',baseUrl:'https://api.openai.com/v1',model:process.env.SCENEFORGE_DEFAULT_MODEL||'',language:process.env.SCENEFORGE_DEFAULT_MODEL?'en':'auto'};
export async function readAISettings():Promise<AISettings>{try{return {...defaultAISettings,...JSON.parse(await fs.readFile(path.join(DATA_DIR,'ai-settings.json'),'utf8'))};}catch{return {...defaultAISettings};}}
export async function saveAISettings(settings:Partial<AISettings>){const current=await readAISettings();const next={...current,...settings};if(!['local','openai','openai-compatible','elevenlabs'].includes(next.provider))throw new Error('Unknown AI provider');if(settings.apiKey==='')delete next.apiKey;await atomicJSON(path.join(DATA_DIR,'ai-settings.json'),next);return redactSettings(next);}
export function redactSettings(settings:AISettings){const {apiKey,...publicSettings}=settings;return {...publicSettings,hasApiKey:!!apiKey};}
export function validateProject(value:unknown):Project{
 if(!value||typeof value!=='object')throw new Error('Expected a project object');const p=value as Project;
 if(p.version!==1||typeof p.id!=='string'||typeof p.name!=='string'||!p.name.trim())throw new Error('Invalid project identity');safeId(p.id);
 if(!p.canvas||![p.canvas.width,p.canvas.height,p.canvas.fps].every(Number.isFinite)||p.canvas.width<16||p.canvas.height<16||p.canvas.width>8192||p.canvas.height>8192||p.canvas.fps<1||p.canvas.fps>120)throw new Error('Invalid canvas (16–8192 pixels, 1–120 fps)');
 if(p.canvas.backgroundPattern!==undefined&&p.canvas.backgroundPattern!=='moving-dots')throw new Error('Unknown canvas background pattern');
 for(const key of ['clips','media','scenes','captions','elements','zooms'] as const){if(!Array.isArray(p[key])||p[key].length>100000)throw new Error('Invalid '+key);}
 const layerKinds=new Map<string,'video'|'audio'>();
 if(p.timelineLayers!==undefined){
  if(!Array.isArray(p.timelineLayers)||p.timelineLayers.length>2000)throw Error('Invalid timeline layers');
  for(const layer of p.timelineLayers){
   if(!layer||typeof layer.id!=='string'||typeof layer.name!=='string'||!layer.name.trim()||layer.name.length>200||!['video','audio'].includes(layer.kind)||!Number.isFinite(layer.order))throw Error('Invalid timeline layer');
   safeId(layer.id);if(layerKinds.has(layer.id))throw Error('Duplicate timeline layer');layerKinds.set(layer.id,layer.kind);
  }
 }
 const mediaIds=new Set(p.media.map(m=>m.id));
 for(const m of p.media){safeId(m.id);if(typeof m.path!=='string'||!path.isAbsolute(m.path))throw new Error('Media paths must be absolute');if(m.audioRole!==undefined&&!isAudioRole(m.audioRole))throw new Error('Invalid media audio role');}
 for(const c of p.clips){if(!mediaIds.has(c.mediaId))throw new Error('Clip references missing media');if(![c.start,c.sourceIn,c.sourceOut,c.speed,c.gain].every(Number.isFinite)||c.start<0||c.sourceIn<0||c.sourceOut<=c.sourceIn||c.speed<.05||c.speed>16||c.gain<0||c.gain>10)throw new Error('Invalid clip timing or gain');if(c.effectTiming&&(![c.effectTiming.sourceIn,c.effectTiming.sourceOut].every(Number.isFinite)||c.effectTiming.sourceIn<0||c.effectTiming.sourceOut<=c.effectTiming.sourceIn))throw new Error('Invalid clip effect timing');}
 for(const c of p.captions){if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||typeof c.text!=='string')throw new Error('Invalid caption timing');}
 for(const c of p.clips){
  if(c.audioRole!==undefined&&!isAudioRole(c.audioRole))throw new Error('Invalid clip audio role');
  if(!['screen','camera','audio','music','overlay'].includes(c.track)||!c.effects||!c.transform)throw new Error('Clip track, effects and transform are required');
  if(c.layerId!==undefined){
   if(typeof c.layerId!=='string')throw Error('Invalid clip layer');
   const reserved:Record<string,'video'|'audio'>={'role:screen':'video','role:camera':'video','role:overlay':'video','role:audio':'audio','role:music':'audio'};
   const kind=reserved[c.layerId]??layerKinds.get(c.layerId);
   if(!kind||kind!==(c.track==='audio'||c.track==='music'?'audio':'video'))throw Error('Clip references an invalid or incompatible timeline layer');
  }
  if(![c.transform.x,c.transform.y,c.transform.width,c.transform.height,c.transform.rotation,c.transform.opacity,c.transform.borderRadius].every(Number.isFinite)||c.transform.width<=0||c.transform.height<=0||c.transform.opacity<0||c.transform.opacity>1)throw new Error('Invalid clip transform');
  if(c.transform.shadow!==undefined){const s=c.transform.shadow;if(!s||typeof s!=='object'||Array.isArray(s)||![s.x,s.y,s.blur].every(Number.isFinite)||Math.abs(s.x)>8192||Math.abs(s.y)>8192||s.blur<0||s.blur>1000||typeof s.color!=='string'||!/^#[0-9a-f]{8}$/i.test(s.color))throw Error('Invalid clip shadow');}
  if(![c.effects.brightness,c.effects.contrast,c.effects.saturation,c.effects.blur,c.effects.fadeIn,c.effects.fadeOut].every(Number.isFinite))throw new Error('Invalid clip effects');
 }
 for(const s of p.scenes){if(!Number.isFinite(s.start)||!Number.isFinite(s.duration)||s.start<0||s.duration<0||typeof s.script!=='string')throw new Error('Invalid scene');}
 for(const e of p.elements){if(![e.start,e.duration,e.x,e.y,e.width,e.height,e.fontSize,e.opacity,e.rotation].every(Number.isFinite)||e.start<0||e.duration<0)throw new Error('Invalid element');}
 for(const z of p.zooms){if(![z.start,z.duration,z.scale,z.x,z.y].every(Number.isFinite)||z.start<0||z.duration<=0||z.scale<1)throw new Error('Invalid zoom');if(z.effectTiming!==undefined){const timing=z.effectTiming;if(!timing||typeof timing!=='object'||Array.isArray(timing)||![timing.offset,timing.duration].every(Number.isFinite)||timing.offset<0||timing.duration<=0||timing.offset>86400||timing.duration>86400)throw new Error('Invalid zoom effect timing');}}
 if(!p.cursor||!Array.isArray(p.cursor.points)||!p.settings||!p.captionStyle)throw new Error('Project settings are missing');
 if(p.recordedTakes!==undefined){
  if(!Array.isArray(p.recordedTakes)||p.recordedTakes.length>2000)throw Error('Invalid recorded take history');
  const ids=new Set<string>(),scenes=new Set(p.scenes.map(s=>s.id));let totalClips=0;
  for(const take of p.recordedTakes){
   if(!take||typeof take.id!=='string'||typeof take.sceneId!=='string')throw Error('Invalid recorded take identity');
   safeId(take.id);if(ids.has(take.id)||!scenes.has(take.sceneId)||typeof take.createdAt!=='string'||take.name!==undefined&&typeof take.name!=='string'||take.recordOver!==undefined&&typeof take.recordOver!=='boolean')throw Error('Invalid recorded take identity');ids.add(take.id);
   if(!Array.isArray(take.media)||!take.media.length||take.media.length>10000||!Array.isArray(take.tracks)||!Array.isArray(take.offsets)||take.tracks.length!==take.media.length||take.offsets.length!==take.media.length||take.offsets.some(n=>!Number.isFinite(n)||n<0)||take.tracks.some(k=>!['screen','camera','audio','music','overlay'].includes(k)))throw Error('Invalid recorded take sources');
   if(take.installedRoles!==undefined&&(!Array.isArray(take.installedRoles)||take.installedRoles.some(r=>!['screen','camera','overlay','music','audio:microphone','audio:system','audio:unknown'].includes(r))))throw Error('Invalid recorded take roles');
   for(const media of take.media){safeId(media.id);if(typeof media.path!=='string'||!path.isAbsolute(media.path)||!Number.isFinite(media.duration)||media.duration<=0)throw Error('Invalid recorded take media');}
   if(take.timeline){const t=take.timeline;if(!Array.isArray(t.clips)||!Array.isArray(t.captions)||!Number.isFinite(t.duration)||t.duration<0||t.start!==undefined&&(!Number.isFinite(t.start)||t.start<0)||(totalClips+=t.clips.length)>100000||t.clips.some(c=>!c||typeof c.id!=='string'||c.recordingTakeId!==take.id))throw Error('Invalid recorded take timeline');
    const media=[...p.media,...take.media.filter(m=>!mediaIds.has(m.id))];validateProject({...p,recordedTakes:undefined,media,clips:t.clips,captions:t.captions,scenes:[],elements:[],zooms:[]});
   }
  }
  if(p.clips.some(c=>c.recordingTakeId!==undefined&&!ids.has(c.recordingTakeId)))throw Error('Clip references missing recorded take');
 }
 return p;
}
