import test from 'node:test';import assert from 'node:assert/strict';
import {TimelineWaveformCache,hasWaveform,waveformBars,waveformHeight,waveformMediaKey,waveformEnvelopePath} from './timeline-waveform';
import {defaultEffects,defaultTransform,type Clip,type Media} from '../shared/types';
const media:Media={id:'source',path:'/fixture/source.wav',name:'Audio',kind:'audio',duration:10,width:0,height:0};
const clip:Clip={id:'c',mediaId:'source',name:'Trimmed',track:'audio',start:20,sourceIn:4,sourceOut:8,speed:2,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('trim and speed sample later source bins instead of beginning of file',()=>{const peaks=Array.from({length:10},(_,i)=>i/10),bars=waveformBars(clip,media,peaks,3,20,22);assert.deepEqual(bars,[{x:1.5,peak:.5},{x:4.5,peak:.7}]);});
test('visible scroll window maps source time and preserves quiet amplitude, gaps and bounds',()=>{const peaks=[0,0,0,0,.01,.01,.02,.02,0,0];assert.deepEqual(waveformBars(clip,media,peaks,3,21,22),[{x:4.5,peak:.02}]);assert.deepEqual(waveformBars(clip,media,peaks,3,0,19),[]);assert.deepEqual(waveformBars(clip,{...media,duration:0},peaks,3,20,22),[]);assert.ok(waveformBars(clip,media,peaks,100000,20,22).length<=1200);});
test('bars sit on a fixed timeline pixel grid so a moving window keeps every shared bar unchanged',()=>{
 const long={...clip,start:20.37,sourceIn:1,sourceOut:9,speed:1},peaks=Array.from({length:200},(_,i)=>(i*37%101)/100),scale=55,origin=long.start*scale;
 const a=waveformBars(long,media,peaks,scale,20,24),b=waveformBars(long,media,peaks,scale,21.3,27),byX=new Map(a.map(bar=>[bar.x,bar.peak]));let shared=0;
 for(const bar of [...a,...b])assert.ok(Math.abs(((bar.x+origin-1.5)/3)-Math.round((bar.x+origin-1.5)/3))<1e-9);
 for(const bar of b)if(byX.has(bar.x)){shared++;assert.equal(bar.peak,byX.get(bar.x));}assert.ok(shared>=40);
 assert.deepEqual(waveformBars(clip,media,Array.from({length:10},(_,i)=>i/10),3,20,22,1),[{x:3,peak:.7}]);
});
test('one filled envelope per clip mirrors each bar about the centerline and collapses flat runs',()=>{
 assert.equal(waveformEnvelopePath([{x:1.5,peak:.25},{x:4.5,peak:0},{x:7.123,peak:1}],14,13),'M1.5 14L1.5 7.5 4.5 14 7.12 1 7.12 14 7.12 27 4.5 14 1.5 20.5Z');
 assert.equal(waveformEnvelopePath([]),'');assert.equal(waveformEnvelopePath([{x:1,peak:0},{x:3,peak:0}]),'');
 const flat=waveformEnvelopePath([{x:1,peak:.25},{x:3,peak:.25},{x:5,peak:.25},{x:7,peak:.25}],10,8);assert.equal(flat,'M1 10L1 6 7 6 7 10 7 14 1 14Z');
 const peaks=Array.from({length:10},(_,i)=>i/10);assert.equal(waveformBars(clip,media,peaks,3,20,22,4096,2).length,3);
});
test('muted and gain-adjusted clips retain raw source waveform without normalization',()=>{const peaks=Array(10).fill(.04);for(const change of [{muted:true},{gain:20},{gain:0}])assert.ok(waveformBars({...clip,...change},media,peaks,3,20,22).every(b=>b.peak===.04));assert.ok(hasWaveform({...media,kind:'video'}));assert.ok(!hasWaveform({...media,kind:'video',hasAudio:false}));assert.ok(!hasWaveform({...media,kind:'image'}));});
test('cache deduplicates active sources, bounds concurrency and withdraws hidden queued requests',async()=>{
 let active=0,max=0;const calls:string[]=[],finish=new Map<string,(p:number[])=>void>();const cache=new TimelineWaveformCache(m=>{calls.push(m.id);active++;max=Math.max(max,active);return new Promise<number[]>(resolve=>finish.set(m.id,p=>{active--;resolve(p)}));},2,2);
 const values:number[][]=[];const a=cache.subscribe(media,p=>values.push([...p])),b=cache.subscribe(media,p=>values.push([...p]));const c=cache.subscribe({...media,id:'two'},()=>{}),d=cache.subscribe({...media,id:'hidden'},()=>{});await tick();assert.deepEqual(calls,['source','two']);d();a();finish.get('source')!([.1,.2]);finish.get('two')!([.3]);await tick();assert.equal(max,2);assert.deepEqual(values,[[.1,.2]]);assert.equal(calls.length,2);b();c();const cached:number[][]=[];cache.subscribe(media,p=>cached.push([...p]))();assert.deepEqual(cached,[[.1,.2]]);assert.equal(calls.length,2);
});
test('late completion cannot update unsubscribed view, identity changes refetch and failures do not loop',async()=>{
 let resolve!:(p:number[])=>void,calls=0,received=0;const cache=new TimelineWaveformCache(()=>{calls++;return new Promise<number[]>(r=>resolve=r)});const release=cache.subscribe(media,()=>received++);await tick();release();resolve([.7]);await tick();assert.equal(received,0);cache.subscribe(media,()=>received++)();assert.equal(received,1);const replacement={...media,path:'/fixture/relinked.wav'};assert.notEqual(waveformMediaKey(media),waveformMediaKey(replacement));cache.subscribe(replacement,()=>{})();await tick();assert.equal(calls,2);resolve([]);await tick();const bad=new TimelineWaveformCache(async()=>{calls++;throw Error('unavailable')});bad.subscribe(media,()=>{});await tick();const count=calls;bad.subscribe(media,()=>{})();await tick();assert.equal(calls,count);
});
test('embedded whole-source envelopes avoid requests and result cache evicts least recently used unused data',async()=>{let calls=0;const cache=new TimelineWaveformCache(async()=>{calls++;return [.1]},1,1);let received:readonly number[]=[];cache.subscribe({...media,waveform:[.01,.02]},p=>received=p)();assert.deepEqual(received,[.01,.02]);assert.equal(calls,0);let off=cache.subscribe(media,()=>{});await tick();off();off=cache.subscribe({...media,id:'two'},()=>{});await tick();off();cache.subscribe(media,()=>{});await tick();assert.equal(calls,3);});
import {resolveShortcut,shortcutDefinitions} from './shortcuts';
test('E toggles waveforms only in the editor outside typing, repeat and modal contexts',()=>{const definition=shortcutDefinitions.find(d=>d.id==='toggleWaveforms')!;assert.equal(definition.extension,true);assert.equal(resolveShortcut({key:'e'},{scope:'edit'})?.id,'toggleWaveforms');for(const context of [{scope:'record' as const},{scope:'edit' as const,editable:true},{scope:'edit' as const,modal:true}])assert.equal(resolveShortcut({key:'e'},context),null);assert.equal(resolveShortcut({key:'e',repeat:true},{scope:'edit'}),null);assert.equal(resolveShortcut({key:'e',isComposing:true},{scope:'edit'}),null);});

test("fixed display curve preserves relative loudness and absolute silence",()=>{assert.equal(waveformHeight(0),0);assert.equal(waveformHeight(.01),1.3);assert.equal(waveformHeight(1),13);assert.ok(waveformHeight(.0001)>0);assert.ok(waveformHeight(.01)<waveformHeight(.04));});
