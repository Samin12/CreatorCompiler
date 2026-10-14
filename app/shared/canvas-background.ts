import type {Canvas} from './types';

/** Independent, resolution-scaled canvas treatment. Time is project time, never wall time. */
export const MOVING_DOTS = {version:1,period:16,pitch:40,coreRadius:2.1,edgeRadius:2.9,color:'#464646'} as const;
type BackgroundCanvas=Pick<Canvas,'width'|'height'|'background'>;
export interface BackgroundGeometry {
 width:number;height:number;tileWidth:number;tileHeight:number;pitchX:number;pitchY:number;
 coreX:number;coreY:number;edgeX:number;edgeY:number;phaseX:number;phaseY:number;
}
const positive=(n:number,fallback:number)=>Number.isFinite(n)&&n>0?n:fallback;
const phase=(time:number)=>((Number.isFinite(time)?time:0)%MOVING_DOTS.period+MOVING_DOTS.period)%MOVING_DOTS.period/MOVING_DOTS.period;

export function canvasBackgroundGeometry(canvas:BackgroundCanvas,time=0,width=canvas.width,height=canvas.height):BackgroundGeometry {
 const sourceWidth=positive(canvas.width,1920),sourceHeight=positive(canvas.height,1080);
 const w=Math.max(1,Math.round(positive(width,sourceWidth))),h=Math.max(1,Math.round(positive(height,sourceHeight)));
 const unit=sourceHeight/1080,sx=w/sourceWidth,sy=h/sourceHeight;
 const pitchX=MOVING_DOTS.pitch*unit*sx,pitchY=MOVING_DOTS.pitch*unit*sy;
 return {width:w,height:h,tileWidth:Math.ceil(pitchX),tileHeight:Math.ceil(pitchY),pitchX,pitchY,coreX:MOVING_DOTS.coreRadius*unit*sx,coreY:MOVING_DOTS.coreRadius*unit*sy,edgeX:MOVING_DOTS.edgeRadius*unit*sx,edgeY:MOVING_DOTS.edgeRadius*unit*sy,phaseX:phase(time)*pitchX,phaseY:phase(time)*pitchY};
}

function rgb(color:string):number[]{
 const valid=/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)?color:'#171b27';
 return [1,3,5].map(start=>parseInt(valid.slice(start,start+2),16));
}
/** Exact integer raster repetition, including fractional dot pitch (e.g. 13⅓ px repeats every 40 px).
 * Awkward or noninteger canvas dimensions safely fall back to the full bounded canvas dimension. */
export function canvasBackgroundRepeatSize(canvas:BackgroundCanvas,g:BackgroundGeometry){
 const gcd=(a:number,b:number):number=>{while(b){const next=a%b;a=b;b=next;}return a;};
 const repeat=(numerator:number,denominator:number,maximum:number)=>Number.isSafeInteger(numerator)&&Number.isSafeInteger(denominator)&&numerator>0&&denominator>0?Math.min(maximum,numerator/gcd(numerator,denominator)):maximum;
 return {width:repeat(canvas.height*g.width,27*canvas.width,g.width),height:repeat(g.height,27,g.height)};
}
const gridDistance=(position:number,pitch:number)=>{const value=position%pitch;return Math.min(value,pitch-value);};
/** A sampled RGB patch; fractional pitch remains exact instead of accumulating rounded tile error. */
export function canvasBackgroundTile(canvas:BackgroundCanvas,geometry=canvasBackgroundGeometry(canvas),w=geometry.tileWidth,h=geometry.tileHeight):Uint8Array {
 const {coreX,edgeX,edgeY,pitchX,pitchY}=geometry,bytes=new Uint8Array(w*h*3),base=rgb(canvas.background),dot=rgb(MOVING_DOTS.color);
 const inner=coreX/Math.max(Number.EPSILON,edgeX);
 const dx=Array.from({length:w},(_,x)=>gridDistance(x+.5,pitchX)),dy=Array.from({length:h},(_,y)=>gridDistance(y+.5,pitchY));
 // Four samples per axis keep subpixel dots visible at small thumbnail sizes. Most pixels
 // lie outside every dot and only receive the base color; this runs once per render size.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let coverage=0;
  if(dx[x]<=edgeX+.5&&dy[y]<=edgeY+.5)for(let py=0;py<4;py++)for(let px=0;px<4;px++){
   const tx=gridDistance(x+(px+.5)/4,pitchX)/edgeX,ty=gridDistance(y+(py+.5)/4,pitchY)/edgeY,distance=Math.hypot(tx,ty);
   coverage+=Math.max(0,Math.min(1,(1-distance)/Math.max(Number.EPSILON,1-inner)))/16;
  }
  const offset=(y*w+x)*3;for(let channel=0;channel<3;channel++)bytes[offset+channel]=Math.round(base[channel]+(dot[channel]-base[channel])*coverage);
 }
 return bytes;
}

/** BMP needs no image-library dependency. The bounded overscan sheet is cached across render chunks. */
export function canvasBackgroundBMP(canvas:BackgroundCanvas,geometry=canvasBackgroundGeometry(canvas),sheet=false):Uint8Array {
 const w=sheet?geometry.width+geometry.tileWidth+1:geometry.tileWidth,h=sheet?geometry.height+geometry.tileHeight+1:geometry.tileHeight;
 if(w*h>40_000_000)throw Error('Canvas background exceeds the supported raster size');
 const stride=Math.ceil(w*3/4)*4,bytes=new Uint8Array(54+stride*h),header=new DataView(bytes.buffer),pixels=canvasBackgroundTile(canvas,geometry,w,h);
 bytes[0]=66;bytes[1]=77;header.setUint32(2,bytes.length,true);header.setUint32(10,54,true);header.setUint32(14,40,true);header.setInt32(18,w,true);header.setInt32(22,h,true);header.setUint16(26,1,true);header.setUint16(28,24,true);header.setUint32(34,stride*h,true);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const source=(y*w+x)*3,target=54+(h-1-y)*stride+x*3;bytes[target]=pixels[source+2];bytes[target+1]=pixels[source+1];bytes[target+2]=pixels[source];}
 return bytes;
}
/** CSS pixels come from the same project-time geometry; no independent CSS animation clock. */
export function canvasBackgroundStyle(canvas:BackgroundCanvas,time:number,displayScale=1){
 const g=canvasBackgroundGeometry(canvas,time),scale=positive(displayScale,1);
 return {backgroundImage:`radial-gradient(circle at center, ${MOVING_DOTS.color} ${g.coreX*scale}px, transparent ${g.edgeX*scale}px)`,backgroundRepeat:'repeat',backgroundSize:`${g.pitchX*scale}px ${g.pitchY*scale}px`,backgroundPosition:`${(g.phaseX-g.pitchX/2)*scale}px ${(g.phaseY-g.pitchY/2)*scale}px`};
}
