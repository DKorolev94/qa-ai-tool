from __future__ import annotations

import re

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_NUMERIC_RE = re.compile(r"^\d+$")

# Path segment that must precede the id — otherwise a trailing numeric segment
# could be some other resource's id (e.g. .../workItems/6109/testPlans/99) and
# we'd silently pick the wrong work item.
_ID_PATH_PREFIXES = {"workitems", "tests", "testcases"}


def extract_work_item_id(value: str) -> str:
    """Accept a plain numeric ID, a UUID, or a TestIT URL ending in one of those
    (e.g. a link copied from TestIT or from this tool's own "Open in TestIT")."""
    value = value.strip()
    if _NUMERIC_RE.match(value):
        return value
    if _UUID_RE.match(value):
        return value
    if value.startswith(("http://", "https://")):
        path = value.split("?", 1)[0].split("#", 1)[0].rstrip("/")
        segments = path.split("/")
        if len(segments) >= 2:
            candidate, prefix = segments[-1], segments[-2].lower()
            if prefix in _ID_PATH_PREFIXES and (_NUMERIC_RE.match(candidate) or _UUID_RE.match(candidate)):
                return candidate
    raise ValueError(
        f"Could not extract TestIT work item id from input: {value!r}. "
        "Provide a numeric ID (e.g. 6109), a UUID, or a TestIT test case URL."
    )
