import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform} from '../shared/types.js';
import {borumiReviewKey,describeBorumiChange,needsBorumiReimport} from './borumi-export-review.js';

test('review key ignores autosave timestamp but invalidates content and source provenance changes',()=>{
 const p=createProject('Review'),copy=structuredClone(p);copy.updatedAt='later';assert.equal(borumiReviewKey(copy),borumiReviewKey(p));copy.scenes[0].script='Changed';assert.notEqual(borumiReviewKey(copy),borumiReviewKey(p));copy.scenes[0].script=p.scenes[0].script;copy.importMetadata={sourceApp:'Borumi',roundtrip:{version:1,snapshotId:'changed'}};assert.notEqual(borumiReviewKey(copy),borumiReviewKey(p));
});
test('legacy imports require preservation while independent and preserved projects do not',()=>{
 const p=createProject();assert.equal(needsBorumiReimport(p),false);p.importMetadata={sourceApp:'Borumi'};assert.equal(needsBorumiReimport(p),true);p.importMetadata.roundtrip={version:1,snapshotId:'saved'};assert.equal(needsBorumiReimport(p),false);
});
test('review describes actual subsecond timing, gain and flip values',()=>{
 const p=createProject();p.clips=[{id:'c',name:'Narration',mediaId:'m',track:'audio',start:1.125,sourceIn:.325,sourceOut:3,speed:1,gain:.5,muted:false,transform:defaultTransform(),effects:{...defaultEffects(),flipX:true}}];
 assert.deepEqual(describeBorumiChange(p,{kind:'clip',id:'c',fields:['start','sourceIn','gain','flipX']}),{name:'Narration',values:[{label:'Timeline start',value:'1.125 s'},{label:'Source in',value:'0.325 s'},{label:'Audio gain',value:'0.5×'},{label:'Horizontal flip',value:'On'}]});
});
