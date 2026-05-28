from unittest.mock import MagicMock, patch

from app.schemas.analysis import AnalysisIssue, AnalyzedTestCase, ImproveResult, ReviewResult
from app.schemas.analysis import AnalysisStep

SAMPLE_TESTCASE = {"title": "Login test", "steps": [{"action": "Open page", "expected": "Loaded"}]}
SAMPLE_ISSUES = [{"severity": "high", "title": "No expected result", "description": "...", "recommendation": "Add it"}]


def _mock_review_result() -> ReviewResult:
    return ReviewResult(
        summary="Good test",
        issues=[AnalysisIssue(severity="low", title="Weak title", description="D", recommendation="R")],
    )


def _mock_improve_result() -> ImproveResult:
    return ImproveResult(
        improved_testcase=AnalyzedTestCase(
            title="Improved",
            steps=[AnalysisStep(action="Open page", expected="Loaded")],
        ),
        issue_resolutions=[],
    )


def test_analyze_returns_review_result():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_review_result()
        mock_get.return_value = mock_client

        result = analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="testit")

    assert isinstance(result, ReviewResult)
    assert result.summary == "Good test"
    assert len(result.issues) == 1


def test_analyze_uses_correct_prompt_for_testit():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_review_result()
        mock_get.return_value = mock_client

        analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="testit")

    call_kwargs = mock_client.chat.completions.create.call_args
    system_msg = call_kwargs[1]["messages"][0]["content"]
    assert len(system_msg) > 50


def test_analyze_uses_different_prompt_for_manual():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_review_result()
        mock_get.return_value = mock_client

        analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="manual")

    call_kwargs = mock_client.chat.completions.create.call_args
    system_msg = call_kwargs[1]["messages"][0]["content"]
    assert len(system_msg) > 50


def test_analyze_fallback_on_llm_error():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = Exception("Connection refused")
        mock_get.return_value = mock_client

        result = analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="testit")

    assert isinstance(result, ReviewResult)
    assert len(result.warnings) > 0
    assert "unavailable" in result.warnings[0].lower()


def test_improve_returns_improve_result():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_improve_result()
        mock_get.return_value = mock_client

        result = improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES, source_type="testit")

    assert isinstance(result, ImproveResult)
    assert result.improved_testcase.title == "Improved"


def test_improve_fallback_on_llm_error():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = Exception("Connection refused")
        mock_get.return_value = mock_client

        result = improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES, source_type="testit")

    assert isinstance(result, ImproveResult)
    assert len(result.warnings) > 0
    assert "unavailable" in result.warnings[0].lower()


def test_improve_passes_issues_in_user_message():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_improve_result()
        mock_get.return_value = mock_client

        improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES, source_type="testit")

    call_kwargs = mock_client.chat.completions.create.call_args
    user_msg = call_kwargs[1]["messages"][1]["content"]
    assert "No expected result" in user_msg
