from __future__ import annotations

import json
import re

from app.core.time_utils import format_duration_ms as _format_duration_ms

# LLM often confuses ms/s/min; discard improved duration if suspiciously small
_MIN_DURATION_MS = 60_000

_STALE_TEST_DATA_KEYWORDS = [
    "вынести", "перенести", "добавить в test_data", "стоит добавить",
    "move to test_data", "add to test_data", "put in test_data", "use test_data",
]

_EXAMPLE_MARKER_RE = re.compile(r'^\s*(?:например|пример|example|e\.g\.?|eg)\s*:\s*(.+)$', re.IGNORECASE)

_QUOTE_CHARS = '«"“”\''

# Connector words (+ optionally now-empty quote pair) left dangling in action
# after the literal value they referred to is stripped, e.g. 'значением ""'
_DANGLING_CONNECTOR_RE = re.compile(
    r'[\s,]*\b(?:значением|значение|равным|равное)\s*[:\-]?\s*'
    rf'(?:[{_QUOTE_CHARS}]{{1,2}}\s*[{_QUOTE_CHARS}]{{0,2}})?\s*$',
    re.IGNORECASE,
)

# Empty markdown code-span left behind when the LLM moves a value into
# test_data but forgets to remove the backtick pair that used to wrap it
# in the action text, e.g. 'Enter email ``, click Submit'.
_EMPTY_CODE_SPAN_RE = re.compile(r'`\s*`')

# A `[type — source]`-style stand-in (e.g. `[email — test accounts]`),
# optionally wrapped in backticks. Placeholders are no longer allowed at all —
# the prompt asks the LLM never to write one, but it doesn't reliably comply,
# so this is enforced deterministically: any bracketed stand-in found in
# test_data or action is stripped, leaving the field as it was (empty stays
# empty) rather than a value that only looks filled in.
_PLACEHOLDER_SYNTAX_RE = re.compile(r'`?(\[[^\[\]]+\])`?')

# test_data that names a UI element instead of a value — "Кнопка Войти",
# "Log in button", "ссылка восстановления" — is never valid test data, whether
# or not it's wrapped in placeholder brackets. Happens when the LLM "resolves"
# a false-positive test_data issue on a click/navigation step. Matched
# anywhere in the string (not anchored) since the element word can be first
# ("Кнопка Войти") or last ("Log in button").
_UI_ELEMENT_VALUE_RE = re.compile(
    r'\b(?:button|кнопк\w*|link|ссылк\w*|menu|меню|tab|вкладк\w*|'
    r'icon|иконк\w*|checkbox|чекбокс\w*)\b',
    re.IGNORECASE,
)

_EMAIL_RE = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')

# Field/action context that signals a secret-like value (password, token) so
# the alnum-token scan below only fires near words that actually mean
# "credential", not near every alphanumeric string (product names, IDs, ...).
_SECRET_CONTEXT_RE = re.compile(
    r'парол|password|токен|token|секрет|secret|passcode|passphrase',
    re.IGNORECASE,
)
_ALNUM_TOKEN_RE = re.compile(r'(?=[^\s]*[A-Za-z])(?=[^\s]*\d)[A-Za-z0-9]{6,}')


def _strip_placeholder_syntax(step: dict) -> bool:
    """Remove any `[type — source]`-style placeholder from test_data or action,
    and any bare test_data value that names a UI element instead of real data.
    Returns True if one was found and stripped."""
    stripped = False
    test_data = step.get("test_data")
    if isinstance(test_data, str) and (
        _PLACEHOLDER_SYNTAX_RE.search(test_data) or _UI_ELEMENT_VALUE_RE.search(test_data)
    ):
        step["test_data"] = None
        stripped = True
    action = step.get("action")
    if isinstance(action, str) and _PLACEHOLDER_SYNTAX_RE.search(action):
        cleaned = _PLACEHOLDER_SYNTAX_RE.sub('', action)
        cleaned = re.sub(r'\s+,', ',', cleaned)
        cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip(' ,.:;()')
        if cleaned:
            step["action"] = cleaned
        stripped = True
    return stripped


def _collect_testcase_text(testcase: dict) -> str:
    parts = [str(testcase.get("title") or ""), str(testcase.get("description") or "")]
    for section in ("preconditions", "steps", "postconditions"):
        for step in testcase.get(section) or []:
            if not isinstance(step, dict):
                continue
            for field in ("action", "expected", "test_data", "comments"):
                value = step.get(field)
                if value:
                    parts.append(str(value))
    return "\n".join(parts)


# TestIT data-driven parameter reference, e.g. `%email%` — resolved separately
# from a parameter table the LLM never sees. It must survive improve
# untouched; if a token present in the source is gone afterward, the LLM
# likely mangled it (rewrote, "filled in", or deleted it).
# The closing `%` is mandatory, not optional — otherwise this also matches
# URL percent-encoding (`%20`, `%3D`, ...), which is extremely common in API
# test cases and isn't a TestIT parameter at all.
_TESTIT_PARAM_RE = re.compile(r'%\w+%')


def _find_missing_param_tokens(improved: dict, original: dict) -> list[str]:
    original_tokens = set(_TESTIT_PARAM_RE.findall(_collect_testcase_text(original)))
    if not original_tokens:
        return []
    improved_text = _collect_testcase_text(improved)
    return sorted(t for t in original_tokens if t not in improved_text)


_SECRET_JSON_KEY_RE = re.compile(r'\b(?:токен|token|парол\w*|password|secret|pwd|pass)\b', re.IGNORECASE)

