"""Extract JSON members only; do not trust or unpack archive paths onto disk."""
import hashlib, json, pathlib, sys, tarfile
archive=pathlib.Path(sys.argv[1]); destination=pathlib.Path(sys.argv[2]); destination.mkdir(parents=True,exist_ok=True)
hash_value=hashlib.sha256()
with archive.open('rb') as stream:
    for block in iter(lambda:stream.read(1024*1024),b''): hash_value.update(block)
index={}
with tarfile.open(archive,'r:*') as outer:
    for member in outer:
        if not member.isfile() or not member.name.endswith('.tar.gz'): continue
        with tarfile.open(fileobj=outer.extractfile(member),mode='r|*') as inner:
            for entry in inner:
                if not entry.isfile() or not entry.name.endswith('.json'):continue
                if entry.size>8_000_000: raise ValueError('Parse exceeds size limit')
                raw=inner.extractfile(entry).read(); parsed=json.loads(raw); identifier=parsed.get('paper_id','')
                if len(identifier)!=40 or any(c not in '0123456789abcdef' for c in identifier):raise ValueError('Invalid parse identity')
                digest=hashlib.sha256(raw).hexdigest()
                if identifier in index and index[identifier]['sha256']!=digest:raise ValueError('Conflicting parse identity')
                (destination/(identifier+'.json')).write_bytes(raw)
                index[identifier]={'sha256':digest,'member':member.name+'!'+entry.name}
(destination/'archive-index.json').write_text(json.dumps({'archive_sha256':hash_value.hexdigest(),'parses':index},sort_keys=True))
print('Extracted',len(index),'historical parses')
