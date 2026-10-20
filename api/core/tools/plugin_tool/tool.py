from __future__ import annotations

import logging
from collections.abc import Generator, Mapping
from typing import Any, override

from sqlalchemy.orm import Session

from core.dify_builder.real_call_consent import ConfirmedToolGuard
from core.plugin.impl.tool import PluginToolManager
from core.plugin.utils.converter import convert_parameters_to_plugin_format
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolParameter, ToolProviderType
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
)

logger = logging.getLogger(__name__)

# A confirmed call forwards only data messages: anything that could trigger a
# secondary download or file write is refused before file transformation. The
# audited artifact's single ``message_id`` VARIABLE is admitted separately.
_CONFIRMED_MESSAGE_TYPES = frozenset({ToolInvokeMessage.MessageType.TEXT, ToolInvokeMessage.MessageType.JSON})
_AUDITED_VARIABLE = "message_id"


class PluginTool(Tool):
    def __init__(
        self,
        entity: ToolEntity,
        runtime: ToolRuntime,
        tenant_id: str,
        icon: str,
        plugin_unique_identifier: str,
        *,
        confirmed_guard: ConfirmedToolGuard | None = None,
    ):
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.icon = icon
        self.plugin_unique_identifier = plugin_unique_identifier
        self.runtime_parameters: list[ToolParameter] | None = None
        # ``None`` for every ordinary tool. A confirmed Builder call carries its
        # in-process consent callbacks here, never in ``ToolRuntime`` or any
        # serialized payload.
        self.confirmed_guard = confirmed_guard

    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.PLUGIN

    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage]:
        manager = PluginToolManager()

        tool_parameters = convert_parameters_to_plugin_format(tool_parameters)

        def dispatch(confirmed_headers: Mapping[str, str] | None) -> Generator[ToolInvokeMessage]:
            return manager.invoke(
                tenant_id=self.tenant_id,
                user_id=user_id,
                tool_provider=self.entity.identity.provider,
                tool_name=self.entity.identity.name,
                credentials=self.runtime.credentials,
                credential_type=self.runtime.credential_type,
                tool_parameters=tool_parameters,
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
                confirmed_dispatch_headers=confirmed_headers,
            )

        guard = self.confirmed_guard
        if guard is None:
            yield from dispatch(None)
            return

        # The complete converted envelope is compared and the business phase
        # spent before the single native dispatch; a refusal sends nothing.
        guard.before_invoke(tool_parameters)
        # The admitted final envelope's own value: never re-read from public input.
        expected_message_id = tool_parameters.get(_AUDITED_VARIABLE)
        variable_seen = False
        complete = False
        try:
            messages = dispatch(guard.dispatch_headers())
            try:
                for message in messages:
                    if message.type == ToolInvokeMessage.MessageType.VARIABLE:
                        if variable_seen or not self._is_audited_variable(message, expected_message_id):
                            raise BuilderExecutionPolicyError("unsupported_tool_output")
                        variable_seen = True
                    else:
                        self._observe_confirmed(guard, message)
                    yield message
            finally:
                messages.close()
            complete = True
        finally:
            # Exactly once per spent phase: cancellation, timeout, transport loss
            # or a refused message leave the outcome unknown, never failed.
            self._finish_confirmed(guard, complete=complete)

    @staticmethod
    def _is_audited_variable(message: ToolInvokeMessage, expected_message_id: object) -> bool:
        """Only the non-streamed ``message_id`` VARIABLE equal to the admitted final message ID.

        It is optional forwarded data, never a classification input: a VARIABLE
        or TEXT alone never establishes success.
        """
        payload = message.message
        return (
            isinstance(payload, ToolInvokeMessage.VariableMessage)
            and payload.variable_name == _AUDITED_VARIABLE
            and payload.stream is False
            and type(expected_message_id) is str
            and type(payload.variable_value) is str
            and payload.variable_value == expected_message_id
        )

    @staticmethod
    def _observe_confirmed(guard: ConfirmedToolGuard, message: ToolInvokeMessage) -> None:
        if message.type not in _CONFIRMED_MESSAGE_TYPES:
            raise BuilderExecutionPolicyError("unsupported_tool_output")
        if message.type == ToolInvokeMessage.MessageType.JSON:
            payload = message.message
            if not isinstance(payload, ToolInvokeMessage.JsonMessage) or not isinstance(payload.json_object, dict):
                raise BuilderExecutionPolicyError("unsupported_tool_output")
            guard.observe_json(payload.json_object)

    @staticmethod
    def _finish_confirmed(guard: ConfirmedToolGuard, *, complete: bool) -> None:
        try:
            guard.finish_stream(complete=complete, declared_failure=False)
        except Exception as error:
            # The spent phase stays unresolved (unknown) for the Run owner; never echo native text.
            reason = error.reason_code if isinstance(error, BuilderExecutionPolicyError) else type(error).__name__
            logger.warning("Confirmed tool outcome was not recorded: %s", reason)

    @override
    def fork_tool_runtime(self, runtime: ToolRuntime) -> PluginTool:
        return PluginTool(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
            confirmed_guard=self.confirmed_guard,
        )

    @override
    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        """
        get the runtime parameters
        """
        if not self.entity.has_runtime_parameters:
            return self.entity.parameters

        if self.runtime_parameters is not None:
            return self.runtime_parameters

        manager = PluginToolManager()
        self.runtime_parameters = manager.get_runtime_parameters(
            tenant_id=self.tenant_id,
            user_id="",
            provider=self.entity.identity.provider,
            tool=self.entity.identity.name,
            credentials=self.runtime.credentials,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )

        return self.runtime_parameters
