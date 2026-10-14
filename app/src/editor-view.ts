import type {AutomationJob} from '../shared/automation';
import type {Project} from '../shared/types';
import type {TranscriptWord} from './transcript-editing';

/** Number of leading indexes for which a monotone `before` test holds (binary search). */
export function partitionPoint(length:number,before:(index:number)=>boolean){let lo=0,hi=length;while(lo<hi){const mid=(lo+hi)>>>1;if(before(mid))lo=mid+1;else hi=mid;}return lo;}
/** Index of the first time-sorted item at or after `time`. */
export const firstAtOrAfter=(items:readonly {time:number}[],time:number)=>partitionPoint(items.length,i=>items[i].time<time);
/** Running maximum of word ends, so the words under the playhead are found without scanning the transcript. */
export function wordEndCeilings(words:readonly TranscriptWord[]){const out=new Float64Array(words.length);let max=-Infinity;for(let i=0;i<words.length;i++){max=Math.max(max,words[i].end);out[i]=max;}return out;}
/** Every start-sorted word whose [start,end) contains `time`, in index order. Overlapping words can all be current. */
export function currentWordIndices(words:readonly TranscriptWord[],ceilings:ArrayLike<number>,time:number):number[]{const out:number[]=[];for(let i=partitionPoint(words.length,i=>words[i].start<=time)-1;i>=0&&ceilings[i]>time;i--)if(words[i].end>time)out.push(i);return out.reverse();}
export const sameIndices=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((value,i)=>value===b[i]);
/** A memoizable useSyncExternalStore snapshot that only changes identity when the selected value changes. Recreate it when `select` reads new data. */
export function derivedSnapshot<T>(get:()=>number,select:(time:number)=>T,equal:(a:T,b:T)=>boolean=Object.is):()=>T{let ready=false,time=0,value:T;return()=>{const now=get();if(!ready||now!==time){const next=select(now);if(!ready||!equal(value,next))value=next;time=now;ready=true;}return value;};}
export const KEYFRAME_WINDOW=150;
/** First row of a bounded keyframe list around `index`; the window moves in steps so playback re-renders it rarely. */
export function keyframeWindowStart(count:number,index:number,size=KEYFRAME_WINDOW){if(count<=size)return 0;const step=Math.max(1,Math.floor(size/3));return Math.max(0,Math.min(count-size,Math.floor(index/step)*step-step));}
/** Whether an edit kept everything a transcript selection depends on: clip and caption timing and caption text. */
export function sameTranscriptTiming(a:Project,b:Project){
 if(a===b)return true;if(a.id!==b.id)return false;
 if(a.clips!==b.clips){if(a.clips.length!==b.clips.length)return false;for(let i=0;i<a.clips.length;i++){const x=a.clips[i],y=b.clips[i];if(x!==y&&(x.id!==y.id||x.start!==y.start||x.sourceIn!==y.sourceIn||x.sourceOut!==y.sourceOut||x.speed!==y.speed))return false;}}
 if(a.captions!==b.captions){if(a.captions.length!==b.captions.length)return false;for(let i=0;i<a.captions.length;i++){const x=a.captions[i],y=b.captions[i];if(x===y)continue;if(x.id!==y.id||x.start!==y.start||x.end!==y.end||x.text!==y.text)return false;const xw=x.words,yw=y.words;if(xw===yw)continue;if(!xw||!yw||xw.length!==yw.length)return false;for(let j=0;j<xw.length;j++)if(xw[j].start!==yw[j].start||xw[j].end!==yw[j].end||xw[j].text!==yw[j].text)return false;}}
 return true;
}
/** Status chips only read these job fields; equal lists keep their identity so memoized chips skip polls. */
export function sameStatusJobs(a:readonly AutomationJob[],b:readonly AutomationJob[]){return a.length===b.length&&a.every((x,i)=>{const y=b[i];return x===y||x.id===y.id&&x.projectId===y.projectId&&x.kind===y.kind&&x.sceneId===y.sceneId&&x.status===y.status&&x.progress===y.progress&&x.message===y.message&&x.error===y.error&&x.captionCount===y.captionCount&&x.updatedAt===y.updatedAt;});}
/** Applies the first value at once, then at most one value per animation frame, always ending on the latest one. */
export function frameThrottle<T>(apply:(value:T)=>void,request:(callback:()=>void)=>number=callback=>requestAnimationFrame(callback),cancel:(handle:number)=>void=handle=>cancelAnimationFrame(handle)){
 let frame=0,pending:{value:T}|null=null;
 const tick=()=>{if(!pending){frame=0;return;}const {value}=pending;pending=null;frame=request(tick);apply(value);};
 return {run:(value:T)=>{if(frame){pending={value};return;}frame=request(tick);apply(value);},cancel:()=>{if(frame)cancel(frame);frame=0;pending=null;}};
}
