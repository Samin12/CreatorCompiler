import test from 'node:test';
import assert from 'node:assert/strict';
import {PendingMediaRequests,requestDisplayMedia} from './media-access';
import {CapturePreviewManager} from './capture-preview';
import {grantedPreviewRequests,defaultRecordingSettings} from './recording-presets';
import {createRequire} from 'node:module';
const {createMediaPermissionRequests}=createRequire(import.meta.url)('../desktop/media-permissions.cjs');
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;return {promise:new Promise<T>((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};}
function stream(kind:'audio'|'video'='audio'){
 const track={kind,readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';},addEventListener(){}};
 const result={getTracks:()=>[track],getAudioTracks:()=>kind==='audio'?[track]:[],getVideoTracks:()=>kind==='video'?[track]:[],clone:()=>stream(kind).value};
 return {track,value:result as unknown as MediaStream};
}
const audio={audio:true,video:false};

test('identical pending device requests share one browser call and independently owned tracks',async()=>{
 const wait=deferred<MediaStream>();let calls=0;const pool=new PendingMediaRequests(async()=>{calls++;return wait.promise;});
 const one=pool.request(audio),two=pool.request(audio);await tick();assert.equal(calls,1);
 const raw=stream();wait.resolve(raw.value);const [a,b]=await Promise.all([one,two]);
 assert.notEqual(a,b);assert.equal(raw.track.stops,1);a.getTracks()[0].stop();assert.equal(b.getTracks()[0].readyState,'live');b.getTracks()[0].stop();
});
test('cancelled view keeps the physical request pending, remount adopts it without another prompt',async()=>{
 const wait=deferred<MediaStream>();let calls=0;const pool=new PendingMediaRequests(async()=>{calls++;return wait.promise;});
 const abort=new AbortController(),old=pool.request(audio,abort.signal);await tick();abort.abort();await assert.rejects(old,{name:'AbortError'});
 const reopened=pool.request(audio);await tick();assert.equal(calls,1);const raw=stream();wait.resolve(raw.value);assert.equal(await reopened,raw.value);assert.equal(raw.track.stops,0);raw.track.stop();
});
test('pending different settings do not queue a second prompt, and denial requires an explicit retry',async()=>{
 const waits=[deferred<MediaStream>(),deferred<MediaStream>()];let calls=0;const pool=new PendingMediaRequests(()=>waits[calls++].promise);
 const first=pool.request(audio);await tick();await assert.rejects(pool.request({audio:{deviceId:'other'}}),/request for this device is still open/);assert.equal(calls,1);
 waits[0].reject(new DOMException('denied','NotAllowedError'));await assert.rejects(first,{name:'NotAllowedError'});await tick();assert.equal(calls,1);
 const retry=pool.request({audio:{deviceId:'other'}});await tick();assert.equal(calls,2);const raw=stream();waits[1].resolve(raw.value);(await retry).getTracks().forEach(t=>t.stop());
});
test('all cancelled waiters release late tracks; cancellation before dispatch never opens a device',async()=>{
 const wait=deferred<MediaStream>();let calls=0;const pool=new PendingMediaRequests(()=>{calls++;return wait.promise;});
 const firstAbort=new AbortController(),first=pool.request(audio,firstAbort.signal);firstAbort.abort();await assert.rejects(first,{name:'AbortError'});await tick();assert.equal(calls,0);
 const abort=new AbortController(),pending=pool.request(audio,abort.signal);await tick();abort.abort();await assert.rejects(pending,{name:'AbortError'});const raw=stream();wait.resolve(raw.value);await tick();assert.equal(raw.track.stops,1);
});
test('independent camera and microphone requests remain available in parallel',async()=>{
 let calls=0;const pool=new PendingMediaRequests(async c=>{calls++;return stream(c.video?'video':'audio').value;});
 const tracks=await Promise.all([pool.request(audio),pool.request({video:true,audio:false})]);assert.equal(calls,2);assert.equal(tracks[0].getAudioTracks().length,1);assert.equal(tracks[1].getVideoTracks().length,1);tracks.forEach(s=>s.getTracks().forEach(t=>t.stop()));
});
test('recorder navigation with granted access reuses pending acquisition and keeps new preview alive',async()=>{
 const wait=deferred<MediaStream>();let calls=0;const pool=new PendingMediaRequests(()=>{calls++;return wait.promise;});
 const access={getUserMedia:(c?:MediaStreamConstraints)=>pool.request(c??{}),getDisplayMedia:async()=>{throw Error('unexpected screen prompt');}};
 const old=new CapturePreviewManager(access),fresh=new CapturePreviewManager(access);
 const first=old.acquire({kind:'microphone'});await tick();old.dispose();assert.equal(await first,null);
 const current=fresh.acquire({kind:'microphone'});await tick();assert.equal(calls,1);const raw=stream();wait.resolve(raw.value);assert.ok(await current);await tick();assert.equal(fresh.getSnapshot().microphone.status,'live');assert.equal(fresh.getSnapshot().microphone.stream?.getAudioTracks()[0].readyState,'live');fresh.dispose();
 const settings=defaultRecordingSettings();settings.selection.camera=true;settings.selection.microphone=true;settings.selection.screen=true;
 assert.deepEqual(grantedPreviewRequests(settings,{camera:false,microphone:false}),[]);
 assert.deepEqual(grantedPreviewRequests(settings,{camera:true,microphone:true}).map(x=>x.kind),['camera','microphone']);
});
test('native permission requests deduplicate and always re-read OS state instead of caching grants',async()=>{
 let status='not-determined',calls=0;const wait=deferred<boolean>();const requests=createMediaPermissionRequests({getStatus:()=>status,ask:()=>{calls++;return wait.promise;}});
 const one=requests.request('microphone'),two=requests.request('microphone');await tick();assert.equal(calls,1);status='granted';wait.resolve(true);assert.deepEqual(await one,await two);
 await requests.request('microphone');assert.equal(calls,1);status='denied';assert.equal((await requests.request('microphone')).granted,false);assert.equal(calls,1);
});
test('native shutdown before dispatch never asks, and a prompt already open is never retried',async()=>{
 let active=true,calls=0;const wait=deferred<boolean>();const requests=createMediaPermissionRequests({getStatus:()=> 'not-determined',ask:()=>{calls++;return wait.promise;},isActive:()=>active});
 const queued=requests.request('camera');active=false;await assert.rejects(queued,/window is closing/);assert.equal(calls,0);
 active=true;const open=requests.request('camera');await tick();active=false;await assert.rejects(requests.request('camera'),/window is closing/);wait.resolve(false);await open;await tick();assert.equal(calls,1);
});
test('native denied, restricted and unsupported states never reopen a permission prompt',async()=>{
 let calls=0;for(const status of ['denied','restricted','unsupported']){const requests=createMediaPermissionRequests({getStatus:()=>status,ask:async()=>{calls++;return true;}});assert.equal((await requests.request('camera')).status,status);}assert.equal(calls,0);
});
test('screen timeout cannot queue a second OS prompt or reuse the old selected source',async()=>{
 const waits=[deferred<MediaStream>(),deferred<MediaStream>()];let calls=0;const devices={getDisplayMedia:()=>waits[calls++].promise};
 const access={getUserMedia:async()=>{throw Error('unexpected camera');},getDisplayMedia:(c?:DisplayMediaStreamOptions)=>requestDisplayMedia(c??{},devices)};
 const preview=new CapturePreviewManager(access,undefined,{screenTimeoutMs:5}),options={kind:'screen' as const,sourceId:'screen:1'};
 assert.equal(await preview.acquire(options),null);assert.equal(calls,1);
 assert.equal(await preview.acquire({...options,sourceId:'screen:2'}),null);assert.equal(calls,1);assert.match(preview.getSnapshot().screen.error!,/screen-sharing request is still open/);
 const late=stream('video');waits[0].resolve(late.value);await tick();assert.equal(late.track.stops,1);
 const retry=preview.acquire({...options,sourceId:'screen:2'});await tick();assert.equal(calls,2);const current=stream('video');waits[1].resolve(current.value);assert.equal(await retry,current.value);preview.dispose();
});
