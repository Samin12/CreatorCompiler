import {clipDuration,clipEffectTiming,makeId,projectDuration,type CursorPoint,type Project,type Scene} from '../shared/types';
import {cutTimelineRange} from '../shared/timeline-edits';
const EPS=1e-7;
function timelineEnd(p:Project){const ends=[projectDuration(p),...p.captions.map(c=>c.end),...p.zooms.map(z=>z.start+z.duration),...p.cursor.points.map(c=>c.time)];if(ends.some(n=>!Number.isFinite(n)||n<0))throw Error('Timeline timing is invalid. Fix it before arranging recording scenes.');return Math.max(...ends);}
function validateScenes(p:Project){
 const ids=new Set<string>();
 for(let i=0;i<p.scenes.length;i++){
  const s=p.scenes[i],next=p.scenes[i+1];
  if(ids.has(s.id)||!Number.isFinite(s.start)||!Number.isFinite(s.duration)||s.start<0||s.duration<0)throw Error('Scene timing is invalid. Fix the scene boundaries before arranging recordings.');
  ids.add(s.id);
  if(next&&s.start+s.duration>next.start+EPS)throw Error('Scenes overlap. Separate their boundaries before arranging recordings.');
 }
}
function sceneIndex(p:Project,id:string){const i=p.scenes.findIndex(s=>s.id===id);if(i<0)throw Error('This recording scene no longer exists. Choose a current scene.');return i;}
const blank=(p:Project,start:number):Scene=>({id:makeId(),name:`Scene ${p.scenes.length+1}`,script:'',notes:'',start,duration:0});
/** Add an empty script/recording scene without moving any existing content. */
export function addRecordingScene(p:Project,afterId?:string):string {
 validateScenes(p);const index=afterId===undefined?p.scenes.length-1:sceneIndex(p,afterId);
 const after=p.scenes[index],start=index===p.scenes.length-1?timelineEnd(p):after.start+after.duration;
 const scene=blank(p,start);p.scenes.splice(index+1,0,scene);return scene.id;
}
/** Script splitting adds an empty scene; captured footage and saved takes stay with their scene. */
export function splitRecordingSceneScript(p:Project,id:string,position:number):string {
 const draft=structuredClone(p),scene=draft.scenes[sceneIndex(draft,id)];
 if(!Number.isInteger(position)||position<0||position>scene.script.length)throw Error('The script cursor moved. Place it in the script and try again.');
 const nextId=addRecordingScene(draft,id),next=draft.scenes.find(s=>s.id===nextId)!;
 next.script=scene.script.slice(position);scene.script=scene.script.slice(0,position);
 Object.assign(p,draft);return nextId;
}
/** Only merge a script-only scene: joining recorded scenes needs an explicit timeline operation. */
export function mergeRecordingSceneScriptBackward(p:Project,id:string):{id:string;position:number} {
 validateScenes(p);const index=sceneIndex(p,id);
 if(index===0)throw Error('This is the first scene. There is no previous script to merge with.');
 const scene=p.scenes[index],previous=p.scenes[index-1],end=p.scenes[index+1]?.start??timelineEnd(p);
 const hasInterval=(start:number,stop:number)=>start<end-EPS&&stop>scene.start+EPS;
 if(scene.duration>EPS||(p.recordedTakes??[]).some(t=>t.sceneId===id)||p.clips.some(c=>hasInterval(c.start,c.start+clipDuration(c)))||p.captions.some(c=>hasInterval(c.start,c.end))||p.elements.some(e=>hasInterval(e.start,e.start+e.duration))||p.zooms.some(z=>hasInterval(z.start,z.start+z.duration))||p.cursor.points.some(c=>c.time>=scene.start&&c.time<end)){
  throw Error("This scene has recordings or timeline content. Move this scene's takes to the previous scene first, or copy its script and use Delete scene.");
 }
 const position=previous.script.length;
 previous.script+=scene.script?`${previous.script?'\n':''}${scene.script}`:'';
 previous.notes+=scene.notes?`${previous.notes?'\n':''}${scene.notes}`:'';
 p.scenes.splice(index,1);return {id:previous.id,position};
}
/** Remove scene timeline content and its take records; source assets are retained. */
export function deleteRecordingScene(p:Project,id:string):void {
 const draft=structuredClone(p);validateScenes(draft);const index=sceneIndex(draft,id),scene=draft.scenes[index];
 const end=index===draft.scenes.length-1?Math.max(scene.start+scene.duration,timelineEnd(draft)):scene.start+scene.duration;
 const takes=new Set((draft.recordedTakes??[]).filter(t=>t.sceneId===id).map(t=>t.id));
 if(draft.clips.some(c=>c.recordingTakeId&&takes.has(c.recordingTakeId)&&(c.start<scene.start-EPS||c.start+clipDuration(c)>end+EPS)))throw Error('This scene has take clips outside its boundary. Move or split those clips before deleting the scene.');
 // The shared cutter clamps against projectDuration; include caption/zoom-only tails.
 scene.duration=end-scene.start;cutTimelineRange(draft,scene.start,end,true);
 draft.scenes=draft.scenes.filter(s=>s.id!==id);
 if(draft.recordedTakes)draft.recordedTakes=draft.recordedTakes.filter(t=>t.sceneId!==id);
 if(!draft.scenes.length)draft.scenes=[blank(draft,0)];
 Object.assign(p,draft);
}
interface Block {scene:Scene;start:number;end:number;destination:number;}
function cursorAt(points:CursorPoint[],time:number):CursorPoint {
 let i=-1;for(let j=0;j<points.length&&points[j].time<=time;j++)i=j;
 if(i<0)return {time,x:0,y:0,visible:false};
 const a=points[i],b=points[i+1];
 if(!b||a.visible===false||b.visible===false||b.time<=a.time)return {...a,time};
 const fraction=(time-a.time)/(b.time-a.time);return {...a,time,x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};
}
/** Reorder a scene and its following gap as one block. Saved take timelines remain scene-relative. */
export function moveRecordingScene(p:Project,id:string,beforeId?:string):void {
 validateScenes(p);const from=sceneIndex(p,id);if(beforeId!==undefined)sceneIndex(p,beforeId);
 if(id===beforeId)return;
 const order=[...p.scenes],moved=order.splice(from,1)[0];order.splice(beforeId===undefined?order.length:order.findIndex(s=>s.id===beforeId),0,moved);
 if(order.every((s,i)=>s.id===p.scenes[i].id))return;
 const draft=structuredClone(p),end=timelineEnd(p),first=p.scenes[0]?.start??0;
 const blocks:Block[]=p.scenes.map((s,i)=>({scene:s,start:s.start,end:p.scenes[i+1]?.start??Math.max(s.start+s.duration,end),destination:0}));
 let next=first;for(const scene of order){const block=blocks.find(b=>b.scene.id===scene.id)!;block.destination=next;next+=block.end-block.start;}
 const portions=[...(first>0?[{start:0,end:first,destination:0}]:[]),...blocks.filter(b=>b.end>b.start+EPS)];
 const mapInterval=(start:number,stop:number,label:string)=>{
  if(!Number.isFinite(start)||!Number.isFinite(stop)||start<0||stop<start||stop>end+EPS)throw Error(`${label} has invalid timing. Fix it before moving this scene.`);
  if(stop-start<=EPS){
   const block=portions.find(b=>start>=b.start-EPS&&start<b.end-EPS);
   if(block)return [{start,stop,delta:block.destination-block.start}];
   if(Math.abs(start-end)<=EPS)return [{start,stop,delta:next-end}];
   throw Error(`${label} is outside the scene timeline.`);
  }
  const result:Array<{start:number;stop:number;delta:number}>=[];
  for(const block of portions){
   const lo=Math.max(start,block.start),hi=Math.min(stop,block.end);if(hi-lo<=EPS)continue;
   const delta=block.destination-block.start,previous=result.at(-1);
   if(previous&&Math.abs(previous.delta-delta)<=EPS&&Math.abs(previous.stop-lo)<=EPS)previous.stop=hi;
   else result.push({start:lo,stop:hi,delta});
  }
  if(Math.abs(result.reduce((sum,piece)=>sum+piece.stop-piece.start,0)-(stop-start))>EPS)throw Error(`${label} is outside the scene timeline.`);
  return result;
 };
 draft.clips=draft.clips.flatMap(clip=>{
  const stop=clip.start+clipDuration(clip),media=draft.media.find(m=>m.id===clip.mediaId);
  // A stationary canvas-wide background is independent of scene order.
  if(clip.zIndex===-1000&&media?.kind==='image'&&clip.start<=EPS&&stop>=end-EPS&&!clip.effects.fadeIn&&!clip.effects.fadeOut)return [clip];
  const parts=mapInterval(clip.start,stop,'A clip'),timing=clipEffectTiming(clip);
  return parts.map((part,index)=>({...clip,id:index?makeId():clip.id,start:part.start+part.delta,
   sourceIn:parts.length===1?clip.sourceIn:clip.sourceIn+(part.start-clip.start)*clip.speed,
   sourceOut:parts.length===1?clip.sourceOut:Math.min(clip.sourceOut,clip.sourceIn+(part.stop-clip.start)*clip.speed),
   ...(parts.length>1?{effectTiming:{sourceIn:timing.sourceIn,sourceOut:timing.sourceOut}}:{})}));
 });
 draft.captions=draft.captions.flatMap(caption=>{
  for(const word of caption.words??[])if(!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<caption.start-EPS||word.end>caption.end+EPS||word.end<=word.start)throw Error('A caption word is outside its caption or has invalid timing. Fix the word timing before moving this scene.');
  const parts=mapInterval(caption.start,caption.end,'A caption');
  return parts.map((part,index)=>{
   const words=caption.words?.filter(word=>word.start<part.stop-EPS&&word.end>part.start+EPS).map(word=>({...word,start:Math.max(word.start,part.start)+part.delta,end:Math.min(word.end,part.stop)+part.delta}));
   return {...caption,id:index?makeId():caption.id,start:part.start+part.delta,end:part.stop+part.delta,
    ...(words?{words,text:parts.length>1?words.map(word=>word.text).join(' ').replace(/\s+/g,' ').trim():caption.text}:{})};
  });
 });
 draft.elements=draft.elements.flatMap(item=>mapInterval(item.start,item.start+item.duration,'A graphic').map((part,index)=>({...item,id:index?makeId():item.id,start:part.start+part.delta,duration:part.stop-part.start})));
 draft.zooms=draft.zooms.flatMap(zoom=>{
  const parts=mapInterval(zoom.start,zoom.start+zoom.duration,'A zoom');
  return parts.map((part,index)=>({...zoom,id:index?makeId():zoom.id,start:part.start+part.delta,duration:part.stop-part.start,
   ...(parts.length>1?{effectTiming:{offset:(zoom.effectTiming?.offset??0)+part.start-zoom.start,duration:zoom.effectTiming?.duration??zoom.duration}}:{})}));
 });
 const points=[...p.cursor.points].sort((a,b)=>a.time-b.time);
 if(points.length){
  const movedPoints=points.filter(pt=>pt.time<first).map(pt=>({...pt}));
  if(first>0)movedPoints.push(cursorAt(points,Math.max(0,first-1e-6)));
  for(const block of blocks){
   const length=block.end-block.start;if(length<=EPS)continue;
   const delta=block.destination-block.start;
   movedPoints.push({...cursorAt(points,block.start),time:block.destination});
   movedPoints.push(...points.filter(pt=>pt.time>block.start&&pt.time<block.end).map(pt=>({...pt,time:pt.time+delta})));
   // A tiny boundary hold prevents new neighbors from interpolating into each other.
   const last=Math.max(block.start,block.end-Math.min(1e-6,length/2));
   movedPoints.push({...cursorAt(points,last),time:last+delta});
   if(Math.abs(block.destination+length-next)<=EPS)movedPoints.push({...cursorAt(points,block.end),time:next});
  }
  draft.cursor.points=movedPoints.sort((a,b)=>a.time-b.time);
 }
 draft.scenes=order.map(scene=>({...scene,start:blocks.find(b=>b.scene.id===scene.id)!.destination}));
 Object.assign(p,draft);
}
