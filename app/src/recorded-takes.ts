import type {Media,Project,RecordedTake,TrackKind} from '../shared/types';
import {clipDuration,defaultTransform,effectsForTrack,makeId,projectDuration} from '../shared/types';
import {creatorCameraTransform,creatorScreenTransform} from '../shared/camera-style';
import {plainClone} from './project-draft';
export type SavedTake=RecordedTake;
export type TakeConfirmMode='replace-matching'|'keep-both'|'record-over';
export interface ConfirmTakeOptions {destination:'record'|'edit';sceneId:string;clipIds?:string[];takeId?:string;mode?:TakeConfirmMode;}
const key=(projectId:string)=>`sceneforge.saved-takes.${projectId}`;
export function readSavedTakes(raw:string|null):SavedTake[]{try{const value=JSON.parse(raw||'[]');if(!Array.isArray(value))return[];return value.filter(t=>t&&typeof t.id==='string'&&typeof t.sceneId==='string'&&Array.isArray(t.media)&&t.media.length>0&&t.media.length<=8&&t.media.every((m:Media)=>m&&typeof m.id==='string'&&typeof m.path==='string'&&Number.isFinite(m.duration)&&m.duration>0)&&Array.isArray(t.tracks)&&t.tracks.length===t.media.length&&t.tracks.every((track:string)=>['screen','camera','audio','music','overlay'].includes(track))&&Array.isArray(t.offsets)&&t.offsets.length===t.media.length&&t.offsets.every((offset:number)=>Number.isFinite(offset)&&offset>=0));}catch{return[];}}
export function loadSavedTakes(projectId:string){try{return readSavedTakes(localStorage.getItem(key(projectId)));}catch{return[];}}
export function persistSavedTakes(projectId:string,takes:SavedTake[]){localStorage.setItem(key(projectId),JSON.stringify(takes));}
export const takeDuration=(media:Media[],offsets:number[])=>Math.max(0,...media.map((m,i)=>(offsets[i]||0)+m.duration));
export function takePreviewProject(project:Project,take:SavedTake):Project {
 if(take.timeline){const offset=take.timeline.start??0;return {...project,recordedTakes:undefined,media:[...project.media,...take.media.filter(m=>!project.media.some(p=>p.id===m.id))],clips:take.timeline.clips.map(c=>({...plainClone(c),start:c.start-offset})),scenes:[],captions:take.timeline.captions.map(c=>({...plainClone(c),start:c.start-offset,end:c.end-offset,words:c.words?.map(w=>({...w,start:w.start-offset,end:w.end-offset}))})),elements:[],zooms:[],cursor:{...project.cursor,enabled:false,points:[]}};}
 const composed=take.tracks.includes('screen')&&take.tracks.includes('camera');return {...project,media:take.media,scenes:[],captions:[],elements:[],zooms:[],cursor:{...project.cursor,enabled:false,points:[]},canvas:{...project.canvas,padding:0,radius:0,background:'#111111'},clips:take.media.map((media,i)=>({id:`take-${i}`,mediaId:media.id,name:media.name,track:take.tracks[i],...(media.audioRole?{audioRole:media.audioRole}:{}),start:take.offsets[i]||0,sourceIn:0,sourceOut:media.duration,speed:1,gain:1,muted:false,transform:composed&&take.tracks[i]==='camera'?creatorCameraTransform(project.canvas):composed&&take.tracks[i]==='screen'?creatorScreenTransform(project.canvas):defaultTransform(),effects:effectsForTrack(take.tracks[i])}))};
}
/** Insert after the chosen scene, preserving later timeline content and source trims. */
function appendLegacyTake(project:Project,take:Pick<SavedTake,'media'|'tracks'|'offsets'|'sceneId'|'clipIds'>):{start:number;nextSceneId:string}{
 if(take.clipIds?.length){const existing=project.clips.filter(c=>take.clipIds!.includes(c.id));if(existing.length===take.clipIds.length){const index=project.scenes.findIndex(s=>s.id===take.sceneId);return {start:Math.min(...existing.map(c=>c.start)),nextSceneId:project.scenes[index+1]?.id||take.sceneId};}if(existing.length)throw new Error('Part of this take is already on the timeline. Review those clips before confirming again.');}
 let scene=project.scenes.find(s=>s.id===take.sceneId);if(!scene){scene={id:makeId(),name:`Scene ${project.scenes.length+1}`,script:'',notes:'',start:projectDuration(project),duration:0};project.scenes.push(scene);}
 const index=project.scenes.indexOf(scene),sceneEnd=scene.start+scene.duration;
 // Older projects can have takes beyond their final scene. Include that tail before
 // appending, while preserving deliberate insertion boundaries in earlier scenes.
 const start=index===project.scenes.length-1?Math.max(sceneEnd,projectDuration(project)):sceneEnd,duration=takeDuration(take.media,take.offsets);
 if(project.zooms.some(zoom=>zoom.start<start&&zoom.start+zoom.duration>start))throw new Error('A zoom crosses this scene boundary. Move its end or the scene boundary before confirming this saved take.');
 project.clips=project.clips.flatMap(clip=>{const end=clip.start+clipDuration(clip);if(clip.start>=start)return[{...clip,start:clip.start+duration}];if(end<=start)return[clip];const boundary=clip.sourceIn+(start-clip.start)*clip.speed,effectTiming=clip.effectTiming??{sourceIn:clip.sourceIn,sourceOut:clip.sourceOut};return[{...clip,sourceOut:boundary,effectTiming},{...clip,id:makeId(),start:start+duration,sourceIn:boundary,effectTiming}];});
 project.captions=project.captions.flatMap(c=>{
  if(c.end<=start)return[c];
  if(c.start>=start)return[{...c,start:c.start+duration,end:c.end+duration,words:c.words?.map(w=>({...w,start:w.start+duration,end:w.end+duration}))}];
  const beforeWords=c.words?.filter(w=>w.start<start).map(w=>({...w,end:Math.min(w.end,start)})),afterWords=c.words?.filter(w=>w.end>start).map(w=>({...w,start:Math.max(w.start,start)+duration,end:w.end+duration}));
  const exactWords=c.words?.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim()===c.text.replace(/\s+/g,' ').trim();
  return[{...c,end:start,words:beforeWords,text:exactWords&&beforeWords?.length?beforeWords.map(w=>w.text).join(' '):c.text},{...c,id:makeId(),start:start+duration,end:c.end+duration,words:afterWords,text:exactWords&&afterWords?.length?afterWords.map(w=>w.text).join(' '):c.text}];
 });
 project.elements=project.elements.flatMap(item=>{if(item.start>=start)return[{...item,start:item.start+duration}];if(item.start+item.duration<=start)return[item];return[{...item,duration:start-item.start},{...item,id:makeId(),start:start+duration,duration:item.start+item.duration-start}];});
 for(const zoom of project.zooms)if(zoom.start>=start)zoom.start+=duration;
 const prior=[...project.cursor.points].reverse().find(point=>point.time<start),exact=project.cursor.points.some(point=>point.time===start);
 for(const point of project.cursor.points)if(point.time>=start)point.time+=duration;
 if(prior){project.cursor.points.push({...prior,time:start,visible:false});if(!exact)project.cursor.points.push({...prior,time:start+duration});project.cursor.points.sort((a,b)=>a.time-b.time);}
 for(const later of project.scenes.slice(index+1))later.start+=duration;scene.duration=start-scene.start+duration;
 const preview=takePreviewProject(project,{...take,id:'confirmed',createdAt:''});for(const media of take.media)if(!project.media.some(m=>m.id===media.id))project.media.push(media);
 project.clips.push(...preview.clips.map((c,i)=>({...c,id:take.clipIds?.[i]||makeId(),start:start+c.start})));
 let next=project.scenes[index+1];if(!next){next={id:makeId(),name:`Scene ${project.scenes.length+1}`,script:'',notes:'',start:scene.start+scene.duration,duration:0};project.scenes.push(next);}
 return {start,nextSceneId:next.id};
}

export {saveProjectTake,activateSceneTake,archiveSceneTake,deleteSceneTake,moveSceneTake,updateSceneTake,sceneTakes} from './scene-takes';
import {confirmDurableTake} from './scene-takes';
export function confirmTake(project:Project,take:Pick<SavedTake,'media'|'tracks'|'offsets'|'sceneId'|'clipIds'>&{id?:string;takeId?:string;createdAt?:string;mode?:TakeConfirmMode}):{start:number;nextSceneId:string}{
 const id=take.id??take.takeId;return id?confirmDurableTake(project,{...take,id}):appendLegacyTake(project,take);
}
