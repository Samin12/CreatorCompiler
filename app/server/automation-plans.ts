import {createHash} from 'node:crypto';
import {captionsFromWords} from './ai.js';
import {trimProject} from './mcp.js';
import {clipDuration,projectDuration,defaultTransform,defaultEffects,narrationPriority,type Project,type Clip,type Caption,type Element,type Media,type AISuggestion} from '../shared/types.js';
import type {AutomationChange} from '../shared/automation.js';
export type Word={text:string;start:number;end:number};
export type PlanOperation={id:string;kind:'cut';start:number;end:number}|{id:string;kind:'elements';elements:Element[]}|{id:string;kind:'layout';background:Media};
export interface NarrationWindow {clip:Clip;start:number;end:number;}
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function narrationWindows(p:Project):NarrationWindow[]{
 const media=new Map(p.media.map(m=>[m.id,m]));const clips=p.clips.filter(c=>!c.muted&&c.gain>0&&c.track!=='music'&&media.has(c.mediaId)&&media.get(c.mediaId)!.kind!=='image'&&media.get(c.mediaId)!.hasAudio!==false);
 const edges=[...new Set(clips.flatMap(c=>[c.start,c.start+clipDuration(c)]))].sort((a,b)=>a-b),out:NarrationWindow[]=[];
 for(let i=0;i<edges.length-1;i++){const start=edges[i],end=edges[i+1],mid=(start+end)/2;const c=clips.filter(c=>c.start<=mid&&c.start+clipDuration(c)>mid).sort((a,b)=>narrationPriority(a,media.get(a.mediaId))-narrationPriority(b,media.get(b.mediaId))||a.start-b.start||a.id.localeCompare(b.id))[0];if(!c)continue;const last=out.at(-1);if(last?.clip.id===c.id&&Math.abs(last.end-start)<1e-8)last.end=end;else out.push({clip:c,start,end});}return out;
}
export const speechSignature=(p:Project)=>hash({windows:narrationWindows(p).map(w=>({start:w.start,end:w.end,clip:{id:w.clip.id,mediaId:w.clip.mediaId,start:w.clip.start,sourceIn:w.clip.sourceIn,sourceOut:w.clip.sourceOut,speed:w.clip.speed}})),media:p.media.map(m=>({id:m.id,path:m.path})),maxWords:p.captionStyle.maxWords});
export function mapSourceCaptions(p:Project,sources:Map<string,Caption[]>):Caption[]{
 const words:Word[]=[],segments:Caption[]=[];
 for(const {clip:c,start,end} of narrationWindows(p))for(const cap of sources.get(c.mediaId)??[]){
  const mapped=(t:number)=>c.start+(t-c.sourceIn)/c.speed;
  if(cap.words?.length){for(const w of cap.words){const a=mapped(w.start),b=mapped(w.end),mid=(a+b)/2;if(mid>=start&&mid<end&&w.start>=c.sourceIn-1e-5&&w.end<=c.sourceOut+1e-5)words.push({text:w.text,start:Math.max(start,a),end:Math.min(end,b)});}}
  else {const a=mapped(cap.start),b=mapped(cap.end);if(a>=start-1e-5&&b<=end+1e-5)segments.push({...cap,id:hash([c.id,cap.id,a,b]).slice(0,28),start:a,end:b});}
 }
 return [...captionsFromWords(words,p.captionStyle.maxWords),...segments].sort((a,b)=>a.start-b.start).map(c=>({...c,id:'auto-'+hash([c.start,c.end,c.text]).slice(0,24)}));
}
export function mergeAutomaticCaptions(current:Caption[],generated:Caption[],previous:Caption[]=[]){
 const originals=new Map(previous.map(c=>[c.id,hash(c)]));const preserved=current.filter(c=>originals.get(c.id)!==hash(c));
 const overlaps=(start:number,end:number)=>preserved.some(old=>start<old.end-1e-6&&end>old.start+1e-6);
 const additions=generated.flatMap(c=>!overlaps(c.start,c.end)?[c]:c.words?.length?captionsFromWords(c.words.filter(w=>!overlaps(w.start,w.end))).map(part=>({...part,id:'auto-'+hash([part.start,part.end,part.text]).slice(0,24)})):[]);
 return {captions:[...preserved,...additions].sort((a,b)=>a.start-b.start),generated:additions,preserved:preserved.length};
}
export function transcriptWords(p:Project):Word[]{return p.captions.flatMap(c=>c.words?.length?c.words:[]).sort((a,b)=>a.start-b.start).filter((w,i,a)=>!i||Math.abs(w.start-a[i-1].start)>.001||w.text!==a[i-1].text);}
const normalized=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function planCuts(p:Project,silences:AISuggestion[]){
 const words=transcriptWords(p);if(!words.length)throw Error('Auto-cut needs word-timed captions. Finish local transcription first.');
 const changes:AutomationChange[]=[],operations:PlanOperation[]=[];const fps=p.canvas.fps;const protectedRange=(a:number,b:number)=>words.some(w=>w.start<b&&w.end>a)||p.captions.some(c=>!c.words?.length&&c.start<b&&c.end>a);
 for(const s of silences){if(s.start===undefined||s.end===undefined)continue;let start=Math.ceil((s.start+.16)*fps)/fps,end=Math.floor((s.end-.16)*fps)/fps;
  if(end-start<.25||protectedRange(start,end))continue;const id='silence-'+hash([start,end]).slice(0,12);operations.push({id,kind:'cut',start,end});changes.push({id,category:'silence',start,end,label:`Shorten ${(end-start).toFixed(2)}s quiet gap`,reason:'Audio is quiet and no transcript word overlaps this cut; 160 ms margins preserve breath around it. Review intentional pauses.',selected:true});}
 // Exact neighboring repeated phrases are candidates only. Emphasis can be intentional.
 for(let i=0;i<words.length-5;i++){let found=false;for(let n=Math.min(16,Math.floor((words.length-i)/2));n>=3;n--){const a=words.slice(i,i+n),b=words.slice(i+n,i+2*n);if(b[0].start-a.at(-1)!.end>2||a.some((w,k)=>normalized(w.text)!==normalized(b[k].text))||a.at(-1)!.end-a[0].start>12)continue;
   const start=Math.ceil(a[0].start*fps)/fps,end=Math.floor(b[0].start*fps)/fps;if(end-start<.2||operations.some(o=>o.kind==='cut'&&o.start<end&&o.end>start))continue;
   const id='repeat-'+hash([start,end]).slice(0,12);operations.push({id,kind:'cut',start,end});changes.push({id,category:'repeat',start,end,label:`Repeated phrase: “${a.map(w=>w.text).join(' ')}”`,reason:'The same adjacent words occur again. The later take is retained. This may be deliberate emphasis, so it is unchecked until you review it.',selected:false});i+=n-1;found=true;break;}if(found)continue;
 }
 return {changes,operations,warnings:['Cuts ripple every synchronized track, captions, scenes, graphics and cursor timing together. Preview and listen to joins before applying.','Only verified quiet gaps are selected automatically. Repeated phrases and optional Claude narrative cuts need your review; meaning is not automatically certified.']};
}
const element=(id:string,text:string,start:number,duration:number,box:Partial<Element>):Element=>({id,type:'text',text,start,duration,x:.025,y:.06,width:.72,height:.12,fontSize:44,color:'#F4F1EC',background:'#1E1D1Bee',opacity:1,rotation:0,...box});
export function planVisuals(p:Project,background:Media){
 const duration=projectDuration(p);if(!duration)throw Error('Add timeline media before visualizing.');const changes:AutomationChange[]=[],operations:PlanOperation[]=[];
 changes.push({id:'proof-layout',category:'layout',label:'Dark dot grid, proof panel and camera tile',reason:'Uses your existing screen recordings in the left panel and camera on the right. Source timing and audio remain unchanged. Existing overlay clips stay in place.',selected:true});operations.push({id:'proof-layout',kind:'layout',background});
 const scenes=p.scenes.filter(s=>s.duration>0).slice(0,100);if(!scenes.length)scenes.push({id:'timeline',name:p.name,script:'',notes:'',start:0,duration});
 const warnings=['Existing recordings are evidence sources, not independently fact-checked claims. External pages, figures and assets have not been researched or fabricated.','The dot grid is static; this treatment does not reproduce the full reference animation workflow.'];
 for(const [index,s] of scenes.entries()){const title=s.name.trim()||`Chapter ${index+1}`,id='chapter-'+s.id,end=Math.min(duration,s.start+s.duration),d=end-s.start;if(d<=0)continue;
  const titleDuration=Math.min(1.6,d);const elements=[element(id+'-title',title,s.start,titleDuration,{x:.01,y:.3,width:.7676,height:.25,fontSize:Math.max(14,p.canvas.height*.052),background:'#1E1D1Bf2'}),element(id+'-badge',`${index+1}/${scenes.length}\n${title}`,s.start,d,{x:.7966,y:.045,width:.1843,height:.1389,fontSize:Math.max(10,p.canvas.height*.024),background:'#1E1D1B'})];
  changes.push({id,category:'chapter',start:s.start,end,label:`Chapter ${index+1}: ${title}`,reason:'Title comes from your scene name; adds a 1.6-second panel slate and persistent chapter badge without inserting pauses.',selected:true});operations.push({id,kind:'elements',elements});
  const screens=p.clips.filter(c=>c.track==='screen'&&(c.zIndex??0)>=0&&c.start<end&&c.start+clipDuration(c)>s.start).sort((a,b)=>a.start-b.start);
  if(!screens.length){warnings.push(`Needs proof at ${s.start.toFixed(2)}s: “${title}” has no screen recording. Add a real source asset or record a demonstration; no proof is invented.`);continue;}
  // A scene can begin before a split or short screen clip. Resolve the source at
  // the badge's actual time, after the title slate, rather than the scene start.
  const labelTime=s.start+titleDuration;
  const first=screens.find(c=>c.start+clipDuration(c)>labelTime)!,start=Math.max(labelTime,first?.start??end);
  if(!first)continue;const until=Math.min(end,first.start+clipDuration(first),start+3);if(until-start<.25)continue;
  const proofId='proof-'+s.id;changes.push({id:proofId,category:'proof',start,end:until,label:`Source footage: ${first.name}`,reason:`Labels existing screen media at source ${(first.sourceIn+(start-first.start)*first.speed).toFixed(2)}s. It does not assert that every narrated claim is proven.`,selected:true});operations.push({id:proofId,kind:'elements',elements:[element(proofId,'Recorded screen · '+first.name,start,until-start,{x:.03,y:.88,width:.72,height:.065,fontSize:Math.max(10,p.canvas.height*.025),background:'#121212dd'})]});
 }
 if(p.scenes.length>100)warnings.push('First 100 chapters treated; later scenes need a separate pass.');return {changes,operations,warnings};
}
export function applyOperations(before:Project,operations:PlanOperation[],ids:string[]):Project{
 const selected=new Set(ids),ops=operations.filter(o=>selected.has(o.id));if(selected.size!==ops.length)throw Error('Unknown or duplicate proposal change.');let p=structuredClone(before);const cuts=ops.filter((o):o is Extract<PlanOperation,{kind:'cut'}>=>o.kind==='cut').map(o=>[o.start,o.end]);
 if(cuts.length){p=trimProject(p,cuts,true);const merged:number[][]=[];for(const [a,b] of cuts.sort((a,b)=>a[0]-b[0])){const last=merged.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);}const map=(t:number)=>t-merged.reduce((n,[a,b])=>n+Math.max(0,Math.min(t,b)-a),0);
  const words=transcriptWords(before).filter(w=>!merged.some(([a,b])=>w.start<b&&w.end>a)).map(w=>({...w,start:map(w.start),end:map(w.end)}));
  p.captions=[...captionsFromWords(words,before.captionStyle.maxWords),...before.captions.filter(c=>!c.words?.length&&!merged.some(([a,b])=>c.start<b&&c.end>a)).map(c=>({...c,start:map(c.start),end:map(c.end)}))].sort((a,b)=>a.start-b.start);
 }
 for(const op of ops){if(op.kind==='elements'){const ids=new Set(op.elements.map(e=>e.id));p.elements=p.elements.filter(e=>!ids.has(e.id));p.elements.push(...structuredClone(op.elements));}if(op.kind==='layout'){
   p.canvas={...p.canvas,background:'#121212',padding:0,radius:0};if(!p.media.some(m=>m.id===op.background.id))p.media.push(op.background);
   p.clips=p.clips.filter(c=>c.id!=='automation-dot-grid');p.clips.unshift({id:'automation-dot-grid',name:'Proof-first dot grid',mediaId:op.background.id,track:'screen',start:0,sourceIn:0,sourceOut:projectDuration(p),speed:1,gain:0,muted:true,zIndex:-1000,transform:{...defaultTransform(),fit:'cover'},effects:defaultEffects()});
   p.clips=p.clips.map(c=>c.id==='automation-dot-grid'?c:c.track==='screen'&&(c.zIndex??0)>=0?{...c,transform:{...c.transform,x:.01,y:.0178,width:.7676,height:.9644,fit:'contain',borderRadius:p.canvas.height*.0178}}:c.track==='camera'?{...c,transform:{...c.transform,x:.7966,y:.2126,width:.1843,height:.5747,fit:'cover',borderRadius:p.canvas.height*.01778}}:c);
  }}return p;
}
/** Small independent BMP writer: static geometric background, no proprietary asset. */
export function dotGridBMP(width:number,height:number):Buffer{
 const stride=Math.ceil(width*3/4)*4,size=54+stride*height,b=Buffer.alloc(size);b.write('BM');b.writeUInt32LE(size,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(width,18);b.writeInt32LE(height,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(stride*height,34);
 const pitch=Math.max(8,Math.round(width/48)),radius=Math.max(1,width/914);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=x%pitch-pitch/2,dy=y%pitch-pitch/2,value=dx*dx+dy*dy<=radius*radius?70:18,at=54+(height-1-y)*stride+x*3;b[at]=b[at+1]=b[at+2]=value;}return b;
}
