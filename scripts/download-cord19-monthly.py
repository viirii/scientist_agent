"""Download verified official monthly metadata, preserving source-object timestamps."""
import concurrent.futures,json,pathlib,urllib.request,email.utils,time
root=pathlib.Path('data/cord19');sources=json.loads((root/'monthly-source-probe.json').read_text())
def download(source):
    spec=source['metadata.csv'];dest=root/('metadata-'+source['release']+'.csv');size=int(spec['bytes'])
    if dest.exists() and dest.stat().st_size==size:return {'release':source['release'],'status':'already_downloaded','bytes':size}
    partial=dest.with_suffix('.csv.part');offset=partial.stat().st_size if partial.exists() else 0
    request=urllib.request.Request(spec['url'],headers={'Range':'bytes='+str(offset)+'-'} if offset else {})
    with urllib.request.urlopen(request,timeout=90) as response:
        if response.headers.get('Last-Modified')!=spec['lastModified']:raise ValueError('Source timestamp changed')
        mode='ab' if response.status==206 else 'wb'
        with partial.open(mode) as output:
            while True:
                block=response.read(1024*1024)
                if not block:break
                output.write(block)
    if partial.stat().st_size!=size:raise ValueError('Incomplete metadata download')
    partial.replace(dest);return {'release':source['release'],'status':'downloaded','bytes':size}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for result in pool.map(download,sources):print(json.dumps(result),flush=True)
