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
 * The context is suspended once the transport has been stopped for `idleDelay` ms,
 * or as soon as a released stage has detached its elements, so the WebAudio render
 * thread does not run through recording or idle editing.
 */
export class PreviewAudioMixer {
 private context?:AudioContext;
 private connections=new WeakMap<HTMLMediaElement,Connection>();
 private resuming?:Promise<void>;
 private suspending=false;
 private playing=false;
 private stoppedAt=-Infinity;
 private live=0;
 private idle?:ReturnType<typeof setTimeout>;
 constructor(private createContext:()=>AudioContext=()=>new AudioContext(),private idleDelay=15000,private clock:()=>number=()=>performance.now()){}

 update(element:HTMLMediaElement,clip:Clip,time:number,playing:boolean,playbackRate=1):void {
  const context=this.context??=this.createContext();
  let connection=this.connections.get(element);
  if(!connection){
   const gain=context.createGain();gain.gain.value=0;
   connection={source:context.createMediaElementSource(element),gain,connected:false};
   this.connections.set(element,connection);
  }
  if(!connection.connected){connection.source.connect(connection.gain);connection.gain.connect(context.destination);connection.connected=true;this.live++;}
  element.volume=1;
  element.muted=clip.muted;
  const now=context.currentTime,param=connection.gain.gain;
  param.cancelScheduledValues(now);
  param.setValueAtTime(previewClipGain(clip,time),now);
  // A short look-ahead smooths the envelope between animation frames. Seeking
  // or pausing cancels it immediately; no delayed work can restart playback.
  if(playing)param.linearRampToValueAtTime(previewClipGain(clip,time+.04*playbackRate),now+.04);
  // A playing transport also wakes the context for paused pre-rolled elements.
  if(playing||this.playing)this.wake();else this.sleepWhenIdle();
 }

 /** The transport keeps the context awake while it plays, however rarely its elements update; stopping starts the idle wait. */
 transport(playing:boolean):void {
  this.playing=playing;
  if(playing)this.wake();else{this.stoppedAt=this.clock();this.sleepWhenIdle();}
 }

 /** The stage is hidden or unmounted: the context suspends as soon as the same commit has detached its elements. */
 release():void {this.transport(false);this.sleepWhenIdle(0);}

 detach(element:HTMLMediaElement):void {
  element.pause();
  const connection=this.connections.get(element);
  if(!connection||!connection.connected)return;
  connection.gain.gain.cancelScheduledValues(this.context!.currentTime);
  connection.gain.gain.setValueAtTime(0,this.context!.currentTime);
  connection.source.disconnect();connection.gain.disconnect();connection.connected=false;this.live--;
  this.sleepWhenIdle();
 }

 /** A resume during a pending suspend is queued after it, so the transport never plays into a context that went to sleep. */
 private wake():void {
  const context=this.context;
  if(context&&(context.state==='suspended'||this.suspending)&&!this.resuming){
   this.resuming=context.resume().catch(()=>{}).finally(()=>{this.resuming=undefined;if(!this.playing)this.sleepWhenIdle();});
  }
 }

 /** One pending check at a time, due when the transport has been stopped for the idle delay; an explicit `delay` replaces it. */
 private sleepWhenIdle(delay?:number):void {
  if(delay===undefined){if(this.idle!==undefined||this.context?.state!=='running')return;delay=Math.max(0,this.stoppedAt+this.idleDelay-this.clock());}
  else clearTimeout(this.idle);
  this.idle=setTimeout(()=>{
   this.idle=undefined;
   const context=this.context;if(!context||context.state!=='running'||this.playing||this.resuming||this.suspending)return;
   if(this.live&&this.clock()-this.stoppedAt<this.idleDelay){this.sleepWhenIdle();return;}
   this.suspending=true;context.suspend().catch(()=>{}).finally(()=>{this.suspending=false;});
  },delay);
 }
}

export const previewAudioMixer=new PreviewAudioMixer();
