"""Read-only sanitized broker market snapshot helpers. No account or order APIs."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import math
import re

TAIPEI = ZoneInfo("Asia/Taipei")
STOCK_PATTERN = re.compile(r"[0-9]{4}")


def valid_stock(code: str) -> bool:
    return isinstance(code, str) and STOCK_PATTERN.fullmatch(code) is not None


def positive_price(value):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def snapshot_time(value, ts=None):
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str) and value:
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            moment = None
    else:
        moment = None
    if moment is None and ts is not None:
        try:
            number = float(ts)
            # Official Shioaji examples use nanosecond epoch timestamps.
            moment = datetime.fromtimestamp(number / (1e9 if number > 1e15 else 1e3 if number > 1e12 else 1), timezone.utc)
        except (TypeError, ValueError, OverflowError):
            moment = None
    if moment is None:
        return None
    return (moment.replace(tzinfo=TAIPEI) if moment.tzinfo is None else moment.astimezone(TAIPEI)).isoformat(timespec="seconds")


def clean_snapshot(snapshot, requested_stock: str):
    if not valid_stock(requested_stock) or str(getattr(snapshot, "code", "")) != requested_stock:
        return None
    close = positive_price(getattr(snapshot, "close", None))
    when = snapshot_time(getattr(snapshot, "datetime", None), getattr(snapshot, "ts", None))
    if close is None or when is None:
        return None
    exchange = str(getattr(snapshot, "exchange", ""))
    if exchange not in ("TSE", "OTC"):
        return None
    # Do not expose personal account, login or order fields.
    return {"stock": requested_stock, "exchange": exchange,
            "price": close, "observedAt": when, "source": "Sinopac Shioaji snapshot",
            "kind": "snapshot_not_official_close"}
