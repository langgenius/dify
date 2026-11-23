from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import urllib.parse
from collections.abc import Generator
from typing import TYPE_CHECKING, Literal, override
from uuid import UUID

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController, FileAccessControllerProtocol
from core.db.session_factory import session_factory
from core.file import remote_fetcher
from core.tools.signature import bind_file_uri, sign_tool_file_uri
from core.workflow.file_reference import parse_file_reference
from extensions.ext_storage import storage
from graphon.file import FileTransferMethod
from graphon.file.protocols import WorkflowFileRuntimeProtocol
from graphon.file.runtime import peek_workflow_file_runtime
from graphon.http.protocols import HttpResponseProtocol
from libs.account_avatar import ACCOUNT_AVATAR_NONCE_PREFIX

if TYPE_CHECKING:
    from dify_app import DifyApp
    from graphon.file import File


_ACCOUNT_AVATAR_PREVIEW_PURPOSE = "account-avatar-preview"
_ACCOUNT_AVATAR_WINDOW_SECONDS = 60
_ACCOUNT_AVATAR_CLOCK_SKEW_SECONDS = 5


class DifyWorkflowFileRuntime(WorkflowFileRuntimeProtocol):
    """Production runtime wiring for ``graphon.file``.

    Opaque file references are resolved back to canonical database records before
    URLs are signed or storage keys are used. When a request-scoped file access
    scope is present, those lookups additionally enforce tenant and end-user
    ownership filters.
    """

    _file_access_controller: FileAccessControllerProtocol

    def __init__(self, *, file_access_controller: FileAccessControllerProtocol) -> None:
        self._file_access_controller = file_access_controller

    @property
    @override
    def multimodal_send_format(self) -> str:
        return dify_config.MULTIMODAL_SEND_FORMAT

    @override
    def http_get(self, url: str, *, follow_redirects: bool = True) -> HttpResponseProtocol:
        return remote_fetcher.graphon_remote_file_fetcher.get(url, follow_redirects=follow_redirects)

    @override
    def storage_load(self, path: str, *, stream: bool = False) -> bytes | Generator:
        return storage.load(path, stream=stream)

    @override
    def load_file_bytes(self, *, file: File) -> bytes:
        storage_key = self._resolve_storage_key(file=file)
        data = storage.load(storage_key, stream=False)
        if not isinstance(data, bytes):
            raise ValueError(f"file {storage_key} is not a bytes object")
        return data

    @override
    def resolve_file_url(self, *, file: File, for_external: bool = True) -> str | None:
        uri = self.resolve_file_uri(file=file)
        if uri is None or file.transfer_method == FileTransferMethod.REMOTE_URL:
            return uri
        return bind_file_uri(uri, self._base_url(for_external=for_external))

    def resolve_file_uri(self, *, file: File) -> str | None:
        """Resolve a signed file URI without binding Dify-owned files to an origin.

        Remote URLs retain their external absolute URL. Dify-owned files return
        a signed ``/files/...`` URI that callers can bind to their own network
        audience without exposing ``FILES_URL`` or ``INTERNAL_FILES_URL``.
        """

        if file.transfer_method == FileTransferMethod.REMOTE_URL:
            return file.remote_url
        parsed_reference = parse_file_reference(file.reference)
        if parsed_reference is None:
            raise ValueError("Missing file reference")
        if file.transfer_method == FileTransferMethod.LOCAL_FILE:
            return self.resolve_upload_file_uri(
                upload_file_id=parsed_reference.record_id,
            )
        if file.transfer_method == FileTransferMethod.DATASOURCE_FILE:
            if file.extension is None:
                raise ValueError("Missing file extension")
            self._assert_upload_file_access(upload_file_id=parsed_reference.record_id)
            return sign_tool_file_uri(
                tool_file_id=parsed_reference.record_id,
                extension=file.extension,
            )
        if file.transfer_method == FileTransferMethod.TOOL_FILE:
            if file.extension is None:
                raise ValueError("Missing file extension")
            return self.resolve_tool_file_uri(
                tool_file_id=parsed_reference.record_id,
                extension=file.extension,
            )
        return None

    @override
    def resolve_upload_file_url(
        self,
        *,
        upload_file_id: str,
        as_attachment: bool = False,
        for_external: bool = True,
    ) -> str:
        uri = self.resolve_upload_file_uri(upload_file_id=upload_file_id, as_attachment=as_attachment)
        return bind_file_uri(uri, self._base_url(for_external=for_external))

    def resolve_avatar_file_url(self, *, upload_file_id: str, account_id: str) -> str:
        """Sign an account-scoped avatar preview. Delivery must verify the upload's ownership."""
        uri = self._resolve_upload_file_uri(upload_file_id=upload_file_id, avatar_account_id=account_id)
        return bind_file_uri(uri, self._base_url(for_external=True))

    def resolve_upload_file_uri(
        self,
        *,
        upload_file_id: str,
        as_attachment: bool = False,
    ) -> str:
        """Resolve a signed UploadFile URI without selecting an origin."""

        return self._resolve_upload_file_uri(upload_file_id=upload_file_id, as_attachment=as_attachment)

    def _resolve_upload_file_uri(
        self, *, upload_file_id: str, as_attachment: bool = False, avatar_account_id: str | None = None
    ) -> str:
        self._assert_upload_file_access(upload_file_id=upload_file_id)
        uri = f"/files/{upload_file_id}/file-preview"
        query = self._sign_query(upload_file_id=upload_file_id, avatar_account_id=avatar_account_id)
        if as_attachment:
            query["as_attachment"] = "true"
        return f"{uri}?{urllib.parse.urlencode(query)}"

    @override
    def resolve_tool_file_url(self, *, tool_file_id: str, extension: str, for_external: bool = True) -> str:
        uri = self.resolve_tool_file_uri(tool_file_id=tool_file_id, extension=extension)
        return bind_file_uri(uri, self._base_url(for_external=for_external))

    def resolve_tool_file_uri(self, *, tool_file_id: str, extension: str) -> str:
        """Resolve a signed ToolFile URI without selecting an origin."""

        self._assert_tool_file_access(tool_file_id=tool_file_id)
        return sign_tool_file_uri(tool_file_id=tool_file_id, extension=extension)

    @override
    def verify_preview_signature(
        self,
        *,
        preview_kind: Literal["image", "file"],
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> bool:
        is_avatar = preview_kind == "file" and nonce.startswith(ACCOUNT_AVATAR_NONCE_PREFIX)
        purpose = _ACCOUNT_AVATAR_PREVIEW_PURPOSE if is_avatar else f"{preview_kind}-preview"
        payload = f"{purpose}|{file_id}|{timestamp}|{nonce}"
        recalculated = hmac.new(self._secret_key(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(sign.encode(), base64.urlsafe_b64encode(recalculated)):
            return False
        age = int(time.time()) - int(timestamp)
        return age <= dify_config.FILES_ACCESS_TIMEOUT and (not is_avatar or age >= -_ACCOUNT_AVATAR_CLOCK_SKEW_SECONDS)

    @staticmethod
    def _base_url(*, for_external: bool) -> str:
        if for_external:
            return dify_config.FILES_URL
        return dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL

    @staticmethod
    def _secret_key() -> bytes:
        return dify_config.SECRET_KEY.encode()

    def _sign_query(self, *, upload_file_id: str, avatar_account_id: str | None) -> dict[str, str]:
        timestamp = int(time.time())
        if avatar_account_id is not None:
            # Round down without consuming more than half of the signature lifetime.
            window = min(_ACCOUNT_AVATAR_WINDOW_SECONDS, max(1, dify_config.FILES_ACCESS_TIMEOUT // 2))
            timestamp -= timestamp % window
            nonce = f"{ACCOUNT_AVATAR_NONCE_PREFIX}{avatar_account_id}"
            purpose = _ACCOUNT_AVATAR_PREVIEW_PURPOSE
        else:
            nonce = os.urandom(16).hex()
            purpose = "file-preview"
        payload = f"{purpose}|{upload_file_id}|{timestamp}|{nonce}"
        sign = hmac.new(self._secret_key(), payload.encode(), hashlib.sha256).digest()
        query = {
            "timestamp": str(timestamp),
            "nonce": nonce,
            "sign": base64.urlsafe_b64encode(sign).decode(),
        }
        if avatar_account_id is not None:
            # Let clients refresh cached responses before the embedded URL expires.
            query["expires_at"] = str(timestamp + dify_config.FILES_ACCESS_TIMEOUT)
        return query

    def _resolve_storage_key(self, *, file: File) -> str:
        parsed_reference = parse_file_reference(file.reference)
        if parsed_reference is None:
            raise ValueError("Missing file reference")

        record_id = parsed_reference.record_id
        with session_factory.create_session() as session:
            if file.transfer_method in {
                FileTransferMethod.LOCAL_FILE,
                FileTransferMethod.REMOTE_URL,
                FileTransferMethod.DATASOURCE_FILE,
            }:
                upload_file = self._file_access_controller.get_upload_file(session=session, file_id=record_id)
                if upload_file is None:
                    raise ValueError(f"Upload file {record_id} not found")
                return upload_file.key

            tool_file = self._file_access_controller.get_tool_file(session=session, file_id=record_id)
            if tool_file is None:
                raise ValueError(f"Tool file {record_id} not found")
            return tool_file.file_key

    def _assert_upload_file_access(self, *, upload_file_id: str) -> None:
        if self._file_access_controller.current_scope() is None:
            return

        with session_factory.create_session() as session:
            upload_file = self._file_access_controller.get_upload_file(session=session, file_id=upload_file_id)
            if upload_file is None:
                raise ValueError(f"Upload file {upload_file_id} not found")

    def _assert_tool_file_access(self, *, tool_file_id: str) -> None:
        if self._file_access_controller.current_scope() is None:
            return

        with session_factory.create_session() as session:
            tool_file = self._file_access_controller.get_tool_file(session=session, file_id=tool_file_id)
            if tool_file is None:
                raise ValueError(f"Tool file {tool_file_id} not found")


def get_signed_avatar_url(*, upload_file_id: str, account_id: str) -> str | None:
    """Sign a valid file reference for its expected account through the active Dify runtime."""
    try:
        file_id = str(UUID(upload_file_id))
        owner_id = str(UUID(account_id))
    except ValueError:
        return None
    runtime = peek_workflow_file_runtime()
    if isinstance(runtime, DifyWorkflowFileRuntime):
        return runtime.resolve_avatar_file_url(upload_file_id=file_id, account_id=owner_id)
    return None


def build_account_avatar_url(*, avatar: str | None, account_id: str) -> str | None:
    """Keep external avatar URLs and scope uploaded avatar references to their account."""
    if not avatar:
        return None
    if avatar.startswith(("http://", "https://")):
        return avatar
    return get_signed_avatar_url(upload_file_id=avatar, account_id=account_id)


def avatar_preview_cache_max_age(*, timestamp: str, nonce: str) -> int | None:
    """Return remaining private-cache seconds for an already verified avatar signature."""
    if not nonce.startswith(ACCOUNT_AVATAR_NONCE_PREFIX):
        return None
    age = max(0, int(time.time()) - int(timestamp))
    return min(_ACCOUNT_AVATAR_WINDOW_SECONDS, max(0, dify_config.FILES_ACCESS_TIMEOUT - age))


def create_dify_workflow_file_runtime() -> DifyWorkflowFileRuntime:
    return DifyWorkflowFileRuntime(file_access_controller=DatabaseFileAccessController())


def init_app(app: DifyApp) -> None:
    """Bind host-side file rendering for each Flask request, task, and CLI context."""
    app.extensions["workflow_file_runtime"] = create_dify_workflow_file_runtime()
