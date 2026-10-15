import {mountUI} from './test-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {createProject} from '../shared/types';
const {Recording}=await import('./Recording');

test('included recording sources say they need a preview instead of claiming readiness',async()=>{
 localStorage.clear();const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json([]);
 Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'prompt'})},configurable:true});
 const ui=await mountUI(createElement(Recording,{project:createProject(),change:()=>{},onRecorded:()=>{},onError:()=>{}}));
 try{
  const camera=ui.container.querySelector('[aria-label="Camera"][role="switch"]')!;assert.equal(camera.getAttribute('aria-checked'),'true');
  const status=camera.closest('section')!.querySelector('[role="status"]');assert.ok(status);assert.match(status.textContent||'',/Preview not started/);
 }finally{globalThis.fetch=originalFetch;await ui.close();}
});
