import type {Transform} from './types';

/** Shadow lengths share the canvas coordinate system with the corner radius. */
export function clipShadow(transform:Transform,scale=1){
 const shadow=transform.shadow;
 if(!shadow||!/^#[0-9a-f]{8}$/i.test(shadow.color)||![shadow.x,shadow.y,shadow.blur,scale].every(Number.isFinite)||scale<=0)return null;
 const alpha=parseInt(shadow.color.slice(7,9),16)/255;
 if(alpha===0)return null;
 const r=parseInt(shadow.color.slice(1,3),16),g=parseInt(shadow.color.slice(3,5),16),b=parseInt(shadow.color.slice(5,7),16);
 return {x:shadow.x*scale,y:shadow.y*scale,blur:Math.max(0,shadow.blur*scale),r,g,b,alpha};
}
export function clipShadowCss(transform:Transform,scale=1){
 const s=clipShadow(transform,scale);
 return s?` drop-shadow(${s.x}px ${s.y}px ${s.blur/2}px rgba(${s.r}, ${s.g}, ${s.b}, ${s.alpha}))`:'';
}
