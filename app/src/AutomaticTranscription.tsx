import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {AutomationSettings} from '../shared/automation';
import {Section,Toggle} from './Inspector';
import {LoaderCircle,Subtitles} from './Icons';

const settingEvent='sceneforge-automation-settings';
export function useAutomaticTranscription(){
 const [settings,setSettings]=useState<AutomationSettings>({automaticTranscription:true}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),version=useRef(0);
 useEffect(()=>{mounted.current=true;const generation=++version.current;const request=new AbortController();
  void api<AutomationSettings>('/automation/settings',undefined,undefined,request.signal).then(value=>{if(mounted.current&&version.current===generation)setSettings(value);}).catch(e=>{if(mounted.current&&version.current===generation&&!request.signal.aborted)setError(e.message);}).finally(()=>{if(mounted.current&&version.current===generation)setLoading(false);});
  const receive=(event:Event)=>{version.current++;setSettings((event as CustomEvent<AutomationSettings>).detail);setLoading(false);setError('');};window.addEventListener(settingEvent,receive);
  return()=>{mounted.current=false;request.abort();window.removeEventListener(settingEvent,receive);};
 },[]);
 const update=async(value:boolean)=>{if(loading||saving)return;const generation=++version.current;setSaving(true);setError('');try{const result=await api<AutomationSettings>('/automation/settings',{automaticTranscription:value},'PUT');if(mounted.current&&generation===version.current){setSettings(result);window.dispatchEvent(new CustomEvent(settingEvent,{detail:result}));}}catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setSaving(false);}};
 return {enabled:settings.automaticTranscription,loading,saving,error,update};
}
export function AutomaticTranscriptionSetting(){
 const state=useAutomaticTranscription();
 return <Section title="Automatic transcription"><div className="automatic-transcription-setting" aria-busy={state.loading||state.saving}><fieldset disabled={state.loading||state.saving}><Toggle label="Transcribe new audio automatically" value={state.enabled} onChange={value=>void state.update(value)} hint="On by default. New audible clips are transcribed locally after they are saved. Existing captions are preserved."/></fieldset><p className="hint"><Subtitles size={13}/> Automatic transcription always stays on this Mac. The provider below is only used when you start a transcription yourself.</p>{(state.loading||state.saving)&&<p className="hint" role="status"><LoaderCircle size={13} className="spin"/>{state.loading?'Loading preference…':'Saving preference…'}</p>}{state.error&&<p role="alert" className="inline-error">{state.error}</p>}</div></Section>;
}
