import {isDeepStrictEqual as same} from 'node:util';
import {clipDuration,type Clip,type Project} from '../shared/types.js';
import {cutTimelineRange} from '../shared/timeline-edits.js';
import type {BorumiProvenance} from './borumi-provenance.js';

type Row=Record<string,any>;
type Range=[number,number];
const EPS=1e-6;
const close=(a:number,b:number)=>Math.abs(a-b)<=EPS;
const omit=(v:Row,keys:string[])=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
const union=(ranges:Range[]):Range[]=>ranges.sort((a,b)=>a[0]-b[0]).reduce<Range[]>((out,r)=>{
 const last=out.at(-1);if(last&&r[0]<=last[1]+EPS)last[1]=Math.max(last[1],r[1]);else out.push([...r]);return out;
},[]);
function subtract(ranges:Range[],cuts:Range[]):Range[]{return ranges.flatMap(([a,b])=>{
 let p=a;const result:Range[]=[];for(const [s,e] of cuts){if(e<=p+EPS||s>=b-EPS)continue;if(s>p+EPS)result.push([p,Math.min(s,b)]);p=Math.max(p,e);}if(p<b-EPS)result.push([p,b]);return result;
});}
const equalRanges=(a:Range[],b:Range[])=>a.length===b.length&&a.every((r,i)=>close(r[0],b[i][0])&&close(r[1],b[i][1]));
const inertEffects=(c:Clip)=>c.effects.fadeIn===0&&c.effects.fadeOut===0&&!c.effects.normalize&&!c.effects.denoise&&!c.effects.faceCenter&&(c.effects.background??'none')==='none';
const instantTransition=(value:unknown)=>!!value&&['Cut','Instant'].includes(typeof value==='string'?value:(value as Row).kind);
const simpleNative=(k:Row)=>{
 if(k.kind==='VideoClip'&&!instantTransition(k.transition)||k.transition&&!instantTransition(k.transition))return false;
 if(k.freeze_frame||k.crop||k.background||k.color_adjustments||k.face_tracking_mode?.kind==='Auto')return false;
 if(k.noise_cancelling_filter||k.noise_cancelling_mode&&!['Disabled','Off'].includes(k.noise_cancelling_mode.kind)||k.voice_enhancement_filter&&!['Disabled','Off'].includes(k.voice_enhancement_filter.kind))return false;
 return true;
};
interface Piece {clip:Clip;base:Clip;original:Range;}
export interface NativeTimelinePatch {id:string;rows:Row[];}
export interface StructuralTimelinePlan {blockers:string[];warnings:string[];removed:Range[];expected:Project;patches:NativeTimelinePatch[];changes:Array<{kind:string;id:string;fields:string[]}>;}

/** A conservative subset: source-preserving splits and one shared ripple map.
 * Native clip, take, media and opaque fields are never reconstructed or discarded.
 */
