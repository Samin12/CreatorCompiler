import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema,ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {basename,isAbsolute} from 'node:path';
import { makeId,clipDuration,clipEffectTiming,projectDuration,type Project,type Clip } from '../shared/types.js';

const string={type:'string'};const number={type:'number'};const object={type:'object'};
const array=(items:unknown)=>({type:'array',items});
const definition=(name:string,description:string,properties:Record<string,unknown>={},required:string[]=[],readOnly=false)=>({name,description,inputSchema:{type:'object' as const,properties,required,additionalProperties:false},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:false}});
const tx={tx_id:string};const project={project_id:string};
const recoveryId={type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'};
const reviewed={expected_revision:{type:'string',pattern:'^[0-9a-f]{64}$',description:'Exact revision returned by the reviewed committed state. Never refresh or substitute automatically.'}};
const recoveryProject={project_id:recoveryId};
export const toolDefinitions=[
 definition('get_guides','Read Creator Compiler model, units and transaction workflow.',{},[],true),
 definition('list_projects','List local Creator Compiler projects.',{},[],true),
 definition('create_project','Create an empty independent project.',{name:string}),
 definition('duplicate_project','Create an independent copy of a Creator Compiler project.',project,['project_id']),
 definition('get_project','Read a complete project and its content hash.',{...project,...tx},[],true),
 definition('get_project_overview','Read compact project duration, counts, scenes, media and canvas before editing a large timeline.',{...project,...tx},[],true),
 definition('get_scenes','Read scene scripts and time ranges.',{...project,...tx},[],true),
 definition('get_timeline','Read clips, elements, zooms and canvas. Times are seconds.',{...project,...tx},[],true),
 definition('get_transcript','Read timed captions and available word timings.',{...project,...tx},[],true),
 definition('inspect_timeline','See actual composed frames of committed state before or after edits. Times are seconds; at most 6 frames. Returns PNG images plus timing/size metadata.',{...project,times:{type:'array',items:{type:'number',minimum:0},minItems:1,maxItems:6},width:{type:'integer',minimum:160,maximum:1920}},['project_id','times'],true),
 definition('begin_project_edit','Begin an isolated in-memory edit based on the current committed revision.',project,['project_id']),
 definition('rename_project','Stage a project name change.',{...tx,name:string},['tx_id','name']),
 definition('update_scenes','Replace staged scenes with ordered scene objects: id, name, script, notes, start, duration. Times are seconds.',{...tx,scenes:array(object)},['tx_id','scenes']),
 definition('add_clips','Append complete Creator Compiler Clip objects to a transaction.',{...tx,clips:array(object)},['tx_id','clips']),
 definition('update_clip','Patch one clip. Nested transform/effects objects are merged.',{...tx,clip_id:string,changes:object},['tx_id','clip_id','changes']),
 definition('split_clip','Split a clip at project time in seconds; preserves source timing and speed.',{...tx,clip_id:string,time:number},['tx_id','clip_id','time']),
 definition('delete_clips','Delete the identified clips without ripple.',{...tx,clip_ids:array(string)},['tx_id','clip_ids']),
 definition('trim_timeline','Remove ranges from all tracks. Seconds. Ripple true retimes downstream clips and metadata. Review before committing.',{...tx,ranges:array({type:'array',items:number,minItems:2,maxItems:2}),ripple:{type:'boolean'}},['tx_id','ranges']),
 definition('update_canvas','Merge canvas width/height/fps/background/padding/radius.',{...tx,canvas:object},['tx_id','canvas']),
 definition('set_captions','Replace timed caption objects and optionally merge captionStyle.',{...tx,captions:array(object),style:object},['tx_id','captions']),
 definition('set_elements','Replace text, shape, arrow, highlight and blur elements.',{...tx,elements:array(object)},['tx_id','elements']),
 definition('set_zooms','Replace timed screen/camera zooms.',{...tx,zooms:array(object)},['tx_id','zooms']),
 definition('set_cursor','Merge cursor settings and optional recorded cursor points.',{...tx,cursor:object},['tx_id','cursor']),
 definition('import_media','Register local assets and stage them in a transaction; originals are read-only.',{...tx,paths:array(string)},['tx_id','paths']),
 definition('commit_project_edit','Commit a verified transaction with a concrete change summary. Fails when the project changed since begin.',{...tx,change_summary:string},['tx_id','change_summary']),
 definition('abort_project_edit','Discard staged changes.',tx,['tx_id']),
 definition('export_video','Export committed state with options: format mp4/webm/wav/srt/txt/md/json, quality, width, height, fps, hardware, burnCaptions.',{...project,options:object},['project_id']),
 definition('list_export_jobs','List durable export receipts, saved settings and recovery/output availability. Optional project filter; at most 200 results per page. Excludes ephemeral inspection/proxy jobs.',{project_id:recoveryId,offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:200}},[],true),
 definition('restart_export','Restart one reviewed saved export from the beginning as a new job. Does not change the current project. Source changes block; explicitly choose whether current changed rendering tools are acknowledged. Never retries or refreshes automatically.',{job_id:recoveryId,acknowledge_runtime_change:{type:'boolean'}},['job_id','acknowledge_runtime_change']),
 definition('get_export_status','Read asynchronous render status.',{job_id:string},['job_id'],true),
 definition('cancel_export','Cancel a pending render.',{job_id:string},['job_id']),
 definition('request_transcription','Run the configured local or user-owned cloud provider; returns source-media captions without applying them.',{...project,media_id:string},['project_id','media_id']),
 definition('analyze_project','Return reviewable silence/filler/script suggestions. Does not change project.',{...project,kind:{enum:['silence','fillers','script']},prompt:string},['project_id','kind'],true),
 definition('get_media_status','Inspect committed project file availability and playback catalog status. Returns the revision to review. Not available inside edit transactions.',recoveryProject,['project_id'],true),
 definition('plan_media_relink','Review one local replacement against an exact project revision. Checks metadata, sampled decoding and fingerprint; does not apply. Read warnings before applying. No tx_id.',{...recoveryProject,media_id:recoveryId,replacement_path:{type:'string',minLength:1,maxLength:32768},...reviewed},['project_id','media_id','replacement_path','expected_revision'],true),
 definition('apply_media_relink','Apply a reviewed replacement to committed state with a fresh media ID. Requires exact plan revision and explicit required warning acknowledgements. Conflicts must be reviewed again, never retried automatically. No tx_id.',{...recoveryProject,plan_id:recoveryId,...reviewed,acknowledgements:{type:'array',items:recoveryId,maxItems:64,uniqueItems:true}},['project_id','plan_id','expected_revision']),
 definition('undo_media_relink','Restore the project before one applied relink only if its exact returned revision is still current. No tx_id; never refresh a stale revision automatically.',{...recoveryProject,plan_id:recoveryId,...reviewed},['project_id','plan_id','expected_revision']),
 definition('list_trashed_projects','List recoverable project snapshots, revisions and identity collisions. Does not permanently delete anything. No tx_id.',{},[],true),
 definition('restore_trashed_project','Restore the reviewed trash snapshot. Existing identities require explicit as_copy:true; never change that choice automatically after a conflict. No tx_id.',{trash_id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,220}$'},...reviewed,as_copy:{type:'boolean'}},['trash_id','expected_revision']),
];

function validateExportRecovery(name:string,value:unknown):asserts value is Record<string,any>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Export recovery arguments must be an object.');
 const args=value as Record<string,unknown>,keys=name==='list_export_jobs'?['project_id','offset','limit']:['job_id','acknowledge_runtime_change'];
 for(const key of Object.keys(args))if(!keys.includes(key))throw Error('Unexpected export recovery argument: '+key);
 for(const key of ['project_id','job_id'])if(Object.hasOwn(args,key)&&(typeof args[key]!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(args[key])))throw Error('Invalid '+key);
 if(name==='restart_export'&&(!Object.hasOwn(args,'job_id')||typeof args.acknowledge_runtime_change!=='boolean'))throw Error('Provide job_id and an explicit boolean acknowledge_runtime_change.');
 if(Object.hasOwn(args,'offset')&&(!Number.isSafeInteger(args.offset)||Number(args.offset)<0||Number(args.offset)>1000000))throw Error('offset must be an integer from 0 to 1000000.');
 if(Object.hasOwn(args,'limit')&&(!Number.isInteger(args.limit)||Number(args.limit)<1||Number(args.limit)>200))throw Error('limit must be an integer from 1 to 200.');
}

