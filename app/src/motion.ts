import {useLayoutEffect,useRef} from 'react';
/** Animate the existing panel, never its React identity or its capture/playback state. */
export function usePanelMotion<T extends HTMLElement>(identity:string){
 const ref=useRef<T>(null);
 useLayoutEffect(()=>{const element=ref.current;if(!element||typeof element.animate!=='function')return;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');if(preference.matches)return;
  const animation=element.animate([{opacity:.7,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:150,easing:'cubic-bezier(.2,.7,.2,1)'});
  void animation.finished.catch(()=>{});
  const stop=()=>animation.cancel();preference.addEventListener('change',stop);return()=>{preference.removeEventListener('change',stop);stop();};
 },[identity]);
 return ref;
}
