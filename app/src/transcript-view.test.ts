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
// A word span holds plain text, or nested token spans for an untimed caption; inner tags are stripped to read its text.
const words=(html:string)=>[...html.matchAll(/<span data-word-index="(\d+)" data-selected="(true|false)" class="(transcript-word[^"]*)" title="([^"]*)">(.*?)(?=<span>\s?<span data-word-index|<\/p>)/g)].map(([,index,selected,classes,title,inner])=>({index:Number(index),selected:selected==='true',untimed:classes.split(' ').includes('untimed'),title,text:inner.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()}));
const project=()=>{const p=createProject();p.captions=[
 {id:'a',start:0,end:1.5,text:'Hello there world',words:[{text:'Hello',start:0,end:.5},{text:'there',start:.5,end:1},{text:'world',start:1,end:1.5}]},
 {id:'b',start:2.4,end:3,text:'Overlap test',words:[{text:'Overlap',start:2.4,end:2.8},{text:'test',start:2.5,end:3}]},
 {id:'c',start:4,end:5,text:'Whole caption'}];return p;};

test('transcript renders flowing prose with every word in time order and no per-line timestamps',()=>{
 const html=render(project(),0),list=words(html);
 assert.deepEqual(list.map(word=>word.text),['Hello','there','world','Overlap','test','Whole caption']);assert.deepEqual(list.map(word=>word.index),[0,1,2,3,4,5]);
 assert.doesNotMatch(html,/transcript-stamp/);assert.match(html,/class="transcript-paragraph"/);
 assert.equal(list.filter(word=>word.selected).length,0);assert.match(html,/Delete cuts every track/);
 const whole=list[5];assert.ok(whole.untimed);assert.match(whole.title,/^0:04\.0 · whole caption, word timing unavailable$/);assert.ok(list.slice(0,5).every(word=>!word.untimed));
 assert.equal(list[0].title,'0:00.0');
});
// The spoken word is toggled on the DOM after mount (timing logic is covered by transcript-layout tests), so static markup never carries it.
test('the live word highlight is not baked into static markup',()=>{
 assert.doesNotMatch(render(project(),.5),/transcript-word[^"]*\bcurrent\b/);
});
