import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createProject,defaultTransform,defaultEffects,type Project,type Clip,type Job} from '../shared/types.js';
import {clipCompositeOrder} from '../shared/timeline-layers.js';
import {clipShadow,clipShadowCss} from '../shared/clip-shadow.js';
import {validateProject,revision} from './storage.js';
import {ExportStore} from './export-store.js';
import {startExport,getJob,probeMedia,inspectFrames,type RenderLifecycle} from './media.js';
import {importBorumi} from './importer.js';
import {planBorumiRoundtrip,exportBorumiRoundtrip} from './borumi-roundtrip.js';
import {planNewBorumiProject} from './borumi-new-project.js';

function fixture():Project{
 const p=createProject('Layer and shadow fixture');p.canvas={width:192,height:144,fps:30,background:'#004080',padding:0,radius:0};p.scenes[0].duration=1;
 p.media=[{id:'media',name:'Synthetic',path:path.join(os.tmpdir(),'synthetic-layer-source.mp4'),kind:'video',width:192,height:144,duration:1}];
 p.clips=[{id:'clip',mediaId:'media',name:'Synthetic',track:'camera',start:0,sourceIn:0,sourceOut:1,speed:1,gain:1,muted:true,transform:defaultTransform(),effects:defaultEffects()}];
 return p;
}

test('layer assignments validate type, reference and source kind; malformed shadows are rejected',()=>{
 const p=fixture();p.timelineLayers=[{id:'upper',name:'Upper',kind:'video',order:4}];p.clips[0].layerId='upper';p.clips[0].transform.shadow={x:-12,y:9,blur:7,color:'#b020ff80'};
 assert.equal(validateProject(p),p);
 const invalid:Array<[string,(q:Project)=>void]>=[
  ['layer list',(q)=>{(q as any).timelineLayers={};}],['null layer',(q)=>{(q as any).timelineLayers=[null];}],
  ['duplicate layer',(q)=>{q.timelineLayers!.push({...q.timelineLayers![0]});}],['invalid kind',(q)=>{(q.timelineLayers![0] as any).kind='shape';}],
  ['invalid order',(q)=>{q.timelineLayers![0].order=NaN;}],['empty name',(q)=>{q.timelineLayers![0].name=' ';}],
  ['missing layer',(q)=>{q.clips[0].layerId='gone';}],['cross-kind custom layer',(q)=>{q.timelineLayers![0].kind='audio';}],
  ['array layer reference',(q)=>{(q.clips[0] as any).layerId=['role:screen'];}],
  ['cross-kind role',(q)=>{q.clips[0].layerId='role:audio';}],['invalid shadow number',(q)=>{q.clips[0].transform.shadow!.x=NaN;}],
  ['negative blur',(q)=>{q.clips[0].transform.shadow!.blur=-1;}],['nonrgba color',(q)=>{q.clips[0].transform.shadow!.color='#ffffff';}],
  ...[null,false,0,''].map(value=>['nonobject shadow '+String(value),(q:Project)=>{(q.clips[0].transform as any).shadow=value;}] as [string,(q:Project)=>void]),
 ];
 for(const [label,mutate] of invalid){const q=structuredClone(p);mutate(q);assert.throws(()=>validateProject(q),Error,label);}
 const role=structuredClone(p);role.clips[0].layerId='role:screen';assert.doesNotThrow(()=>validateProject(role));
});

