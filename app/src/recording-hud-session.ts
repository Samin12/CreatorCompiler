export type RecordingHudState={status?:'starting'|'recording'|'paused'|'saving'|'idle';elapsed?:number;countdown?:number|null;microphoneLevel?:number|null};
/** Serializes a single HUD's open/update/close lifecycle, coalescing pending updates. */
export class RecordingHudSession {
 private closed=false;
 private begun=false;
 private ready:Promise<void>|null=null;
 private sending:Promise<void>|null=null;
 private latest:RecordingHudState|null=null;
 private ending:Promise<void>|null=null;
 constructor(private bridge:{begin:()=>Promise<void>;update:(state:RecordingHudState)=>Promise<unknown>;end:()=>Promise<unknown>},private onError:(error:unknown)=>void=()=>{}){}
 start(){
  if(this.ready)return this.ready;
  this.ready=this.bridge.begin().then(()=>{this.begun=true;}).catch(error=>{this.onError(error);});
  return this.ready.then(()=>this.flush());
 }
 update(state:RecordingHudState){if(this.closed)return Promise.resolve();this.latest={...this.latest,...state};return this.flush();}
 private flush():Promise<void>{
  if(this.sending)return this.sending;
  if(!this.begun||this.closed||!this.latest)return Promise.resolve();
  this.sending=(async()=>{while(this.latest&&!this.closed){const next=this.latest;this.latest=null;try{await this.bridge.update(next);}catch(error){this.onError(error);}}})().finally(()=>{this.sending=null;});
  return this.sending;
 }
 stop(){
  if(this.ending)return this.ending;
  this.closed=true;this.latest=null;
  this.ending=(async()=>{await this.ready;await this.sending;if(this.begun){try{await this.bridge.end();}catch(error){this.onError(error);}}})();
  return this.ending;
 }
}
