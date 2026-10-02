"""Linux x86_64, real Claude default-install proof. No model turns or sign-in.
Usage: python3 tools/test/claude-offline-install.py RUNTIME.zip RECEIPT.json
Each run uses private fresh client settings and denies IPv4/IPv6 sockets across
all children. The npm trap detects attempted installs even if Claude ignores
failure. A local-directory source is deliberate; HTTPS archive publication
must be qualified separately against the final public asset.
"""
from pathlib import Path
import ctypes,errno,hashlib,json,os,platform,shlex,shutil,subprocess,sys,tempfile,threading,time,zipfile
archive=Path(sys.argv[1]);out=Path(sys.argv[2]);w=Path(tempfile.mkdtemp(prefix='claude-no-install-',))
assert platform.machine()=='x86_64'
class Filter(ctypes.Structure):_fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint)]
class Program(ctypes.Structure):_fields_=[('len',ctypes.c_ushort),('filter',ctypes.POINTER(Filter))]
def no_ip_sockets():
 # Seccomp is inherited across exec/fork. Refuse IPv4/IPv6 socket creation.
 rows=[(0x20,0,0,4),(0x15,1,0,0xc000003e),(0x06,0,0,0x80000000),(0x20,0,0,0),(0x35,0,1,0x40000000),(0x06,0,0,0x50000|errno.ENETUNREACH),(0x15,0,4,41),(0x20,0,0,16),(0x15,1,0,2),(0x15,0,1,10),(0x06,0,0,0x50000|errno.ENETUNREACH),(0x06,0,0,0x7fff0000)]
 filters=(Filter*len(rows))(*(Filter(*row) for row in rows));prog=Program(len(rows),filters);libc=ctypes.CDLL(None,use_errno=True)
 if libc.prctl(38,1,0,0,0) or libc.prctl(22,2,ctypes.byref(prog),0,0):os._exit(125)
market=w/'market';plugin=market/'plugins/toolsenabled-bench';plugin.mkdir(parents=True)
with zipfile.ZipFile(archive) as z:
 prefix=z.namelist()[0].split('/',1)[0]+'/'
 assert len(z.namelist())==len(set(z.namelist()))
 for info in z.infolist():
  assert info.filename.startswith(prefix) and '\\' not in info.filename and not any(p in ('..', '.') for p in info.filename.split('/'))
  assert (info.external_attr >> 16) & 0o170000 != 0o120000
  name=info.filename.split('/',1)[1];p=plugin/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(info))
mp=market/'.claude-plugin/marketplace.json';mp.parent.mkdir(parents=True);mp.write_text(json.dumps({'name':'bench-offline-review','description':'Local review fixture for the exact unpublished Bench runtime.','owner':{'name':'ToolsEnabled, Inc.'},'plugins':[{'name':'toolsenabled-bench','source':'./plugins/toolsenabled-bench'}]}))
for name in ['project','config','shim']:(w/name).mkdir()
marker=w/'npm-invoked';shim=w/'shim/npm';shim.write_text('#!/bin/sh\nprintf "npm invoked\\n" >> '+shlex.quote(str(marker))+'\nexit 86\n');shim.chmod(0o755)
env={'PATH':str(w/'shim')+os.pathsep+os.environ['PATH'],'LANG':'C.UTF-8','CLAUDE_CONFIG_DIR':str(w/'config'),'CLAUDE_CODE_PLUGIN_CACHE_DIR':str(w/'cache'),'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1','ENABLE_CLAUDEAI_MCP_SERVERS':'false'}
assert not any(key.lower().startswith('npm_config') for key in env)
commands=[];record={'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'work':str(w),'allowedEnvironmentNames':sorted(env),'networkPolicy':'Inherited Linux seccomp denies IPv4 and IPv6 socket creation; unsupported ABI also refused. No npm_config variables.','modelTurns':0}
def save():out.write_text(json.dumps(record,indent=2)+'\n')
def run(args):
 p=subprocess.run(args,cwd=w/'project',env=env,preexec_fn=no_ip_sockets,capture_output=True,text=True,timeout=100)
 row={'argv':args,'exitCode':p.returncode,'stdout':p.stdout,'stderr':p.stderr};commands.append(row);record['commands']=commands;save();return p
try:
 check=run(['/usr/bin/python3','-c','import socket,errno\nfor family in [socket.AF_INET,socket.AF_INET6]:\n try: socket.socket(family)\n except OSError as e: assert e.errno==errno.ENETUNREACH\n else: raise AssertionError("network allowed")\nprint("IPv4/IPv6 sockets blocked")']);assert check.returncode==0
 for args in [['claude','--version'],['claude','plugin','validate','--strict','--json',str(market)],['claude','plugin','marketplace','add',str(market)]]:
  result=run(args);assert result.returncode==0,(args,result.stdout,result.stderr)
 installed=run(['claude','plugin','install','toolsenabled-bench@bench-offline-review','-s','local','--config','data_directory='+str(w/'private state')])
 record['npmInvoked']=marker.exists();record['nodeModulesPaths']=[str(p.relative_to(w)) for base in [market,w/'cache'] for p in base.rglob('node_modules')]
 save();assert not marker.exists(),'default plugin installation invoked npm';assert not record['nodeModulesPaths'],'installation created node_modules';assert installed.returncode==0,installed.stderr
 result=run(['claude','mcp','list']);assert result.returncode==0 and 'Connected' in result.stdout
 # Bind the path actually launched by the client, not merely its cache copy.
 lines=result.stdout.splitlines();line=next(line for line in lines if 'plugin:toolsenabled-bench:bench' in line);assert line.startswith('plugin:toolsenabled-bench:bench: node '+str(plugin/'server/mcp-plugin.mjs')+' - '),line
 with zipfile.ZipFile(archive) as z:
  for info in z.infolist():assert (plugin/info.filename.split('/',1)[1]).read_bytes()==z.read(info)
 record.update(status='PASS',executedRoot=str(plugin),executedFilesVerified=len(z.infolist()),sourceKind='local-directory proof; HTTPS archive installation remains a published-asset gate')
except BaseException as e:
 record.update(status='FAIL',error=str(e));raise
finally:save()
print('Default Claude install and actual executed payload PASS: no npm invocation, no node_modules, IP network disabled.')
