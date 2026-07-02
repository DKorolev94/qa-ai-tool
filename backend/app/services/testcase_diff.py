from __future__ import annotations

_MAX_STR = 200


def _short(val: object) -> str:
    s = str(val or "")
    return s[:_MAX_STR] + "…" if len(s) > _MAX_STR else s


def _compare_field(
    field: str,
    before: object,
    after: object,
    changes: list[dict],
) -> bool:
    bv = "" if before is None else str(before)
    av = "" if after is None else str(after)
    if bv == av:
        return False
    change_type = "added" if not bv and av else ("removed" if bv and not av else "changed")
    changes.append({"field": field, "type": change_type, "before": _short(bv), "after": _short(av)})
    return True


def _compare_step_list(
    orig: list,
    impr: list,
    prefix: str,
    fields: list[str],
    changes: list[dict],
) -> bool:
    changed = False
    max_len = max(len(orig), len(impr))
    for i in range(max_len):
        os = orig[i] if i < len(orig) else {}
        is_ = impr[i] if i < len(impr) else {}
        if not isinstance(os, dict):
            os = {}
        if not isinstance(is_, dict):
            is_ = {}
        for f in fields:
            if _compare_field(f"{prefix}[{i + 1}].{f}", os.get(f), is_.get(f), changes):
                changed = True
    return changed


def build_testcase_diff(original: dict, improved: dict) -> dict:
    changes: list[dict] = []
    summary: dict[str, bool] = {}

    summary["title_changed"] = _compare_field(
        "title", original.get("title"), improved.get("title"), changes
    )
    summary["description_changed"] = _compare_field(
        "description", original.get("description"), improved.get("description"), changes
    )

    summary["steps_changed"] = _compare_step_list(
        original.get("steps") or [],
        improved.get("steps") or [],
        "steps",
        ["action", "expected", "test_data", "comments"],
        changes,
    )

    summary["preconditions_changed"] = _compare_step_list(
        original.get("preconditions") or [],
        improved.get("preconditions") or [],
        "preconditions",
        ["action", "expected"],
        changes,
    )

    summary["postconditions_changed"] = _compare_step_list(
        original.get("postconditions") or [],
        improved.get("postconditions") or [],
        "postconditions",
        ["action", "expected"],
        changes,
    )

    # Tags
    orig_tags = set(str(t) for t in (original.get("tags") or []))
    impr_tags = set(str(t) for t in (improved.get("tags") or []))
    tags_changed = orig_tags != impr_tags
    summary["tags_changed"] = tags_changed
    if tags_changed:
        added = impr_tags - orig_tags
        removed = orig_tags - impr_tags
        if added:
            changes.append({"field": "tags", "type": "added", "before": "", "after": ", ".join(sorted(added))})
        if removed:
            changes.append({"field": "tags", "type": "removed", "before": ", ".join(sorted(removed)), "after": ""})

    summary["priority_changed"] = _compare_field(
        "priority", original.get("priority"), improved.get("priority"), changes
    )
    summary["status_changed"] = _compare_field(
        "status", original.get("status"), improved.get("status"), changes
    )
    summary["duration_changed"] = _compare_field(
        "duration", original.get("duration"), improved.get("duration"), changes
    )

    return {"summary": summary, "changes": changes}
