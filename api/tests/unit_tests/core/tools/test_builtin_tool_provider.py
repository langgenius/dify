from __future__ import annotations

from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderEntity, ToolProviderType
from core.tools.errors import ToolProviderNotFoundError


class _FakeBuiltinTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        yield self.create_text_message("ok")


class _ConcreteBuiltinProvider(BuiltinToolProviderController):
    last_validation: tuple[str, dict[str, Any]] | None = None

    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        self.last_validation = (user_id, credentials)


def _provider_yaml() -> dict[str, Any]:
    return {
        "identity": {
            "author": "Dify",
            "name": "fake_provider",
            "label": {"en_US": "Fake Provider"},
            "description": {"en_US": "Fake description"},
            "icon": "icon.svg",
            "tags": ["utilities"],
        },
        "credentials_for_provider": {
            "api_key": {
                "type": "secret-input",
                "required": True,
            }
        },
        "oauth_schema": {
            "client_schema": [
                {
                    "name": "client_id",
                    "type": "text-input",
                }
            ],
            "credentials_schema": [
                {
                    "name": "access_token",
                    "type": "secret-input",
                }
            ],
        },
    }


def _tool_yaml() -> dict[str, Any]:
    return {
        "identity": {
            "author": "Dify",
            "name": "tool_a",
            "label": {"en_US": "Tool A"},
        },
        "parameters": [],
    }


def test_builtin_tool_provider_init_load_tools_and_basic_accessors(monkeypatch):
    yaml_payloads = [_provider_yaml(), _tool_yaml()]

    def _load_yaml(*args, **kwargs):
        return yaml_payloads.pop(0)

    monkeypatch.setattr("core.tools.builtin_tool.provider.load_yaml_file_cached", _load_yaml)
    monkeypatch.setattr(
        "core.tools.builtin_tool.provider.listdir",
        lambda *args, **kwargs: ["tool_a.yaml", "__init__.py", "readme.md"],
    )
    monkeypatch.setattr(
        "core.tools.builtin_tool.provider.load_single_subclass_from_source",
        lambda *args, **kwargs: _FakeBuiltinTool,
    )
    provider = _ConcreteBuiltinProvider()

    assert provider.get_credentials_schema()
    assert provider.get_tools()
    assert provider.get_tool("tool_a") is not None
    assert provider.get_tool("missing") is None
    assert provider.provider_type == ToolProviderType.BUILT_IN
    assert provider.tool_labels == ["utilities"]
    assert provider.need_credentials is True

    oauth_schema = provider.get_credentials_schema_by_type(CredentialType.OAUTH2.value)
    assert len(oauth_schema) == 1
    api_schema = provider.get_credentials_schema_by_type(CredentialType.API_KEY)
    assert len(api_schema) == 1
    assert provider.get_oauth_client_schema()[0].name == "client_id"
    assert set(provider.get_supported_credential_types()) == {CredentialType.API_KEY, CredentialType.OAUTH2}


def test_builtin_tool_provider_invalid_credential_type_and_validate_credentials():
    with patch(
        "core.tools.builtin_tool.provider.load_yaml_file_cached",
        side_effect=[_provider_yaml(), _tool_yaml()],
    ):
        with patch("core.tools.builtin_tool.provider.listdir", return_value=["tool_a.yaml"]):
            with patch(
                "core.tools.builtin_tool.provider.load_single_subclass_from_source",
                return_value=_FakeBuiltinTool,
            ):
                provider = _ConcreteBuiltinProvider()

    with pytest.raises(ValueError, match="Invalid credential type"):
        provider.get_credentials_schema_by_type("invalid")

    provider.validate_credentials("user-1", {"api_key": "secret"})
    assert provider.last_validation == ("user-1", {"api_key": "secret"})


def test_builtin_tool_provider_init_raises_when_provider_yaml_missing():
    with patch("core.tools.builtin_tool.provider.load_yaml_file_cached", side_effect=RuntimeError("boom")):
        with pytest.raises(ToolProviderNotFoundError, match="can not load provider yaml"):
            _ConcreteBuiltinProvider()


def test_builtin_tool_provider_handles_empty_credentials_and_oauth():
    provider = object.__new__(_ConcreteBuiltinProvider)
    provider.tools = []
    provider.entity = ToolProviderEntity.model_validate(
        {
            "identity": {
                "author": "Dify",
                "name": "fake_provider",
                "label": {"en_US": "Fake Provider"},
                "description": {"en_US": "Fake description"},
                "icon": "icon.svg",
                "tags": None,
            },
            "credentials_schema": [],
            "oauth_schema": None,
        },
    )

    assert provider.get_oauth_client_schema() == []
    assert provider.get_supported_credential_types() == []
    assert provider.need_credentials is False
    assert provider._get_tool_labels() == []


def test_builtin_tool_provider_forked_tool_runtime_is_initialized():
    with patch(
        "core.tools.builtin_tool.provider.load_yaml_file_cached",
        side_effect=[_provider_yaml(), _tool_yaml()],
    ):
        with patch("core.tools.builtin_tool.provider.listdir", return_value=["tool_a.yaml"]):
            with patch(
                "core.tools.builtin_tool.provider.load_single_subclass_from_source",
                return_value=_FakeBuiltinTool,
            ):
                provider = _ConcreteBuiltinProvider()

    tool = provider.get_tool("tool_a")
    assert tool is not None
    assert isinstance(tool.runtime, ToolRuntime)
    assert tool.runtime.tenant_id == ""
    tool.runtime.invoke_from = InvokeFrom.DEBUGGER
    assert tool.runtime.invoke_from == InvokeFrom.DEBUGGER
