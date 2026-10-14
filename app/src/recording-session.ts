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
