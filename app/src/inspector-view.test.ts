import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createProject,type Project} from '../shared/types';
import {Inspector} from './Inspector';
import {createPlayhead} from './playhead';

const render=(project:Project,time:number)=>renderToStaticMarkup(React.createElement(Inspector,{project,panel:'Cursor',selected:null,playhead:createPlayhead(time),change:()=>{},select:()=>{},onImport:()=>{},onAI:()=>{}})).replaceAll('<!-- -->','');
const rows=(html:string)=>[...html.matchAll(/<div class="cursor-point"><b>([^<]*)<\/b>/g)].map(match=>match[1]);

test('cursor keyframes render whole when short and as a window around the playhead when long',()=>{
 const p=createProject();p.cursor.points=Array.from({length:40},(_,i)=>({time:i,x:.5,y:.5}));
 const short=render(p,12);assert.equal(rows(short).length,40);assert.doesNotMatch(short,/Showing keyframes/);assert.match(short,/Position at 00:12<\/button>/);
 p.cursor.points=Array.from({length:1000},(_,i)=>({time:i/60,x:i/1000,y:.5}));
 const long=render(p,500/60),visible=rows(long);
 assert.equal(visible.length,150);assert.match(long,/Showing keyframes 451–600 of 1000 near the playhead/);assert.equal(visible[0],'00:07');assert.equal(visible.at(-1),'00:09');
 // Rows keep their real index: the first windowed row edits point 450, whose x is .45.
 assert.match(long,/<div class="cursor-point"><b>00:07<\/b><label class="field"><span>X<\/span><input aria-label="X" type="number" min="0" max="1" step="0.1" value="0.45"\/>/);
 assert.match(render(p,0),/Showing keyframes 1–150 of 1000/);assert.match(render(p,999),/Showing keyframes 851–1000 of 1000/);
});
