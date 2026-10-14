import {mock,test} from 'node:test';import assert from 'node:assert/strict';
import {createProject,clipDuration,projectDuration,makeId,type Caption,type Clip,type Media,type Project,type RecordedTake} from '../shared/types';
import {addTimelineLayer,moveClipsToLayer,removeTimelineLayer,renameTimelineLayer,timelineRows} from '../shared/timeline-layers';
import {applyCreatorLayout,creatorShadow} from '../shared/camera-style';
import {applyProjectChange,draftStats,plainClone} from './project-draft';
import {copySelection,deleteSelection,pasteSelection,splitAt,trimSelection} from './editing';
import {addRecordingScene,deleteRecordingScene,mergeRecordingSceneScriptBackward,moveRecordingScene,splitRecordingSceneScript} from './recording-scenes';
import {activateSceneTake,archiveSceneTake,confirmTake,deleteSceneTake,moveSceneTake,saveProjectTake,updateSceneTake} from './recorded-takes';
import {deleteTranscriptSelection} from './transcript-editing';
import {cutRange,insertMedia,mapCaptionsToProject} from './api';
import {create,isDraft} from 'mutative';

const NOW=Date.parse('2026-10-13T12:00:00.000Z'),STAMP='2026-10-13T12:00:01.000Z';
/** Runs with repeatable identifiers and clock, so two update paths can be compared exactly. */
function stable<T>(run:()=>T):T{let n=0;const uuid=mock.method(globalThis.crypto,'randomUUID',(()=>`id-${(++n).toString(36)}`) as typeof crypto.randomUUID);mock.timers.enable({apis:['Date'],now:NOW});try{return run();}finally{uuid.mock.restore();mock.timers.reset();}}
const deepFreeze=<T>(value:T):T=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;};
const take=(sceneId:string,id:string,duration:number):RecordedTake=>({id,sceneId,createdAt:'2026-10-13T00:00:00.000Z',media:(['screen','camera','microphone','system'] as const).map(role=>({id:`${id}-${role}`,name:`${id} ${role}`,path:`/fixture/${id}-${role}.${role==='screen'||role==='camera'?'mp4':'wav'}`,kind:role==='screen'||role==='camera'?'video':'audio',duration,width:1920,height:1080,fps:30,size:Math.round(duration*1e6),hasAudio:role==='microphone'||role==='system',...(role==='microphone'||role==='system'?{audioRole:role}:{})}) as Media),tracks:['screen','camera','audio','audio'],offsets:[0,.04,0,.02]});
/** A recorded, cut and captioned project shaped like a real long session (about 900 clips, 4,000 timed words and 1,400 cursor points). */
function studioProject():Project{return stable(()=>{
 const p=createProject('Fixture'),ids=[p.scenes[0].id];for(let i=1;i<10;i++)ids.push(addRecordingScene(p));
 ids.forEach((sceneId,i)=>{const scene=p.scenes.find(s=>s.id===sceneId)!;scene.name=`Scene ${i+1}`;scene.script=`Line ${i} of the script. `.repeat(30).trim();scene.notes=i%2?'Pause here.':'';const t=take(sceneId,`take-${i}`,38+i);saveProjectTake(p,t);confirmTake(p,{...t,mode:'replace-matching'});});
 const tailId=addRecordingScene(p);p.scenes.find(s=>s.id===tailId)!.script='A closing thought.';
 for(let t=1.7;t<projectDuration(p);t+=1.9)splitAt(p,t,new Set());
 const first=p.scenes[0];
 p.media.push({id:'music',name:'Theme',path:'/fixture/theme.m4a',kind:'audio',duration:120,width:0,height:0,hasAudio:true},{id:'logo',name:'Logo',path:'/fixture/logo.png',kind:'image',duration:0,width:512,height:512});
 insertMedia(p,[p.media.find(m=>m.id==='music')!],first.start+1,'music');const music=p.clips.at(-1)!;music.sourceOut=first.duration-3;music.gain=.3;
 insertMedia(p,[p.media.find(m=>m.id==='logo')!],first.start+2,'overlay');const logo=p.clips.at(-1)!;logo.sourceOut=4;logo.zIndex=5;logo.transform={...logo.transform,x:.8,y:.05,width:.15,height:.15,shadow:creatorShadow(p.canvas)};
 const captions:Caption[]=[];let caption=0;
 for(const scene of p.scenes)for(let t=scene.start+.2;t+.6<scene.start+scene.duration-.2;t+=.63){const words=Array.from({length:6},(_,i)=>({text:`word${caption}-${i}${i===5?'.':''}`,start:t+i*.1,end:t+i*.1+.09}));captions.push({id:`caption-${caption++}`,start:t,end:t+.59,text:words.map(w=>w.text).join(' '),words});}
 p.captions=captions;
 for(const scene of p.scenes.slice(0,5))for(let t=scene.start;t<scene.start+scene.duration;t+=.14)p.cursor.points.push({time:t,x:(t*7%100)/100,y:(t*3%100)/100,...(Math.round(t*10)%17===0?{pressed:true}:{}),...(Math.round(t*10)%53===0?{visible:false}:{})});
 p.cursor.enabled=true;
 p.scenes.forEach((scene,i)=>{if(!scene.duration)return;p.elements.push({id:`title-${i}`,type:'text',start:scene.start+1,duration:3,text:`Chapter ${i+1}`,x:.1,y:.1,width:.6,height:.15,color:'#ffffff',background:'#171b27bb',fontSize:64,opacity:1,rotation:0},{id:`box-${i}`,type:'highlight',start:scene.start+6,duration:2,text:'',x:.3,y:.4,width:.2,height:.1,color:'#ffffff',background:'#bba6ff66',fontSize:64,opacity:.8,rotation:0});p.zooms.push({id:`zoom-${i}`,start:scene.start+10,duration:3,scale:1.6,x:.4,y:.6,target:'screen',easing:'smooth'});});
 const layer=addTimelineLayer(p,'video');moveClipsToLayer(p,new Set(p.clips.filter(c=>c.track==='camera').slice(0,40).map(c=>c.id)),p.clips.find(c=>c.track==='camera')!.id,{kind:'existing',rowId:layer.id});addTimelineLayer(p,'audio');
 p.importWarnings=['Two unsupported transitions were removed.','A blend mode was converted to normal.'];
 p.importMetadata={sourceApp:'Borumi',sourceVersion:'4.2',unmappedSegments:Array.from({length:1500},(_,i)=>({id:`segment-${i}`,start:i*.3,end:i*.3+.25,kind:i%3?'cut':'transition',payload:{curve:[0,.25,.5,.75,1],label:`Segment ${i}`}}))};
 p.notes='Fixture notes';
 return p;
});}
const fixture=deepFreeze(studioProject());
const keys=Object.keys(fixture) as Array<keyof Project>;
/** Runs one mutator through the old full-copy path and the structural path and requires identical results (or identical errors). */
function compare(name:string,fn:(p:Project)=>void,untouched:Array<keyof Project>=[],base:Project=fixture){
 const fallbacks=draftStats.fallbacks,before=JSON.stringify(base);
 const full=stable(()=>{try{const next=structuredClone(base);fn(next);next.updatedAt=STAMP;return {next};}catch(error){return {error:(error as Error).message};}});
 const shared=stable(()=>{try{return {next:applyProjectChange(base,fn,STAMP)};}catch(error){return {error:(error as Error).message};}});
 assert.equal(draftStats.fallbacks,fallbacks,`${name} needed the full-copy fallback`);
 assert.equal(JSON.stringify(base),before,`${name} changed its base`);
 assert.deepEqual(shared,full,`${name} differs from the full-copy result`);
 if(!shared.next)return shared;
 for(const key of untouched)assert.equal(shared.next[key],base[key],`${name} copied the untouched ${key}`);
 return shared;
}
const same=(name:string,fn:(p:Project)=>void,untouched:Array<keyof Project>=[],base:Project=fixture)=>{const result=compare(name,fn,untouched,base);assert.ok(result.next,`${name} failed: ${result.error}`);return result;};
const fails=(name:string,fn:(p:Project)=>void,message:RegExp,base:Project=fixture)=>assert.match(compare(name,fn,[],base).error??'',message,`${name} should be refused`);
const clipAt=(p:Project,track:Clip['track'],index=0)=>p.clips.filter(c=>c.track===track)[index];
const sceneWithTake=(p:Project,i:number)=>p.scenes.find(s=>s.name===`Scene ${i+1}`)!;

