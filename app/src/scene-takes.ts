import {clipDuration,defaultEffects,defaultTransform,makeId,narrationPriority,type Clip,type Project,type RecordedTake} from '../shared/types';
import {creatorCameraTransform,creatorScreenTransform} from '../shared/camera-style';
import {plainClone} from './project-draft';
export type TakeConfirmMode='replace-matching'|'keep-both'|'record-over';
const EPS=1e-7;
const role=(c:Clip,p:Project)=>c.track==='audio'?`audio:${c.audioRole??p.media.find(m=>m.id===c.mediaId)?.audioRole??'unknown'}`:c.track;
const relative=(c:Clip,start:number)=>({...plainClone(c),start:Math.max(0,c.start-start)});
const captureIdentity=(t:RecordedTake)=>JSON.stringify({sceneId:t.sceneId,media:t.media.map(m=>({id:m.id,path:m.path,duration:m.duration,audioRole:m.audioRole})),tracks:t.tracks,offsets:t.offsets});
export function saveProjectTake(p:Project,t:RecordedTake):RecordedTake {
 if(!t.id||!t.createdAt||!p.scenes.some(s=>s.id===t.sceneId))throw Error('This recording scene no longer exists. Keep the saved take and choose its scene again.');
 if(!Array.isArray(t.media)||!t.media.length||t.media.length>8||t.tracks.length!==t.media.length||t.offsets.length!==t.media.length||t.media.some(m=>!m.id||!m.path||!Number.isFinite(m.duration)||m.duration<=0)||t.offsets.some(n=>!Number.isFinite(n)||n<0)||t.tracks.some(k=>!['screen','camera','audio','music','overlay'].includes(k)))throw Error('The saved take has invalid sources or timing.');
 if(t.clipIds&&(t.clipIds.length!==t.media.length||new Set(t.clipIds).size!==t.clipIds.length||t.clipIds.some(id=>typeof id!=='string'||!id)))throw Error('The saved take has invalid clip identities.');
 const existing=p.recordedTakes?.find(a=>a.id===t.id);if(existing){if(captureIdentity(existing)!==captureIdentity(t))throw Error('This take identity already belongs to different recording sources.');return existing;}
 const ids=new Set<string>();for(const m of t.media){if(ids.has(m.id))throw Error('A take cannot contain the same source media twice.');ids.add(m.id);const old=p.media.find(x=>x.id===m.id);if(old&&(old.path!==m.path||old.kind!==m.kind||old.duration!==m.duration))throw Error('A recording source identity conflicts with existing media.');}
 const saved=plainClone(t);delete saved.timeline;delete saved.installedRoles;delete saved.confirmedAt;
 const existingClips=t.clipIds?.map(id=>p.clips.find(c=>c.id===id))??[];
 if(existingClips.some(Boolean)){
  if(existingClips.some(c=>!c))throw Error('Part of this saved take is already on the timeline. Review its clips before recovering it.');
  const clips=existingClips as Clip[],scene=p.scenes.find(s=>s.id===t.sceneId)!,base=clips[0].start-t.offsets[0];
  if(base<scene.start-EPS||clips.some((c,i)=>c.recordingTakeId&&c.recordingTakeId!==t.id||c.mediaId!==t.media[i].id||c.track!==t.tracks[i]||Math.abs(c.start-base-t.offsets[i])>EPS||c.sourceIn!==0||Math.abs(c.sourceOut-t.media[i].duration)>EPS||c.speed!==1||c.start+clipDuration(c)>scene.start+scene.duration+EPS))throw Error('Existing clip identities do not match this recovered recording. Keep its recovery copy and review the timeline.');
  saved.confirmedAt=new Date().toISOString();saved.retained=true;saved.installedRoles=[...new Set(clips.map(c=>role(c,p)))];saved.timeline={start:base-scene.start,duration:Math.max(...clips.map(c=>c.start+clipDuration(c)))-base,clips:clips.map(c=>({...relative(c,scene.start),recordingTakeId:t.id})),captions:[]};
 }
 p.recordedTakes=[...(p.recordedTakes??[]),saved];if(saved.confirmedAt)for(const c of existingClips)c!.recordingTakeId=t.id;for(const m of t.media)if(!p.media.some(x=>x.id===m.id))p.media.push(plainClone(m));return saved;
}
export function sceneTakes(p:Project,sceneId:string){return(p.recordedTakes??[]).filter(t=>t.sceneId===sceneId).map(t=>{
 const clips=p.clips.filter(c=>c.recordingTakeId===t.id),active=new Set(clips.map(c=>role(c,p))),all=new Set(t.timeline?.clips.map(c=>role(c,p))??[]);
 return {...t,activeClipCount:clips.length,state:!clips.length?(t.confirmedAt||t.retained?'archived':'saved'):active.size<all.size?'partial':'active'} as RecordedTake&{activeClipCount:number;state:'saved'|'active'|'partial'|'archived'};
});}
function initialize(p:Project,t:RecordedTake){if(t.timeline)return;const composed=t.tracks.includes('screen')&&t.tracks.includes('camera');t.clipIds??=t.media.map(()=>makeId());t.timeline={duration:Math.max(...t.media.map((m,i)=>m.duration+t.offsets[i])),captions:[],clips:t.media.map((m,i)=>({id:t.clipIds![i],mediaId:m.id,name:m.name,track:t.tracks[i],...(m.audioRole?{audioRole:m.audioRole}:{}),recordingTakeId:t.id,start:t.offsets[i],sourceIn:0,sourceOut:m.duration,speed:1,gain:1,muted:false,effects:defaultEffects(),transform:composed&&t.tracks[i]==='camera'?creatorCameraTransform(p.canvas):composed&&t.tracks[i]==='screen'?creatorScreenTransform(p.canvas):defaultTransform()}))};}
function snapshot(p:Project,sceneId:string,start:number){for(const t of p.recordedTakes??[]){if(t.sceneId!==sceneId||!t.timeline)continue;const live=p.clips.filter(c=>c.recordingTakeId===t.id),roles=new Set(t.installedRoles??live.map(c=>role(c,p)));t.timeline.clips=[...t.timeline.clips.filter(c=>!roles.has(role(c,p))),...live.map(c=>relative(c,start))];t.timeline.duration=Math.max(0,Math.max(0,...t.timeline.clips.map(c=>c.start+clipDuration(c)))-(t.timeline.start??0));}}
function applyTake(p:Project,sceneId:string,id:string,mode:TakeConfirmMode){
 if(!['replace-matching','keep-both','record-over'].includes(mode))throw Error('Unknown take confirmation mode.');
 const scene=p.scenes.find(s=>s.id===sceneId),take=p.recordedTakes?.find(t=>t.id===id&&t.sceneId===sceneId);if(!scene||!take)throw Error('This saved take or scene no longer exists.');
 const index=p.scenes.indexOf(scene),start=scene.start,end=start+scene.duration;
 const overlaps=(c:Clip)=>c.start<end-EPS&&c.start+clipDuration(c)>start+EPS;
 const inside=(c:Clip)=>c.start>=start-EPS&&c.start+clipDuration(c)<=end+EPS;
 for(const media of take.media)if(!p.media.some(m=>m.id===media.id))p.media.push(plainClone(media));
 initialize(p,take);snapshot(p,sceneId,start);
 const target=take.timeline!,placement=mode==='keep-both'?scene.duration:0,placementDelta=placement-(target.start??0);target.clips=target.clips.map(c=>({...c,start:c.start+placementDelta}));target.captions=target.captions.map(c=>({...c,start:c.start+placementDelta,end:c.end+placementDelta,words:c.words?.map(w=>({...w,start:w.start+placementDelta,end:w.end+placementDelta}))}));target.start=placement;
 const roles=new Set(target.clips.map(c=>role(c,p))),replace=mode==='replace-matching',inScene=p.clips.filter(overlaps);
 if(!target.clips.length)throw Error('This take has no remaining saved clips to activate.');
 if(replace&&inScene.some(c=>role(c,p)==='audio:unknown')&&[...roles].some(r=>r==='audio:microphone'||r==='audio:system'))throw Error('Legacy audio has no microphone/system role. Assign its source role or use Keep both before replacing it.');
 const removed=p.clips.filter(c=>c.recordingTakeId===id||(replace&&overlaps(c)&&roles.has(role(c,p))));
 if(removed.some(c=>!inside(c)))throw Error('A matching source crosses this scene boundary. Split it at the boundary before replacing takes.');
 if(replace&&roles.has('screen')&&p.cursor.enabled&&p.cursor.points.length)throw Error('This project has a recorded cursor path. Use Keep both; cursor retake remapping is not supported yet.');
 const legacy=removed.filter(c=>!c.recordingTakeId);
 if(legacy.length){const archivedId=makeId(),media=[...new Set(legacy.map(c=>c.mediaId))].map(id=>p.media.find(m=>m.id===id)!);p.recordedTakes!.push({id:archivedId,sceneId,createdAt:new Date().toISOString(),name:'Previous scene footage',media:plainClone(media),tracks:media.map(m=>legacy.find(c=>c.mediaId===m.id)!.track),offsets:media.map(()=>0),confirmedAt:new Date().toISOString(),timeline:{duration:scene.duration,clips:legacy.map(c=>({...relative(c,start),recordingTakeId:archivedId})),captions:[]},installedRoles:[]});for(const c of legacy)c.recordingTakeId=archivedId;}
 const removedIds=new Set(removed.map(c=>c.id));
 const captions=removeTakeCaptions(p,removedIds,start,end);
 const remaining=inScene.filter(c=>!removedIds.has(c.id)),oldContentEnd=Math.max(start,...inScene.filter(inside).map(c=>c.start+clipDuration(c))),trailing=inScene.length?Math.max(0,end-oldContentEnd):0;
 const length=Math.max(0,...remaining.filter(inside).map(c=>c.start-start+clipDuration(c)),...target.clips.map(c=>c.start+clipDuration(c)))+trailing,duration=replace?length:Math.max(scene.duration,length),newEnd=start+duration,delta=duration-scene.duration;
 if(Math.abs(delta)>EPS){
  if(p.clips.some(c=>!removedIds.has(c.id)&&c.start<end-EPS&&c.start+clipDuration(c)>end+EPS))throw Error('A clip crosses the scene end. Split it before changing take duration.');
  if(captions.some(c=>c.start<end-EPS&&c.end>Math.min(end,newEnd)+EPS))throw Error('A caption would cross the changed scene boundary. Move or split it before switching takes.');
  for(const key of ['elements','zooms']as const)if(p[key].some(e=>e.start<end-EPS&&e.start+e.duration>Math.min(end,newEnd)+EPS))throw Error('A graphic or zoom crosses the changed scene boundary. Move or shorten it before switching takes.');
  if(p.cursor.points.some(c=>c.time>=Math.min(end,newEnd)-EPS&&c.time<end-EPS))throw Error('Cursor events would be lost by this shorter take. Use Keep both or adjust the scene first.');
  if(p.scenes.slice(index+1).some(s=>s.start<end-EPS))throw Error('Scenes overlap. Separate their boundaries before switching takes.');
 }
 const shift=(n:number)=>n>=end-EPS?n+delta:n;
 p.clips=p.clips.filter(c=>!removedIds.has(c.id)).map(c=>({...c,start:shift(c.start)}));const used=new Set(p.clips.map(c=>c.id));if(target.clips.some(c=>used.has(c.id)))throw Error('A saved clip identity is already used elsewhere. Resolve it before switching takes.');
 p.clips.push(...target.clips.map(c=>({...plainClone(c),start:start+c.start,recordingTakeId:id})));
 p.captions=captions.map(c=>{const offset=c.start>=end-EPS?delta:0;return {...c,start:c.start+offset,end:c.end+offset,words:c.words?.map(w=>({...w,start:w.start+offset,end:w.end+offset}))};});
 if(target.captions.length){const ids=new Set(p.captions.map(c=>c.id));for(const c of target.captions){if(ids.has(c.id))throw Error('A saved transcript identity is already used elsewhere.');p.captions.push({...plainClone(c),start:start+c.start,end:start+c.end,words:c.words?.map(w=>({...w,start:start+w.start,end:start+w.end}))});}}
 for(const key of ['elements','zooms']as const)for(const item of p[key])item.start=shift(item.start);for(const point of p.cursor.points)point.time=shift(point.time);for(const later of p.scenes.slice(index+1))later.start+=delta;scene.duration=duration;
 for(const old of p.recordedTakes??[])if(old.sceneId===sceneId&&old.id!==id&&replace)old.installedRoles=(old.installedRoles??[]).filter(r=>!roles.has(r));take.installedRoles=[...roles];take.confirmedAt??=new Date().toISOString();take.retained=true;
 return {start:start+placement,nextSceneId:sceneId};
}
/** Apply inside one studio.change; failures leave even source/archive metadata untouched. */
export function activateSceneTake(p:Project,sceneId:string,id:string,mode:TakeConfirmMode='replace-matching'){const draft=plainClone(p),result=applyTake(draft,sceneId,id,mode);Object.assign(p,draft);return result;}
export function confirmDurableTake(p:Project,input:Pick<RecordedTake,'media'|'tracks'|'offsets'|'sceneId'|'clipIds'>&{id:string;createdAt?:string;mode?:TakeConfirmMode}){
 const current=p.recordedTakes?.find(t=>t.id===input.id);if(current?.confirmedAt&&p.clips.some(c=>c.recordingTakeId===input.id)){const scene=p.scenes.find(s=>s.id===input.sceneId);if(!scene)throw Error('The recording scene no longer exists.');return {start:scene.start+(current.timeline?.start??0),nextSceneId:scene.id};}
 const draft=plainClone(p);if(!current)saveProjectTake(draft,{...input,createdAt:input.createdAt??new Date().toISOString()});const result=applyTake(draft,input.sceneId,input.id,input.mode??'replace-matching');Object.assign(p,draft);return result;
}

