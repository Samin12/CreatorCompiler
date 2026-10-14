/** One bounded frame in flight. Frames come from the existing camera preview. */
export class HudCameraPublisher {
 private busy=false;
 private closed=false;
 private timer:ReturnType<typeof setInterval>|null=null;
 constructor(private frame:()=>string|null,private publish:(frame:string)=>Promise<unknown>,private onError:(error:unknown)=>void=()=>{}){}
 start(){if(this.closed||this.timer)return;this.timer=setInterval(()=>void this.tick(),125);void this.tick();}
 async tick(){
  if(this.closed||this.busy)return;
  this.busy=true;
  try{const frame=this.frame();if(frame&&frame.startsWith('data:image/jpeg;base64,')&&frame.length<=200_000&&!this.closed)await this.publish(frame);}
  catch(error){if(!this.closed)this.onError(error);}
  finally{this.busy=false;}
 }
 stop(){this.closed=true;if(this.timer)clearInterval(this.timer);this.timer=null;}
}
export function hudCameraFrame(video:HTMLVideoElement,canvas:HTMLCanvasElement):string|null {
 if(video.readyState<2||!video.videoWidth||!video.videoHeight)return null;
 const scale=Math.min(1,480/video.videoWidth,480/video.videoHeight);
 const width=Math.max(1,Math.round(video.videoWidth*scale)),height=Math.max(1,Math.round(video.videoHeight*scale));
 if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
 const context=canvas.getContext('2d');if(!context)return null;
 context.drawImage(video,0,0,width,height);return canvas.toDataURL('image/jpeg',.6);
}
