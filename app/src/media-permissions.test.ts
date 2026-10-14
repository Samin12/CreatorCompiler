import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCapturePermission,readMediaPermissions} from './media-permissions';

test('setup permission query preserves native denials, restrictions and unverified system audio',async()=>{
 const status={platform:'darwin',camera:'denied',microphone:'restricted',screen:'not-determined',systemAudio:'unknown'} as const;
 assert.deepEqual(await readMediaPermissions({platform:'darwin',getMediaPermissions:async()=>status}),status);
 const queried:string[]=[];
 const browser=await readMediaPermissions(undefined,{query:async descriptor=>{queried.push(descriptor.name);if(descriptor.name==='camera')return {state:'prompt'} as PermissionStatus;throw new Error('unsupported query');}});
 assert.deepEqual(queried,['camera','microphone']);assert.equal(browser.camera,'not-determined');assert.equal(browser.microphone,'unknown');assert.equal(browser.screen,'unknown');assert.equal(browser.systemAudio,'unknown');
});
test('explicit screen check requests no audio and releases every returned track, including on invalid source',async()=>{
 const calls:unknown[]=[];let stops=0;
 const video={kind:'video',readyState:'live',label:'Chosen screen',stop:()=>{stops++;}} as unknown as MediaStreamTrack;
 const audio={kind:'audio',readyState:'live',stop:()=>{stops++;}} as unknown as MediaStreamTrack;
 const stream={getVideoTracks:()=>[video],getAudioTracks:()=>[audio],getTracks:()=>[video,audio]} as unknown as MediaStream;
 const devices={getUserMedia:async()=>{throw new Error('not requested');},getDisplayMedia:async c=>{calls.push(c);return stream;}} as Pick<MediaDevices,'getUserMedia'|'getDisplayMedia'>;
 assert.equal(await checkCapturePermission('screen',devices),'Chosen screen');assert.deepEqual(calls,[{video:true,audio:false}]);assert.equal(stops,2);
 Object.defineProperty(video,'readyState',{value:'ended'});
 await assert.rejects(checkCapturePermission('screen',devices),/No live screen/);assert.equal(stops,4);
});
test('camera and microphone setup checks ask only for their own device and close before returning',async()=>{
 const calls:unknown[]=[];let stops=0;
 const track={readyState:'live',label:'Device',stop:()=>{stops++;}} as unknown as MediaStreamTrack;
 const stream={getVideoTracks:()=>[track],getAudioTracks:()=>[track],getTracks:()=>[track]} as unknown as MediaStream;
 const devices={getUserMedia:async c=>{calls.push(c);return stream;},getDisplayMedia:async()=>{throw new Error('not requested');}} as Pick<MediaDevices,'getUserMedia'|'getDisplayMedia'>;
 await checkCapturePermission('camera',devices);assert.equal(stops,1);await checkCapturePermission('microphone',devices);assert.equal(stops,2);
 assert.deepEqual(calls,[{video:true,audio:false},{video:false,audio:true}]);
});
