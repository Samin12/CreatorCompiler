import {spawn} from 'node:child_process';
import {mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {startMcp} from './mcp.mjs';
import runtime from '../desktop/runtime.cjs';

const base=process.env.SCENEFORGE_URL||'http://127.0.0.1:4174/api';
const address=new URL(base);
if(!['127.0.0.1','localhost'].includes(address.hostname))throw Error('The packaged MCP connects to a local SceneForge service only.');
const data=process.env.SCENEFORGE_DATA_DIR||path.join(os.homedir(),'Library/Application Support/SceneForge/studio');
const env=runtime.runtimeEnvironment({root:fileURLToPath(new URL('../',import.meta.url)),data,port:address.port||'4174'});
let starting;
async function healthy(){try{const response=await fetch(base+'/health',{signal:AbortSignal.timeout(1500)});return response.ok&&(await response.json()).application==='SceneForge';}catch{return false;}}
async function ensureService(){
 if(await healthy())return;
 if(starting)return starting;
 starting=(async()=>{
  await mkdir(data,{recursive:true});const log=await open(path.join(data,'service.log'),'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./index.mjs',import.meta.url))],{env,detached:true,stdio:['ignore',log.fd,log.fd]});
  let failure;child.once('error',error=>{failure=error;});child.unref();await log.close();
  for(let attempt=0;attempt<60;attempt++){if(failure)throw failure;if(await healthy())return;await new Promise(resolve=>setTimeout(resolve,150));}
  throw Error('SceneForge editing service could not start. See the local service.log.');
 })().finally(()=>{starting=undefined;});return starting;
}
await ensureService();
await startMcp(async(input,init)=>{await ensureService();return fetch(input,init);});
