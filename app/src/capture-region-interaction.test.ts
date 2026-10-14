import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

class Element {
 style:Record<string,string>={};dataset:Record<string,string>={};textContent='';disabled=false;id:string;listeners=new Map<string,Function[]>();captured=new Set<number>();parent:Element|null=null;
 constructor(id:string){this.id=id;}
 addEventListener(type:string,listener:Function){this.listeners.set(type,[...(this.listeners.get(type)||[]),listener]);}
 emit(type:string,event:unknown){for(const listener of this.listeners.get(type)||[])listener(event);}
 contains(target:Element):boolean{return target===this||!!target.parent&&this.contains(target.parent);}
 focus(){} setPointerCapture(id:number){this.captured.add(id);} hasPointerCapture(id:number){return this.captured.has(id);} releasePointerCapture(id:number){this.captured.delete(id);}
}
async function setup(){
 const elements=new Map(['surface','region','dimensions','confirm','full-display','cancel','region-error','display-label','toolbar'].map(id=>[id,new Element(id)]));
 elements.get('region')!.parent=elements.get('surface')!;
 const document=new Element('document') as Element&{getElementById:(id:string)=>Element};document.getElementById=id=>elements.get(id)!;
 const window=new Element('window') as Element&{capturePicker:unknown};const selected:unknown[]=[];
 window.capturePicker={getData:async()=>({display:{label:'Retina display',bounds:{x:-3200,y:0,width:3200,height:1350}},initialRegion:{x:100/3200,y:100/1350,width:1203/3200,height:703/1350}}),finish:async(r:unknown)=>selected.push(r),cancel:()=>{}};
 const context=vm.createContext({document,window,innerWidth:3200,innerHeight:1350});
 const source=process.env.SCENEFORGE_REGION_TEST_SOURCE||new URL('../desktop/capture-region.js',import.meta.url);
 vm.runInContext(readFileSync(source,'utf8'),context);await Promise.resolve();
 const send=(type:string,x:number,y:number,target='surface',extra:Record<string,unknown>={})=>{
  const node=elements.get(target)!;const event={type,target:node,clientX:x,clientY:y,pointerId:1,button:0,isPrimary:true,preventDefault(){},...extra};
  if(type==='lostpointercapture')elements.get('surface')!.captured.delete(Number(event.pointerId));
  document.emit(type,event);for(let current:Element|null=node;current;current=current.parent)current.emit(type,event);
 };
 const rect=()=>JSON.parse(vm.runInContext('JSON.stringify(rect)',context));
 return {elements,window,document,send,rect,selected};
}
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('outside redraw uses pointerup endpoint when intermediate moves are absent',async()=>{
 const h=await setup();h.send('pointerdown',1600,200);h.send('pointerup',2500,800);
 near(h.rect().x,.5);near(h.rect().y,200/1350);near(h.rect().width,900/3200);near(h.rect().height,600/1350);assert.equal(h.elements.get('confirm')!.disabled,false);
});
test('outside focus click does not discard the last usable region',async()=>{
 const h=await setup(),before=h.rect();h.send('pointerdown',1600,200);h.send('pointerup',1600,200);assert.deepEqual(h.rect(),before);assert.equal(h.elements.get('confirm')!.disabled,false);
});
test('pointer cancel and window blur restore the previous selection',async()=>{
 for(const end of ['pointercancel','blur']){
  const h=await setup(),before=h.rect();h.send('pointerdown',1600,200);h.send('pointermove',2000,500);
  if(end==='blur')h.window.emit('blur',{});else h.send(end,2000,500);
  assert.deepEqual(h.rect(),before,end);assert.equal(h.elements.get('confirm')!.disabled,false);
  h.send('pointermove',2700,900);assert.deepEqual(h.rect(),before,'cancelled drag cannot resume');
 }
});
test('unrelated pointers cannot replace or release the active region drag',async()=>{
 const h=await setup();h.send('pointerdown',1600,200);h.send('pointerdown',1700,300,'surface',{pointerId:2,isPrimary:false});h.send('pointerup',2800,1200,'surface',{pointerId:2});h.send('pointermove',1900,400,'surface',{pointerId:2});h.send('pointerup',2500,800);
 near(h.rect().width,900/3200);near(h.rect().height,600/1350);
});
test('release crossing the toolbar completes and clamps the normalized crop',async()=>{
 const h=await setup();h.send('pointerdown',1600,200);h.send('pointerup',3400,1600,'toolbar');near(h.rect().x,.5);near(h.rect().width,.5);near(h.rect().height,1-200/1350);assert.equal(h.elements.get('confirm')!.disabled,false);
});
test('final release coordinates retain move and resize semantics and reject a tiny crop',async()=>{
 const h=await setup();h.send('pointerdown',500,300,'region');h.send('pointerup',600,400);near(h.rect().x,200/3200);near(h.rect().y,200/1350);near(h.rect().width,1203/3200);
 const handle=new Element('handle');handle.dataset.handle='e';handle.parent=h.elements.get('region')!;h.elements.set('handle',handle);h.send('pointerdown',1403,500,'handle');h.send('pointerup',1600,500);near(h.rect().width,1400/3200);
 h.send('pointerdown',2500,1000);h.send('pointerup',2502,1003);assert.equal(h.elements.get('confirm')!.disabled,true);
});

test('native lost-capture before final move and up still completes the outside redraw',async()=>{
 const h=await setup();h.send('pointerdown',1600,200);h.send('lostpointercapture',2500,800,'surface',{buttons:0});h.send('pointermove',2500,800,'surface',{buttons:0});h.send('pointerup',2500,800,'surface',{buttons:0});near(h.rect().x,.5);near(h.rect().y,200/1350);near(h.rect().width,900/3200);near(h.rect().height,600/1350);assert.equal(h.elements.get('confirm')!.disabled,false);
});
test('a fresh press after capture loss abandons a missing-release gesture safely',async()=>{
 const h=await setup();h.send('pointerdown',1600,200);h.send('pointermove',1800,400);h.send('lostpointercapture',1800,400);h.send('pointerdown',2000,800);h.send('pointerup',2700,1200);near(h.rect().x,2000/3200);near(h.rect().y,800/1350);near(h.rect().width,700/3200);near(h.rect().height,400/1350);
});
