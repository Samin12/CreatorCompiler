import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access,copyFile,mkdir,mkdtemp,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run=promisify(execFile);

export async function sha256File(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

export function signingDescription(details){
  if(details.includes('Signature=adhoc'))return 'This build is ad hoc signed and is not Apple-notarized.';
  if(/Authority=(?:Apple Development:|Mac Developer:)/.test(details))return 'This local development build is Apple Development signed and is not Apple-notarized.';
  if(details.includes('Authority=Developer ID Application:'))return 'This build is Developer ID signed and is not Apple-notarized.';
  throw Error('Cannot describe an unrecognized application signature.');
}

// Kept separate so the disk-image writer can be tested with ordinary fixture
// files, without creating a fake application or changing the release bundle.
export async function createDiskImage(sourceDirectory,outputFile,{volumeName='Creator Compiler'}={}){
  if(process.platform!=='darwin')throw Error('Disk-image packaging requires macOS and hdiutil.');
  const source=path.resolve(sourceDirectory),output=path.resolve(outputFile);
  const relative=path.relative(source,output);
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('The disk image must be outside its source directory.');
  await access(source);
  await mkdir(path.dirname(output),{recursive:true});
  const work=await mkdtemp(path.join(path.dirname(output),'.sceneforge-dmg-'));
  const temporary=path.join(work,'image.dmg');
  try{
    await run('/usr/bin/hdiutil',['create','-srcfolder',source,'-volname',volumeName,'-fs','HFS+','-format','UDZO','-imagekey','zlib-level=6','-nospotlight',temporary],{maxBuffer:4*1024*1024});
    await run('/usr/bin/hdiutil',['verify',temporary],{maxBuffer:4*1024*1024});
    const sha256=await sha256File(temporary);
    await rename(temporary,output);
    await writeFile(output+'.sha256',sha256+'  '+path.basename(output)+'\n');
    return {dmg:output,sha256};
  }finally{
    await rm(work,{recursive:true,force:true});
  }
}

export async function createDmg(appPath,outputFile){
  const application=path.resolve(appPath);
  if(path.basename(application)!=='Creator Compiler.app')throw Error('Expected the packaged Creator Compiler.app.');
  await access(path.join(application,'Contents','Info.plist'));
  await access(path.join(application,'Contents','MacOS','Creator Compiler'));
  const signature=await run('/usr/bin/codesign',['--display','--verbose=2',application]);
  const signing=signingDescription(signature.stdout+'\n'+signature.stderr);
  const staging=await mkdtemp(path.join(tmpdir(),'sceneforge-installer-'));
  try{
    // Preserve executable bits and symlinks while excluding resource-fork and
    // extended-attribute sidecars. Nothing is written into the source app.
    await run('/usr/bin/ditto',['--norsrc','--noextattr',application,path.join(staging,'Creator Compiler.app')]);
    await symlink('/Applications',path.join(staging,'Applications'));
    await writeFile(path.join(staging,'How to install Creator Compiler.txt'),[
      'INSTALL CREATOR COMPILER',
      '',
      '1. Drag Creator Compiler.app onto the Applications folder in this window.',
      '2. Open Applications and launch Creator Compiler.',
      '3. Eject this disk image after copying finishes.',
      '',
      'Requires macOS 14 or later on Apple silicon.',
      'The app asks for camera, microphone and screen-recording access only when needed.',
      '',
      signing,
      'Installation help: https://github.com/Samin12/CreatorCompiler/blob/main/docs/INSTALL.md',
      '',
    ].join('\n'));
    const icon=path.join(application,'Contents','Resources','electron.icns');
    await copyFile(icon,path.join(staging,'.VolumeIcon.icns')).catch(()=>{});
    return {...await createDiskImage(staging,outputFile),signing};
  }finally{
    await rm(staging,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [app,output]=process.argv.slice(2);
  if(!app||!output)throw Error('Usage: node scripts/create-dmg.mjs <Creator Compiler.app> <output.dmg>');
  console.log(JSON.stringify(await createDmg(app,output)));
}
