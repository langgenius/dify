from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import urllib.parse
from collections.abc import Generator
from typing import TYPE_CHECKING, Literal

from graphon.file import FileTransferMethod
from graphon.file.protocols import HttpResponseProtocol, WorkflowFileRuntimeProtocol
from graphon.file.runtime import set_workflow_file_runtime

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController, FileAccessControllerProtocol
from core.db.session_factory import session_factory
from core.helper.ssrf_proxy import ssrf_proxy
from core.tools.signature import sign_tool_file
from core.workflow.file_reference import parse_file_reference
from extensions.ext_storage import storage

if TYPE_CHECKING:
    from graphon.file import File


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
    def multimodal_send_format(self) -> str:
        return dify_config.MULTIMODAL_SEND_FORMAT

    def http_get(self, url: str, *, follow_redirects: bool = True) -> HttpResponseProtocol:
        return ssrf_proxy.get(url, follow_redirects=follow_redirects)

    def storage_load(self, path: str, *, stream: bool = False) -> bytes | Generator:
        return storage.load(path, stream=stream)

    def load_file_bytes(self, *, file: File) -> bytes:
        storage_key = self._resolve_storage_key(file=file)
        data = storage.load(storage_key, stream=False)
        if not isinstance(data, bytes):
            raise ValueError(f"file {storage_key} is not a bytes object")
        return data

    def resolve_file_url(self, *, file: File, for_external: bool = True) -> str | None:
        if file.transfer_method == FileTransferMethod.REMOTE_URL:
            return file.remote_url
        parsed_reference = parse_file_reference(file.reference)
        if parsed_reference is None:
            raise ValueError("Missing file reference")
        if file.transfer_method == FileTransferMethod.LOCAL_FILE:
            return self.resolve_upload_file_url(
                upload_file_id=parsed_reference.record_id,
                for_external=for_external,
            )
        if file.transfer_method == FileTransferMethod.DATASOURCE_FILE:
            if file.extension is None:
                raise ValueError("Missing file extension")
            self._assert_upload_file_access(upload_file_id=parsed_reference.record_id)
            return sign_tool_file(
                tool_file_id=parsed_reference.record_id,
                extension=file.extension,
                for_external=for_external,
            )
        if file.transfer_method == FileTransferMethod.TOOL_FILE:
            if file.extension is None:
                raise ValueError("Missing file extension")
            return self.resolve_tool_file_url(
                tool_file_id=parsed_reference.record_id,
                extension=file.extension,
                for_external=for_external,
            )
        return None

    def resolve_upload_file_url(
        self,
        *,
        upload_file_id: str,
        as_attachment: bool = False,
        for_external: bool = True,
    ) -> str:
        self._assert_upload_file_access(upload_file_id=upload_file_id)
        base_url = self._base_url(for_external=for_external)
        url = f"{base_url}/files/{upload_file_id}/file-preview"
        query = self._sign_query(payload=f"file-preview|{upload_file_id}")
        if as_attachment:
            query["as_attachment"] = "true"
        return f"{url}?{urllib.parse.urlencode(query)}"

    def resolve_tool_file_url(self, *, tool_file_id: str, extension: str, for_external: bool = True) -> str:
        self._assert_tool_file_access(tool_file_id=tool_file_id)
        return sign_tool_file(tool_file_id=tool_file_id, extension=extension, for_external=for_external)

    def verify_preview_signature(
        self,
        *,
        preview_kind: Literal["image", "file"],
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> bool:
        payload = f"{preview_kind}-preview|{file_id}|{timestamp}|{nonce}"
        recalculated = hmac.new(self._secret_key(), payload.encode(), hashlib.sha256).digest()
        if sign != base64.urlsafe_b64encode(recalculated).decode():
            return False
        return int(time.time()) - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT

    @staticmethod
    def _base_url(*, for_external: bool) -> str:
        if for_external:
            return dify_config.FILES_URL
        return dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL

    @staticmethod
    def _secret_key() -> bytes:
        return dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""

    def _sign_query(self, *, payload: str) -> dict[str, str]:
        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        sign = hmac.new(self._secret_key(), f"{payload}|{timestamp}|{nonce}".encode(), hashlib.sha256).digest()
        return {
            "timestamp": timestamp,
            "nonce": nonce,
            "sign": base64.urlsafe_b64encode(sign).decode(),
        }

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


def bind_dify_workflow_file_runtime() -> None:
    set_workflow_file_runtime(DifyWorkflowFileRuntime(file_access_controller=DatabaseFileAccessController()))
