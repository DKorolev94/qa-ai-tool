from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_RULES_DIR = _PROMPTS_DIR / "rules"
_REVIEW_BASE = _PROMPTS_DIR / "review_base.md"
_IMPROVE_BASE = _PROMPTS_DIR / "improve_base.md"

_FIX_SECTION_MARKER = "## How to fix"

_LANGUAGE_NAMES: dict[str, str] = {"ru": "Russian", "en": "English"}


def _apply_language(text: str, language: str) -> str:
    return text.replace("{LANGUAGE_NAME}", _LANGUAGE_NAMES.get(language, "Russian"))


_RULE_FIX_LABELS: dict[str, str] = {
    "title": "Title",
    "description": "Description",
    "preconditions": "Preconditions",
    "steps": "Steps",
    "postconditions": "Postconditions",
    "priority": "Priority",
    "expected_results": "Expected results",
    "test_data": "Test data",
    "tags": "Tags",
    "atomicity": "Atomicity",
    "independence": "Independence",
    "reproducibility": "Reproducibility",
}


def _load(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        logger.warning("Failed to load prompt file %s: %s", path, exc)
        return ""


def _load_fix_section(rule_id: str) -> str:
    """Extract fix-section body from rule file, WITHOUT the ## header (caller adds labeled header)."""
    content = _load(_RULES_DIR / f"{rule_id}.md")
    if not content or _FIX_SECTION_MARKER not in content:
        return ""
    idx = content.index(_FIX_SECTION_MARKER)
    # Skip the marker line itself
    body = content[idx + len(_FIX_SECTION_MARKER):].lstrip("\n")
    # Stop at the next ## section (should not exist — fix section is always last)
    next_h2 = body.find("\n## ")
    if next_h2 != -1:
        body = body[:next_h2]
    return body.strip()


def build_review_prompt(enabled_rules: list[str] | None = None, language: str = "ru") -> str:
    base = _apply_language(_load(_REVIEW_BASE), language)
    if not enabled_rules:
        return base
    rule_sections = [c for r in enabled_rules if (c := _load(_RULES_DIR / f"{r}.md"))]
    if not rule_sections:
        return base
    # Strip fix sections from rules when used for review — only detection logic needed
    review_only_sections = []
    for section in rule_sections:
        if _FIX_SECTION_MARKER in section:
            section = section[:section.index(_FIX_SECTION_MARKER)].rstrip()
        review_only_sections.append(section)
    rules_block = "\n\n---\n\n".join(review_only_sections)
    checklist = "\n".join(f"{i + 1}. {r}" for i, r in enumerate(enabled_rules))
    checklist_block = f"## Mandatory rule checklist\n\nIn the `reasoning` field, go through every rule in the list below, in order. For each rule, write a verdict: violation or not, and why. Skipping rules is not allowed.\n\n{checklist}"
    return f"{base}\n\n---\n\n## Check the following aspects\n\n{rules_block}\n\n---\n\n{checklist_block}"


def build_improve_prompt(rule_ids: list[str] | None = None, language: str = "ru") -> str:
    # None: no rule ids passed at all (e.g. issues from an external source
    # with no `rule` field) — fall back to the full rule set instead of a
    # separately maintained monolithic prompt, so rules/*.md stays the single
    # source of truth. An empty list is different: it means no issues were
    # selected at all, so no fix guidance should be included either —
    # collapsing that case to "use every rule" invited the LLM to rewrite
    # fields nobody asked it to touch.
    if rule_ids is None:
        unique_ids = list(_RULE_FIX_LABELS.keys())
    else:
        unique_ids = list(dict.fromkeys(rule_ids))
    fix_sections = []
    for rule_id in unique_ids:
        body = _load_fix_section(rule_id)
        if body:
            label = _RULE_FIX_LABELS.get(rule_id, rule_id)
            fix_sections.append(f"### {label}\n\n{body}")
    base = _apply_language(_load(_IMPROVE_BASE), language)
    rules_block = "\n\n---\n\n".join(fix_sections)
    return f"{base}\n\n---\n\n## How to fix\n\n{rules_block}"
