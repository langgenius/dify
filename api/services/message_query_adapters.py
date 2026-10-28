"""File and execution-content infrastructure for detached message projections."""

from collections.abc import Sequence
from typing import cast

from pydantic import JsonValue

from core.app.file_access import DatabaseFileAccessController
from factories import file_factory
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod
from models.model import Message, MessageFileInfo
from models.utils.file_input_compat import build_file_from_input_mapping
from repositories.execution_extra_content_repository import ExecutionExtraContentRepository
from services.entities.message_entities import (
    MessageFileProjection,
    MessageFileRecord,
    MessageFileReference,
    MessageInputValue,
)


class MessageFileResolver:
    def __init__(self) -> None:
        self._access_controller: DatabaseFileAccessController = DatabaseFileAccessController()

    def resolve(
        self,
        *,
        tenant_id: str,
        inputs: dict[str, MessageInputValue],
        answer: str,
        files: Sequence[MessageFileReference],
    ) -> MessageFileProjection:
        restored_inputs = dict(inputs)

        def owner_tenant_id() -> str:
            return tenant_id

        for key, value in inputs.items():
            if isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
                restored_inputs[key] = build_file_from_input_mapping(
                    file_mapping=value, tenant_resolver=owner_tenant_id
                )
            elif isinstance(value, list) and all(
                isinstance(item, dict) and item.get("dify_model_identity") == FILE_MODEL_IDENTITY for item in value
            ):
                restored_inputs[key] = [
                    build_file_from_input_mapping(file_mapping=item, tenant_resolver=owner_tenant_id)
                    for item in value
                    if isinstance(item, dict)
                ]

        restored_files = [self._file(file, tenant_id=tenant_id) for file in files]
        # Keep the model's legacy URL grammar and signing behavior in one place.
        # This transient bridge has no ORM session and cannot commit a message read.
        signed_answer = Message(answer=answer).re_sign_file_url_answer
        return MessageFileProjection(inputs=restored_inputs, answer=signed_answer, files=restored_files)

    def _file(self, source: MessageFileReference, *, tenant_id: str) -> MessageFileRecord:
        upload_file_id = source.upload_file_id
        mapping: dict[str, object] = {
            "id": source.id,
            "type": source.type,
            "transfer_method": source.transfer_method,
            "upload_file_id": upload_file_id,
        }
        match source.transfer_method:
            case FileTransferMethod.LOCAL_FILE:
                if upload_file_id is None:
                    raise ValueError(f"MessageFile {source.id} is a local file but has no upload_file_id")
            case FileTransferMethod.REMOTE_URL:
                if source.url is None:
                    raise ValueError(f"MessageFile {source.id} is a remote url but has no url")
                mapping["url"] = source.url
            case FileTransferMethod.TOOL_FILE:
                if upload_file_id is None:
                    assert source.url is not None
                    # Historical tool URLs are recovered only in the response.
                    upload_file_id = source.url.split("/")[-1].split(".")[0]
                mapping["tool_file_id"] = upload_file_id
            case _:
                raise ValueError(f"MessageFile {source.id} has an invalid transfer_method {source.transfer_method}")

        file = cast(
            MessageFileInfo,
            file_factory.build_from_mapping(
                mapping=mapping, tenant_id=tenant_id, access_controller=self._access_controller
            ).to_dict(),
        )
        return MessageFileRecord(
            id=file["id"],
            filename=file["filename"],
            type=file["type"],
            url=file.get("url"),
            mime_type=file.get("mime_type"),
            size=file.get("size"),
            transfer_method=file["transfer_method"],
            belongs_to=source.belongs_to,
            upload_file_id=upload_file_id,
        )


class ExecutionExtraContentReader:
    def __init__(self, *, repository: ExecutionExtraContentRepository) -> None:
        self._repository: ExecutionExtraContentRepository = repository

    def get_by_message_ids(self, message_ids: Sequence[str]) -> list[list[dict[str, JsonValue]]]:
        return [
            [cast(dict[str, JsonValue], item.model_dump(mode="json", exclude_none=True)) for item in items]
            for items in self._repository.get_by_message_ids(message_ids)
        ]
