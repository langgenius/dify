from __future__ import annotations

from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.helper.tool_parameter_cache import ToolParameterCache
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)
from core.tools.utils.configuration import ToolParameterConfigurationManager


class _DummyTool(Tool):
    runtime_overrides: list[ToolParameter]

    def __init__(self, entity: ToolEntity, runtime: ToolRuntime, runtime_overrides: list[ToolParameter]):
        super().__init__(entity=entity, runtime=runtime)
        self.runtime_overrides = runtime_overrides

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage]:
        yield self.create_text_message("ok")

    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        return self.runtime_overrides


def _param(
    name: str,
    *,
    typ: ToolParameter.ToolParameterType,
    form: ToolParameter.ToolParameterForm,
    required: bool = False,
) -> ToolParameter:
    return ToolParameter(
        name=name,
        label=I18nObject(en_US=name),
        placeholder=I18nObject(en_US=""),
        human_description=I18nObject(en_US=""),
        type=typ,
        form=form,
        required=required,
        default=None,
    )


def _build_manager() -> ToolParameterConfigurationManager:
    base_params = [
        _param("secret", typ=ToolParameter.ToolParameterType.SECRET_INPUT, form=ToolParameter.ToolParameterForm.FORM),
        _param("plain", typ=ToolParameter.ToolParameterType.STRING, form=ToolParameter.ToolParameterForm.FORM),
    ]
    runtime_overrides = [
        _param("secret", typ=ToolParameter.ToolParameterType.SECRET_INPUT, form=ToolParameter.ToolParameterForm.FORM),
        _param("runtime_only", typ=ToolParameter.ToolParameterType.STRING, form=ToolParameter.ToolParameterForm.FORM),
    ]
    entity = ToolEntity(
        identity=ToolIdentity(author="a", name="tool-a", label=I18nObject(en_US="tool-a"), provider="provider-a"),
        parameters=base_params,
    )
    runtime = ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER)
    tool = _DummyTool(entity=entity, runtime=runtime, runtime_overrides=runtime_overrides)
    return ToolParameterConfigurationManager(
        tenant_id="tenant-1",
        tool_runtime=tool,
        provider_name="provider-a",
        provider_type=ToolProviderType.BUILT_IN,
        identity_id="ID.1",
    )


def test_merge_and_mask_parameters():
    manager = _build_manager()

    masked = manager.mask_tool_parameters({"secret": "abcdefghi", "plain": "x", "runtime_only": "y"})
    assert masked["secret"] == "ab*****hi"
    assert masked["plain"] == "x"
    assert masked["runtime_only"] == "y"


def test_encrypt_tool_parameters():
    manager = _build_manager()

    with patch("core.tools.utils.configuration.encrypter.encrypt_token", return_value="enc"):
        encrypted = manager.encrypt_tool_parameters({"secret": "raw", "plain": "x"})

    assert encrypted["secret"] == "enc"
    assert encrypted["plain"] == "x"


def test_decrypt_tool_parameters_cache_hit_and_miss(monkeypatch: pytest.MonkeyPatch):
    manager = _build_manager()

    # cache miss: parameters are decrypted and cached
    with (
        patch.object(ToolParameterCache, "get", return_value=None),
        patch.object(ToolParameterCache, "set") as mock_set,
        patch("core.tools.utils.configuration.encrypter.decrypt_token", return_value="dec"),
    ):
        decrypted = manager.decrypt_tool_parameters({"secret": "enc", "plain": "x"})
        assert decrypted["secret"] == "dec"
        mock_set.assert_called_once()

    # cache hit with a matching fingerprint: the cached value is served as-is
    fingerprint = manager._fingerprint_of_secret_inputs({"secret": "enc", "plain": "x"})
    with (
        patch.object(
            ToolParameterCache,
            "get",
            return_value={"secret": "cached", "plain": "x", "__cache_fingerprint": fingerprint},
        ),
        patch.object(ToolParameterCache, "set") as mock_set,
    ):
        assert manager.decrypt_tool_parameters({"secret": "enc", "plain": "x"}) == {"secret": "cached", "plain": "x"}
        mock_set.assert_not_called()


