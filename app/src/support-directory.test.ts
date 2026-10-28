import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {supportDirectory}=require('../desktop/runtime.cjs');

test('a SceneForge folder moves to Creator Compiler once, keeping its contents',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'cc-support-'));
 try{
  fs.mkdirSync(path.join(base,'SceneForge/studio'),{recursive:true});fs.writeFileSync(path.join(base,'SceneForge/studio/project.json'),'{}');
  assert.equal(supportDirectory(base),path.join(base,'Creator Compiler'));
  assert.equal(fs.readFileSync(path.join(base,'Creator Compiler/studio/project.json'),'utf8'),'{}');
  assert.equal(fs.existsSync(path.join(base,'SceneForge')),false);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('an existing Creator Compiler folder is never replaced by a leftover SceneForge folder',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'cc-support-'));
 try{
  fs.mkdirSync(path.join(base,'Creator Compiler'));fs.mkdirSync(path.join(base,'SceneForge'));
  assert.equal(supportDirectory(base),path.join(base,'Creator Compiler'));
  assert.equal(fs.existsSync(path.join(base,'SceneForge')),true);
  assert.equal(supportDirectory(path.join(base,'missing')),path.join(base,'missing','Creator Compiler'));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('a folder that cannot be moved is used where it is',()=>{
 const legacy=path.join('/support','SceneForge');
 const fsImpl={existsSync:(file:string)=>file===legacy,renameSync:()=>{throw new Error('busy');}};
 assert.equal(supportDirectory('/support',fsImpl),legacy);
});
