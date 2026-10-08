"""Concrete tool fixtures shared by transformation test suites."""

from typing import Any, override

from sqlalchemy.orm import Session

from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)


class _RuntimeParameterEntity(ToolEntity):
    runtime_parameters: list[ToolParameter]


class _RuntimeParameterTool(Tool):
    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> ToolInvokeMessage:
        raise AssertionError("Transformation must not invoke the tool")

    @override
    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        assert isinstance(self.entity, _RuntimeParameterEntity)
        return self.entity.runtime_parameters


def make_runtime_tool(*, base_params: list[ToolParameter] | None, runtime_params: list[ToolParameter]) -> Tool:
    """Build a tool with real runtime forking; None preserves legacy null-parameter input."""
    entity = _RuntimeParameterEntity(
        identity=ToolIdentity(
            author="test_author", name="test_tool", label=I18nObject(en_US="Test Tool"), provider="test_provider"
        ),
        parameters=base_params or [],
        description=ToolDescription(human=I18nObject(en_US="Test description"), llm="Test description for LLM"),
        runtime_parameters=runtime_params,
    )
    if base_params is None:
        # Preserve the transformer's legacy null guard instead of normalizing it during validation.
        entity = entity.model_copy(update={"parameters": None})
    return _RuntimeParameterTool(entity=entity, runtime=ToolRuntime(tenant_id="source-tenant"))