export function planStructuralTimeline(project:Project,source:BorumiProvenance,rows:Row[]):StructuralTimelinePlan|null {
 const base=source.baseline;
 const ids=(p:Project)=>p.clips.map(c=>c.id).sort();
 const structural=!same(ids(project),ids(base))||!same(project.scenes.map(s=>[s.start,s.duration]),base.scenes.map(s=>[s.start,s.duration]));
 if(!structural)return null;
 const blockers=new Set<string>(),warnings=new Set<string>(),patches:NativeTimelinePatch[]=[],changes:StructuralTimelinePlan['changes']=[];
 const byId=new Map(base.clips.map(c=>[c.id,c])),pieces=new Map<string,Piece[]>(),native=new Map(rows.map(r=>[r.id,r]));
 if(new Set(project.clips.map(c=>c.id)).size!==project.clips.length)blockers.add('Clip IDs must be unique for compatible timeline editing.');
 for(const c of project.clips){
  let b:Clip|undefined;
  if(c.borumiOriginId!==undefined){
   if(typeof c.borumiOriginId!=='string'||c.borumiOriginId.length>200)blockers.add('Invalid Borumi clip provenance.');
   else b=byId.get(c.borumiOriginId);
   if(byId.has(c.id)&&c.borumiOriginId!==c.id)blockers.add('An existing imported clip cannot change its Borumi origin.');
  }else if(byId.has(c.id))b=byId.get(c.id);
  else{
   // Older imports lack explicit ancestry. Accept only an unambiguous match.
   const candidates=base.clips.filter(b=>b.mediaId===c.mediaId&&b.track===c.track&&close(b.speed,c.speed)&&c.sourceIn>=b.sourceIn-EPS&&c.sourceOut<=b.sourceOut+EPS&&same(omit(c,['id','borumiOriginId','name','start','sourceIn','sourceOut','effectTiming']),omit(b,['id','borumiOriginId','name','start','sourceIn','sourceOut','effectTiming'])));
   if(candidates.length===1)b=candidates[0];else blockers.add('A new clip has missing or ambiguous Borumi origin; reimport before splitting this clip.');
  }
  if(!b){blockers.add('A new clip is not a validated descendant of an imported clip.');continue;}
  if(![c.start,c.sourceIn,c.sourceOut,c.speed,c.gain].every(Number.isFinite)||c.sourceOut<=c.sourceIn||c.sourceIn<b.sourceIn-EPS||c.sourceOut>b.sourceOut+EPS||!close(c.speed,b.speed))blockers.add('Compatible split/delete edits must retain source ranges and playback speed.');
  if(!same(omit(c,['id','borumiOriginId','name','start','sourceIn','sourceOut','effectTiming','gain','effects']),omit(b,['id','borumiOriginId','name','start','sourceIn','sourceOut','effectTiming','gain','effects']))||!same(omit(c.effects,['flipX']),omit(b.effects,['flipX'])))blockers.add('Split/delete export cannot change clip sources, tracks, layers, geometry or effects.');
  if(c.effectTiming&&!same(c.effectTiming,b.effectTiming)){
   const origin=b.effectTiming??{sourceIn:b.sourceIn,sourceOut:b.sourceOut};
   const timing=c.effectTiming;
   if(!inertEffects(c)||![timing.sourceIn,timing.sourceOut].every(Number.isFinite)||timing.sourceIn<origin.sourceIn-EPS||timing.sourceOut>origin.sourceOut+EPS||timing.sourceIn>c.sourceIn+EPS||timing.sourceOut<c.sourceOut-EPS)blockers.add('Extended effect timing cannot be preserved for this split/delete edit.');
  }
  const m=source.mapping.clips[b.id];
  if(c.gain!==b.gain&&(!m||m.kind!=='AudioClip'||c.gain<=0||c.gain>100))blockers.add('Compatible split/delete gain edits require native audio and a positive gain no greater than 100.');
  if(c.effects.flipX!==b.effects.flipX&&m?.kind!=='VideoClip')blockers.add('Horizontal flip requires a native video clip.');
  const original:Range=[b.start+(c.sourceIn-b.sourceIn)/b.speed,b.start+(c.sourceOut-b.sourceIn)/b.speed];
  const list=pieces.get(b.id)??[];list.push({clip:c,base:b,original});pieces.set(b.id,list);
 }
 const av=base.clips.filter(c=>['AudioClip','VideoClip'].includes(source.mapping.clips[c.id]?.kind));
 const covered=union(av.map(b=>[b.start,b.start+clipDuration(b)]));
 const retained=union(av.flatMap(b=>(pieces.get(b.id)??[]).map(p=>p.original)));
 const removed=subtract(covered,retained);
 const map=(time:number)=>time-removed.reduce((sum,[s,e])=>sum+Math.max(0,Math.min(time,e)-s),0);
 const expected=structuredClone(base);for(const [s,e] of [...removed].reverse())cutTimelineRange(expected,s,e,true);
 for(const b of base.clips){
  const ps=(pieces.get(b.id)??[]).sort((a,b)=>a.original[0]-b.original[0]),m=source.mapping.clips[b.id];
  if(!m||!['AudioClip','VideoClip'].includes(m.kind)){
   // Generated backgrounds and native music/overlays require their own timing semantics.
   if(ps.length!==1||!same(omit(ps[0].clip,['borumiOriginId','name']),omit(b,['borumiOriginId','name'])))blockers.add('Split/delete export currently requires untouched generated backgrounds, music and overlays.');
   continue;
  }
  for(let i=1;i<ps.length;i++)if(ps[i].original[0]<ps[i-1].original[1]-EPS)blockers.add('A duplicated or overlapping source interval cannot be exported as a split.');
  const wanted=subtract([[b.start,b.start+clipDuration(b)]],removed),actual=union(ps.map(p=>p.original));
  if(!equalRanges(wanted,actual))blockers.add('Ripple deletion must remove the same time ranges from every overlapping audio/video track.');
  if(ps.some(p=>!close(p.clip.start,map(p.original[0]))||!close(clipDuration(p.clip),map(p.original[1])-map(p.original[0]))))blockers.add('Clip positions do not match a synchronized ripple deletion; moves and gaps are not inferred.');
 }
 if(project.scenes.length!==base.scenes.length||project.scenes.some((s,i)=>s.id!==base.scenes[i].id||!close(s.start,expected.scenes[i].start)||!close(s.duration,expected.scenes[i].duration)))blockers.add('Scene timing must exactly follow the shared ripple deletion.');
 if(expected.scenes.some(s=>s.duration<=EPS))blockers.add('Deleting an entire native scene is not supported by split/delete copy export.');
 // The native scene derives its end from AV, not a stored duration.
 for(const s of project.scenes){const nativeId=source.mapping.scenes[s.id];const cs=[...pieces.values()].flat().filter(p=>source.mapping.clips[p.base.id]?.sceneId===nativeId&&['AudioClip','VideoClip'].includes(source.mapping.clips[p.base.id]?.kind));if(!close(Math.max(s.start,...cs.map(p=>p.clip.start+clipDuration(p.clip))),s.start+s.duration))blockers.add('The edited native scene must end at its final audio/video clip.');}
 const groups=new Map<string,Piece[]>();for(const [id,ps] of pieces){const m=source.mapping.clips[id];if(m&&['AudioClip','VideoClip'].includes(m.kind)){const group=groups.get(m.segmentId)??[];group.push(...ps);groups.set(m.segmentId,group);}}
 const originalGroups=new Map<string,Clip[]>();for(const b of av){const id=source.mapping.clips[b.id].segmentId;const group=originalGroups.get(id)??[];group.push(b);originalGroups.set(id,group);}
 for(const [id,bs] of originalGroups){
  const row=native.get(id);if(!row){blockers.add('A native source segment is missing from the preserved snapshot.');continue;}
  const ps=(groups.get(id)??[]).sort((a,b)=>a.original[0]-b.original[0]),k=JSON.parse(row.kind),scene=base.scenes.find(s=>source.mapping.scenes[s.id]===row.scene_id)!;
  const newScene=project.scenes.find(s=>s.id===scene?.id);if(!scene||!newScene)continue;
  const unchanged=ps.length===bs.length&&ps.every(p=>p.clip.id===p.base.id&&close(p.clip.start-newScene.start,p.base.start-scene.start)&&close(p.clip.sourceIn,p.base.sourceIn)&&close(p.clip.sourceOut,p.base.sourceOut)&&p.clip.gain===p.base.gain&&p.clip.effects.flipX===p.base.effects.flipX);
  if(unchanged)continue;
  const merged:Piece[]=[];
  for(const [index,p] of ps.entries()){const last=merged.at(-1);if(last&&ps[index-1].base.id!==p.base.id&&close(last.original[1],p.original[0])&&close(last.clip.start+clipDuration(last.clip),p.clip.start)&&close(last.clip.sourceOut,p.clip.sourceIn)&&last.clip.gain===p.clip.gain&&last.clip.effects.flipX===p.clip.effects.flipX){last.original[1]=p.original[1];last.clip.sourceOut=p.clip.sourceOut;}
   else merged.push({...p,clip:structuredClone(p.clip),original:[...p.original]});}
  const cut=merged.length!==1||!close(merged[0]?.original[0]??0,scene.start+Number(row.start))||!close(merged[0]?.original[1]??0,Math.max(...bs.map(b=>b.start+clipDuration(b))));
  if(merged.length&&cut&&!simpleNative(k))blockers.add(`Splitting or trimming native ${k.kind} with transitions, tracking or processing effects is not yet verified; those settings are retained, not discarded.`);
  const replacements=merged.map((p,i)=>{
   const value=structuredClone(k);value.clip_start=Number(k.clip_start??0)+(p.original[0]-scene.start-Number(row.start))*p.base.speed;
   if(p.clip.gain!==p.base.gain)value.volume_filter=20*Math.log10(p.clip.gain);
   if(p.clip.effects.flipX!==p.base.effects.flipX)value.mirrored=p.clip.effects.flipX;
   return {...row,id:i===0?id:null,start:p.clip.start-newScene.start,duration:clipDuration(p.clip),kind:JSON.stringify(value),edited:1};
  });
  patches.push({id,rows:replacements});changes.push({kind:'native-timeline',id,fields:replacements.length?'split/source-range/timing'.split('/'):['delete']});
 }
 if(removed.length){
  warnings.add('Ripple deletion is supported only when every overlapping audio/video track follows the same cut map. Native static instant layouts are retimed; unsupported timed controls block export.');
  for(const row of rows){const k=JSON.parse(row.kind);
   if(['VideoClip','AudioClip'].includes(k.kind)){
    if(!originalGroups.has(row.id))blockers.add('A native audio/video segment was not fully imported; its ripple timing cannot be verified.');
    continue;
   }
   const scene=base.scenes.find(s=>source.mapping.scenes[s.id]===row.scene_id),next=project.scenes.find(s=>s.id===scene?.id);if(!scene||!next)continue;
   const begin=scene.start+Number(row.start),end=row.duration==null?scene.start+scene.duration:begin+Number(row.duration);
   const start=map(begin)-next.start,duration=map(end)-map(begin);
   if(close(start,Number(row.start))&&(row.duration==null||close(duration,Number(row.duration))))continue;
   if(k.kind!=='Layout'||!instantTransition(k.transition)){
    blockers.add(`Ripple editing through native ${k.kind} timing is not verified and cannot be exported yet.`);continue;
   }
   patches.push({id:row.id,rows:duration<=EPS?[]:[{...row,start,duration:row.duration==null?null:duration,edited:1}]});
  }
 }
 return {blockers:[...blockers],warnings:[...warnings],removed,expected,patches,changes};
}
