"""Unit tests for the Weaviate Engram memory wrapper (core/memory/engram)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.memory.engram import EngramMemory, build_engram_memory
from core.memory.engram import engram_memory as engram_module


@pytest.fixture(autouse=True)
def _reset_clients():
    """Reset the per-credential client cache around each test."""
    engram_module._engram_clients = {}
    yield
    engram_module._engram_clients = {}


def _memory(user_id="u1", api_key="key-123", endpoint=None, conversation_id=None):
    return EngramMemory(user_id=user_id, api_key=api_key, endpoint=endpoint, conversation_id=conversation_id)


def _scope(enabled: bool):
    return patch.object(engram_module.dify_config, "ENGRAM_CONVERSATION_SCOPE_ENABLED", enabled)


class TestStore:
    def test_noop_without_api_key(self):
        assert EngramMemory(user_id="u1", api_key="").store("hello") is None

    def test_noop_without_user_id(self):
        assert EngramMemory(user_id="", api_key="key-123").store("hello") is None

    def test_calls_add_with_conversation_scope_when_enabled(self):
        client = MagicMock()
        client.memories.add.return_value = SimpleNamespace(run_id="run-1")
        with _scope(True), patch.object(engram_module, "_get_client", return_value=client):
            run_id = _memory(conversation_id="c1").store([{"role": "user", "content": "hi"}])
        assert run_id == "run-1"
        client.memories.add.assert_called_once_with(
            [{"role": "user", "content": "hi"}],
            user_id="u1",
            properties={"conversation_id": "c1"},
        )

    def test_no_scope_property_when_conversation_scope_disabled(self):
        client = MagicMock()
        client.memories.add.return_value = SimpleNamespace(run_id="run-1")
        with _scope(False), patch.object(engram_module, "_get_client", return_value=client):
            _memory(conversation_id="c1").store("hello")
        assert client.memories.add.call_args.kwargs["properties"] is None

    def test_uses_client_for_its_credentials(self):
        client = MagicMock()
        client.memories.add.return_value = SimpleNamespace(run_id="run-1")
        with _scope(False), patch.object(engram_module, "_get_client", return_value=client) as get_client:
            _memory(api_key="key-abc", endpoint="https://e").store("hello")
        get_client.assert_called_once_with("key-abc", "https://e")

    def test_swallows_errors(self):
        client = MagicMock()
        client.memories.add.side_effect = RuntimeError("boom")
        with _scope(False), patch.object(engram_module, "_get_client", return_value=client):
            assert _memory().store("hello") is None


class TestRecall:
    def test_noop_without_api_key(self):
        assert EngramMemory(user_id="u1", api_key="").recall("q") is None

    def test_noop_without_query(self):
        assert _memory().recall("") is None

    def test_formats_results_as_bullets(self):
        client = MagicMock()
        client.memories.search.return_value = [
            SimpleNamespace(content="likes dark mode"),
            SimpleNamespace(content="lives in Berlin"),
        ]
        with _scope(False), patch.object(engram_module, "_get_client", return_value=client):
            result = _memory().recall("preferences")
        assert result == "- likes dark mode\n- lives in Berlin"
        client.memories.search.assert_called_once_with(query="preferences", user_id="u1", properties=None)

    def test_recall_filters_by_conversation_scope_when_enabled(self):
        client = MagicMock()
        client.memories.search.return_value = [SimpleNamespace(content="likes dark mode")]
        with _scope(True), patch.object(engram_module, "_get_client", return_value=client):
            _memory(conversation_id="c1").recall("preferences")
        client.memories.search.assert_called_once_with(
            query="preferences", user_id="u1", properties={"conversation_id": "c1"}
        )

    def test_respects_top_k(self):
        client = MagicMock()
        client.memories.search.return_value = [SimpleNamespace(content=f"m{i}") for i in range(10)]
        with _scope(False), patch.object(engram_module, "_get_client", return_value=client):
            result = _memory().recall("q", top_k=3)
        assert result == "- m0\n- m1\n- m2"

    def test_none_when_empty(self):
        client = MagicMock()
        client.memories.search.return_value = []
        with _scope(False), patch.object(engram_module, "_get_client", return_value=client):
            assert _memory().recall("q") is None

    def test_swallows_errors(self):
        client = MagicMock()
        client.memories.search.side_effect = RuntimeError("boom")
        with _scope(False), patch.object(engram_module, "_get_client", return_value=client):
            assert _memory().recall("q") is None


class TestBuildEngramMemory:
    def test_none_when_disabled(self):
        assert build_engram_memory(user_id="u1", tenant_id="t1", enabled=False, api_key_encrypted="enc") is None

    def test_none_without_user_id(self):
        assert build_engram_memory(user_id="", tenant_id="t1", enabled=True, api_key_encrypted="enc") is None

    def test_uses_decrypted_per_app_key(self):
        with patch.object(engram_module, "decrypt_token", return_value="plain-key") as dec:
            mem = build_engram_memory(
                user_id="u1", tenant_id="t1", enabled=True, api_key_encrypted="enc", endpoint="https://own"
            )
        dec.assert_called_once_with("t1", "enc")
        assert mem is not None
        assert mem._api_key == "plain-key"
        assert mem._endpoint == "https://own"

    def test_falls_back_to_deployment_key_when_app_key_blank(self):
        with (
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", True),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", "deploy-key"),
            patch.object(engram_module.dify_config, "ENGRAM_ENDPOINT", "https://deploy"),
        ):
            mem = build_engram_memory(user_id="u1", tenant_id="t1", enabled=True, api_key_encrypted=None)
        assert mem is not None
        assert mem._api_key == "deploy-key"
        assert mem._endpoint == "https://deploy"

    def test_app_endpoint_wins_over_deployment_when_inheriting_key(self):
        with (
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", True),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", "deploy-key"),
            patch.object(engram_module.dify_config, "ENGRAM_ENDPOINT", "https://deploy"),
        ):
            mem = build_engram_memory(
                user_id="u1", tenant_id="t1", enabled=True, api_key_encrypted=None, endpoint="https://app"
            )
        assert mem is not None
        assert mem._endpoint == "https://app"

    def test_no_deployment_fallback_when_deployment_disabled(self):
        with (
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", False),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", "deploy-key"),
        ):
            assert build_engram_memory(user_id="u1", tenant_id="t1", enabled=True, api_key_encrypted=None) is None

    def test_none_when_no_key_resolvable(self):
        with (
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", True),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", None),
        ):
            assert build_engram_memory(user_id="u1", tenant_id="t1", enabled=True, api_key_encrypted=None) is None

    def test_swallows_decrypt_failure_and_falls_back(self):
        with (
            patch.object(engram_module, "decrypt_token", side_effect=RuntimeError("bad key")),
            patch.object(engram_module.dify_config, "ENGRAM_ENABLED", True),
            patch.object(engram_module.dify_config, "ENGRAM_API_KEY", "deploy-key"),
        ):
            mem = build_engram_memory(user_id="u1", tenant_id="t1", enabled=True, api_key_encrypted="enc")
        assert mem is not None
        assert mem._api_key == "deploy-key"


class TestGetClientCache:
    def test_caches_per_credentials(self):
        fake_client_cls = MagicMock(side_effect=lambda **kwargs: MagicMock())
        with patch.dict("sys.modules", {"engram": SimpleNamespace(EngramClient=fake_client_cls)}):
            c1 = engram_module._get_client("k1", None)
            c2 = engram_module._get_client("k1", None)
            c3 = engram_module._get_client("k2", "https://e")
        assert c1 is c2
        assert c1 is not c3
        assert fake_client_cls.call_count == 2
