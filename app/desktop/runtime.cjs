const path=require('node:path');
const fs=require('node:fs');
function runtimeEnvironment({root,data,port,env=process.env}){
 const runtime=path.join(root,'runtime'),bin=path.join(runtime,'bin');
 const model=path.join(runtime,'models','ggml-base.en.bin');
 const launcher=path.resolve(root,'../../MacOS/creator-compiler-mcp');
 return {...env,SCENEFORGE_DATA_DIR:data,SCENEFORGE_PORT:String(port),
  PATH:[bin,env.PATH||'','/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin'].filter(Boolean).join(path.delimiter),
  ...(fs.existsSync(model)?{SCENEFORGE_DEFAULT_MODEL:model,SCENEFORGE_WHISPER_MODEL:env.SCENEFORGE_WHISPER_MODEL||model}:{}),
  ...(fs.existsSync(launcher)?{SCENEFORGE_MCP_COMMAND:launcher}:{}),
  ...(fs.existsSync(path.join(bin,'ffmpeg'))&&!env.SCENEFORGE_FFMPEG?{SCENEFORGE_FFMPEG:path.join(bin,'ffmpeg')}:{}),
  ...(fs.existsSync(path.join(bin,'ffprobe'))&&!env.SCENEFORGE_FFPROBE?{SCENEFORGE_FFPROBE:path.join(bin,'ffprobe')}:{}),
 };
}
/** The app's Application Support folder. Moves the folder an older SceneForge build left behind, once, so projects, settings and history carry over. */
function supportDirectory(appData,fsImpl=fs){
 const current=path.join(appData,'Creator Compiler'),legacy=path.join(appData,'SceneForge');
 if(!fsImpl.existsSync(current)&&fsImpl.existsSync(legacy))try{fsImpl.renameSync(legacy,current);}catch{return legacy;}
 return current;
}
module.exports={runtimeEnvironment,supportDirectory};
