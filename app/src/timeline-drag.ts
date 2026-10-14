/** Geometry used by pointer dragging. Times stay unrounded until an actual snap. */
export interface TimelineSpan {id:string;start:number;duration:number}
export interface SnapTarget {time:number;kind:'playhead'|'edge'|'scene'|'origin';id?:string}
export interface SnapResult {delta:number;guide:SnapTarget|null}
export const SNAP_VIEWPORT_RATIO=.015;
export const snapDistancePixels=(viewportWidth:number)=>Math.max(0,viewportWidth)*SNAP_VIEWPORT_RATIO;
export const isVerticalLayerDrag=(dx:number,dy:number)=>Math.abs(dy)>=12&&Math.abs(dy)>Math.abs(dx)*1.25;

export function timelinePointerDelta(initialX:number,currentX:number,initialScroll:number,currentScroll:number,scale:number){
 return (currentX-initialX+currentScroll-initialScroll)/scale;
}

export function snapTargets(spans:readonly TimelineSpan[],movingIds:ReadonlySet<string>,playhead:number,sceneEdges:readonly number[]=[]):SnapTarget[]{
 const targets:SnapTarget[]=[{time:0,kind:'origin'},{time:playhead,kind:'playhead'}];
 for(const span of spans)if(!movingIds.has(span.id)){targets.push({time:span.start,kind:'edge',id:span.id},{time:span.start+span.duration,kind:'edge',id:span.id});}
 for(const time of sceneEdges)targets.push({time,kind:'scene'});
 return targets.filter(t=>Number.isFinite(t.time)&&t.time>=0).sort((a,b)=>a.time-b.time||priority(a)-priority(b)||(a.id??'').localeCompare(b.id??'')).filter((target,index,list)=>index===0||target.time!==list[index-1].time);
}
const priority=(target:SnapTarget)=>({playhead:0,edge:1,scene:2,origin:3})[target.kind];
const lowerBound=(targets:readonly SnapTarget[],time:number)=>{let lo=0,hi=targets.length;while(lo<hi){const mid=(lo+hi)>>>1;if(targets[mid].time<time)lo=mid+1;else hi=mid;}return lo;};

/** Every selected clip receives this same delta, including when stopped at time zero. */
export function snapTimelineDelta({delta,anchors,targets,scale,minDelta=-Infinity,maxDelta=Infinity,enabled=true,thresholdPx=snapDistancePixels(800),preferredAnchors=[]}:{delta:number;anchors:readonly number[];targets:readonly SnapTarget[];scale:number;minDelta?:number;maxDelta?:number;enabled?:boolean;thresholdPx?:number;preferredAnchors?:readonly number[]}):SnapResult{
 const bounded=Math.max(minDelta,Math.min(maxDelta,delta));
 if(!enabled||!Number.isFinite(scale)||scale<=0)return {delta:bounded,guide:null};
 const distance=thresholdPx/scale,preferred=new Set(preferredAnchors);let best:SnapResult={delta:bounded,guide:null},bestDistance=Infinity;
 for(const anchor of anchors){
  const wanted=anchor+bounded;let index=lowerBound(targets,wanted-distance);
  while(index<targets.length&&targets[index].time<=wanted+distance){
   const target=targets[index++],candidate=target.time-anchor,error=Math.abs(candidate-bounded)-(preferred.has(anchor)?2/scale:0);
   if(candidate<minDelta-1e-9||candidate>maxDelta+1e-9)continue;
   if(error<bestDistance-1e-9||(Math.abs(error-bestDistance)<1e-9&&best.guide&&priority(target)<priority(best.guide))){bestDistance=error;best={delta:Math.max(minDelta,Math.min(maxDelta,candidate)),guide:target};}
  }
 }
 return best;
}

export function groupMove(spans:readonly TimelineSpan[],delta:number,targets:readonly SnapTarget[],scale:number,enabled=true,thresholdPx=snapDistancePixels(800)):SnapResult{
 if(!spans.length)return {delta:0,guide:null};
 return snapTimelineDelta({delta,anchors:[...new Set(spans.flatMap(s=>[s.start,s.start+s.duration]))],preferredAnchors:spans.map(s=>s.start),targets,scale,minDelta:-Math.min(...spans.map(s=>s.start)),enabled,thresholdPx});
}

export interface LayerHitRow {id:string;kind:'video'|'audio';top:number;bottom:number}
export type LayerDrop={kind:'existing';rowId:string}|{kind:'new';beforeId:string|null;afterId:string|null};
/** Row bounds are content coordinates, so vertical scrolling cannot change the target. */
export function hitLayerDrop(y:number,kind:LayerHitRow['kind'],rows:readonly LayerHitRow[],insertionPx=7):LayerDrop|null{
 const candidates=rows.filter(r=>r.kind===kind);if(!candidates.length)return null;
 for(let i=0;i<candidates.length;i++){
  const row=candidates[i],previous=candidates[i-1],next=candidates[i+1];
  if(y>=row.top-insertionPx&&y<=row.top+insertionPx)return {kind:'new',beforeId:row.id,afterId:previous?.id??null};
  if(y>row.top+insertionPx&&y<row.bottom-insertionPx)return {kind:'existing',rowId:row.id};
  if(y>=row.bottom-insertionPx&&y<=row.bottom+insertionPx)return {kind:'new',beforeId:next?.id??null,afterId:row.id};
 }
 return null;
}
