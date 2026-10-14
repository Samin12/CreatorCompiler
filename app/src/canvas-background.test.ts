import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {canvasBackgroundGeometry,canvasBackgroundTile,canvasBackgroundBMP,canvasBackgroundStyle,canvasBackgroundRepeatSize,MOVING_DOTS} from '../shared/canvas-background';
import {createProject} from '../shared/types';
import {Stage} from './Stage';
import {createPlayhead} from './playhead';

const canvas={width:1920,height:1080,background:'#121212'};
test('moving grid follows height-scaled reference geometry and exact fractional output spacing',()=>{
 const a=canvasBackgroundGeometry(canvas,4);assert.equal(a.pitchX,40);assert.equal(a.pitchY,40);assert.equal(a.phaseX,10);assert.equal(a.phaseY,10);assert.equal(a.coreX,2.1);assert.equal(a.edgeY,2.9);
 const small=canvasBackgroundGeometry(canvas,4,640,360);assert.ok(Math.abs(small.pitchX-40/3)<1e-10);assert.ok(Math.abs(small.phaseX-10/3)<1e-10);
 const portrait=canvasBackgroundGeometry({...canvas,width:1080,height:1920},4);assert.ok(Math.abs(portrait.pitchX-40*1920/1080)<1e-10,'reference scales by height, not smaller dimension');
 const stretched=canvasBackgroundGeometry(canvas,4,960,1080);assert.equal(stretched.pitchX,20);assert.equal(stretched.pitchY,40);
});
test('phase is deterministic when paused, seeks directly, and repeats without accumulated drift',()=>{
 assert.deepEqual(canvasBackgroundGeometry(canvas,4),canvasBackgroundGeometry(canvas,4+16*10000));
 assert.equal(canvasBackgroundGeometry(canvas,16).phaseX,0);
 assert.deepEqual(canvasBackgroundStyle(canvas,4),canvasBackgroundStyle(canvas,4));
 assert.ok(canvasBackgroundGeometry(canvas,16-1/30).phaseX>39.9);
});
test('stage drift snaps to device pixels, so the style changes a few times a second instead of every frame',()=>{
 const scale=1000/1920,positions=new Set<string>();
 for(let frame=0;frame<120;frame++){
  const snapped=canvasBackgroundStyle(canvas,frame/120,scale,2).backgroundPosition.split(' ').map(parseFloat),exact=canvasBackgroundStyle(canvas,frame/120,scale).backgroundPosition.split(' ').map(parseFloat);
  for(const axis of [0,1]){assert.equal(snapped[axis]*2,Math.round(snapped[axis]*2));assert.ok(Math.abs(snapped[axis]-exact[axis])<=.25+1e-9);}
  positions.add(snapped.join());
 }
 assert.ok(positions.size>1&&positions.size<=6,`${positions.size} distinct positions in one second at 120 Hz`);
 assert.deepEqual({...canvasBackgroundStyle(canvas,4,scale,2),backgroundPosition:''},{...canvasBackgroundStyle(canvas,4,scale),backgroundPosition:''});
 assert.deepEqual(canvasBackgroundStyle(canvas,4,scale,0),canvasBackgroundStyle(canvas,4,scale));
});
test('integer repeat rectangles preserve fractional pitch and bound unusual output dimensions',()=>{
 for(const [w,h,width,height]of[[1920,1080,40,40],[3840,2160,80,80],[640,360,40,40],[1280,720,80,80]])assert.deepEqual(canvasBackgroundRepeatSize(canvas,canvasBackgroundGeometry(canvas,0,w,h)),{width,height});
 const awkward=canvasBackgroundGeometry(canvas,0,638,358),repeat=canvasBackgroundRepeatSize(canvas,awkward);assert.ok(repeat.width<=638&&repeat.height<=358);assert.ok(Math.abs(repeat.width/awkward.pitchX-Math.round(repeat.width/awkward.pitchX))<1e-9||repeat.width===638);
});
test('independent raster has origin-centered soft dots, custom base color and a bounded overscan',()=>{
 const g=canvasBackgroundGeometry(canvas),tile=canvasBackgroundTile(canvas,g),at=(x:number,y:number)=>[...tile.slice((y*g.tileWidth+x)*3,(y*g.tileWidth+x)*3+3)];
 assert.deepEqual(at(0,0),[70,70,70]);assert.deepEqual(at(20,20),[18,18,18]);assert.ok(at(2,0)[0]>18&&at(2,0)[0]<70);assert.deepEqual(at(39,39),at(0,0));
 const colored=canvasBackgroundTile({...canvas,background:'#204060'},g);assert.deepEqual([...colored.slice((20*40+20)*3,(20*40+20)*3+3)],[32,64,96]);
 const bmp=canvasBackgroundBMP(canvas,canvasBackgroundGeometry(canvas,0,64,36),true),header=new DataView(bmp.buffer);assert.equal(header.getInt32(18,true),67);assert.equal(header.getInt32(22,true),39);
 assert.throws(()=>canvasBackgroundBMP(canvas,canvasBackgroundGeometry(canvas,0,10000,10000),true),/supported raster size/);
 assert.equal(MOVING_DOTS.period,16);
});
test('Stage paints pattern below all layers from timeline time and keeps solid or empty project behavior explicit',()=>{
 const p=createProject();p.canvas={...p.canvas,...canvas,backgroundPattern:'moving-dots'};
 const render=(time:number)=>renderToStaticMarkup(React.createElement(Stage,{project:p,playhead:createPlayhead(time),playing:false,onSelect:()=>{},onImport:()=>{}}));
 const start=render(0),later=render(4);assert.match(start,/radial-gradient/);assert.notEqual(start,later);assert.equal(later,render(20));assert.match(start,/class="stage-empty" style="background:transparent/);
 delete p.canvas.backgroundPattern;assert.doesNotMatch(render(0),/radial-gradient/);assert.doesNotMatch(render(0),/style="background:transparent/);
});
