from app.tms.testit.draft_mapper import build_draft_payload

IMPROVED = {
    "title": "Ошибка при вводе неверного пароля",
    "description": "Проверка негативного сценария",
    "steps": [
        {"action": "Открыть форму логина", "expected": "Форма открыта", "test_data": "URL: /login", "comments": None},
        {"action": "Ввести неверный пароль", "expected": "Ошибка авторизации"},
    ],
    "preconditions": [{"action": "Пользователь зарегистрирован", "expected": None}],
    "postconditions": [],
    "tags": ["auth", "negative"],
    "priority": "high",
    "status": "Ready",
    "duration": 120000,
    "attributes": {"uuid-key": "uuid-val"},
}


def payload():
    return build_draft_payload(IMPROVED, "6109", "project-uuid", "section-uuid")


def test_name_no_prefix():
    p = payload()
    assert not p["name"].startswith("[AI DRAFT]")
    assert p["name"] == "Ошибка при вводе неверного пароля"


def test_name_strips_existing_prefix():
    improved = {**IMPROVED, "title": "[AI DRAFT] Ошибка при вводе неверного пароля"}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    assert not p["name"].startswith("[AI DRAFT]")


def test_project_and_section_ids():
    p = payload()
    assert p["projectId"] == "project-uuid"
    assert p["sectionId"] == "section-uuid"


def test_state_ready_when_status_ready():
    p = payload()
    assert p["state"] == "Ready"


def test_state_needs_work():
    improved = {**IMPROVED, "status": "NeedsWork"}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    assert p["state"] == "NeedsWork"


def test_state_not_ready_when_no_status():
    improved = {**IMPROVED, "status": None}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    assert p["state"] == "NotReady"


def test_priority_mapped():
    p = payload()
    assert p["priority"] == "High"


def test_priority_default_medium():
    improved = {**IMPROVED, "priority": None}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    assert p["priority"] == "Medium"


def test_priority_case_insensitive():
    improved = {**IMPROVED, "priority": "LOW"}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    assert p["priority"] == "Low"


def test_tags_ready_no_needs_review():
    p = payload()
    tag_names = [t["name"] for t in p["tags"]]
    assert "needs-review" not in tag_names


def test_draft_does_not_force_ai_generated_tag():
    p = payload()
    tag_names = [t["name"] for t in p["tags"]]
    assert "ai-generated" not in tag_names


def test_tags_needs_work_has_needs_review():
    improved = {**IMPROVED, "status": "NeedsWork"}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    tag_names = [t["name"] for t in p["tags"]]
    assert "needs-review" in tag_names


def test_original_tags_preserved():
    p = payload()
    tag_names = [t["name"] for t in p["tags"]]
    assert "auth" in tag_names
    assert "negative" in tag_names


def test_no_duplicate_ai_tags():
    improved = {**IMPROVED, "tags": ["ai-generated", "auth"]}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    tag_names = [t["name"] for t in p["tags"]]
    assert tag_names.count("ai-generated") == 1


def test_description_no_footer_when_ready():
    p = payload()
    assert "qa-ai-tool" not in p["description"]
    assert "Needs QA review" not in p["description"]


def test_description_has_footer_when_needs_work():
    improved = {**IMPROVED, "status": "NeedsWork"}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    assert "qa-ai-tool" in p["description"]
    assert "#6109" in p["description"]
    assert "Needs QA review" in p["description"]


def test_steps_mapped():
    p = payload()
    assert len(p["steps"]) == 2
    assert p["steps"][0]["action"] == "Открыть форму логина"
    assert p["steps"][0]["expected"] == "Форма открыта"
    assert p["steps"][0]["testData"] == "URL: /login"


def test_precondition_steps_mapped():
    p = payload()
    assert len(p["preconditionSteps"]) == 1
    assert p["preconditionSteps"][0]["action"] == "Пользователь зарегистрирован"


def test_attributes_from_source():
    p = build_draft_payload(IMPROVED, "6109", "project-uuid", "section-uuid", source_attributes={"attr-id": ["val-id"]})
    assert p["attributes"] == {"attr-id": ["val-id"]}


def test_attributes_empty_when_no_source():
    p = payload()
    assert p["attributes"] == {}


def test_duration_default_when_missing():
    tc = {**IMPROVED, "duration": None}
    p = build_draft_payload(tc, "6109", "project-uuid", "section-uuid")
    assert p["duration"] == 60000


def test_entity_type_name():
    p = payload()
    assert p["entityTypeName"] == "TestCases"


def test_duration_preserved():
    p = payload()
    assert p["duration"] == 120000


def test_empty_steps_allowed():
    improved = {**IMPROVED, "steps": []}
    p = build_draft_payload(improved, "6109", "proj", "sect")
    assert p["steps"] == []
