import {clipDuration,clipEffectTiming,makeId,type Project} from '../shared/types';
import {plainClone} from './project-draft';
export function splitAt(project:Project,time:number,ids:ReadonlySet<string>,onlyId?:string){
 const crosses=(c:Project['clips'][number])=>c.start+.0001<time&&c.start+clipDuration(c)-.0001>time;
 const selectedCrosses=project.clips.some(c=>ids.has(c.id)&&crosses(c));
 const targets=project.clips.filter(c=>crosses(c)&&(onlyId?c.id===onlyId:!selectedCrosses||ids.has(c.id)));
 for(const c of targets){const sourceCut=c.sourceIn+(time-c.start)*c.speed,origin=clipEffectTiming(c);c.effectTiming={sourceIn:origin.sourceIn,sourceOut:origin.sourceOut};project.clips.push({...plainClone(c),id:makeId(),start:time,sourceIn:sourceCut});c.sourceOut=sourceCut;}
 return targets.length;
}
export function deleteSelection(project:Project,ids:ReadonlySet<string>,ripple:boolean){
 const removed=project.clips.filter(c=>ids.has(c.id));project.clips=project.clips.filter(c=>!ids.has(c.id));
 if(ripple){const byTrack=new Map<string,Array<[number,number]>>();for(const c of removed){const ranges=byTrack.get(c.track)||[];ranges.push([c.start,c.start+clipDuration(c)]);byTrack.set(c.track,ranges);}for(const [track,ranges] of byTrack){const merged:Array<[number,number]>=[];for(const [start,end]of ranges.sort((a,b)=>a[0]-b[0])){const last=merged.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else merged.push([start,end]);}for(const c of project.clips)if(c.track===track)c.start-=merged.reduce((n,[start,end])=>n+(c.start>=end?end-start:0),0);}}
 project.elements=project.elements.filter(e=>!ids.has(e.id));project.zooms=project.zooms.filter(e=>!ids.has(e.id));project.captions=project.captions.filter(e=>!ids.has(e.id));
}
export function trimSelection(project:Project,ids:ReadonlySet<string>,time:number,side:'left'|'right'){
 if(!project.clips.some(c=>ids.has(c.id)&&c.start<time&&c.start+clipDuration(c)>time))return false;
 project.clips=project.clips.filter(c=>{if(!ids.has(c.id))return true;const end=c.start+clipDuration(c);if(side==='left'){if(end<=time)return false;if(c.start<time){c.sourceIn+=(time-c.start)*c.speed;c.start=time;}}else{if(c.start>=time)return false;if(end>time)c.sourceOut=c.sourceIn+(time-c.start)*c.speed;}return true;});return true;
}
export interface TimelineClipboard {clips:Project['clips'];elements:Project['elements'];captions:Project['captions'];zooms:Project['zooms'];media:Project['media'];start:number;}
export function copySelection(p:Project,ids:ReadonlySet<string>):TimelineClipboard|null{
 const clips=p.clips.filter(c=>ids.has(c.id)),elements=p.elements.filter(c=>ids.has(c.id)),captions=p.captions.filter(c=>ids.has(c.id)),zooms=p.zooms.filter(c=>ids.has(c.id));const items=[...clips,...elements,...captions,...zooms];if(!items.length)return null;const mediaIds=new Set(clips.map(c=>c.mediaId));return {clips:clips.map(plainClone),elements:elements.map(plainClone),captions:captions.map(plainClone),zooms:zooms.map(plainClone),media:p.media.filter(m=>mediaIds.has(m.id)).map(plainClone),start:Math.min(...items.map(c=>c.start))};
}
export function pasteSelection(p:Project,clipboard:TimelineClipboard,time:number){const data=plainClone(clipboard),offset=time-data.start,ids:string[]=[];for(const m of data.media)if(!p.media.some(item=>item.id===m.id))p.media.push(m);for(const key of ['clips','elements','captions','zooms']as const)for(const item of data[key]){item.id=makeId();item.start+=offset;ids.push(item.id);if('end'in item){item.end+=offset;if(item.words)item.words=item.words.map(w=>({...w,start:w.start+offset,end:w.end+offset}));}(p[key]as Array<typeof item>).push(item);}return ids;}
