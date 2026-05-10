"""Tests for the SDK key extraction helper.

Full middleware integration (FastAPI + httpx test client) lives in
``test_chat_blocking.py`` once the chat router is wired up.
"""

from __future__ import annotations

import pytest

from gateway.errors import InvalidSdkKeyError
from gateway.middleware.auth import extract_sdk_key


class TestExtractSdkKey:
    def test_valid_bearer_returns_key(self) -> None:
        assert extract_sdk_key("Bearer bsa_dev_abc123") == "bsa_dev_abc123"

    def test_strips_surrounding_whitespace(self) -> None:
        assert extract_sdk_key("  Bearer bsa_dev_abc123  ") == "bsa_dev_abc123"

    def test_strips_internal_whitespace_after_bearer(self) -> None:
        assert extract_sdk_key("Bearer    bsa_x") == "bsa_x"

    def test_missing_header_raises(self) -> None:
        with pytest.raises(InvalidSdkKeyError) as ei:
            extract_sdk_key(None)
        assert "missing" in ei.value.message.lower()
        assert ei.value.param == "authorization"

    def test_empty_header_raises(self) -> None:
        with pytest.raises(InvalidSdkKeyError):
            extract_sdk_key("")

    def test_non_bearer_scheme_raises(self) -> None:
        with pytest.raises(InvalidSdkKeyError, match="Bearer"):
            extract_sdk_key("Basic dXNlcjpwdw==")

    def test_bearer_without_key_raises(self) -> None:
        with pytest.raises(InvalidSdkKeyError, match="empty"):
            extract_sdk_key("Bearer ")

    def test_case_sensitive_bearer_required(self) -> None:
        # OpenAI uses "Bearer " (capital B); we mirror that strictness.
        with pytest.raises(InvalidSdkKeyError):
            extract_sdk_key("bearer bsa_x")
