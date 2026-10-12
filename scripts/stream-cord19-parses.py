"""Stream trusted-format JSON records without extracting archive paths to disk."""
import hashlib,json,sys,tarfile

def emit(stream,name,size):
    if size>8_000_000:
        print(json.dumps({'member':name,'error':'parse_exceeds_8mb'}),flush=True);return
    raw=stream.read()
    try:
        parsed=json.loads(raw)
        if not isinstance(parsed,dict) or not isinstance(parsed.get('body_text'),list):raise ValueError()
        print(json.dumps({'member':name,'raw_hash':hashlib.sha256(raw).hexdigest(),'parsed':parsed},ensure_ascii=True,separators=(',',':')),flush=True)
    except (ValueError,UnicodeError):print(json.dumps({'member':name,'error':'invalid_parse'}),flush=True)

with tarfile.open(sys.argv[1],'r|*') as outer:
    for member in outer:
        if not member.isfile():continue
        if member.name.endswith('.json'):emit(outer.extractfile(member),member.name,member.size)
        elif member.name.endswith('.tar.gz'):
            with tarfile.open(fileobj=outer.extractfile(member),mode='r|*') as inner:
                for entry in inner:
                    if entry.isfile() and entry.name.endswith('.json'):emit(inner.extractfile(entry),member.name+'!'+entry.name,entry.size)
