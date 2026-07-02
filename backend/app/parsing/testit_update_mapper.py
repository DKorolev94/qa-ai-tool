# backend/app/parsing/testit_update_mapper.py
from __future__ import annotations

import re

_PRIORITY_MAP = {
    "highest": "Highest",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "critical": "Critical",
}


def _safe_duration(value: object, fallback: int = 60000) -> int:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        ms = int(value)
        return ms if ms > 0 else fallback
    return fallback
_VALID_STATES = {"Ready", "NotReady", "NeedsWork"}
_SERVICE_FOOTER_SEP = "\n\n---\n"
_DROP_TAGS = {"needs-review"}
_SERVICE_TAGS = re.compile(r"^source-\d+$")


def _strip_service_footer(desc: str | None) -> str:
    if not desc:
        return ""
    idx = desc.find(_SERVICE_FOOTER_SEP)
    return desc[:idx].strip() if idx != -1 else desc.strip()


def _map_step(step: dict) -> dict:
    return {
        "action": step.get("action") or "",
        "expected": step.get("expected") or "",
        "testData": step.get("test_data") or "",
        "comments": step.get("comments") or "",
    }


def _map_priority(priority: str | None) -> str:
    if not priority:
        return "Medium"
    return _PRIORITY_MAP.get(priority.lower(), "Medium")


def _map_state(status: str | None) -> str:
    if status and status in _VALID_STATES:
        return status
    return "Ready"


def _strip_ai_draft_prefix(title: str) -> str:
    prefix = "[AI DRAFT] "
    return title[len(prefix):] if title.startswith(prefix) else title


def build_update_payload(
    original_raw: dict,
    improved: dict,
    source_work_item_id: str,
) -> dict:
    original_tag_names = {t.get("name") for t in (original_raw.get("tags") or []) if t.get("name")}
    improved_tag_names = set(improved.get("tags") or [])

    merged = (original_tag_names | improved_tag_names)
    cleaned = {
        t for t in merged
        if not _SERVICE_TAGS.match(t) and t not in _DROP_TAGS
    }
    cleaned.add("ai-generated")

    payload = {
        **original_raw,
        "name": _strip_ai_draft_prefix(improved.get("title") or original_raw.get("name") or ""),
        "description": _strip_service_footer(improved.get("description")),
        "state": _map_state(improved.get("status")),
        "priority": _map_priority(improved.get("priority")),
        "duration": _safe_duration(improved.get("duration") if improved.get("duration") is not None else original_raw.get("duration")),
        "steps": [_map_step(s) for s in (improved.get("steps") or [])],
        "preconditionSteps": [_map_step(s) for s in (improved.get("preconditions") or [])],
        "postconditionSteps": [_map_step(s) for s in (improved.get("postconditions") or [])],
        "tags": [{"name": t} for t in sorted(cleaned)],
    }

    return payload
