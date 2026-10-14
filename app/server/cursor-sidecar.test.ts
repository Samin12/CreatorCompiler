import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCursorSidecar,cursorForTimeline,type RecordedCursorPoint} from './cursor-sidecar.js';
import {createProject,defaultEffects,defaultTransform,type Clip,type Media} from '../shared/types.js';

export function cursorFixture(events:Array<{kind:number,time:number,x:number,y:number}>){
 const bytes=Buffer.alloc(4+events.length*34);bytes.writeUInt32BE(1,0);
 events.forEach((e,i)=>{const at=4+i*34;bytes.writeUInt32BE(30,at);bytes[at+4]=e.kind;bytes.writeFloatBE(e.x,at+5);bytes.writeFloatBE(e.y,at+9);bytes.writeFloatBE(100,at+13);bytes.writeFloatBE(50,at+17);bytes.writeBigUInt64BE(BigInt(Math.round(e.time*1e9)),at+21);bytes.writeUInt32BE(1e9,at+29);bytes[at+33]=1});return bytes;
}
test('cursor v1 normalizes logical dimensions and carries button state through movement',()=>{
 const points=decodeCursorSidecar(cursorFixture([{kind:3,time:1,x:25,y:25},{kind:1,time:1.1,x:25,y:25},{kind:3,time:1.2,x:50,y:10},{kind:2,time:1.3,x:50,y:10}]));
 assert.deepEqual(points.map(p=>[p.time,p.x,p.y,p.pressed]),[[1,.25,.5,false],[1.1,.25,.5,true],[1.2,.5,.2,true],[1.3,.5,.2,false]]);
});
test('cursor parser rejects unknown versions, malformed frames and impossible clocks',()=>{
 const b=cursorFixture([{kind:3,time:0,x:1,y:2}]);assert.throws(()=>decodeCursorSidecar(b.subarray(0,b.length-1)),/truncated/);
 const version=Buffer.from(b);version.writeUInt32BE(2);assert.throws(()=>decodeCursorSidecar(version),/version/);
 const clock=Buffer.from(b);clock.writeUInt32BE(0,33);assert.throws(()=>decodeCursorSidecar(clock),/fields/);
});
const media:Media={id:'m',name:'screen',path:'/fixture.mov',kind:'video',duration:20,width:100,height:50};
const clip:Clip={id:'c',mediaId:'m',name:'screen',track:'screen',start:10,sourceIn:2,sourceOut:6,speed:2,gain:0,muted:true,transform:defaultTransform(),effects:defaultEffects()};
const events:RecordedCursorPoint[]=[{time:1,x:.25,y:.5,pressed:false,cursorKind:1},{time:4,x:.75,y:.5,pressed:true,cursorKind:1}];
test('cursor mapping accounts for source trims, speed, layout and hidden intervals',()=>{
 const p=createProject();p.canvas.width=200;p.canvas.height=100;
 const c={...clip,transform:{...clip.transform,x:.1,y:.2,width:.5,height:.5}};
 const mapped=cursorForTimeline([c],new Map([['m',media]]),new Map([['m',events]]),p.canvas);
 assert.deepEqual(mapped.map(p=>[p.time,p.visible]),[[0,false],[10,true],[11-1/30,true],[11,true],[12,false]]);
 assert.equal(mapped[1].x,.225);assert.equal(mapped[1].y,.45);assert.equal(mapped.find(p=>p.time===11)?.x,.475);assert.equal(mapped.find(p=>p.time===11)?.pressed,true);
});
test('cursor overlay survives an opaque upper video without sidecar but still respects source cropping',()=>{
 const p=createProject();p.canvas.width=100;p.canvas.height=100;
 const above={...clip,id:'above',mediaId:'unknown',zIndex:2,start:11,sourceOut:4};
 const c={...clip,transform:{...clip.transform,fit:'cover' as const}};
 const mapped=cursorForTimeline([c,above],new Map([['m',media]]),new Map([['m',[{...events[0],x:0}]]]),p.canvas);
 assert.ok(mapped.every(p=>p.visible===false));
 const contained=cursorForTimeline([clip,above],new Map([['m',media]]),new Map([['m',events]]),p.canvas);
 assert.equal(contained.find(p=>p.time===11)?.visible,true);
 assert.equal(contained.find(p=>p.time===11)?.x,.75);
 assert.equal(contained.find(p=>p.time===11)?.pressed,true);
});

test('cursor-bearing layers retain their order and visibility across split source pieces',()=>{
 const p=createProject();p.canvas.width=200;p.canvas.height=100;
 const upper:Clip={...clip,id:'upper',mediaId:'upper-media',zIndex:2,start:11,sourceIn:1,sourceOut:3};
 const lowerPieces=[{...clip,sourceOut:4},{...clip,id:'second',start:11,sourceIn:4}];
 const samples=new Map([['m',events],['upper-media',[{...events[0],x:.4,y:.6}]]]);
 const mapped=cursorForTimeline([...lowerPieces,upper],new Map([['m',media],['upper-media',{...media,id:'upper-media'}]]),samples,p.canvas);
 assert.equal(mapped.find(p=>p.time===10)?.x,.25);assert.equal(mapped.find(p=>p.time===11)?.x,.4);
 const hidden=cursorForTimeline([...lowerPieces,{...upper,transform:{...upper.transform,opacity:0}}],new Map([['m',media]]),samples,p.canvas);
 assert.equal(hidden.find(p=>p.time===11)?.x,.75);
});

test('sparse cursor events hold still until the next movement instead of drifting throughout a long pause',()=>{
 const p=createProject();p.canvas.width=200;p.canvas.height=100;
 const longClip={...clip,start:0,sourceIn:0,sourceOut:20,speed:1};
 const points=cursorForTimeline([longClip],new Map([['m',media]]),new Map([['m',[
  {time:0,x:.2,y:.3,pressed:false,cursorKind:1},
  {time:18,x:.8,y:.7,pressed:false,cursorKind:1},
  {time:18.03,x:.9,y:.7,pressed:false,cursorKind:1}
 ]]]),p.canvas);
 const prior=points.filter(point=>point.time<=17).at(-1)!;
 const next=points.find(point=>point.time>17)!;
 assert.equal(prior.x,.2);assert.equal(next.x,.2);assert.equal(next.time,18-1/30);
 assert.equal(points.find(point=>point.time===18)?.x,.8);
 assert.equal(points.filter(point=>point.time>18&&point.time<=18.03).length,1,'dense motion is not expanded');
 assert.equal(points.at(-1)?.visible,false,'clip end remains hidden');
});
