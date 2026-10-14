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
