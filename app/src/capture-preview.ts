import type {NormalizedRegion,RegionStream} from './capture-region';
import type {AudioRole} from '../shared/types';
/** Owns preview streams across asynchronous permission prompts and device switches. */
export type CaptureKind = 'camera' | 'microphone' | 'screen';
export type PreviewState = {status:'off'|'loading'|'live'|'ended'|'error';stream:MediaStream|null;error:string|null;key:string};
export type PreviewSnapshot = Record<CaptureKind,PreviewState>;
/** preview: limits for a screen stream that is only displayed, never recorded (native capture records the screen). */
export type CaptureRequest = {kind:CaptureKind;deviceId?:string;width?:number;height?:number;frameRate?:number;systemAudio?:boolean;echoCancellation?:boolean;noiseSuppression?:boolean;sourceId?:string;crop?:NormalizedRegion;preview?:{width?:number;height?:number;frameRate:number}};
export type MediaAccess = Pick<MediaDevices,'getUserMedia'|'getDisplayMedia'>;
const empty = ():PreviewState => ({status:'off',stream:null,error:null,key:''});
/** Browser capture promises cannot be aborted. Settle our waiter, then release any late result. */
function waitForCapture<T>(promise:Promise<T>,signal:AbortSignal,releaseLate:(value:T)=>void,timeoutMs?:number):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(error?:Error,value?:T)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
  const abort=()=>finish(new DOMException('Capture cancelled','AbortError'));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  if(!settled&&timeoutMs!==undefined)timer=setTimeout(()=>finish(new Error('The selected screen did not open its preview. Try again, or quit and reopen Creator Compiler if it still cannot start.')),timeoutMs);
  promise.then(value=>{if(settled)releaseLate(value);else finish(undefined,value);},error=>finish(error));
 });
}
export const streamIsLive = (stream:MediaStream|null,kind:'audio'|'video') => Boolean(stream?.getTracks().some(track=>track.kind===kind&&track.readyState==='live'));
export function captureError(error:unknown):string {
 const e=error as {name?:string;message?:string};
 if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError')return 'Access was not granted. Enable this source to try again, or review its macOS privacy permission.';
 if(e.name==='NotFoundError'||e.name==='DevicesNotFoundError')return 'No matching device was found. Connect a device and choose it again.';
 if(e.name==='NotReadableError'||e.name==='TrackStartError')return 'This source could not start. It may be in use by another application.';
 if(e.name==='OverconstrainedError')return 'This device does not support the selected settings. Choose another device or resolution.';
 return e.message||'The capture source could not be opened.';
}
export class CapturePreviewManager {
 private state:PreviewSnapshot={camera:empty(),microphone:empty(),screen:empty()};
 private listeners=new Set<()=>void>();
 private generation:Record<CaptureKind,number>={camera:0,microphone:0,screen:0};
 private pending:Partial<Record<CaptureKind,{key:string;promise:Promise<MediaStream|null>}>>={};
 private disposed=false;
 private cleanup:Partial<Record<CaptureKind,()=>void>>={};
 private controllers:Partial<Record<CaptureKind,AbortController>>={};
 constructor(private access:MediaAccess,private deriveScreen?:(raw:MediaStream,request:CaptureRequest,signal:AbortSignal)=>Promise<RegionStream>,private timings:{screenTimeoutMs?:number}={}){}
 private release(kind:CaptureKind){this.controllers[kind]?.abort();delete this.controllers[kind];const cleanup=this.cleanup[kind];delete this.cleanup[kind];if(cleanup)cleanup();else this.state[kind].stream?.getTracks().forEach(t=>t.stop());}
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(kind:CaptureKind,value:PreviewState){this.state={...this.state,[kind]:value};this.listeners.forEach(fn=>fn());}
 async acquire(request:CaptureRequest):Promise<MediaStream|null>{
  if(this.disposed)return null;
  const {kind}=request,key=JSON.stringify(request),prior=this.state[kind];
  if(prior.key===key&&streamIsLive(prior.stream,kind==='microphone'?'audio':'video'))return prior.stream;
  const inFlight=this.pending[kind];if(inFlight?.key===key)return inFlight.promise;
  const generation=++this.generation[kind];this.release(kind);const controller=new AbortController();this.controllers[kind]=controller;
  this.publish(kind,{status:'loading',stream:null,error:null,key});
  const promise:Promise<MediaStream|null>=Promise.resolve().then(async()=>{
   let stream:MediaStream;
   try {
    controller.signal.throwIfAborted();
    const limit=request.preview,acquiring=kind==='screen'?this.access.getDisplayMedia({video:{frameRate:{ideal:Math.min(request.frameRate||30,limit?.frameRate??60),max:limit?.frameRate??60},...(limit?.width&&limit.height?{width:{max:limit.width},height:{max:limit.height}}:{})},audio:Boolean(request.systemAudio)}):kind==='camera'?this.access.getUserMedia({video:{deviceId:request.deviceId?{exact:request.deviceId}:undefined,width:{ideal:request.width||1920},height:{ideal:request.height||1080},frameRate:{ideal:request.frameRate||30}},audio:false}):this.access.getUserMedia({video:false,audio:{deviceId:request.deviceId?{exact:request.deviceId}:undefined,echoCancellation:request.echoCancellation!==false,noiseSuppression:request.noiseSuppression!==false,autoGainControl:false}});
    // A sourceId means the desktop chooser has already been confirmed. Do not time
    // out an initial browser chooser or camera/microphone permission prompt.
    stream=await waitForCapture(acquiring,controller.signal,value=>value.getTracks().forEach(track=>track.stop()),kind==='screen'&&request.sourceId?(this.timings.screenTimeoutMs??30000):undefined);
    if(this.disposed||generation!==this.generation[kind]){stream.getTracks().forEach(track=>track.stop());return null;}
    if(!streamIsLive(stream,kind==='microphone'?'audio':'video')){stream.getTracks().forEach(track=>track.stop());throw new Error('The selected source did not return a live track.');}
    const raw=stream;this.cleanup[kind]=()=>raw.getTracks().forEach(t=>t.stop());
    if(kind==='screen'&&request.crop){if(!this.deriveScreen)throw new Error('Region capture is unavailable. No full-screen recording was started.');const derived=await waitForCapture(this.deriveScreen(raw,request,controller.signal),controller.signal,value=>value.dispose());if(this.disposed||generation!==this.generation[kind]){derived.dispose();return null;}stream=derived.stream;this.cleanup[kind]=()=>{derived.dispose();raw.getTracks().forEach(t=>t.stop());};}
    const ended=()=>{if(this.state[kind].stream!==stream)return;this.release(kind);this.publish(kind,{status:'ended',stream:null,error:'The source stopped sharing. Enable its preview to reconnect.',key});};
    [...new Set([...stream.getTracks(),...raw.getTracks()])].filter(track=>track.kind===(kind==='microphone'?'audio':'video')).forEach(track=>track.addEventListener('ended',ended,{once:true}));
    if(kind==='screen')stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{if(this.state.screen.stream===stream)this.publish('screen',{...this.state.screen});},{once:true}));
    this.publish(kind,{status:'live',stream,error:null,key});return stream;
   }catch(error){if(!this.disposed&&generation===this.generation[kind]){this.release(kind);this.publish(kind,{status:'error',stream:null,error:captureError(error),key});}return null;}
   finally{if(this.pending[kind]?.promise===promise)delete this.pending[kind];}
  });
  this.pending[kind]={key,promise};return promise;
 }
 stop(kind:CaptureKind){++this.generation[kind];delete this.pending[kind];this.release(kind);this.publish(kind,empty());}
 stopScreenAudio(){const prior=this.state.screen;if(!prior.stream){this.stop('screen');return;}for(const track of prior.stream.getAudioTracks()){track.stop();prior.stream.removeTrack(track);}let request:CaptureRequest;try{request=JSON.parse(prior.key);}catch{request={kind:'screen'};}request.systemAudio=false;this.publish('screen',{...prior,key:JSON.stringify(request)});}
 stopAll(){(['camera','microphone','screen'] as const).forEach(kind=>this.stop(kind));}
 dispose(){this.disposed=true;this.stopAll();this.listeners.clear();}
}
export const sameDeviceList=(a:readonly MediaDeviceInfo[],b:readonly MediaDeviceInfo[])=>a.length===b.length&&a.every((d,i)=>d.deviceId===b[i].deviceId&&d.kind===b[i].kind&&d.label===b[i].label&&d.groupId===b[i].groupId);
/** Camera is video-only. System sound can be recorded with screen video or by itself; mic is included exactly once. */
export function recordingSources(snapshot:PreviewSnapshot,selection:{camera:boolean;screen:boolean;microphone:boolean;systemAudio:boolean},makeStream:(tracks:MediaStreamTrack[])=>MediaStream=tracks=>new MediaStream(tracks)):{track:'camera'|'screen'|'audio';stream:MediaStream;audioRole?:AudioRole}[]{
 if(selection.systemAudio&&!streamIsLive(snapshot.screen.stream,'audio'))throw new Error('The selected source did not provide system audio. Choose a source with sound, or turn System Sound off.');
 const result:{track:'camera'|'screen'|'audio';stream:MediaStream;audioRole?:AudioRole}[]=[],audioIds=new Set<string>();
 const microphoneIds=new Set(selection.microphone?snapshot.microphone.stream?.getAudioTracks().map(t=>t.id):[]);
 for(const [kind,track] of [['camera','camera'],['screen','screen'],['microphone','audio']] as const){
  if(!selection[kind]&&!(kind==='screen'&&selection.systemAudio))continue;
  const source=snapshot[kind].stream,required=kind==='microphone'||(kind==='screen'&&!selection.screen)?'audio':'video';
  if(!streamIsLive(source,required))throw new Error(kind==='screen'&&!selection.screen?'Choose a source with system audio before recording.':`Enable the ${kind} preview before recording.`);
  const tracks=source!.getTracks().filter(t=>t.readyState==='live'&&(kind==='microphone'?t.kind==='audio':(t.kind==='video'&&(kind!=='screen'||selection.screen))||(kind==='screen'&&selection.systemAudio&&t.kind==='audio'))).filter(t=>{if(t.kind!=='audio')return true;if(kind==='screen'&&microphoneIds.has(t.id))return false;if(audioIds.has(t.id))return false;audioIds.add(t.id);return true;});
  if(tracks.length)result.push({track:kind==='screen'&&!selection.screen?'audio':track,stream:makeStream(tracks),...(tracks.some(t=>t.kind==='audio')?{audioRole:kind==='microphone'?'microphone':'system'}:{})});
 }
 return result;
}