test('the fixture is a realistic long recording',()=>{
 assert.ok(fixture.clips.length>850,`${fixture.clips.length} clips`);assert.ok(fixture.captions.length>600);assert.ok(fixture.captions.reduce((n,c)=>n+(c.words?.length??0),0)>3600);assert.ok(fixture.cursor.points.length>1300);
 assert.equal(fixture.recordedTakes?.length,10);assert.ok(JSON.stringify(fixture).length>800_000);
});

test('inspector edits match full copies and keep every untouched subtree',()=>{
 const others:Array<keyof Project>=['scenes','media','captions','elements','zooms','cursor','recordedTakes','timelineLayers','importMetadata','importWarnings','settings','captionStyle'];
 const padding=same('canvas padding',p=>{p.canvas.padding=96;},['clips',...others]).next!;assert.notEqual(padding.canvas,fixture.canvas);assert.equal(padding.updatedAt,STAMP);
 same('frame size',p=>{p.canvas.width=1080;p.canvas.height=1920;},['clips',...others]);
 same('background pattern removal',p=>{delete p.canvas.backgroundPattern;},['clips',...others]);
 const target=clipAt(fixture,'camera',3).id,update=(fn:(c:Clip)=>void)=>(p:Project)=>{const c=p.clips.find(c=>c.id===target);if(c)fn(c);};
 const moved=same('clip geometry',update(c=>{c.transform.x=.42;}),['canvas',...others]).next!;
 const index=fixture.clips.findIndex(c=>c.id===target);assert.ok(moved.clips.every((c,i)=>i===index?c!==fixture.clips[i]&&c.effects===fixture.clips[i].effects:c===fixture.clips[i]),'only the edited clip is copied');
 same('clip shadow on',update(c=>{c.transform.shadow=creatorShadow(fixture.canvas);}),others);
 same('clip shadow color',p=>{const c=p.clips.find(c=>c.transform.shadow);if(c?.transform.shadow)c.transform.shadow.color=c.transform.shadow.color.slice(0,7)+'80';},others);
 same('clip shadow off',p=>{const c=p.clips.find(c=>c.transform.shadow);if(c)delete c.transform.shadow;},others);
 same('clip effects',update(c=>{c.effects.brightness=.3;c.effects.background='blur';c.effects.faceCenter=true;}),others);
 same('clip track',update(c=>{c.track='overlay';}),others);
 same('clip timing',update(c=>{c.start+=.5;c.sourceIn=.2;c.speed=1.5;}),others);
 same('creator layout',p=>applyCreatorLayout(p),others);
 same('picture in picture',p=>{for(const c of p.clips){if(c.track==='screen')Object.assign(c.transform,{x:0,y:0,width:1,height:1});if(c.track==='camera')Object.assign(c.transform,{x:.72,y:.63,width:.25,height:.32,borderRadius:28});}},others);
 same('normalize all clips',p=>{for(const c of p.clips){c.effects.normalize=true;}},others);
 same('close video gaps',p=>{let next=0;for(const c of [...p.clips].filter(c=>c.track==='screen').sort((a,b)=>a.start-b.start)){c.start=next;next+=clipDuration(c);}},others);
 same('music volume',p=>{const clip=p.clips.find(x=>x.track==='music');if(clip)clip.gain=.7;},others);
 same('remove clip',p=>{p.clips=p.clips.filter(x=>x.id!==target);},others);
 same('add music from the library',p=>insertMedia(p,[fixture.media.find(m=>m.id==='music')!],0,'music'));
 const element=fixture.elements[3].id;
 same('element text',p=>{const e=p.elements.find(e=>e.id===element);if(e)e.text='Edited';},['clips','captions','scenes','media','cursor','recordedTakes','canvas']);
 same('add element',p=>p.elements.push({id:makeId(),type:'arrow',start:12,duration:5,text:'',x:.15,y:.65,width:.7,height:.22,color:'#ffffff',background:'transparent',fontSize:64,opacity:1,rotation:0}),['clips','captions','scenes']);
 same('remove element',p=>{p.elements=p.elements.filter(e=>e.id!==element);},['clips','captions','zooms']);
 same('add zoom',p=>p.zooms.push({id:makeId(),start:20,duration:3,scale:1.5,x:.5,y:.5,target:'camera',easing:'smooth'}),['clips','captions','elements']);
 same('zoom field',p=>{const z=p.zooms[2];z.scale=2.5;z.x=.3;},['clips','captions','elements']);
 same('remove zoom',p=>{p.zooms=p.zooms.filter(z=>z.id!==fixture.zooms[1].id);},['clips','captions','elements']);
 same('caption style',p=>{p.captionStyle.enabled=false;p.captionStyle.fontSize=60;p.captionStyle.color='#ffee00';p.captionStyle.position='top';},['clips','captions','scenes','cursor']);
 same('add caption lines',p=>{for(let i=0;i<3;i++)p.captions.push({id:makeId(),start:30+i*3,end:30+(i+1)*3,text:`Line ${i}`});},['clips','scenes','cursor']);
 same('caption text and timing',p=>{const c=p.captions[40];c.text='Edited caption';c.start+=.01;c.end+=.01;},['clips','scenes','cursor']);
 same('remove caption',p=>{p.captions=p.captions.filter(c=>c.id!==fixture.captions[7].id);},['clips','scenes','cursor']);
 same('cursor settings',p=>{p.cursor.enabled=false;p.cursor.size=40;p.cursor.color='#ff0000';p.cursor.highlight=true;},['clips','captions','scenes']);
 same('cursor keyframes',p=>{p.cursor.enabled=true;p.cursor.points.push({time:61.3,x:.5,y:.5});p.cursor.points.sort((a,b)=>a.time-b.time);},['clips','captions']);
 same('cursor keyframe field and delete',p=>{p.cursor.points[3].x=.9;p.cursor.points[5].y=.1;p.cursor.points.splice(8,1);},['clips','captions']);
 same('settings and notes',p=>{p.settings.snap=!p.settings.snap;p.settings.ripple=false;p.settings.previewQuality='original';p.settings.teleprompterFontSize=72;p.settings.teleprompterSpeed=40;p.settings.teleprompterMirror=true;p.notes='Edited notes';p.name='Renamed';},['clips','captions','scenes','cursor','media','canvas']);
});

