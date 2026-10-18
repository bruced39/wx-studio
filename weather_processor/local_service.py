"""Private browser-to-localhost adapter for the existing NOAA read-only API.

Browser Local Network Access / Private Network Access preflight requests may
need Access-Control-Allow-Private-Network when the secure Streamlit iframe
calls http://127.0.0.1:8080. Keep this adapter LOCAL ONLY: local_host.py
binds the server to 127.0.0.1, and regular Docker/remote API is untouched.
"""
from __future__ import annotations

from .service import APP

@APP.middleware("http")
async def allow_local_network_access(request, call_next):
    response = await call_next(request)
    # This is a public, GET-only NOAA catalog/image server bound to loopback.
    # A remote website can't use this header to obtain secret data; none exists.
    # Never emit this permission automatically for non-preflight requests.
    if request.headers.get("access-control-request-private-network", "").lower() == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response
