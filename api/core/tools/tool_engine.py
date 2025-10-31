import contextlib
import json
from collections.abc import Generator, Iterable
from copy import deepcopy
from datetime import UTC, datetime
from mimetypes import guess_type
from typing import Any, Union, cast

from yarl import URL

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.file import FileType
from core.file.models import FileTransferMethod
from core.ops.ops_trace_manager import TraceQueueManager
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import (
    ToolInvokeMessage,
    ToolInvokeMessageBinary,
    ToolInvokeMeta,
    ToolParameter,
)
from core.tools.errors import (
    ToolEngineInvokeError,
    ToolInvokeError,
    ToolNotFoundError,
    ToolNotSupportedError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from core.tools.utils.message_transformer import ToolFileMessageTransformer, safe_json_value
from core.tools.workflow_as_tool.tool import WorkflowTool
from extensions.ext_database import db
from models.enums import CreatorUserRole
from models.model import Message, MessageFile


class ToolEngine:
    """
    Tool runtime engine take care of the tool executions.
    """

    @staticmethod
    def agent_invoke(
        tool: Tool,
        tool_parameters: Union[str, dict],
        user_id: str,
        tenant_id: str,
        message: Message,
        invoke_from: InvokeFrom,
        agent_tool_callback: DifyAgentCallbackHandler,
        trace_manager: TraceQueueManager | None = None,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> tuple[str, list[str], ToolInvokeMeta]:
        """
        Agent invokes the tool with the given arguments.
        """
        # check if arguments is a string
        if isinstance(tool_parameters, str):
            # check if this tool has only one parameter
            parameters = [
                parameter
                for parameter in tool.get_runtime_parameters()
                if parameter.form == ToolParameter.ToolParameterForm.LLM
            ]
            if parameters and len(parameters) == 1:
                tool_parameters = {parameters[0].name: tool_parameters}
            else:
                with contextlib.suppress(Exception):
                    tool_parameters = json.loads(tool_parameters)
                if not isinstance(tool_parameters, dict):
                    raise ValueError(f"tool_parameters should be a dict, but got a string: {tool_parameters}")

        try:
            # hit the callback handler
            agent_tool_callback.on_tool_start(tool_name=tool.entity.identity.name, tool_inputs=tool_parameters)

            messages = ToolEngine._invoke(tool, tool_parameters, user_id, conversation_id, app_id, message_id)
            invocation_meta_dict: dict[str, ToolInvokeMeta] = {}

            def message_callback(
                invocation_meta_dict: dict, messages: Generator[ToolInvokeMessage | ToolInvokeMeta, None, None]
            ):
                for message in messages:
                    if isinstance(message, ToolInvokeMeta):
                        invocation_meta_dict["meta"] = message
                    else:
                        yield message

            messages = ToolFileMessageTransformer.transform_tool_invoke_messages(
                messages=message_callback(invocation_meta_dict, messages),
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=message.conversation_id,
            )

            message_list = list(messages)

            # extract binary data from tool invoke message
            binary_files = ToolEngine._extract_tool_response_binary_and_text(message_list)
            # create message file
            message_files = ToolEngine._create_message_files(
                tool_messages=binary_files, agent_message=message, invoke_from=invoke_from, user_id=user_id
            )

            plain_text = ToolEngine._convert_tool_response_to_str(message_list)

            meta = invocation_meta_dict["meta"]

            # hit the callback handler
            agent_tool_callback.on_tool_end(
                tool_name=tool.entity.identity.name,
                tool_inputs=tool_parameters,
                tool_outputs=plain_text,
                message_id=message.id,
                trace_manager=trace_manager,
            )

            # transform tool invoke message to get LLM friendly message
            return plain_text, message_files, meta
        except ToolProviderCredentialValidationError as e:
            error_response = "Please check your tool provider credentials"
            agent_tool_callback.on_tool_error(e)
        except (ToolNotFoundError, ToolNotSupportedError, ToolProviderNotFoundError) as e:
            error_response = f"there is not a tool named {tool.entity.identity.name}"
            agent_tool_callback.on_tool_error(e)
        except ToolParameterValidationError as e:
            error_response = f"tool parameters validation error: {e}, please check your tool parameters"
            agent_tool_callback.on_tool_error(e)
        except ToolInvokeError as e:
            error_response = f"tool invoke error: {e}"
            agent_tool_callback.on_tool_error(e)
        except ToolEngineInvokeError as e:
            meta = e.meta
            error_response = f"tool invoke error: {meta.error}"
            agent_tool_callback.on_tool_error(e)
            return error_response, [], meta
        except Exception as e:
            error_response = f"unknown error: {e}"
            agent_tool_callback.on_tool_error(e)

        return error_response, [], ToolInvokeMeta.error_instance(error_response)

    @staticmethod
    def generic_invoke(
        tool: Tool,
        tool_parameters: dict[str, Any],
        user_id: str,
        workflow_tool_callback: DifyWorkflowCallbackHandler,
        workflow_call_depth: int,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Workflow invokes the tool with the given arguments.
        """
        try:
            # hit the callback handler
            workflow_tool_callback.on_tool_start(tool_name=tool.entity.identity.name, tool_inputs=tool_parameters)

            if isinstance(tool, WorkflowTool):
                tool.workflow_call_depth = workflow_call_depth + 1

            if tool.runtime and tool.runtime.runtime_parameters:
                tool_parameters = {**tool.runtime.runtime_parameters, **tool_parameters}

            response = tool.invoke(
                user_id=user_id,
                tool_parameters=tool_parameters,
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
            )

            # hit the callback handler
            response = workflow_tool_callback.on_tool_execution(
                tool_name=tool.entity.identity.name,
                tool_inputs=tool_parameters,
                tool_outputs=response,
            )

            return response
        except Exception as e:
            workflow_tool_callback.on_tool_error(e)
            raise e

    @staticmethod
    def _invoke(
        tool: Tool,
        tool_parameters: dict,
        user_id: str,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage | ToolInvokeMeta, None, None]:
        """
        Invoke the tool with the given arguments.
        """
        started_at = datetime.now(UTC)
        meta = ToolInvokeMeta(
            time_cost=0.0,
            error=None,
            tool_config={
                "tool_name": tool.entity.identity.name,
                "tool_provider": tool.entity.identity.provider,
                "tool_provider_type": tool.tool_provider_type().value,
                "tool_parameters": deepcopy(tool.runtime.runtime_parameters),
                "tool_icon": tool.entity.identity.icon,
            },
        )
        try:
            yield from tool.invoke(user_id, tool_parameters, conversation_id, app_id, message_id)
        except Exception as e:
            meta.error = str(e)
            raise ToolEngineInvokeError(meta)
        finally:
            ended_at = datetime.now(UTC)
            meta.time_cost = (ended_at - started_at).total_seconds()
            yield meta

    @staticmethod
    def _convert_tool_response_to_str(tool_response: list[ToolInvokeMessage]) -> str:
        """
        Handle tool response
        """
        parts: list[str] = []
        json_parts: list[str] = []

        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                parts.append(cast(ToolInvokeMessage.TextMessage, response.message).text)
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                parts.append(
                    f"result link: {cast(ToolInvokeMessage.TextMessage, response.message).text}."
                    + " please tell user to check it."
                )
            elif response.type in {ToolInvokeMessage.MessageType.IMAGE_LINK, ToolInvokeMessage.MessageType.IMAGE}:
                parts.append(
                    "image has been created and sent to user already, "
                    + "you do not need to create it, just tell the user to check it now."
                )
            elif response.type == ToolInvokeMessage.MessageType.JSON:
                json_parts.append(
                    json.dumps(
                        safe_json_value(cast(ToolInvokeMessage.JsonMessage, response.message).json_object),
                        ensure_ascii=False,
                    )
                )
            else:
                parts.append(str(response.message))

        # Add JSON parts, avoiding duplicates from text parts.
        if json_parts:
            existing_parts = set(parts)
            parts.extend(p for p in json_parts if p not in existing_parts)

        return "".join(parts)

    @staticmethod
    def _extract_tool_response_binary_and_text(
        tool_response: list[ToolInvokeMessage],
    ) -> Generator[ToolInvokeMessageBinary, None, None]:
        """
        Extract tool response binary
        """
        for response in tool_response:
            if response.type in {ToolInvokeMessage.MessageType.IMAGE_LINK, ToolInvokeMessage.MessageType.IMAGE}:
                mimetype = None
                if not response.meta:
                    raise ValueError("missing meta data")
                if response.meta.get("mime_type"):
                    mimetype = response.meta.get("mime_type")
                else:
                    with contextlib.suppress(Exception):
                        url = URL(cast(ToolInvokeMessage.TextMessage, response.message).text)
                        extension = url.suffix
                        guess_type_result, _ = guess_type(f"a{extension}")
                        if guess_type_result:
                            mimetype = guess_type_result

                if not mimetype:
                    mimetype = "image/jpeg"

                yield ToolInvokeMessageBinary(
                    mimetype=response.meta.get("mime_type", mimetype),
                    url=cast(ToolInvokeMessage.TextMessage, response.message).text,
                )
            elif response.type == ToolInvokeMessage.MessageType.BLOB:
                if not response.meta:
                    raise ValueError("missing meta data")

                yield ToolInvokeMessageBinary(
                    mimetype=response.meta.get("mime_type", "application/octet-stream"),
                    url=cast(ToolInvokeMessage.TextMessage, response.message).text,
                )
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                # check if there is a mime type in meta
                if response.meta and "mime_type" in response.meta:
                    yield ToolInvokeMessageBinary(
                        mimetype=response.meta.get("mime_type", "application/octet-stream")
                        if response.meta
                        else "application/octet-stream",
                        url=cast(ToolInvokeMessage.TextMessage, response.message).text,
                    )

    @staticmethod
    def _create_message_files(
        tool_messages: Iterable[ToolInvokeMessageBinary],
        agent_message: Message,
        invoke_from: InvokeFrom,
        user_id: str,
    ) -> list[str]:
        """
        Create message file

        :return: message file ids
        """
        result = []

        for message in tool_messages:
            if "image" in message.mimetype:
                file_type = FileType.IMAGE
            elif "video" in message.mimetype:
                file_type = FileType.VIDEO
            elif "audio" in message.mimetype:
                file_type = FileType.AUDIO
            elif "text" in message.mimetype or "pdf" in message.mimetype:
                file_type = FileType.DOCUMENT
            else:
                file_type = FileType.CUSTOM

            # extract tool file id from url
            tool_file_id = message.url.split("/")[-1].split(".")[0]
            message_file = MessageFile(
                message_id=agent_message.id,
                type=file_type,
                transfer_method=FileTransferMethod.TOOL_FILE,
                belongs_to="assistant",
                url=message.url,
                upload_file_id=tool_file_id,
                created_by_role=(
                    CreatorUserRole.ACCOUNT
                    if invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
                    else CreatorUserRole.END_USER
                ),
                created_by=user_id,
            )

            db.session.add(message_file)
            db.session.commit()
            db.session.refresh(message_file)

            result.append(message_file.id)

        db.session.close()

        return result
