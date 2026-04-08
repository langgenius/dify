from __future__ import annotations

from collections.abc import Generator, Mapping
from typing import Any, cast

from graphon.enums import BuiltinNodeTypes, NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, get_file_type_by_mime_type
from graphon.model_runtime.entities.llm_entities import LLMUsage, LLMUsageMetadata
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.node_events import (
    AgentLogEvent,
    NodeEventBase,
    NodeRunResult,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from graphon.variables.segments import ArrayFileSegment
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.file_access import DatabaseFileAccessController
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from extensions.ext_database import db
from factories import file_factory
from models import ToolFile
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

from .exceptions import AgentNodeError, AgentVariableTypeError, ToolFileNotFoundError

_file_access_controller = DatabaseFileAccessController()


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
        from core.plugin.impl.plugin import PluginInstaller

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
                stream_text = f"Link: {message.message.text}\n"
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
                    dict_metadata = dict(message.message.metadata)
                    if dict_metadata.get("provider"):
                        manager = PluginInstaller()
                        plugins = manager.list_plugins(tenant_id)
                        try:
                            current_plugin = next(
                                plugin
                                for plugin in plugins
                                if f"{plugin.plugin_id}/{plugin.name}" == dict_metadata["provider"]
                            )
                            icon = current_plugin.declaration.icon
                        except StopIteration:
                            pass
                        icon_dark = None
                        try:
                            builtin_tool = next(
                                provider
                                for provider in BuiltinToolManageService.list_builtin_tools(
                                    user_id,
                                    tenant_id,
                                )
                                if provider.name == dict_metadata["provider"]
                            )
                            icon = builtin_tool.icon
                            icon_dark = builtin_tool.icon_dark
                        except StopIteration:
                            pass

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