const recoveryArguments:Record<string,{allowed:string[];required:string[]}>= {
 get_media_status:{allowed:['project_id'],required:['project_id']},
 plan_media_relink:{allowed:['project_id','media_id','replacement_path','expected_revision'],required:['project_id','media_id','replacement_path','expected_revision']},
 apply_media_relink:{allowed:['project_id','plan_id','expected_revision','acknowledgements'],required:['project_id','plan_id','expected_revision']},
 undo_media_relink:{allowed:['project_id','plan_id','expected_revision'],required:['project_id','plan_id','expected_revision']},
 list_trashed_projects:{allowed:[],required:[]},
 restore_trashed_project:{allowed:['trash_id','expected_revision','as_copy'],required:['trash_id','expected_revision']},
};
function validateRecoveryArguments(name:string,value:unknown):asserts value is Record<string,any>{
 const rule=recoveryArguments[name];
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Recovery arguments must be an object.');
 const args=value as Record<string,unknown>;
 if(Object.hasOwn(args,'tx_id'))throw Error('Recovery tools act on committed state and forbid tx_id. Finish or abort staged edits first.');
 for(const key of Object.keys(args))if(!rule.allowed.includes(key))throw Error(`Unexpected recovery argument: ${key}`);
 for(const key of rule.required)if(!Object.hasOwn(args,key))throw Error(`Recovery argument ${key} is required.`);
 for(const key of ['project_id','media_id','plan_id','trash_id'])if(Object.hasOwn(args,key)){
  if(typeof args[key]!=='string'||!(key==='trash_id'?/^[a-zA-Z0-9_-]{1,220}$/:/^[a-zA-Z0-9_-]{1,100}$/).test(args[key]))throw Error(`Invalid ${key}.`);
 }
 if(Object.hasOwn(args,'expected_revision')&&(typeof args.expected_revision!=='string'||!/^[0-9a-f]{64}$/.test(args.expected_revision)))throw Error('expected_revision must be the exact reviewed 64-character lowercase SHA-256 revision.');
 if(Object.hasOwn(args,'replacement_path')&&(typeof args.replacement_path!=='string'||args.replacement_path.length>32768||args.replacement_path.includes('\0')||!isAbsolute(args.replacement_path)))throw Error('replacement_path must be an absolute local file path.');
 if(Object.hasOwn(args,'as_copy')&&typeof args.as_copy!=='boolean')throw Error('as_copy must be an explicit boolean choice.');
 if(Object.hasOwn(args,'acknowledgements')&&(!Array.isArray(args.acknowledgements)||args.acknowledgements.length>64||!args.acknowledgements.every(v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v))||new Set(args.acknowledgements).size!==args.acknowledgements.length))throw Error('acknowledgements must be an array of distinct reviewed warning IDs.');
}