test('timeline editing operations match full copies',()=>{
 const scene=sceneWithTake(fixture,4),inside=scene.start+scene.duration/2,crossing=fixture.clips.filter(c=>c.start<inside&&c.start+clipDuration(c)>inside);
 same('split everything at the playhead',p=>{splitAt(p,inside,new Set());},['captions','media','scenes','cursor','recordedTakes']);
 same('split one selected clip',p=>{splitAt(p,inside,new Set([crossing[0].id]),crossing[0].id);},['captions','media','scenes']);
 const selection=new Set([...fixture.clips.slice(100,104).map(c=>c.id),fixture.elements[2].id,fixture.captions[30].id,fixture.zooms[1].id]);
 same('ripple delete',p=>deleteSelection(p,selection,true),['media','scenes','cursor','recordedTakes']);
 same('delete leaving a gap',p=>deleteSelection(p,selection,false),['media','scenes','cursor']);
 const trimmed=new Set([crossing[1].id]);
 same('trim left',p=>{trimSelection(p,trimmed,inside,'left');},['captions','media']);
 same('trim right',p=>{trimSelection(p,trimmed,inside,'right');},['captions','media']);
 const clipboard=copySelection(fixture,selection)!;
 same('paste clipboard',p=>{pasteSelection(p,clipboard,inside);},['scenes','cursor','recordedTakes']);
 same('duplicate from a draft copy',p=>{const data=copySelection(p,selection)!;pasteSelection(p,data,projectDuration(p));},['scenes','cursor']);
 const media:Media={id:'imported',name:'Import',path:'/fixture/import.mov',kind:'video',duration:12,width:1280,height:720,hasAudio:true};
 same('insert imported media',p=>insertMedia(p,[media],undefined,'screen'),['captions','scenes','cursor','recordedTakes']);
 const layer=fixture.timelineLayers!.find(row=>row.kind==='video')!.id;
 same('drop media onto a layer',p=>{const before=p.clips.length;insertMedia(p,[media],40,'overlay');const ids=p.clips.slice(before).map(c=>c.id);if(ids.length)moveClipsToLayer(p,new Set(ids),ids[0],{kind:'existing',rowId:layer});},['captions','scenes']);
 const moving=new Set(fixture.clips.filter(c=>c.track==='camera').slice(50,53).map(c=>c.id)),anchor=[...moving][0];
 same('drag clips in time',p=>{for(const clip of p.clips)if(moving.has(clip.id))clip.start+=1.25;},['captions','media','scenes']);
 same('drag clips onto an existing layer',p=>{for(const clip of p.clips)if(moving.has(clip.id))clip.start+=.5;moveClipsToLayer(p,moving,anchor,{kind:'existing',rowId:layer});},['captions','media']);
 const rows=timelineRows(fixture).filter(row=>row.kind==='video');
 same('drag clips onto a new layer',p=>{moveClipsToLayer(p,moving,anchor,{kind:'new',beforeId:rows[0].id,afterId:null});},['captions','media','scenes']);
 same('trim handle release',p=>{const clip=p.clips.find(item=>item.id===anchor);if(clip)Object.assign(clip,{start:clip.start+.2,sourceIn:clip.sourceIn+.2,sourceOut:clip.sourceOut});},['captions','media']);
 same('add layer',p=>{addTimelineLayer(p,'video');},['clips','captions','media','scenes']);
 same('rename layer',p=>{renameTimelineLayer(p,layer,'B-roll');},['clips','captions','media']);
 same('remove layer',p=>{removeTimelineLayer(p,layer);},['captions','media','scenes']);
 same('toggle snapping',p=>{p.settings.snap=!p.settings.snap;},['clips','captions','scenes','media']);
 same('delete transcript words',p=>{deleteTranscriptSelection(p,{anchor:120,focus:131});},['media','recordedTakes']);
 const transcript=mapCaptionsToProject([{id:'source',start:1,end:3,text:'Fresh words here',words:[{text:'Fresh',start:1,end:1.5},{text:'words',start:1.5,end:2},{text:'here',start:2,end:3}]}],fixture,'take-2-microphone');
 same('append transcription',p=>{p.captions=[...p.captions,...transcript].sort((a,b)=>a.start-b.start);},['clips','scenes','media']);
 same('apply AI cuts and script',p=>{for(const s of [{start:30,end:31.5},{start:12,end:12.4}])cutRange(p,s.start,s.end,true);const target=p.scenes.find(s=>s.id===scene.id);if(target)target.script='Refined script';},['media']);
});

