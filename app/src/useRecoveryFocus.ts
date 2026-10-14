import {useEffect,useRef} from 'react';
/** Keep keyboard navigation inside these recovery dialogs without moving app state. */
export function useRecoveryFocus(){
 const content=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,dialog=content.current?.closest<HTMLElement>('[role="dialog"]');if(!dialog)return;
  const controls=()=>[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length>0);
  controls()[0]?.focus();
  const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const items=controls(),first=items[0],last=items.at(-1);if(!first)return;const outside=!dialog.contains(document.activeElement);if(event.shiftKey&&(document.activeElement===first||outside)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||outside)){event.preventDefault();first.focus();}};
  document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus();};
 },[]);return content;
}
