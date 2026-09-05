from __future__ import annotations

import logging
from collections.abc import Generator, Mapping
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.file_access import DatabaseFileAccessController
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from extensions.ext_database import db
from factories import file_factory
from graphon.enums import BuiltinNodeTypes, NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, get_file_type_by_mime_type
from graphon.model_runtime.entities.llm_entities import LLMUsage, LLMUsageMetadata
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.node_events import (
    NodeEventBase,
    NodeRunResult,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from graphon.variables.segments import ArrayFileSegment
from models import ToolFile
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

from .events import AgentLogEvent
from .exceptions import AgentNodeError, AgentVariableTypeError, ToolFileNotFoundError

logger = logging.getLogger(__name__)

_file_access_controller = DatabaseFileAccessController()


def _build_plugin_icon_lookup(tenant_id: str) -> dict[str, str]:
    """Return ``{qualified_name: icon}`` for every plugin visible to ``tenant_id``.

    The Agent message transformer only needs the icon for a single
    provider name per message. Building the full map once per
    ``transform()`` call keeps the per-message cost at a dictionary
    lookup instead of a fresh ``list_plugins`` round trip to the
    plugin daemon (up to 256 entries) and a linear scan.
    """
    from core.plugin.impl.plugin import PluginInstaller

    manager = PluginInstaller()
    return {f"{plugin.plugin_id}/{plugin.name}": plugin.declaration.icon for plugin in manager.list_plugins(tenant_id)}


def _build_builtin_icon_lookup(user_id: str, tenant_id: str) -> dict[str, tuple[str, str | None]]:
    """Return ``{provider_name: (icon, icon_dark)}`` for every built-in provider.

    Mirrors ``_build_plugin_icon_lookup`` for the ``BuiltinToolManageService``
    side of the Agent log enrichment. Avoids the per-message
    re-enumeration of every built-in controller, default-config reload,
    and credential decryption that the pre-fix code paid for every
    matching log message.
    """
    return cast(
        dict[str, tuple[str, str | None]],
        {
            provider.name: (provider.icon, provider.icon_dark)
            for provider in BuiltinToolManageService.list_builtin_tools(user_id, tenant_id)
        },
    )


class AgentMessageTransformer:
    def transform(
        self,
        *,
        messages: Generator[ToolInvokeMessage, None, None],
        tool_info: Mapping[str, Any],
        parameters_for_log: dict[str, Any],
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        node_type: NodeType,
        node_id: str,
        node_execution_id: str,
    ) -> Generator[NodeEventBase, None, None]:

        # #41143: per-execution cache for the icon-enrichment lookups in
        # the LOG-message branch below. Repeated log messages for the
        # same provider now reuse the same ``PluginInstaller.list_plugins``
        # / ``BuiltinToolManageService.list_builtin_tools`` result
        # instead of paying for the full scan every time.
        _plugin_icon_cache: dict[str, dict[str, str]] = {}
        _builtin_icon_cache: dict[tuple[str, str], dict[str, tuple[str, str | None]]] = {}

        message_stream = ToolFileMessageTransformer.transform_tool_invoke_messages(
            messages=messages,
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
        )

        text = ""
        files: list[File] = []
        json_list: list[dict | list] = []

        agent_logs: list[AgentLogEvent] = []
        agent_execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] = {}
        llm_usage = LLMUsage.empty_usage()
        variables: dict[str, Any] = {}

        for message in message_stream:
            if message.type in {
                ToolInvokeMessage.MessageType.IMAGE_LINK,
                ToolInvokeMessage.MessageType.BINARY_LINK,
                ToolInvokeMessage.MessageType.IMAGE,
            }:
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)

                url = message.message.text
                if message.meta:
                    transfer_method = message.meta.get("transfer_method", FileTransferMethod.TOOL_FILE)
                    tool_file_id = message.meta.get("tool_file_id")
                else:
                    transfer_method = FileTransferMethod.TOOL_FILE
                    tool_file_id = None
                if not isinstance(tool_file_id, str) or not tool_file_id:
                    raise ToolFileNotFoundError("missing tool_file_id metadata")

                with Session(db.engine) as session:
                    stmt = select(ToolFile).where(ToolFile.id == tool_file_id)
                    tool_file = session.scalar(stmt)
                    if tool_file is None:
                        raise ToolFileNotFoundError(tool_file_id)

                mapping = {
                    "tool_file_id": tool_file_id,
                    "type": get_file_type_by_mime_type(tool_file.mimetype),
                    "transfer_method": transfer_method,
                    "url": url,
                }
                file = file_factory.build_from_mapping(
                    mapping=mapping,
                    tenant_id=tenant_id,
                    access_controller=_file_access_controller,
                )
                files.append(file)
            elif message.type == ToolInvokeMessage.MessageType.BLOB:
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)
                assert message.meta

                tool_file_id = message.meta.get("tool_file_id")
                if not isinstance(tool_file_id, str) or not tool_file_id:
                    raise ToolFileNotFoundError("missing tool_file_id metadata")
                with Session(db.engine) as session:
                    stmt = select(ToolFile).where(ToolFile.id == tool_file_id)
                    tool_file = session.scalar(stmt)
                    if tool_file is None:
                        raise ToolFileNotFoundError(tool_file_id)

                mapping = {
                    "tool_file_id": tool_file_id,
                    "transfer_method": FileTransferMethod.TOOL_FILE,
                }
                files.append(
                    file_factory.build_from_mapping(
                        mapping=mapping,
                        tenant_id=tenant_id,
                        access_controller=_file_access_controller,
                    )
                )
            elif message.type == ToolInvokeMessage.MessageType.TEXT:
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)
                text += message.message.text
                yield StreamChunkEvent(
                    selector=[node_id, "text"],
                    chunk=message.message.text,
                    is_final=False,
                )
            elif message.type == ToolInvokeMessage.MessageType.JSON:
                assert isinstance(message.message, ToolInvokeMessage.JsonMessage)
                if node_type == BuiltinNodeTypes.AGENT:
                    if isinstance(message.message.json_object, dict):
                        msg_metadata: dict[str, Any] = message.message.json_object.pop("execution_metadata", {})
                        llm_usage = LLMUsage.from_metadata(cast(LLMUsageMetadata, msg_metadata))
                        agent_execution_metadata = {
                            WorkflowNodeExecutionMetadataKey(key): value
                            for key, value in msg_metadata.items()
                            if key in WorkflowNodeExecutionMetadataKey.__members__.values()
                        }
                    else:
                        llm_usage = LLMUsage.empty_usage()
                        agent_execution_metadata = {}
                if message.message.json_object:
                    json_list.append(message.message.json_object)
            elif message.type == ToolInvokeMessage.MessageType.LINK:
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)
                linked_file = self._file_from_link_message(message=message, tenant_id=tenant_id)
                if linked_file is not None:
                    files.append(linked_file)
                stream_text = f"{'File' if linked_file is not None else 'Link'}: {message.message.text}\n"
                text += stream_text
                yield StreamChunkEvent(
                    selector=[node_id, "text"],
                    chunk=stream_text,
                    is_final=False,
                )
            elif message.type == ToolInvokeMessage.MessageType.VARIABLE:
                assert isinstance(message.message, ToolInvokeMessage.VariableMessage)
                variable_name = message.message.variable_name
                variable_value = message.message.variable_value
                if message.message.stream:
                    if not isinstance(variable_value, str):
                        raise AgentVariableTypeError(
                            "When 'stream' is True, 'variable_value' must be a string.",
                            variable_name=variable_name,
                            expected_type="str",
                            actual_type=type(variable_value).__name__,
                        )
                    if variable_name not in variables:
                        variables[variable_name] = ""
                    variables[variable_name] += variable_value

                    yield StreamChunkEvent(
                        selector=[node_id, variable_name],
                        chunk=variable_value,
                        is_final=False,
                    )
                else:
                    variables[variable_name] = variable_value
            elif message.type == ToolInvokeMessage.MessageType.FILE:
                assert message.meta is not None
                assert isinstance(message.meta, dict)
                if "file" not in message.meta:
                    raise AgentNodeError("File message is missing 'file' key in meta")

                if not isinstance(message.meta["file"], File):
                    raise AgentNodeError(f"Expected File object but got {type(message.meta['file']).__name__}")
                files.append(message.meta["file"])
            elif message.type == ToolInvokeMessage.MessageType.LOG:
                assert isinstance(message.message, ToolInvokeMessage.LogMessage)
                if message.message.metadata:
                    icon = tool_info.get("icon", "")
                    icon_dark: str | None = None
                    dict_metadata = dict(message.message.metadata)
                    if dict_metadata.get("provider"):
                        # #41143: every LOG message with a `provider`
                        # value used to synchronously hit
                        # ``PluginInstaller.list_plugins`` (up to 256 entries
                        # over the plugin daemon) and enumerate every
                        # built-in provider + tool — only to populate two
                        # decoration fields (``icon``, ``icon_dark``). The
                        # work repeated across matching log messages
                        # within one execution and, worse, an error in
                        # either call path was treated as an Agent message
                        # transformation failure in
                        # ``AgentNode._run()`` — slowing or failing an
                        # Agent run over decorative metadata.
                        #
                        # Memoize both lookups per ``transform()``
                        # invocation so repeated log messages reuse the
                        # same data, and wrap the enrichment in a
                        # ``try/except`` so a slow / unreachable plugin
                        # daemon or a credential-decryption failure can't
                        # stall or fail the run.
                        try:
                            # ``dict.setdefault(key, default)`` evaluates
                            # ``default`` unconditionally, so the cache
                            # needs an explicit membership check to actually
                            # save the plugin-daemon / built-in call on
                            # subsequent log messages.
                            if tenant_id not in _plugin_icon_cache:
                                _plugin_icon_cache[tenant_id] = _build_plugin_icon_lookup(tenant_id)
                            plugin_icon_by_provider = _plugin_icon_cache[tenant_id]
                            icon = plugin_icon_by_provider.get(dict_metadata["provider"], icon)
                        except Exception:
                            logger.exception(
                                "Agent log icon enrichment failed (plugin lookup) for provider=%s",
                                dict_metadata.get("provider"),
                            )

                        try:
                            cache_key = (user_id, tenant_id)
                            if cache_key not in _builtin_icon_cache:
                                _builtin_icon_cache[cache_key] = _build_builtin_icon_lookup(user_id, tenant_id)
                            builtin_icon_by_provider = _builtin_icon_cache[cache_key]
                            entry = builtin_icon_by_provider.get(dict_metadata["provider"])
                            if entry is not None:
                                icon = entry[0]
                                icon_dark = entry[1]
                        except Exception:
                            logger.exception(
                                "Agent log icon enrichment failed (builtin lookup) for provider=%s",
                                dict_metadata.get("provider"),
                            )

                        dict_metadata["icon"] = icon
                        dict_metadata["icon_dark"] = icon_dark
                        message.message.metadata = dict_metadata
                agent_log = AgentLogEvent(
                    message_id=message.message.id,
                    node_execution_id=node_execution_id,
                    parent_id=message.message.parent_id,
                    error=message.message.error,
                    status=message.message.status.value,
                    data=message.message.data,
                    label=message.message.label,
                    metadata=message.message.metadata,
                    node_id=node_id,
                )

                for log in agent_logs:
                    if log.message_id == agent_log.message_id:
                        log.data = agent_log.data
                        log.status = agent_log.status
                        log.error = agent_log.error
                        log.label = agent_log.label
                        log.metadata = agent_log.metadata
                        break
                else:
                    agent_logs.append(agent_log)

                yield agent_log

        json_output: list[dict[str, Any] | list[Any]] = []
        if agent_logs:
            for log in agent_logs:
                json_output.append(
                    {
                        "id": log.message_id,
                        "parent_id": log.parent_id,
                        "error": log.error,
                        "status": log.status,
                        "data": log.data,
                        "label": log.label,
                        "metadata": log.metadata,
                        "node_id": log.node_id,
                    }
                )
        if json_list:
            json_output.extend(json_list)
        else:
            json_output.append({"data": []})

        yield StreamChunkEvent(
            selector=[node_id, "text"],
            chunk="",
            is_final=True,
        )

        for var_name in variables:
            yield StreamChunkEvent(
                selector=[node_id, var_name],
                chunk="",
                is_final=True,
            )

        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={
                    "text": text,
                    "usage": jsonable_encoder(llm_usage),
                    "files": ArrayFileSegment(value=files),
                    "json": json_output,
                    **variables,
                },
                metadata={
                    **agent_execution_metadata,
                    WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info,
                    WorkflowNodeExecutionMetadataKey.AGENT_LOG: agent_logs,
                },
                inputs=parameters_for_log,
                llm_usage=llm_usage,
            )
        )

    @staticmethod
    def _file_from_link_message(*, message: ToolInvokeMessage, tenant_id: str) -> File | None:
        if not isinstance(message.message, ToolInvokeMessage.TextMessage):
            return None
        meta = message.meta
        if not isinstance(meta, Mapping):
            return None

        file_value = meta.get("file")
        if isinstance(file_value, File):
            return file_value

        tool_file_id = meta.get("tool_file_id")
        if isinstance(tool_file_id, str) and tool_file_id:
            with Session(db.engine) as session:
                tool_file = session.scalar(
                    select(ToolFile).where(ToolFile.id == tool_file_id, ToolFile.tenant_id == tenant_id)
                )
                if tool_file is None:
                    raise ToolFileNotFoundError(tool_file_id)

            return file_factory.build_from_mapping(
                mapping={
                    "tool_file_id": tool_file_id,
                    "type": get_file_type_by_mime_type(tool_file.mimetype),
                    "transfer_method": meta.get("transfer_method", FileTransferMethod.TOOL_FILE),
                    "url": message.message.text,
                },
                tenant_id=tenant_id,
                access_controller=_file_access_controller,
            )

        if isinstance(file_value, Mapping):
            return file_factory.build_from_mapping(
                mapping=dict(file_value),
                tenant_id=tenant_id,
                access_controller=_file_access_controller,
            )
        return None
