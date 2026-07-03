"""Service layer for Agent-backend core tool invocations.

The `dify.core.tools` layer executes inside the API service boundary so Dify
Agent can expose API-owned tool providers (`plugin`, `builtin`, `api`,
`workflow`, and `mcp`) without learning their storage, credential, or runtime
internals. Production workflow and agent-app request builders still keep
existing plugin tool configs on the direct `dify.plugin.tools` route by
default; this service is the lower-level API execution path used when a caller
explicitly submits a `dify.core.tools` declaration. The service validates
tenant/app ownership, reuses `ToolManager.get_agent_tool_runtime(...)` to build
the runtime with `ToolInvokeFrom.AGENT`, invokes through
`ToolEngine.generic_invoke(...)`, and formats observations through the shared
public `ToolEngine.tool_response_to_str` helper so Agent and workflow paths
stay consistent.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

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
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from models.model import App
from services.entities.agent_tool_inner import AgentToolInvokeRequest, AgentToolInvokeResponse
from services.errors.agent_tool_inner import AgentToolInnerServiceError


class AgentToolInnerService:
    """Invoke one API-owned Agent tool declaration, including explicit plugin-via-core calls."""

    def invoke(self, session: Session, request: AgentToolInvokeRequest) -> AgentToolInvokeResponse:
        app = session.get(App, request.caller.app_id)
        if app is None:
            raise AgentToolInnerServiceError(
                error_code="app_not_found",
                description="App not found.",
                status_code=404,
            )
        if app.tenant_id != request.caller.tenant_id:
            raise AgentToolInnerServiceError(
                error_code="app_tenant_mismatch",
                description="App does not belong to the caller tenant.",
                status_code=403,
            )

        agent_tool = AgentToolEntity(
            provider_type=ToolProviderType.value_of(request.tool.provider_type),
            provider_id=request.tool.provider_id,
            tool_name=request.tool.tool_name,
            tool_parameters=dict(request.tool.runtime_parameters),
            credential_id=request.tool.credential_id,
        )
        try:
            tool_runtime = ToolManager.get_agent_tool_runtime(
                tenant_id=request.caller.tenant_id,
                app_id=request.caller.app_id,
                agent_tool=agent_tool,
                user_id=request.caller.user_id,
                invoke_from=InvokeFrom.value_of(request.caller.invoke_from),
                variable_pool=None,
                allow_file_parameters=True,
                use_default_for_missing_form_parameters=True,
            )
            messages = ToolEngine.generic_invoke(
                session=session,
                tool=tool_runtime,
                tool_parameters=dict(request.tool.tool_parameters),
                user_id=request.caller.user_id,
                workflow_tool_callback=DifyWorkflowCallbackHandler(),
                workflow_call_depth=0,
                conversation_id=request.caller.conversation_id,
                app_id=request.caller.app_id,
            )
            transformed_messages = list(
                ToolFileMessageTransformer.transform_tool_invoke_messages(
                    messages=messages,
                    user_id=request.caller.user_id,
                    tenant_id=request.caller.tenant_id,
                    conversation_id=request.caller.conversation_id,
                )
            )
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
