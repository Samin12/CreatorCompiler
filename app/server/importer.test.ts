import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {importBorumi} from './importer.js';
test('Read-only import preserves ASCII scene order, source offsets and custom layouts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sceneforge-import-'));const dbPath=path.join(dir,'project.bmproj');
 try{await mkdir(path.join(dir,'medias'));await writeFile(path.join(dir,'medias','m.mov'),'synthetic');const db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE projects(id TEXT,name TEXT,render_target TEXT); CREATE TABLE scenes(id TEXT,seq TEXT,name TEXT,script TEXT); CREATE TABLE clips(id TEXT,media TEXT,start_offset REAL,start_offset_adjustment REAL,duration REAL); CREATE TABLE medias(id TEXT,name TEXT,tracks TEXT,duration REAL,width INT,height INT); CREATE TABLE scene_timeline_segments(id TEXT,scene_id TEXT,start REAL,duration REAL,segment_order INT,kind TEXT);');
 db.prepare('INSERT INTO projects VALUES(?,?,?)').run('p','Test',JSON.stringify({mode:{width:1920,height:1080}}));db.prepare('INSERT INTO scenes VALUES(?,?,?,?)').run('later','}a','Later','second');db.prepare('INSERT INTO scenes VALUES(?,?,?,?)').run('first','O','First','first');
 db.prepare('INSERT INTO clips VALUES(?,?,?,?,?)').run('c','m',4,.25,20);db.prepare('INSERT INTO medias VALUES(?,?,?,?,?,?)').run('m','Fixture',JSON.stringify([{kind:'Video'},{kind:'Audio'}]),30,1920,1080);
 const insert=db.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?)');const kind=JSON.stringify({kind:'VideoClip',clip_id:'c',clip_start:2,content_kind:{kind:'Camera'},transition:{kind:'Crossfade'},face_tracking_mode:{kind:'Auto'}});insert.run('one','first',0,5,0,kind);insert.run('two','later',0,3,0,JSON.stringify({...JSON.parse(kind),face_tracking_mode:undefined}));insert.run('layout','first',0,5,0,JSON.stringify({kind:'Layout',layout_kind_v2:{kind:'Custom',sources:[{source:{content_kind:{kind:'Camera'},layer_index:0},x_ratio:.7,y_ratio:.6,width_ratio:.25,height_ratio:.3,border_radius_ratio:.02}]}}));db.close();
 const before=await readFile(dbPath);const p=await importBorumi(dir);assert.deepEqual(await readFile(dbPath),before);assert.deepEqual(p.scenes.map(s=>s.name),['First','Later']);assert.deepEqual(p.scenes.map(s=>s.start),[0,5]);assert.equal(p.clips[0].sourceIn,6.25);assert.equal(p.clips[0].muted,true);assert.equal(p.clips[0].transform.x,.7);assert.equal(p.clips[0].transform.borderRadius,21.6);assert.ok(p.importMetadata);
 assert.equal(p.clips[0].effects.fadeIn,0);assert.ok(p.importWarnings?.some(w=>w.includes('Crossfade')));assert.ok(p.importMetadata?.unmappedSegments?.some((v:any)=>v.kind==='UnsupportedTransition'&&v.renderedAs==='instant'));
 assert.equal(p.clips[0].effects.faceCenter,true);assert.equal(p.clips[1].effects.faceCenter,undefined);assert.ok(p.importWarnings?.some(w=>w.includes('sampled static face anchoring')));
 }finally{await rm(dir,{recursive:true,force:true})}
});

async function withOverlappingScreens(run:(project:Awaited<ReturnType<typeof importBorumi>>)=>void){
 const dir=await mkdtemp(path.join(os.tmpdir(),'sceneforge-import-layers-'));
 try{
  await mkdir(path.join(dir,'medias'));await writeFile(path.join(dir,'medias','m.mov'),'synthetic');
  const db=new DatabaseSync(path.join(dir,'project.bmproj'));
  db.exec('CREATE TABLE projects(id TEXT,name TEXT,render_target TEXT); CREATE TABLE scenes(id TEXT,seq TEXT,name TEXT,script TEXT); CREATE TABLE clips(id TEXT,media TEXT,start_offset REAL,start_offset_adjustment REAL,duration REAL); CREATE TABLE medias(id TEXT,name TEXT,tracks TEXT,duration REAL,width INT,height INT); CREATE TABLE scene_timeline_segments(id TEXT,scene_id TEXT,start REAL,duration REAL,segment_order INT,kind TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('p','Layers',JSON.stringify({mode:{width:1920,height:1080}}));
  db.prepare('INSERT INTO scenes VALUES(?,?,?,?)').run('s','a','Scene','');
  db.prepare('INSERT INTO clips VALUES(?,?,?,?,?)').run('c','m',7,0,20);
  db.prepare('INSERT INTO medias VALUES(?,?,?,?,?,?)').run('m','Fixture',JSON.stringify([{kind:'Video'}]),30,1920,1080);
  const insert=db.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?)');
  const video=JSON.stringify({kind:'VideoClip',clip_id:'c',content_kind:{kind:'Screen'}});
  insert.run('before','s',0,5,0,video);insert.run('after','s',4.9997,5.0003,0,video);
  insert.run('layout','s',0,10,0,JSON.stringify({kind:'Layout',layout_kind_v2:{kind:'Custom',sources:[
   {source:{content_kind:{kind:'Screen'},layer_index:0},x_ratio:0,y_ratio:0,width_ratio:.7,height_ratio:1},
   {source:{content_kind:{kind:'Screen'},layer_index:1},x_ratio:.7,y_ratio:0,width_ratio:.3,height_ratio:1}
  ]}}));
  db.close();run(await importBorumi(dir));
 }finally{await rm(dir,{recursive:true,force:true})}
}