const hash=(p:Project)=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
export function splitClip(clip:Clip,time:number):Clip[]{const end=clip.start+clipDuration(clip);if(!Number.isFinite(time)||time<=clip.start||time>=end)throw new Error('Split time must be inside the clip.');const source=clip.sourceIn+(time-clip.start)*clip.speed,origin=clipEffectTiming(clip);const effectTiming={sourceIn:origin.sourceIn,sourceOut:origin.sourceOut};return [{...clip,sourceOut:source,effectTiming:{...effectTiming}},{...structuredClone(clip),id:makeId(),start:time,sourceIn:source,effectTiming:{...effectTiming}}]}
export function trimProject(p:Project,input:number[][],ripple=true):Project{
 const ranges:Array<[number,number]>=[];
 for(const range of input){if(range.length!==2||!range.every(Number.isFinite)||range[0]<0||range[1]<=range[0])throw new Error('Ranges must be positive [start,end] seconds.');}
 for(const [a,b] of [...input].sort((a,b)=>a[0]-b[0])){const prev=ranges.at(-1);if(prev&&a<=prev[1])prev[1]=Math.max(prev[1],b);else ranges.push([a,b])}
 const shift=(time:number)=>ripple?ranges.reduce((n,[a,b])=>n+Math.max(0,Math.min(time,b)-a),0):0;
 const mapped=(time:number)=>Math.max(0,time-shift(time));const out=structuredClone(p);
 out.clips=p.clips.flatMap(clip=>{const end=clip.start+clipDuration(clip),origin=clipEffectTiming(clip),affected=ranges.some(([a,b])=>a<end&&b>clip.start);let parts:Array<[number,number]>=[[clip.start,end]];for(const [a,b] of ranges)parts=parts.flatMap(([s,e])=>b<=s||a>=e?[[s,e]]:[...(a>s?[[s,a] as [number,number]]:[]),...(b<e?[[b,e] as [number,number]]:[])]);return parts.map(([s,e],i)=>({...structuredClone(clip),id:i===0?clip.id:makeId(),start:mapped(s),sourceIn:clip.sourceIn+(s-clip.start)*clip.speed,sourceOut:clip.sourceIn+(e-clip.start)*clip.speed,...(affected?{effectTiming:{sourceIn:origin.sourceIn,sourceOut:origin.sourceOut}}:{})}))});
 out.captions=p.captions.flatMap(c=>{if(ranges.some(([a,b])=>c.start<b&&c.end>a))return [];return [{...c,start:mapped(c.start),end:mapped(c.end),words:c.words?.map(w=>({...w,start:mapped(w.start),end:mapped(w.end)}))}]});
 if(ripple){out.scenes=p.scenes.map(s=>({...s,start:mapped(s.start),duration:Math.max(0,mapped(s.start+s.duration)-mapped(s.start))}));out.elements=p.elements.map(e=>({...e,start:mapped(e.start),duration:Math.max(0,mapped(e.start+e.duration)-mapped(e.start))})).filter(e=>e.duration>0);out.zooms=p.zooms.map(z=>({...z,start:mapped(z.start),duration:Math.max(0,mapped(z.start+z.duration)-mapped(z.start))})).filter(z=>z.duration>0);out.cursor.points=p.cursor.points.filter(pt=>!ranges.some(([a,b])=>pt.time>=a&&pt.time<b)).map(pt=>({...pt,time:mapped(pt.time)}))}
 return out;
}

