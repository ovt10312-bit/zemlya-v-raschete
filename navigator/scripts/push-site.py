"""One-shot Git credential transport through hidden stdin; never persists secrets."""
import sys,json,os,subprocess,base64,termios
if sys.stdin.isatty():
 attr=termios.tcgetattr(sys.stdin);attr[3]&=~termios.ECHO;termios.tcsetattr(sys.stdin,termios.TCSANOW,attr)
print('Ready for repository credential on stdin (input is hidden).',flush=True)
c=json.loads(sys.stdin.readline());token=c.get('token');url=c['remote_url'];branch=c.get('branch','main')
subprocess.run(['git','remote','remove','sites'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['git','remote','add','sites',url],check=True)
for mode in (['Bearer','Basic'] if token else ['proxy']):
 env=os.environ.copy();env['GIT_TERMINAL_PROMPT']='0'
 if token:
  header='Authorization: '+('Bearer '+token if mode=='Bearer' else 'Basic '+base64.b64encode(('x-access-token:'+token).encode()).decode())
  env.update(GIT_CONFIG_COUNT='1',GIT_CONFIG_KEY_0='http.extraHeader',GIT_CONFIG_VALUE_0=header)
 r=subprocess.run(['git','push','sites','HEAD:refs/heads/'+branch],env=env,capture_output=True,text=True)
 if r.returncode==0:
  print(json.dumps({'pushed':True,'commit_sha':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()}),flush=True);break
else:
 msg=r.stderr
 if token:msg=msg.replace(token,'[redacted]')
 print(json.dumps({'pushed':False,'error':msg[-1600:]}),flush=True);sys.exit(1)
