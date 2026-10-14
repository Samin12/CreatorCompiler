import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createProject,type Project} from '../shared/types';
import {createPlayhead} from './playhead';

// Node cannot load the stylesheet Transcript imports; resolve it to an empty module before the component loads.
registerHooks({resolve:(specifier,context,next)=>specifier.endsWith('.css')?{url:'data:text/javascript,',shortCircuit:true}:next(specifier,context)});
const {Transcript}=await import('./Transcript');

const render=(project:Project,time:number)=>renderToStaticMarkup(React.createElement(Transcript,{project,playhead:createPlayhead(time),onSeek:()=>{},onDelete:()=>{},onUndo:()=>{},onRedo:()=>{}})).replaceAll('<!-- -->','');
const words=(html:string)=>[...html.matchAll(/<span data-word-index="(\d+)" data-selected="(true|false)" class="transcript-word ([^"]*)" title="([^"]*)">([^<]*) <\/span>/g)].map(([,index,selected,classes,title,text])=>({index:Number(index),selected:selected==='true',current:classes.split(' ').includes('current'),untimed:classes.split(' ').includes('untimed'),title,text}));
const current=(project:Project,time:number)=>words(render(project,time)).filter(word=>word.current).map(word=>word.text);
const project=()=>{const p=createProject();p.captions=[
 {id:'a',start:0,end:1.5,text:'Hello there world',words:[{text:'Hello',start:0,end:.5},{text:'there',start:.5,end:1},{text:'world',start:1,end:1.5}]},
 {id:'b',start:2.4,end:3,text:'Overlap test',words:[{text:'Overlap',start:2.4,end:2.8},{text:'test',start:2.5,end:3}]},
 {id:'c',start:4,end:5,text:'Whole caption'}];return p;};

test('transcript renders one sentence per caption with every word in time order',()=>{
 const html=render(project(),0),list=words(html);
 assert.deepEqual(list.map(word=>word.text),['Hello','there','world','Overlap','test','Whole caption']);assert.deepEqual(list.map(word=>word.index),[0,1,2,3,4,5]);
 assert.deepEqual([...html.matchAll(/<span class="transcript-stamp">([^<]*)<\/span>/g)].map(match=>match[1]),['0.00s','2.40s','4.00s']);
 assert.equal(list.filter(word=>word.selected).length,0);assert.match(html,/Select words, then press Delete\./);
 const whole=list[5];assert.ok(whole.untimed);assert.match(whole.title,/^4\.000–5\.000s · Whole caption: word timing unavailable$/);assert.ok(list.slice(0,5).every(word=>!word.untimed));
});
test('transcript highlights the words under the playhead, including overlapping words',()=>{
 const p=project();
 assert.deepEqual(current(p,0),['Hello']);assert.deepEqual(current(p,.5),['there']);assert.deepEqual(current(p,1.2),['world']);
 assert.deepEqual(current(p,1.8),[]);assert.deepEqual(current(p,2.45),['Overlap']);assert.deepEqual(current(p,2.6),['Overlap','test']);assert.deepEqual(current(p,2.9),['test']);
 assert.deepEqual(current(p,4.5),['Whole caption']);assert.deepEqual(current(p,5),[]);
});
