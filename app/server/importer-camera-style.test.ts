import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importBorumi} from './importer';

async function fixture(width:number,height:number,extra:Record<string,unknown>={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'sceneforge-style-'));
 await mkdir(path.join(dir,'medias'));await writeFile(path.join(dir,'medias','m.mov'),'synthetic metadata fixture');
 const filename=path.join(dir,'project.bmproj'),db=new DatabaseSync(filename);
 db.exec('CREATE TABLE projects(id TEXT,name TEXT,render_target TEXT); CREATE TABLE scenes(id TEXT,seq TEXT,name TEXT,script TEXT); CREATE TABLE clips(id TEXT,media TEXT,start_offset REAL,start_offset_adjustment REAL,duration REAL); CREATE TABLE medias(id TEXT,name TEXT,tracks TEXT,duration REAL,width INT,height INT); CREATE TABLE scene_timeline_segments(id TEXT,scene_id TEXT,start REAL,duration REAL,segment_order INT,kind TEXT);');
 db.prepare('INSERT INTO projects VALUES(?,?,?)').run('p','Synthetic style',JSON.stringify({mode:{width,height}}));
 db.prepare('INSERT INTO scenes VALUES(?,?,?,?)').run('s','a','Scene','');db.prepare('INSERT INTO clips VALUES(?,?,?,?,?)').run('c','m',0,0,3);
 db.prepare('INSERT INTO medias VALUES(?,?,?,?,?,?)').run('m','Synthetic',JSON.stringify([{kind:'Video'}]),3,1920,1080);
 const insert=db.prepare('INSERT INTO scene_timeline_segments VALUES(?,?,?,?,?,?)');
 const style={border_radius_ratio:19.2/1080,shadow_style:{x_offset_ratio:-3/1080,y_offset_ratio:20/1080,blur_ratio:20/1080,color:{r:0,g:0,b:0,a:100}},...extra};
 insert.run('video','s',0,3,0,JSON.stringify({kind:'VideoClip',clip_id:'c',content_kind:{kind:'Camera'}}));
 insert.run('layout','s',0,3,1,JSON.stringify({kind:'Layout',layout_kind_v2:{kind:'Custom',sources:[{source:{content_kind:{kind:'Camera'},layer_index:0},x_ratio:.8,y_ratio:.2,width_ratio:.18,height_ratio:.57,...style}]}}));
 insert.run('overlay','s',0,3,2,JSON.stringify({kind:'Overlay',overlay_kind:{kind:'Media',media_id:'m'},position:{x_ratio:.1,y_ratio:.2,width_ratio:.5,height_ratio:.4},...style}));db.close();
 return {dir,filename};
}
test('native camera and media overlay radius/shadow use minimum canvas dimension in landscape and portrait',async()=>{
 for(const [width,height] of [[1920,1080],[1080,1920],[640,360]]){
  const {dir,filename}=await fixture(width,height);try{
   const before=await readFile(filename),project=await importBorumi(dir),scale=Math.min(width,height)/1080;
   assert.deepEqual(await readFile(filename),before);assert.equal(project.clips.length,2);
   for(const clip of project.clips){assert.ok(Math.abs(clip.transform.borderRadius-19.2*scale)<1e-9);assert.deepEqual(clip.transform.shadow,{x:-3*scale,y:20*scale,blur:20*scale,color:'#00000064'});}
   assert.ok(!project.importWarnings!.some(w=>/shadow|stroke/.test(w)));
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('unsupported stroke and corner forms retain explicit warnings while valid shadows still import',async()=>{
 const {dir}=await fixture(1080,1920,{stroke_style:{width_ratio:.01},corner_shape:{kind:'SquircleV2'},overflow:true});try{const p=await importBorumi(dir);assert.ok(p.importWarnings!.some(w=>w.includes('stroke')));assert.ok(p.importWarnings!.some(w=>w.includes('corner shape')));assert.ok(p.clips.every(c=>c.transform.shadow?.color==='#00000064'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('malformed shadow style is not silently converted to a valid-looking shadow',async()=>{
 const {dir}=await fixture(1920,1080,{shadow_style:{x_offset_ratio:0,y_offset_ratio:0,blur_ratio:-1,color:{r:0,g:0,b:0,a:100}}});try{const p=await importBorumi(dir);assert.ok(p.clips.every(c=>!c.transform.shadow));assert.ok(p.importWarnings!.some(w=>/shadow/.test(w)));}finally{await rm(dir,{recursive:true,force:true});}
});
