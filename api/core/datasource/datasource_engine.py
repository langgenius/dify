import json
from collections.abc import Generator, Iterable
from mimetypes import guess_type
from typing import Any, Optional, cast

from yarl import URL

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.entities.datasource_entities import (
    DatasourceInvokeMessage,
    DatasourceInvokeMessageBinary,
)
from core.file import FileType
from core.file.models import FileTransferMethod
from extensions.ext_database import db
from models.enums import CreatedByRole
from models.model import Message, MessageFile


class DatasourceEngine:
    """
    Datasource runtime engine take care of the datasource executions.
    """

    @staticmethod
    def invoke_first_step(
        datasource: DatasourcePlugin,
        datasource_parameters: dict[str, Any],
        user_id: str,
        workflow_tool_callback: DifyWorkflowCallbackHandler,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[DatasourceInvokeMessage, None, None]:
        """
        Workflow invokes the datasource with the given arguments.
        """
        try:
            # hit the callback handler
            workflow_tool_callback.on_datasource_start(
                datasource_name=datasource.entity.identity.name, datasource_inputs=datasource_parameters
            )

            if datasource.runtime and datasource.runtime.runtime_parameters:
                datasource_parameters = {**datasource.runtime.runtime_parameters, **datasource_parameters}

            response = datasource._invoke_first_step(
                user_id=user_id,
                datasource_parameters=datasource_parameters,
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
            )

            # hit the callback handler
            response = workflow_tool_callback.on_datasource_end(
                datasource_name=datasource.entity.identity.name,
                datasource_inputs=datasource_parameters,
                datasource_outputs=response,
            )

            return response
        except Exception as e:
            workflow_tool_callback.on_tool_error(e)
            raise e

    @staticmethod
    def invoke_second_step(
        datasource: DatasourcePlugin,
        datasource_parameters: dict[str, Any],
        user_id: str,
        workflow_tool_callback: DifyWorkflowCallbackHandler,
    ) -> Generator[DatasourceInvokeMessage, None, None]:
        """
        Workflow invokes the datasource with the given arguments.
        """
        try:
            response = datasource._invoke_second_step(
                user_id=user_id,
                datasource_parameters=datasource_parameters,
            )

            return response
        except Exception as e:
            workflow_tool_callback.on_tool_error(e)
            raise e

    @staticmethod
    def _convert_datasource_response_to_str(datasource_response: list[DatasourceInvokeMessage]) -> str:
        """
        Handle datasource response
        """
        result = ""
        for response in datasource_response:
            if response.type == DatasourceInvokeMessage.MessageType.TEXT:
                result += cast(DatasourceInvokeMessage.TextMessage, response.message).text
            elif response.type == DatasourceInvokeMessage.MessageType.LINK:
                result += (
                    f"result link: {cast(DatasourceInvokeMessage.TextMessage, response.message).text}."
                    + " please tell user to check it."
                )
            elif response.type in {
                DatasourceInvokeMessage.MessageType.IMAGE_LINK,
                DatasourceInvokeMessage.MessageType.IMAGE,
            }:
                result += (
                    "image has been created and sent to user already, "
                    + "you do not need to create it, just tell the user to check it now."
                )
            elif response.type == DatasourceInvokeMessage.MessageType.JSON:
                result = json.dumps(
                    cast(DatasourceInvokeMessage.JsonMessage, response.message).json_object, ensure_ascii=False
                )
            else:
                result += str(response.message)

        return result

    @staticmethod
    def _extract_datasource_response_binary_and_text(
        datasource_response: list[DatasourceInvokeMessage],
    ) -> Generator[DatasourceInvokeMessageBinary, None, None]:
        """
        Extract datasource response binary
        """
        for response in datasource_response:
            if response.type in {
                DatasourceInvokeMessage.MessageType.IMAGE_LINK,
                DatasourceInvokeMessage.MessageType.IMAGE,
            }:
                mimetype = None
                if not response.meta:
                    raise ValueError("missing meta data")
                if response.meta.get("mime_type"):
                    mimetype = response.meta.get("mime_type")
                else:
                    try:
                        url = URL(cast(DatasourceInvokeMessage.TextMessage, response.message).text)
                        extension = url.suffix
                        guess_type_result, _ = guess_type(f"a{extension}")
                        if guess_type_result:
                            mimetype = guess_type_result
                    except Exception:
                        pass

                if not mimetype:
                    mimetype = "image/jpeg"

                yield DatasourceInvokeMessageBinary(
                    mimetype=response.meta.get("mime_type", "image/jpeg"),
                    url=cast(DatasourceInvokeMessage.TextMessage, response.message).text,
                )
            elif response.type == DatasourceInvokeMessage.MessageType.BLOB:
                if not response.meta:
                    raise ValueError("missing meta data")

                yield DatasourceInvokeMessageBinary(
                    mimetype=response.meta.get("mime_type", "application/octet-stream"),
                    url=cast(DatasourceInvokeMessage.TextMessage, response.message).text,
                )
            elif response.type == DatasourceInvokeMessage.MessageType.LINK:
                # check if there is a mime type in meta
                if response.meta and "mime_type" in response.meta:
                    yield DatasourceInvokeMessageBinary(
                        mimetype=response.meta.get("mime_type", "application/octet-stream")
                        if response.meta
                        else "application/octet-stream",
                        url=cast(DatasourceInvokeMessage.TextMessage, response.message).text,
                    )

    @staticmethod
    def _create_message_files(
        datasource_messages: Iterable[DatasourceInvokeMessageBinary],
        agent_message: Message,
        invoke_from: InvokeFrom,
        user_id: str,
    ) -> list[str]:
        """
        Create message file

        :return: message file ids
        """
        result = []

        for message in datasource_messages:
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

            result.append(message_file.id)

        db.session.close()

        return result
