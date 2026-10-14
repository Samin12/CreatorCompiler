import {clipDuration,clipEffectTiming,makeId,projectDuration,type CursorPoint,type Project} from './types';
const EPS=1e-7;
/** Remove one time interval on every track while retaining source/effect origins. `source` is a plain view of `p` to read from (drafts are slow to scan).
 * With a plain `source`, the rebuilt clips, captions and timed items share nested objects (transform, effects, …) with the previous state:
 * later in the same edit, replace those nested objects rather than mutating them. */
export function cutTimelineRange(p:Project,from:number,to:number,ripple=true,source:Project=p){
 const start=Math.max(0,from),end=Math.min(projectDuration(source),to),length=end-start;
 if(!Number.isFinite(start)||!Number.isFinite(end)||length<=EPS)return;
 const map=(time:number)=>!ripple?time:time<=start?time:time>=end?time-length:start;
 const parts=(s:number,e:number):Array<[number,number]>=>e<=start+EPS||s>=end-EPS?[[s,e]]:[...(s<start-EPS?[[s,start] as [number,number]]:[]),...(e>end+EPS?[[end,e] as [number,number]]:[])];
 p.clips=source.clips.flatMap(c=>{const stop=c.start+clipDuration(c),ranges=parts(c.start,stop),origin=clipEffectTiming(c),affected=c.start<end-EPS&&stop>start+EPS;
  return ranges.map(([s,e],i)=>({...c,id:i===0?c.id:makeId(),start:map(s),sourceIn:c.sourceIn+(s-c.start)*c.speed,sourceOut:c.sourceIn+(e-c.start)*c.speed,...(affected?{effectTiming:{sourceIn:origin.sourceIn,sourceOut:origin.sourceOut}}:{})}));
 });
 p.captions=source.captions.flatMap(c=>{
  if(c.words?.length){const words=c.words.filter(w=>w.end<=start+EPS||w.start>=end-EPS).map(w=>({...w,start:map(w.start),end:map(w.end)}));if(!words.length)return[];
   return[{...c,text:words.map(w=>w.text).join(' '),start:Math.min(map(c.start),words[0].start),end:Math.max(map(c.end),words.at(-1)!.end),words}];
  }
  const ranges=parts(c.start,c.end);return ranges.map(([s,e],i)=>({...c,id:i===0?c.id:makeId(),start:map(s),end:map(e)}));
 });
 // A spanning title/scene/effect stays continuous across a ripple join. With
 // leave-gap deletion, split timed graphics into their surviving pieces.
 const timed=<T extends {id:string;start:number;duration:number}>(items:T[],keepEmpty=false):T[]=>items.flatMap(item=>{
  const finish=item.start+item.duration;
  if(ripple){const duration=Math.max(0,map(finish)-map(item.start));return duration>EPS||keepEmpty?[{...item,start:map(item.start),duration}]:[];}
  return parts(item.start,finish).map(([s,e],i)=>({...item,id:i===0?item.id:makeId(),start:s,duration:e-s}));
 });
 p.scenes=timed(source.scenes,true);p.elements=timed(source.elements);p.zooms=timed(source.zooms);
 const points=[...source.cursor.points].sort((a,b)=>a.time-b.time);
 const pointAt=(time:number):CursorPoint|undefined=>{let index=-1;for(let i=0;i<points.length&&points[i].time<=time;i++)index=i;if(index<0)return undefined;const a=points[index],b=points[index+1];if(!b||a.visible===false||b.visible===false)return {...a,time};const t=(time-a.time)/(b.time-a.time);return {...a,time,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};};
 const left=pointAt(start),right=pointAt(end);p.cursor.points=points.filter(pt=>pt.time<start-EPS||pt.time>=end-EPS).map(pt=>({...pt,time:map(pt.time)}));
 if(ripple&&projectDuration(p)>0){if(left&&start>EPS)p.cursor.points.push({...left,time:Math.max(0,start-1e-6)});if(right)p.cursor.points.push({...right,time:start});p.cursor.points.sort((a,b)=>a.time-b.time);}
}
