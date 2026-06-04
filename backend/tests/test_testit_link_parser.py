import pytest

from app.parsing.testit_link_parser import extract_work_item_id

UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"


def test_plain_numeric_id():
    assert extract_work_item_id("6109") == "6109"


def test_plain_uuid():
    assert extract_work_item_id(UUID) == UUID


def test_whitespace_stripped():
    assert extract_work_item_id("  6109  ") == "6109"


def test_url_raises():
    with pytest.raises(ValueError, match="Could not extract"):
        extract_work_item_id("https://testit.example.com/workItems/6109")


def test_invalid_string_raises():
    with pytest.raises(ValueError, match="Could not extract"):
        extract_work_item_id("not-a-valid-id")


def test_empty_string_raises():
    with pytest.raises(ValueError):
        extract_work_item_id("")
