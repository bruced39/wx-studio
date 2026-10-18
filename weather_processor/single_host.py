"""Single-host production entrypoint for WX Studio's native NOAA processor.

Runs the REAL NOAA scientific ingest worker and the existing read-only FastAPI
service against ONE shared frame directory, so a single Docker deployment can
serve fresh NetCDF/GRIB2/Level-II frames without cross-container disk sharing.
No synthetic data, API secrets or lower-resolution fallback is involved.

    python -m weather_processor.single_host

For larger installations keep using docker-compose.yml's separate processes.
"""
from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable, Mapping

LOG = logging.getLogger("wxstudio.noaa.host")


def settings(environ: Mapping[str, str] | None = None) -> dict:
    env = dict(os.environ if environ is None else environ)
    raw_port = env.get("PORT", "8080")
    raw_interval = env.get("WX_PROCESSOR_INTERVAL_SECONDS", "120")
    try:
        port, interval = int(raw_port), int(raw_interval)
    except ValueError as e:
        raise ValueError("PORT and WX_PROCESSOR_INTERVAL_SECONDS must be integers") from e
    if not (1 <= port <= 65535):
        raise ValueError("PORT must be a valid TCP port")
    if not (60 <= interval <= 3600):
        raise ValueError("WX_PROCESSOR_INTERVAL_SECONDS must be 60–3600 seconds")
    root = env.get("WX_PROCESSOR_DATA_DIR", "/data/frames").strip()
    if not root.startswith("/") or ".." in root.split("/"):
        raise ValueError("WX_PROCESSOR_DATA_DIR must be an absolute directory")
    products = env.get("WX_PROCESSOR_PRODUCTS", "").strip()
    if products and (len(products) > 1000 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-," for c in products)):
        raise ValueError("WX_PROCESSOR_PRODUCTS contains invalid characters")
    env["WX_PROCESSOR_DATA_DIR"] = root
    return {"env": env, "port": port, "interval": interval, "products": products}


def commands(config: dict) -> tuple[list[str], list[str]]:
    # Only the EXISTING NOAA ingest product IDs are accepted by ingest.py.
    ingest = [sys.executable, "-m", "weather_processor.ingest",
              "--interval", str(config["interval"])]
    if config["products"]:
        ingest += ["--products", config["products"]]
    api = [sys.executable, "-m", "uvicorn", "weather_processor.service:APP",
           "--host", "0.0.0.0", "--port", str(config["port"]), "--proxy-headers"]
    return ingest, api


def run(environ: Mapping[str, str] | None = None,
        *, spawn: Callable | None = None,
        sleep: Callable[[float], None] | None = None,
        install_signals: bool = True) -> int:
    config = settings(environ)
    ingest_cmd, api_cmd = commands(config)
    launch = spawn or subprocess.Popen
    pause = sleep or time.sleep
    processes: list[tuple[str, subprocess.Popen]] = []
    stopping = False

    def request_stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    previous = {}
    if install_signals:
        for sig in (signal.SIGTERM, signal.SIGINT):
            previous[sig] = signal.getsignal(sig)
            signal.signal(sig, request_stop)
    try:
        # Start the API first so /health reports waiting for actual frames
        # during the first NOAA download. No fake "live" catalog is created.
        processes.append(("noaa-api", launch(api_cmd, env=config["env"])))
        processes.append(("noaa-worker", launch(ingest_cmd, env=config["env"])))
        LOG.info("NOAA processor started: real observations only; frames=%s", config["env"]["WX_PROCESSOR_DATA_DIR"])
        while not stopping:
            for name, child in processes:
                code = child.poll()
                if code is not None:
                    LOG.error("%s stopped unexpectedly (exit=%s). Stopping sibling so hosting can restart.", name, code)
                    return code or 1
            pause(1)
        return 0
    finally:
        # Both children share the same Docker volume. Never leave a worker
        # orphaned behind after an API restart or a cloud deploy.
        for name, child in reversed(processes):
            if child.poll() is None:
                try:
                    child.terminate()
                except ProcessLookupError:
                    pass
        for name, child in reversed(processes):
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    sys.exit(run())
