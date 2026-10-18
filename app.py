"""WX Studio – Streamlit shell. The studio itself runs in the browser (studio/*.js);
Streamlit just hosts it, so video export happens on your own PC, not on the server."""
import streamlit as st
import streamlit.components.v1 as components
import json

from wxbuild import build_html

st.set_page_config(page_title="WX Studio", page_icon="🌦️", layout="wide", initial_sidebar_state="collapsed")
st.markdown(
    "<style>header,footer{visibility:hidden;height:0} .block-container{padding:0.3rem 0.5rem 0 0.5rem;max-width:100%}</style>",
    unsafe_allow_html=True,
)

with st.sidebar:
    st.header("WX Studio")
    height = st.slider("Studio height (px)", 700, 1400, 940, 20)
    st.caption("Mapbox: uses MAPBOX_PUBLIC_TOKEN (WXfusion) or MAPBOX_TOKEN from Streamlit secrets; you can also paste a public token inside the studio.")
    st.caption("Tip: use Chrome or Edge. MP4 export uses your browser's H.264 encoder.")
    # Browser-side loopback access: NOAA processing stays on this Windows PC.
    # No cloud processor, paid hosting, public tunnel, or remote API key.
    local_noaa = st.checkbox(
        "Use free local NOAA processor on this computer",
        value=False,
        help="Connect the studio browser to the NOAA decoder running on this PC at 127.0.0.1:8080. "
             "Start the decoder with weather_processor/start_local_windows.ps1 first. "
             "Browser access to localhost may require permission.",
    )


def _html() -> str:
    # Rebuild the self-contained studio bundle on every Streamlit rerun.
    # This intentionally mirrors WXfusion Weather Director so a normal
    # browser refresh picks up the newest deployed HTML/JS without an app reboot.
    return build_html()


def _token() -> str:
    try:
        for key in ("MAPBOX_PUBLIC_TOKEN", "MAPBOX_TOKEN"):
            value = str(st.secrets.get(key, "")).strip()
            if value.startswith("pk."):
                return value
        return ""
    except Exception:
        return ""


_tok = _token()
_inject = ""
if _tok.startswith("pk."):
    _inject += "<script>window.WX_MAPBOX_TOKEN=" + json.dumps(_tok) + ";</script>"

# Publishable Supabase keys are intended for browser usage. Never send a
# service-role or secret key to the iframe, and do not bake API keys into Git.
def _cloud_config() -> dict:
    # This is the dedicated, isolated WX Studio Supabase project's PUBLIC
    # publishable key. It is safe to expose client-side, unlike secret keys.
    # RLS ensures that signed-in users can access only their own presets.
    endpoint = "https://lcujugmyyuumrshdasla.supabase.co"
    pub_key = "sb_publishable_BTjp74AA-GqP2kGKUM6i0w_EDuIw8EN"
    try:
        endpoint = str(st.secrets.get("WX_SUPABASE_URL", endpoint)).strip()
        pub_key = str(st.secrets.get("WX_SUPABASE_PUBLISHABLE_KEY", pub_key)).strip()
    except Exception:
        pass
    if endpoint.startswith("https://") and pub_key.startswith("sb_publishable_"):
        return {"url": endpoint, "publishableKey": pub_key}
    return {}

_cloud = _cloud_config()
if _cloud:
    # Prevent accidental </script> escaping from embedded configuration.
    _cloud_json = json.dumps(_cloud).replace("<", "\\u003c")
    _inject += "<script>window.WX_CLOUD_CONFIG=" + _cloud_json + ";</script>"
# Optional PUBLIC URL of the independent NOAA processing service. The
# scientific stack stays off Streamlit. No service credentials are injected.
def _processor_url() -> str:
    try:
        value = str(st.secrets.get("WX_WEATHER_PROCESSOR_URL", "")).strip().rstrip("/")
    except Exception:
        return ""
    if value.startswith("https://") or value.startswith("http://localhost:") or value.startswith("http://127.0.0.1:"):
        return value
    return ""

# If selected, connect the BROWSER directly to the user's own machine.
# Streamlit Community Cloud never processes NOAA data or accesses localhost.
_processor = "http://127.0.0.1:8080" if local_noaa else _processor_url()
if _processor:
    _inject += "<script>window.WX_WEATHER_PROCESSOR_URL=" + json.dumps(_processor).replace("<", "\\u003c") + ";</script>"

components.html(_inject + _html(), height=height, scrolling=False)
