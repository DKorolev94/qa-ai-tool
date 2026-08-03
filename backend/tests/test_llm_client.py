from unittest.mock import MagicMock, patch

from app.schemas.analysis import AnalysisStep, AnalyzedTestCase, ImproveResult, IssueResolution, _LLMIssue, _LLMReviewResult

SAMPLE_TESTCASE = {"title": "Login test", "steps": [{"action": "Open page", "expected": "Loaded"}]}
SAMPLE_ISSUES = [{"severity": "high", "title": "No expected result", "description": "...", "recommendation": "Add it"}]


def _mock_llm_review() -> _LLMReviewResult:
    return _LLMReviewResult(
        reasoning="title: title is weak. Other rules: no issues.",
        summary="Good test",
        issues=[_LLMIssue(rule="title", severity="low", problem="Weak title", recommendation="Fix it")],
        warnings=[],
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
    from app.schemas.analysis import ReviewResult

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_llm_review()
        result = analyze_testcase_with_llm(SAMPLE_TESTCASE)

    assert isinstance(result, ReviewResult)
    assert result.summary == "Good test"
    assert len(result.issues) == 1


def test_analyze_uses_correct_prompt_for_testit():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_llm_review()
        analyze_testcase_with_llm(SAMPLE_TESTCASE)

    call_kwargs = mock_client.chat.completions.create.call_args
    system_msg = call_kwargs[1]["messages"][0]["content"]
    assert len(system_msg) > 50


def test_analyze_uses_different_prompt_for_manual():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_llm_review()
        analyze_testcase_with_llm(SAMPLE_TESTCASE)

    call_kwargs = mock_client.chat.completions.create.call_args
    system_msg = call_kwargs[1]["messages"][0]["content"]
    assert len(system_msg) > 50


def test_analyze_fallback_on_llm_error():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.side_effect = Exception("Connection refused")
        result = analyze_testcase_with_llm(SAMPLE_TESTCASE)

    from app.schemas.analysis import ReviewResult
    assert isinstance(result, ReviewResult)
    assert len(result.warnings) > 0
    assert "unavailable" in result.warnings[0].lower()


def test_improve_returns_improve_result():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_improve_result()
        result = improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES)

    assert isinstance(result, ImproveResult)
    assert result.improved_testcase.title == "Improved"


def test_improve_raises_on_llm_error():
    import pytest
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.side_effect = Exception("Connection refused")
        with pytest.raises(RuntimeError, match="LLM improve"):
            improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES)


def test_improve_passes_issues_in_user_message():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_improve_result()
        improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES)

    call_kwargs = mock_client.chat.completions.create.call_args
    user_msg = call_kwargs[1]["messages"][1]["content"]
    assert "No expected result" in user_msg


def test_is_ollama_endpoint_detects_local_ollama():
    from app.core.llm_client import _is_ollama_endpoint

    assert _is_ollama_endpoint("http://localhost:11434/v1")
    assert _is_ollama_endpoint("http://host.docker.internal:11434/v1")
    assert _is_ollama_endpoint("https://my-ollama-server.internal/v1")


def test_is_ollama_endpoint_rejects_cloud_providers():
    from app.core.llm_client import _is_ollama_endpoint

    assert not _is_ollama_endpoint("https://api.openai.com/v1")
    assert not _is_ollama_endpoint("https://my-proxy.internal/openai/v1")


def test_extra_body_omits_num_ctx_for_openai_even_when_configured():
    # num_ctx is an Ollama-only option — OpenAI rejects it with a hard 400
    # ("Unrecognized request argument supplied: options") instead of ignoring
    # it, so this must never be sent when LLM_BASE_URL points at OpenAI.
    from app.core.llm_client import _extra_body
    from app.core.config import settings

    with patch.object(settings, "LLM_NUM_CTX", 8192), patch.object(settings, "LLM_BASE_URL", "https://api.openai.com/v1"):
        assert _extra_body() == {}


def test_extra_body_includes_num_ctx_for_ollama():
    from app.core.llm_client import _extra_body
    from app.core.config import settings

    with patch.object(settings, "LLM_NUM_CTX", 8192), patch.object(settings, "LLM_BASE_URL", "http://localhost:11434/v1"):
        assert _extra_body() == {"options": {"num_ctx": 8192}}


def test_extra_body_empty_when_num_ctx_unset():
    from app.core.llm_client import _extra_body
    from app.core.config import settings

    with patch.object(settings, "LLM_NUM_CTX", None), patch.object(settings, "LLM_BASE_URL", "http://localhost:11434/v1"):
        assert _extra_body() == {}
