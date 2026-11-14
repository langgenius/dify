"""Map admitted legacy identities to the end-user upload application boundary.

Staff/knowledge uploads retain their existing capability. End-user uploads have
one persistence owner, including local, remote and Human Input entry points.
"""

from typing import Literal

from graphon.file import helpers as file_helpers
from models.account import Account
from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile
from services.end_user_upload_service import EndUserUploadService, UploadActor
from services.file_service import FileService, FileUploadActor, FileUploadResult


class FileUploadGateway:
    """Translate trusted creator identities without accepting a client tenant field."""

    # Remote fetching uses the same pre-download guard as staff uploads. The
    # application service still validates the actual received bytes at admission.
    is_file_size_within_limit = staticmethod(FileService.is_file_size_within_limit)

    def __init__(self, *, end_users: EndUserUploadService, staff: FileService) -> None:
        """Receive both capabilities from the composition root; perform no I/O."""
        self._end_users = end_users
        self._staff = staff

    def upload_file(
        self,
        *,
        filename: str,
        content: bytes,
        mimetype: str,
        user: Account | EndUser | FileUploadActor,
        tenant_id: str | None = None,
        source: Literal["datasets", "knowledge_fs"] | None = None,
        source_url: str = "",
        default_file_size_limit: int | None = None,
    ) -> FileUploadResult | UploadFile:
        """Admit an existing identity and call exactly one upload use case.

        Explicit tenant overrides remain available for staff. An end-user
        identity cannot authorize a different workspace. Actor references are
        rechecked by the quota repository when the policy is enabled. Returned
        end-user values are detached and preserve the existing response fields.
        """
        if isinstance(user, FileUploadActor) and tenant_id is None:
            raise TypeError("tenant_id is required when uploading with FileUploadActor")
        end_user = isinstance(user, EndUser) or (
            isinstance(user, FileUploadActor) and user.creator_role == CreatorUserRole.END_USER
        )
        if not end_user:
            return self._staff.upload_file(
                filename=filename,
                content=content,
                mimetype=mimetype,
                user=user,
                tenant_id=tenant_id,
                source=source,
                source_url=source_url,
                default_file_size_limit=default_file_size_limit,
            )
        resource_tenant_id = user.tenant_id if isinstance(user, EndUser) else tenant_id
        if isinstance(user, EndUser) and tenant_id is not None and tenant_id != user.tenant_id:
            raise ValueError("End-user uploads must use the admitted workspace")
        if not resource_tenant_id:
            raise ValueError("End-user upload workspace is required")
        uploaded = self._end_users.upload(
            UploadActor(tenant_id=resource_tenant_id, end_user_id=user.id),
            filename=filename,
            content=content,
            mimetype=mimetype,
            source=source,
            source_url=source_url,
            default_file_size_limit=default_file_size_limit,
        )
        return FileUploadResult(
            id=uploaded.id,
            name=uploaded.name,
            size=uploaded.size,
            extension=uploaded.extension,
            mime_type=uploaded.mime_type,
            created_by=uploaded.created_by,
            created_at=uploaded.created_at,
            tenant_id=uploaded.tenant_id,
            source_url=uploaded.source_url or file_helpers.get_signed_file_url(upload_file_id=uploaded.id),
        )
