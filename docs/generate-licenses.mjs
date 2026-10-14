// Run after npm ci: node docs/generate-licenses.mjs
// Preserve the exact license notices from locked production npm dependencies.
import {readFile,readdir,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(await readFile(path.join(root,'app/package-lock.json'),'utf8'));
const output=path.join(root,'docs/licenses/npm');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const seen=new Set(),rows=[],missing=[];
for(const [relative,entry] of Object.entries(lock.packages)){
 if(!relative||entry.dev)continue;
 const source=path.join(root,'app',relative),pkg=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
 const key=`${pkg.name}@${pkg.version}`;if(seen.has(key))continue;seen.add(key);
 const id=key.replaceAll('/','__').replace(/^@/,'');const dir=path.join(output,id);await mkdir(dir,{recursive:true});
 const files=(await readdir(source)).filter(name=>/^(licen[cs]e|copying|copyright|notice)(\b|[._-])/i.test(name));
 let license=pkg.license??pkg.licenses?.map(value=>value.type).join(' OR ')??entry.license??'See included notice';
 if(typeof license==='object')license=license.type??JSON.stringify(license);
 if(!files.length){missing.push(key);continue;}
 for(const file of files)await copyFile(path.join(source,file),path.join(dir,file));
 rows.push({name:pkg.name,version:pkg.version,license,files:files.map(file=>`licenses/npm/${id}/${file}`),source:`https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`});
}
rows.sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
await writeFile(path.join(root,'docs/npm-dependencies.json'),JSON.stringify({source:'app/package-lock.json',scope:'Locked production dependencies; some may be removed by bundling/tree-shaking.',packages:rows},null,2)+'\n');
await writeFile(path.join(root,'docs/NPM-NOTICES.md'),'# Locked npm dependency notices\n\nGenerated from `app/package-lock.json` and the installed package license files by `node docs/generate-licenses.mjs`. Includes production dependencies conservatively, including dependencies that may be removed by tree-shaking. Build-only dependencies retain notices in their npm packages. Electron/Chromium notices are supplied in the Electron distribution.\n\n| Package | Version | Declared license | Full notice |\n| --- | --- | --- | --- |\n'+rows.map(row=>`| [${row.name}](${row.source}) | ${row.version} | ${row.license} | ${row.files.map(file=>`[${path.basename(file)}](${encodeURI(file)})`).join(', ')} |`).join('\n')+'\n');
if(missing.length){console.error('Missing installed license files:',missing);process.exitCode=1;}else console.log(`Preserved ${rows.length} package/version license notices.`);
