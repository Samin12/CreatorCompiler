import {clipDuration,type Project} from '../shared/types';
import type {SavedTake} from './recorded-takes';
import {sceneTakes} from './scene-takes';
export interface ListedTake {take:SavedTake;number:number;active:boolean;duration:number;}
export function listSceneTakes(project:Project,takes:SavedTake[],sceneId:string,clipIds:ReadonlySet<string>=new Set(project.clips.map(c=>c.id))):ListedTake[]{
 const unique=new Map(takes.filter(t=>t.sceneId===sceneId).map(t=>[t.id,t]));
 const states=new Map(sceneTakes({...project,recordedTakes:[...unique.values()]},sceneId).map(t=>[t.id,t.activeClipCount>0]));
 return [...unique.values()].sort((a,b)=>(Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)||a.id.localeCompare(b.id)).map((take,index)=>({take,number:index+1,active:states.get(take.id)||Boolean(take.clipIds?.some(id=>clipIds.has(id))),duration:Math.max(0,...take.media.map((m,i)=>Math.max(0,take.offsets[i]||0)+m.duration))})).reverse();
}
/** Per-scene take lists and legacy-footage flags, computed once per project/takes change rather than on every card render. */
export function sceneCardData(project:Project,takes:SavedTake[]):Map<string,{all:ListedTake[];legacyFootage:boolean}>{
 const clipIds=new Set(project.clips.map(c=>c.id)),takeClips=new Set(takes.flatMap(t=>t.clipIds??[])),avMedia=new Set(project.media.filter(m=>m.kind==='video'||m.kind==='audio').map(m=>m.id));
 const loose=project.clips.filter(c=>!c.recordingTakeId&&c.track!=='music'&&!takeClips.has(c.id)&&avMedia.has(c.mediaId));
 return new Map(project.scenes.map(scene=>[scene.id,{all:listSceneTakes(project,takes,scene.id,clipIds),legacyFootage:loose.some(c=>c.start<scene.start+scene.duration&&c.start+clipDuration(c)>scene.start)}]));
}
