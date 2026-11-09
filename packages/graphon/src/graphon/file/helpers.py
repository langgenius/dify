from __future__ import annotations

from typing import TYPE_CHECKING

from .runtime import get_workflow_file_runtime

if TYPE_CHECKING:
    from .models import File


def resolve_file_url(file: File, /, *, for_external: bool = True) -> str | None:
    return get_workflow_file_runtime().resolve_file_url(
        file=file,
        for_external=for_external,
    )


def get_signed_file_url(
    upload_file_id: str,
    as_attachment: bool = False,
    for_external: bool = True,
) -> str:
    return get_workflow_file_runtime().resolve_upload_file_url(
        upload_file_id=upload_file_id,
        as_attachment=as_attachment,
        for_external=for_external,
    )


def get_signed_tool_file_url(
    tool_file_id: str,
    extension: str,
    for_external: bool = True,
) -> str:
    return get_workflow_file_runtime().resolve_tool_file_url(
        tool_file_id=tool_file_id,
        extension=extension,
        for_external=for_external,
    )


def verify_image_signature(
    *,
    upload_file_id: str,
    timestamp: str,
    nonce: str,
    sign: str,
) -> bool:
    return get_workflow_file_runtime().verify_preview_signature(
        preview_kind="image",
        file_id=upload_file_id,
        timestamp=timestamp,
        nonce=nonce,
        sign=sign,
    )


def verify_file_signature(
    *,
    upload_file_id: str,
    timestamp: str,
    nonce: str,
    sign: str,
) -> bool:
    return get_workflow_file_runtime().verify_preview_signature(
        preview_kind="file",
        file_id=upload_file_id,
        timestamp=timestamp,
        nonce=nonce,
        sign=sign,
    )
