import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import type {MCPSettings} from '../shared/types.js';
export const AI_WORKSPACE_NAME='SceneForge AI Workspace';
export const defaultWorkspaceLocation=()=>path.join(os.homedir(),'Documents');
type Stored={enabled:boolean;workspaceLocation:string};
const fileIn=(dataDir:string)=>path.join(dataDir,'mcp-settings.json');
async function read(dataDir:string):Promise<Stored>{
 const fallback={enabled:true,workspaceLocation:defaultWorkspaceLocation()};
 try{const value=JSON.parse(await fs.readFile(fileIn(dataDir),'utf8'));return {enabled:typeof value.enabled==='boolean'?value.enabled:true,workspaceLocation:typeof value.workspaceLocation==='string'&&path.isAbsolute(value.workspaceLocation)?value.workspaceLocation:fallback.workspaceLocation};}catch{return fallback;}
}
const view=(s:Stored):MCPSettings=>({enabled:s.enabled,workspaceLocation:s.workspaceLocation,workspacePath:path.join(s.workspaceLocation,AI_WORKSPACE_NAME)});
/** MCP stays enabled unless the user turns it off, so existing assistant connections keep working. */
export async function readMCPSettings(dataDir:string){return view(await read(dataDir));}
/** The chosen location must be an existing folder; the named workspace folder is created inside it while MCP is enabled. */
export async function saveMCPSettings(dataDir:string,patch:unknown):Promise<MCPSettings>{
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Object.assign(Error('MCP settings must be an object.'),{status:400});
 const {enabled,workspaceLocation,...rest}=patch as Record<string,unknown>;
 if(Object.keys(rest).length)throw Object.assign(Error('Unexpected MCP setting: '+Object.keys(rest)[0]),{status:400});
 if(enabled!==undefined&&typeof enabled!=='boolean')throw Object.assign(Error('enabled must be true or false.'),{status:400});
 if(workspaceLocation!==undefined&&(typeof workspaceLocation!=='string'||!path.isAbsolute(workspaceLocation)||workspaceLocation.length>1024||workspaceLocation.includes('\0')))throw Object.assign(Error('Choose an absolute folder for the AI workspace.'),{status:400});
 const next={...await read(dataDir),...(enabled===undefined?{}:{enabled}),...(workspaceLocation===undefined?{}:{workspaceLocation:path.resolve(workspaceLocation)})};
 if(workspaceLocation!==undefined){const stat=await fs.stat(next.workspaceLocation).catch(()=>null);if(!stat?.isDirectory())throw Object.assign(Error('The chosen AI workspace location is not an existing folder.'),{status:400});}
 if(next.enabled)await fs.mkdir(path.join(next.workspaceLocation,AI_WORKSPACE_NAME),{recursive:true});
 await fs.mkdir(dataDir,{recursive:true});const file=fileIn(dataDir),temp=file+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(temp,JSON.stringify(next,null,2),{mode:0o600});await fs.rename(temp,file);}catch(e){await fs.rm(temp,{force:true});throw e;}
 return view(next);
}
