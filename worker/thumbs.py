"""Gera miniaturas das fotos dos tecnicos e guarda-as no KV do Worker.
Correr de vez em quando (ex: quando entra gente nova):  python thumbs.py <PIN>
"""
import io, json, subprocess, sys, tempfile, base64, urllib.request
from PIL import Image, ImageOps

API = 'https://video-team.avkvideoshare.workers.dev'
pin = sys.argv[1]
api = sys.argv[2] if len(sys.argv) > 2 else API

def get(path):
    req = urllib.request.Request(api + path, headers={'X-PIN': pin})
    return urllib.request.urlopen(req, timeout=120).read()

ids = json.loads(get('/api/fotos'))
print(len(ids), 'fotos')
items = []
for i, fid in enumerate(ids, 1):
    try:
        im = Image.open(io.BytesIO(get(f'/foto/{fid}?orig=1')))
        im = ImageOps.exif_transpose(im).convert('RGB')
        im = ImageOps.fit(im, (112, 112), Image.LANCZOS, centering=(0.5, 0.35))
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=78, optimize=True)
        items.append({'key': f't:{fid}', 'value': base64.b64encode(buf.getvalue()).decode(), 'base64': True})
        print(f'\r{i}/{len(ids)}', end='')
    except Exception as e:
        print(f'\n{fid}: {e}')
print()
with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
    json.dump(items, f)
subprocess.run(['npx', 'wrangler', 'kv', 'bulk', 'put', f.name, '--binding', 'FOTOS', '--remote'], check=True, shell=True)
print('miniaturas no KV:', len(items))
