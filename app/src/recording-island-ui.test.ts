import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';

test('island keeps recording controls visible while camera and script panels toggle independently',async()=>{
 const browser=new Window({settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}}),commands:string[]=[];let update!:(state:any)=>void;
 const state={status:'recording',elapsed:12,projectName:'Demo',cameraEnabled:true,script:'Read this paragraph.',layout:{camera:false,script:false},microphoneLabel:'Mic',microphoneLevel:.4};
 Object.assign(browser,{recordingPreview:{read:async()=>state,subscribe:(callback:typeof update)=>{update=callback;return()=>{};},command:async(value:string)=>commands.push(value),layout:async(layout:any)=>{update({layout});return layout;}}});
 browser.document.write(await readFile(new URL('../desktop/recording-hud.html',import.meta.url),'utf8'));browser.eval(await readFile(new URL('../desktop/recording-hud.js',import.meta.url),'utf8'));await new Promise(resolve=>setTimeout(resolve,0));
 const doc=browser.document;
 try{
  assert.equal((doc.querySelector('.prompt') as any).hidden,true,'script starts hidden');assert.equal((doc.getElementById('camera') as any).hidden,true);
  assert.match(doc.getElementById('status')?.textContent||'',/Recording/);assert.equal(doc.getElementById('clock')?.textContent,'00:12');
  const stop=doc.getElementById('stop')!,parent=stop.parentElement;
  (doc.getElementById('script-toggle') as any).click();assert.equal((doc.querySelector('.prompt') as any).hidden,false);assert.equal((doc.getElementById('camera') as any).hidden,true);
  (doc.getElementById('camera-toggle') as any).click();assert.equal((doc.getElementById('camera') as any).hidden,false);assert.equal(stop.parentElement,parent);assert.deepEqual(commands,[]);
  update({status:'paused'});assert.equal(doc.getElementById('status')?.textContent,'Paused');assert.equal(doc.getElementById('pause')?.textContent,'Resume');
  (doc.getElementById('stop') as any).click();await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(commands,['stop']);
 }finally{await browser.happyDOM.close();}
});

test('island defaults to native scrolling with optional auto-scroll in reading settings',async()=>{
 const browser=new Window({settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});let update!:(state:any)=>void;
 const state={status:'paused',elapsed:12,script:'First paragraph.\n\nSecond paragraph.',layout:{camera:false,script:true}};
 Object.assign(browser,{recordingPreview:{read:async()=>state,subscribe:(callback:typeof update)=>{update=callback;return()=>{};},command:async()=>{},layout:async(layout:any)=>{update({layout});return layout;}}});
 browser.document.write(await readFile(new URL('../desktop/recording-hud.html',import.meta.url),'utf8'));browser.eval(await readFile(new URL('../desktop/recording-hud.js',import.meta.url),'utf8'));await new Promise(resolve=>setTimeout(resolve,0));
 const doc=browser.document;
 try{
  const size=doc.querySelector('input[type="range"][aria-label="Script text size"]') as any;
  assert.ok(size,'reading size uses a continuous labeled control');
  (doc.getElementById('reading-settings') as any).click();assert.equal((doc.getElementById('reading-options') as any).hidden,false);
  size.value='28';size.dispatchEvent(new browser.Event('input'));assert.equal((doc.getElementById('script') as any).style.fontSize,'28px');assert.equal(doc.getElementById('font-value')?.textContent,'28');
  assert.equal(Boolean(doc.querySelector('[aria-label="Paragraph navigation"]')),false);
  assert.equal(Boolean(doc.querySelector('[aria-label="Start script scrolling"]')),false);
  const automatic=doc.querySelector('input[type="checkbox"][aria-label="Auto-scroll script"]') as any;
  assert.ok(automatic,'automatic scrolling is optional in reading settings');assert.equal(automatic.checked,false);
  const speed=doc.querySelector('[aria-label="Script scroll speed"]') as any;assert.equal(speed.disabled,false);
  speed.value='55';speed.dispatchEvent(new browser.Event('input'));assert.equal(doc.getElementById('speed-value')?.textContent,'55');assert.equal(automatic.checked,false,'choosing speed does not start scrolling');
  automatic.click();assert.equal(automatic.checked,true);assert.equal(speed.disabled,false);
  const wheel=new browser.WheelEvent('wheel',{deltaY:80,cancelable:true});doc.getElementById('script')!.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented,false,'trackpad and mouse scrolling stay native');assert.equal(automatic.checked,false);assert.equal(speed.disabled,false);
  automatic.click();const key=new browser.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});doc.getElementById('script')!.dispatchEvent(key);
  assert.equal(key.defaultPrevented,false,'native keyboard scrolling is not intercepted');assert.equal(automatic.checked,false);
  assert.equal(doc.getElementById('script-toggle')?.getAttribute('aria-label'),'Collapse teleprompter');
  (doc.getElementById('script-toggle') as any).click();assert.equal(doc.getElementById('script-toggle')?.getAttribute('aria-label'),'Expand teleprompter');
 }finally{await browser.happyDOM.close();}
});
