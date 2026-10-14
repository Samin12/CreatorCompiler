import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProject} from '../shared/types.js';
import {importBorumi} from './importer.js';
import {planNewBorumiProject} from './borumi-new-project.js';
import {planBorumiRoundtrip,exportBorumiRoundtrip} from './borumi-roundtrip.js';

const directory=await mkdtemp(path.join(os.tmpdir(),'sceneforge-canvas-model-'));
process.env.SCENEFORGE_DATA_DIR=path.join(directory,'studio');
const {initStorage,newProject,saveProject,readProject,validateProject}=await import('./storage.js');
await initStorage();
after(()=>rm(directory,{recursive:true,force:true}));

test('only new projects receive the moving-dot default, with independent canvas objects',async()=>{
 const first=await newProject('New moving canvas'),second=createProject();
 assert.equal(first.canvas.background,'#121212');
 assert.equal(first.canvas.backgroundPattern,'moving-dots');
 assert.deepEqual((await readProject(first.id)).canvas,first.canvas);
 first.canvas.background='#abcdef';delete first.canvas.backgroundPattern;
 assert.equal(second.canvas.background,'#121212');assert.equal(second.canvas.backgroundPattern,'moving-dots');
});

test('loading and saving a legacy solid canvas neither adds motion nor changes its color',async()=>{
 const legacy=createProject('Existing solid');delete legacy.canvas.backgroundPattern;legacy.canvas.background='#315779';
 const expected=structuredClone(legacy.canvas),saved=await saveProject(legacy);
 assert.deepEqual(saved.canvas,expected);assert.deepEqual((await readProject(legacy.id)).canvas,expected);
 assert.equal(Object.hasOwn(saved.canvas,'backgroundPattern'),false);
});

test('style switching and base color changes persist independently',async()=>{
 const project=createProject('Editable canvas');project.canvas.background='#e6f4ef';
 await saveProject(project);assert.equal((await readProject(project.id)).canvas.backgroundPattern,'moving-dots');
 delete project.canvas.backgroundPattern;await saveProject(project);
 assert.equal((await readProject(project.id)).canvas.background,'#e6f4ef');
 project.canvas.backgroundPattern='moving-dots';await saveProject(project);
 assert.equal((await readProject(project.id)).canvas.background,'#e6f4ef');
});

test('unknown, null and non-string background patterns are rejected rather than rendered as another style',()=>{
 for(const pattern of ['solid','dots','',null,1,{},[]]){
  const project=createProject();Object.assign(project.canvas,{backgroundPattern:pattern});
  assert.throws(()=>validateProject(project),/Unknown canvas background pattern/);
 }
 assert.doesNotThrow(()=>validateProject(createProject()));
});

async function nativeFixture(background:unknown){
 const folder=await mkdtemp(path.join(directory,'native-')),file=path.join(folder,'project.bmproj');
 await mkdir(path.join(folder,'medias'));
 const db=new DatabaseSync(file);
 try{
  db.exec('CREATE TABLE projects(id TEXT,name TEXT,render_target TEXT); CREATE TABLE scenes(id TEXT,seq TEXT,name TEXT,script TEXT); CREATE TABLE project_timeline(project_id TEXT,background TEXT); CREATE TABLE scene_timeline_segments(id TEXT,scene_id TEXT,start REAL,duration REAL,kind TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('p','Synthetic original',JSON.stringify({mode:{width:1080,height:1920}}));
  db.prepare('INSERT INTO scenes VALUES(?,?,?,?)').run('s','a','Scene','');
  db.prepare('INSERT INTO project_timeline VALUES(?,?)').run('p',JSON.stringify(background));
 }finally{db.close();}
 return {folder,file};
}

test('native solid and unsupported backgrounds never inherit new-project motion or a changed fallback',async()=>{
 for(const [background,color] of [
  [{main_kind:{kind:'Color',color:{r:12,g:34,b:56}}},'#0c2238'],
  [{main_kind:{kind:'FutureNativeStyle'}},'#171b27'],
  [null,'#171b27'],
 ] as const){
  const fixture=await nativeFixture(background),bytes=await readFile(fixture.file),project=await importBorumi(fixture.folder);
  assert.equal(project.canvas.background,color);assert.equal(Object.hasOwn(project.canvas,'backgroundPattern'),false);
  assert.deepEqual(await readFile(fixture.file),bytes);
 }
});

test('new Borumi export explicitly blocks motion and accepts the same empty canvas after choosing solid',()=>{
 const project=createProject();project.canvas.padding=0;project.canvas.radius=0;
 const animated=planNewBorumiProject(project);assert.equal(animated.supported,false);
 assert.ok(animated.blockers.some(message=>message.includes('Moving-dot canvas')));
 delete project.canvas.backgroundPattern;
 const solid=planNewBorumiProject(project);assert.equal(solid.supported,true,solid.blockers.join('\n'));
});

test('preserved Borumi export blocks newly enabled motion before writing and restores compatibility when disabled',async()=>{
 const fixture=await nativeFixture({main_kind:{kind:'Color',color:{r:18,g:18,b:18}}}),preservationRoot=path.join(directory,'preserved');
 const bytes=await readFile(fixture.file),project=await importBorumi(fixture.folder,{roundtripDirectory:preservationRoot});
 assert.equal((await planBorumiRoundtrip(project,preservationRoot)).supported,true);
 project.canvas.backgroundPattern='moving-dots';
 const plan=await planBorumiRoundtrip(project,preservationRoot);assert.equal(plan.supported,false);
 assert.ok(plan.blockers.some(message=>message.includes('Moving-dot canvas')));
 await assert.rejects(exportBorumiRoundtrip(project,{preservationRoot,outputRoot:path.join(directory,'exports')}),/Moving-dot canvas/);
 assert.deepEqual(await readFile(fixture.file),bytes);
 delete project.canvas.backgroundPattern;assert.equal((await planBorumiRoundtrip(project,preservationRoot)).supported,true);
});
