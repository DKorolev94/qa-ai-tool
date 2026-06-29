from __future__ import annotations

from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_RULES_DIR = _PROMPTS_DIR / "rules"
_REVIEW_BASE = _PROMPTS_DIR / "review_base.md"
_IMPROVE_BASE = _PROMPTS_DIR / "improve_base.md"
_IMPROVE_LEGACY = _PROMPTS_DIR / "improve.md"

_FIX_SECTION_MARKER = "## Как исправлять"

_RULE_FIX_LABELS: dict[str, str] = {
    "title": "Заголовок",
    "description": "Описание",
    "preconditions": "Предусловия",
    "steps": "Шаги",
    "postconditions": "Постусловия",
    "priority": "Приоритет",
    "expected_results": "Ожидаемые результаты",
    "test_data": "Тестовые данные",
    "tags": "Теги",
    "atomicity": "Атомарность",
    "independence": "Независимость",
    "reproducibility": "Воспроизводимость",
}


def _load(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception:
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


def build_review_prompt(enabled_rules: list[str] | None = None) -> str:
    base = _load(_REVIEW_BASE)
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
    checklist_block = f"## Обязательный чеклист правил\n\nВ поле `reasoning` пройди по каждому правилу из списка ниже по порядку. Для каждого правила напиши вывод: есть нарушение или нет, и почему. Пропускать правила запрещено.\n\n{checklist}"
    return f"{base}\n\n---\n\n## Проверяй следующие аспекты\n\n{rules_block}\n\n---\n\n{checklist_block}"


def build_improve_prompt(rule_ids: list[str] | None = None) -> str:
    if not rule_ids:
        return _load(_IMPROVE_LEGACY)
    unique_ids = list(dict.fromkeys(rule_ids))
    fix_sections = []
    for rule_id in unique_ids:
        body = _load_fix_section(rule_id)
        if body:
            label = _RULE_FIX_LABELS.get(rule_id, rule_id)
            fix_sections.append(f"### {label}\n\n{body}")
    if not fix_sections:
        return _load(_IMPROVE_LEGACY)
    base = _load(_IMPROVE_BASE)
    rules_block = "\n\n---\n\n".join(fix_sections)
    return f"{base}\n\n---\n\n## Как исправлять\n\n{rules_block}"