function archiveInPlace(p:Project,id:string){
 const take=p.recordedTakes?.find(t=>t.id===id);if(!take)throw Error('This saved take no longer exists.');const scene=p.scenes.find(s=>s.id===take.sceneId);if(!scene)throw Error('This recording scene no longer exists.');
 const start=scene.start,end=start+scene.duration,live=p.clips.filter(c=>c.recordingTakeId===id);if(!live.length){take.retained=true;take.installedRoles=[];return {start,nextSceneId:scene.id};}
 if(live.some(c=>c.start<start-EPS||c.start+clipDuration(c)>end+EPS))throw Error('This take has clips outside its scene. Move or split them before archiving.');
 snapshot(p,scene.id,start);
 const inScene=p.clips.filter(c=>c.start>=start-EPS&&c.start+clipDuration(c)<=end+EPS);
 p.captions=removeTakeCaptions(p,new Set(live.map(c=>c.id)),start,end);
 const oldLast=Math.max(start,...inScene.map(c=>c.start+clipDuration(c))),last=Math.max(start,...inScene.filter(c=>c.recordingTakeId!==id).map(c=>c.start+clipDuration(c))),duration=last-start+Math.max(0,end-oldLast),newEnd=start+duration,delta=duration-scene.duration;
 if(Math.abs(delta)>EPS){
  if(p.clips.some(c=>c.recordingTakeId!==id&&c.start<end-EPS&&c.start+clipDuration(c)>end+EPS))throw Error('A clip crosses this scene end. Split it before archiving the take.');
  if(p.captions.some(c=>c.start<end-EPS&&c.end>newEnd+EPS))throw Error('A caption extends beyond the remaining take. Move it before archiving.');
  for(const key of ['elements','zooms']as const)if(p[key].some(e=>e.start<end-EPS&&e.start+e.duration>newEnd+EPS))throw Error('A graphic or zoom extends beyond the remaining take. Move it before archiving.');
  if(p.cursor.points.some(c=>c.time>=newEnd-EPS&&c.time<end-EPS))throw Error('Cursor events would be lost. Adjust them before archiving this take.');
 }
 const shift=(n:number)=>n>=end-EPS?n+delta:n;p.clips=p.clips.filter(c=>c.recordingTakeId!==id).map(c=>({...c,start:shift(c.start)}));p.captions=p.captions.map(c=>{const offset=c.start>=end-EPS?delta:0;return {...c,start:c.start+offset,end:c.end+offset,words:c.words?.map(w=>({...w,start:w.start+offset,end:w.end+offset}))};});for(const key of ['elements','zooms']as const)for(const e of p[key])e.start=shift(e.start);for(const c of p.cursor.points)c.time=shift(c.time);for(const later of p.scenes.slice(p.scenes.indexOf(scene)+1)){if(later.start<end-EPS)throw Error('Scenes overlap. Separate their boundaries before archiving.');later.start+=delta;}scene.duration=duration;take.installedRoles=[];take.confirmedAt??=new Date().toISOString();return {start,nextSceneId:scene.id};
}
export function archiveSceneTake(p:Project,id:string){const draft=plainClone(p),result=archiveInPlace(draft,id);Object.assign(p,draft);return result;}
/** Removes the project entry only. Assets and their global catalog entries are never deleted. */
export function deleteSceneTake(p:Project,id:string){const draft=plainClone(p),result=archiveInPlace(draft,id);draft.recordedTakes=draft.recordedTakes!.filter(t=>t.id!==id);Object.assign(p,draft);return result;}
export function moveSceneTake(p:Project,id:string,destinationSceneId:string,archive=false){const draft=plainClone(p),take=draft.recordedTakes?.find(t=>t.id===id);if(!take||!draft.scenes.some(s=>s.id===destinationSceneId))throw Error('Choose an existing destination scene.');if(take.sceneId===destinationSceneId)return {start:draft.scenes.find(s=>s.id===destinationSceneId)!.start,nextSceneId:destinationSceneId};archiveInPlace(draft,id);take.sceneId=destinationSceneId;const result=archive?{start:draft.scenes.find(s=>s.id===destinationSceneId)!.start,nextSceneId:destinationSceneId}:applyTake(draft,destinationSceneId,id,'keep-both');Object.assign(p,draft);return result;}

