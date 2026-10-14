import { promises as fs } from 'node:fs';
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
export const revision=(p:Project)=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
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
export type ProjectEvent={id:string;revision:string;updatedAt:string;action:'saved'|'trashed'};
export const projectEvents=new EventEmitter();
projectEvents.setMaxListeners(0);
export async function saveProject(project:Project,options:{checkpoint?:boolean;expectedRevision?:string}={}){
 const id=safeId(project.id),snapshot=structuredClone(project);
 return serialize(writeQueues,id,()=>writeProject(snapshot,options));
}
async function writeProject(project:Project,{checkpoint=false,expectedRevision}:{checkpoint?:boolean;expectedRevision?:string}={}){
 const p=validateProject(project);const file=path.join(PROJECT_DIR,safeId(p.id)+'.json');
 let previous:Project|undefined;try{previous=await readProject(p.id);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(expectedRevision && (!previous||revision(previous)!==expectedRevision)){const e=new Error('Project changed in another window. Reload before applying this edit.');Object.assign(e,{status:409});throw e;}
 if(previous && (checkpoint || Date.now()-(lastHistory.get(p.id)||0)>30000)){
  const dir=path.join(HISTORY_DIR,p.id);await fs.mkdir(dir,{recursive:true});await atomicJSON(path.join(dir,Date.now()+'-'+randomUUID()+'.json'),previous);lastHistory.set(p.id,Date.now());
 }
 p.updatedAt=new Date().toISOString();await atomicJSON(file,p);
 projectEvents.emit('project',{id:p.id,revision:revision(p),updatedAt:p.updatedAt,action:'saved'} satisfies ProjectEvent);return p;
}
export async function newProject(name?:string){return saveProject(createProject(name?.trim()||'Untitled project'));}
export async function trashProject(id:string){
 safeId(id);return serialize(writeQueues,id,async()=>{const p=await readProject(id);await fs.rename(path.join(PROJECT_DIR,id+'.json'),path.join(TRASH_DIR,id+'-'+Date.now()+'-'+randomUUID()+'.json'));projectEvents.emit('project',{id,revision:revision(p),updatedAt:p.updatedAt,action:'trashed'} satisfies ProjectEvent);});
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
    try{await fs.writeFile(temp,JSON.stringify(restored,null,2),{mode:0o600,flag:'wx'});await fs.link(temp,target);}
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){if(!restoredAsCopy)throw Object.assign(Error('A project with this identity already exists. Review and choose Restore as copy to keep both.'),{status:409});restored={...structuredClone(original),id:randomUUID(),name:original.name+' (recovered copy)'};continue;}throw error;}
    finally{await fs.rm(temp,{force:true});}
    break;
   }
   // The restored project is durable before consuming the trash entry; original history and catalog stay intact.
   await fs.unlink(source);
   projectEvents.emit('project',{id:restored.id,revision:revision(restored),updatedAt:restored.updatedAt,action:'saved'} satisfies ProjectEvent);
   return {project:restored,revision:revision(restored),restoredAsCopy};
  });
 });
}
export async function duplicateProject(id:string){const p=await readProject(id);p.id=randomUUID();p.name+=' copy';p.createdAt=new Date().toISOString();return saveProject(p);}
export async function history(id:string){const dir=path.join(HISTORY_DIR,safeId(id));const files=await fs.readdir(dir).catch(()=>[]);return Promise.all(files.filter(f=>f.endsWith('.json')).sort().reverse().slice(0,100).map(async f=>{const p:Project=JSON.parse(await fs.readFile(path.join(dir,f),'utf8'));return {id:f.slice(0,-5),createdAt:p.updatedAt,name:p.name};}));}
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
 for(const z of p.zooms){if(![z.start,z.duration,z.scale,z.x,z.y].every(Number.isFinite)||z.start<0||z.duration<=0||z.scale<1)throw new Error('Invalid zoom');}
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
