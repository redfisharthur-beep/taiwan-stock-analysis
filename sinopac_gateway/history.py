"""Validate and aggregate read-only Shioaji 1-minute historical kbars into daily bars."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from collections import defaultdict
import math

TAIPEI = ZoneInfo("Asia/Taipei")


def _moment(value):
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    elif isinstance(value, (int, float)):
        try:
            v = float(value)
            dt = datetime.fromtimestamp(v / (1e9 if v > 1e15 else 1e3 if v > 1e12 else 1), timezone.utc)
        except (ValueError, OverflowError, OSError):
            return None
    else:
        return None
    return dt.replace(tzinfo=TAIPEI) if dt.tzinfo is None else dt.astimezone(TAIPEI)


def _positive(value):
    try:
        v = float(value)
        return v if math.isfinite(v) and v > 0 else None
    except (ValueError, TypeError, OverflowError):
        return None


def daily_bars(raw, last_completed_date):
    """Never treat an in-progress session as a completed daily bar."""
    fields = ("ts", "Open", "High", "Low", "Close", "Volume")
    arrays = [getattr(raw, field, None) for field in fields]
    if any(a is None for a in arrays):
        return []
    length = len(arrays[0])
    if length == 0 or length > 40000 or any(len(a) != length for a in arrays):
        return []
    by_date = defaultdict(list)
    for i in range(length):
        moment = _moment(arrays[0][i])
        if not moment or moment.date().isoformat() > last_completed_date:
            continue
        o, h, l, c = [_positive(arrays[j][i]) for j in (1, 2, 3, 4)]
        try:
            volume = float(arrays[5][i])
        except (ValueError, TypeError, OverflowError):
            continue
        if (None in (o, h, l, c) or not math.isfinite(volume) or volume < 0
                or h < max(o, c, l) or l > min(o, c, h)):
            continue
        if not (9 <= moment.hour <= 13):
            continue
        by_date[moment.date().isoformat()].append((moment, o, h, l, c, volume))
    result = []
    for date, ticks in sorted(by_date.items()):
        ticks.sort(key=lambda x: x[0])
        # The source's final minute must be at or after the regular session close
        # to avoid falsely reporting midday aggregates as EOD data.
        last = ticks[-1][0]
        if (last.hour, last.minute) < (13, 30):
            continue
        result.append({"date": date, "open": ticks[0][1],
                       "high": max(x[2] for x in ticks), "low": min(x[3] for x in ticks),
                       "close": ticks[-1][4], "minuteBars": len(ticks),
                       "kind": "unadjusted_broker_intraday_aggregate"})
    return result
