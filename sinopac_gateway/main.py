"""Private, read-only Shioaji market data bridge; deploy as one Render Python worker."""
import hmac
import os
import secrets
import threading
import time

from fastapi import FastAPI, Header, HTTPException, Response

from core import clean_snapshot, valid_stock

app = FastAPI(title="Private Sinopac Research Gateway", docs_url=None, redoc_url=None, openapi_url=None)
_lock = threading.Lock()
_client = None
_cache = {}
_last_lookup = 0.0
INTERVAL_SECONDS = 90  # Snapshot API is NOT real-time streaming. Do not repeatedly poll it.


def _authorized(provided: str | None):
    token = os.environ.get("SJ_BRIDGE_TOKEN", "")
    return len(token) >= 32 and bool(provided) and hmac.compare_digest(provided, token)


def _get_client():
    global _client
    if _client is not None:
        return _client
    key = os.environ.get("SJ_API_KEY", "")
    secret = os.environ.get("SJ_SEC_KEY", "")
    if not key or not secret:
        raise HTTPException(status_code=503, detail="Sinopac credentials have not been configured")
    try:
        import shioaji as sj
        client = sj.Shioaji(simulation=False)
        # Does not subscribe to trade notifications. No certificate is activated.
        client.login(api_key=key, secret_key=secret, subscribe_trade=False)
        _client = client
        return client
    except Exception:
        # Never include the underlying exception: it can contain sensitive account information.
        raise HTTPException(status_code=503, detail="Sinopac session unavailable; check Render logs privately")


@app.get("/health")
def health(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "service": "read_only_sinopac_gateway", "version": "0.1.0",
            "credentialsConfigured": bool(os.environ.get("SJ_API_KEY")) and bool(os.environ.get("SJ_SEC_KEY")),
            "bridgeTokenConfigured": len(os.environ.get("SJ_BRIDGE_TOKEN", "")) >= 32}


@app.get("/internal/quote/{stock}")
def quote(stock: str, response: Response, x_bridge_token: str | None = Header(default=None)):
    response.headers["Cache-Control"] = "private, no-store"
    if not _authorized(x_bridge_token):
        raise HTTPException(status_code=404, detail="Not found")
    if not valid_stock(stock):
        raise HTTPException(status_code=400, detail="Invalid stock code")
    global _last_lookup
    with _lock:
        now = time.monotonic()
        cached = _cache.get(stock)
        if cached and now - cached[0] < INTERVAL_SECONDS:
            return cached[1]
        if now - _last_lookup < INTERVAL_SECONDS:
            raise HTTPException(status_code=429, detail="Snapshot cooldown; try again later")
        # Restrict to a tiny read-only demonstration; never enumerate contracts or accounts.
        _last_lookup = now
        client = _get_client()
        try:
            contract = client.Contracts.Stocks[stock]
            snapshots = client.snapshots([contract])
            data = clean_snapshot(snapshots[0], stock) if snapshots else None
        except Exception:
            _client_reset()
            raise HTTPException(status_code=503, detail="Sinopac snapshot temporarily unavailable")
        if data is None:
            raise HTTPException(status_code=503, detail="Sinopac snapshot missing valid price or time")
        _cache[stock] = (time.monotonic(), data)
        return data


def _client_reset():
    global _client
    _client = None
