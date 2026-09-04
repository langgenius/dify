from typing import Any

from core.app.file_access import DatabaseFileAccessController
from core.db.session_factory import session_factory
from core.file.upload_file_policy import (
    has_direct_upload_file_download_policy,
    resolve_upload_file_storage_policy,
)
from graphon.file import helpers as file_helpers
from models.enums import UploadFilePurpose

_file_access_controller = DatabaseFileAccessController()


def build_icon_url(icon_type: Any, icon: str | None) -> str | None:
    if icon is None or icon_type is None:
        return None

    from models.model import IconType

    icon_type_value = icon_type.value if isinstance(icon_type, IconType) else str(icon_type)
    if icon_type_value.lower() != IconType.IMAGE:
        return None

    return resolve_icon_file_url(icon)


def resolve_icon_file_url(upload_file_id: str) -> str:
    """Resolve an icon URL through its storage policy while preserving the legacy proxy fallback."""
    purpose = UploadFilePurpose.ICON
    if not has_direct_upload_file_download_policy(purpose):
        return file_helpers.get_signed_file_url(upload_file_id=upload_file_id)

    with session_factory.create_session() as session:
        upload_file = _file_access_controller.get_upload_file(session=session, file_id=upload_file_id)
        if upload_file is None:
            raise ValueError(f"Upload file {upload_file_id} not found")

        if upload_file.purpose == purpose:
            policy = resolve_upload_file_storage_policy(
                purpose,
                storage_type=upload_file.storage_type,
                key=upload_file.key,
            )
        else:
            policy = None

        if policy is not None:
            direct_url = policy.generate_download_url(
                upload_file.key,
                content_type=upload_file.mime_type,
            )
            if direct_url is not None:
                return direct_url

    return file_helpers.get_signed_file_url(upload_file_id=upload_file_id)