type Transaction={project:Project;revision:string;created:number};
export function createToolHandler(baseUrl='http://127.0.0.1:4174/api',fetcher:typeof fetch=fetch){
 const url=new URL(baseUrl);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw new Error('Creator Compiler MCP must connect to the loopback HTTP service.');
 const transactions=new Map<string,Transaction>();
 async function http(route:string,method='GET',body?:unknown,headers:Record<string,string>={}){const res=await fetcher(baseUrl.replace(/\/$/,'')+route,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30*60*1000)});const data:any=await res.json();if(!res.ok)throw Object.assign(new Error(data.error||`Creator Compiler HTTP ${res.status}`),{status:res.status});return {data,etag:res.headers.get('etag')?.replaceAll('"','')}}
 function transaction(id:string){const t=transactions.get(id);if(!t)throw new Error('Unknown or closed edit transaction.');if(Date.now()-t.created>60*60*1000){transactions.delete(id);throw new Error('Transaction expired. Begin again from current project state.')}return t}
 async function read(a:any):Promise<Project>{if(a.tx_id&&a.project_id)throw new Error('Provide tx_id or project_id, not both.');if(a.tx_id)return transaction(a.tx_id).project;if(!a.project_id)throw new Error('project_id or tx_id is required.');return (await http(`/projects/${encodeURIComponent(a.project_id)}`)).data}
 const staged=(id:string)=>({tx_id:id,timeline_hash:hash(transaction(id).project)});
 return async(name:string,a:any={})=>{
  if(name==='list_export_jobs'||name==='restart_export'){
   validateExportRecovery(name,a);
   if(name==='restart_export')return (await http(`/exports/${encodeURIComponent(a.job_id)}/restart`,'POST',{acknowledgeRuntimeChange:a.acknowledge_runtime_change})).data;
   const query=new URLSearchParams();if(a.project_id!==undefined)query.set('projectId',a.project_id);if(a.offset!==undefined)query.set('offset',String(a.offset));if(a.limit!==undefined)query.set('limit',String(a.limit));
   return (await http('/exports'+(query.size?'?'+query.toString():''))).data;
  }

  if(Object.hasOwn(recoveryArguments,name)){
   validateRecoveryArguments(name,a);
   const headers:Record<string,string>=a.expected_revision?{'If-Match':`"${a.expected_revision}"`}:{};
   if(name==='get_media_status')return (await http(`/projects/${encodeURIComponent(a.project_id)}/media-recovery`)).data;
   if(name==='list_trashed_projects')return (await http('/trash')).data;
   if(name==='plan_media_relink')return (await http(`/projects/${encodeURIComponent(a.project_id)}/media-recovery/plan`,'POST',{mediaId:a.media_id,replacementPath:a.replacement_path},headers)).data;
   if(name==='apply_media_relink')return (await http(`/projects/${encodeURIComponent(a.project_id)}/media-recovery/apply`,'POST',{planId:a.plan_id,acknowledgements:a.acknowledgements??[]},headers)).data;
   if(name==='undo_media_relink')return (await http(`/projects/${encodeURIComponent(a.project_id)}/media-recovery/undo`,'POST',{planId:a.plan_id},headers)).data;
   return (await http(`/trash/${encodeURIComponent(a.trash_id)}/restore`,'POST',{asCopy:a.as_copy??false},headers)).data;
  }
  if(name==='get_guides')return {application:'Creator Compiler',version:'0.1.0',units:'seconds',workflow:'Read get_project_overview, inspect_timeline for composed images, then get_timeline as needed. Use begin_project_edit, then use tx_id for reads and changes, verify get_project, commit with change_summary. Abort on failure. Concurrent changes cause conflict. Inspect and export read committed state; inspect again after committing to verify actual visuals.',clip:'id, mediaId, name, track(screen|camera|audio|music|overlay), start, sourceIn, sourceOut, speed, gain, muted, transform{x,y,width,height,rotation,opacity,fit,borderRadius}, effects{brightness,contrast,saturation,blur,grayscale,flipX,fadeIn,fadeOut,denoise,normalize}',limitations:'Independent Creator Compiler contract. Not wire-compatible with Borumi. Fullscreen/custom Borumi layouts and original AI engines may not reproduce identically. Trimming removes overlapping captions as whole blocks; review and regenerate affected captions.'};
  if(name==='list_projects')return (await http('/projects')).data;
  if(name==='create_project')return (await http('/projects','POST',{name:a.name})).data;
  if(name==='duplicate_project')return (await http(`/projects/${encodeURIComponent(a.project_id)}/duplicate`,'POST',{})).data;
  if(['get_project','get_project_overview','get_scenes','get_timeline','get_transcript'].includes(name)){const p=await read(a);const content=name==='get_project_overview'?{project_id:p.id,name:p.name,duration:projectDuration(p),counts:{scenes:p.scenes.length,media:p.media.length,clips:p.clips.length,captions:p.captions.length,elements:p.elements.length,zooms:p.zooms.length},canvas:p.canvas,scenes:p.scenes.map(({id,name,start,duration})=>({id,name,start,duration})),media:p.media.map(({id,name,kind,duration,width,height})=>({id,name,kind,duration,width,height})),importWarnings:p.importWarnings??[]}:name==='get_scenes'?{scenes:p.scenes}:name==='get_timeline'?{clips:p.clips,elements:p.elements,zooms:p.zooms,cursor:p.cursor,canvas:p.canvas,duration:projectDuration(p)}:name==='get_transcript'?{captions:p.captions}:{project:p};return {...content,timeline_hash:hash(p)}}
  if(name==='inspect_timeline'){
   if(!a.project_id||!Array.isArray(a.times)||a.times.length<1||a.times.length>6||!a.times.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0))throw new Error('Provide project_id and 1–6 finite nonnegative times in seconds.');
   if(a.width!==undefined&&(!Number.isInteger(a.width)||a.width<160||a.width>1920))throw new Error('Inspection width must be an integer from 160 to 1920.');
   const {data}=await http(`/projects/${encodeURIComponent(a.project_id)}/inspect`,'POST',{times:a.times,width:a.width});
   if(!Array.isArray(data.frames)||data.frames.length!==a.times.length)throw new Error('Invalid inspection frame response.');
   const frames=[],images=[];
   for(const frame of data.frames){
    if(typeof frame.url!=='string')throw new Error('Inspection frame URL is missing.');
    const frameUrl=new URL(frame.url,url);if(frameUrl.origin!==url.origin)throw new Error('Inspection images must come from the Creator Compiler loopback service.');
    const response=await fetcher(frameUrl,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Inspection image HTTP ${response.status}`);
    const mimeType=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg'].includes(mimeType??''))throw new Error('Inspection did not return a PNG or JPEG image.');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>12*1024*1024)throw new Error('Inspection image exceeds 12 MB.');
    frames.push({time:frame.time,requestedTime:frame.requestedTime??a.times[frames.length],width:frame.width,height:frame.height,image_index:images.length});images.push({type:'image' as const,mimeType:mimeType!,data:bytes.toString('base64')});
   }
   return {content:[{type:'text' as const,text:JSON.stringify({project_id:a.project_id,units:'seconds',state:'committed',frames})},...images]};
  }
  if(name==='begin_project_edit'){if(transactions.size>=100)throw new Error('Too many open transactions; commit or abort existing edits.');const {data,etag}=await http(`/projects/${encodeURIComponent(a.project_id)}`);const id=makeId();transactions.set(id,{project:structuredClone(data),revision:etag||hash(data),created:Date.now()});return {tx_id:id,project_id:data.id,timeline_hash:hash(data)}}
  if(name==='commit_project_edit'){if(typeof a.change_summary!=='string'||!a.change_summary.trim()||a.change_summary.length>500)throw new Error('Provide a concrete change_summary of 1–500 characters.');const t=transaction(a.tx_id);try{const {data}=await http(`/projects/${encodeURIComponent(t.project.id)}`,'PUT',t.project,{'If-Match':`"${t.revision}"`});return {project_id:data.id,timeline_hash:hash(data),change_summary:a.change_summary}}finally{transactions.delete(a.tx_id)}}
  if(name==='abort_project_edit'){transaction(a.tx_id);transactions.delete(a.tx_id);return {aborted:true}}
  if(name==='export_video'){const {data,etag}=await http(`/projects/${encodeURIComponent(a.project_id)}`);return (await http('/export','POST',{projectId:a.project_id,options:a.options??{format:'mp4'}},{'If-Match':`"${etag||hash(data)}"`})).data;}
  if(name==='get_export_status')return (await http(`/jobs/${encodeURIComponent(a.job_id)}`)).data;
  if(name==='cancel_export')return (await http(`/jobs/${encodeURIComponent(a.job_id)}`,'DELETE')).data;
  if(name==='request_transcription')return (await http('/ai/transcribe','POST',{projectId:a.project_id,mediaId:a.media_id})).data;
  if(name==='analyze_project')return (await http('/ai/analyze','POST',{projectId:a.project_id,kind:a.kind,prompt:a.prompt})).data;
  const t=transaction(a.tx_id);const p=t.project;
  switch(name){
   case 'rename_project':if(typeof a.name!=='string'||!a.name.trim())throw new Error('Project name is required.');p.name=a.name;break;
   case 'update_scenes':if(!Array.isArray(a.scenes))throw new Error('scenes must be an array.');p.scenes=structuredClone(a.scenes);break;
   case 'add_clips':if(!Array.isArray(a.clips))throw new Error('clips must be an array.');p.clips.push(...structuredClone(a.clips));break;
   case 'update_clip':{const c=p.clips.find(c=>c.id===a.clip_id);if(!c)throw new Error('Clip not found.');const {id,...changes}=a.changes;Object.assign(c,{...changes,transform:{...c.transform,...changes.transform},effects:{...c.effects,...changes.effects}});break;}
   case 'split_clip':{const index=p.clips.findIndex(c=>c.id===a.clip_id);if(index<0)throw new Error('Clip not found.');p.clips.splice(index,1,...splitClip(p.clips[index],a.time));break;}
   case 'delete_clips':p.clips=p.clips.filter(c=>!a.clip_ids.includes(c.id));break;
   case 'trim_timeline':t.project=trimProject(p,a.ranges,a.ripple!==false);break;
   case 'update_canvas':Object.assign(p.canvas,a.canvas);break;
   case 'set_captions':p.captions=structuredClone(a.captions);Object.assign(p.captionStyle,a.style??{});break;
   case 'set_elements':p.elements=structuredClone(a.elements);break;
   case 'set_zooms':p.zooms=structuredClone(a.zooms);break;
   case 'set_cursor':Object.assign(p.cursor,a.cursor);break;
   case 'import_media':{const {data}=await http('/media/import','POST',{paths:a.paths});p.media.push(...data);return {...staged(a.tx_id),media:data};}
   default:throw new Error(`Unknown Creator Compiler tool: ${name}`);
  }return staged(a.tx_id);
 };
}
export const MCP_DISABLED_MESSAGE='Creator Compiler MCP is turned off. Turn on Enable MCP in Creator Compiler Settings > AI, then try again.';
/** External assistants honor the Settings > AI switch on every call, so turning it off takes effect without a restart.
 * The in-app agent uses createToolHandler directly and is not affected. */
export function gateToolHandler(handle:(name:string,a?:any)=>Promise<unknown>,baseUrl:string,fetcher:typeof fetch=fetch){
 return async(name:string,a:any={})=>{let enabled=true;try{const res=await fetcher(baseUrl.replace(/\/$/,'')+'/mcp/settings',{signal:AbortSignal.timeout(5000)});if(res.ok)enabled=(await res.json() as {enabled?:unknown}).enabled!==false;}catch{/* An older service without the setting stays enabled. */}if(!enabled)throw new Error(MCP_DISABLED_MESSAGE);return handle(name,a);};
}
export async function startMcp(fetcher:typeof fetch=fetch){const server=new Server({name:'creator-compiler',version:'0.1.0'},{capabilities:{tools:{}}});const baseUrl=process.env.SCENEFORGE_URL||'http://127.0.0.1:4174/api',handle=gateToolHandler(createToolHandler(baseUrl,fetcher),baseUrl,fetcher);server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:toolDefinitions}));server.setRequestHandler(CallToolRequestSchema,async r=>{try{const value=await handle(r.params.name,r.params.arguments);return r.params.name==='inspect_timeline'?value as any:{content:[{type:'text',text:JSON.stringify(value)}]}}catch(e){const message=e instanceof Error?e.message:String(e),status=(e as {status?:number})?.status;return {isError:true,content:[{type:'text',text:status?`Creator Compiler HTTP ${status}: ${message}`:message}]}}});await server.connect(new StdioServerTransport());return server;}
if(process.argv[1]&&['mcp.ts','mcp.mjs','mcp.js'].includes(basename(process.argv[1]))&&import.meta.url===pathToFileURL(process.argv[1]).href)startMcp().catch(e=>{console.error(e.message);process.exitCode=1});
