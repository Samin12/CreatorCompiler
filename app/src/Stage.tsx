import {memo,useEffect,useMemo,useRef,useState} from 'react';
import {Film,Plus} from './Icons';
import type {Clip,Media,Project} from '../shared/types';
import {clipDuration,clipEffectTiming} from '../shared/types';
import {mediaUrl} from './api';
import {useVisionPreview} from './useVisionPreview';
import {useFaceTracking} from './useFaceTracking';
import {trackedCrop} from '../shared/face-tracking';
import {previewAudioMixer} from './preview-audio';
import {clipCompositeOrder} from '../shared/timeline-layers';
import {clipShadowCss} from '../shared/clip-shadow';
import {canvasBackgroundStyle} from '../shared/canvas-background';
import {zoomScaleAt} from '../shared/zoom-timing';
import {usePlayheadTime,type Playhead} from './playhead';

function ClipView({clip,media,time,playing,quality,onSelect,project:p,pixelScale,playbackRate}:{clip:Clip;media:Media;time:number;playing:boolean;quality:boolean;onSelect:()=>void;project:Project;pixelScale:number;playbackRate:number}){
 const ref=useRef<HTMLVideoElement|null>(null),audio=useRef<HTMLAudioElement|null>(null),backdrop=useRef<HTMLVideoElement|null>(null),[audioError,setAudioError]=useState(false);
 const sourceTime=clip.sourceIn+Math.max(0,time-clip.start)*clip.speed,visionEnabled=Boolean(clip.effects.background&&clip.effects.background!=='none');
 const vision=useVisionPreview(media,sourceTime,visionEnabled&&['screen','camera','overlay'].includes(clip.track),playing);
 const tracking=useFaceTracking(media,sourceTime,Boolean(clip.effects.faceCenter)&&['screen','camera','overlay'].includes(clip.track));
 const visible=time>=clip.start&&time<clip.start+clipDuration(clip);
 useEffect(()=>{const elements=[ref.current,audio.current,backdrop.current];return()=>{for(const element of elements)if(element)previewAudioMixer.detach(element);};},[media.id,media.kind,clip.track]);
 useEffect(()=>{let failed=false;for(const el of [ref.current,audio.current,backdrop.current]){if(!el)continue;const isBackdrop=el===backdrop.current;if(isBackdrop){el.volume=0;el.muted=true;}else{try{previewAudioMixer.update(el,clip,time,playing&&visible,playbackRate);}catch{el.muted=true;failed=true;}}el.playbackRate=Math.max(.0625,Math.min(16,clip.speed*playbackRate));const target=clip.sourceIn+Math.max(0,time-clip.start)*clip.speed;if(visible&&Math.abs(el.currentTime-target)>(playing?.22:.025))el.currentTime=target;if(playing&&visible&&!isBackdrop){el.play().catch(()=>{});}else el.pause();}setAudioError(failed);},[time,playing,clip,visible,vision.frame,playbackRate]);
 if(media.kind==='audio'||clip.track==='audio'||clip.track==='music')return <><audio ref={audio} src={mediaUrl(media)} preload="metadata"/>{audioError&&<span role="status" className="vision-preview-status">Audio preview unavailable</span>}</>;
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
 const style={left:`${t.x*100}%`,top:`${t.y*100}%`,width:`${t.width*100}%`,height:`${t.height*100}%`,display:visible?'block':'none',opacity,transform:`rotate(${t.rotation}deg) scaleX(${e.flipX?-1:1})`,borderRadius:(t.borderRadius||(full?p.canvas.radius:0))*pixelScale,filter:`brightness(${1+e.brightness}) contrast(${e.contrast}) saturate(${e.saturation}) blur(${e.blur*pixelScale}px) grayscale(${e.grayscale?1:0})${clipShadowCss(t,pixelScale)}`} as const;
 const blurBackground=Boolean(vision.frame&&e.background==='blur');
 return <div className="stage-media" style={style} onClick={e=>{e.stopPropagation();onSelect();}}>{blurBackground&&(media.kind==='image'?<img className="vision-background" src={mediaUrl(media)} style={{...mediaStyle,filter:`blur(${18*pixelScale}px)`}} alt=""/>:<video className="vision-background" ref={backdrop} src={mediaUrl(media,quality)} muted playsInline preload="metadata" style={{...mediaStyle,filter:`blur(${18*pixelScale}px)`}}/>)}{media.kind==='image'?<img src={mediaUrl(media)} style={{...mediaStyle,...mask}} alt={media.name}/>:<video ref={ref} src={mediaUrl(media,quality)} playsInline preload="metadata" style={{...mediaStyle,...mask}}/>}{audioError&&<span role="status" className="vision-preview-status">Audio preview unavailable</span>}{tracking.error||tracking.loading?<span role="status" className="vision-preview-status">{tracking.error||'Preparing face tracking…'}</span>:null}{visionEnabled&&(playing||vision.loading||vision.error)&&<span className="vision-preview-status">{playing?'Background effects preview while paused':vision.loading?'Preparing subject preview…':vision.error}</span>}</div>;
}

