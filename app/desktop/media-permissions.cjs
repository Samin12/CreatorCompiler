/** Query the OS on every explicit request. Never cache a permission grant or
 * retry a cancelled/denied prompt, and keep one pending request per device. */
function createMediaPermissionRequests({getStatus,ask,isActive=()=>true}){
 const pending=new Map();
 async function request(kind){
  if(kind!=='camera'&&kind!=='microphone')throw new Error('Only camera and microphone permissions can be requested directly.');
  if(!isActive())throw new Error('Media access was cancelled because the window is closing.');
  const status=getStatus(kind);
  if(['granted','denied','restricted','unsupported'].includes(status))return {permission:kind,granted:status==='granted',status};
  if(pending.has(kind))return pending.get(kind);
  const work=Promise.resolve().then(async()=>{
   if(!isActive())throw new Error('Media access was cancelled because the window is closing.');
   const granted=await ask(kind);
   return {permission:kind,granted,status:getStatus(kind)};
  });
  pending.set(kind,work);
  try{return await work;}finally{pending.delete(kind);}
 }
 return {request};
}
module.exports={createMediaPermissionRequests};
