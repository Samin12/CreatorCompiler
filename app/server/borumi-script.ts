/** Independent mapping of the observed native script document. Raw structure stays in the preserved DB. */
export function decodeBorumiScript(value:unknown):string {
 if(value==null)return '';
 let doc:any=value;if(typeof value==='string'){try{doc=JSON.parse(value)}catch{return value;}}
 if(typeof doc==='string')return doc;
 if(!doc||!Array.isArray(doc.content))return typeof value==='string'?value:'';
 const inline=(items:any[])=>items.map(x=>typeof x?.text==='string'?x.text:'').join('');
 const blocks=(items:any[]):string=>items.map(x=>{
  if(['paragraph','heading','code-block'].includes(x?.type))return inline(x.content??[]);
  if(['bullet-list','ordered-list'].includes(x?.type))return (x.content??[]).map((item:any)=>blocks(item.content??[])).join('\n');
  if(x?.type==='quote')return blocks(x.content??[]);
  return typeof x?.text==='string'?x.text:'';
 }).join('\n');
 return blocks(doc.content);
}
export function encodeBorumiScript(text:string):string {
 return JSON.stringify({content:text?text.replace(/\r\n?/g,'\n').split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line,bold:false,italic:false,code:false,strike:false}]:[]})):[],selection:null});
}
