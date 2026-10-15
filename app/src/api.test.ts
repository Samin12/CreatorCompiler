import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform} from '../shared/types';
import type {Clip} from '../shared/types';
import {adoptSavedProject,apiResult,insertMedia,JSONBody,mapCaptionsToProject} from './api';

test('source captions are clipped and retimed through cuts, repeats and speeds without muted duplicates',()=>{
 const p=createProject('Caption mapping');
 const base:Clip={id:'a',mediaId:'source',name:'take',track:'audio',start:10,sourceIn:2,sourceOut:4,speed:2,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()};
 p.clips=[base,{...base,id:'b',start:20,speed:1},{...base,id:'c',track:'screen',muted:true},{...base,id:'d'}];
 const source=[{id:'s',start:1,end:5,text:'before inside after',words:[{text:'before',start:1,end:2},{text:'inside',start:2,end:4},{text:'after',start:4,end:5}]}];
 const result=mapCaptionsToProject(source,p,'source');
 assert.equal(result.length,2);
 assert.deepEqual(result.map(c=>({start:c.start,end:c.end,text:c.text})),[{start:10,end:11,text:'inside'},{start:20,end:22,text:'inside'}]);
 assert.deepEqual(result[0].words,[{text:'inside',start:10,end:11}]);
 assert.notEqual(result[0].id,result[1].id);
});

test('captions outside a used source interval do not leak past a trim boundary',()=>{
 const p=createProject();p.clips=[{id:'c',mediaId:'m',name:'trim',track:'audio',start:4,sourceIn:8,sourceOut:10,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
 const result=mapCaptionsToProject([{id:'1',start:0,end:7,text:'excluded'},{id:'2',start:9,end:12,text:'last phrase'}],p,'m');
 assert.equal(result.length,1);assert.equal(result[0].start,5);assert.equal(result[0].end,6);
});

test('a minimal save echo keeps the sent project, its key order and nested objects',()=>{
 const sent=createProject('Saved');sent.clips=[{id:'c',mediaId:'m',name:'clip',track:'screen',start:0,sourceIn:0,sourceOut:2,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
 const adopted=adoptSavedProject(sent,{minimal:true,id:sent.id,updatedAt:'2026-10-13T12:00:00.000Z'});
 assert.notEqual(adopted,sent);assert.equal(adopted.clips,sent.clips);assert.equal(adopted.canvas,sent.canvas);assert.equal(adopted.updatedAt,'2026-10-13T12:00:00.000Z');
 assert.equal(JSON.stringify(adopted),JSON.stringify({...JSON.parse(JSON.stringify(sent)),updatedAt:'2026-10-13T12:00:00.000Z'}));assert.deepEqual(Object.keys(adopted),Object.keys(sent));
 const full={...sent,name:'Normalized'};assert.equal(adoptSavedProject(sent,full),full,'a full response is adopted as before');
 assert.throws(()=>adoptSavedProject(sent,{minimal:true,id:'another',updatedAt:'x'}),/did not match/);assert.throws(()=>adoptSavedProject(sent,{minimal:true,id:sent.id}),/did not match/);
});

test('pre-serialized JSON bodies are sent unchanged',async()=>{
 const original=globalThis.fetch;let seen:RequestInit|undefined;globalThis.fetch=(async(_url:string,init:RequestInit)=>{seen=init;return new Response('{"ok":true}',{status:200,headers:{ETag:'"rev"'}});}) as typeof fetch;
 try{const result=await apiResult('/projects/p',new JSONBody('{"id":"p"}'),'PUT',{Prefer:'return=minimal'});assert.equal(seen?.body,'{"id":"p"}');assert.deepEqual(seen?.headers,{'Content-Type':'application/json',Prefer:'return=minimal'});assert.deepEqual(result,{data:{ok:true},etag:'"rev"'});
  await apiResult('/projects',{name:'x'});assert.equal(seen?.body,'{"name":"x"}');}
 finally{globalThis.fetch=original;}
});
test('media imported onto the camera track centers the face by default; other tracks keep neutral effects',()=>{const p=createProject(),video={id:'v',name:'Take',path:'/local/take.mp4',kind:'video' as const,duration:4,width:1280,height:720};insertMedia(p,[video],0,'camera');insertMedia(p,[{...video,id:'s'}],0,'screen');insertMedia(p,[{...video,id:'d'}]);assert.equal(p.clips[0].effects.faceCenter,true);assert.deepEqual(p.clips[1].effects,defaultEffects());assert.deepEqual(p.clips[2].effects,defaultEffects());});
