from __future__ import annotations

import re

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_NUMERIC_RE = re.compile(r"^\d+$")


def extract_work_item_id(value: str) -> str:
    """Accept plain numeric ID or UUID."""
    value = value.strip()
    if _NUMERIC_RE.match(value):
        return value
    if _UUID_RE.match(value):
        return value
    raise ValueError(
        f"Could not extract TestIT work item id from input: {value!r}. "
        "Provide a numeric ID (e.g. 6109) or UUID."
    )
