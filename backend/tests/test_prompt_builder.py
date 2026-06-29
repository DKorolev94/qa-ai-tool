from app.core.prompt_builder import build_improve_prompt, build_review_prompt


def test_atomicity_review_prompt_treats_form_and_sms_as_one_flow():
    prompt = build_review_prompt(["atomicity"])

    assert "перейти на экран подтверждения SMS" in prompt
    assert "одним пользовательским потоком" in prompt
    assert "Если issue действительно описывает" not in prompt


def test_atomicity_improve_prompt_can_close_false_positive():
    prompt = build_improve_prompt(["atomicity"])

    assert "ложноположительным" in prompt
    assert "Нарушения атомарности нет" in prompt
    assert "manual_needed" in prompt
