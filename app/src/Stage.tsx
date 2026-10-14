import {memo,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Film,Plus} from './Icons';
import type {Clip,Media,Project} from '../shared/types';
import {clipEffectTiming} from '../shared/types';
import {mediaUrl} from './api';
import {useVisionPreview} from './useVisionPreview';
import {useFaceTracking} from './useFaceTracking';
import {trackedCrop} from '../shared/face-tracking';
import {previewAudioMixer} from './preview-audio';
import {canvasBackgroundStyle} from '../shared/canvas-background';
import {zoomScaleAt} from '../shared/zoom-timing';
import {usePlayheadTime,type Playhead} from './playhead';
import {clipFilterCss,cursorPointLookup,stageIndex,stageSlots} from './stage-view';

/** `visible` is false for a pre-rolled upcoming clip: it stays mounted, paused, silent and transparent, with no vision or face-tracking work. */
function ClipView({clip,media,time,visible,playing,quality,onSelect,project:p,pixelScale,playbackRate}:{clip:Clip;media:Media;time:number;visible:boolean;playing:boolean;quality:boolean;onSelect:()=>void;project:Project;pixelScale:number;playbackRate:number}){
 const ref=useRef<HTMLVideoElement|null>(null),audio=useRef<HTMLAudioElement|null>(null),backdrop=useRef<HTMLVideoElement|null>(null),[audioError,setAudioError]=useState(false);
 const sourceTime=clip.sourceIn+Math.max(0,time-clip.start)*clip.speed,visionEnabled=Boolean(clip.effects.background&&clip.effects.background!=='none');
 const vision=useVisionPreview(media,sourceTime,visible&&visionEnabled&&['screen','camera','overlay'].includes(clip.track),playing);
 const tracking=useFaceTracking(media,sourceTime,visible&&Boolean(clip.effects.faceCenter)&&['screen','camera','overlay'].includes(clip.track));
 useEffect(()=>{const elements=[ref.current,audio.current,backdrop.current];return()=>{for(const element of elements)if(element)previewAudioMixer.detach(element);};},[media.id,media.kind,clip.track]);
 // An upcoming clip is pre-seeked once to its first frame. A playing element that is still seeking or buffering is left to
 // catch up: seeking it again would only restart the stall.
 useEffect(()=>{let failed=false;const live=playing&&visible;for(const el of [ref.current,audio.current,backdrop.current]){if(!el)continue;const isBackdrop=el===backdrop.current;if(isBackdrop){el.volume=0;el.muted=true;}else{try{previewAudioMixer.update(el,clip,time,live,playbackRate);}catch{el.muted=true;failed=true;}}const rate=Math.max(.0625,Math.min(16,clip.speed*playbackRate));if(el.playbackRate!==rate)el.playbackRate=rate;const target=clip.sourceIn+Math.max(0,time-clip.start)*clip.speed;if(Math.abs(el.currentTime-target)>(live?.22:.025)&&!(live&&(el.seeking||el.readyState>el.HAVE_NOTHING&&el.readyState<el.HAVE_FUTURE_DATA)))el.currentTime=target;if(live&&!isBackdrop){if(el.paused)el.play().catch(()=>{});}else if(!el.paused)el.pause();}setAudioError(failed);},[time,playing,clip,visible,vision.frame,playbackRate]);
 if(media.kind==='audio'||clip.track==='audio'||clip.track==='music')return <><audio ref={audio} src={mediaUrl(media)} preload={visible?'metadata':'auto'}/>{audioError&&visible&&<span role="status" className="vision-preview-status">Audio preview unavailable</span>}</>;
 const t={...clip.transform},e=clip.effects;
 const full=t.x===0&&t.y===0&&t.width===1&&t.height===1&&(clip.zIndex??0)>=0;
 if(full){const pad=Math.min(p.canvas.padding,Math.min(p.canvas.width,p.canvas.height)/3);t.x=pad/p.canvas.width;t.y=pad/p.canvas.height;t.width=1-2*t.x;t.height=1-2*t.y;}
 const zoom=p.zooms.find(z=>z.target===clip.track&&time>=z.start&&time<z.start+z.duration);
 const zoomScale=zoom?zoomScaleAt(zoom,time):1;
 let position='50% 50%';
 if(e.faceCenter){const tw=Math.max(2,Math.round(p.canvas.width*t.width/2)*2),th=Math.max(2,Math.round(p.canvas.height*t.height/2)*2),crop=trackedCrop(tracking.track?.points??[],sourceTime,media.width||tw,media.height||th,tw,th);position=`${crop.maxX?crop.x/crop.maxX*100:50}% ${crop.maxY?crop.y/crop.maxY*100:50}%`;}
 const mask=vision.frame&&e.background&&e.background!=='none'?{maskImage:`url("${vision.frame.maskUrl}")`,maskMode:'luminance' as const,maskSize:e.faceCenter?'cover':t.fit,maskPosition:position,maskRepeat:'no-repeat'}:{};
 const mediaStyle={position:'absolute' as const,inset:0,objectFit:e.faceCenter?'cover' as const:t.fit,objectPosition:position,transform:`scale(${zoomScale})`,transformOrigin:zoom?`${zoom.x*100}% ${zoom.y*100}%`:undefined};
 const timing=clipEffectTiming(clip),effectElapsed=time-clip.start+timing.offset;
 const fadeIn=Math.min(1,e.fadeIn?Math.max(0,effectElapsed)/e.fadeIn:1),fadeOut=Math.min(1,e.fadeOut?Math.max(0,timing.duration-effectElapsed)/e.fadeOut:1);
 const opacity=t.opacity*(clip.effectTiming?fadeIn*fadeOut:Math.min(fadeIn,fadeOut));
 // Pre-roll is transparent rather than display:none, so its first frame is already decoded and composited at the cut.
 const style={left:`${t.x*100}%`,top:`${t.y*100}%`,width:`${t.width*100}%`,height:`${t.height*100}%`,opacity:visible?opacity:0,pointerEvents:visible?undefined:'none',transform:`rotate(${t.rotation}deg) scaleX(${e.flipX?-1:1})`,borderRadius:(t.borderRadius||(full?p.canvas.radius:0))*pixelScale,filter:clipFilterCss(e,t,pixelScale)} as const;
 const blurBackground=Boolean(vision.frame&&e.background==='blur');
 return <div className="stage-media" style={style} aria-hidden={visible?undefined:true} onClick={e=>{e.stopPropagation();onSelect();}}>{blurBackground&&(media.kind==='image'?<img className="vision-background" src={mediaUrl(media)} style={{...mediaStyle,filter:`blur(${18*pixelScale}px)`}} alt=""/>:<video className="vision-background" ref={backdrop} src={mediaUrl(media,quality)} muted playsInline preload="metadata" style={{...mediaStyle,filter:`blur(${18*pixelScale}px)`}}/>)}{media.kind==='image'?<img src={mediaUrl(media)} style={{...mediaStyle,...mask}} alt={media.name}/>:<video ref={ref} src={mediaUrl(media,quality)} playsInline preload={visible?'metadata':'auto'} style={{...mediaStyle,...mask}}/>}{audioError&&<span role="status" className="vision-preview-status">Audio preview unavailable</span>}{tracking.error||tracking.loading?<span role="status" className="vision-preview-status">{tracking.error||'Preparing face tracking…'}</span>:null}{visionEnabled&&(playing||vision.loading||vision.error)&&<span className="vision-preview-status">{playing?'Background effects preview while paused':vision.loading?'Preparing subject preview…':vision.error}</span>}</div>;
}

