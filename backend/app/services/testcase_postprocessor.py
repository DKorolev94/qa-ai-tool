from __future__ import annotations

import re

from app.core.time_utils import format_duration_ms as _format_duration_ms

# LLM often confuses ms/s/min; discard improved duration if suspiciously small
_MIN_DURATION_MS = 60_000

_STALE_TEST_DATA_KEYWORDS = [
    "вынести", "перенести", "добавить в test_data", "стоит добавить",
    "move to test_data", "add to test_data", "put in test_data", "use test_data",
]

_EXAMPLE_MARKER_RE = re.compile(r'^\s*(?:например|пример)\s*:\s*(.+)$', re.IGNORECASE)

_QUOTE_CHARS = '«"“”\''

# Connector words (+ optionally now-empty quote pair) left dangling in action
# after the literal value they referred to is stripped, e.g. 'значением ""'
_DANGLING_CONNECTOR_RE = re.compile(
    r'[\s,]*\b(?:значением|значение|равным|равное)\s*[:\-]?\s*'
    rf'(?:[{_QUOTE_CHARS}]{{1,2}}\s*[{_QUOTE_CHARS}]{{0,2}})?\s*$',
    re.IGNORECASE,
)


def _dedupe_action_test_data(step: dict) -> None:
    """If test_data already holds a value, strip that same literal out of action
    text so it isn't duplicated in both fields; also clean up connector words
    left dangling when the LLM already removed the value itself."""
    action = step.get("action")
    test_data = step.get("test_data")
    if not isinstance(action, str) or not action:
        return

    cleaned = action
    if isinstance(test_data, str) and test_data:
        marker = _EXAMPLE_MARKER_RE.match(test_data)
        literal = marker.group(1).strip() if marker else test_data.strip()
        if len(literal) >= 2:
            pattern = re.compile(r'(?<!\w)' + re.escape(literal) + r'(?!\w)', re.IGNORECASE)
            cleaned = pattern.sub('', cleaned)

    cleaned = _DANGLING_CONNECTOR_RE.sub('', cleaned)
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip(' ,.:;()')
    if cleaned and cleaned != action:
        step["action"] = cleaned


def _deduplicate(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _filter_stale_notes(notes: list[str], improved: dict) -> list[str]:
    has_test_data = any(
        bool(s.get("test_data"))
        for s in (improved.get("steps") or [])
        if isinstance(s, dict)
    )
    if not has_test_data:
        return notes

    result: list[str] = []
    for note in notes:
        note_lower = note.lower()
        if "test_data" in note_lower and any(kw in note_lower for kw in _STALE_TEST_DATA_KEYWORDS):
            continue
        result.append(note)
    return result



def _process_duration(improved: dict) -> tuple[str | None, int | None]:
    duration = improved.get("duration")
    if duration is None:
        return None, None
    if isinstance(duration, int):
        return _format_duration_ms(duration), duration
    if isinstance(duration, str):
        if duration.isdigit():
            ms = int(duration)
            return _format_duration_ms(ms), ms
        return duration, None
    return None, None


def postprocess_improved_testcase(
    original: dict,
    improved: dict,
) -> dict:
    result = dict(improved)
    for _section in ("steps", "preconditions", "postconditions"):
        if isinstance(result.get(_section), list):
            result[_section] = [dict(s) if isinstance(s, dict) else s for s in result[_section]]
    validation_warnings: list[str] = []

    # Deduplicate
    result["warnings"] = _deduplicate([str(w) for w in (result.get("warnings") or [])])
    result["improvement_notes"] = _deduplicate(
        [str(n) for n in (result.get("improvement_notes") or [])]
    )
    result["manual_notes"] = _deduplicate(
        [str(n) for n in (result.get("manual_notes") or [])]
    )

    # Remove stale notes
    result["improvement_notes"] = _filter_stale_notes(result["improvement_notes"], result)

    for _section in ("preconditions", "postconditions"):
        for step in result.get(_section) or []:
            if isinstance(step, dict):
                _dedupe_action_test_data(step)

    # Validate steps
    steps = result.get("steps") or []
    original_steps = original.get("steps") or []
    steps_restructured = len(steps) != len(original_steps)
    if not steps:
        validation_warnings.append("Улучшенный тест-кейс не содержит шагов")
    else:
        for i, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            _dedupe_action_test_data(step)
            if not step.get("action"):
                validation_warnings.append(f"Шаг {i + 1}: отсутствует действие")
            # Only warn if original had expected result but improved lost it.
            # Skip index-based check when step count changed — LLM restructured
            # steps (split/merge) and expected results may have moved to other indices.
            if not steps_restructured:
                orig_expected = original_steps[i].get("expected") if i < len(original_steps) else None
                if not step.get("expected") and orig_expected:
                    step["expected"] = orig_expected
                    validation_warnings.append(f"Шаг {i + 1}: ожидаемый результат восстановлен из оригинала")

    # Duration — discard LLM value if suspiciously small (LLM confused ms with seconds/minutes).
    # Floor is 60 000 ms (1 min) — any test shorter than that is likely a unit confusion.
    orig_duration = original.get("duration")
    improved_duration = result.get("duration")
    if (
        isinstance(improved_duration, int)
        and improved_duration < _MIN_DURATION_MS
        and isinstance(orig_duration, int)
        and orig_duration >= _MIN_DURATION_MS
    ):
        result["duration"] = orig_duration

    display_duration, raw_duration = _process_duration(result)
    result["display_duration"] = display_duration
    result["raw_duration"] = raw_duration

    # Keep attributes intact — TestIT UUID attributes are meaningful
    # (attribute_id → value_id, maps to TestIT attribute dictionary)
    if not result.get("attributes"):
        result["attributes"] = original.get("attributes") or {}

    result["validation_warnings"] = validation_warnings
    return result