test('explicit layers override order without changing legacy zIndex, source roles or shadow units',()=>{
 const p=fixture(),c=p.clips[0];c.zIndex=-1000;assert.equal(clipCompositeOrder(c,p),-1000);
 p.timelineLayers=[{id:'upper',name:'Upper',kind:'video',order:9}];c.layerId='upper';assert.equal(clipCompositeOrder(c,p),9);assert.equal(c.zIndex,-1000);assert.equal(c.track,'camera');
 c.layerId='role:overlay';assert.equal(clipCompositeOrder(c,p),2);delete c.layerId;assert.equal(clipCompositeOrder(c,p),-1000);
 c.transform.shadow={x:-10,y:20,blur:12,color:'#ff008080'};
 assert.deepEqual(clipShadow(c.transform,.5),{x:-5,y:10,blur:6,r:255,g:0,b:128,alpha:128/255});assert.match(clipShadowCss(c.transform,.5),/drop-shadow\(-5px 10px 3px rgba\(255, 0, 128,/);
 c.transform.shadow.color='#ff008000';assert.equal(clipShadow(c.transform),null);
});

test('disk save/reopen and durable saved-version restart retain layers and nested shadows',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-layer-persistence-')),p=fixture();let store:ExportStore|undefined;
 try{
  p.timelineLayers=[{id:'foreground',name:'Foreground',kind:'video',order:5}];p.clips[0].layerId='foreground';p.clips[0].transform.shadow={x:20,y:12,blur:12,color:'#ff0000cc'};
  const input=path.join(dir,'input.json');await fs.writeFile(input,JSON.stringify(p));
  // Isolated process is important: importing storage here must never redirect or write the user's data directory.
  const code="import{readFile}from'node:fs/promises';import{initStorage,saveProject,readProject}from'./server/storage.ts';await initStorage();const p=JSON.parse(await readFile(process.argv[1],'utf8'));await saveProject(p);console.log(JSON.stringify(await readProject(p.id)));";
  const saved=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code,input],{cwd:process.cwd(),env:{...process.env,SCENEFORGE_DATA_DIR:path.join(dir,'data')},encoding:'utf8'});
  assert.equal(saved.status,0,saved.stderr);const reopened:Project=JSON.parse(saved.stdout.trim());assert.deepEqual(reopened.timelineLayers,p.timelineLayers);assert.deepEqual(reopened.clips,p.clips);
  const source=path.join(dir,'source.bin');await fs.writeFile(source,'synthetic source');p.media[0].path=source;
  const renders:Array<{project:Project;job:Job;life:RenderLifecycle}>=[];
  const renderer={start(project:Project,_options:unknown,_out:string,life:RenderLifecycle){const job=life.initialJob!;renders.push({project:structuredClone(project),job,life});return job;},cancel(id:string){return renders.find(r=>r.job.id===id)?.job;}};
  store=new ExportStore(path.join(dir,'history'),path.join(dir,'out'),renderer,async()=>'unchanged-test-renderer');await store.init();
  const original=structuredClone(p),before=revision(p),record=await store.create(p,{format:'mp4'});p.timelineLayers[0].order=-9;p.clips[0].transform.shadow!.color='#000000ff';assert.notEqual(revision(p),before);
  await store.shutdown(async()=>{});store=new ExportStore(path.join(dir,'history'),path.join(dir,'out'),renderer,async()=>'unchanged-test-renderer');await store.init();
  assert.equal((await store.get(record.id)).status,'interrupted');await store.restart(record.id);assert.deepEqual(renders[1].project,original);
  await store.shutdown(async()=>{});store=undefined;
  const snapshotFile=path.join(dir,'history',record.id+'.snapshot.json'),tampered=JSON.parse(await fs.readFile(snapshotFile,'utf8'));tampered.clips[0].transform.shadow.blur=99;await fs.writeFile(snapshotFile,JSON.stringify(tampered));
  store=new ExportStore(path.join(dir,'history'),path.join(dir,'out'),renderer,async()=>'unchanged-test-renderer');await store.init();await assert.rejects(store.restart(record.id),/snapshot changed or is corrupt/);
 }finally{await store?.shutdown(async()=>{});await fs.rm(dir,{recursive:true,force:true});}
});