test('script, scene and recorded take operations match full copies',()=>{
 const scene=sceneWithTake(fixture,3),tail=fixture.scenes.at(-1)!;
 same('scene name',p=>{const s=p.scenes.find(s=>s.id===scene.id);if(s)s.name='Renamed scene';},['clips','captions','media','cursor','recordedTakes']);
 same('scene script',p=>{const s=p.scenes.find(s=>s.id===scene.id);if(s)s.script=`${s.script} More.`;},['clips','captions','media','cursor','recordedTakes']);
 same('add scene',p=>p.scenes.push({id:makeId(),name:`Scene ${p.scenes.length+1}`,script:'',notes:'',start:projectDuration(p),duration:0}),['clips','captions']);
 same('add recording scene after',p=>{addRecordingScene(p,scene.id);},['clips','captions','media']);
 same('split script into a new scene',p=>{splitRecordingSceneScript(p,scene.id,12);});
 same('merge a script-only scene backward',p=>{mergeRecordingSceneScriptBackward(p,tail.id);});
 fails('merge refuses recorded scenes',p=>{mergeRecordingSceneScriptBackward(p,scene.id);},/recordings or timeline content/);
 same('move scene earlier',p=>{moveRecordingScene(p,scene.id,fixture.scenes[1].id);});
 same('move scene to the end',p=>{moveRecordingScene(p,fixture.scenes[1].id);});
 same('delete scene',p=>{deleteRecordingScene(p,sceneWithTake(fixture,7).id);});
 const later=sceneWithTake(fixture,8),alternate=take(later.id,'alt-8',20);
 same('save a new take',p=>{const saved=saveProjectTake(p,alternate);saved.retained=true;},['clips','captions','scenes','cursor']);
 same('save an existing take again',p=>{saveProjectTake(p,take(later.id,'take-8',46));});
 same('activate a saved take alongside',p=>{saveProjectTake(p,alternate);activateSceneTake(p,later.id,alternate.id,'keep-both');});
 same('confirm a durable take',p=>{confirmTake(p,{...alternate,mode:'keep-both'});});
 same('confirm an imported take',p=>{const imported:RecordedTake={id:makeId(),createdAt:new Date().toISOString(),sceneId:later.id,name:'Imported',media:[{id:'imported-take',name:'Imported',path:'/fixture/imported.mov',kind:'video',duration:9,width:1280,height:720,hasAudio:true}],tracks:['screen'],offsets:[0],clipIds:[makeId()],retained:true};saveProjectTake(p,imported);confirmTake(p,{...imported,mode:'keep-both'});});
 same('confirm a legacy take',p=>{confirmTake(p,{media:alternate.media,tracks:alternate.tracks,offsets:alternate.offsets,sceneId:later.id});});
 fails('archiving the only take keeps graphics inside the scene',p=>{saveProjectTake(p,take(later.id,'take-8',46));archiveSceneTake(p,'take-8');},/graphic or zoom extends/);
 fails('deleting the only take keeps graphics inside the scene',p=>{deleteSceneTake(p,'take-8');},/graphic or zoom extends/);
 const both=deepFreeze(stable(()=>{const p=structuredClone(fixture);saveProjectTake(p,alternate);activateSceneTake(p,later.id,alternate.id,'keep-both');return p;}));
 same('archive one of two active takes',p=>{saveProjectTake(p,take(later.id,'take-8',46));archiveSceneTake(p,'take-8');},[],both);
 same('delete one of two active takes',p=>{deleteSceneTake(p,'take-8');},[],both);
 same('reactivate an archived take',p=>{archiveSceneTake(p,'take-8');activateSceneTake(p,later.id,'take-8','keep-both');},[],both);
 same('move a take to another scene',p=>{saveProjectTake(p,alternate);moveSceneTake(p,alternate.id,sceneWithTake(fixture,9).id);});
 same('move a take and archive it',p=>{moveSceneTake(p,'take-8',sceneWithTake(fixture,9).id,true);},[],both);
 same('rename and resync a take',p=>{updateSceneTake(p,'take-8',{name:'Best take',offsets:[0,.1,0,.05]});});
 same('rename a saved take',p=>{saveProjectTake(p,alternate);updateSceneTake(p,alternate.id,{name:'Alternate'});});
});