# A string value that's plainly a synthetic stand-in — "valid_token_example",
# "test_user_1", "dummy_card_id" — regardless of what key it's under. Catches
# invented values the secret-key check above misses (e.g. an "id" or
# "card_number" field the LLM filled with an obviously made-up placeholder).
_SYNTHETIC_VALUE_RE = re.compile(r'example|sample|dummy|placeholder|_test\b|\btest_', re.IGNORECASE)


def _find_invented_json_secrets(text: str, original_text: str, found: list[str]) -> None:
    """test_data for API test cases is often a JSON payload. A key like
    "token"/"password" with a string value that isn't anywhere in the source
    (e.g. "valid_token_example") is invented, even though it has no digits and
    so doesn't match the generic alnum-token heuristic below. Also catch any
    string value that looks synthetic by its own wording, independent of key."""
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return

    def walk(obj: object) -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                is_new = isinstance(value, str) and value not in original_text and value not in found
                if is_new and isinstance(key, str) and _SECRET_JSON_KEY_RE.search(key) and len(value) >= 4:
                    found.append(value)
                elif is_new and _SYNTHETIC_VALUE_RE.search(value):
                    found.append(value)
                walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(parsed)


def _find_invented_data_values(improved: dict, original: dict) -> list[str]:
    """The LLM is told never to invent test data, but sometimes does anyway —
    e.g. writing a concrete `test@example.com` / `OldPassword123` that isn't
    anywhere in the source. Catch this deterministically: an email or a
    credential-looking token that appears in the improved case but nowhere in
    the original is invented, full stop — it can't have come from the source."""
    original_text = _collect_testcase_text(original)
    found: list[str] = []
    for section in ("preconditions", "steps", "postconditions"):
        for step in improved.get(section) or []:
            if not isinstance(step, dict):
                continue
            for field in ("action", "test_data"):
                text = step.get(field)
                if not isinstance(text, str) or not text:
                    continue
                for m in _EMAIL_RE.findall(text):
                    if m not in original_text and m not in found:
                        found.append(m)
                if _SECRET_CONTEXT_RE.search(text):
                    for m in _ALNUM_TOKEN_RE.findall(text):
                        if m not in original_text and m not in found:
                            found.append(m)
                if field == "test_data":
                    _find_invented_json_secrets(text, original_text, found)
    return found


def _dedupe_action_test_data(step: dict) -> None:
    """If test_data already holds a value, strip that same literal out of action
    text so it isn't duplicated in both fields; also clean up connector words
    left dangling when the LLM already removed the value itself.

    The trailing-punctuation cleanup only runs when one of these removals
    actually matched — otherwise it has no dangling artifact to clean up, and
    running it unconditionally would trim legitimate trailing punctuation
    (e.g. a closing parenthesis) from actions nobody touched."""
    action = step.get("action")
    test_data = step.get("test_data")
    if not isinstance(action, str) or not action:
        return

    cleaned = action
    changed = False
    if isinstance(test_data, str) and test_data:
        marker = _EXAMPLE_MARKER_RE.match(test_data)
        literal = marker.group(1).strip() if marker else test_data.strip()
        if len(literal) >= 2:
            pattern = re.compile(r'(?<!\w)' + re.escape(literal) + r'(?!\w)', re.IGNORECASE)
            new_cleaned = pattern.sub('', cleaned)
            if new_cleaned != cleaned:
                changed = True
            cleaned = new_cleaned

    new_cleaned = _DANGLING_CONNECTOR_RE.sub('', cleaned)
    if new_cleaned != cleaned:
        changed = True
    cleaned = new_cleaned

    new_cleaned = _EMPTY_CODE_SPAN_RE.sub('', cleaned)
    if new_cleaned != cleaned:
        changed = True
    cleaned = new_cleaned

    if not changed:
        return

    cleaned = re.sub(r'\s+,', ',', cleaned)
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

    placeholder_found = False

    for _section in ("preconditions", "postconditions"):
        for step in result.get(_section) or []:
            if isinstance(step, dict):
                if _strip_placeholder_syntax(step):
                    placeholder_found = True
                _dedupe_action_test_data(step)

    # Validate steps
    steps = result.get("steps") or []
    original_steps = original.get("steps") or []
    steps_restructured = len(steps) != len(original_steps)
    if not steps:
        validation_warnings.append("Improved test case has no steps")
    else:
        for i, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            if _strip_placeholder_syntax(step):
                placeholder_found = True
            _dedupe_action_test_data(step)
            if not step.get("action"):
                validation_warnings.append(f"Step {i + 1}: missing action")
            # Only warn if original had expected result but improved lost it.
            # Skip index-based check when step count changed — LLM restructured
            # steps (split/merge) and expected results may have moved to other indices.
            if not steps_restructured:
                orig_expected = original_steps[i].get("expected") if i < len(original_steps) else None
                if not step.get("expected") and orig_expected:
                    step["expected"] = orig_expected
                    validation_warnings.append(f"Step {i + 1}: expected result restored from original")

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

    invented = _find_invented_data_values(result, original)
    if invented:
        validation_warnings.append(
            "Possible invented test data not present in the source (verify before use): "
            + ", ".join(invented)
        )
    result["has_invented_data"] = bool(invented)

    if placeholder_found:
        validation_warnings.append(
            "LLM tried to write a placeholder instead of real test data — removed; check manual_notes for what's missing"
        )
    result["has_stripped_placeholder"] = placeholder_found

    missing_params = _find_missing_param_tokens(result, original)
    if missing_params:
        validation_warnings.append(
            "TestIT parameter reference(s) from the source are missing after improve — verify they weren't altered: "
            + ", ".join(missing_params)
        )
    result["has_missing_param_tokens"] = bool(missing_params)

    result["validation_warnings"] = validation_warnings
    return result
