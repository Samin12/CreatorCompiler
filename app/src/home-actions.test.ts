import {mountUI,button} from './test-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Home} from './Home';

test('home offers distinct record, import-footage and write-script actions',async()=>{
 const actions:string[]=[],originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json([]);
 const ui=await mountUI(createElement(Home,{projects:[],loading:false,onNew:()=>actions.push('write'),onQuick:()=>actions.push('record'),onImportMedia:()=>actions.push('footage'),onImport:()=>actions.push('project'),onOpen:()=>{},onDuplicate:()=>{},onDelete:()=>{},onRecovered:async()=>{},onError:()=>{},onTrash:()=>{}}));
 try{for(const label of ['Record a video','Import footage','Write a script']){const action=[...ui.container.querySelectorAll('button')].find(b=>b.querySelector('h2')?.textContent===label);assert.ok(action,`${label} is visible`);await act(async()=>action.click());}assert.deepEqual(actions,['record','footage','write']);}finally{globalThis.fetch=originalFetch;await ui.close();}
});

test('returning users can continue the most recently edited project and search older work',async()=>{
 const opened:string[]=[],originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json([]);
 const projects=[{id:'older',name:'First draft',updatedAt:'2026-10-10T12:00:00Z',duration:0,mediaCount:0,sceneCount:2},{id:'latest',name:'Product walkthrough',updatedAt:'2026-10-15T12:00:00Z',duration:48,clipCount:2,mediaCount:2,sceneCount:3}];
 const ui=await mountUI(createElement(Home,{projects,loading:false,onNew:()=>{},onQuick:()=>{},onImportMedia:()=>{},onImport:()=>{},onOpen:id=>opened.push(id),onDuplicate:()=>{},onDelete:()=>{},onRecovered:async()=>{},onError:()=>{},onTrash:()=>{}}));
 try{
  const resume=ui.container.querySelector<HTMLButtonElement>('button[aria-label="Continue editing Product walkthrough"]');assert.ok(resume);await act(async()=>resume.click());assert.deepEqual(opened,['latest']);
  assert.match(ui.container.querySelector('h1')?.textContent??'',/Your projects/);
  const search=ui.container.querySelector<HTMLInputElement>('[aria-label="Search projects"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'First');search.dispatchEvent(new Event('input',{bubbles:true}));});
  const first=ui.container.querySelector<HTMLButtonElement>('button[aria-label="Open First draft"]');assert.ok(first);await act(async()=>first.click());assert.deepEqual(opened,['latest','older']);
 }finally{globalThis.fetch=originalFetch;await ui.close();}
});

test('project menus expose secondary actions without opening the project and Escape restores focus',async()=>{
 const actions:string[]=[],originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json([]);
 const projects=[{id:'draft',name:'First draft',updatedAt:'2026-10-10T12:00:00Z',duration:60,clipCount:0,mediaCount:0,sceneCount:2}];
 const ui=await mountUI(createElement(Home,{projects,loading:false,onNew:()=>{},onQuick:()=>{},onImportMedia:()=>{},onImport:()=>actions.push('import'),onOpen:()=>actions.push('open'),onDuplicate:id=>actions.push(`duplicate:${id}`),onDelete:id=>actions.push(`trash:${id}`),onRecovered:async()=>{},onError:()=>{},onTrash:()=>actions.push('trash')}));
 try{
  assert.ok(ui.container.querySelector('[aria-label="Continue writing First draft"]'),'a planned scene duration does not imply editable footage');
  const more=ui.container.querySelector<HTMLButtonElement>('[aria-label="More actions for First draft"]');assert.ok(more);assert.equal(Boolean(ui.container.querySelector('[aria-label="Duplicate First draft"]')),false);
  await act(async()=>more.click());await act(async()=>button(ui.container,'Duplicate').click());assert.deepEqual(actions,['duplicate:draft']);assert.equal(more.getAttribute('aria-expanded'),'false');
  await act(async()=>more.click());await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(more.getAttribute('aria-expanded'),'false');assert.equal(document.activeElement===more,true);
  await act(async()=>more.click());await act(async()=>button(ui.container,'Move to trash').click());assert.deepEqual(actions,['duplicate:draft','trash:draft']);
  const options=ui.container.querySelector<HTMLButtonElement>('[aria-label="Project library options"]')!;await act(async()=>options.click());await act(async()=>button(ui.container,'Import project file…').click());assert.deepEqual(actions,['duplicate:draft','trash:draft','import']);
 }finally{globalThis.fetch=originalFetch;await ui.close();}
});
