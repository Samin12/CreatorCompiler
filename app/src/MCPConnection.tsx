import {useEffect,useState} from 'react';
import type {Capabilities,MCPSettings,Project} from '../shared/types';
import {api} from './api';
import {Check,Copy,FolderOpen,Sparkles} from './Icons';
import {Field,Section} from './Inspector';
import {mcpSetup,type MCPApp,type MCPInfo} from './mcp-setup';
import './ai-settings.css';
const apps:[MCPApp,string][]=[['chatgpt','ChatGPT'],['claude','Claude'],['other','Other AI apps']];
export function MCPConnection({project,capabilities,onError}:{project:Project|null;capabilities:Capabilities|null;onError:(message:string)=>void}){
 const [info,setInfo]=useState<MCPInfo|undefined>((capabilities as (Capabilities&{mcp?:MCPInfo})|null)?.mcp),[copied,setCopied]=useState(''),[settings,setSettings]=useState<MCPSettings>(),[app,setApp]=useState<MCPApp>('claude'),[busy,setBusy]=useState(false);
 useEffect(()=>{api<Capabilities&{mcp?:MCPInfo}>('/health').then(value=>setInfo(value.mcp)).catch(error=>onError(error.message));api<MCPSettings>('/mcp/settings').then(setSettings).catch(error=>onError(error.message));},[]);
 const copy=async(text:string,kind:string)=>{try{await navigator.clipboard.writeText(text);setCopied(kind);setTimeout(()=>setCopied(current=>current===kind?'':current),1600);}catch{onError('Clipboard access was unavailable. Select and copy the text shown below.');}};
 const save=async(patch:Partial<Pick<MCPSettings,'enabled'|'workspaceLocation'>>)=>{setBusy(true);try{setSettings(await api<MCPSettings>('/mcp/settings',patch,'PUT'));}catch(e){onError((e as Error).message);}finally{setBusy(false);}};
 const change=async()=>{if(!window.sceneForge?.chooseFolder)return;try{const folder=await window.sceneForge.chooseFolder();if(folder)await save({workspaceLocation:folder});}catch(e){onError((e as Error).message);}};
 const context=project?`Use the SceneForge MCP to edit project "${project.name}" (project_id: ${project.id}). Read get_guides, get_project, get_timeline and get_transcript first. Begin a transaction with begin_project_edit; stage the requested changes; inspect the staged timeline; commit with commit_project_edit and a concrete change_summary. Preserve source media. Export only when requested and verify get_export_status reaches complete.`:'';
 const setup=info&&mcpSetup(app,info),enabled=settings?.enabled??true;
 const copyButton=(text:string,kind:string,label:string)=><button className="ai-copy" aria-label={label} title={label} onClick={()=>void copy(text,kind)}>{copied===kind?<Check size={14}/>:<Copy size={14}/>}</button>;
 return <div className="ai-settings">
  <section className="ai-setting-row ai-setting-block"><div><h3>Enable MCP</h3><p>When enabled, supported AI apps can use SceneForge MCP tools to inspect and edit your Projects.</p></div><label className="toggle-field ai-switch"><input type="checkbox" aria-label="Enable MCP" checked={enabled} disabled={!settings||busy} onChange={e=>void save({enabled:e.target.checked})}/><span className="toggle-track"/></label></section>
  {!enabled&&<p className="capability-note">MCP is off. Connected AI apps get a “turned off” reply to every tool call until you enable it again.</p>}
  <section className={`ai-setting-block${enabled?'':' ai-muted'}`}><h3>Setup instructions</h3><p>Choose your AI app to see how to connect it to the SceneForge MCP.</p>
   <div className="ai-app-tabs" role="tablist" aria-label="AI app">{apps.map(([id,label])=><button key={id} role="tab" aria-selected={app===id} className={app===id?'active':''} onClick={()=>setApp(id)}>{label}</button>)}</div>
   {setup?<div className="ai-setup" role="tabpanel"><ol>{setup.steps.map(step=><li key={step}>{step}</li>)}</ol>{setup.blocks.map(block=><div className="ai-code" key={block.label}><div><span>{block.label}</span>{copyButton(block.text,block.label,`Copy ${block.label}`)}</div><pre aria-label={block.label}>{block.text}</pre></div>)}<p className="hint">{info.toolCount} SceneForge tools are available.</p></div>:<p className="capability-note">The desktop MCP launcher is not advertised by this running server. Open the installed SceneForge application to obtain its connection configuration.</p>}
  </section>
  <section className="ai-setting-block"><div className="ai-setting-row"><div><h3>AI workspace location</h3><p>SceneForge creates a folder named “SceneForge AI Workspace” inside the location you choose.</p></div>{window.sceneForge?.chooseFolder&&<button className="button ai-change" disabled={!settings||busy} onClick={()=>void change()}><FolderOpen size={15}/>Change</button>}</div>
   <div className="ai-path"><input aria-label="AI workspace path" readOnly value={settings?.workspacePath??''} placeholder="~/Documents/SceneForge AI Workspace"/>{settings&&copyButton(settings.workspacePath,'workspace','Copy AI workspace path')}</div>
  </section>
  <Section title="A reviewable editing workflow"><ol className="mcp-workflow"><li><b>Read the project.</b> The assistant inspects clips, scenes, captions and the current revision.</li><li><b>Stage the edit.</b> Timeline changes stay in an isolated transaction while the assistant reviews them.</li><li><b>Commit the result.</b> A change summary accompanies the commit. Conflicting edits are rejected.</li><li><b>Render and verify.</b> Export runs locally, with progress and cancellation tools.</li></ol><p className="hint">Committed assistant edits appear here automatically. If you have unsaved local changes, they are preserved and the editor asks you to resolve the conflict.</p></Section>
  <Section title="Current project">{project?<><Field label="Project ID"><input aria-label="MCP project ID" readOnly value={project.id}/></Field><textarea aria-label="AI editing context" className="mcp-context" rows={5} readOnly value={context}/><button className="button" onClick={()=>void copy(context,'context')}>{copied==='context'?<Check size={15}/>:<Sparkles size={15}/>} {copied==='context'?'Project context copied':'Copy project context for AI'}</button></>:<p className="hint">Open a project to copy its ID and editing context for your assistant.</p>}</Section>
 </div>;
}
