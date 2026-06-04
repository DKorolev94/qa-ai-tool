import pytest
from app.parsing.testit_parser import parse_testit_content


def test_returns_description_for_plain_text():
    result = parse_testit_content("Some description text here")
    assert result.description or result.title


def test_extracts_attachments():
    raw = "See file https://example.com/screenshot.png for details"
    result = parse_testit_content(raw)
    assert len(result.attachments) == 1
    assert result.attachments[0].type == "image"
    assert "screenshot.png" in result.attachments[0].url


def test_empty_input_returns_warning():
    result = parse_testit_content("")
    assert len(result.warnings) > 0
    assert result.steps == []
    assert result.preconditions == []


def test_warning_when_no_steps():
    raw = "This is just a description without any steps at all."
    result = parse_testit_content(raw)
    assert any("steps" in w.lower() for w in result.warnings)


def test_extracts_numbered_steps():
    raw = """Login test
1. Open the login page
2. Enter username admin
3. Enter password 12345
4. Click Login button"""
    result = parse_testit_content(raw)
    assert len(result.steps) >= 3
    assert any("Open" in s.action or "login" in s.action.lower() for s in result.steps)


def test_extracts_preconditions():
    raw = """Test title
Preconditions:
User is registered
Browser is open
Steps:
1. Go to login page
2. Enter credentials"""
    result = parse_testit_content(raw)
    assert len(result.preconditions) >= 1


def test_does_not_crash_on_html_input():
    raw = "<p><b>Title</b></p><ul><li>Step 1</li><li>Step 2</li></ul>"
    result = parse_testit_content(raw)
    assert result is not None


def test_title_extracted_from_first_short_line():
    raw = "Login page test\n1. Open page\n2. Click login"
    result = parse_testit_content(raw)
    assert result.title == "Login page test"


def test_no_crash_on_whitespace_only():
    result = parse_testit_content("   \n\n   \t  ")
    assert result.warnings


def test_multiple_attachments():
    raw = """Check attachments
https://example.com/file.pdf
https://example.com/data.xlsx
https://example.com/image.jpg"""
    result = parse_testit_content(raw)
    assert len(result.attachments) == 3
    types = {a.type for a in result.attachments}
    assert "image" in types
    assert "document" in types
    assert "spreadsheet" in types
