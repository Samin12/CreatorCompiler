import {clipDuration,clipEffectTiming,projectDuration,makeId,type Project,type Clip} from '../shared/types.js';
import {cutTimelineRange} from '../shared/timeline-edits.js';
export interface SceneScope {id:string;name:string;start:number;end:number}
export function sceneScope(p:Project,id:string):SceneScope{
 const s=p.scenes.find(s=>s.id===id);
 if(!s)throw Error('This scene no longer exists. Reopen the action for a current scene.');
 if(!Number.isFinite(s.start)||!Number.isFinite(s.duration)||s.duration<=0)throw Error('Record or import footage into this scene first.');
 const end=s.start+s.duration;
 if(p.scenes.some(other=>other.id!==id&&other.duration>0&&other.start<end-1e-7&&other.start+other.duration>s.start+1e-7))throw Error('Scenes overlap. Separate their boundaries before editing one scene.');
 return {id:s.id,name:s.name,start:s.start,end};
}
/** Planning keeps absolute times but only exposes this scene's media intervals. */
export function scenePlanningProject(p:Project,scope:SceneScope,wholeWordsOnly=false):Project{
 const q=structuredClone(p),a=scope.start,b=scope.end;
 q.scenes=q.scenes.filter(s=>s.id===scope.id);
 q.clips=q.clips.flatMap(c=>{const start=Math.max(a,c.start),end=Math.min(b,c.start+clipDuration(c));if(end<=start+1e-7)return[];return[{...c,start,sourceIn:c.sourceIn+(start-c.start)*c.speed,sourceOut:c.sourceIn+(end-c.start)*c.speed}];});
 const mediaIds=new Set(q.clips.map(c=>c.mediaId));q.media=q.media.filter(m=>mediaIds.has(m.id));
 q.captions=q.captions.flatMap(c=>{const start=Math.max(a,c.start),end=Math.min(b,c.end);if(end<=start+1e-7)return[];if(!c.words?.length)return[{...c,start,end}];const words=c.words.filter(w=>wholeWordsOnly?w.start>=a-1e-7&&w.end<=b+1e-7:w.start<b-1e-7&&w.end>a+1e-7).map(w=>({...w,start:Math.max(a,w.start),end:Math.min(b,w.end)}));return words.length?[{...c,start:words[0].start,end:words.at(-1)!.end,text:words.map(w=>w.text).join(' '),words}]:[];});
 q.elements=q.elements.filter(e=>e.start<b&&e.start+e.duration>a);q.zooms=q.zooms.filter(e=>e.start<b&&e.start+e.duration>a);q.cursor.points=q.cursor.points.filter(pt=>pt.time>=a&&pt.time<=b);delete q.recordedTakes;
 return q;
}
/** Ripple only reviewed intervals, preserving the original phase of surviving zooms. */
export function scopedCutProject(project:Project,cuts:number[][]):Project{
 const p=structuredClone(project),duration=projectDuration(p),ranges:Array<[number,number]>=[];
 for(const range of cuts){if(range.length!==2||!range.every(Number.isFinite)||range[0]<0||range[1]<=range[0])throw Error('Cuts must be finite positive [start,end] intervals.');}
 for(const [a,b] of [...cuts].sort((a,b)=>a[0]-b[0])){
  const start=Math.min(a,duration),end=Math.min(b,duration);if(end-start<=1e-7)continue;
  const last=ranges.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else ranges.push([start,end]);
 }
 for(const [start,end] of ranges.reverse()){
  const length=end-start,map=(t:number)=>t<=start?t:t>=end?t-length:start;
  const zooms=p.zooms,captions=p.captions;
  cutTimelineRange(p,start,end,true);
  // Preserve manually formatted text and metadata outside the cut. Only timing
  // shifts there; the shared word-level operation handles intersecting captions.
  const untouched=new Map(captions.filter(c=>c.end<=start+1e-7||c.start>=end-1e-7).map(c=>[c.id,c]));
  p.captions=p.captions.map(c=>{const old=untouched.get(c.id);return old?{...old,start:map(old.start),end:map(old.end),...(old.words?{words:old.words.map(w=>({...w,start:map(w.start),end:map(w.end)}))}:{})}:c;});
  p.zooms=zooms.flatMap(z=>{
   const finish=z.start+z.duration;
   if(finish<=start+1e-7||z.start>=end-1e-7)return[{...z,start:map(z.start)}];
   const pieces:Array<[number,number]>=[...(z.start<start-1e-7?[[z.start,start] as [number,number]]:[]),...(finish>end+1e-7?[[end,finish] as [number,number]]:[])];
   const offset=z.effectTiming?.offset??0,originalDuration=z.effectTiming?.duration??z.duration;
   return pieces.map(([a,b],i)=>({...z,id:i===0?z.id:makeId(),start:map(a),duration:b-a,effectTiming:{offset:offset+a-z.start,duration:originalDuration}}));
  });
 }
 return p;
}
/** Split at scene edges before a scoped layout; outside pieces retain all styling. */
export function splitClipForScene(c:Clip,scope:Pick<SceneScope,'start'|'end'>):Array<{clip:Clip;inside:boolean}>{
 const stop=c.start+clipDuration(c),a=Math.max(c.start,scope.start),b=Math.min(stop,scope.end);
 if(b<=a+1e-7)return[{clip:c,inside:false}];
 const edges=[c.start,...(a>c.start+1e-7?[a]:[]),...(b<stop-1e-7?[b]:[]),stop],origin=clipEffectTiming(c);
 return edges.slice(0,-1).map((start,i)=>{const end=edges[i+1];return{inside:start>=scope.start-1e-7&&end<=scope.end+1e-7,clip:{...c,id:i===0?c.id:globalThis.crypto.randomUUID(),start,sourceIn:c.sourceIn+(start-c.start)*c.speed,sourceOut:c.sourceIn+(end-c.start)*c.speed,...(edges.length>2?{effectTiming:{sourceIn:origin.sourceIn,sourceOut:origin.sourceOut}}:{})}};});
}
