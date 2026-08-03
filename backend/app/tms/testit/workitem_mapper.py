from __future__ import annotations

from app.core.time_utils import format_duration_ms as _format_duration_ms
from app.parsing.html_cleaner import clean_html
from app.parsing.attachment_parser import extract_attachments, _EXT_TYPE_MAP
from app.schemas.testcase import Attachment, NormalizedTestCase, ParameterTable, TestCaseStep, WorkItemLink

_SUPPORTED_EXTS = tuple(_EXT_TYPE_MAP.keys())


_NOISE_COMMENTS = {"тест", "test", "todo", "fixme", "n/a", "н/а", ".", "-", "—", "?", "!"}


def _clean(value: object) -> str:
    if value is None:
        return ""
    return clean_html(str(value)).strip()


def _clean_comments(value: object) -> str | None:
    text = _clean(value)
    if not text or text.lower() in _NOISE_COMMENTS:
        return None
    return text


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



def _display_duration(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, int):
        return _format_duration_ms(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        return _format_duration_ms(int(stripped)) if stripped.isdigit() else stripped
    return None


def _count_or_none(value: object) -> int | None:
    if isinstance(value, (list, tuple, set, dict)):
        return len(value)
    return None


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


def _extract_parameter_table(work_item: dict) -> ParameterTable | None:
    """Extract parameter table from iterations (rows x columns)."""
    iterations = work_item.get("iterations") or []
    if not isinstance(iterations, list) or not iterations:
        # Fallback: direct parameters list
        params = work_item.get("parameters") or []
        if not isinstance(params, list) or not params:
            return None
        names: list[str] = []
        rows: list[list[str]] = []
        for p in params:
            if not isinstance(p, dict):
                continue
            name = str(p.get("parameterName") or p.get("name") or "").strip()
            value = str(p.get("value") or "").strip()
            if name and name not in names:
                names.append(name)
                rows.append([value])
        return ParameterTable(names=names, rows=rows) if names else None

    # Build table from iterations
    ordered_names: list[str] = []
    name_set: set[str] = set()
    table_rows: list[list[str]] = []

    for iteration in iterations:
        if not isinstance(iteration, dict):
            continue
        iter_params = iteration.get("parameters") or []
        row_map: dict[str, str] = {}
        for p in iter_params:
            if not isinstance(p, dict):
                continue
            name = str(p.get("parameterName") or p.get("name") or "").strip()
            value = str(p.get("value") or "").strip()
            if name and name not in name_set:
                ordered_names.append(name)
                name_set.add(name)
            if name:
                row_map[name] = value
        table_rows.append([row_map.get(n, "") for n in ordered_names])

    # Fix rows that were added before all columns were discovered
    for i, row in enumerate(table_rows):
        if len(row) < len(ordered_names):
            table_rows[i] = row + [""] * (len(ordered_names) - len(row))

    return ParameterTable(names=ordered_names, rows=table_rows) if ordered_names else None


def _extract_product_versions(work_item: dict) -> list[str]:
    """Extract product versions from TestIT work item."""
    result: list[str] = []

    # Try productVersions field (some TestIT versions)
    raw = work_item.get("productVersions") or work_item.get("product_versions") or []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str) and item.strip():
                result.append(item.strip())
            elif isinstance(item, dict):
                name = item.get("name") or item.get("value") or item.get("title") or item.get("id")
                if name:
                    result.append(str(name))

    if result:
        return result

    # Try customAttributes
    custom = work_item.get("customAttributes") or work_item.get("custom_attributes") or {}
    if isinstance(custom, dict):
        for key in ("productVersions", "product_versions", "версия_продукта"):
            val = custom.get(key)
            if isinstance(val, list):
                for item in val:
                    n = item.get("name") if isinstance(item, dict) else item
                    if n:
                        result.append(str(n))
            elif val:
                result.append(str(val))

    return result


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
    comments = _clean_comments(comments_raw)

    return TestCaseStep(
        action=action,
        expected=expected or None,
        test_data=test_data or None,
        comments=comments or None,
    )


