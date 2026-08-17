from __future__ import annotations

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
    if isinstance(value, str):
        # isdigit() alone would still crash on unicode digits int() rejects
        try:
            ms = int(value)
        except ValueError:
            return fallback
        return ms if ms > 0 else fallback
    return fallback

_STATUS_MAP = {
    "ready": "Ready",
    "needswork": "NeedsWork",
    "notready": "NotReady",
}


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


def _map_status(status: str | None) -> str:
    if not status:
        return "NotReady"
    return _STATUS_MAP.get(status.lower().replace(" ", ""), "NotReady")


def build_draft_payload(
    improved: dict,
    project_id: str,
    section_id: str,
    source_attributes: dict | None = None,
) -> dict:
    """Convert ImprovedTestCase dict into TestIT create-workitem payload.

    Provenance and manual-review notes go on the work item's comments
    (create_work_item_comment), not description — description stays exactly
    what the LLM produced.
    """
    status = improved.get("status")
    needs_review = _map_status(status) != "Ready"

    original_tags: list[str] = list(improved.get("tags") or [])
    draft_tags = [t for t in original_tags if t != "needs-review"]
    draft_tags = (["needs-review"] if needs_review else []) + draft_tags

    title = (improved.get("title") or "Untitled").removeprefix("[AI DRAFT] ")

    payload: dict = {
        "entityTypeName": "TestCases",
        "name": title,
        "description": improved.get("description") or "",
        "projectId": project_id,
        "sectionId": section_id,
        "state": _map_status(status),
        "priority": _map_priority(improved.get("priority")),
        "tags": [{"name": t} for t in draft_tags],
        "duration": _safe_duration(improved.get("duration")),
        "steps": [_map_step(s) for s in (improved.get("steps") or [])],
        "preconditionSteps": [_map_step(s) for s in (improved.get("preconditions") or [])],
        "postconditionSteps": [_map_step(s) for s in (improved.get("postconditions") or [])],
        "attributes": source_attributes or {},
    }

    return payload
