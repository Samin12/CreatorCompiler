import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importBorumi} from './importer.js';
import {planBorumiRoundtrip,exportBorumiRoundtrip} from './borumi-roundtrip.js';
import {splitClip} from './mcp.js';
import {cutTimelineRange} from '../shared/timeline-edits.js';

async function fixture(splitLayout=false){
 const root=await mkdtemp(path.join(os.tmpdir(),'sceneforge-borumi-roundtrip-')),bundle=path.join(root,'source.bmprojbundle'),preservationRoot=path.join(root,'preserved'),outputRoot=path.join(root,'exports');
 await mkdir(path.join(bundle,'medias'),{recursive:true});await writeFile(path.join(bundle,'medias','m.mov'),'immutable synthetic media');await writeFile(path.join(bundle,'unknown.bin'),Buffer.from([0,123,255]));
 const file=path.join(bundle,'project.bmproj'),db=new DatabaseSync(file);
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,render_target TEXT,active_tool TEXT); CREATE TABLE scenes(id TEXT PRIMARY KEY,project_id TEXT,seq TEXT,name TEXT,script TEXT); CREATE TABLE takes(id TEXT PRIMARY KEY,scene_id TEXT,name TEXT); CREATE TABLE clips(id TEXT PRIMARY KEY,take_id TEXT,media TEXT,start_offset REAL,start_offset_adjustment REAL,duration REAL); CREATE TABLE medias(id TEXT PRIMARY KEY,project_id TEXT,name TEXT,tracks TEXT,duration REAL,width INT,height INT); CREATE TABLE scene_timeline_segments(id TEXT PRIMARY KEY,scene_id TEXT,start REAL,duration REAL,edited INT,segment_order INT,kind TEXT); CREATE TABLE project_timeline(project_id TEXT PRIMARY KEY,background TEXT); CREATE TABLE project_version(project_id TEXT PRIMARY KEY,root_commit_id TEXT,head_commit_id TEXT); CREATE TABLE project_commits(commit_id TEXT PRIMARY KEY,format_version INT,canonical_body BLOB); CREATE TABLE unknown_future(id INT,payload BLOB);`);
 db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('p','Original',JSON.stringify({version:2,mode:{kind:'Generic',width:1920,height:1080},future:42}),'{"kind":"Record"}');
 db.prepare('INSERT INTO scenes VALUES(?,?,?,?,?)').run('s','p','O','First','Original script');db.prepare('INSERT INTO clips VALUES(?,?,?,?,?,?)').run('c','t','m',4,.25,20);db.prepare('INSERT INTO medias VALUES(?,?,?,?,?,?,?)').run('m','p','Fixture',JSON.stringify([{kind:'Video'},{kind:'Audio'}]),30,1920,1080);
 db.prepare('INSERT INTO takes VALUES(?,?,?)').run('t','s','Take');
 const insert=db.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?,?)');
 insert.run('audio','s',0,5,0,0,JSON.stringify({kind:'AudioClip',clip_id:'c',clip_start:2,volume_filter:null,future:{unknown:['untouched']}}));
 insert.run('video','s',0,5,0,1,JSON.stringify({kind:'VideoClip',clip_id:'c',clip_start:2,content_kind:{kind:'Camera'},mirrored:null,transition:{kind:'Cut'},future:'intact'}));
 if(splitLayout){insert.run('layout1','s',0,2,0,2,JSON.stringify({kind:'Layout',layout_kind_v2:{kind:'Fullscreen',source:{content_kind:{kind:'Camera'},layer_index:0}},transition:{kind:'Instant'}}));insert.run('layout2','s',2,3,0,3,JSON.stringify({kind:'Layout',layout_kind_v2:{kind:'Fullscreen',source:{content_kind:{kind:'Camera'},layer_index:0}},transition:{kind:'Instant'}}));}
 db.prepare('INSERT INTO project_timeline VALUES(?,?)').run('p',JSON.stringify({main_kind:{kind:'Color',color:{r:0,g:0,b:0}}}));
 db.prepare('INSERT INTO project_commits VALUES(?,?,?)').run('opaque-native-hash',5,Buffer.from('{"unknown":"canonical history"}'));db.prepare('INSERT INTO project_version VALUES(?,?,?)').run('p','opaque-native-hash','opaque-native-hash');db.prepare('INSERT INTO unknown_future VALUES(?,?)').run(1,Buffer.from([0,240,10]));db.close();
 const original=await readFile(file),project=await importBorumi(bundle,{roundtripDirectory:preservationRoot});
 return {root,bundle,file,original,project,preservationRoot,outputRoot};
}

test('compatible copy preserves unknown database/assets/history and patches supported values without touching source',async()=>{
 const f=await fixture();try{
  const p=f.project;p.name='Compatible copy';p.scenes[0].name='New scene';p.scenes[0].script='Revised script';p.canvas.width=1280;p.canvas.height=720;
  const audio=p.clips.find(c=>c.track==='audio')!;audio.gain=.5;audio.sourceIn+=.25;audio.sourceOut-=.25;audio.start=.25;
  p.clips.find(c=>c.track==='camera')!.effects.flipX=true;
  const plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,true,plan.blockers.join('\n'));
  const result=await exportBorumiRoundtrip(p,f);assert.notEqual(result.projectId,'p');assert.equal(result.nativeValidation,'pending');assert.deepEqual(await readFile(f.file),f.original);
  assert.deepEqual(await readFile(path.join(result.path,'.sceneforge','original-project.sqlite')),await readFile(path.join(f.preservationRoot,p.importMetadata!.roundtrip!.snapshotId,'original.sqlite')));
  assert.deepEqual(await readFile(path.join(result.path,'unknown.bin')),Buffer.from([0,123,255]));
  const db=new DatabaseSync(path.join(result.path,'project.bmproj'),{readOnly:true});try{
   assert.deepEqual([...((db.prepare('SELECT payload FROM unknown_future').get() as any).payload)], [0,240,10]);
   assert.equal((db.prepare('SELECT count(*) n FROM project_version').get() as any).n,0);assert.equal((db.prepare('SELECT count(*) n FROM project_commits').get() as any).n,0);
   assert.equal((db.prepare('SELECT project_id FROM scenes').get() as any).project_id,result.projectId);
   const row=db.prepare('SELECT * FROM scene_timeline_segments WHERE id=?').get('audio') as any,k=JSON.parse(row.kind);assert.deepEqual(k.future,{unknown:['untouched']});assert.equal(k.clip_start,2.25);assert.equal(row.duration,4.5);assert.equal(row.start,.25);assert.ok(Math.abs(k.volume_filter+6.020599913)<1e-8);
   assert.equal(JSON.parse((db.prepare('SELECT render_target FROM projects').get() as any).render_target).future,42);
  }finally{db.close()}
  const again=await importBorumi(result.path);assert.equal(again.scenes[0].script,'Revised script');assert.equal(again.canvas.width,1280);assert.equal(again.clips.find(c=>c.track==='camera')!.effects.flipX,true);assert.ok(Math.abs(again.clips.find(c=>c.track==='audio')!.gain-.5)<1e-10);
 }finally{await rm(f.root,{recursive:true,force:true})}
});

test('unsupported edits block before any destination is created',async()=>{const f=await fixture();try{
 f.project.clips[0].muted=true;f.project.captions.push({id:'new',start:0,end:1,text:'Changed'});f.project.clips[0].transform.x=.2;
 const plan=await planBorumiRoundtrip(f.project,f.preservationRoot);assert.equal(plan.supported,false);assert.ok(plan.blockers.some(x=>x.includes('mute')));assert.ok(plan.blockers.some(x=>x.includes('captions')));assert.ok(plan.blockers.some(x=>x.includes('transform')));
 await assert.rejects(exportBorumiRoundtrip(f.project,f),/export blocked/);await assert.rejects(readdir(f.outputRoot),/ENOENT/);assert.deepEqual(await readFile(f.file),f.original);
 }finally{await rm(f.root,{recursive:true,force:true})}});

test('layout-split video must share supported properties and timing edits are explicit blockers',async()=>{const f=await fixture(true);try{
 const video=f.project.clips.filter(c=>c.track==='camera');assert.equal(video.length,2);video[0].effects.flipX=true;
 let p=await planBorumiRoundtrip(f.project,f.preservationRoot);assert.ok(p.blockers.some(x=>x.includes('same imported native segment')));
 video[1].effects.flipX=true;p=await planBorumiRoundtrip(f.project,f.preservationRoot);assert.equal(p.supported,true,p.blockers.join('\n'));
 video[1].sourceIn+=.1;p=await planBorumiRoundtrip(f.project,f.preservationRoot);assert.ok(p.blockers.some(x=>x.includes('layout boundaries')));
 }finally{await rm(f.root,{recursive:true,force:true})}});

test('copy exporter rejects symlinks and never leaves a partial artifact or changes original',async()=>{const f=await fixture();try{
 await symlink('/etc/hosts',path.join(f.bundle,'outside'));await assert.rejects(exportBorumiRoundtrip(f.project,f),/symbolic link/);assert.deepEqual(await readdir(f.outputRoot),[]);assert.deepEqual(await readFile(f.file),f.original);
 }finally{await rm(f.root,{recursive:true,force:true})}});

test('preservation token cannot escape managed storage and modified snapshot is rejected',async()=>{const f=await fixture();try{
 const token=f.project.importMetadata!.roundtrip!;const saved=token.snapshotId;token.snapshotId='../../../../etc';await assert.rejects(planBorumiRoundtrip(f.project,f.preservationRoot),/Invalid Borumi/);token.snapshotId=saved;
 await writeFile(path.join(f.preservationRoot,saved,'original.sqlite'),'corrupt');await assert.rejects(planBorumiRoundtrip(f.project,f.preservationRoot),/has changed/);
 }finally{await rm(f.root,{recursive:true,force:true})}});

test('assets modified after import are rejected rather than silently replacing preserved media',async()=>{const f=await fixture();try{
 await writeFile(path.join(f.bundle,'medias','m.mov'),'different bytes');await assert.rejects(exportBorumiRoundtrip(f.project,f),/changed after import/);assert.deepEqual(await readFile(f.file),f.original);
 }finally{await rm(f.root,{recursive:true,force:true})}});

test('preservation sees committed WAL data and leaves source database unmodified',async()=>{const f=await fixture();let db:DatabaseSync|undefined;try{
 db=new DatabaseSync(f.file);db.exec('PRAGMA journal_mode=WAL; UPDATE projects SET name=\'Committed in WAL\'');
 const before=await readFile(f.file),wal=await readFile(f.file+'-wal');const p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});assert.ok(p.name.startsWith('Committed in WAL'));assert.deepEqual(await readFile(f.file),before);assert.deepEqual(await readFile(f.file+'-wal'),wal);
 const result=await exportBorumiRoundtrip(p,f);const reopened=await importBorumi(result.path);assert.ok(reopened.name.startsWith('Committed in WAL'));
 }finally{db?.close();await rm(f.root,{recursive:true,force:true})}});

import {createProject,defaultEffects,defaultTransform} from '../shared/types.js';
import {exportNewBorumiProject,planNewBorumiProject} from './borumi-new-project.js';

test('new SceneForge project uses only clean schema metadata, and its AV content reimports',async()=>{const f=await fixture();try{
 const source=new DatabaseSync(f.file);source.exec('CREATE TABLE _borumi_migrations(id INTEGER PRIMARY KEY,sql TEXT NOT NULL)');for(let i=0;i<39;i++)source.prepare('INSERT INTO _borumi_migrations VALUES(?,?)').run(i,'-- synthetic schema version');source.close();
 const template=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot}),p=createProject('New authored project');p.canvas.padding=0;p.canvas.radius=0;p.scenes[0].duration=3;p.scenes[0].script='Synthetic script only';p.media=[{id:'newmedia',name:'Synthetic',path:path.join(f.bundle,'medias','m.mov'),kind:'video',duration:30,width:1920,height:1080,hasAudio:true}];p.clips=[{id:'newclip',mediaId:'newmedia',name:'Synthetic',track:'screen',start:0,sourceIn:2,sourceOut:5,speed:1,gain:.5,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
 const plan=planNewBorumiProject(p);assert.equal(plan.supported,true,plan.blockers.join('\n'));
 const result=await exportNewBorumiProject(p,{...f,templateProject:template});const reopened=await importBorumi(result.path);assert.equal(reopened.scenes[0].script,'Synthetic script only');assert.equal(reopened.clips.filter(c=>c.track==='screen').length,1);assert.equal(reopened.clips.filter(c=>c.track==='audio').length,1);assert.equal(reopened.clips[0].sourceIn,2);assert.equal(reopened.clips[1].gain,.5);
 const db=new DatabaseSync(path.join(result.path,'project.bmproj'),{readOnly:true});try{assert.equal((db.prepare('SELECT count(*) n FROM _borumi_migrations').get() as any).n,39);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='unknown_future'").get(),undefined);assert.equal((db.prepare('SELECT count(*) n FROM project_commits').get() as any).n,0);}finally{db.close()}
 const bytes=await readFile(path.join(result.path,'project.bmproj'));assert.equal(bytes.includes(Buffer.from('Original script')),false);assert.equal(bytes.includes(Buffer.from('canonical history')),false);assert.equal((await readdir(path.join(result.path,'.sceneforge'))).includes('original-project.sqlite'),false);
 }finally{await rm(f.root,{recursive:true,force:true})}});

test('new-project export blocks unsupported fidelity and scene or media mistakes',()=>{
 const p=createProject();p.canvas.padding=0;p.canvas.radius=0;p.scenes[0].duration=10;p.captions=[{id:'c',start:0,end:1,text:'kept'}];const plan=planNewBorumiProject(p);assert.equal(plan.supported,false);assert.ok(plan.blockers.some(x=>x.includes('Captions')));assert.ok(plan.blockers.some(x=>x.includes('scene duration')));
});

import {decodeBorumiScript,encodeBorumiScript} from './borumi-script.js';
test('untouched null scene fields remain null instead of imported display defaults',async()=>{const f=await fixture();try{
 const db=new DatabaseSync(f.file);db.exec('UPDATE scenes SET name=NULL,script=NULL');db.close();const p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});assert.equal(p.scenes[0].name,'Scene 1');assert.equal(p.scenes[0].script,'');
 const result=await exportBorumiRoundtrip(p,f),copy=new DatabaseSync(path.join(result.path,'project.bmproj'),{readOnly:true});try{const row=copy.prepare('SELECT name,script FROM scenes').get() as any;assert.equal(row.name,null);assert.equal(row.script,null);assert.equal((copy.prepare('SELECT name FROM projects').get() as any).name,'Original');}finally{copy.close()}
 }finally{await rm(f.root,{recursive:true,force:true})}});

test('native script JSON imports as readable text; authoring serializes native paragraphs',()=>{
 const rich={content:[{type:'heading',level:2,content:[{type:'text',text:'Title',bold:true}]},{type:'bullet-list',content:[{content:[{type:'paragraph',content:[{type:'text',text:'Item'}]}]}]}],selection:null};assert.equal(decodeBorumiScript(JSON.stringify(rich)),'Title\nItem');
 const source='Line one\n\nLine three';assert.equal(decodeBorumiScript(encodeBorumiScript(source)),source);assert.equal(JSON.parse(encodeBorumiScript(source)).content[0].content[0].type,'text');
});

test('destination aliases cannot create exports inside original source',async()=>{const f=await fixture();try{
 const link=path.join(f.root,'source-alias');await symlink(f.bundle,link);
 for(const target of [f.bundle,path.join(f.bundle,'new-folder'),path.join(link,'nested','new-folder')])await assert.rejects(exportBorumiRoundtrip(f.project,{...f,outputRoot:target}),/outside the original/);
 await assert.rejects(readdir(path.join(f.bundle,'new-folder')),/ENOENT/);await assert.rejects(readdir(path.join(f.bundle,'nested')),/ENOENT/);assert.deepEqual(await readFile(f.file),f.original);
 const target=path.join(f.root,'chosen','nested');const result=await exportBorumiRoundtrip(f.project,{...f,outputRoot:target});assert.equal(path.dirname(result.path),await realpath(target));
 }finally{await rm(f.root,{recursive:true,force:true})}});


test('extended effect timing cannot silently lose split-clip continuity on native export',async()=>{
 const f=await fixture();try{
  f.project.clips[0].effectTiming={sourceIn:0,sourceOut:30};
  assert.equal((await planBorumiRoundtrip(f.project,f.preservationRoot)).supported,false);
  const p=createProject();p.canvas.padding=0;p.canvas.radius=0;p.scenes[0].duration=3;p.media=[{id:'m',name:'Synthetic',path:'/synthetic.mp4',kind:'video',duration:10,width:320,height:180,hasAudio:true}];p.clips=[{id:'c',mediaId:'m',name:'Synthetic',track:'screen',start:0,sourceIn:2,sourceOut:5,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
  assert.equal(planNewBorumiProject(p).supported,true);p.clips[0].effectTiming={sourceIn:2,sourceOut:5};assert.equal(planNewBorumiProject(p).supported,true);p.clips[0].effectTiming={sourceIn:0,sourceOut:8};assert.ok(planNewBorumiProject(p).blockers.some(x=>x.includes('effect timing')));
 }finally{await rm(f.root,{recursive:true,force:true})}
});

test('split descendants retain native source offsets, unknown columns and opaque fields',async()=>{const f=await fixture();try{
 const source=new DatabaseSync(f.file);source.exec("ALTER TABLE scene_timeline_segments ADD COLUMN future_blob BLOB; UPDATE scene_timeline_segments SET future_blob=x'00f1ff'");source.close();
 const p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});assert.ok(p.clips.every(c=>c.borumiOriginId===c.id));
 p.clips=p.clips.flatMap(c=>splitClip(c,2));
 const plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,true,plan.blockers.join('\n'));
 const before=await readFile(f.file),result=await exportBorumiRoundtrip(p,f);assert.deepEqual(await readFile(f.file),before);
 const db=new DatabaseSync(path.join(result.path,'project.bmproj'),{readOnly:true});try{
  const rows=db.prepare('SELECT * FROM scene_timeline_segments ORDER BY start,segment_order').all() as any[];assert.equal(rows.length,4);
  assert.equal(new Set(rows.map(r=>r.id)).size,4);for(const row of rows){const k=JSON.parse(row.kind);assert.equal(k.clip_start,row.start===0?2:4);assert.equal(row.duration,row.start===0?2:3);assert.deepEqual([...row.future_blob],[0,241,255]);assert.ok(k.future);}
 }finally{db.close()}
 const again=await importBorumi(result.path);assert.deepEqual(again.clips.filter(c=>c.track==='audio').map(c=>[c.start,c.sourceIn,c.sourceOut]),[[0,6.25,8.25],[2,8.25,11.25]]);
}finally{await rm(f.root,{recursive:true,force:true})}});

test('synchronized ripple deletion retimes static layouts across scenes without shifting media offsets',async()=>{const f=await fixture(true);try{
 const source=new DatabaseSync(f.file);source.exec("INSERT INTO scenes VALUES('s2','p','P','Second',''); INSERT INTO scene_timeline_segments SELECT id||'2','s2',start,duration,edited,segment_order,kind FROM scene_timeline_segments WHERE id IN ('audio','video')");source.close();
 const p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});
 cutTimelineRange(p,1,3,true);cutTimelineRange(p,4,5,true);
 const before=await readFile(f.file),plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,true,plan.blockers.join('\n'));
 const result=await exportBorumiRoundtrip(p,f),again=await importBorumi(result.path);assert.deepEqual(await readFile(f.file),before);
 assert.deepEqual(again.scenes.map(s=>[s.start,s.duration]),[[0,3],[3,4]]);
 assert.deepEqual(again.clips.filter(c=>c.track==='audio').map(c=>[c.start,c.sourceIn,c.sourceOut]),[[0,6.25,7.25],[1,9.25,11.25],[3,6.25,7.25],[4,8.25,11.25]]);
 const db=new DatabaseSync(path.join(result.path,'project.bmproj'),{readOnly:true});try{assert.deepEqual(db.prepare("SELECT start,duration FROM scene_timeline_segments WHERE id LIKE 'layout%' ORDER BY start").all().map((r:any)=>[r.start,r.duration]),[[0,1],[1,2]]);}finally{db.close()}
}finally{await rm(f.root,{recursive:true,force:true})}});

test('split/delete rejects duplicates, asymmetric cuts, moves, forged origins and extended effects',async()=>{const f=await fixture();try{
 const original=structuredClone(f.project);
 const cases:Array<[string,(p:typeof original)=>void,RegExp]>=[
  ['duplicate',p=>p.clips.push({...structuredClone(p.clips[0]),id:'duplicate'}),/duplicated|overlapping/],
  ['asymmetric',p=>{p.clips[0].sourceOut-=1;p.clips.push({...structuredClone(p.clips[1]),id:'other',start:4,sourceIn:p.clips[1].sourceOut-1});p.clips[1].sourceOut-=1;},/same time ranges|positions/],
  ['move',p=>{p.clips=p.clips.flatMap(c=>splitClip(c,2));p.clips[1].start+=.1;},/positions/],
  ['forged',p=>{p.clips=p.clips.flatMap(c=>splitClip(c,2));p.clips[1].borumiOriginId='not-imported';},/descendant/],
  ['effect',p=>{cutTimelineRange(p,1,2);p.clips[0].effects.fadeIn=.3;},/effects|effect timing/],
 ];
 for(const [label,edit,match] of cases){const p=structuredClone(original);edit(p);const plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,false,label);assert.match(plan.blockers.join('\n'),match,label);await assert.rejects(exportBorumiRoundtrip(p,f),/export blocked/);}
 await assert.rejects(readdir(f.outputRoot),/ENOENT/);assert.deepEqual(await readFile(f.file),f.original);
}finally{await rm(f.root,{recursive:true,force:true})}});

test('native transition/processing and unknown timed controls block structural loss',async()=>{const f=await fixture();try{
 const db=new DatabaseSync(f.file);const video=JSON.parse((db.prepare("SELECT kind FROM scene_timeline_segments WHERE id='video'").get() as any).kind);video.transition={kind:'Crossfade'};db.prepare("UPDATE scene_timeline_segments SET kind=? WHERE id='video'").run(JSON.stringify(video));db.close();
 let p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});p.clips=p.clips.flatMap(c=>splitClip(c,2));let plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.match(plan.blockers.join('\n'),/transitions, tracking or processing/);
 const db2=new DatabaseSync(f.file);delete video.transition;db2.prepare("UPDATE scene_timeline_segments SET kind=? WHERE id='video'").run(JSON.stringify(video));db2.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?,?)').run('unknown','s',0,5,0,9,JSON.stringify({kind:'FutureMotion',unknown:'keep'}));db2.close();
 p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});cutTimelineRange(p,1,2);plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.match(plan.blockers.join('\n'),/FutureMotion timing/);await assert.rejects(exportBorumiRoundtrip(p,f),/export blocked/);
}finally{await rm(f.root,{recursive:true,force:true})}});

test('legacy imports accept unambiguous split ancestry but reject ambiguous sources',async()=>{const f=await fixture();try{
 const p=f.project;for(const c of p.clips)delete c.borumiOriginId;p.clips=p.clips.flatMap(c=>splitClip(c,2));
 const plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,true,plan.blockers.join('\n'));
 const bad=structuredClone(p);bad.clips[1].mediaId='new-media';assert.match((await planBorumiRoundtrip(bad,f.preservationRoot)).blockers.join('\n'),/ambiguous|descendant/);
}finally{await rm(f.root,{recursive:true,force:true})}});

test('split then ripple delete retains the earlier split and accepts inert nested effect intervals',async()=>{const f=await fixture();try{
 const p=f.project;p.clips=p.clips.flatMap(c=>splitClip(c,1));cutTimelineRange(p,1.5,2,true);
 const plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,true,plan.blockers.join('\n'));
 const result=await exportBorumiRoundtrip(p,f),again=await importBorumi(result.path);assert.deepEqual(again.clips.filter(c=>c.track==='audio').map(c=>[c.start,c.sourceIn,c.sourceOut]),[[0,6.25,7.25],[1,7.25,7.75],[1.5,8.25,11.25]]);assert.equal(again.scenes[0].duration,4.5);
}finally{await rm(f.root,{recursive:true,force:true})}});

test('old clips with repeated indistinguishable source ranges require explicit provenance',async()=>{const f=await fixture();try{
 const db=new DatabaseSync(f.file);db.exec("INSERT INTO scene_timeline_segments SELECT 'second-audio',scene_id,0,duration,edited,segment_order+10,kind FROM scene_timeline_segments WHERE id='audio'");db.close();
 const p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});for(const c of p.clips)delete c.borumiOriginId;p.clips=p.clips.flatMap(c=>splitClip(c,2));
 const plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,false);assert.match(plan.blockers.join('\n'),/ambiguous Borumi origin/);
}finally{await rm(f.root,{recursive:true,force:true})}});

test('a user split in a later imported layout piece is not merged away',async()=>{const f=await fixture(true);try{
 f.project.clips=f.project.clips.flatMap(c=>c.track==='camera'&&c.start===2?splitClip(c,3):[c]);
 const plan=await planBorumiRoundtrip(f.project,f.preservationRoot);assert.equal(plan.supported,true,plan.blockers.join('\n'));
 const result=await exportBorumiRoundtrip(f.project,f),db=new DatabaseSync(path.join(result.path,'project.bmproj'),{readOnly:true});
 try{const rows=(db.prepare('SELECT start,duration,kind FROM scene_timeline_segments ORDER BY start').all() as any[]).filter(r=>JSON.parse(r.kind).kind==='VideoClip');assert.deepEqual(rows.map(r=>[r.start,r.duration,JSON.parse(r.kind).clip_start]),[[0,3,2],[3,2,5]]);}finally{db.close()}
}finally{await rm(f.root,{recursive:true,force:true})}});

test('earlier-scene ripple does not apply a later annotation offset twice',async()=>{const f=await fixture();try{
 const source=new DatabaseSync(f.file);source.exec("INSERT INTO scenes VALUES('s2','p','P','Second',''); INSERT INTO scene_timeline_segments SELECT id||'2','s2',start,duration,edited,segment_order,kind FROM scene_timeline_segments WHERE id IN ('audio','video')");
 source.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?,?)').run('text','s2',2,1,0,10,JSON.stringify({kind:'Overlay',overlay_kind:{kind:'Text',text:'Keep here'},position:{kind:'Custom',x_ratio:.1,y_ratio:.1,width_ratio:.8,height_ratio:.2},future:'preserved'}));source.close();
 const p=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot});assert.equal(p.elements[0].start,7);cutTimelineRange(p,1,2,true);assert.equal(p.elements[0].start,6);
 for(const text of ['Keep here','Edited here']){
  p.elements[0].text=text;const plan=await planBorumiRoundtrip(p,f.preservationRoot);assert.equal(plan.supported,true,plan.blockers.join('\n'));
  const result=await exportBorumiRoundtrip(p,f),db=new DatabaseSync(path.join(result.path,'project.bmproj'),{readOnly:true});
  try{const row=db.prepare("SELECT * FROM scene_timeline_segments WHERE id='text'").get() as any;assert.equal(row.start,2);assert.equal(row.duration,1);assert.equal(JSON.parse(row.kind).overlay_kind.text,text);assert.equal(JSON.parse(row.kind).future,'preserved');assert.equal(row.edited,text==='Keep here'?0:1);}finally{db.close()}
  const again=await importBorumi(result.path);assert.equal(again.elements[0].start,6);
 }
}finally{await rm(f.root,{recursive:true,force:true})}});

test('new native projects preserve explicit clip audio roles before media fallback and legacy defaults',async()=>{const f=await fixture();try{
 const source=new DatabaseSync(f.file);source.exec('CREATE TABLE _borumi_migrations(id INTEGER PRIMARY KEY,sql TEXT NOT NULL)');for(let i=0;i<39;i++)source.prepare('INSERT INTO _borumi_migrations VALUES(?,?)').run(i,'-- synthetic schema version');source.close();
 const template=await importBorumi(f.bundle,{roundtripDirectory:f.preservationRoot}),p=createProject('Audio role interchange');p.canvas.padding=0;p.canvas.radius=0;p.scenes[0].duration=4;
 const cases=[{clip:'system',media:'microphone',expected:'system'},{clip:'microphone',media:'system',expected:'microphone'},{clip:undefined,media:'system',expected:'system'},{clip:undefined,media:undefined,expected:'microphone'}] as const;
 p.media=cases.map((item,index)=>({id:`m${index}`,name:`Audio ${index}`,path:path.join(f.bundle,'medias','m.mov'),kind:'video',duration:30,width:1920,height:1080,hasAudio:true,...(item.media?{audioRole:item.media}:{})}));
 p.clips=cases.map((item,index)=>({id:`c${index}`,mediaId:`m${index}`,name:`Audio ${index}`,track:'audio',start:index,sourceIn:0,sourceOut:1,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects(),...(item.clip?{audioRole:item.clip}:{})}));
 const result=await exportNewBorumiProject(p,{...f,templateProject:template}),again=await importBorumi(result.path);
 assert.deepEqual(again.clips.map(c=>c.audioRole),cases.map(c=>c.expected));assert.deepEqual(again.clips.map(c=>c.start),[0,1,2,3]);
}finally{await rm(f.root,{recursive:true,force:true})}});

test('new and preserved Borumi exports block SceneForge take history before dropping any archived recording',async()=>{
 const f=await fixture();try{
  const {saveProjectTake}=await import('../src/recorded-takes.js');const before=await planBorumiRoundtrip(f.project,f.preservationRoot);assert.equal(before.supported,true,before.blockers.join('\n'));
  saveProjectTake(f.project,{id:'saved-retake',sceneId:f.project.scenes[0].id,createdAt:'2026-10-13',media:[f.project.media[0]],tracks:['camera'],offsets:[0]});
  const plan=await planBorumiRoundtrip(f.project,f.preservationRoot);assert.equal(plan.supported,false);assert.ok(plan.blockers.some(b=>/recorded-take history.*export a video/.test(b)));await assert.rejects(exportBorumiRoundtrip(f.project,f),/recorded-take history/);await assert.rejects(readdir(f.outputRoot),/ENOENT/);assert.deepEqual(await readFile(f.file),f.original);
  const fresh=createProject('Retake history');fresh.canvas.padding=0;fresh.canvas.radius=0;assert.equal(planNewBorumiProject(fresh).supported,true);saveProjectTake(fresh,{id:'inactive',sceneId:fresh.scenes[0].id,createdAt:'2026-10-13',media:[f.project.media[0]],tracks:['camera'],offsets:[0]});assert.ok(planNewBorumiProject(fresh).blockers.some(b=>b.includes('recorded-take history')));await assert.rejects(exportNewBorumiProject(fresh,{templateProject:f.project,preservationRoot:f.preservationRoot,outputRoot:f.outputRoot}),/recorded-take history/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
