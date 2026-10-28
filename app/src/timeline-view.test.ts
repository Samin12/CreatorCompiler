import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createProject,defaultEffects,defaultTransform,type Clip,type Media,type Project} from '../shared/types';
import {createPlayhead} from './playhead';

// Node cannot load stylesheets; resolve them to an empty module before the component loads.
registerHooks({resolve:(specifier,context,next)=>specifier.endsWith('.css')?{url:'data:text/javascript,',shortCircuit:true}:next(specifier,context)});
const {Timeline}=await import('./Timeline');

const clip=(id:string,mediaId:string,track:Clip['track'],start:number,length:number):Clip=>({id,mediaId,name:`Clip ${id}`,track,start,sourceIn:0,sourceOut:length,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()});
const project=()=>{const p=createProject();const video:Media={id:'video',path:'/fixture/video.mov',name:'Video',kind:'video',duration:1202,width:1920,height:1080,hasAudio:true},audio:Media={id:'audio',path:'/fixture/line.wav',name:'Line',kind:'audio',duration:4,width:0,height:0};p.media=[video,audio];p.clips=[clip('long','video','screen',0,1202),...Array.from({length:40},(_,i)=>clip(`a${i}`,'audio','audio',i*30,3))];p.captions=[{id:'near',start:2,end:3,text:'Near caption'},{id:'far',start:900,end:901,text:'Far caption'}];return p;};
const render=(p:Project,time:number,extra:Record<string,unknown>={})=>renderToStaticMarkup(React.createElement(Timeline,{project:p,playhead:createPlayhead(time),zoom:55,selected:null,onSelect:()=>{},onSeek:()=>{},change:()=>{},onDropMedia:()=>{},tool:'select',scrubbing:false,selectedIds:new Set<string>(),onSplit:()=>{},onZoom:()=>{},onSelectMany:()=>{},selectedRange:null,onRange:()=>{},...extra})).replaceAll('<!-- -->','');

test('timeline markup does not depend on playhead time, so playback ticks never need a timeline render',()=>{
 const p=project();assert.equal(render(p,0),render(p,600));
 assert.match(render(p,600),/<div class="playhead"><span><\/span><\/div>/);
});
test('only clips and items inside the quantized window render, without per-bar line elements or scroll offsets',()=>{
 const html=render(project(),0),ids=[...html.matchAll(/data-clip-id="([^"]+)"/g)].map(match=>match[1]);
 // The initial 1000 px viewport renders 1500 px: 27.3 s at 55 px/s.
 assert.deepEqual(ids,['long','a0']);assert.match(html,/Near caption/);assert.doesNotMatch(html,/Far caption/);
 assert.doesNotMatch(html,/<line/);assert.doesNotMatch(html,/margin-left/);assert.match(html,/<span>Clip long<\/span>/);
});
test('blade guide is mounted hidden for the blade tool and positioned without a render per pointer move',()=>{
 assert.doesNotMatch(render(project(),0),/blade-guide/);assert.match(render(project(),0,{tool:'blade'}),/<div class="blade-guide" hidden=""><\/div>/);
});
test('camera and microphone clips read as their words, and system sound gets its own row instead of stacking on Audio',()=>{
 const p=createProject(),camera:Media={id:'camera',path:'/fixture/camera.mov',name:'Camera',kind:'video',duration:10,width:1920,height:1080},mic:Media={id:'mic',path:'/fixture/mic.wav',name:'Mic',kind:'audio',duration:10,width:0,height:0,audioRole:'microphone'},system:Media={id:'system',path:'/fixture/system.wav',name:'System',kind:'audio',duration:10,width:0,height:0,audioRole:'system'};
 p.media=[camera,mic,system];p.clips=[clip('cam','camera','camera',0,4),clip('mic','mic','audio',0,4),clip('sys','system','audio',0,4),clip('late','camera','camera',6,2)];
 p.captions=[{id:'c2',start:2,end:3.5,text:'second line.'},{id:'c1',start:0,end:2,text:'First line,'},{id:'c3',start:4.5,end:5.5,text:'Between clips'}];
 const html=render(p,0),row=(id:string)=>html.slice(html.indexOf(`data-track="${id}"`)).split('class="timeline-row')[0];
 assert.match(row('role:camera'),/<span>First line, second line\.<\/span>/);
 assert.match(row('role:camera'),/<span>Clip late<\/span>/,'a clip with no captions under it keeps its name');
 assert.match(row('role:audio'),/data-clip-id="mic"[^]*<span>First line, second line\.<\/span>/);
 assert.doesNotMatch(row('role:audio'),/data-clip-id="sys"/);
 assert.match(row('role:audio:system'),/data-label="System audio"[^]*data-clip-id="sys"[^]*<span>Clip sys<\/span>/);
});
