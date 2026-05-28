from __future__ import annotations

from app.parsing.html_cleaner import clean_html
from app.parsing.attachment_parser import extract_attachments, _EXT_TYPE_MAP
from app.schemas.testcase import Attachment, NormalizedTestCase, TestCaseStep

_SUPPORTED_EXTS = tuple(_EXT_TYPE_MAP.keys())


def _clean(value: object) -> str:
    if value is None:
        return ""
    return clean_html(str(value)).strip()


def _extract_str(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        for key in ("name", "value", "title"):
            v = value.get(key)
            if v and isinstance(v, str):
                return v.strip()
    return str(value).strip() or None


def _extract_tags(raw: object) -> list[str]:
    if not raw or not isinstance(raw, list):
        return []
    result: list[str] = []
    for t in raw:
        if isinstance(t, str) and t.strip():
            result.append(t.strip())
        elif isinstance(t, dict):
            name = t.get("name") or t.get("value") or t.get("id")
            if name:
                result.append(str(name))
    return result


def _attachment_type_from_name(name: str | None) -> str | None:
    if not name:
        return None
    lower = name.lower()
    for ext, kind in _EXT_TYPE_MAP.items():
        if lower.endswith(ext):
            return kind
    return "unknown"


def _map_attachment(raw: dict) -> Attachment:
    name = raw.get("name") or raw.get("fileName")
    url = raw.get("url") or raw.get("fileUrl")
    file_id = raw.get("id") or raw.get("fileId") or raw.get("file_id")
    att_type = _attachment_type_from_name(name)
    return Attachment(name=name, url=url, type=att_type, file_id=file_id)


def map_step(step: dict) -> TestCaseStep:
    action = _clean(step.get("action") or "")
    expected_raw = step.get("expected")
    expected = _clean(expected_raw) if expected_raw else None
    test_data_raw = step.get("test_data") or step.get("testData")
    test_data = _clean(test_data_raw) if test_data_raw else None
    comments_raw = step.get("comments")
    comments = _clean(comments_raw) if comments_raw else None

    return TestCaseStep(
        action=action,
        expected=expected or None,
        test_data=test_data or None,
        comments=comments or None,
    )


def expand_steps(raw_steps: list) -> list[TestCaseStep]:
    """Expand steps, recursively resolving shared steps (step.workItem.steps)."""
    result: list[TestCaseStep] = []
    for step in raw_steps:
        if not isinstance(step, dict):
            continue
        work_item = step.get("workItem")
        if work_item and isinstance(work_item, dict):
            nested = work_item.get("steps") or []
            result.extend(expand_steps(nested))
        else:
            result.append(map_step(step))
    return result


def normalize_testit_workitem(work_item: dict) -> NormalizedTestCase:
    warnings: list[str] = []

    title = _extract_str(work_item.get("name"))

    description_raw = work_item.get("description") or ""
    description = _clean(description_raw)

    raw_steps = work_item.get("steps") or []
    steps = expand_steps(raw_steps)

    raw_pre = work_item.get("precondition_steps") or work_item.get("preconditionSteps") or []
    preconditions = expand_steps(raw_pre)

    raw_post = work_item.get("postcondition_steps") or work_item.get("postconditionSteps") or []
    postconditions = [map_step(s) for s in raw_post if isinstance(s, dict)]

    raw_atts = work_item.get("attachments") or []
    attachments = [_map_attachment(a) for a in raw_atts if isinstance(a, dict)]

    # fallback: extract URL-based attachments from description
    if not attachments and description_raw:
        attachments = extract_attachments(str(description_raw))

    tags = _extract_tags(work_item.get("tags"))

    priority = _extract_str(work_item.get("priority"))
    status = _extract_str(work_item.get("state") or work_item.get("status"))

    duration = work_item.get("duration")

    attributes_raw = work_item.get("attributes")
    attributes: dict = attributes_raw if isinstance(attributes_raw, dict) else {}

    if not steps:
        warnings.append("Could not confidently extract steps from raw content")

    return NormalizedTestCase(
        title=title,
        description=description,
        preconditions=preconditions,
        steps=steps,
        postconditions=postconditions,
        attachments=attachments,
        tags=tags,
        priority=priority,
        status=status,
        duration=duration,
        attributes=attributes,
        warnings=warnings,
    )
