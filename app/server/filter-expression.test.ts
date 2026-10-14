import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {filterSum} from './filter-expression.ts';

test('dense motion expressions remain shallow and FFmpeg evaluates every sample',()=>{
 const count=2000;
 const terms=Array.from({length:count},(_,i)=>`(${(i%3)-1})*min(1,max(0,(t-${i/count})/${1/count}))`);
 const expression=filterSum(terms);
 let depth=0,maxDepth=0;
 for(const c of expression){if(c==='(')maxDepth=Math.max(maxDepth,++depth);else if(c===')')depth--;}
 assert.equal(depth,0);assert.ok(maxDepth<20,`Expression depth ${maxDepth}`);
 const ffmpeg=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
 const result=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','color=black:s=32x16:r=10:d=1.2','-f','lavfi','-i','color=white:s=2x2:r=10:d=1.2','-filter_complex',`[0:v][1:v]overlay=x='10+${expression}':y=4:enable='${filterSum(Array.from({length:count},(_,i)=>`gte(t,${i/count})*lt(t,${(i+1)/count})`))}'`,'-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:1024*1024});
 assert.equal(result.status,0,result.stderr.toString());
 assert.equal(result.stdout.length,12*32*16*3);
 for(let frame=0;frame<12;frame++){
  const t=frame/10;
  const x=10+terms.reduce((sum,_,i)=>sum+((i%3)-1)*Math.min(1,Math.max(0,(t-i/count)/(1/count))),0);
  const pixels=result.stdout.subarray(frame*32*16*3,(frame+1)*32*16*3);
  let white=0;for(let p=0;p<pixels.length;p+=3)if(pixels[p]>240&&pixels[p+1]>240&&pixels[p+2]>240){white++;const px=(p/3)%32;assert.ok(Math.abs(px-x)<3,`frame ${frame}: expected x ${x}, observed ${px}`);}
  assert.equal(white,frame<10?4:0,`Visibility interval at frame ${frame}`);
 }
});
