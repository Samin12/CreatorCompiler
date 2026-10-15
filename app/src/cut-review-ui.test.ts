import {mountUI,button} from './test-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createProject} from '../shared/types';
import type {AutomationJob} from '../shared/automation';
const {QuickActionDialog}=await import('./QuickActions');

test('a proposed cut offers original and edited playback before applying changes',async()=>{
 const project=createProject('Review');project.scenes[0].duration=10;
 const job:AutomationJob={id:'job',projectId:project.id,kind:'auto-cut',status:'ready',progress:1,message:'Ready',createdAt:'2026-10-15',updatedAt:'2026-10-15',automatic:false,applied:false,undone:false,proposal:{summary:'One cut',warnings:[],baseRevision:'fixture',beforeDuration:10,afterDuration:8,changes:[{id:'cut',category:'silence',label:'Quiet gap',start:3,end:5,selected:true,reason:'Quiet audio'}]}};
 const originalFetch=globalThis.fetch;let requested:any;
 globalThis.fetch=async(_url,init)=>{requested=JSON.parse(String(init?.body));return Response.json({before:project,after:project,joins:[{id:'cut',label:'Quiet gap',originalStart:3,originalEnd:5,editedTime:3}]});};
 const ui=await mountUI(createElement(QuickActionDialog,{project,kind:'auto-cut',jobs:[job],merge:()=>{},flush:async()=>project,reload:async()=>{},onClose:()=>{}}));
 try{await act(async()=>button(ui.container,'Review cut playback').click());assert.deepEqual(requested,{changeIds:['cut']});assert.ok(button(ui.container,'Original'));assert.ok(button(ui.container,'Edited'));assert.ok(button(ui.container,'Play comparison'));assert.equal(project.scenes[0].duration,10);}finally{globalThis.fetch=originalFetch;await ui.close();}
});
