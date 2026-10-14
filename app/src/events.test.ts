import {test} from 'node:test';import assert from 'node:assert/strict';
import {eventsOpen,subscribeEvents} from './events';
class FakeSource extends EventTarget{static all:FakeSource[]=[];readyState=0;closed=false;constructor(readonly url:string){super();FakeSource.all.push(this);}close(){this.closed=true;this.readyState=2;}}
const send=(source:FakeSource,type:string,data:unknown)=>source.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));
test('project and automation listeners share one event stream until the last one leaves',()=>{
 const original=globalThis.EventSource;globalThis.EventSource=FakeSource as unknown as typeof EventSource;
 try{
  const project:unknown[]=[],jobs:unknown[]=[],ready:number[]=[];
  const stopProject=subscribeEvents('project',event=>project.push(JSON.parse(event.data))),stopReady=subscribeEvents('ready',()=>ready.push(1)),stopJobs=subscribeEvents('automation',event=>jobs.push(JSON.parse(event.data)));
  assert.equal(FakeSource.all.length,1);const [source]=FakeSource.all;assert.equal(source.url,'/api/events');assert.equal(eventsOpen(),false);source.readyState=1;assert.equal(eventsOpen(),true);
  send(source,'project',{id:'p'});send(source,'automation',{id:'job'});send(source,'ready',{});
  assert.deepEqual(project,[{id:'p'}]);assert.deepEqual(jobs,[{id:'job'}]);assert.deepEqual(ready,[1]);
  stopJobs();stopJobs();send(source,'automation',{id:'late'});assert.equal(jobs.length,1,'an unsubscribed listener receives nothing');
  const second:unknown[]=[];const stopSecond=subscribeEvents('project',event=>second.push(JSON.parse(event.data)));assert.equal(FakeSource.all.length,1);send(source,'project',{id:'q'});assert.deepEqual([project.length,second.length],[2,1]);
  stopProject();stopSecond();assert.equal(source.closed,false,'the ready listener still uses the stream');stopReady();assert.equal(source.closed,true);assert.equal(eventsOpen(),false);
  const stop=subscribeEvents('automation',()=>{});assert.equal(FakeSource.all.length,2,'a later subscriber reconnects');stop();
 }finally{globalThis.EventSource=original;FakeSource.all=[];}
});
