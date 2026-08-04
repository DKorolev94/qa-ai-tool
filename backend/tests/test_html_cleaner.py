import pytest
from app.parsing.html_cleaner import clean_html


def test_removes_html_tags():
    result = clean_html("<b>Hello</b> <i>World</i>")
    assert "<b>" not in result
    assert "Hello" in result
    assert "World" in result


def test_plain_text_unchanged():
    result = clean_html("Just plain text")
    assert result == "Just plain text"


def test_br_becomes_newline():
    result = clean_html("Line1<br>Line2")
    assert "Line1" in result
    assert "Line2" in result
    assert "\n" in result


def test_p_becomes_newline():
    result = clean_html("<p>Para1</p><p>Para2</p>")
    assert "Para1" in result
    assert "Para2" in result
    lines = [l for l in result.splitlines() if l.strip()]
    assert len(lines) >= 2


def test_div_becomes_newline():
    result = clean_html("<div>Block1</div><div>Block2</div>")
    assert "Block1" in result
    assert "Block2" in result


def test_li_becomes_newline():
    result = clean_html("<ul><li>Item1</li><li>Item2</li></ul>")
    assert "Item1" in result
    assert "Item2" in result


def test_script_removed():
    result = clean_html('<script>alert("xss")</script>Clean text')
    assert "alert" not in result
    assert "Clean text" in result


def test_style_removed():
    result = clean_html("<style>body { color: red; }</style>Text")
    assert "color" not in result
    assert "Text" in result


def test_empty_input_returns_empty():
    assert clean_html("") == ""
    assert clean_html("   ") == ""


def test_html_entities_decoded():
    result = clean_html("&lt;tag&gt; &amp; text")
    assert "<tag>" in result
    assert "&" in result


def test_no_excessive_blank_lines():
    result = clean_html("<p>A</p><p></p><p></p><p>B</p>")
    blank_lines = sum(1 for line in result.splitlines() if not line.strip())
    assert blank_lines <= 2


def test_strikethrough_content_dropped():
    result = clean_html('<p><s>Voided step</s></p><p>Live note</p>')
    assert "Voided step" not in result
    assert "Live note" in result


def test_del_and_strike_tags_dropped():
    assert "Old" not in clean_html("<del>Old</del>New")
    assert "Old" not in clean_html("<strike>Old</strike>New")


def test_complex_testcase_html():
    html = "<p>Шаг 1<br>Открыть страницу</p><p>Ожидаемый результат: страница открыта</p>"
    result = clean_html(html)
    assert "Шаг 1" in result
    assert "Открыть страницу" in result
    assert "Ожидаемый результат: страница открыта" in result
