/** Level meters share one AudioContext: each context runs its own realtime audio thread. It is suspended while the editor window is hidden. */
export class MeterAudio {
 private context:AudioContext|null=null;
 private users=0;
 private active=true;
 constructor(private create:()=>AudioContext=()=>new AudioContext({latencyHint:'playback'})){}
 acquire():AudioContext{const context=this.context??this.create();this.context=context;this.users++;void(this.active?context.resume():context.suspend()).catch(()=>{});return context;}
 release(){if(!this.users||--this.users)return;const context=this.context;this.context=null;void context?.close().catch(()=>{});}
 setActive(active:boolean){if(this.active===active)return;this.active=active;const context=this.context;if(context)void(active?context.resume():context.suspend()).catch(()=>{});}
}
export function audioLevel(data:Uint8Array):number{let sum=0;for(const v of data)sum+=((v-128)/128)**2;return Math.min(1,Math.sqrt(sum/data.length)*3);}
/** Same scale as audioLevel, for float time-domain samples in [-1, 1]. */
export function waveformLevel(data:Float32Array):number{if(!data.length)return 0;let sum=0;for(const v of data)sum+=v*v;return Math.min(1,Math.sqrt(sum/data.length)*3);}
/** Oscilloscope trace: samples are averaged into `points` buckets, which keeps speech as gentle swells instead of hiss-like jitter,
 * then soft-clipped around the centre line so loud input never leaves the canvas. Silence is an exactly flat line at height/2. */
export function waveformPoints(data:Float32Array,points:number,height:number,inset=1,gain=3):number[]{
 const n=Math.max(2,Math.floor(points)),mid=height/2,amp=Math.max(0,mid-inset),out=new Array<number>(n);
 for(let i=0;i<n;i++){const from=Math.floor(i*data.length/n),to=Math.max(from+1,Math.floor((i+1)*data.length/n));let sum=0,count=0;for(let j=from;j<to&&j<data.length;j++){sum+=data[j];count++;}out[i]=mid-Math.tanh((count?sum/count:0)*gain)*amp;}
 return out;
}
/** Sizes the backing store to the element's CSS box at the device pixel ratio; returns true when it changed (which clears the canvas). */
export function fitCanvas(canvas:{width:number;height:number;clientWidth:number;clientHeight:number},dpr:number):boolean{const width=Math.max(1,Math.round(canvas.clientWidth*dpr)),height=Math.max(1,Math.round(canvas.clientHeight*dpr));if(canvas.width===width&&canvas.height===height)return false;canvas.width=width;canvas.height=height;return true;}
export type WaveContext={clearRect(x:number,y:number,w:number,h:number):void;beginPath():void;moveTo(x:number,y:number):void;lineTo(x:number,y:number):void;quadraticCurveTo(cx:number,cy:number,x:number,y:number):void;stroke():void;strokeStyle:string|CanvasGradient|CanvasPattern;lineWidth:number;lineJoin:CanvasLineJoin;lineCap:CanvasLineCap};
/** One continuous line through the points, smoothed with midpoint quadratic curves. */
export function drawWaveform(ctx:WaveContext,ys:readonly number[],width:number,height:number,style:{color:string;lineWidth:number}){
 ctx.clearRect(0,0,width,height);if(ys.length<2)return;
 ctx.strokeStyle=style.color;ctx.lineWidth=style.lineWidth;ctx.lineJoin='round';ctx.lineCap='round';
 const pad=style.lineWidth/2,step=(width-pad*2)/(ys.length-1),x=(i:number)=>pad+i*step;
 ctx.beginPath();ctx.moveTo(x(0),ys[0]);
 for(let i=1;i<ys.length-1;i++)ctx.quadraticCurveTo(x(i),ys[i],(x(i)+x(i+1))/2,(ys[i]+ys[i+1])/2);
 ctx.lineTo(x(ys.length-1),ys[ys.length-1]);ctx.stroke();
}
