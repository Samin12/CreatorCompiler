import type {ExportRecord} from '../shared/export-history';
import {Clock3,Download,FolderOpen,LoaderCircle,RotateCcw} from './Icons';
import {activeExport} from './export-session';

const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const seconds=(value:number)=>`${Math.floor(value/60)}:${(value%60).toFixed(2).padStart(5,'0')}`;
const statusLabel=(job:ExportRecord)=>job.status==='complete'?'Completed':job.status[0].toUpperCase()+job.status.slice(1);
export function ExportHistory({diagnostic,records,selectedId,onSelect,loading,busy,onRefresh,onCurrent,onCancel,onRestart,onFile,reviewing,onReview,acknowledged,onAcknowledge,hasMore,onOlder}:{
 diagnostic?:string;hasMore:boolean;onOlder:()=>void;records:ExportRecord[];selectedId:string|null;onSelect:(id:string)=>void;loading:boolean;busy:boolean;onRefresh:()=>void;onCurrent:()=>void;onCancel:(record:ExportRecord)=>void;onRestart:(record:ExportRecord)=>void;onFile:(record:ExportRecord,reveal:boolean)=>void;reviewing:boolean;onReview:()=>void;acknowledged:boolean;onAcknowledge:(value:boolean)=>void;
}){
 const selected=records.find(record=>record.id===selectedId)??records.find(activeExport)??records[0];
 return <div className="export-history">
  <div className="export-history-toolbar"><p>Saved exports for this project.</p><button className="button" onClick={onRefresh} disabled={busy||loading}><RotateCcw size={14}/>{loading?'Refreshing…':'Refresh history'}</button></div>
  {diagnostic&&<p className="export-notice" role="status">{diagnostic}</p>}
  {!records.length?<div className="empty-state"><Clock3 size={28}/><h3>{loading?'Loading exports…':'No exports yet'}</h3><p>Exports appear here after you start them. You can close this dialog while they run.</p>{!loading&&<button className="button primary" onClick={onCurrent}>Export current version</button>}</div>:<div className="export-history-layout">
   <ol className="export-history-list" aria-label="Saved exports">{records.map(record=><li key={record.id}><button type="button" aria-pressed={selected?.id===record.id} onClick={()=>onSelect(record.id)} disabled={busy}>
    <span><strong>{record.options.format.toUpperCase()} export</strong><small>{date(record.startedAt)}</small></span><span className={`export-status ${record.status}`}>{statusLabel(record)}</span>
    <small>{record.options.range?`${seconds(record.options.range.start)} – ${seconds(record.options.range.end)}`:'Full timeline'}{record.restartOf?' · Restarted attempt':''}</small>
   </button></li>)}{hasMore&&<li><button className="button" disabled={busy||loading} onClick={onOlder}>{loading?'Loading…':'Load older exports'}</button></li>}</ol>
   {selected&&<section className="export-detail" aria-label="Export details">
    <div className="export-detail-heading"><h3>{selected.options.format.toUpperCase()} export</h3><span className={`export-status ${selected.status}`}>{statusLabel(selected)}</span></div>
    <p className="export-saved-at">Saved version · {date(selected.snapshotCreatedAt)}</p>
    <dl className="export-summary"><div><dt>Project</dt><dd>{selected.projectName}</dd></div><div><dt>Range</dt><dd>{selected.options.range?`${seconds(selected.options.range.start)} – ${seconds(selected.options.range.end)}`:'Full timeline'}</dd></div>{['mp4','webm'].includes(selected.options.format)&&<><div><dt>Video</dt><dd>{selected.options.width} × {selected.options.height} · {selected.options.fps} fps</dd></div><div><dt>Quality</dt><dd>{selected.options.quality??'balanced'}</dd></div><div><dt>Captions</dt><dd>{selected.options.burnCaptions===false?'Separate from video':'Burned in when enabled'}</dd></div></>}<div><dt>Version</dt><dd><code title={selected.projectRevision}>{selected.projectRevision.slice(0,12)}</code></dd></div></dl>
    {activeExport(selected)?<div className="export-live" role="status"><p><LoaderCircle size={16} className="spin"/>{selected.message}</p><progress max={1} value={selected.progress} aria-label="Export progress"/><span>{Math.round(selected.progress*100)}%</span><button className="button" disabled={busy} onClick={()=>onCancel(selected)}>Cancel export</button><small>Closing this dialog keeps the export running.</small></div>:<>
     {selected.status==='interrupted'&&<p className="export-notice">The app stopped before this export finished. You can restart its saved version from the beginning.</p>}
     {selected.status==='failed'&&<p className="export-notice" role="status">{selected.error||selected.message||'This export did not finish.'}</p>}
     {selected.status==='cancelled'&&<p className="export-notice">This attempt was cancelled. Its saved version is still available for review.</p>}
     {selected.status==='complete'&&(selected.output.status==='available'?<div className="export-file-actions"><button className="button primary" disabled={busy} onClick={()=>onFile(selected,false)}><Download size={16}/>Download export</button>{window.sceneForge&&<button className="button" disabled={busy} onClick={()=>onFile(selected,true)}><FolderOpen size={16}/>Show in Finder</button>}</div>:<p className="export-notice" role="status">{selected.output.reason||`Output file ${selected.output.status}.`} Download is unavailable.</p>)}
     {selected.recovery.status==='blocked'&&<div className="export-notice" role="status"><strong>Restart unavailable</strong><p>{selected.recovery.reason||'The saved sources cannot be verified.'}</p>{!!selected.recovery.changedSources?.length&&<ul>{selected.recovery.changedSources.map((source,index)=><li key={`${index}-${source}`}>{source}</li>)}</ul>}<p>Use Export current version after reviewing your project and its media.</p></div>}
     {reviewing?<div className="export-restart-review"><h4>Restart this saved export?</h4><p>Renders from the beginning using the version and settings above. Your current project edits stay unchanged.</p>{selected.recovery.runtimeChanged&&<label className="export-runtime-ack"><input type="checkbox" checked={acknowledged} onChange={event=>onAcknowledge(event.target.checked)}/>The rendering tools changed since this export. I understand the result may look or sound different.</label>}<button className="button primary" disabled={busy||selected.recovery.status==='blocked'||(selected.recovery.runtimeChanged&&!acknowledged)} onClick={()=>onRestart(selected)}>{busy?<LoaderCircle size={16} className="spin"/>:<RotateCcw size={16}/>}Restart saved export</button></div>:<button className="button export-review-button" disabled={busy||selected.recovery.status==='blocked'} onClick={onReview}><RotateCcw size={16}/>Review saved export to restart</button>}
    </>}
   </section>}
  </div>}
 </div>;
}
