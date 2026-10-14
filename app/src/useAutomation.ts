import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {AutomationJob} from '../shared/automation';
import {api} from './api';
import {automationRunning,mergeAutomationJobs,reuseAutomationJobs} from './automation-state';
import {eventsOpen,subscribeEvents} from './events';
export function useProjectAutomation(projectId?:string,revision?:string){
 const [jobs,setJobs]=useState<AutomationJob[]>([]),[error,setError]=useState('');
 const owner=useRef(projectId),live=useRef(true),currentJobs=useRef(jobs);owner.current=projectId;currentJobs.current=jobs;
 const merge=useCallback((job:AutomationJob)=>{if(live.current&&owner.current===job.projectId)setJobs(current=>reuseAutomationJobs(current,mergeAutomationJobs(current.filter(item=>item.projectId===job.projectId),[job])));},[]);
 const reload=useCallback(async(signal?:AbortSignal)=>{if(!projectId)return;const data=await api<{jobs:AutomationJob[]}>(`/projects/${projectId}/automation`,undefined,undefined,signal);if(live.current&&owner.current===projectId){setJobs(current=>reuseAutomationJobs(current,mergeAutomationJobs(current.filter(item=>item.projectId===projectId),data.jobs)));setError('');}},[projectId]);
 useEffect(()=>{live.current=true;const request=new AbortController();let timer:ReturnType<typeof setTimeout>;let stopped=false;setJobs([]);setError('');
  // Running jobs report through the shared event stream; poll quickly only while it is disconnected.
  const poll=async()=>{try{await reload(request.signal);}catch(e){if(!stopped)setError((e as Error).message);}if(!stopped&&projectId)timer=setTimeout(()=>void poll(),currentJobs.current.some(automationRunning)&&!eventsOpen()?2000:15000);};void poll();
  return()=>{stopped=true;live.current=false;request.abort();clearTimeout(timer);};
 },[projectId,reload]);
 useEffect(()=>{if(!projectId)return;const receive=(event:MessageEvent)=>{try{const job=JSON.parse(event.data) as AutomationJob;if(job.projectId===projectId)merge(job);}catch{}};const stopJobs=subscribeEvents('automation',receive),stopReady=subscribeEvents('ready',()=>void reload().catch(()=>{}));return()=>{stopJobs();stopReady();};},[projectId,merge,reload]);
 // Saves can queue automatic jobs about 800 ms later without an event until they run; refetch once edits settle.
 useEffect(()=>{if(projectId){const controller=new AbortController();const timer=setTimeout(()=>void reload(controller.signal).catch(()=>{}),1200);return()=>{clearTimeout(timer);controller.abort();};}},[projectId,revision,reload]);
 const visible=useMemo(()=>jobs.filter(job=>job.projectId===projectId),[jobs,projectId]);
 return {jobs:visible,error,merge,reload};
}
