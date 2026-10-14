import {useCallback,useEffect,useRef,useState} from 'react';
import type {AutomationJob} from '../shared/automation';
import {api} from './api';
import {automationRunning,mergeAutomationJobs} from './automation-state';
export function useProjectAutomation(projectId?:string,revision?:string){
 const [jobs,setJobs]=useState<AutomationJob[]>([]),[error,setError]=useState('');
 const owner=useRef(projectId),live=useRef(true),currentJobs=useRef(jobs);owner.current=projectId;currentJobs.current=jobs;
 const merge=useCallback((job:AutomationJob)=>{if(live.current&&owner.current===job.projectId)setJobs(current=>mergeAutomationJobs(current.filter(item=>item.projectId===job.projectId),[job]));},[]);
 const reload=useCallback(async(signal?:AbortSignal)=>{if(!projectId)return;const data=await api<{jobs:AutomationJob[]}>(`/projects/${projectId}/automation`,undefined,undefined,signal);if(live.current&&owner.current===projectId){setJobs(current=>mergeAutomationJobs(current.filter(item=>item.projectId===projectId),data.jobs));setError('');}},[projectId]);
 useEffect(()=>{live.current=true;const request=new AbortController();let timer:ReturnType<typeof setTimeout>;let stopped=false;setJobs([]);setError('');
  const poll=async()=>{try{await reload(request.signal);}catch(e){if(!stopped)setError((e as Error).message);}if(!stopped&&projectId)timer=setTimeout(()=>void poll(),currentJobs.current.some(automationRunning)?2000:15000);};void poll();
  return()=>{stopped=true;live.current=false;request.abort();clearTimeout(timer);};
 },[projectId,reload]);
 useEffect(()=>{if(!projectId)return;const events=new EventSource('/api/events');const receive=(event:MessageEvent)=>{try{const job=JSON.parse(event.data) as AutomationJob;if(job.projectId===projectId)merge(job);}catch{}};events.addEventListener('automation',receive);return()=>{events.close();};},[projectId,merge]);
 useEffect(()=>{if(projectId){const controller=new AbortController();const timer=setTimeout(()=>void reload(controller.signal).catch(()=>{}),300);return()=>{clearTimeout(timer);controller.abort();};}},[projectId,revision,reload]);
 return {jobs:jobs.filter(job=>job.projectId===projectId),error,merge,reload};
}
