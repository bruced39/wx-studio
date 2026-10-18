"""No-Docker native NOAA Windows launcher tests.

Tests don't download NOAA or install micromamba. They prove safe process
commands, product validation, crash handling and that packages remain isolated.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from weather_processor import local_host

ROOT = Path(__file__).resolve().parents[1]


def test_accepts_all_native_satellite_and_radar_product_types(tmp_path):
    ids = "mrms-reflectivity,goes-east-meso1-C02,goes-west-full-C13,nexrad-velocity-KBOX"
    cfg = local_host.configuration(port=8080, interval=120, products=ids, data_dir=tmp_path / "frames")
    assert cfg["products"] == ids
    assert cfg["data_dir"].is_absolute()
    api, worker = local_host.child_commands(cfg)
    assert api[0] == local_host.sys.executable
    assert api[api.index("--host") + 1] == "127.0.0.1"
    assert "--proxy-headers" not in api
    assert "weather_processor.local_service:APP" in api
    assert worker[:3] == [local_host.sys.executable, "-m", "weather_processor.ingest"]
    assert worker[worker.index("--products") + 1] == ids
    assert worker[worker.index("--interval") + 1] == "120"


@pytest.mark.parametrize("kwargs", [
    {"port": 0}, {"port": 80}, {"port": 99999}, {"interval": 10},
    {"interval": 4000}, {"products": ""}, {"products": "mrms-reflectivity,"},
    {"products": "mrms-reflectivity,mrms-reflectivity"},
    {"products": "demo"}, {"products": "goes-east-conus-C02;bad"},
    {"products": "nexrad-reflectivity-WXYZ"},
])
def test_invalid_or_non_native_product_configuration_rejected(kwargs, tmp_path):
    with pytest.raises(ValueError):
        local_host.configuration(data_dir=tmp_path, **kwargs)


class Stub:
    def __init__(self, status=None):
        self.status = status
        self.did_terminate = False
        self.did_wait = False

    def poll(self):
        return self.status

    def terminate(self):
        self.did_terminate = True
        self.status = -15

    def wait(self, timeout=None):
        self.did_wait = True
        return self.status

    def kill(self):
        self.status = -9


def test_native_worker_failure_stops_local_server(tmp_path):
    api, worker = Stub(), Stub(13)
    started = []

    def start(argv, env, cwd):
        assert argv[0] == local_host.sys.executable
        assert env["WX_PROCESSOR_DATA_DIR"] == str(tmp_path)
        assert cwd == str(ROOT)
        started.append(argv)
        return (api, worker)[len(started) - 1]

    cfg = local_host.configuration(data_dir=tmp_path)
    assert local_host.run(cfg=cfg, spawn=start, pause=lambda _: None,
                          check_port=False, register_signals=False) == 13
    assert len(started) == 2
    assert api.did_terminate and api.did_wait
    assert worker.did_wait


def test_ctrl_c_stops_both_worker_and_api(tmp_path):
    api, worker = Stub(), Stub()
    spawned = []
    def start(_argv, env, cwd):
        spawned.append(True)
        return [api, worker][len(spawned) - 1]
    cfg = local_host.configuration(data_dir=tmp_path)
    assert local_host.run(cfg=cfg, spawn=start,
        pause=lambda _sec: (_ for _ in ()).throw(KeyboardInterrupt()),
        check_port=False, register_signals=False) == 0
    assert api.did_terminate and api.did_wait
    assert worker.did_terminate and worker.did_wait


def test_no_port_collision_no_worker_spawn(tmp_path, monkeypatch):
    monkeypatch.setattr(local_host, "port_available", lambda port: False)
    with pytest.raises(RuntimeError, match="already in use"):
        local_host.run(cfg=local_host.configuration(data_dir=tmp_path),
                       spawn=lambda **kwargs: pytest.fail("must not start"),
                       register_signals=False)


def test_official_installer_and_native_windows_science_dependencies():
    ps = (ROOT / "weather_processor" / "start_no_docker_windows.ps1").read_text()
    env = (ROOT / "weather_processor" / "environment-windows.yaml").read_text()
    assert "github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64" in ps
    assert "-InstallMicromamba" in ps
    assert "127.0.0.1" in ps
    assert "weather_processor.local_host" in ps
    assert "Docker Desktop" not in ps
    assert "WXStudioNOAA" in ps
    assert "micromamba create" not in ps  # invoke the downloaded executable, not a system installation
    # Native DLLs on Windows are in science-env/Library/bin, NOT on PATH if
    # you directly execute science-env/python.exe. Use an activated mamba
    # runner for both preflight and the parent worker (and its children).
    assert "& $Micromamba run --prefix $EnvDir python -m eccodes selfcheck" in ps
    assert "& $Micromamba run --prefix $EnvDir python -c " in ps
    assert "& $Micromamba run --prefix $EnvDir python -m weather_processor.local_host" in ps
    assert "& $Python -c" not in ps
    assert "& $Python -m weather_processor.local_host" not in ps
    assert "install --yes --prefix $EnvDir --channel conda-forge eccodes python-eccodes" in ps
    assert "Remove-Item -LiteralPath $EnvDir" not in ps
    for package in ["python=3.12", "fastapi", "boto3", "arm_pyart", "eccodes",
                    "python-eccodes", "cfgrib", "h5netcdf", "rasterio", "pyproj"]:
        assert package in env
    assert "conda-forge" in env


def test_local_browser_private_network_preflight_header():
    import asyncio
    import httpx
    from weather_processor.local_service import APP

    async def check():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=APP),
                                    base_url="http://127.0.0.1:8080") as client:
            opts = await client.options("/health", headers={
                "Origin": "https://wx-studio.streamlit.app",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Private-Network": "true",
            })
            assert opts.status_code in (200, 204)
            assert opts.headers.get("access-control-allow-private-network") == "true"
            assert "GET" in opts.headers.get("access-control-allow-methods", "")
            # Without a browser PNA preflight, do not emit the extra header.
            health = await client.get("/health", headers={
                "Origin": "https://wx-studio.streamlit.app",
            })
            assert health.status_code == 200
            assert "access-control-allow-private-network" not in health.headers
            assert health.json()["service"] == "wxstudio-noaa-native"

    asyncio.run(check())
