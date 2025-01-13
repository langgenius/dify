import json
from collections.abc import Mapping
from copy import deepcopy
from datetime import UTC, datetime
from mimetypes import guess_type
from typing import Any, Optional, Union, cast

from yarl import URL

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.file import FileType
from core.file.models import FileTransferMethod
from core.ops.ops_trace_manager import TraceQueueManager
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolInvokeMessageBinary, ToolInvokeMeta, ToolParameter
from core.tools.errors import (
    ToolEngineInvokeError,
    ToolInvokeError,
    ToolNotFoundError,
    ToolNotSupportedError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from core.tools.tool.tool import Tool
from core.tools.tool.workflow_tool import WorkflowTool
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from extensions.ext_database import db
from models.enums import CreatedByRole
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
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> tuple[str, list[tuple[MessageFile, str]], ToolInvokeMeta]:
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
                try:
                    tool_parameters = json.loads(tool_parameters)
                except Exception as e:
                    pass
                if not isinstance(tool_parameters, dict):
                    raise ValueError(f"tool_parameters should be a dict, but got a string: {tool_parameters}")

        # invoke the tool
        if tool.identity is None:
            raise ValueError("tool identity is not set")
        try:
            # hit the callback handler
            agent_tool_callback.on_tool_start(tool_name=tool.identity.name, tool_inputs=tool_parameters)

            meta, response = ToolEngine._invoke(tool, tool_parameters, user_id)
            response = ToolFileMessageTransformer.transform_tool_invoke_messages(
                messages=response, user_id=user_id, tenant_id=tenant_id, conversation_id=message.conversation_id
            )

            # extract binary data from tool invoke message
            binary_files = ToolEngine._extract_tool_response_binary(response)
            # create message file
            message_files = ToolEngine._create_message_files(
                tool_messages=binary_files, agent_message=message, invoke_from=invoke_from, user_id=user_id
            )

            plain_text = ToolEngine._convert_tool_response_to_str(response)

            # hit the callback handler
            agent_tool_callback.on_tool_end(
                tool_name=tool.identity.name,
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
            error_response = f"there is not a tool named {tool.identity.name}"
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
    def workflow_invoke(
        tool: Tool,
        tool_parameters: Mapping[str, Any],
        user_id: str,
        workflow_tool_callback: DifyWorkflowCallbackHandler,
        workflow_call_depth: int,
        thread_pool_id: Optional[str] = None,
    ) -> list[ToolInvokeMessage]:
        """
        Workflow invokes the tool with the given arguments.
        """
        try:
            # hit the callback handler
            assert tool.identity is not None
            workflow_tool_callback.on_tool_start(tool_name=tool.identity.name, tool_inputs=tool_parameters)

            if isinstance(tool, WorkflowTool):
                tool.workflow_call_depth = workflow_call_depth + 1
                tool.thread_pool_id = thread_pool_id

            if tool.runtime and tool.runtime.runtime_parameters:
                tool_parameters = {**tool.runtime.runtime_parameters, **tool_parameters}
            response = tool.invoke(user_id=user_id, tool_parameters=tool_parameters)

            # hit the callback handler
            workflow_tool_callback.on_tool_end(
                tool_name=tool.identity.name,
                tool_inputs=tool_parameters,
                tool_outputs=response,
            )

            return response
        except Exception as e:
            workflow_tool_callback.on_tool_error(e)
            raise e

    @staticmethod
    def _invoke(tool: Tool, tool_parameters: dict, user_id: str) -> tuple[ToolInvokeMeta, list[ToolInvokeMessage]]:
        """
        Invoke the tool with the given arguments.
        """
        if tool.identity is None:
            raise ValueError("tool identity is not set")
        started_at = datetime.now(UTC)
        meta = ToolInvokeMeta(
            time_cost=0.0,
            error=None,
            tool_config={
                "tool_name": tool.identity.name,
                "tool_provider": tool.identity.provider,
                "tool_provider_type": tool.tool_provider_type().value,
                "tool_parameters": deepcopy(tool.runtime.runtime_parameters) if tool.runtime else {},
                "tool_icon": tool.identity.icon,
            },
        )
        try:
            response = tool.invoke(user_id, tool_parameters)
        except Exception as e:
            meta.error = str(e)
            raise ToolEngineInvokeError(meta)
        finally:
            ended_at = datetime.now(UTC)
            meta.time_cost = (ended_at - started_at).total_seconds()

        return meta, response

    @staticmethod
    def _convert_tool_response_to_str(tool_response: list[ToolInvokeMessage]) -> str:
        """
        Handle tool response
        """
        result = ""
        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                result += str(response.message) if response.message is not None else ""
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                result += f"result link: {response.message!r}. please tell user to check it."
            elif response.type in {ToolInvokeMessage.MessageType.IMAGE_LINK, ToolInvokeMessage.MessageType.IMAGE}:
                result += (
                    "image has been created and sent to user already, you do not need to create it,"
                    " just tell the user to check it now."
                )
            elif response.type == ToolInvokeMessage.MessageType.JSON:
                result += f"tool response: {json.dumps(response.message, ensure_ascii=False)}."
            else:
                result += f"tool response: {response.message!r}."

        return result

    @staticmethod
    def _extract_tool_response_binary(tool_response: list[ToolInvokeMessage]) -> list[ToolInvokeMessageBinary]:
        """
        Extract tool response binary
        """
        result = []

        for response in tool_response:
            if response.type in {ToolInvokeMessage.MessageType.IMAGE_LINK, ToolInvokeMessage.MessageType.IMAGE}:
                mimetype = None
                if response.meta.get("mime_type"):
                    mimetype = response.meta.get("mime_type")
                else:
                    try:
                        url = URL(cast(str, response.message))
                        extension = url.suffix
                        guess_type_result, _ = guess_type(f"a{extension}")
                        if guess_type_result:
                            mimetype = guess_type_result
                    except Exception:
                        pass

                if not mimetype:
                    mimetype = "image/jpeg"

                result.append(
                    ToolInvokeMessageBinary(
                        mimetype=response.meta.get("mime_type", "image/jpeg"),
                        url=cast(str, response.message),
                        save_as=response.save_as,
                    )
                )
            elif response.type == ToolInvokeMessage.MessageType.BLOB:
                result.append(
                    ToolInvokeMessageBinary(
                        mimetype=response.meta.get("mime_type", "octet/stream"),
                        url=cast(str, response.message),
                        save_as=response.save_as,
                    )
                )
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                # check if there is a mime type in meta
                if response.meta and "mime_type" in response.meta:
                    result.append(
                        ToolInvokeMessageBinary(
                            mimetype=response.meta.get("mime_type", "octet/stream")
                            if response.meta
                            else "octet/stream",
                            url=cast(str, response.message),
                            save_as=response.save_as,
                        )
                    )

        return result

    @staticmethod
    def _create_message_files(
        tool_messages: list[ToolInvokeMessageBinary],
        agent_message: Message,
        invoke_from: InvokeFrom,
        user_id: str,
    ) -> list[tuple[Any, str]]:
        """
        Create message file

        :param messages: messages
        :return: message files, should save as variable
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
                    CreatedByRole.ACCOUNT
                    if invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
                    else CreatedByRole.END_USER
                ),
                created_by=user_id,
            )

            db.session.add(message_file)
            db.session.commit()
            db.session.refresh(message_file)

            result.append((message_file.id, message.save_as))

        db.session.close()

        return result
