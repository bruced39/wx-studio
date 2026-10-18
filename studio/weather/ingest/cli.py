"""Download/convert NOAA original files to WXData-compatible PNG frame manifests.

Run this OFF the Streamlit process on a bounded local/server worker.
An explicit --input can decode a downloaded file without any network calls.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import re
import shutil
import tempfile
from urllib.request import Request, urlopen

try:
    from . import discovery, processors
except ImportError:  # running python cli.py from the directory
    import discovery  # type: ignore
    import processors  # type: ignore

MRMS_URL = discovery.MRMS_LATEST_REFLECTIVITY
S3_HOSTS = set(discovery.GOES_BUCKETS.values()) | {discovery.NEXRAD_BUCKET}
GOES_DIR = {"conus":"ABI-L2-CMIPC","full":"ABI-L2-CMIPF",
            "meso1":"ABI-L2-CMIPM","meso2":"ABI-L2-CMIPM"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def select_latest(source: str, *, satellite="east", sector="conus",
                  band="C02", site="KBOX", now=None) -> str:
    """Select real source object by S3 keys; never guess a filename."""
    now = (now or _utcnow()).astimezone(timezone.utc)
    if source=="mrms":
        return MRMS_URL
    if source=="goes":
        if satellite not in discovery.GOES_BUCKETS or sector not in GOES_DIR:
            raise ValueError("Use GOES east/west and conus/full/meso1/meso2")
        if band not in ("C02","C13"):
            raise ValueError("Only C02 and C13 are decoded by this worker")
        bucket=discovery.GOES_BUCKETS[satellite]
        prefix=GOES_DIR[sector]
        meso=1 if sector=="meso1" else 2 if sector=="meso2" else None
        keys=[]
        for hours_back in range(4):
            current=now-timedelta(hours=hours_back)
            keys+=discovery.goes_keys(satellite,prefix,current,mesoscale=meso)
        # CMIP* object names contain -M6C02_ or -M6C13_; don't mistake
        # the channel for the product directory or for metadata filenames.
        keys=[k for k in keys if re.search(r"M\dC"+band[-2:]+r"_",k.rsplit("/",1)[-1])]
        if not keys:raise FileNotFoundError("No GOES "+band+" source files in last four UTC hours")
        return f"https://{bucket}.s3.amazonaws.com/{max(keys)}"
    if source=="nexrad":
        site=site.upper()
        if not re.fullmatch(r"K[A-Z0-9]{3}",site) or site=="KBOS":
            raise ValueError("Use actual NEXRAD station ID e.g. KBOX, not airport KBOS")
        keys=[]
        for hours_back in range(3):
            current=now-timedelta(hours=hours_back)
            keys+=discovery.nexrad_volume_keys(site,current)
        keys=[k for k in keys if re.search(r"_V0[3467](?:\.gz)?$",k) and "MDM" not in k]
        if not keys:raise FileNotFoundError("No recent NEXRAD Level-II volume for "+site)
        return f"https://{discovery.NEXRAD_BUCKET}.s3.amazonaws.com/{max(keys)}"
    raise ValueError("Unknown source; choose goes, mrms or nexrad")


def download(url: str, dest: Path, *, max_bytes=650_000_000) -> None:
    from urllib.parse import urlparse
    parsed=urlparse(url)
    allowed_hosts={b+".s3.amazonaws.com" for b in S3_HOSTS}|{"mrms.ncep.noaa.gov"}
    if parsed.scheme!="https" or parsed.hostname not in allowed_hosts:
        raise ValueError("Refusing URL outside allowlisted NOAA/Unidata sources")
    req=Request(url,headers={"User-Agent":"WXStudio-WeatherWorker/1.0"})
    with urlopen(req,timeout=40) as response, open(dest,"wb") as output:
        count=0
        while True:
            part=response.read(1024*1024)
            if not part:break
            count+=len(part)
            if count>max_bytes:
                raise ValueError("Source file exceeds configured download-size budget")
            output.write(part)
    if dest.stat().st_size<100:
        raise ValueError("Downloaded file is suspiciously small")


def convert(args) -> dict:
    source=args.source
    bbox=tuple(float(v) for v in args.bbox.split(","))
    if len(bbox)!=4:
        raise ValueError("Use --bbox=west,south,east,north")
    out=Path(args.output).resolve()
    product=(source+"-"+args.satellite+"-"+args.sector+"-"+args.band
             if source=="goes" else source+("-"+args.moment+"-"+args.site if source=="nexrad" else "-reflectivity"))
    dest=out/product
    dest.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wxstudio-noaa-") as tmp:
        original=Path(args.input) if args.input else None
        if original is None:
            url=select_latest(source,satellite=args.satellite,sector=args.sector,
                              band=args.band,site=args.site)
            original=Path(tmp)/("download"+(".nc" if source=="goes" else ".grib2.gz" if source=="mrms" else ".ar2v"))
            download(url,original,max_bytes=args.max_download_mb*1_000_000)
        if not original.is_file():
            raise FileNotFoundError(original)
        if source=="mrms" and original.suffix==".gz":
            unpacked=Path(tmp)/"MRMS.grib2"
            with gzip.open(original,"rb") as compressed,open(unpacked,"wb") as raw:
                shutil.copyfileobj(compressed,raw)
            original=unpacked
        if source=="goes":
            frame=processors.decode_goes(original,bbox,band=args.band,max_pixels=args.max_pixels)
        elif source=="mrms":
            frame=processors.decode_mrms(original,bbox,max_pixels=args.max_pixels)
        else:
            frame=processors.decode_level2(original,bbox,moment=args.moment,max_pixels=args.max_pixels)
    # A stale NOAA mirror or an old S3 object is NOT "live". For a local
    # previously-downloaded --input, the operator intentionally bypasses this
    # freshness gate so archival decoding can still be tested.
    if not args.input:
        age=(_utcnow()-frame.timestamp).total_seconds()/60.0
        limit=float(getattr(args,"max_age_minutes",90))
        if age>limit or age< -10:
            raise ValueError(f"NOAA observation is {age:.0f} minutes old; refusing to publish it as fresh (maximum {limit:.0f} min)")
    # Timestamp from NOAA file payload, NOT downloader clock or fake frames.
    epoch_ms=int(frame.timestamp.timestamp()*1000)
    filename=f"{epoch_ms}.png"
    frame.save(dest/"frames"/filename)
    entry={"t":epoch_ms,"bbox":list(frame.bbox),"crs":"4326",
           "url":"frames/"+filename}
    manifest=dest/"manifest.json"
    old={"frames":[]}
    if manifest.exists():
        old=json.loads(manifest.read_text(encoding="utf8"))
    prev=[x for x in old.get("frames",[]) if isinstance(x,dict) and x.get("t")!=epoch_ms
          and (dest/x.get("url","")).is_file()]
    frames=sorted([*prev,entry],key=lambda x:x["t"])[-max(1,args.keep):]
    meta={"schema":"wxstudio.frames.v1","source":source,"product":product,
          "nativeResolutionMetres":frame.native_resolution_m,"frames":frames,
          "attribution":"NOAA/Unidata open source observations; processed by WX Studio",
          "generatedUtc":_utcnow().isoformat()}
    pending=manifest.with_suffix(".json.tmp")
    pending.write_text(json.dumps(meta,indent=2),encoding="utf8")
    pending.replace(manifest)
    keep={x["url"] for x in frames}
    for png in (dest/"frames").glob("*.png"):
        if "frames/"+png.name not in keep:png.unlink()
    return {"manifest":str(manifest),"frame":str(dest/"frames"/filename),
            "utc":frame.timestamp.isoformat(),"pixelDimensions":list(frame.pixels.shape[:2][::-1]),
            "nativeResolutionMetres":frame.native_resolution_m}


def serve(root: str,port:int=8788) -> None:
    """Standalone local origin. To serve cloud users, deploy independently
    over HTTPS and configure CORS, TLS and bounded frame-cache retention.
    """
    from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
    from functools import partial
    class Handler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header("Access-Control-Allow-Origin","*")
            self.send_header("Cache-Control","no-store")
            super().end_headers()
    server=ThreadingHTTPServer(("127.0.0.1",port),partial(Handler,directory=str(Path(root).resolve())))
    print(f"Serving frames at http://127.0.0.1:{port}/ — local only")
    server.serve_forever()


def main(argv=None) -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    cmd=parser.add_subparsers(dest="action",required=True)
    p=cmd.add_parser("convert",help="Fetch or load ONE ORIGINAL NOAA file and render a geo frame")
    p.add_argument("--source",required=True,choices=("goes","mrms","nexrad"))
    p.add_argument("--input",help="Existing raw source file (no download)")
    p.add_argument("--bbox",required=True,help='e.g. "--bbox=-75,39,-68,45"')
    p.add_argument("--output",default="wx_weather_output")
    p.add_argument("--satellite",choices=("east","west"),default="east")
    p.add_argument("--sector",choices=tuple(GOES_DIR),default="conus")
    p.add_argument("--band",choices=("C02","C13"),default="C02")
    p.add_argument("--site",default="KBOX")
    p.add_argument("--moment",choices=("reflectivity","velocity"),default="reflectivity")
    p.add_argument("--keep",type=int,default=48,help="maximum cached frames for this product")
    p.add_argument("--max-pixels",type=int,default=12_000_000)
    p.add_argument("--max-download-mb",type=int,default=650)
    p.add_argument("--max-age-minutes",type=int,default=90,
                   help="refuse stale downloaded source observations; --input bypasses")
    sv=cmd.add_parser("serve",help="Serve generated PNG and manifests from a local HTTP origin")
    sv.add_argument("--root",default="wx_weather_output")
    sv.add_argument("--port",type=int,default=8788)
    a=parser.parse_args(argv)
    if a.action=="serve":
        serve(a.root,a.port)
    else:
        print(json.dumps(convert(a),indent=2))
    return 0


if __name__=="__main__":
    raise SystemExit(main())
