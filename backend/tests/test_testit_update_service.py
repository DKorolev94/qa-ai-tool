import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.tms.testit.client import TestItConfigError
from app.tms.testit.update_service import apply_to_original_in_testit


def run(coro):
    return asyncio.run(coro)


def test_missing_project_uuid_raises_with_code():
    with patch(
        "app.tms.testit.update_service.settings",
        SimpleNamespace(TESTIT_PROJECT_UUID=None, TESTIT_BASE_URL="https://testit.example.com"),
    ):
        with pytest.raises(TestItConfigError) as exc_info:
            run(apply_to_original_in_testit({}, "6109"))
    assert exc_info.value.code == "testit_project_uuid_missing"
