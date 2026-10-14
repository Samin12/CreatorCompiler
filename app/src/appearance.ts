export type Appearance='system'|'light'|'dark';
const key='sceneforge.appearance';
export function getAppearance():Appearance{const stored=localStorage.getItem(key);return stored==='light'||stored==='dark'?stored:'system';}
function apply(){const preference=getAppearance();document.documentElement.dataset.theme=preference==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;}
export function setAppearance(value:Appearance){localStorage.setItem(key,value);apply();}
export function initializeAppearance(){apply();matchMedia('(prefers-color-scheme: dark)').addEventListener('change',apply);window.addEventListener('storage',event=>{if(event.key===key)apply();});}
