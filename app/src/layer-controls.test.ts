import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform,type Clip} from '../shared/types';
import {addTimelineLayer,renameTimelineLayer,removeTimelineLayer,clipCompositeOrder,moveClipsToLayer} from '../shared/timeline-layers';
const clip=(id:string,track:Clip['track'],layerId?:string):Clip=>({id,mediaId:id,name:id,track,layerId,start:2,sourceIn:3,sourceOut:9,speed:1.5,gain:.4,muted:false,zIndex:7,transform:{...defaultTransform(),shadow:{x:4,y:6,blur:8,color:'#00000080'}},effects:defaultEffects(),effectTiming:{sourceIn:0,sourceOut:12}});
test('Add creates empty video and audio rows above their own highest visible layer',()=>{
 const p=createProject();p.clips=[clip('camera','camera'),clip('voice','audio')];const before=structuredClone(p.clips);
 const video=addTimelineLayer(p,'video',()=> 'video'),audio=addTimelineLayer(p,'audio',()=> 'audio');
 assert.deepEqual(video,{id:'video',name:'Video layer 1',kind:'video',order:8});assert.deepEqual(audio,{id:'audio',name:'Audio layer 1',kind:'audio',order:8});assert.deepEqual(p.clips,before);
 assert.equal(addTimelineLayer(p,'video',()=> 'video2').name,'Video layer 2');assert.equal(p.timelineLayers![2].order,9);
});
test('Add validates kind, unique safe identity and bounds before mutating',()=>{
 const p=createProject();addTimelineLayer(p,'video',()=> 'one');const before=structuredClone(p);
 for(const action of [()=>addTimelineLayer(p,'bad' as any),()=>addTimelineLayer(p,'audio',()=> 'one'),()=>addTimelineLayer(p,'audio',()=> 'role:audio')]){assert.throws(action);assert.deepEqual(p,before);}
 p.timelineLayers=Array.from({length:2000},(_,i)=>({id:'r'+i,name:'Row '+i,kind:'video',order:i}));const full=structuredClone(p);assert.throws(()=>addTimelineLayer(p,'audio'),/2,000/);assert.deepEqual(p,full);
});
test('Rename changes only custom row label and rejects empty or oversized names',()=>{
 const p=createProject();addTimelineLayer(p,'video',()=> 'one');p.clips=[clip('camera','camera','one')];const before=structuredClone(p);
 assert.equal(renameTimelineLayer(p,'one','  Talking head  '),true);assert.equal(p.timelineLayers![0].name,'Talking head');assert.deepEqual(p.clips,before.clips);
 const renamed=structuredClone(p);for(const [id,name] of [['one',''],['one',' '.repeat(5)],['one','x'.repeat(201)],['role:camera','Camera 2'],['missing','Title']])assert.equal(renameTimelineLayer(p,id,name),false);assert.deepEqual(p,renamed);
});
test('Remove returns every live and archived clip to a compatible role, preserving content and all other fields',()=>{
 const p=createProject();addTimelineLayer(p,'video',()=> 'video');addTimelineLayer(p,'audio',()=> 'audio');
 p.clips=[clip('camera','camera','video'),clip('screen','screen','video'),clip('voice','audio','audio')];
 const archived=clip('archive','overlay','video');archived.recordingTakeId='take';p.recordedTakes=[{id:'take',createdAt:p.createdAt,sceneId:p.scenes[0].id,media:[],tracks:[],offsets:[],timeline:{duration:9,clips:[archived],captions:[{id:'cap',start:0,end:1,text:'Kept'}]}}];
 const before=structuredClone(p);assert.equal(removeTimelineLayer(p,'video'),true);
 assert.deepEqual(p.clips.map(c=>c.layerId),['role:camera','role:screen','audio']);assert.equal(p.recordedTakes[0].timeline!.clips[0].layerId,'role:overlay');
 const strip=(c:Clip)=>{const {layerId,...rest}=c;return rest;};assert.deepEqual(p.clips.map(strip),before.clips.map(strip));assert.deepEqual(strip(p.recordedTakes[0].timeline!.clips[0]),strip(before.recordedTakes![0].timeline!.clips[0]));assert.deepEqual(p.recordedTakes[0].timeline!.captions,before.recordedTakes![0].timeline!.captions);assert.deepEqual(p.media,before.media);
 assert.equal(clipCompositeOrder(p.clips[0],p),1,'Explicit default assignment must not resurrect old zIndex7');assert.deepEqual(p.timelineLayers?.map(r=>r.id),['audio']);
});
test('Removing an empty last row is safe and reserved or missing rows never change the document',()=>{
 const p=createProject();p.clips=[clip('camera','camera')];addTimelineLayer(p,'video',()=> 'empty');const content=structuredClone(p.clips);assert.equal(removeTimelineLayer(p,'empty'),true);assert.equal(p.timelineLayers,undefined);assert.deepEqual(p.clips,content);
 const before=structuredClone(p);for(const id of ['missing','role:camera','legacy:camera:7'])assert.equal(removeTimelineLayer(p,id),false);assert.deepEqual(p,before);
});
test('A single removal snapshot restores all assignments and drag-created rows remain editable',()=>{
 const p=createProject();p.clips=[clip('camera','camera')];moveClipsToLayer(p,new Set(['camera']),'camera',{kind:'new',beforeId:'legacy:camera:7',afterId:null},()=> 'drag-row');
 assert.equal(renameTimelineLayer(p,'drag-row','Interview'),true);const undo=structuredClone(p);removeTimelineLayer(p,'drag-row');assert.equal(p.clips[0].layerId,'role:camera');Object.assign(p,undo);assert.deepEqual(p,undo);assert.equal(clipCompositeOrder(p.clips[0],p),8);
});
