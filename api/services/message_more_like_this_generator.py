"""Prepare detached completion history and execute it through the shared completion runtime.

Only the existing model/file infrastructure needs an isolated Flask scope. Source
reads finish before entering this scope, and record writes finish before the
completion worker starts. The worker retains its existing internal I/O owners.
"""

from collections.abc import Iterator, Mapping
from typing import Any, cast
from uuid import uuid4

from flask import current_app
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope, bind_file_access_scope
from extensions.ext_database import db
from factories import file_factory
from graphon.file import FileTransferMethod
from graphon.file.constants import FILE_MODEL_IDENTITY
from libs.orjson import orjson_dumps
from libs.stream import close_stream
from models.model import AppMode, AppModelConfigDict
from models.utils.file_input_compat import build_file_from_stored_mapping
from services.entities.message_entities import MessageAccount, MessageActor
from services.message_more_like_this_service import (
    MoreLikeThisFile,
    MoreLikeThisResponse,
    MoreLikeThisSource,
)


class _MoreLikeThisEventStream:
    """Encode completion events and own the source even before the first iteration."""

    def __init__(self, source: Iterator[Mapping[str, object] | str]) -> None:
        self._source = source
        self._closed = False

    def __iter__(self) -> "_MoreLikeThisEventStream":
        return self

    def __next__(self) -> str:
        if self._closed:
            raise StopIteration
        try:
            event = next(self._source)
            if isinstance(event, Mapping):
                return f"data: {orjson_dumps(event)}\n\n"
            return f"event: {event}\n\n"
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            close_stream(self._source)


class MessageMoreLikeThisGenerator:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory
        self._file_access_controller = DatabaseFileAccessController()

    def generate(
        self,
        *,
        source: MoreLikeThisSource,
        actor: MessageActor,
        model_config: dict[str, JsonValue],
        streaming: bool,
    ) -> MoreLikeThisResponse:
        assert source.historical_model_config_id is not None
        account = isinstance(actor, MessageAccount)
        user_id = actor.account_id if isinstance(actor, MessageAccount) else actor.end_user_id
        invoke_from = InvokeFrom.EXPLORE if account else InvokeFrom.WEB_APP
        scope = FileAccessScope(
            tenant_id=source.tenant_id,
            user_id=user_id,
            user_from=UserFrom.ACCOUNT if account else UserFrom.END_USER,
            invoke_from=invoke_from,
        )
        # Credential resolution can commit its scoped session. Isolate it from
        # pending work in the caller; this scope also cleans up preparation errors.
        with current_app.app_context(), bind_file_access_scope(scope):
            config_dict = cast(AppModelConfigDict, model_config)
            file_config = FileUploadConfigManager.convert(config_dict)
            files = (
                file_factory.build_from_mappings(
                    mappings=[_file_mapping(file) for file in source.files],
                    tenant_id=source.tenant_id,
                    config=file_config,
                    access_controller=self._file_access_controller,
                )
                if file_config is not None
                else []
            )
            app_config = CompletionAppConfigManager.get_app_config_from_dict(
                tenant_id=source.tenant_id,
                app_id=source.app_id,
                app_model_config_id=source.historical_model_config_id,
                app_mode=AppMode.COMPLETION,
                config_dict=config_dict,
                config_from=EasyUIBasedAppModelConfigFrom.ARGS,
            )
            db.session.remove()
            model = ModelConfigConverter.convert(app_config)
            db.session.remove()
            inputs = _restore_inputs(source.inputs, tenant_id=source.tenant_id)
            db.session.remove()
            entity = CompletionAppGenerateEntity(
                task_id=str(uuid4()),
                app_config=app_config,
                model_conf=model,
                inputs=inputs,
                query=source.query,
                files=list(files),
                user_id=user_id,
                stream=streaming,
                invoke_from=invoke_from,
                extras={},
            )
            response = CompletionAppGenerator().generate_from_entity(entity, session_factory=self._session_factory)
            return response if isinstance(response, Mapping) else _MoreLikeThisEventStream(response)


def _file_mapping(file: MoreLikeThisFile) -> dict[str, object]:
    mapping: dict[str, object] = {
        "id": file.id,
        "type": file.type,
        "transfer_method": file.transfer_method,
        "url": file.url,
        "upload_file_id": file.upload_file_id,
    }
    if file.transfer_method == FileTransferMethod.TOOL_FILE:
        # Recover old tool references without rewriting historical message rows.
        tool_file_id = file.upload_file_id
        if tool_file_id is None:
            if file.url is None:
                raise ValueError(f"MessageFile {file.id} has no tool file reference")
            tool_file_id = file.url.split("/")[-1].split(".")[0]
        mapping["tool_file_id"] = tool_file_id
    elif file.transfer_method == FileTransferMethod.LOCAL_FILE and file.upload_file_id is None:
        raise ValueError(f"MessageFile {file.id} is a local file but has no upload_file_id")
    elif file.transfer_method == FileTransferMethod.REMOTE_URL and file.url is None:
        raise ValueError(f"MessageFile {file.id} is a remote url but has no url")
    elif file.transfer_method == FileTransferMethod.DATASOURCE_FILE:
        raise ValueError(f"MessageFile {file.id} has an invalid transfer_method {file.transfer_method}")
    return mapping


def _restore_inputs(inputs: Mapping[str, JsonValue], *, tenant_id: str) -> dict[str, Any]:
    """Recover stored files without revalidating or normalizing historical inputs."""
    restored: dict[str, Any] = dict(inputs)
    for key, value in inputs.items():
        if isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
            restored[key] = build_file_from_stored_mapping(file_mapping=value, tenant_id=tenant_id)
        elif isinstance(value, list) and all(
            isinstance(item, dict) and item.get("dify_model_identity") == FILE_MODEL_IDENTITY for item in value
        ):
            restored[key] = [
                build_file_from_stored_mapping(file_mapping=item, tenant_id=tenant_id)
                for item in value
                if isinstance(item, dict)
            ]
    return restored