def expand_steps(raw_steps: list, _depth: int = 0) -> list[TestCaseStep]:
    """Expand steps, recursively resolving shared steps (step.workItem.steps)."""
    if _depth > 10:
        return []
    result: list[TestCaseStep] = []
    for step in raw_steps:
        if not isinstance(step, dict):
            continue
        work_item = step.get("workItem")
        if work_item and isinstance(work_item, dict):
            nested = work_item.get("steps") or []
            result.extend(expand_steps(nested, _depth + 1))
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
    postconditions = expand_steps(raw_post)

    raw_atts = work_item.get("attachments") or []
    attachments = [_map_attachment(a) for a in raw_atts if isinstance(a, dict)]

    # fallback: extract URL-based attachments from description
    if not attachments and description_raw:
        attachments = extract_attachments(str(description_raw))

    raw_links = work_item.get("links") or []
    links = [
        WorkItemLink(
            url=lnk.get("url"),
            title=lnk.get("title"),
            type=lnk.get("type"),
            description=lnk.get("description") or None,
        )
        for lnk in raw_links
        if isinstance(lnk, dict) and lnk.get("url")
    ]

    tags = _extract_tags(work_item.get("tags"))

    priority = _extract_str(work_item.get("priority"))
    status = _extract_str(work_item.get("state") or work_item.get("status"))

    duration = work_item.get("duration")
    display_duration = _display_duration(duration)

    attributes_raw = work_item.get("attributes")
    attributes: dict = dict(attributes_raw) if isinstance(attributes_raw, dict) else {}
    attributes.update(
        {
            "uuid": work_item.get("id"),
            "globalId": work_item.get("globalId"),
            "versionId": work_item.get("versionId"),
            "versionNumber": work_item.get("versionNumber"),
            "projectId": work_item.get("projectId"),
            "sectionId": work_item.get("sectionId"),
            "entityTypeName": work_item.get("entityTypeName"),
            "sourceType": work_item.get("sourceType"),
            "isAutomated": work_item.get("isAutomated"),
            "createdDate": work_item.get("createdDate"),
            "modifiedDate": work_item.get("modifiedDate"),
            "duration": duration,
            "display_duration": display_duration,
            "medianDuration": work_item.get("medianDuration"),
            "display_median_duration": _display_duration(work_item.get("medianDuration")),
            "links_count": _count_or_none(work_item.get("links")),
            "parameters_count": _count_or_none(work_item.get("parameters")),
            "externalIssues_count": _count_or_none(work_item.get("externalIssues")),
            "autoTests_count": _count_or_none(work_item.get("autoTests")),
            "autoTestCases_count": _count_or_none(work_item.get("autoTestCases")),
            "iterations_count": _count_or_none(work_item.get("iterations")),
            "attachments_count": len(attachments),
        }
    )
    attributes = {key: value for key, value in attributes.items() if value is not None}

    if not steps:
        warnings.append("Could not confidently extract steps from raw content")

    # Section name — prefer nested object, fallback to None (service resolves via API)
    section_obj = work_item.get("section") or {}
    section_name = (
        _extract_str(section_obj.get("name"))
        if isinstance(section_obj, dict)
        else None
    )

    parameter_table = _extract_parameter_table(work_item)
    product_versions = _extract_product_versions(work_item)

    return NormalizedTestCase(
        title=title,
        description=description,
        preconditions=preconditions,
        steps=steps,
        postconditions=postconditions,
        attachments=attachments,
        links=links,
        tags=tags,
        priority=priority,
        status=status,
        duration=duration,
        display_duration=display_duration,
        attributes=attributes,
        warnings=warnings,
        parameter_table=parameter_table,
        section_name=section_name,
        product_versions=product_versions,
    )