test('new and preserved Borumi copy export block custom layers and edited shadows without creating output',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-layer-compat-')),bundle=path.join(root,'source.bmprojbundle'),preservationRoot=path.join(root,'preserved'),outputRoot=path.join(root,'output');
 try{
  await fs.mkdir(path.join(bundle,'medias'),{recursive:true});await fs.writeFile(path.join(bundle,'medias','m.mov'),'synthetic source');
  const file=path.join(bundle,'project.bmproj'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE projects(id TEXT,name TEXT,render_target TEXT);CREATE TABLE scenes(id TEXT,project_id TEXT,seq TEXT,name TEXT,script TEXT);CREATE TABLE clips(id TEXT,media TEXT,start_offset REAL,duration REAL);CREATE TABLE medias(id TEXT,project_id TEXT,name TEXT,tracks TEXT,duration REAL,width INT,height INT);CREATE TABLE scene_timeline_segments(id TEXT,scene_id TEXT,start REAL,duration REAL,edited INT,segment_order INT,kind TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('p','Synthetic',JSON.stringify({mode:{kind:'Generic',width:192,height:144}}));db.prepare('INSERT INTO scenes VALUES(?,?,?,?,?)').run('s','p','a','Scene','');db.prepare('INSERT INTO clips VALUES(?,?,?,?)').run('c','m',0,1);db.prepare('INSERT INTO medias VALUES(?,?,?,?,?,?,?)').run('m','p','Synthetic','[{"kind":"Video"}]',1,192,144);db.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?,?)').run('v','s',0,1,0,0,JSON.stringify({kind:'VideoClip',clip_id:'c',clip_start:0,content_kind:{kind:'Camera'},futureStyle:{retain:true}}));db.close();
  const original=await fs.readFile(file),p=await importBorumi(bundle,{roundtripDirectory:preservationRoot});assert.equal((await planBorumiRoundtrip(p,preservationRoot)).supported,true);
  p.timelineLayers=[{id:'new',name:'New row',kind:'video',order:8}];p.clips[0].layerId='new';assert.ok((await planBorumiRoundtrip(p,preservationRoot)).blockers.some(b=>/Custom timeline layers/.test(b)));assert.ok(planNewBorumiProject(p).blockers.some(b=>/Custom timeline layers/.test(b)));
  await assert.rejects(exportBorumiRoundtrip(p,{preservationRoot,outputRoot}),/export blocked/);await assert.rejects(fs.stat(outputRoot),/ENOENT/);
  delete p.timelineLayers;delete p.clips[0].layerId;p.clips[0].transform.shadow={x:4,y:4,blur:5,color:'#00000080'};
  assert.equal((await planBorumiRoundtrip(p,preservationRoot)).supported,false);assert.ok(planNewBorumiProject(p).blockers.some(b=>/shadows/.test(b)));assert.deepEqual(await fs.readFile(file),original);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

const ffmpeg=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
function command(args:string[]){const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{maxBuffer:32*1024*1024});assert.equal(result.status,0,result.stderr.toString());return result.stdout;}
async function render(p:Project,out:string){const job=startExport(p,{format:'mp4',quality:'high',hardware:false,burnCaptions:false},out),deadline=Date.now()+60000;for(;;){const current=getJob(job.id)!;if(!['queued','running'].includes(current.status)){assert.equal(current.status,'complete',current.error||current.message);return current.outputPath!;}if(Date.now()>deadline)throw Error('Test render timed out');await new Promise(r=>setTimeout(r,20));}}
const pixel=(bytes:Buffer,x:number,y:number,width=192)=>[...bytes.subarray((y*width+x)*3,(y*width+x)*3+3)];
const frame=(file:string)=>command(['-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);

test('actual MP4 and inspection pixels follow explicit layer order while untouched legacy z remains exact', {timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-layer-pixels-'));
 try{
  const p=fixture();p.media=[];p.clips=[];
  for(const [i,color]of ['blue','red'].entries()){const file=path.join(dir,color+'.mp4');command(['-f','lavfi','-i',`color=c=${color}:s=192x144:r=30:d=0.3`,'-c:v','libx264','-pix_fmt','yuv420p',file]);const media=await probeMedia(file,path.join(dir,'cache'));p.media.push(media);p.clips.push({id:color,mediaId:media.id,name:color,track:i?'camera':'screen',start:0,sourceIn:0,sourceOut:.3,speed:1,gain:1,muted:true,zIndex:i?-10:10,transform:defaultTransform(),effects:defaultEffects()});}
  p.scenes[0].duration=.3;const before=structuredClone(p.clips),legacy=frame(await render(p,path.join(dir,'out')));assert.ok(pixel(legacy,96,72)[2]>220);assert.ok(pixel(legacy,96,72)[0]<20);
  p.timelineLayers=[{id:'upper',name:'Upper',kind:'video',order:11}];p.clips[1].layerId='upper';const layered=frame(await render(p,path.join(dir,'out')));assert.ok(pixel(layered,96,72)[0]>220);assert.ok(pixel(layered,96,72)[2]<20);assert.deepEqual(p.clips.map(c=>c.zIndex),before.map(c=>c.zIndex));
  const inspection=await inspectFrames(p,[0],path.join(dir,'inspect'),{width:192});assert.ok(pixel(frame(inspection[0].path),96,72)[0]>220);
  delete p.clips[1].layerId;delete p.timelineLayers;assert.deepEqual(frame(await render(p,path.join(dir,'out'))),legacy,'Removing explicit assignment restores every decoded legacy RGB pixel');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('actual rounded camera shadow is colored, offset, blurred and visible outside the clip without filling transparent corners',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-shadow-pixels-'));
 try{
  const file=path.join(dir,'white.mp4');command(['-f','lavfi','-i','color=c=white:s=64x48:r=30:d=0.3','-c:v','libx264','-pix_fmt','yuv420p',file]);const p=fixture(),media=await probeMedia(file,path.join(dir,'cache'));p.media=[media];p.clips[0].mediaId=media.id;p.clips[0].sourceOut=.3;p.scenes[0].duration=.3;
  p.clips[0].transform={...defaultTransform(),x:.25,y:1/3,width:1/3,height:1/3,fit:'cover',borderRadius:16};
  const control=frame(await render(p,path.join(dir,'out')));p.clips[0].transform.shadow={x:20,y:12,blur:12,color:'#ff0000cc'};const output=await render(p,path.join(dir,'out')),actual=frame(output);
  const center=pixel(actual,80,72),corner=pixel(actual,49,49),outside=pixel(actual,122,84),far=pixel(actual,12,12),blurred=pixel(actual,138,84);
  assert.ok(center.every(v=>v>230),'Camera center remains white');assert.ok(corner[0]<20&&corner[2]>95,'Rounded top-left corner exposes the canvas');assert.ok(outside[0]>100&&outside[0]>outside[2],'Red shadow appears outside right clip edge');assert.ok(Math.abs(far[0]-pixel(control,12,12)[0])<5,'Distant background remains unchanged');assert.ok(blurred[0]>pixel(control,138,84)[0]+3&&blurred[0]<outside[0]-30,'Shadow has a colored gradual blur falloff');
  const reportDir=path.resolve('../evidence/qa/layers-style');await fs.mkdir(reportDir,{recursive:true});await fs.copyFile(output,path.join(reportDir,'rounded-shadow.mp4'));command(['-i',output,'-frames:v','1',path.join(reportDir,'rounded-shadow.png')]);await fs.writeFile(path.join(reportDir,'pixels.json'),JSON.stringify({pass:true,center,corner,outside,far,blurred,canvas:p.canvas,transform:p.clips[0].transform},null,2));
  const doubled=await inspectFrames(p,[0],path.join(dir,'inspect'),{width:384}),scaled=pixel(frame(doubled[0].path),244,168,384);assert.ok(scaled[0]>100&&scaled[0]>scaled[2],'Inspection scaling retains the same shadow placement');
  p.clips[0].transform.shadow.color='#ff000000';assert.deepEqual(frame(await render(p,path.join(dir,'out'))),control,'Fully transparent shadow is pixel-equivalent to no shadow');
  p.clips[0].transform.shadow={x:-20,y:-12,blur:0,color:'#00ff00ff'};const negative=frame(await render(p,path.join(dir,'out'))),left=pixel(negative,35,65);assert.ok(left[1]>220&&left[0]<30&&left[2]<30,'Negative-offset opaque shadow appears left of the clip without a gray or black RGB fringe');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
