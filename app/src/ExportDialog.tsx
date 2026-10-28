import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ExportOptions,Project} from '../shared/types';
import {projectDuration} from '../shared/types';
import type {ExportRecord} from '../shared/export-history';
import {Download,LoaderCircle} from './Icons';
import {Modal} from './Dialogs';
import {Field,NumberField,Toggle} from './Inspector';
import {cancelSavedExport,getSavedExport,listSavedExports,projectRevision,restartSavedExport,startSavedExport} from './api';
import {ExportHistory} from './ExportHistory';
import {activeExport,ExportSession,exportCurrentVersion,mergeExportRecords,refreshActiveExportRecords,type ExportRange} from './export-session';
import {usePanelMotion} from './motion';
import {useRecoveryFocus} from './useRecoveryFocus';
import './export-history.css';

export function ExportDialog({project,flush,onClose,onBorumi}:{project:Project;flush:()=>Promise<Project|undefined>;onClose:()=>void;onError?:(message:string)=>void;onBorumi?:()=>void}){
 const defaults=()=>({format:'mp4' as const,width:project.canvas.width,height:project.canvas.height,fps:project.canvas.fps,quality:'balanced' as const,hardware:false,burnCaptions:true});
 const [options,setOptions]=useState<ExportOptions>(defaults),[range,setRange]=useState<ExportRange>({mode:'full',sceneId:project.scenes[0]?.id??'',start:0,end:projectDuration(project)});
 const [tab,setTab]=useState<'new'|'history'>('new'),[records,setRecords]=useState<ExportRecord[]>([]),[selected,setSelected]=useState<string|null>(null),[nextOffset,setNextOffset]=useState<number|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[historyError,setHistoryError]=useState(''),[diagnostic,setDiagnostic]=useState(''),[reviewing,setReviewing]=useState(false),[acknowledged,setAcknowledged]=useState(false);
 const session=useRef(new ExportSession()),operation=useRef(false),chosenTab=useRef(false),initialLoaded=useRef(false),projectRef=useRef(project);projectRef.current=project;
 const focus=useRecoveryFocus(),motion=usePanelMotion<HTMLDivElement>(tab);
 const merge=useCallback((incoming:ExportRecord[])=>setRecords(current=>mergeExportRecords(current,incoming,projectRef.current.id)),[]);
 const refresh=useCallback(async(initial=false)=>{
  const request=session.current.request();if(!request.active())return;setLoading(true);
  try{const result=await listSavedExports(request.projectId,request.signal);if(!request.active())return;merge(result.jobs);setHistoryError('');setNextOffset(result.nextOffset??null);setDiagnostic(result.diagnostics?.message??'');if(initial&&!initialLoaded.current){initialLoaded.current=true;const running=result.jobs.find(activeExport),record=running??result.jobs[0];if(record){setSelected(record.id);if(running&&!chosenTab.current)setTab('history');}}}
  catch(reason){if(request.active())setHistoryError((reason as Error).message);}
  finally{if(request.active())setLoading(false);}
 },[merge]);
 useLayoutEffect(()=>{session.current.reset(project.id);operation.current=false;chosenTab.current=false;initialLoaded.current=false;setRecords([]);setSelected(null);setNextOffset(null);setError('');setHistoryError('');setDiagnostic('');setBusy(false);setReviewing(false);setAcknowledged(false);setTab('new');setOptions(defaults());setRange({mode:'full',sceneId:project.scenes[0]?.id??'',start:0,end:projectDuration(project)});void refresh(true);return()=>session.current.close();},[project.id,refresh]);
 const loadOlder=async()=>{if(nextOffset===null||loading)return;const request=session.current.request();setLoading(true);try{const result=await listSavedExports(request.projectId,request.signal,nextOffset);if(request.active()){merge(result.jobs);setHistoryError('');setNextOffset(result.nextOffset??null);setDiagnostic(result.diagnostics?.message??'');}}catch(reason){if(request.active())setHistoryError((reason as Error).message);}finally{if(request.active())setLoading(false);}};
 const activeIds=records.filter(activeExport).map(record=>record.id).join(',');
 useEffect(()=>{if(!activeIds)return;let stopped=false,timer:ReturnType<typeof setTimeout>;const request=session.current.request();const poll=async()=>{try{const result=await listSavedExports(request.projectId,request.signal);if(stopped||!request.active())return;const fresh=await refreshActiveExportRecords(result.jobs,activeIds.split(','),id=>getSavedExport(id,request.signal));if(!stopped&&request.active()){merge(fresh);setHistoryError('');setDiagnostic(result.diagnostics?.message??'');}}catch(reason){if(!stopped&&request.active())setHistoryError((reason as Error).message);}finally{if(!stopped&&request.active())timer=setTimeout(poll,900);}};timer=setTimeout(poll,600);return()=>{stopped=true;clearTimeout(timer);};},[activeIds,merge]);
 const chooseTab=(next:'new'|'history')=>{chosenTab.current=true;setTab(next);setError('');if(next==='history')void refresh();};
 const perform=async(action:(request:ReturnType<ExportSession['request']>)=>Promise<void>)=>{if(operation.current)return;operation.current=true;setBusy(true);setError('');const request=session.current.request();try{await action(request);}catch(reason){if(request.active())setError((reason as Error).message);}finally{if(request.active()){operation.current=false;setBusy(false);}}};
 const adopt=(record:ExportRecord)=>{merge([record]);setSelected(record.id);setReviewing(false);setAcknowledged(false);chosenTab.current=true;setTab('history');};
 const start=()=>void perform(async request=>{const record=await exportCurrentVersion(request,flush,options,range,projectRevision,(snapshot,resolved,revision,signal)=>startSavedExport(snapshot.id,resolved,revision,signal));if(record)adopt(record);});
 const cancel=(record:ExportRecord)=>void perform(async request=>{const result=await cancelSavedExport(record.id,request.signal);if(request.active())merge([result]);});
 const restart=(record:ExportRecord)=>void perform(async request=>{try{const result=await restartSavedExport(record.id,record.recovery.runtimeChanged&&acknowledged,request.signal);if(request.active()){adopt(result);void refresh();}}catch(reason){if(request.active()){try{const current=await getSavedExport(record.id,request.signal);if(request.active())merge([current]);}catch{}}throw reason;}});
 const file=(record:ExportRecord,reveal:boolean)=>void perform(async request=>{const fresh=await getSavedExport(record.id,request.signal);if(!request.active())return;merge([fresh]);if(fresh.status!=='complete'||fresh.output.status!=='available')throw Error(fresh.output.reason||'The completed output is no longer available.');if(reveal){if(!fresh.outputPath)throw Error('The completed output path is unavailable.');await window.sceneForge?.reveal(fresh.outputPath);}else{const link=document.createElement('a');link.href=`/api/exports/${encodeURIComponent(fresh.id)}/download`;link.download='';link.click();}});
 const close=()=>{session.current.close();onClose();};
 return <Modal title="Export your story" subtitle="Render locally. Revisit your saved exports anytime." onClose={close} wide><div className="export-dialog" ref={focus}>
  <div className="export-tabs" role="tablist" aria-label="Export views"><button role="tab" aria-selected={tab==='new'} onClick={()=>chooseTab('new')} disabled={busy}>Export current version</button><button role="tab" aria-selected={tab==='history'} onClick={()=>chooseTab('history')} disabled={busy}>Export history{records.length>0&&<span>{records.length}</span>}</button></div>
  {(error||historyError)&&<div className="export-error" role="alert">{error||historyError}</div>}
  <div ref={motion} role="tabpanel" aria-label={tab==='new'?'Export current version':'Export history'}>
   {tab==='history'?<ExportHistory diagnostic={diagnostic} records={records} selectedId={selected} onSelect={id=>{setSelected(id);setReviewing(false);setAcknowledged(false);setError('');}} loading={loading} busy={busy} hasMore={nextOffset!==null} onOlder={()=>void loadOlder()} onRefresh={()=>void refresh()} onCurrent={()=>chooseTab('new')} onCancel={cancel} onRestart={restart} onFile={file} reviewing={reviewing} onReview={()=>{setReviewing(true);setAcknowledged(false);}} acknowledged={acknowledged} onAcknowledge={setAcknowledged}/>:<div className="new-export">
    <p className="export-intro">Your latest edits are saved first. Earlier exports stay in Export history.</p>
    <fieldset disabled={busy}>
    <Field label="Format"><select value={options.format} onChange={event=>setOptions({...options,format:event.target.value as ExportOptions['format']})}>{[['mp4','MP4 video'],['webm','WebM video'],['wav','WAV audio'],['srt','SRT subtitles'],['txt','Plain transcript'],['md','Markdown transcript'],['json','Creator Compiler project']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
    {['mp4','webm'].includes(options.format)&&<div className="export-presets">{(['draft','balanced','high']as const).map(quality=><button type="button" key={quality} aria-pressed={options.quality===quality} className={options.quality===quality?'active':''} onClick={()=>setOptions({...options,quality})}><b>{quality==='draft'?'Fast':quality==='balanced'?'Balanced':'Best'}</b><small>{quality==='draft'?'Quick review':quality==='balanced'?'Everyday export':'Maximum detail'}</small></button>)}</div>}
    <details className="export-more"><summary>More options</summary><div>
     <Field label="Range"><select value={range.mode} onChange={event=>setRange({...range,mode:event.target.value as ExportRange['mode']})}><option value="full">Full timeline</option><option value="scene">One scene</option><option value="custom">Custom range</option></select></Field>
     {range.mode==='scene'&&<Field label="Scene"><select value={range.sceneId} onChange={event=>setRange({...range,sceneId:event.target.value})}>{project.scenes.map(scene=><option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></Field>}
     {range.mode==='custom'&&<div className="field-pair"><NumberField label="Start seconds" value={range.start} min={0} max={projectDuration(project)} onChange={start=>setRange({...range,start})}/><NumberField label="End seconds" value={range.end} min={0} max={projectDuration(project)} onChange={end=>setRange({...range,end})}/></div>}
     {['mp4','webm'].includes(options.format)&&<><div className="field-pair"><NumberField label="Width" value={options.width||1920} min={64} max={7680} step={2} onChange={width=>setOptions({...options,width:Math.round(width/2)*2})}/><NumberField label="Height" value={options.height||1080} min={64} max={7680} step={2} onChange={height=>setOptions({...options,height:Math.round(height/2)*2})}/></div><Field label="Frames per second"><select value={options.fps} onChange={event=>setOptions({...options,fps:+event.target.value})}>{[24,25,30,60].map(value=><option key={value}>{value}</option>)}</select></Field>{project.captions.length>0&&<Toggle label="Burn captions into video" value={Boolean(options.burnCaptions)} onChange={burnCaptions=>setOptions({...options,burnCaptions})}/>}{options.format==='mp4'&&<Toggle label="Prefer hardware encoding" hint="Availability depends on your system encoder." value={Boolean(options.hardware)} onChange={hardware=>setOptions({...options,hardware})}/>}</>}
     {onBorumi&&<div className="borumi-export-entry"><div><strong>Keep editing in Borumi</strong><p>Review compatibility and create a separate project copy.</p></div><button className="button" disabled={busy} onClick={()=>{session.current.close();onBorumi();}}>Borumi project…</button></div>}
    </div></details></fieldset>
    <footer className="modal-actions"><button className="button" onClick={close}>Close</button><button className="button primary" disabled={busy} onClick={start}>{busy?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>}{['mp4','webm'].includes(options.format)?'Export video':'Export file'}</button></footer>
   </div>}
  </div>
 </div></Modal>;
}
