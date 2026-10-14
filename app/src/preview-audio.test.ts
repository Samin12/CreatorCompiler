import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultEffects,defaultTransform,type Clip} from '../shared/types';
import {PreviewAudioMixer,previewClipGain} from './preview-audio';

const makeClip=(patch:Partial<Clip>={}):Clip=>({id:'clip',mediaId:'media',name:'Voice',track:'audio',start:2,sourceIn:1,sourceOut:9,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects(),...patch});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('preview preserves amplification and multiplies overlapping fade envelopes in timeline seconds',()=>{
 const clip=makeClip({gain:1.5});assert.equal(previewClipGain(clip,3),1.5);
 clip.gain=.8;clip.effects.fadeIn=1;near(previewClipGain(clip,2.1),.08);
 clip.effects.fadeOut=2;near(previewClipGain(clip,9.5),.2);
 clip.speed=2;clip.effects.fadeIn=3;clip.effects.fadeOut=3;
 near(previewClipGain(clip,4),.8*(2/3)*(2/3));
 near(previewClipGain(clip,2),0);near(previewClipGain(clip,6),0);
 assert.equal(previewClipGain(clip,1.9),0);clip.muted=true;assert.equal(previewClipGain(clip,4),0);
});

function fixture(idleDelay=1){
 let sourceCount=0,resumeCount=0,suspendCount=0,resolveResume!:()=>void;
 const sources:Array<{connectCount:number;disconnectCount:number;connect:()=>void;disconnect:()=>void}>=[];
 const gains:Array<{gain:{value:number;events:Array<[string,number,number?]>;cancelScheduledValues:(at:number)=>void;setValueAtTime:(value:number,at:number)=>void;linearRampToValueAtTime:(value:number,at:number)=>void};connectCount:number;disconnectCount:number;connect:()=>void;disconnect:()=>void}>=[];
 const context={currentTime:5,state:'suspended',destination:{},createMediaElementSource:()=>{sourceCount++;const node={connectCount:0,disconnectCount:0,connect(){this.connectCount++;},disconnect(){this.disconnectCount++;}};sources.push(node);return node;},createGain:()=>{const events:Array<[string,number,number?]>=[];const node={gain:{value:1,events,cancelScheduledValues(at:number){events.push(['cancel',at]);},setValueAtTime(value:number,at:number){this.value=value;events.push(['set',value,at]);},linearRampToValueAtTime(value:number,at:number){events.push(['ramp',value,at]);}},connectCount:0,disconnectCount:0,connect(){this.connectCount++;},disconnect(){this.disconnectCount++;}};gains.push(node);return node;},resume:()=>{resumeCount++;return new Promise<void>(resolve=>{resolveResume=()=>{context.state='running';resolve();};});},suspend:()=>{suspendCount++;context.state='suspended';return Promise.resolve();}};
 const element={volume:.3,muted:false,pauseCount:0,pause(){this.pauseCount++;}};
 return {mixer:new PreviewAudioMixer(()=>context as unknown as AudioContext,idleDelay),element:element as unknown as HTMLMediaElement,rawElement:element,context,sources,gains,sourceCount:()=>sourceCount,resumeCount:()=>resumeCount,suspendCount:()=>suspendCount,resolveResume:()=>resolveResume()};
}

test('the context suspends after playback has been idle and the next playing update resumes it',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const f=fixture(1500),clip=makeClip();f.context.state='running';
 f.mixer.update(f.element,clip,3,true);f.mixer.update(f.element,clip,3,false,1,true);t.mock.timers.tick(1400);
 f.mixer.update(f.element,clip,3,false);t.mock.timers.tick(1000);assert.equal(f.suspendCount(),0);
 t.mock.timers.tick(500);assert.equal(f.suspendCount(),1);assert.equal(f.context.state,'suspended');
 f.mixer.update(f.element,clip,3,false);t.mock.timers.tick(5000);assert.equal(f.suspendCount(),1,'a suspended context is left alone');
 // A paused pre-rolled element still wakes the context while the transport plays.
 f.mixer.update(f.element,clip,1,false,1,true);assert.equal(f.resumeCount(),1);
});

test('an awake update postpones the pending suspend, and detaching the last element lets it sleep',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const f=fixture(1500),clip=makeClip();f.context.state='running';
 f.mixer.update(f.element,clip,3,false);t.mock.timers.tick(1000);f.mixer.update(f.element,clip,3,true);
 t.mock.timers.tick(500);assert.equal(f.suspendCount(),0);t.mock.timers.tick(1400);assert.equal(f.suspendCount(),0);
 t.mock.timers.tick(100);assert.equal(f.suspendCount(),1);
 f.context.state='running';f.mixer.update(f.element,clip,3,true);f.mixer.detach(f.element);
 t.mock.timers.tick(1499);assert.equal(f.suspendCount(),1);t.mock.timers.tick(1);assert.equal(f.suspendCount(),2);
});

test('gain node carries boost and smooth fades, while pause cancels pending automation',()=>{
 const f=fixture(),clip=makeClip({gain:1.5});
 f.mixer.update(f.element,clip,3,false);assert.equal(f.rawElement.volume,1);assert.equal(f.gains[0].gain.value,1.5);
 clip.gain=.8;clip.effects.fadeIn=1;f.mixer.update(f.element,clip,2.1,true,2);
 const events=f.gains[0].gain.events;near(events.at(-2)![1],.08);near(events.at(-1)![1],.144);assert.equal(events.at(-1)![2],5.04);
 f.context.currentTime=5.01;f.mixer.update(f.element,clip,2.1,false);
 assert.deepEqual(events.at(-2),['cancel',5.01]);assert.equal(events.at(-1)![0],'set');near(f.gains[0].gain.value,.08);
});

test('effect replay reuses one media source, disconnects on unmount, and late resume cannot reconnect it',async()=>{
 const f=fixture(),clip=makeClip();
 f.mixer.update(f.element,clip,3,true);f.mixer.update(f.element,clip,3.02,true);
 assert.equal(f.sourceCount(),1);assert.equal(f.resumeCount(),1);assert.equal(f.sources[0].connectCount,1);
 f.mixer.detach(f.element);assert.equal(f.rawElement.pauseCount,1);assert.equal(f.gains[0].gain.value,0);assert.equal(f.sources[0].disconnectCount,1);assert.equal(f.gains[0].disconnectCount,1);
 f.resolveResume();await Promise.resolve();await Promise.resolve();assert.equal(f.sources[0].connectCount,1);assert.equal(f.gains[0].gain.value,0);
 f.mixer.update(f.element,clip,3,false);assert.equal(f.sourceCount(),1);assert.equal(f.sources[0].connectCount,2);assert.equal(f.gains[0].gain.value,1);
 f.mixer.detach(f.element);f.mixer.detach(f.element);assert.equal(f.sources[0].disconnectCount,2);
});

test('separate simultaneous tracks have independent gain and mute controls',()=>{
 const f=fixture(),other={volume:1,muted:false,pause(){}} as HTMLMediaElement;
 f.mixer.update(f.element,makeClip({gain:.4}),3,false);f.mixer.update(other,makeClip({gain:2,muted:true}),3,false);
 assert.equal(f.sourceCount(),2);assert.equal(f.gains[0].gain.value,.4);assert.equal(f.gains[1].gain.value,0);assert.equal(other.muted,true);
 f.mixer.detach(other);assert.equal(f.gains[0].disconnectCount,0);
});
