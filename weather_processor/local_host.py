"""Run the existing NOAA native decoders on one Windows PC, WITHOUT Docker.

The browser and this processor must be on the same computer. This local-only
entry point leaves the Linux/Docker supervisor unchanged and serves only on
127.0.0.1. No fake NOAA scans or paid host are involved.

Usage: python -m weather_processor.local_host --data-dir PATH
"""
from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

from .store import validate_product

LOG = logging.getLogger("wxstudio.noaa.local")
DEFAULT_PRODUCTS = "mrms-reflectivity,goes-east-conus-C02,nexrad-reflectivity-KBOX"


def configuration(*, port: int = 8080, interval: int = 120,
                  products: str = DEFAULT_PRODUCTS,
                  data_dir: str | Path | None = None) -> dict:
    """Validate all CLI inputs before launching any subprocess."""
    if not 1024 <= int(port) <= 65535:
        raise ValueError("Local port must be between 1024 and 65535")
    if not 60 <= int(interval) <= 3600:
        raise ValueError("Update interval must be 60–3600 seconds")
    ids = [part.strip() for part in products.split(",")]
    if not ids or any(not value for value in ids) or len(ids) > 30:
        raise ValueError("Supply 1–30 comma-separated NOAA product IDs")
    for value in ids:
        validate_product(value)
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate NOAA products")
    destination = Path(data_dir or Path.home() / "WXStudioNOAA" / "frames").expanduser().resolve()
    if not destination.is_absolute():
        raise ValueError("Frame directory must be absolute")
    return dict(port=int(port), interval=int(interval), products=",".join(ids), data_dir=destination)


def child_commands(cfg: dict) -> tuple[list[str], list[str]]:
    """Always bind only to loopback, not the Windows LAN or public internet."""
    api = [sys.executable, "-m", "uvicorn", "weather_processor.local_service:APP",
           "--host", "127.0.0.1", "--port", str(cfg["port"])]
    ingest = [sys.executable, "-m", "weather_processor.ingest", "--interval",
              str(cfg["interval"]), "--products", cfg["products"]]
    return api, ingest


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def run(*, cfg: dict, spawn=None, pause=None, check_port=True,
        register_signals=True) -> int:
    cfg["data_dir"].mkdir(parents=True, exist_ok=True)
    if check_port and not port_available(cfg["port"]):
        raise RuntimeError(f"Local port {cfg['port']} is already in use. Is NOAA running?")
    env = os.environ.copy()
    env["WX_PROCESSOR_DATA_DIR"] = str(cfg["data_dir"])
    env["PYTHONUNBUFFERED"] = "1"
    cmds = child_commands(cfg)
    launch = spawn or subprocess.Popen
    sleeper = pause or time.sleep
    repo_root = Path(__file__).resolve().parent.parent
    stop = False

    def request_stop(_sig, _frame):
        nonlocal stop
        stop = True

    original = {}
    if register_signals:
        for sig in (signal.SIGINT, signal.SIGTERM):
            original[sig] = signal.getsignal(sig)
            signal.signal(sig, request_stop)

    children = []
    try:
        for name, cmd in zip(("api", "ingest"), cmds):
            LOG.info("Starting local NOAA %s", name)
            children.append((name, launch(cmd, env=env, cwd=str(repo_root))))
        LOG.info("LOCAL ONLY: http://127.0.0.1:%s/health", cfg["port"])
        LOG.info("Only fresh, scientifically decoded NOAA products appear in /catalog.")
        while not stop:
            for name, child in children:
                code = child.poll()
                if code is not None:
                    LOG.error("NOAA %s stopped (exit %s); stopping sibling.", name, code)
                    return code or 1
            sleeper(1)
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        for _, child in reversed(children):
            if child.poll() is None:
                try:
                    child.terminate()
                except ProcessLookupError:
                    pass
        for _, child in reversed(children):
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        for sig, handler in original.items():
            signal.signal(sig, handler)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Free, no-Docker local NOAA processor")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--interval", type=int, default=120)
    ap.add_argument("--products", default=DEFAULT_PRODUCTS)
    ap.add_argument("--data-dir", required=True)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        return run(cfg=configuration(port=args.port, interval=args.interval,
                                     products=args.products, data_dir=args.data_dir))
    except (ValueError, RuntimeError, OSError) as exc:
        LOG.error("%s", exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