test('a failed edit rethrows and leaves no partial update',()=>{
 const fallbacks=draftStats.fallbacks;
 assert.throws(()=>applyProjectChange(fixture,p=>{p.name='Half';throw new Error('The project changed before this take could be saved.');}),/before this take could be saved/);
 assert.equal(fixture.name,'Fixture');assert.equal(draftStats.fallbacks,fallbacks);
});

test('a draft-only failure is retried once on a full copy and reported',()=>{
 const warn=mock.method(console,'warn',()=>{});
 try{
  const fallbacks=draftStats.fallbacks;
  const next=applyProjectChange(fixture,p=>{p.clips.push({...structuredClone(p.clips[0]),id:'copied'});},STAMP);
  assert.equal(draftStats.fallbacks,fallbacks+1);assert.equal(next.clips.at(-1)!.id,'copied');assert.deepEqual(next.clips.at(-1)!.transform,fixture.clips[0].transform);assert.equal(next.updatedAt,STAMP);
  // A draft kept after its edit cannot be repaired by the retry, so the error still reaches the caller.
  let leaked:Project|undefined;applyProjectChange(fixture,p=>{leaked=p;});
  assert.throws(()=>applyProjectChange(fixture,p=>{p.name=leaked!.name;}),/revoked/);assert.equal(draftStats.fallbacks,fallbacks+2);assert.equal(fixture.name,'Fixture');
  assert.ok(warn.mock.callCount()<=1,'the fallback is reported once');
  assert.throws(()=>applyProjectChange(fixture,()=>{(undefined as unknown as {x:number}).x=1;}),TypeError);
 }finally{warn.mock.restore();}
});

test('edits that return a value still apply',()=>{
 const next=applyProjectChange(fixture,p=>p.elements.push({...fixture.elements[0],id:'pushed'}) as unknown as void,STAMP);
 assert.equal(next.elements.at(-1)!.id,'pushed');assert.equal(next.clips,fixture.clips);
});

test('plain copies of drafts and draft-holding values are independent and exact',()=>{
 const source={clip:fixture.clips[0],list:[fixture.captions[0]],missing:undefined as undefined|number};
 assert.deepEqual(plainClone(source),structuredClone(source));assert.ok(Object.hasOwn(plainClone(source),'missing'));
 create(fixture,draft=>{
  draft.clips[0].transform.x=.5;
  const copy=plainClone(draft.clips[0]);assert.equal(isDraft(copy),false);assert.equal(copy.transform.x,.5);assert.notEqual(copy.transform,fixture.clips[0].transform);
  const holder=plainClone({clip:draft.clips[0],captions:[draft.captions[1]]});assert.equal(holder.clip.transform.x,.5);assert.equal(isDraft(holder.captions[0]),false);assert.deepEqual(holder.captions[0],fixture.captions[1]);
  copy.transform.y=9;assert.notEqual(draft.clips[0].transform.y,9);
 });
});
