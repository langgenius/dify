from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from core.entities.provider_entities import ProviderConfig
from core.tools.__base.tool import Tool
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.errors import ToolProviderCredentialValidationError


class _DummyTool(Tool):
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


class _DummyController(ToolProviderController):
    def get_tool(self, tool_name: str) -> Tool:
        entity = ToolEntity(
            identity=ToolIdentity(
                author="author",
                name=tool_name,
                label=I18nObject(en_US=tool_name),
                provider="provider",
            ),
            parameters=[],
        )
        return _DummyTool(entity=entity, runtime=ToolRuntime(tenant_id="tenant"))


def _provider_identity() -> ToolProviderIdentity:
    return ToolProviderIdentity(
        author="author",
        name="provider",
        description=I18nObject(en_US="desc"),
        icon="icon.svg",
        label=I18nObject(en_US="Provider"),
    )


def test_tool_provider_controller_get_credentials_schema_returns_deep_copy():
    entity = ToolProviderEntity(
        identity=_provider_identity(),
        credentials_schema=[ProviderConfig(type=ProviderConfig.Type.TEXT_INPUT, name="api_key", required=False)],
    )
    controller = _DummyController(entity=entity)

    schema = controller.get_credentials_schema()
    schema[0].name = "changed"

    assert controller.entity.credentials_schema[0].name == "api_key"


def test_tool_provider_controller_default_provider_type():
    entity = ToolProviderEntity(identity=_provider_identity(), credentials_schema=[])
    controller = _DummyController(entity=entity)

    assert controller.provider_type == ToolProviderType.BUILT_IN


def test_validate_credentials_format_covers_required_default_and_type_rules():
    select_options = [ProviderConfig.Option(value="opt-a", label=I18nObject(en_US="A"))]
    entity = ToolProviderEntity(
        identity=_provider_identity(),
        credentials_schema=[
            ProviderConfig(type=ProviderConfig.Type.TEXT_INPUT, name="required_text", required=True),
            ProviderConfig(type=ProviderConfig.Type.SECRET_INPUT, name="secret", required=False),
            ProviderConfig(type=ProviderConfig.Type.SELECT, name="choice", required=False, options=select_options),
            ProviderConfig(type=ProviderConfig.Type.TEXT_INPUT, name="with_default", required=False, default="x"),
        ],
    )
    controller = _DummyController(entity=entity)

    credentials = {"required_text": "value", "secret": None, "choice": "opt-a"}
    controller.validate_credentials_format(credentials)
    assert credentials["with_default"] == "x"

    with pytest.raises(ToolProviderCredentialValidationError, match="not found"):
        controller.validate_credentials_format({"required_text": "value", "unknown": "v"})

    with pytest.raises(ToolProviderCredentialValidationError, match="is required"):
        controller.validate_credentials_format({"secret": "s"})

    with pytest.raises(ToolProviderCredentialValidationError, match="should be string"):
        controller.validate_credentials_format({"required_text": 123})  # type: ignore[arg-type]

    with pytest.raises(ToolProviderCredentialValidationError, match="should be one of"):
        controller.validate_credentials_format({"required_text": "value", "choice": "opt-b"})
