import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform} from '../shared/types';
import type {Clip} from '../shared/types';
import {mapCaptionsToProject} from './api';

test('source captions are clipped and retimed through cuts, repeats and speeds without muted duplicates',()=>{
 const p=createProject('Caption mapping');
 const base:Clip={id:'a',mediaId:'source',name:'take',track:'audio',start:10,sourceIn:2,sourceOut:4,speed:2,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()};
 p.clips=[base,{...base,id:'b',start:20,speed:1},{...base,id:'c',track:'screen',muted:true},{...base,id:'d'}];
 const source=[{id:'s',start:1,end:5,text:'before inside after',words:[{text:'before',start:1,end:2},{text:'inside',start:2,end:4},{text:'after',start:4,end:5}]}];
 const result=mapCaptionsToProject(source,p,'source');
 assert.equal(result.length,2);
 assert.deepEqual(result.map(c=>({start:c.start,end:c.end,text:c.text})),[{start:10,end:11,text:'inside'},{start:20,end:22,text:'inside'}]);
 assert.deepEqual(result[0].words,[{text:'inside',start:10,end:11}]);
 assert.notEqual(result[0].id,result[1].id);
});

test('captions outside a used source interval do not leak past a trim boundary',()=>{
 const p=createProject();p.clips=[{id:'c',mediaId:'m',name:'trim',track:'audio',start:4,sourceIn:8,sourceOut:10,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
 const result=mapCaptionsToProject([{id:'1',start:0,end:7,text:'excluded'},{id:'2',start:9,end:12,text:'last phrase'}],p,'m');
 assert.equal(result.length,1);assert.equal(result[0].start,5);assert.equal(result[0].end,6);
});
