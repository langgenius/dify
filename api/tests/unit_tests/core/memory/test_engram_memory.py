"""Unit tests for the Weaviate Engram memory wrapper (core/memory/engram)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.memory.engram import EngramMemory, is_engram_enabled
from core.memory.engram import engram_memory as engram_module


@pytest.fixture(autouse=True)
def _reset_client():
    """Reset the module-level client cache around each test."""
    engram_module._engram_client = None
    yield
    engram_module._engram_client = None


def _enable():
    """Patch dify_config so the feature reports enabled."""
    return [
        patch.object(engram_module.dify_config, "ENGRAM_ENABLED", True),
        patch.object(engram_module.dify_config, "ENGRAM_API_KEY", "key-123"),
        patch.object(engram_module.dify_config, "ENGRAM_RECALL_TOP_K", 5),
    ]


def _start(patches):
    for p in patches:
        p.start()


def _stop(patches):
    for p in patches:
        p.stop()


class TestIsEngramEnabled:
    def test_disabled_by_default(self):
        with (
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", False),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", "key"),
        ):
            assert is_engram_enabled() is False

    def test_enabled_requires_api_key(self):
        with (
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", True),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", None),
        ):
            assert is_engram_enabled() is False

    def test_enabled_when_configured(self):
        with (
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", True),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", "key"),
        ):
            assert is_engram_enabled() is True


class TestStore:
    def test_noop_when_disabled(self):
        with patch.object(engram_module.dify_config, "ENGRAM_ENABLED", False):
            assert EngramMemory(user_id="u1").store("hello") is None

    def test_noop_without_user_id(self):
        patches = _enable()
        _start(patches)
        try:
            assert EngramMemory(user_id="").store("hello") is None
        finally:
            _stop(patches)

    def test_calls_add_with_user_and_properties(self):
        patches = _enable()
        _start(patches)
        try:
            client = MagicMock()
            client.memories.add.return_value = SimpleNamespace(run_id="run-1")
            with patch.object(engram_module, "_get_client", return_value=client):
                run_id = EngramMemory(user_id="u1", conversation_id="c1").store([{"role": "user", "content": "hi"}])
            assert run_id == "run-1"
            client.memories.add.assert_called_once_with(
                [{"role": "user", "content": "hi"}],
                user_id="u1",
                properties={"conversation_id": "c1"},
            )
        finally:
            _stop(patches)

    def test_properties_none_without_conversation(self):
        patches = _enable()
        _start(patches)
        try:
            client = MagicMock()
            client.memories.add.return_value = SimpleNamespace(run_id="run-2")
            with patch.object(engram_module, "_get_client", return_value=client):
                EngramMemory(user_id="u1").store("hello")
            assert client.memories.add.call_args.kwargs["properties"] is None
        finally:
            _stop(patches)

    def test_swallows_errors(self):
        patches = _enable()
        _start(patches)
        try:
            client = MagicMock()
            client.memories.add.side_effect = RuntimeError("boom")
            with patch.object(engram_module, "_get_client", return_value=client):
                assert EngramMemory(user_id="u1").store("hello") is None
        finally:
            _stop(patches)


class TestRecall:
    def test_noop_when_disabled(self):
        with patch.object(engram_module.dify_config, "ENGRAM_ENABLED", False):
            assert EngramMemory(user_id="u1").recall("query") is None

    def test_noop_without_query(self):
        patches = _enable()
        _start(patches)
        try:
            assert EngramMemory(user_id="u1").recall("") is None
        finally:
            _stop(patches)

    def test_formats_results_as_bullets(self):
        patches = _enable()
        _start(patches)
        try:
            client = MagicMock()
            client.memories.search.return_value = [
                SimpleNamespace(content="likes dark mode"),
                SimpleNamespace(content="lives in Berlin"),
            ]
            with patch.object(engram_module, "_get_client", return_value=client):
                result = EngramMemory(user_id="u1").recall("preferences")
            assert result == "- likes dark mode\n- lives in Berlin"
            client.memories.search.assert_called_once_with(query="preferences", user_id="u1")
        finally:
            _stop(patches)

    def test_respects_top_k(self):
        patches = _enable()
        _start(patches)
        try:
            client = MagicMock()
            client.memories.search.return_value = [SimpleNamespace(content=f"m{i}") for i in range(10)]
            with patch.object(engram_module, "_get_client", return_value=client):
                result = EngramMemory(user_id="u1").recall("q", top_k=2)
            assert result == "- m0\n- m1"
        finally:
            _stop(patches)

    def test_returns_none_when_empty(self):
        patches = _enable()
        _start(patches)
        try:
            client = MagicMock()
            client.memories.search.return_value = []
            with patch.object(engram_module, "_get_client", return_value=client):
                assert EngramMemory(user_id="u1").recall("q") is None
        finally:
            _stop(patches)

    def test_swallows_errors(self):
        patches = _enable()
        _start(patches)
        try:
            client = MagicMock()
            client.memories.search.side_effect = RuntimeError("boom")
            with patch.object(engram_module, "_get_client", return_value=client):
                assert EngramMemory(user_id="u1").recall("q") is None
        finally:
            _stop(patches)