/** Sync moves the real source clips. Rejected operations leave the entire project unchanged. */
export function updateSceneTake(p:Project,id:string,patch:{name?:string;offsets?:number[]}){
 const draft=plainClone(p),take=draft.recordedTakes?.find(t=>t.id===id);if(!take)throw Error('This saved take no longer exists.');
 if(Object.hasOwn(patch,'name')){if(patch.name===undefined||typeof patch.name==='string'&&!patch.name.trim())delete take.name;else{if(typeof patch.name!=='string'||patch.name.length>120)throw Error('Take names must contain at most 120 characters.');take.name=patch.name.trim();}}
 if(patch.offsets!==undefined){
  if(!Array.isArray(patch.offsets)||patch.offsets.length!==take.media.length||patch.offsets.some(n=>!Number.isFinite(n)||n<0||n>86400))throw Error('Source offsets must be nonnegative seconds for every captured source.');
  const scene=draft.scenes.find(s=>s.id===take.sceneId);if(!scene)throw Error('This recording scene no longer exists.');const start=scene.start,end=start+scene.duration,live=draft.clips.filter(c=>c.recordingTakeId===id);
  if(live.some(c=>c.start<start-EPS||c.start+clipDuration(c)>end+EPS))throw Error('This take has clips outside its scene. Move them before changing sync.');
  snapshot(draft,scene.id,start);const deltas=new Map(take.media.map((m,i)=>[m.id,patch.offsets![i]-take.offsets[i]])),deltaFor=(c:Clip)=>deltas.get(c.mediaId)??0;
  const primary=(live.length?live:take.timeline?.clips??[]).filter(c=>{const m=draft.media.find(m=>m.id===c.mediaId);return(m?.hasAudio||m?.kind==='audio')&&!c.muted&&c.gain>0;}).sort((a,b)=>narrationPriority(a,draft.media.find(m=>m.id===a.mediaId))-narrationPriority(b,draft.media.find(m=>m.id===b.mediaId)))[0],narrationDelta=primary?deltaFor(primary):0;
  if(take.timeline){if(take.timeline.clips.some(c=>c.start+deltaFor(c)<(take.timeline!.start??0)-EPS))throw Error('This sync change moves an edited clip before the take start. Adjust its trim first.');take.timeline.clips=take.timeline.clips.map(c=>({...c,start:Math.max(take.timeline!.start??0,c.start+deltaFor(c))}));take.timeline.duration=Math.max(0,Math.max(0,...take.timeline.clips.map(c=>c.start+clipDuration(c)))-(take.timeline.start??0));}
  const sceneCaptions=draft.captions.filter(c=>c.start<end-EPS&&c.end>start+EPS);
  if(narrationDelta&&live.length&&sceneCaptions.length){const otherAudio=draft.clips.some(c=>c.recordingTakeId!==id&&c.start<end-EPS&&c.start+clipDuration(c)>start+EPS&&!c.muted&&c.gain>0&&(draft.media.find(m=>m.id===c.mediaId)?.hasAudio||draft.media.find(m=>m.id===c.mediaId)?.kind==='audio'));if(otherAudio||sceneCaptions.some(c=>c.start<start-EPS||c.end>end+EPS||c.start+narrationDelta<start-EPS))throw Error('This narration sync change has ambiguous or crossing captions. Adjust the transcript first.');for(const c of sceneCaptions){c.start+=narrationDelta;c.end+=narrationDelta;if(c.words)for(const w of c.words){w.start+=narrationDelta;w.end+=narrationDelta;}}if(take.timeline)take.timeline.captions=sceneCaptions.map(c=>({...plainClone(c),start:c.start-start,end:c.end-start,words:c.words?.map(w=>({...w,start:w.start-start,end:w.end-start}))}));}
  if(!live.length&&take.timeline&&narrationDelta){if(take.timeline.captions.some(c=>c.start+narrationDelta<(take.timeline!.start??0)-EPS))throw Error('This sync change moves a saved caption before the take start.');take.timeline.captions=take.timeline.captions.map(c=>({...c,start:c.start+narrationDelta,end:c.end+narrationDelta,words:c.words?.map(w=>({...w,start:w.start+narrationDelta,end:w.end+narrationDelta}))}));}
  if(live.length){
   const sceneClips=draft.clips.filter(c=>c.start>=start-EPS&&c.start+clipDuration(c)<=end+EPS),tail=Math.max(0,end-Math.max(start,...sceneClips.map(c=>c.start+clipDuration(c))));for(const c of live)c.start+=deltaFor(c);
   const newEnd=Math.max(start,...sceneClips.map(c=>c.start+clipDuration(c)))+tail,change=newEnd-end;
   if(Math.abs(change)>EPS){
    if(draft.clips.some(c=>!sceneClips.includes(c)&&c.start<end-EPS&&c.start+clipDuration(c)>end+EPS))throw Error('A clip crosses this scene boundary. Split it before changing sync.');
    if(sceneCaptions.some(c=>c.end>newEnd+EPS))throw Error('A caption extends beyond the synchronized scene. Adjust its end first.');
    for(const key of ['elements','zooms']as const)if(draft[key].some(e=>e.start<end-EPS&&e.start+e.duration>Math.min(end,newEnd)+EPS))throw Error('A graphic or zoom crosses the changed scene boundary. Adjust it before changing sync.');
    if(draft.cursor.points.some(c=>c.time>=Math.min(end,newEnd)-EPS&&c.time<end-EPS))throw Error('Cursor events cross the changed scene boundary. Adjust them before changing sync.');
    for(const c of draft.clips)if(!sceneClips.includes(c)&&c.start>=end-EPS)c.start+=change;
    for(const c of draft.captions)if(!sceneCaptions.includes(c)&&c.start>=end-EPS){c.start+=change;c.end+=change;if(c.words)for(const w of c.words){w.start+=change;w.end+=change;}}
    for(const key of ['elements','zooms']as const)for(const e of draft[key])if(e.start>=end-EPS)e.start+=change;for(const c of draft.cursor.points)if(c.time>=end-EPS)c.time+=change;for(const later of draft.scenes.slice(draft.scenes.indexOf(scene)+1)){if(later.start<end-EPS)throw Error('Scenes overlap. Separate them before changing sync.');later.start+=change;}scene.duration=newEnd-start;
   }
  }
  take.offsets=[...patch.offsets];
 }
 Object.assign(p,draft);return take;
}

