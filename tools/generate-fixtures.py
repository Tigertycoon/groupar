"""Generate original synthetic test media; these are not an AR tracking benchmark.

Python standard library + ffmpeg. Run from any working directory.
"""
from pathlib import Path
import hashlib,json,random,struct,subprocess,zlib
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[1]
FIXTURES=ROOT/'Plattform/fixtures'
CDN=FIXTURES/'cdn-root'
def png(seed):
    rng=random.Random(seed); size=256
    colors=[tuple(rng.randrange(20,240) for _ in range(3)) for _ in range(256)]
    raw=bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            color=colors[(y//16)*16+x//16]
            raw.extend((255,255,255) if x%16==0 or y%16==0 else color)
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw),9))+chunk(b'IEND',b'')
manifest=json.loads((FIXTURES/'manifest-test-group-local.json').read_text())
for index,entry in enumerate(manifest['content']+[target['image'] for target in manifest['targets']]):
    is_video=entry.get('type')=='video'
    rel=Path(urlsplit(entry['url']).path.lstrip('/')).with_suffix('.mp4' if is_video else '.png')
    out=CDN/rel;out.parent.mkdir(parents=True,exist_ok=True)
    if is_video:
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=256x256:rate=12','-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(out)],check=True)
    else:out.write_bytes(png(5100+index))
    data=out.read_bytes();entry.update(url='http://localhost:8787/'+rel.as_posix(),contentType='video/mp4' if is_video else 'image/png',byteSize=len(data),sha256=hashlib.sha256(data).hexdigest())
    if 'metadata' in entry:entry['metadata'].pop('fixtureSourcePath',None)
    if 'width' in entry:entry.update(width=256,height=256)
for i,target in enumerate(manifest['targets']):
    target['title']=f'Synthetic pipeline target {i+1}'
    target['quality']={'status':'warning','score':0,'featureCount':0,'arcoreScore':0,'warnings':['synthetic_fixture_not_device_validated']}
manifest['generatedAt']='2026-09-28T00:00:00Z'
for name in ['manifest-test-group-local.json','manifest-test-group-v1.json']:
    (FIXTURES/name).write_text(json.dumps(manifest,indent=2)+'\n')
print('Generated 4 synthetic target images and 5 media fixtures; hashes and sizes refreshed.')
