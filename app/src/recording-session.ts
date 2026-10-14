import type {AudioRole} from '../shared/types';
/** The UI and native recorder use the same Unix-epoch clock. */
export class RecordingClock {
 private startedAt=0;
 private pauseAt:number|null=null;
 private pausedFor=0;
 start(at:number){this.startedAt=at;this.pauseAt=null;this.pausedFor=0;}
 pause(at:number){if(this.pauseAt===null)this.pauseAt=Math.max(this.startedAt,at);}
 resume(at:number){if(this.pauseAt!==null){this.pausedFor+=Math.max(0,at-this.pauseAt);this.pauseAt=null;}}
 elapsed(at:number){return Math.max(0,((this.pauseAt??at)-this.startedAt-this.pausedFor)/1000);}
 offset(at:number){return Math.max(0,(at-this.startedAt)/1000);}
}
/** Video prefers H.264 (VideoToolbox hardware on Apple Silicon) over software VP9/VP8. Audio-only stays WebM/Opus. */
export function recorderMimeType(video:boolean,supported:(type:string)=>boolean):string|undefined{
 return (video?['video/mp4;codecs=avc1.640028','video/mp4;codecs=avc1','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']:['audio/webm;codecs=opus','audio/webm']).find(supported);
}
/** MP4 needs one-second keyframes so every 1 s timeslice carries a fragment; WebM keeps the encoder's default GOP. */
export function recorderOptions(video:boolean,mimeType:string):MediaRecorderOptions&{videoKeyFrameIntervalDuration?:number}{
 return video?{mimeType,videoBitsPerSecond:8_000_000,...(mimeType.startsWith('video/mp4')?{videoKeyFrameIntervalDuration:1000}:{})}:{mimeType,audioBitsPerSecond:192_000};
}
/** Chromium's MP4 recorder fires 'start' only once its hardware encoder is up (40-120 ms later), yet its first sample is the frame current at start(): its offset stays anchored at the start() call. WebM fires 'start' at once and keeps that anchor. */
export const anchorOnStartEvent=(mimeType:string)=>!mimeType.startsWith('video/mp4');
/** Browser screen/audio must never duplicate a native capture of the same source. */
export function browserRecordingSelection<T extends {screen:boolean;systemAudio:boolean}>(selection:T,native:boolean):T {
 return native?{...selection,screen:false,systemAudio:false}:{...selection};
}
export function nativeRecordingOutputs(output:{videoPath?:string;audioPath?:string},recordVideo:boolean,systemAudio:boolean):Array<{path:string;track:'screen'|'audio';audioRole?:AudioRole}>{
 const result:Array<{path:string;track:'screen'|'audio';audioRole?:AudioRole}>=[];
 if(recordVideo&&output.videoPath)result.push({path:output.videoPath,track:'screen'});
 if(systemAudio&&output.audioPath)result.push({path:output.audioPath,track:'audio',audioRole:'system'});
 return result;
}
export function nativeRecordingOutputErrors(output:{videoPath?:string;audioPath?:string},recordVideo:boolean,systemAudio:boolean):string[]{
 return [...(recordVideo&&!output.videoPath?['Native capture did not return the selected screen video.']:[]),...(systemAudio&&!output.audioPath?['Native capture did not return system sound.']:[])];
}
/** Plain-language note for a saved native take, or '' when nothing worth mentioning happened.
 * A few late frame slots are normal; the creator only hears about stutter they could notice. */
export function nativeRecordingNote(output:{stoppedEarly?:boolean;videoFrames?:number;lateVideoFrames?:number;droppedVideo?:number}):string{
 const notes:string[]=[];
 if(output.stoppedEarly)notes.push('macOS ended the screen recording early. Everything up to that point was saved.');
 const missed=(output.lateVideoFrames??0)+(output.droppedVideo??0),slots=(output.videoFrames??0)+missed;
 if(slots>0&&missed/slots>.05)notes.push('Your Mac was busy during this take, so the screen video may stutter in places. Play it back before you use it.');
 return notes.join(' ');
}
/** Serializes Pause/Resume, while Stop can immediately prevent further toggles. */
export class RecordingTransitionGate {
 private pending:Promise<void>|null=null;
 private stopping=false;
 reset(){this.stopping=false;}
 run(work:()=>Promise<void>):Promise<void>|null {
  if(this.pending||this.stopping)return null;
  const promise=Promise.resolve().then(work);this.pending=promise;
  void promise.finally(()=>{if(this.pending===promise)this.pending=null;}).catch(()=>{});
  return promise;
 }
 async stop(){this.stopping=true;await this.pending?.catch(()=>{});}
}
