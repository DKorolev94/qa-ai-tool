from app.core.review_config import get_review_config


def test_default_is_russian():
    config = get_review_config()
    title_rule = next(r for r in config.rules if r.id == "title")
    assert title_rule.label == "Заголовок"


def test_english_labels():
    config = get_review_config("en")
    title_rule = next(r for r in config.rules if r.id == "title")
    assert title_rule.label == "Title"


def test_same_rule_ids_and_order_in_both_languages():
    ru = get_review_config("ru")
    en = get_review_config("en")
    assert [r.id for r in ru.rules] == [r.id for r in en.rules]
    assert [p.id for p in ru.profiles] == [p.id for p in en.profiles]