/** Archive only captions whose dominant audible source belongs wholly to removed take clips. */
function removeTakeCaptions(p:Project,removed:Set<string>,start:number,end:number){
 const audible=p.clips.filter(c=>{const m=p.media.find(m=>m.id===c.mediaId);return(m?.hasAudio||m?.kind==='audio')&&!c.muted&&c.gain>0;}).sort((a,b)=>narrationPriority(a,p.media.find(m=>m.id===a.mediaId))-narrationPriority(b,p.media.find(m=>m.id===b.mediaId)));
 const captured=new Map<string,Project['captions']>();
 // An explicitly deleted transcript must stay deleted when its take is later restored.
 const boundaries=[...new Set([start,end,...audible.flatMap(c=>[c.start,c.start+clipDuration(c)]).filter(t=>t>start&&t<end)])].sort((a,b)=>a-b);
 for(let i=0;i<boundaries.length-1;i++){const winner=audible.find(c=>c.start<=boundaries[i]+EPS&&c.start+clipDuration(c)>=boundaries[i+1]-EPS);if(winner?.recordingTakeId&&removed.has(winner.id))captured.set(winner.recordingTakeId,[]);}
 const retained=p.captions.filter(c=>{
  if(c.start>=end-EPS||c.end<=start+EPS)return true;
  const cuts=[...new Set([c.start,c.end,...audible.flatMap(a=>[a.start,a.start+clipDuration(a)]).filter(t=>t>c.start&&t<c.end)])].sort((a,b)=>a-b);const winners=cuts.slice(0,-1).map((left,i)=>audible.find(a=>a.start<=left+EPS&&a.start+clipDuration(a)>=cuts[i+1]-EPS));
  if(!winners.some(w=>w&&removed.has(w.id)))return true;
  const owner=winners[0]?.recordingTakeId;if(!owner||c.start<start-EPS||c.end>end+EPS||winners.some(w=>!w||!removed.has(w.id)||w.recordingTakeId!==owner))throw Error('A caption crosses different takes or this scene boundary. Split it before replacing or archiving narration.');
  const captions=captured.get(owner)??[];captions.push({...plainClone(c),start:c.start-start,end:c.end-start,words:c.words?.map(w=>({...w,start:w.start-start,end:w.end-start}))});captured.set(owner,captions);return false;
 });
 for(const [id,captions]of captured){const take=p.recordedTakes?.find(t=>t.id===id);if(take?.timeline)take.timeline.captions=captions;}
 return retained;
}