export const Stage=memo(function Stage({project:p,playhead,playing,playbackRate=1,onSelect,onImport}:{project:Project;playhead:Playhead;playing:boolean;playbackRate?:number;onSelect:(id:string)=>void;onImport:()=>void}){
 const time=usePlayheadTime(playhead);
 const ref=useRef<HTMLDivElement>(null),wrapper=useRef<HTMLDivElement>(null),[width,setWidth]=useState(640),[dimensions,setDimensions]=useState({width:640,height:360}),[wakes,wake]=useState(0),still=useRef({time,at:-Infinity}),mounted=useRef<ReadonlyMap<string,string>>(new Map());
 useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width));observer.observe(ref.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{const node=wrapper.current;if(!node)return;const resize=()=>{const style=getComputedStyle(node),availableWidth=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),availableHeight=node.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom),ratio=p.canvas.width/p.canvas.height;const width=Math.max(0,Math.min(availableWidth,availableHeight*ratio));setDimensions({width,height:width/ratio});};const observer=new ResizeObserver(resize);observer.observe(node);resize();return()=>observer.disconnect();},[p.canvas.width,p.canvas.height]);
 // A paused playhead that moved in the last 250 ms is being scrubbed: pre-roll keeps the elements it has but opens no new
 // decoders until the playhead settles. Worked out during render, so the first frame of a seek already counts.
 const scrubbing=!playing&&(still.current.time!==time||performance.now()-still.current.at<250);
 useEffect(()=>{if(!scrubbing)return;const timer=setTimeout(()=>wake(n=>n+1),Math.max(0,still.current.at+250-performance.now()));return()=>clearTimeout(timer);},[scrubbing,time,wakes]);
 useEffect(()=>{previewAudioMixer.transport(playing);},[playing]);
 useEffect(()=>()=>previewAudioMixer.release(),[]);
 const scale=width/p.canvas.width,caption=p.captionStyle.enabled?p.captions.find(c=>time>=c.start&&time<c.end):null;
 const pattern=p.canvas.backgroundPattern==='moving-dots',pixelRatio=typeof window==='undefined'?1:window.devicePixelRatio||1;
 const pointAt=useMemo(()=>p.cursor.enabled?cursorPointLookup(p.cursor.points):null,[p.cursor.enabled,p.cursor.points]),point=pointAt?.(time);
 const mediaById=useMemo(()=>new Map(p.media.map(m=>[m.id,m])),[p.media]);
 const index=useMemo(()=>stageIndex(p),[p.clips,p.timelineLayers]);
 // Each row also mounts its next clip up to two seconds of playback ahead. DOM order follows the playback key, never the
 // composite order, so a playing element is never moved; a negative z-index stacks the layers below elements and captions,
 // and .stage-inner (painted above them) lets clicks through to the media.
 const slots=stageSlots(index,time,2*Math.max(1,playbackRate),mounted.current,!scrubbing).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 useLayoutEffect(()=>{mounted.current=new Map(slots.map(s=>[s.clip.id,s.key]));if(still.current.time!==time)still.current={time,at:playing?-Infinity:performance.now()};});
 const visual=slots.filter(({clip:c})=>['screen','camera','overlay'].includes(c.track));
 const audio=slots.filter(({clip:c})=>['audio','music'].includes(c.track));
 return <div className="stage-wrap" ref={wrapper}><div ref={ref} className="stage" style={{...dimensions,flexShrink:0,isolation:'isolate',background:p.canvas.background,...(pattern?canvasBackgroundStyle(p.canvas,time,scale,pixelRatio):{})}}>
  <div className="stage-inner" style={{inset:0,pointerEvents:'none'}}>
   {visual.map(({clip:c,key,visible})=>{const m=mediaById.get(c.mediaId);return m?<div key={key} className="stage-layer" style={{zIndex:index.rank.get(c)!-index.clips.length}}><ClipView clip={c} media={m} time={time} visible={visible} playing={playing} quality={p.settings.previewQuality==='proxy'} onSelect={()=>onSelect(c.id)} project={p} pixelScale={scale} playbackRate={playbackRate}/></div>:null;})}
   {audio.map(({clip:c,key,visible})=>{const m=mediaById.get(c.mediaId);return m?<ClipView key={key} clip={c} media={m} time={time} visible={visible} playing={playing} quality={false} onSelect={()=>onSelect(c.id)} project={p} pixelScale={scale} playbackRate={playbackRate}/>:null;})}
  </div>
  {p.elements.filter(e=>time>=e.start&&time<e.start+e.duration).map(e=><div key={e.id} className={`stage-element element-${e.type}`} onClick={event=>{event.stopPropagation();onSelect(e.id);}} style={{left:`${e.x*100}%`,top:`${e.y*100}%`,width:`${e.width*100}%`,height:`${e.height*100}%`,fontSize:e.fontSize*scale,color:e.color,background:e.type==='arrow'?'transparent':e.background,opacity:e.opacity,transform:`rotate(${e.rotation}deg)`,border:e.type==='rectangle'||e.type==='ellipse'?`${Math.max(1,3*scale)}px solid ${e.color}`:undefined,backdropFilter:e.type==='blur'?'blur(12px)':undefined}}>{e.type==='text'?e.text:e.type==='arrow'?<svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d="M2 20H90 M72 4L94 20L72 36" fill="none" stroke={e.color} strokeWidth="4"/></svg>:null}</div>)}
  {caption&&<div className={`stage-caption caption-${p.captionStyle.position}`} style={{fontSize:p.captionStyle.fontSize*scale,color:p.captionStyle.color}}><span style={{background:p.captionStyle.background}}>{caption.text}</span></div>}
  {p.cursor.enabled&&point&&point.visible!==false&&<div className={`stage-cursor ${p.cursor.highlight?'has-highlight':''}`} style={{left:`${point.x*100}%`,top:`${point.y*100}%`,width:p.cursor.size*scale,color:p.cursor.color}}><svg viewBox="0 0 24 32"><path d="M2 1v27l7-7 6 10 5-3-6-10 10-1z" fill="currentColor" stroke="#171b27"/></svg></div>}
  {!p.clips.length&&<button className="stage-empty" style={pattern?{background:'transparent',color:'#f4f4f4'}:undefined} onClick={onImport}><div className="stage-empty-icon"><Film size={32}/></div><strong style={pattern?{color:'#f4f4f4'}:undefined}>Your story starts here</strong><span style={pattern?{color:'#b8b8b8'}:undefined}>Import a video, record a take, or add an element.</span><span className="button primary"><Plus size={14}/>Import media</span></button>}
 </div><div className="stage-caption-label"><span>{p.canvas.width} × {p.canvas.height}</span><span>{p.settings.previewQuality==='proxy'?'Adaptive preview':'Original quality'}</span></div></div>;
});
