import {createNspdService} from './nspd.mjs';
import {createMailService,emailPage,verificationPage} from './mail.mjs';
import http from 'node:http';import {DatabaseSync} from 'node:sqlite';import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';import path from 'node:path';import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';import {handleAPI,schema} from './service.mjs';
const root=path.resolve('.data');mkdirSync(root,{recursive:true});mkdirSync(path.join(root,'files'),{recursive:true});const db=new DatabaseSync(path.join(root,'workspace.sqlite'));db.exec(schema);db.exec('CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY, email TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);');
const mail=createMailService({db,root});
const nspd=createNspdService({db});
const DB = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() { return db.prepare(sql).get(...args) || null; },
          async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }
        };
      }
    };
  }
};
const BUCKET={async put(key,bytes){writeFileSync(path.join(root,'files',createHash('sha256').update(key).digest('hex')),bytes);},async get(key){const file=path.join(root,'files',createHash('sha256').update(key).digest('hex'));return existsSync(file)?{body:readFileSync(file)}:null;}};
function authPage(setup,message=''){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Земля · Вход</title><style>body{font:15px system-ui;background:#f1f5ee;color:#234b37;margin:0;display:grid;place-items:center;min-height:100vh}.card{width:min(370px,80vw);background:#fff;padding:35px;border-radius:18px;border:1px solid #dfe8d8;box-shadow:0 15px 60px #234b3710}h1{font-size:30px}p{font-size:13px;line-height:1.8;color:#809374}label{display:block;margin:17px 0;font-size:12px}input{display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #dce5d5;border-radius:8px;margin-top:7px;font:inherit}button{width:100%;padding:13px;background:#207653;color:white;border:0;border-radius:8px;font-weight:600}.err{color:#b36e38}</style></head><body><div class="card"><small>ЗЕМЛЯ · НАВИГАТОР</small><h1>${setup?'Твоё пространство':'С возвращением'}</h1><p>${setup?'Создай доступ к локальному кабинету. Данные будут храниться на этом компьютере.':'Войди, чтобы продолжить работу с участками.'}</p><p class="err">${message}</p><form method="POST" action="/auth/${setup?'setup':'login'}"><label>Электронная почта<input name="email" type="email" required maxlength="200" autocomplete="username"></label><label>Пароль<input name="password" type="password" minlength="12" maxlength="200" required autocomplete="${setup?'new-password':'current-password'}"></label><button>${setup?'Создать кабинет':'Войти'}</button></form><p>Пароль — от 12 символов. Восстановление по почте в локальной версии не подключено; сохрани пароль.</p></div></body></html>`;}
const attempts=new Map();const port=Number(process.env.PORT||8787);http.createServer(async(req,res)=>{try{const origin=`http://127.0.0.1:${port}`,url=new URL(req.url,origin),account=db.prepare('SELECT * FROM account WHERE id = 1').get();let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>18*1024*1024){res.writeHead(413);res.end('File too large');return;}chunks.push(chunk);}const body=Buffer.concat(chunks);if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==origin&&req.headers.origin!==`http://localhost:${port}`){res.writeHead(403);res.end('Invalid origin');return;}

 const html=(content,status=200)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});res.end(content);};
 if(url.pathname==='/account/verify'){
   if(req.method==='GET'){const token=url.searchParams.get('token')||'';const valid=mail.valid(token);html(verificationPage(token,valid),valid?200:400);return;}
   if(req.method==='POST'){
     if(!req.headers.origin){res.writeHead(403);res.end('Origin required');return;}
     const token=new URLSearchParams(body.toString()).get('token')||'';
     try{mail.confirm(token);html(verificationPage('',false,'Адрес электронной почты подтверждён. Можно вернуться в кабинет.'));}catch{html(verificationPage('',false),400);}return;
   }
   res.writeHead(405);res.end();return;
 }
 const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));const sid=cookies.zn_session;const session=sid?db.prepare('SELECT * FROM sessions WHERE id = ? AND expires > ?').get(createHash('sha256').update(sid).digest('hex'),Date.now()):null;
 if(url.pathname.startsWith('/auth/')&&req.method==='POST'){const key=req.socket.remoteAddress,now=Date.now();const a=attempts.get(key)||{count:0,start:now};if(now-a.start>900000){a.count=0;a.start=now;}a.count++;attempts.set(key,a);if(a.count>15){res.writeHead(429);res.end('Too many attempts. Try again in 15 minutes.');return;}const form=new URLSearchParams(body.toString()),email=(form.get('email')||'').trim().toLowerCase(),password=form.get('password')||'';let ok=false;if(url.pathname==='/auth/setup'&&!account&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&password.length>=12&&password.length<=200){const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');db.prepare('INSERT INTO account (id,email,salt,hash) VALUES (1,?,?,?)').run(email,salt,hash);ok=true;}else if(url.pathname==='/auth/login'&&account&&email===account.email&&password.length<=200){ok=timingSafeEqual(scryptSync(password,account.salt,64),Buffer.from(account.hash,'hex'));}if(!ok){res.writeHead(400,{'content-type':'text/html; charset=utf-8'});res.end(authPage(!account,'Проверь почту и пароль. Минимум 12 символов.'));return;}if(url.pathname==='/auth/setup'&&mail.status().configured){try{await mail.sendVerification(origin);}catch{console.warn('Подтверждение почты не отправлено. Проверь настройки отправки в кабинете.');}}const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions (id,expires) VALUES (?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+30*86400000);res.writeHead(303,{'location':'/','set-cookie':`zn_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`});res.end();return;}
 if(url.pathname==='/signout-with-chatgpt'){if(sid)db.prepare('DELETE FROM sessions WHERE id = ?').run(createHash('sha256').update(sid).digest('hex'));res.writeHead(303,{'location':'/','set-cookie':'zn_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'});res.end();return;}
 if(!session){if(url.pathname.startsWith('/api/')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:'Войди в локальный кабинет'}));}else{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(authPage(!account));}return;}


 if(url.pathname.startsWith('/api/nspd/')){
  if(req.method!=='GET'&&(!req.headers.origin||(req.headers.origin!==origin&&req.headers.origin!==`http://localhost:${port}`))){res.writeHead(403);res.end(JSON.stringify({error:'Недопустимый источник запроса'}));return;}
  try{
   let result;
   if(url.pathname==='/api/nspd/overview'&&req.method==='GET')result=nspd.overview();
   else if(url.pathname==='/api/nspd/scan'&&req.method==='GET')result=nspd.scanner.status();
   else if(url.pathname==='/api/nspd/scan/results'&&req.method==='GET')result=nspd.scanner.results({id:url.searchParams.get('id')||undefined,status:url.searchParams.get('status')||'all',offset:url.searchParams.get('offset'),limit:url.searchParams.get('limit')||100});
   else if(url.pathname==='/api/nspd/scan/export'&&req.method==='GET')result=nspd.scanner.exportResult(url.searchParams.get('id')||undefined);
   else if(url.pathname==='/api/nspd/scan/start'&&req.method==='POST')result=nspd.scanner.start();
   else if(url.pathname==='/api/nspd/scan/pause'&&req.method==='POST')result=nspd.scanner.pause();
   else if(url.pathname==='/api/nspd/scan/resume'&&req.method==='POST')result=nspd.scanner.resume();
   else if(url.pathname==='/api/nspd/scan/finish'&&req.method==='POST')result=nspd.scanner.finish();
   else if(url.pathname==='/api/nspd/objects'&&req.method==='GET')result=nspd.objects(String(url.searchParams.get('layer')||''));
   else if(url.pathname==='/api/nspd/probe'&&req.method==='POST'){await nspd.probe();result=nspd.overview();}
   else if(url.pathname==='/api/nspd/boundary'&&req.method==='POST'){await nspd.findBoundary();result=nspd.overview();}
   else if(url.pathname==='/api/nspd/territory'&&req.method==='POST'){const input=JSON.parse(body.toString());nspd.selectTerritory(String(input.id),String(input.version));result=nspd.overview();}
   else if(url.pathname==='/api/nspd/layer'&&req.method==='POST'){const input=JSON.parse(body.toString());await nspd.layer(String(input.id));result=nspd.overview();}
   else {res.writeHead(404);res.end(JSON.stringify({error:'Не найдено'}));return;}
   res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(result));
  }catch(e){res.writeHead(400,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({error:e.message}));}
  return;
 }
 if(url.pathname==='/account/email'&&req.method==='GET'){html(emailPage(mail.status()));return;}
 if(url.pathname.startsWith('/account/email/')&&req.method==='POST'){
   if(!req.headers.origin){res.writeHead(403);res.end('Origin required');return;}
   try{
     const form=new URLSearchParams(body.toString());
     if(url.pathname==='/account/email/settings'){
       await mail.configure(form.get('sender'),form.get('appPassword'));
       html(emailPage(mail.status(),'Подключение проверено и сохранено. Теперь нажми «Отправить письмо подтверждения».'));
     }else if(url.pathname==='/account/email/send'){
       await mail.sendVerification(origin);
       html(emailPage(mail.status(),'Mail.ru принял письмо для отправки. Проверь почту и папку «Спам». Ссылка действует 24 часа.'));
     }else{res.writeHead(404);res.end();}
   }catch(e){html(emailPage(mail.status(),e.message,true),400);}
   return;
 }
 if(url.pathname.startsWith('/api/')){const headers=new Headers(req.headers);if(headers.get('origin')===`http://localhost:${port}`)headers.set('origin',origin);const request=new Request(url,{method:req.method,headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body}: {})});const response=await handleAPI(request,{DB,BUCKET,LAND_PROVIDER_URL:process.env.LAND_PROVIDER_URL,LAND_PROVIDER_TOKEN:process.env.LAND_PROVIDER_TOKEN},{id:'local-owner',email:account.email,auth:'password'});if(url.pathname==='/api/bootstrap'&&response.ok){const result=await response.json();result.user.emailVerifiedAt=mail.status().verifiedAt;result.user.mailConfigured=mail.status().configured;res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(result));return;}res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
 const pathname=decodeURIComponent(url.pathname);let file=path.resolve('dist/client','.'+pathname);const base=path.resolve('dist/client');if(!file.startsWith(base+path.sep)&&file!==base){res.writeHead(403);res.end();return;}if(!path.extname(file))file=path.join(base,'index.html');if(!existsSync(file)){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Файл приложения не найден. Выполни npm run build в папке программы.');return;}const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.mjs':'text/javascript','.png':'image/png','.svg':'image/svg+xml'};const assetBody=readFileSync(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(assetBody);}catch(e){res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});res.end('Ошибка локального сервера. Проверь установку и сборку.');console.error(e.message);}}).listen(port,'127.0.0.1',()=>console.log(`Земля · Навигатор: http://127.0.0.1:${port}\nПервый вход: создай кабинет в браузере. Данные: .data/\nДля остановки: Ctrl+C`));
