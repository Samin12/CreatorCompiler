import {clipDuration,type Clip,type Media} from '../shared/types';
export function waveformMediaKey(media:Media){return JSON.stringify([media.id,media.path,media.size??null,media.duration,media.hasAudio??null]);}
export function hasWaveform(media:Media){return media.kind==='audio'||media.kind==='video'&&media.hasAudio!==false;}
/** A fixed square-root display curve makes quiet recordings visible without per-source normalization. */
export function waveformHeight(peak:number){return 13*Math.sqrt(Math.max(0,Math.min(1,Number.isFinite(peak)?peak:0)));}
export interface WaveformBar {x:number;peak:number;}
/** Whole-source bins are sampled in source time, including trim and speed. Bins sit on a fixed timeline pixel grid, so a moving visible window only adds or drops edge bars; the pitch doubles past maxBars. */
export function waveformBars(clip:Clip,media:Media,peaks:readonly number[],scale:number,visibleStart:number,visibleEnd:number,maxBars=1200):WaveformBar[]{
 if(!peaks.length||!(media.duration>0)||!(scale>0)||!Number.isFinite(scale))return [];
 const clipEnd=clip.start+clipDuration(clip),start=Math.max(clip.start,visibleStart),end=Math.min(clipEnd,visibleEnd);if(!(end>start))return [];
 let pitch=3;while(Math.ceil(end*scale/pitch)-Math.floor(start*scale/pitch)>Math.max(1,maxBars))pitch*=2;
 const first=Math.floor(start*scale/pitch),last=Math.ceil(end*scale/pitch),origin=clip.start*scale,bars:WaveformBar[]=[];
 for(let bin=first;bin<last;bin++){
  const from=Math.max(clip.start,bin*pitch/scale),to=Math.min(clipEnd,(bin+1)*pitch/scale);
  const a=clip.sourceIn+(from-clip.start)*clip.speed,b=Math.min(clip.sourceOut,clip.sourceIn+(to-clip.start)*clip.speed);
  let peak=0;const lo=Math.max(0,Math.floor(a/media.duration*peaks.length)),hi=Math.min(peaks.length,Math.ceil(b/media.duration*peaks.length));
  for(let j=lo;j<hi;j++)peak=Math.max(peak,Number.isFinite(peaks[j])?peaks[j]:0);
  bars.push({x:(bin+.5)*pitch-origin,peak:Math.max(0,Math.min(1,peak))});
 }return bars;
}
const pathNumber=(value:number)=>Math.round(value*100)/100;
/** One path per clip instead of a line element per bar; silent bars draw nothing either way. */
export function waveformPath(bars:readonly WaveformBar[]):string{
 let d='';for(const bar of bars){const height=waveformHeight(bar.peak);if(height>0)d+=`M${pathNumber(bar.x)} ${pathNumber(14-height)}V${pathNumber(14+height)}`;}return d;
}
type Entry={media:Media;listeners:Set<(peaks:readonly number[])=>void>;state:'queued'|'active'|'done';peaks:readonly number[]};
/** Two background requests, bounded completed cache, queued requests withdrawn when no longer visible. */
export class TimelineWaveformCache {
 private entries=new Map<string,Entry>();private active=0;
 constructor(private fetcher:(media:Media)=>Promise<readonly number[]>,private maxEntries=128,private concurrency=2){}
 subscribe(media:Media,receive:(peaks:readonly number[])=>void){
  if(!hasWaveform(media))return ()=>{};
  if(media.waveform?.length){receive(media.waveform);return ()=>{};}
  const key=waveformMediaKey(media);let entry=this.entries.get(key);
  if(!entry){entry={media,listeners:new Set(),state:'queued',peaks:[]};this.entries.set(key,entry);}
  else {this.entries.delete(key);this.entries.set(key,entry);}
  entry.listeners.add(receive);if(entry.state==='done')receive(entry.peaks);this.drain();
  return ()=>{entry!.listeners.delete(receive);if(!entry!.listeners.size&&entry!.state==='queued')this.entries.delete(key);this.evict();};
 }
 private evict(){for(const [key,entry]of this.entries){if(this.entries.size<=this.maxEntries)return;if(entry.state==='done'&&!entry.listeners.size)this.entries.delete(key);}}
 private drain(){
  for(const entry of this.entries.values()){
   if(this.active>=this.concurrency)break;if(entry.state!=='queued'||!entry.listeners.size)continue;
   entry.state='active';this.active++;
   Promise.resolve().then(()=>this.fetcher(entry.media)).then(peaks=>{entry.peaks=Array.isArray(peaks)&&peaks.length<=16384?peaks.map(n=>Number.isFinite(n)?Math.max(0,Math.min(1,n)):0):[];},()=>{entry.peaks=[];}).finally(()=>{entry.state='done';this.active--;for(const callback of entry.listeners)callback(entry.peaks);this.evict();this.drain();});
  }
 }
}
export const timelineWaveformCache=new TimelineWaveformCache(async media=>{
 const response=await fetch(`/api/media/${encodeURIComponent(media.id)}/waveform`,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Waveform unavailable');const result=await response.json();return result.peaks;
});
