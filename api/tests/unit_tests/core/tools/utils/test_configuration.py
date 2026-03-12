from __future__ import annotations

from collections.abc import Generator
from typing import Any
from unittest.mock import patch

from core.app.entities.app_invoke_entities import InvokeFrom
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
    ) -> Generator[ToolInvokeMessage, None, None]:
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


def test_decrypt_tool_parameters_cache_hit_and_miss():
    manager = _build_manager()

    with patch("core.tools.utils.configuration.ToolParameterCache") as cache_cls:
        cache = cache_cls.return_value
        cache.get.return_value = {"secret": "cached"}
        assert manager.decrypt_tool_parameters({"secret": "enc"}) == {"secret": "cached"}
        cache.set.assert_not_called()

    with patch("core.tools.utils.configuration.ToolParameterCache") as cache_cls:
        cache = cache_cls.return_value
        cache.get.return_value = None
        with patch("core.tools.utils.configuration.encrypter.decrypt_token", return_value="dec"):
            decrypted = manager.decrypt_tool_parameters({"secret": "enc", "plain": "x"})

    assert decrypted["secret"] == "dec"
    cache.set.assert_called_once()


def test_delete_tool_parameters_cache():
    manager = _build_manager()

    with patch("core.tools.utils.configuration.ToolParameterCache") as cache_cls:
        manager.delete_tool_parameters_cache()

    cache_cls.return_value.delete.assert_called_once()


def test_configuration_manager_decrypt_suppresses_errors():
    manager = _build_manager()
    with patch("core.tools.utils.configuration.ToolParameterCache") as cache_cls:
        cache = cache_cls.return_value
        cache.get.return_value = None
        with patch("core.tools.utils.configuration.encrypter.decrypt_token", side_effect=RuntimeError("boom")):
            decrypted = manager.decrypt_tool_parameters({"secret": "enc"})
    # decryption failure is suppressed, original value is retained.
    assert decrypted["secret"] == "enc"
