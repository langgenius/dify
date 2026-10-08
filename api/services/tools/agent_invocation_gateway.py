"""Adapt Agent tool declarations to the API tool runtime and its domain errors."""

from __future__ import annotations

from contextlib import closing

from core.agent.entities import AgentToolEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import (
    ToolInvokeError,
    ToolNotFoundError,
    ToolNotSupportedError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from services.entities.agent_tool_inner import AgentToolInvokeRequest, AgentToolInvokeResponse
from services.errors.agent_tool_inner import AgentToolInnerServiceError
from services.tools.tool_engine import ToolEngine
from services.tools.tool_manager import ToolManager
from services.workflow.execution.ports import WorkflowRuntime
from services.workflow.variable_contracts import WorkflowExecutionVariables


class AgentToolInvocationGateway:
    """Invoke one API-owned Agent tool declaration, including explicit plugin-via-core calls."""

    def __init__(self, *, variables: WorkflowExecutionVariables, runtime: WorkflowRuntime) -> None:
        self._variables = variables
        self._runtime = runtime

    def invoke(self, request: AgentToolInvokeRequest) -> AgentToolInvokeResponse:
        agent_tool = AgentToolEntity(
            provider_type=ToolProviderType.value_of(request.tool.provider_type),
            provider_id=request.tool.provider_id,
            tool_name=request.tool.tool_name,
            tool_parameters=dict(request.tool.runtime_parameters),
            credential_id=request.tool.credential_id,
        )
        try:
            tool_runtime = ToolManager.get_agent_tool_runtime(
                tool_providers=self._runtime.tool_providers,
                workflow_queries=self._runtime.tools,
                workflow_runtime=self._runtime,
                draft_variable_saver=self._variables.saver_factory,
                tenant_id=request.caller.tenant_id,
                app_id=request.caller.app_id,
                agent_tool=agent_tool,
                user_id=request.caller.user_id,
                invoke_from=InvokeFrom.value_of(request.caller.invoke_from),
                variable_pool=None,
                allow_file_parameters=True,
                use_default_for_missing_form_parameters=True,
            )
            with closing(
                self._runtime.tool_invoker(
                    tool=tool_runtime,
                    tool_parameters=dict(request.tool.tool_parameters),
                    user_id=request.caller.user_id,
                    workflow_tool_callback=DifyWorkflowCallbackHandler(),
                    workflow_call_depth=0,
                    conversation_id=request.caller.conversation_id,
                    app_id=request.caller.app_id,
                )
            ) as messages:
                with closing(
                    ToolFileMessageTransformer.transform_tool_invoke_messages(
                        messages=messages,
                        user_id=request.caller.user_id,
                        tenant_id=request.caller.tenant_id,
                        conversation_id=request.caller.conversation_id,
                    )
                ) as transformed:
                    transformed_messages = list(transformed)
        except ToolProviderNotFoundError as exc:
            raise AgentToolInnerServiceError(
                error_code="agent_tool_declaration_not_found",
                description=str(exc),
                status_code=404,
            ) from exc
        except ToolProviderCredentialValidationError as exc:
            raise AgentToolInnerServiceError(
                error_code="agent_tool_credential_invalid",
                description=str(exc),
                status_code=422,
            ) from exc
        except ToolParameterValidationError as exc:
            raise AgentToolInnerServiceError(
                error_code="tool_parameters_invalid",
                description=str(exc),
                status_code=422,
            ) from exc
        except (ToolInvokeError, ToolNotFoundError, ToolNotSupportedError) as exc:
            raise AgentToolInnerServiceError(
                error_code="agent_tool_invoke_failed",
                description=str(exc),
                status_code=422,
            ) from exc
        except ValueError as exc:
            raise _map_value_error(exc) from exc
        except Exception as exc:
            raise AgentToolInnerServiceError(
                error_code="agent_tool_invoke_unexpected_error",
                description=str(exc),
                status_code=500,
            ) from exc

        return AgentToolInvokeResponse(
            messages=[message.model_dump(mode="json") for message in transformed_messages],
            observation=ToolEngine.tool_response_to_str(transformed_messages),
            metadata={
                "provider_type": request.tool.provider_type,
                "provider_id": request.tool.provider_id,
                "tool_name": request.tool.tool_name,
            },
        )


def _map_value_error(error: ValueError) -> AgentToolInnerServiceError:
    description = str(error)
    if description == "app not found":
        return AgentToolInnerServiceError(
            error_code="app_not_found",
            description="App not found.",
            status_code=404,
        )
    return AgentToolInnerServiceError(
        error_code="agent_tool_invoke_failed",
        description=description,
        status_code=422,
    )
