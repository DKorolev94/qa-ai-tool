from __future__ import annotations


def format_duration_ms(ms: int) -> str:
    if ms >= 3600000:
        h = ms // 3600000
        m = (ms % 3600000) // 60000
        return f"{h}h {m}m" if m else f"{h}h"
    if ms >= 60000:
        m = ms // 60000
        s = (ms % 60000) // 1000
        return f"{m}m {s}s" if s else f"{m}m"
    if ms >= 1000:
        return f"{ms // 1000}s"
    return f"{ms}ms"