def test_delete_tool_parameters_cache():
    manager = _build_manager()

    with patch.object(ToolParameterCache, "delete") as mock_delete:
        manager.delete_tool_parameters_cache()

    mock_delete.assert_called_once()


def test_configuration_manager_decrypt_suppresses_errors(monkeypatch: pytest.MonkeyPatch):
    manager = _build_manager()
    with (
        patch.object(ToolParameterCache, "get", return_value=None),
        patch("core.tools.utils.configuration.encrypter.decrypt_token", side_effect=RuntimeError("boom")),
    ):
        decrypted = manager.decrypt_tool_parameters({"secret": "enc"})
    # decryption failure is suppressed, original value is retained.
    assert decrypted["secret"] == "enc"


def test_decrypt_tool_parameters_must_not_leak_stale_values_across_loop_iterations():
    """Regression test for https://github.com/langgenius/dify/issues/40920.

    Inside a loop/iteration node the cache identity is ``WORKFLOW.{app_id}.{node_id}``,
    which stays constant across iterations. A cache hit used to return the entire
    cached parameter dict, silently discarding the freshly rendered values of the
    current iteration (e.g. a dynamically bound ``secret-input`` such as a webhook key).
    """
    manager = _build_manager()

    # Iteration 1: cache miss -> decrypt and cache the parameters.
    with (
        patch.object(ToolParameterCache, "get", return_value=None),
        patch.object(ToolParameterCache, "set") as mock_set,
        patch("core.tools.utils.configuration.encrypter.decrypt_token", return_value="secret-A"),
    ):
        first = manager.decrypt_tool_parameters({"secret": "enc-A", "plain": "one"})
        assert first == {"secret": "secret-A", "plain": "one"}
        mock_set.assert_called_once()

    # Iteration 2: cache hit, but the freshly rendered values are different.
    with (
        patch.object(ToolParameterCache, "get", return_value={"secret": "secret-A", "plain": "one"}),
        patch.object(ToolParameterCache, "set") as mock_set,
        patch("core.tools.utils.configuration.encrypter.decrypt_token", return_value="secret-B"),
    ):
        second = manager.decrypt_tool_parameters({"secret": "enc-B", "plain": "two"})
        # The stale cached secret must not overwrite the current iteration's value...
        assert second["secret"] == "secret-B"
        # ...and non-secret parameters must not be clobbered by the cached dict either.
        assert second["plain"] == "two"
        # the legacy (fingerprint-less) cache entry is stale, so it is refreshed
        mock_set.assert_called_once()


def test_decrypt_tool_parameters_cache_hit_still_serves_static_secret():
    """A statically configured secret (same ciphertext on every call) must keep
    benefiting from the decrypt cache instead of being decrypted again."""
    manager = _build_manager()

    fingerprint = manager._fingerprint_of_secret_inputs({"secret": "enc-A", "plain": "one"})
    with (
        patch.object(
            ToolParameterCache,
            "get",
            return_value={"secret": "cached-plain", "plain": "one", "__cache_fingerprint": fingerprint},
        ),
        patch.object(ToolParameterCache, "set") as mock_set,
        patch("core.tools.utils.configuration.encrypter.decrypt_token") as mock_decrypt,
    ):
        decrypted = manager.decrypt_tool_parameters({"secret": "enc-A", "plain": "one"})

    assert decrypted["secret"] == "cached-plain"
    mock_decrypt.assert_not_called()
    mock_set.assert_not_called()


def test_decrypt_tool_parameters_legacy_cache_without_fingerprint_is_stale():
    """Cache entries written before the fingerprint existed (or by an older
    version) must be treated as stale so deployments self-heal within the TTL."""
    manager = _build_manager()

    with (
        patch.object(ToolParameterCache, "get", return_value={"secret": "stale-plain", "plain": "one"}),
        patch.object(ToolParameterCache, "set") as mock_set,
        patch("core.tools.utils.configuration.encrypter.decrypt_token", return_value="fresh-plain"),
    ):
        decrypted = manager.decrypt_tool_parameters({"secret": "enc-A", "plain": "one"})

    assert decrypted["secret"] == "fresh-plain"
    mock_set.assert_called_once()
