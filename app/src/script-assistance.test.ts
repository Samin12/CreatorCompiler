import {mountUI,button} from './test-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createProject,type Project} from '../shared/types';
import {ScriptEditor} from './ScriptEditor';
const {AIDialog}=await import('./Dialogs');

test('improving the second scene identifies that scene to the assistant',async()=>{
 const p=createProject('Script');p.scenes.push({...p.scenes[0],id:'second',name:'Demo',script:'Second script'});const targets:unknown[]=[];
 const ui=await mountUI(createElement(ScriptEditor,{project:p,change:()=>{},onAI:(id?:string)=>targets.push(id),onRecord:()=>{}}));
 try{const second=ui.container.querySelectorAll('.script-document-scene')[1];await act(async()=>{button(second,'Improve script').click();});assert.deepEqual(targets,['second']);}finally{await ui.close();}
});

test('transcription does not expose a second unscoped script replacement workflow',async()=>{
 const p=createProject(),ui=await mountUI(createElement(AIDialog,{project:p,kind:'transcribe',change:()=>{},flush:async()=>p,onClose:()=>{},onError:()=>{}}));
 try{assert.equal([...ui.container.querySelectorAll('button')].some(button=>button.textContent==='Script help'),false);}finally{await ui.close();}
});

test('a revision cannot replace a script edited after the request',async()=>{
 const p=createProject('Script');p.scenes[0].script='Original';const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({suggestions:[{id:'revision',type:'script',text:'Revision',reason:''}]});
 const errors:string[]=[];const props={project:p,kind:'script',sceneId:p.scenes[0].id,change:(fn:(project:Project)=>void)=>fn(p),flush:async()=>p,onClose:()=>{},onError:(message:string)=>errors.push(message)};
 const ui=await mountUI(createElement(AIDialog,props));
 try{
  await act(async()=>button(ui.container,'Improve script').click());
  const edited=structuredClone(p);edited.scenes[0].script='My newer text';await ui.render(createElement(AIDialog,{...props,project:edited}));
  const replace=[...ui.container.querySelectorAll('button')].find(b=>b.textContent?.startsWith('Replace “'))!;assert.equal(replace.disabled,true);assert.match(ui.container.textContent||'',/Generate a fresh revision/);assert.equal(edited.scenes[0].script,'My newer text');
 }finally{globalThis.fetch=originalFetch;await ui.close();}
});

test('script assistance previews and replaces only its original scene',async()=>{
 const p=createProject('Script');p.scenes[0].script='Keep the introduction.';p.scenes.push({...p.scenes[0],id:'second',name:'Demo',script:'Original demo.'});
 const originalFetch=globalThis.fetch;let request:any;
 globalThis.fetch=async(_url,init)=>{request=JSON.parse(String(init?.body));return Response.json({suggestions:[{id:'revision',type:'script',text:'A clearer demo.',reason:'Shorter'}]});};
 const ui=await mountUI(createElement(AIDialog,{project:p,kind:'script',sceneId:'second',change:fn=>fn(p),flush:async()=>p,onClose:()=>{},onError:message=>assert.fail(message)}));
 try{
  await act(async()=>{[...ui.container.querySelectorAll('button')].find(b=>/Analyze project|Improve script/.test(b.textContent||''))!.click();});
  assert.equal(request.sceneId,'second');assert.match(ui.container.textContent||'',/Original demo\./);assert.match(ui.container.textContent||'',/A clearer demo\./);
  await act(async()=>{[...ui.container.querySelectorAll('button')].find(b=>/Apply selected|Replace.*Demo/.test(b.textContent||''))!.click();});
  assert.equal(p.scenes[0].script,'Keep the introduction.');assert.equal(p.scenes[1].script,'A clearer demo.');
 }finally{globalThis.fetch=originalFetch;await ui.close();}
});
