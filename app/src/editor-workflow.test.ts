import {mountUI,button} from './test-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createProject} from '../shared/types';
const {default:App}=await import('./App');

test('an empty editor prioritizes the preview and reveals controls on request',async()=>{
 const p=createProject('Editing demo'),originalFetch=globalThis.fetch;
 localStorage.clear();localStorage.setItem('sceneforge.onboarding.v1','done');
 class Source extends EventTarget{close(){}}Object.assign(globalThis,{EventSource:Source});
 globalThis.fetch=async(input,init)=>{
  const url=String(input);if(url==='/api/projects')return Response.json([p]);
  if(url===`/api/projects/${p.id}`)return Response.json(p,{headers:{ETag:'"test"'}});
  if(url==='/api/health')return Response.json({ffmpeg:true,ffprobe:true,transcription:{local:true,providers:[]},mcp:{},version:'test'});
  if(url==='/api/automation/settings')return Response.json({automaticTranscription:false});
  if(url.endsWith('/agent-chat'))return Response.json({jobs:[]});
  if(url.includes('/automation'))return Response.json({jobs:[]});return Response.json([]);
 };
 const ui=await mountUI(createElement(App));
 try{
  const setup=ui.container.querySelector('[aria-label="Close setup"]') as HTMLButtonElement|null;await act(async()=>setup?.click());
  await act(async()=>{[...ui.container.querySelectorAll('button')].find(b=>b.className==='recent-project-main')!.click();});
  await act(async()=>button(ui.container,'Edit').click());
  assert.equal(Boolean(ui.container.querySelector('.inspector')),false,'inspector starts collapsed');assert.equal(Boolean(ui.container.querySelector('.transcript-panel')),false,'empty transcript starts collapsed');
  await act(async()=>button(ui.container,'Canvas').click());assert.ok(ui.container.querySelector('.inspector'));
  await act(async()=>button(ui.container,'Canvas').click());assert.equal(Boolean(ui.container.querySelector('.inspector')),false,'inspector starts collapsed');
  await act(async()=>button(ui.container,'Transcript').click());assert.ok(ui.container.querySelector('.transcript-panel'));
  const transcribe=[...ui.container.querySelectorAll('.transcript-panel button')].filter(b=>/transcri(be|pt)/i.test(b.textContent||''));assert.equal(transcribe.length,1);
 }catch(error){if(error instanceof AggregateError)throw Error(error.errors.map(item=>item.stack||String(item)).join('\n'));throw error;}finally{globalThis.fetch=originalFetch;await ui.close();}
});
