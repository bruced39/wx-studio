"""Choose the PUBLIC Mapbox token for this deployment (v0.10.3).

Pure and Streamlit-free so it can be unit tested. It never returns, logs or
echoes a secret value: only a public ``pk.`` token may be sent to a browser.

Supported Streamlit Secrets, in priority order:

1. ``MAPBOX_PUBLIC_TOKENS_BY_HOST`` – a table of ``host = "pk...."`` entries.
   Lets one codebase use a different, URL-restricted token per deployment
   (production vs. a test app). Matched on the request's Host header.
2. ``MAPBOX_PUBLIC_TOKEN`` – one public token (the usual choice: every
   Streamlit app has its own Secrets, so each app can hold its own token).
3. ``MAPBOX_TOKEN`` – legacy name.

Anything that is not a ``pk.`` token (``sk.`` secret tokens, ``tk.`` temporary
tokens, typos) is skipped and reported by KEY NAME only.
"""
from __future__ import annotations

from typing import Any, List, NamedTuple, Optional

PUBLIC_PREFIX = "pk."
HOST_TABLE_KEY = "MAPBOX_PUBLIC_TOKENS_BY_HOST"
SINGLE_KEYS = ("MAPBOX_PUBLIC_TOKEN", "MAPBOX_TOKEN")


class TokenChoice(NamedTuple):
    token: str                 # "" when no usable public token was found
    source: str                # secret key name (or "key[host]"), "" when none
    rejected: List[str]        # key names holding a non-public token (never values)


def normalize_host(host: Optional[str]) -> str:
    """Lower-case host without port or trailing dot ("Wx.Streamlit.app:443" -> "wx.streamlit.app")."""
    h = str(host or "").strip().lower()
    if h.startswith("["):                      # IPv6 literal
        end = h.find("]")
        return h[1:end] if end > 0 else h
    return h.split(":", 1)[0].rstrip(".")


def _get(mapping: Any, key: str) -> Any:
    try:
        return mapping.get(key)
    except Exception:
        return None


def _is_public(value: Any) -> bool:
    return isinstance(value, str) and value.strip().startswith(PUBLIC_PREFIX) and len(value.strip()) > len(PUBLIC_PREFIX) + 8


def pick_token(secrets: Any, host: Optional[str] = None) -> TokenChoice:
    rejected: List[str] = []
    table = _get(secrets, HOST_TABLE_KEY)
    want = normalize_host(host)
    if want and table is not None:
        try:
            items = list(table.items())
        except Exception:
            items = []
        for name, value in items:
            if normalize_host(str(name)) != want:
                continue
            if _is_public(value):
                return TokenChoice(str(value).strip(), "%s[%s]" % (HOST_TABLE_KEY, want), rejected)
            if value not in (None, ""):
                rejected.append("%s[%s]" % (HOST_TABLE_KEY, want))
    for key in SINGLE_KEYS:
        value = _get(secrets, key)
        if _is_public(value):
            return TokenChoice(str(value).strip(), key, rejected)
        if value not in (None, ""):
            rejected.append(key)
    return TokenChoice("", "", rejected)
