from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager, nullcontext
from typing import Any

from graphon.file import File, FileUploadConfig

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import (
    DatabaseFileAccessController,
    FileAccessControllerProtocol,
    FileAccessScope,
    bind_file_access_scope,
)
from factories import file_factory
from models import Account, EndUser

PREPARED_FILES_ARG_KEY = "_request_files_prepared"
PREPARED_FILE_UPLOAD_CONFIG_ARG_KEY = "_prepared_file_upload_config"

_default_file_access_controller = DatabaseFileAccessController()


def bind_request_file_access_scope(
    *,
    tenant_id: str,
    user: Account | EndUser,
    invoke_from: InvokeFrom,
) -> AbstractContextManager[None]:
    user_id = getattr(user, "id", None)
    if not isinstance(user_id, str) or not user_id:
        return nullcontext()

    user_from = UserFrom.ACCOUNT if isinstance(user, Account) else UserFrom.END_USER
    return bind_file_access_scope(
        FileAccessScope(
            tenant_id=tenant_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
        )
    )


def parse_request_files(
    *,
    files: Sequence[Mapping[str, Any]],
    tenant_id: str,
    user: Account | EndUser,
    invoke_from: InvokeFrom,
    file_upload_config: FileUploadConfig | None,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol = _default_file_access_controller,
) -> Sequence[File]:
    if file_upload_config is None:
        return []

    with bind_request_file_access_scope(
        tenant_id=tenant_id,
        user=user,
        invoke_from=invoke_from,
    ):
        return file_factory.build_from_mappings(
            mappings=files,
            tenant_id=tenant_id,
            config=file_upload_config,
            strict_type_validation=strict_type_validation,
            access_controller=access_controller,
        )


def prepare_request_file_args(
    *,
    args: Mapping[str, Any],
    files: Sequence[Mapping[str, Any]],
    tenant_id: str,
    user: Account | EndUser,
    invoke_from: InvokeFrom,
    file_upload_config: FileUploadConfig | None,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol = _default_file_access_controller,
) -> dict[str, Any]:
    prepared_args = dict(args)
    prepared_files = parse_request_files(
        files=files,
        tenant_id=tenant_id,
        user=user,
        invoke_from=invoke_from,
        file_upload_config=file_upload_config,
        strict_type_validation=strict_type_validation,
        access_controller=access_controller,
    )
    prepared_args["files"] = [file.to_dict() for file in prepared_files]
    prepared_args[PREPARED_FILES_ARG_KEY] = True
    prepared_args[PREPARED_FILE_UPLOAD_CONFIG_ARG_KEY] = (
        file_upload_config.model_dump(mode="json") if file_upload_config else None
    )
    return prepared_args


def deserialize_prepared_files(files: Sequence[File | Mapping[str, Any]] | None) -> list[File]:
    deserialized_files: list[File] = []
    for file in files or []:
        if isinstance(file, File):
            deserialized_files.append(file)
            continue
        deserialized_files.append(File.model_validate(file))
    return deserialized_files


def deserialize_prepared_file_upload_config(
    file_upload_config: FileUploadConfig | Mapping[str, Any] | None,
) -> FileUploadConfig | None:
    if file_upload_config is None or isinstance(file_upload_config, FileUploadConfig):
        return file_upload_config
    return FileUploadConfig.model_validate(file_upload_config)
