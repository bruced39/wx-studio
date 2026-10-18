"""Catch broken Streamlit iframe paths for nested NOAA weather scripts."""
from __future__ import annotations

import re

from wxbuild import build_html


def test_all_studio_javascript_is_inlined_before_streamlit_iframe_loads():
    html = build_html()
    assert not re.search(r'<script src="[^"]+\.js"></script>', html), (
        "A relative script source survives in a Streamlit components.html iframe"
    )
    assert "WXData" in html
    assert "WXWeatherSources" in html
    assert "WXWeatherPalettes" in html
    assert "WXWeatherProcessorBridge" in html
    assert "WX_WEATHER_PROCESSOR_URL" not in re.findall(r'<script src="([^"]+)"', html)
    assert html.index("WXData.registerSource") < html.index("WXWeatherProcessorBridge")
    assert html.index("WXWeatherSources") < html.index("WXWeatherProcessorBridge")


def test_no_outside_studio_paths_are_allowed():
    # Deliberately keep bundling restricted to physical files beneath studio/
    # so a malicious template edit cannot inline arbitrary source/secrets.
    import wxbuild
    original = wxbuild.STUDIO
    assert original.is_dir()
    html = build_html()
    assert "../app.py" not in re.findall(r'<script src="([^"]+)"', html)
