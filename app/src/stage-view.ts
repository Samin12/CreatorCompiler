import {clipDuration,type Clip,type CursorPoint,type Project,type Transform} from '../shared/types';
import {clipCompositeOrder,clipLayerRowId} from '../shared/timeline-layers';
import {clipShadowCss} from '../shared/clip-shadow';

/** Per-project stage layout: each clip's timeline row, its stable composite rank, and its chain on the row: contiguous
 * same-source cuts (a split) share a playback key, so a single media element plays straight through the edit. */
export interface StageIndex {clips:readonly Clip[];row:Map<Clip,string>;key:Map<Clip,string>;previous:Map<Clip,Clip>;rank:Map<Clip,number>}
const near=(a:number,b:number)=>Math.abs(a-b)<1e-6;
const continues=(a:Clip,b:Clip)=>a.mediaId===b.mediaId&&a.track===b.track&&a.speed===b.speed&&near(a.start+clipDuration(a),b.start)&&near(a.sourceOut,b.sourceIn);
export function stageIndex(project:Project):StageIndex{
 const row=new Map<Clip,string>(),key=new Map<Clip,string>(),previous=new Map<Clip,Clip>(),order=new Map<Clip,number>(),lanes=new Map<string,Clip[]>();
 for(const clip of project.clips){const id=clipLayerRowId(clip,project);row.set(clip,id);order.set(clip,clipCompositeOrder(clip,project));const lane=lanes.get(id);if(lane)lane.push(clip);else lanes.set(id,[clip]);}
 for(const lane of lanes.values()){let last:Clip|undefined;for(const clip of lane.sort((a,b)=>a.start-b.start)){if(last&&continues(last,clip)){previous.set(clip,last);key.set(clip,key.get(last)!);}else key.set(clip,clip.id);last=clip;}}
 // Ties keep project order, exactly like the stable sort of the clips under the playhead.
 const rank=new Map([...project.clips].sort((a,b)=>order.get(a)!-order.get(b)!).map((clip,index)=>[clip,index]));
 return {clips:project.clips,row,key,previous,rank};
}

export interface StageSlot {clip:Clip;key:string;visible:boolean}
/** Clips under the playhead, plus at most one upcoming clip per row inside the look-ahead, mounted early so its media
 * is loaded and pre-seeked before the cut. `mounted` maps clip ids to the keys of the last commit: a clip already on
 * stage keeps its element through any edit, and a newly shown clip takes over its chain predecessor's element. */
export function stageSlots(index:StageIndex,time:number,lookAhead=0,mounted:ReadonlyMap<string,string>=new Map()):StageSlot[]{
 const active:Clip[]=[],next=new Map<string,Clip>();
 for(const clip of index.clips){
  const start=clip.start,end=start+clipDuration(clip);
  if(time>=start&&time<end)active.push(clip);
  else if(start>time&&start<=time+lookAhead&&end>start){const row=index.row.get(clip)??'',current=next.get(row);if(!current||start<current.start)next.set(row,clip);}
 }
 const slots:StageSlot[]=[],used=new Set<string>(),chain=(clip:Clip)=>{const before=index.previous.get(clip);return (before&&mounted.get(before.id))??index.key.get(clip)??clip.id;};
 const take=(clip:Clip,key:string,visible:boolean)=>{if(used.has(key))key=used.has(clip.id)?`${clip.id}~`:clip.id;used.add(key);slots.push({clip,key,visible});};
 for(const clip of active){const key=mounted.get(clip.id);if(key!==undefined)take(clip,key,true);}
 for(const clip of active)if(!mounted.has(clip.id))take(clip,chain(clip),true);
 // An upcoming clip that continues an active one needs no pre-roll: it will inherit that element at the cut.
 for(const clip of next.values()){const key=mounted.get(clip.id)??chain(clip);if(!used.has(key))take(clip,key,false);}
 return slots;
}

/** Every writer keeps cursor points sorted, so the point at a time is a binary search; an unsorted list keeps the last-match scan. */
export function cursorPointLookup(points:readonly CursorPoint[]):(time:number)=>CursorPoint|undefined{
 for(let i=1;i<points.length;i++)if(!(points[i].time>=points[i-1].time))return time=>{for(let j=points.length-1;j>=0;j--)if(points[j].time<=time)return points[j];return undefined;};
 return time=>{let low=0,high=points.length;while(low<high){const middle=(low+high)>>1;if(points[middle].time<=time)low=middle+1;else high=middle;}return low?points[low-1]:undefined;};
}

/** Identity functions are left out, so a neutral layer composites without an offscreen filter pass. Order and the drop-shadow are unchanged. */
export function clipFilterCss(effects:Clip['effects'],transform:Transform,pixelScale:number):string{
 const blur=effects.blur*pixelScale,parts=[effects.brightness!==0&&`brightness(${1+effects.brightness})`,effects.contrast!==1&&`contrast(${effects.contrast})`,effects.saturation!==1&&`saturate(${effects.saturation})`,blur!==0&&`blur(${blur}px)`,effects.grayscale&&'grayscale(1)'].filter(Boolean).join(' ');
 return (parts+clipShadowCss(transform,pixelScale)).trim()||'none';
}
