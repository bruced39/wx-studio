"""Checks that a single hosted container really starts both native processes.

No NOAA requests; these tests exercise config safety, startup, failure
propagation and child cleanup, not claim that NOAA data is already live.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from weather_processor import single_host

ROOT = Path(__file__).resolve().parents[1]


def test_one_host_launches_source_native_worker_and_readonly_api():
    cfg = single_host.settings({
        "PORT": "8765",
        "WX_PROCESSOR_INTERVAL_SECONDS": "120",
        "WX_PROCESSOR_DATA_DIR": "/data/frames",
        "WX_PROCESSOR_PRODUCTS": (
            "mrms-reflectivity,goes-east-conus-C02,"
            "nexrad-reflectivity-KBOX"
        ),
    })
    worker, api = single_host.commands(cfg)
    assert worker[:3] == [single_host.sys.executable, "-m", "weather_processor.ingest"]
    assert worker[3:5] == ["--interval", "120"]
    assert worker[-2:] == ["--products", cfg["products"]]
    assert api[:3] == [single_host.sys.executable, "-m", "uvicorn"]
    assert "weather_processor.service:APP" in api
    assert api[api.index("--port") + 1] == "8765"
    assert cfg["env"]["WX_PROCESSOR_DATA_DIR"] == "/data/frames"


@pytest.mark.parametrize("config", [
    {"PORT": "0"},
    {"PORT": "not-a-port"},
    {"WX_PROCESSOR_INTERVAL_SECONDS": "1"},
    {"WX_PROCESSOR_INTERVAL_SECONDS": "99999"},
    {"WX_PROCESSOR_DATA_DIR": "../etc"},
    {"WX_PROCESSOR_DATA_DIR": "/data/../secrets"},
    {"WX_PROCESSOR_PRODUCTS": "goes-east-conus-C02;rm -rf /"},
])
def test_unsafe_startup_values_are_rejected(config):
    with pytest.raises(ValueError):
        single_host.settings(config)


class Stub:
    def __init__(self, status=None):
        self.status = status
        self.terminated = False
        self.waited = False
        self.killed = False

    def poll(self):
        return self.status

    def terminate(self):
        self.terminated = True
        self.status = -15

    def kill(self):
        self.killed = True
        self.status = -9

    def wait(self, timeout=None):
        self.waited = True
        return self.status


def test_worker_crash_stops_api_instead_of_showing_stale_frames():
    api, worker = Stub(None), Stub(9)
    started = []
    def spawn(args, env):
        started.append((args, env))
        return [api, worker][len(started) - 1]

    code = single_host.run({"PORT": "8080"},
                           spawn=spawn, sleep=lambda _: None,
                           install_signals=False)
    assert code == 9
    assert len(started) == 2
    assert api.terminated and api.waited
    assert worker.waited and not worker.terminated
    assert not api.killed


def test_api_crash_also_stops_native_worker():
    api, worker = Stub(3), Stub(None)
    launched = []
    def spawn(args, env):
        launched.append(args)
        return [api, worker][len(launched) - 1]

    assert single_host.run({"PORT": "8080"}, spawn=spawn,
                           sleep=lambda _: None, install_signals=False) == 3
    assert worker.terminated and worker.waited


def test_single_host_docker_and_compose_do_not_start_duplicate_workers():
    docker = (ROOT / "weather_processor" / "Dockerfile").read_text()
    compose = (ROOT / "weather_processor" / "docker-compose.yml").read_text()
    assert 'CMD ["python", "-m", "weather_processor.single_host"]' in docker
    assert 'weather_processor.service:APP' in compose
    assert "python" in compose and "weather_processor.ingest" in compose