export const Stage=memo(function Stage({project:p,playhead,playing,playbackRate=1,onSelect,onImport}:{project:Project;playhead:Playhead;playing:boolean;playbackRate?:number;onSelect:(id:string)=>void;onImport:()=>void}){
 const time=usePlayheadTime(playhead);
 const ref=useRef<HTMLDivElement>(null),wrapper=useRef<HTMLDivElement>(null),[width,setWidth]=useState(640),[dimensions,setDimensions]=useState({width:640,height:360});
 useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width));observer.observe(ref.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{const node=wrapper.current;if(!node)return;const resize=()=>{const style=getComputedStyle(node),availableWidth=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),availableHeight=node.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom),ratio=p.canvas.width/p.canvas.height;const width=Math.max(0,Math.min(availableWidth,availableHeight*ratio));setDimensions({width,height:width/ratio});};const observer=new ResizeObserver(resize);observer.observe(node);resize();return()=>observer.disconnect();},[p.canvas.width,p.canvas.height]);
 const scale=width/p.canvas.width,caption=p.captionStyle.enabled?p.captions.find(c=>time>=c.start&&time<c.end):null;
 const pattern=p.canvas.backgroundPattern==='moving-dots';
 const point=[...p.cursor.points].reverse().find(point=>point.time<=time);
 const mediaById=useMemo(()=>new Map(p.media.map(m=>[m.id,m])),[p.media]);
 const active=p.clips.filter(c=>time>=c.start&&time<c.start+clipDuration(c));
 const visual=active.filter(c=>['screen','camera','overlay'].includes(c.track));
 const audio=active.filter(c=>['audio','music'].includes(c.track));
 return <div className="stage-wrap" ref={wrapper}><div ref={ref} className="stage" style={{...dimensions,flexShrink:0,background:p.canvas.background,...(pattern?canvasBackgroundStyle(p.canvas,time,scale):{})}}>
  <div className="stage-inner" style={{inset:0}}>
   {[...visual].sort((a,b)=>clipCompositeOrder(a,p)-clipCompositeOrder(b,p)).map(c=>{const m=mediaById.get(c.mediaId);return m?<div key={c.id} className="stage-layer"><ClipView clip={c} media={m} time={time} playing={playing} quality={p.settings.previewQuality==='proxy'} onSelect={()=>onSelect(c.id)} project={p} pixelScale={scale} playbackRate={playbackRate}/></div>:null;})}
   {audio.map(c=>{const m=mediaById.get(c.mediaId);return m?<ClipView key={c.id} clip={c} media={m} time={time} playing={playing} quality={false} onSelect={()=>onSelect(c.id)} project={p} pixelScale={scale} playbackRate={playbackRate}/>:null;})}
  </div>
  {p.elements.filter(e=>time>=e.start&&time<e.start+e.duration).map(e=><div key={e.id} className={`stage-element element-${e.type}`} onClick={event=>{event.stopPropagation();onSelect(e.id);}} style={{left:`${e.x*100}%`,top:`${e.y*100}%`,width:`${e.width*100}%`,height:`${e.height*100}%`,fontSize:e.fontSize*scale,color:e.color,background:e.type==='arrow'?'transparent':e.background,opacity:e.opacity,transform:`rotate(${e.rotation}deg)`,border:e.type==='rectangle'||e.type==='ellipse'?`${Math.max(1,3*scale)}px solid ${e.color}`:undefined,backdropFilter:e.type==='blur'?'blur(12px)':undefined}}>{e.type==='text'?e.text:e.type==='arrow'?<svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d="M2 20H90 M72 4L94 20L72 36" fill="none" stroke={e.color} strokeWidth="4"/></svg>:null}</div>)}
  {caption&&<div className={`stage-caption caption-${p.captionStyle.position}`} style={{fontSize:p.captionStyle.fontSize*scale,color:p.captionStyle.color}}><span style={{background:p.captionStyle.background}}>{caption.text}</span></div>}
  {p.cursor.enabled&&point&&point.visible!==false&&<div className={`stage-cursor ${p.cursor.highlight?'has-highlight':''}`} style={{left:`${point.x*100}%`,top:`${point.y*100}%`,width:p.cursor.size*scale,color:p.cursor.color}}><svg viewBox="0 0 24 32"><path d="M2 1v27l7-7 6 10 5-3-6-10 10-1z" fill="currentColor" stroke="#171b27"/></svg></div>}
  {!p.clips.length&&<button className="stage-empty" style={pattern?{background:'transparent',color:'#f4f4f4'}:undefined} onClick={onImport}><div className="stage-empty-icon"><Film size={32}/></div><strong style={pattern?{color:'#f4f4f4'}:undefined}>Your story starts here</strong><span style={pattern?{color:'#b8b8b8'}:undefined}>Import a video, record a take, or add an element.</span><span className="button primary"><Plus size={14}/>Import media</span></button>}
 </div><div className="stage-caption-label"><span>{p.canvas.width} × {p.canvas.height}</span><span>{p.settings.previewQuality==='proxy'?'Adaptive preview':'Original quality'}</span></div></div>;
});
