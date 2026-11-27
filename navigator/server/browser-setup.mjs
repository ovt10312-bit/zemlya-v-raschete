import path from 'node:path';
import {existsSync} from 'node:fs';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
async function registryComet(){
 const script=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);foreach($k in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\comet.exe','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\comet.exe','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\comet.exe')){if(Test-Path -LiteralPath $k){$v=(Get-Item -LiteralPath $k).GetValue('');if($v){Write-Output $v}}}`;
 const {stdout}=await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:16000});
 return stdout.trim().split(/\r?\n/).filter(Boolean).map(s=>s.replace(/^"|"$/g,''));
}
function launch(executable,args,spawnImpl){
 return new Promise((resolve,reject)=>{
  const child=spawnImpl(executable,args,{windowsHide:false,detached:true,stdio:'ignore'});
  child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()});
 });
}
async function clipboard(folder,spawnImpl){
 // Pass the literal path over stdin. It is never interpolated into shell code;
 // the existing clipboard is never read.
 await new Promise((resolve,reject)=>{
  const child=spawnImpl('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);Set-Clipboard -Value ([Console]::In.ReadToEnd())'],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  const timer=setTimeout(()=>{child.kill();reject(Error('Clipboard timeout'))},5000);
  child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Clipboard unavailable'))});
  child.stdin.on('error',()=>{});child.stdin.end(folder);
 });
}
export async function openBrowserSetup({platform=process.platform,baseDir=process.cwd(),env=process.env,exists=existsSync,spawnImpl=spawn,registry=registryComet}={}){
 if(platform!=='win32')throw Error('Автоматическая подготовка Comet доступна в локальной программе на Windows.');
 const join=path.win32.join,folder=join(baseDir,'browser-extension');
 if(!exists(join(folder,'manifest.json')))throw Error('Папка расширения не найдена. Обнови Навигатор через Update-Navigator.cmd.');
 const candidates=[env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'Perplexity','Comet','Application','comet.exe'),env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'Comet','Application','comet.exe'),env.ProgramFiles&&join(env.ProgramFiles,'Perplexity','Comet','Application','comet.exe'),env['ProgramFiles(x86)']&&join(env['ProgramFiles(x86)'],'Perplexity','Comet','Application','comet.exe')].filter(Boolean);
 let comet=candidates.find(exists);if(!comet){const registered=await registry().catch(()=>[]);comet=registered.find(file=>typeof file==='string'&&path.win32.basename(file).toLowerCase()==='comet.exe'&&exists(file));}
 if(!comet)throw Error('Не найден установленный Comet. Автоматическая подготовка не выполнялась.');
 const clipboardCopied=await clipboard(folder,spawnImpl).then(()=>true,()=>false);
 await launch(comet,['--new-window','chrome://extensions/'],spawnImpl);
 await launch(join(env.SystemRoot||'C:\\Windows','explorer.exe'),[folder],spawnImpl);
 return {extensionFolder:folder,clipboardCopied,message:clipboardCopied?'Открыты страница расширений Comet и нужная папка. Адрес папки скопирован.':'Открыты страница расширений Comet и нужная папка. Адрес папки показан ниже.'};
}
