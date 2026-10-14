import {clipDuration,clipEffectTiming,type Clip} from '../shared/types';

/** The export envelope is applied after speed adjustment, in timeline seconds. */
export function previewClipGain(clip:Clip,time:number):number {
 const duration=clipDuration(clip),elapsed=time-clip.start;
 if(clip.muted||elapsed<0||elapsed>=duration)return 0;
 const timing=clipEffectTiming(clip),effectElapsed=elapsed+timing.offset;
 const fadeIn=clip.effects.fadeIn>0?Math.min(1,effectElapsed/clip.effects.fadeIn):1;
 const fadeOut=clip.effects.fadeOut>0?Math.min(1,(timing.duration-effectElapsed)/clip.effects.fadeOut):1;
 return Math.max(0,clip.gain)*fadeIn*fadeOut;
}

type Connection={source:MediaElementAudioSourceNode;gain:GainNode;connected:boolean};

/** One context per editor page, and one source node for each media element.
 * Retaining a disconnected element's nodes in a WeakMap also supports React's
 * strict effect replay: browsers forbid creating its source node a second time.
 * The context is suspended once playback has been idle for `idleDelay` ms, so the
 * WebAudio render thread does not run through recording or idle editing.
 */
export class PreviewAudioMixer {
 private context?:AudioContext;
 private connections=new WeakMap<HTMLMediaElement,Connection>();
 private resuming?:Promise<void>;
 private awakeAt=-Infinity;
 private idle?:ReturnType<typeof setTimeout>;
 constructor(private createContext:()=>AudioContext=()=>new AudioContext(),private idleDelay=1500){}

 /** `awake` (the transport is playing) keeps the context running for paused pre-rolled elements as well. */
 update(element:HTMLMediaElement,clip:Clip,time:number,playing:boolean,playbackRate=1,awake=playing):void {
  const context=this.context??=this.createContext();
  let connection=this.connections.get(element);
  if(!connection){
   const gain=context.createGain();gain.gain.value=0;
   connection={source:context.createMediaElementSource(element),gain,connected:false};
   this.connections.set(element,connection);
  }
  if(!connection.connected){connection.source.connect(connection.gain);connection.gain.connect(context.destination);connection.connected=true;}
  element.volume=1;
  element.muted=clip.muted;
  const now=context.currentTime,param=connection.gain.gain;
  param.cancelScheduledValues(now);
  param.setValueAtTime(previewClipGain(clip,time),now);
  // A short look-ahead smooths the envelope between animation frames. Seeking
  // or pausing cancels it immediately; no delayed work can restart playback.
  if(playing)param.linearRampToValueAtTime(previewClipGain(clip,time+.04*playbackRate),now+.04);
  if(!awake){this.sleepWhenIdle();return;}
  this.awakeAt=Date.now();
  if(context.state==='suspended'&&!this.resuming){
   this.resuming=context.resume().catch(()=>{}).finally(()=>{this.resuming=undefined;});
  }
 }

 detach(element:HTMLMediaElement):void {
  element.pause();
  const connection=this.connections.get(element);
  if(!connection||!connection.connected)return;
  connection.gain.gain.cancelScheduledValues(this.context!.currentTime);
  connection.gain.gain.setValueAtTime(0,this.context!.currentTime);
  connection.source.disconnect();connection.gain.disconnect();connection.connected=false;
  this.sleepWhenIdle();
 }

 /** One pending check at a time; any awake update within the delay postpones the suspend, and the next one resumes. */
 private sleepWhenIdle():void {
  if(this.idle!==undefined)return;
  this.idle=setTimeout(()=>{
   this.idle=undefined;
   const context=this.context;if(!context||context.state!=='running')return;
   if(this.resuming||Date.now()-this.awakeAt<this.idleDelay){this.sleepWhenIdle();return;}
   context.suspend().catch(()=>{});
  },this.idleDelay);
 }
}

export const previewAudioMixer=new PreviewAudioMixer();
