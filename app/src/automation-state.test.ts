import {test} from 'node:test';import assert from 'node:assert/strict';
import type {AutomationJob} from '../shared/automation';
import {mergeAutomationJobs,reuseAutomationJobs,selectedChangeIds} from './automation-state';
const job=(id:string,status:AutomationJob['status'],stamp:number,extra:Partial<AutomationJob>={})=>({id,projectId:'p',kind:'auto-cut',status,progress:0,message:'',createdAt:`2026-10-13T00:00:0${stamp}.000Z`,updatedAt:`2026-10-13T00:00:0${stamp}.000Z`,automatic:false,applied:false,undone:false,...extra})as AutomationJob;
test('initial history arriving late retains a new active proposal',()=>{const jobs=mergeAutomationJobs([job('new','running',3)],[job('old','complete',1)]);assert.deepEqual(jobs.map(j=>j.id),['new','old']);assert.equal(mergeAutomationJobs(jobs,[job('new','queued',2)])[0].status,'running');});
test('late polling cannot revert apply, undo or cancel',()=>{const applied=job('a','complete',5,{applied:true});assert.equal(mergeAutomationJobs([applied],[job('a','ready',6)])[0].applied,true);assert.equal(mergeAutomationJobs([job('a','complete',6,{applied:true,undone:true})],[applied])[0].undone,true);assert.equal(mergeAutomationJobs([job('a','cancelled',4)],[job('a','running',5)])[0].status,'cancelled');});
test('ready proposal advances to applied then guarded undo state',()=>{const ready=job('a','ready',2),applied=job('a','complete',3,{applied:true});assert.equal(mergeAutomationJobs([ready],[applied])[0].applied,true);assert.equal(mergeAutomationJobs([applied],[job('a','complete',4,{applied:true,undone:true})])[0].undone,true);});
test('only reviewed IDs from the current proposal are sent and empty selection stays empty',()=>{const current=job('a','ready',2,{proposal:{summary:'',warnings:[],baseRevision:'rev',beforeDuration:10,afterDuration:9,changes:[{id:'one',label:'',reason:'',selected:true,category:'silence'},{id:'two',label:'',reason:'',selected:false,category:'repeat'}]}});assert.deepEqual(selectedChangeIds(current,new Set(['one','stale'])),['one']);assert.deepEqual(selectedChangeIds(current,new Set()),[]);});
test('a refresh without changes keeps the same list so React can skip rendering',()=>{
 const current=mergeAutomationJobs([],[job('a','running',2,{progress:.5}),job('b','complete',1)]);
 const polled=mergeAutomationJobs(current,[job('a','running',2,{progress:.5}),job('b','complete',1)]);assert.notEqual(polled,current);
 assert.equal(reuseAutomationJobs(current,polled),current);
 const progressed=reuseAutomationJobs(current,mergeAutomationJobs(current,[job('a','running',3,{progress:.6})]));assert.notEqual(progressed,current);assert.equal(progressed[0].progress,.6);assert.equal(progressed[1],current[1],'unchanged jobs keep their object');
 assert.deepEqual(reuseAutomationJobs(current,current.slice(1)).map(j=>j.id),['b']);assert.deepEqual(reuseAutomationJobs([],[job('c','queued',4)]).map(j=>j.id),['c']);
});
