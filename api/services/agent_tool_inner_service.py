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
`ToolEngine.generic_invoke(...)`, and resolves committed `ToolFile` metadata in
a fresh post-invocation session so `REPEATABLE READ` snapshots on the outer
request session cannot hide files saved in separate transactions. Agent
observations expose lightweight media handles for explicit `read_media`
inspection; the legacy `ToolEngine` formatter continues to own text/JSON
semantics for all other messages.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from urllib.parse import urlsplit

from dify_agent.agent_stub.protocol import AgentStubFileMapping, format_media_observation
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.entities import AgentToolEntity
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.db.session_factory import session_factory as default_session_factory
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolInvokeMessage, ToolProviderType
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
from core.workflow.file_reference import build_file_reference, is_canonical_file_reference
from graphon.file import File, FileTransferMethod
from models import ToolFile
from models.model import App
from services.credentials.refresh import CredentialRefreshUnavailableError
from services.entities.agent_tool_inner import AgentToolInvokeRequest, AgentToolInvokeResponse
from services.errors.agent_tool_inner import AgentToolInnerServiceError
from services.workflow_run_agg import WorkflowRunAgg

_TOOL_FILE_LINK_TYPES = frozenset(
    {
        ToolInvokeMessage.MessageType.IMAGE_LINK,
        ToolInvokeMessage.MessageType.BINARY_LINK,
        ToolInvokeMessage.MessageType.LINK,
    }
)


class AgentToolInnerService:
    """Invoke one API-owned Agent tool declaration, including explicit plugin-via-core calls."""

    def __init__(self, *, session_factory: Callable[[], Session] = default_session_factory.create_session) -> None:
        """Bind ``session_factory`` for post-invocation reads; defaults to the configured API session factory."""
        self._session_factory = session_factory

    def invoke(self, request: AgentToolInvokeRequest, *, session: Session) -> AgentToolInvokeResponse:
        """Execute a validated Agent tool request and return serialized messages plus a model observation.

        Validates ``App`` tenant ownership on ``session``, invokes the tool and
        ``ToolFileMessageTransformer``, and reads any persisted ``ToolFile``
        metadata through ``self._session_factory`` after transformation without
        altering ``session``'s caller-owned transaction lifecycle.
        """
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
            dify_run_context = DifyRunContext(
                tenant_id=request.caller.tenant_id,
                app_id=request.caller.app_id,
                user_id=request.caller.user_id,
                user_from=UserFrom(request.caller.user_from),
                invoke_from=InvokeFrom.value_of(request.caller.invoke_from),
                trace_session_id=request.caller.trace_session_id,
            )
            tool_runtime = ToolManager.get_agent_tool_runtime(
                execution_driver=WorkflowRunAgg.run,
                tenant_id=request.caller.tenant_id,
                app_id=request.caller.app_id,
                agent_tool=agent_tool,
                user_id=request.caller.user_id,
                invoke_from=dify_run_context.invoke_from,
                variable_pool=None,
                allow_file_parameters=True,
                use_default_for_missing_form_parameters=True,
            )
            tool_runtime.runtime.dify_run_context = dify_run_context
            tool_runtime.runtime.tool_invoke_from = (
                ToolInvokeFrom.WORKFLOW if request.caller.workflow_id is not None else ToolInvokeFrom.AGENT
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
        except CredentialRefreshUnavailableError:
            raise
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
            observation=_format_agent_tool_observation(
                transformed_messages, session_factory=self._session_factory, tenant_id=request.caller.tenant_id
            ),
            metadata={
                "provider_type": request.tool.provider_type,
                "provider_id": request.tool.provider_id,
                "tool_name": request.tool.tool_name,
            },
        )


def _format_agent_tool_observation(
    messages: Sequence[ToolInvokeMessage],
    *,
    session_factory: Callable[[], Session],
    tenant_id: str,
) -> str:
    """Format transformed media as handles, preserving shared text/JSON behavior.

    Requires completed file transformation and the invoking tenant. Committed
    ``ToolFile`` metadata is batch-loaded in a fresh session scoped to
    ``tenant_id`` so an outer ``REPEATABLE READ`` snapshot cannot hide files
    saved in separate transactions. No file bytes are read, and unsupported or
    missing media becomes a text hint.
    """
    tool_file_ids = {
        str(tool_file_id)
        for message in messages
        if message.type in _TOOL_FILE_LINK_TYPES and (tool_file_id := (message.meta or {}).get("tool_file_id"))
    }
    tool_files: dict[str, tuple[str, str, str, int]] = {}
    if tool_file_ids:
        # Tool files are committed in separate sessions during tool execution or
        # message transformation; the outer request session's REPEATABLE READ
        # snapshot on MySQL was pinned when validating App before invocation.
        with session_factory() as read_session:
            rows = read_session.execute(
                select(ToolFile.id, ToolFile.name, ToolFile.mimetype, ToolFile.size).where(
                    ToolFile.tenant_id == tenant_id,
                    ToolFile.id.in_(tool_file_ids),
                )
            )
            tool_files = {row_id: (row_id, name, mimetype, size) for row_id, name, mimetype, size in rows}

    observations: list[ToolInvokeMessage] = []
    for message in messages:
        meta = message.meta or {}
        tool_file_id = meta.get("tool_file_id")
        mapping: AgentStubFileMapping | None = None
        filename: str | None = None
        mime_type: str | None = None
        size: int | None = None
        if tool_file_id and message.type in _TOOL_FILE_LINK_TYPES:
            record = tool_files.get(str(tool_file_id))
            if record is not None:
                record_id, filename, mime_type, size = record
                mapping = AgentStubFileMapping(
                    transfer_method="tool_file", reference=build_file_reference(record_id=record_id)
                )
            else:
                message = ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.TEXT,
                    message=ToolInvokeMessage.TextMessage(text="Tool media file is no longer accessible."),
                )
        elif message.type == ToolInvokeMessage.MessageType.FILE and isinstance(file := meta.get("file"), File):
            if file.transfer_method == FileTransferMethod.REMOTE_URL:
                assert file.remote_url is not None
                mapping = AgentStubFileMapping(transfer_method="remote_url", url=file.remote_url)
            else:
                assert file.reference is not None
                reference = (
                    file.reference
                    if is_canonical_file_reference(file.reference)
                    else build_file_reference(record_id=file.reference)
                )
                mapping = AgentStubFileMapping(transfer_method=file.transfer_method.value, reference=reference)
            filename, mime_type, size = file.filename, file.mime_type, file.size
        elif message.type in {
            ToolInvokeMessage.MessageType.IMAGE_LINK,
            ToolInvokeMessage.MessageType.BINARY_LINK,
        } and isinstance(message.message, ToolInvokeMessage.TextMessage):
            url = message.message.text
            parsed = urlsplit(url)
            if parsed.scheme in {"http", "https"} and parsed.netloc:
                mapping = AgentStubFileMapping(transfer_method="remote_url", url=url)
        if mapping is not None:
            text = format_media_observation(mapping, filename=filename, mime_type=mime_type, size=size)
            message = ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text=text)
            )
        observations.append(message)
    return ToolEngine.tool_response_to_str(observations)


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