test('A sub-millisecond screen overlap releases the primary layout index after the preceding clip ends',async()=>{
 await withOverlappingScreens(project=>{
  const tail=project.clips.find(c=>c.start===5)!;
  assert.ok(tail,'The following source is split when its predecessor ends');
  assert.equal(tail.transform.opacity,1);assert.equal(tail.transform.x,0);assert.equal(tail.transform.width,.7);
  assert.ok(Math.abs(tail.sourceIn-7.0003)<1e-10);assert.ok(Math.abs(tail.sourceOut-12.0003)<1e-10);
  assert.equal(tail.start+(tail.sourceOut-tail.sourceIn)/tail.speed,10);
 });
});

test('Simultaneously active sources keep distinct layout indices before one source ends',async()=>{
 await withOverlappingScreens(project=>{
  const overlap=project.clips.filter(c=>c.start<=4.9998&&c.start+(c.sourceOut-c.sourceIn)/c.speed>4.9998);
  assert.equal(overlap.length,2);
  assert.deepEqual(overlap.map(c=>c.transform.x).sort(),[0,.7]);
  assert.deepEqual(overlap.map(c=>c.zIndex).sort(),[0,1]);
  // The later overlapping source occupies the upper native lane, source 0.
  const incoming=overlap.find(c=>Math.abs(c.sourceIn-7)<1e-10)!;
  assert.equal(incoming.transform.x,0);
 });
});

test('A persistent upper screen lane stays source zero across cuts in the lower lane',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sceneforge-import-lane-cuts-'));
 try{
  await mkdir(path.join(dir,'medias'));await writeFile(path.join(dir,'medias','m.mov'),'synthetic');
  const db=new DatabaseSync(path.join(dir,'project.bmproj'));
  db.exec('CREATE TABLE projects(id TEXT,name TEXT); CREATE TABLE scenes(id TEXT,seq TEXT,name TEXT); CREATE TABLE clips(id TEXT,media TEXT,duration REAL); CREATE TABLE medias(id TEXT,name TEXT,tracks TEXT,duration REAL); CREATE TABLE scene_timeline_segments(id TEXT,scene_id TEXT,start REAL,duration REAL,segment_order INT,kind TEXT);');
  db.exec("INSERT INTO projects VALUES('p','Layers'); INSERT INTO scenes VALUES('s','a','Scene'); INSERT INTO clips VALUES('c','m',20);");
  db.prepare('INSERT INTO medias VALUES(?,?,?,?)').run('m','Fixture',JSON.stringify([{kind:'Video'}]),20);
  const insert=db.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?)');
  const video=(offset:number)=>JSON.stringify({kind:'VideoClip',clip_id:'c',clip_start:offset,content_kind:{kind:'Screen'}});
  insert.run('lower-first','s',0,4,0,video(0));insert.run('upper','s',.0007,9.9993,0,video(10));insert.run('lower-next','s',4,6,0,video(4));
  insert.run('layout','s',0,10,0,JSON.stringify({kind:'Layout',layout_kind_v2:{kind:'Custom',sources:[{source:{content_kind:{kind:'Screen'},layer_index:0},x_ratio:0,width_ratio:1},{source:{content_kind:{kind:'Screen'},layer_index:1},x_ratio:.1,width_ratio:.6}]}}));
  db.close();const project=await importBorumi(dir);
  for(const time of [1,5,9]){
   const active=project.clips.filter(c=>c.start<=time&&c.start+(c.sourceOut-c.sourceIn)/c.speed>time);
   assert.equal(active.length,2);
   assert.equal(active.find(c=>c.sourceIn>=10)!.transform.x,0);
   assert.equal(active.find(c=>c.sourceIn<10)!.transform.x,.1);
  }
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('Native audio content kinds retain explicit microphone/system roles without guessing unknown sources',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sceneforge-import-audio-roles-'));
 try{
  await mkdir(path.join(dir,'medias'));await writeFile(path.join(dir,'medias','m.wav'),'synthetic');
  const file=path.join(dir,'project.bmproj'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE projects(id TEXT,name TEXT); CREATE TABLE scenes(id TEXT,seq TEXT,name TEXT); CREATE TABLE clips(id TEXT,media TEXT,duration REAL); CREATE TABLE medias(id TEXT,name TEXT,tracks TEXT,duration REAL); CREATE TABLE scene_timeline_segments(id TEXT,scene_id TEXT,start REAL,duration REAL,segment_order INT,kind TEXT);');
  db.exec("INSERT INTO projects VALUES('p','Audio'); INSERT INTO scenes VALUES('s','a','Scene'); INSERT INTO clips VALUES('c','m',3)");
  db.prepare('INSERT INTO medias VALUES(?,?,?,?)').run('m','Microphone-looking name',JSON.stringify([{kind:'Audio'}]),3);
  const insert=db.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?)');
  for(const [index,role] of ['Microphone','SystemSound',undefined].entries())insert.run(String(index),'s',index,1,index,JSON.stringify({kind:'AudioClip',clip_id:'c',content_kind:role?{kind:role}:undefined}));
  db.close();const before=await readFile(file),p=await importBorumi(dir);
  assert.deepEqual(p.clips.map(c=>c.audioRole),['microphone','system',undefined]);assert.equal(p.media[0].audioRole,undefined);assert.deepEqual(await readFile(file),before);
 }finally{await rm(dir,{recursive:true,force:true})}
});
