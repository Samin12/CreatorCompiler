import {backup,type DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile,realpath,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Project} from '../shared/types.js';

export interface BorumiMapping {scenes:Record<string,string>;media:Record<string,string>;clips:Record<string,{segmentId:string;sceneId:string;kind:string}>;elements:Record<string,{segmentId:string;sceneId:string;plainText?:boolean}>;}
export interface BorumiProvenance {version:1;snapshotId:string;sourceDatabase:string;sourceRoot:string;sourceIsBundle:boolean;originalProjectId:string;databaseSha256:string;baseline:Project;mapping:BorumiMapping;assets?:Record<string,{size:number;mtimeMs:number}>;}
const safeSnapshot=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid Borumi preservation snapshot.');return id;};
export async function preserveBorumiDatabase(db:DatabaseSync,sourceDatabase:string,directory:string){
 const snapshotId=randomUUID(),folder=path.join(directory,snapshotId);await mkdir(folder,{recursive:true,mode:0o700});
 const database=path.join(folder,'original.sqlite');await backup(db,database);
 return {snapshotId,databaseSha256:createHash('sha256').update(await readFile(database)).digest('hex'),sourceDatabase:await realpath(sourceDatabase),folder};
}
export async function finishBorumiPreservation(snapshot:Awaited<ReturnType<typeof preserveBorumiDatabase>>,originalProjectId:string,project:Project,mapping:BorumiMapping){
 const baseline=structuredClone(project);delete baseline.importMetadata;
 const sourceRoot=path.dirname(snapshot.sourceDatabase);
 const assets:NonNullable<BorumiProvenance['assets']>={};
 const scan=async(relative:string)=>{for(const name of await readdir(path.join(sourceRoot,relative))){const rel=path.join(relative,name),info=await lstat(path.join(sourceRoot,rel));if(info.isDirectory())await scan(rel);else if(info.isFile())assets[rel]={size:info.size,mtimeMs:info.mtimeMs};}};
 try{await scan('medias')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const value:BorumiProvenance={version:1,snapshotId:snapshot.snapshotId,sourceDatabase:snapshot.sourceDatabase,sourceRoot,sourceIsBundle:sourceRoot.endsWith('.bmprojbundle'),originalProjectId,databaseSha256:snapshot.databaseSha256,baseline,mapping,assets};
 await writeFile(path.join(snapshot.folder,'provenance.json'),JSON.stringify(value),{mode:0o600});
 return {version:1 as const,snapshotId:snapshot.snapshotId};
}
export async function readBorumiPreservation(project:Project,directory:string){
 const token=project.importMetadata?.roundtrip;
 if(token?.version!==1)throw Error('Reimport this Borumi project to preserve a source snapshot before exporting a compatible copy.');
 const folder=path.join(directory,safeSnapshot(token.snapshotId));
 const value=JSON.parse(await readFile(path.join(folder,'provenance.json'),'utf8')) as BorumiProvenance;
 const database=path.join(folder,'original.sqlite');
 if(value.version!==1||value.snapshotId!==token.snapshotId||createHash('sha256').update(await readFile(database)).digest('hex')!==value.databaseSha256)throw Error('The preserved Borumi snapshot is missing or has changed. Reimport the original.');
 return {value,database};
}

/** Resolve symlinked parents before creating an export directory, so an alias cannot target the source. */
export async function safeBorumiOutputRoot(outputRoot:string,sourceRoot:string):Promise<string>{
 if(!path.isAbsolute(outputRoot))throw Error('Export folder must be an absolute path.');
 const source=await realpath(sourceRoot);let ancestor=path.resolve(outputRoot);const suffix:string[]=[];
 while(true){try{ancestor=await realpath(ancestor);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;suffix.unshift(path.basename(ancestor));ancestor=parent;}}
 const canonical=path.join(ancestor,...suffix),inside=(target:string)=>target===source||target.startsWith(source+path.sep);
 if(inside(canonical))throw Error('Choose an export folder outside the original Borumi project.');
 await mkdir(canonical,{recursive:true,mode:0o700});const actual=await realpath(canonical);
 if(inside(actual))throw Error('Choose an export folder outside the original Borumi project.');
 if(!(await lstat(actual)).isDirectory())throw Error('Export destination must be a folder.');
 return actual;
}
