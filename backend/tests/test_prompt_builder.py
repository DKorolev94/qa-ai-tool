from app.core.prompt_builder import build_improve_prompt, build_review_prompt


def test_atomicity_review_prompt_treats_form_and_sms_as_one_flow():
    prompt = build_review_prompt(["atomicity"])

    assert "moving to the SMS confirmation screen" in prompt
    assert "one user flow" in prompt
    assert "If the issue genuinely describes" not in prompt


def test_atomicity_improve_prompt_can_close_false_positive():
    prompt = build_improve_prompt(["atomicity"])

    assert "false positive" in prompt
    assert "No atomicity violation" in prompt
    assert "manual_needed" in prompt


def test_review_prompt_defaults_to_russian_directive():
    prompt = build_review_prompt(None)
    assert "in Russian" in prompt


def test_review_prompt_english_directive():
    prompt = build_review_prompt(None, language="en")
    assert "in English" in prompt
    assert "in Russian" not in prompt


def test_improve_prompt_english_directive():
    prompt = build_improve_prompt(None, language="en")
    assert "in English" in prompt
