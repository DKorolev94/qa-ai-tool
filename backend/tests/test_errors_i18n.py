import pytest
from app.core.errors_i18n import localize


def test_localize_known_code_russian():
    assert localize("testit_auth_failed", "ru") == "Ошибка авторизации в TestIT. Проверьте TESTIT_PRIVATE_TOKEN."


def test_localize_known_code_english():
    assert localize("testit_auth_failed", "en") == "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN."


def test_localize_fills_params():
    result = localize("testit_not_found", "ru", id="6109")
    assert result == "Тест-кейс не найден в TestIT: 6109"


def test_localize_unknown_language_falls_back_to_english():
    result = localize("testit_auth_failed", "fr")
    assert result == "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN."


def test_localize_unknown_code_falls_back_to_code_itself():
    assert localize("some_未知_code", "ru") == "some_未知_code"
