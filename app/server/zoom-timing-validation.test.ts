import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../shared/types.js';
import {validateProject} from './storage.js';
test('split zoom timing validates finite bounded phase without rewriting existing zooms',()=>{
 const project=createProject();project.zooms=[{id:'zoom',start:2,duration:2,scale:2,x:.5,y:.5,target:'screen',easing:'smooth'}];
 assert.equal(validateProject(project).zooms[0].effectTiming,undefined);
 project.zooms[0].effectTiming={offset:2,duration:6};assert.deepEqual(validateProject(project).zooms[0].effectTiming,{offset:2,duration:6});
 for(const invalid of [null,[],{}, {offset:-1,duration:5},{offset:0,duration:0},{offset:Infinity,duration:5},{offset:0,duration:NaN},{offset:86401,duration:10},{offset:0,duration:86401}]){
  Object.assign(project.zooms[0],{effectTiming:invalid});assert.throws(()=>validateProject(project),/Invalid zoom effect timing/);
 }
});
