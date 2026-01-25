from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import urllib.parse
from dataclasses import dataclass
from uuid import UUID

from configs import dify_config
from libs import rsa


@dataclass(frozen=True)
class SandboxArchivePath:
    tenant_id: UUID
    sandbox_id: UUID

    def get_storage_key(self) -> str:
        return f"sandbox/{self.tenant_id}/{self.sandbox_id}.tar.gz"

    def proxy_path(self) -> str:
        return f"{self.tenant_id}/{self.sandbox_id}"


class SandboxArchiveSigner:
    SIGNATURE_PREFIX = "sandbox-archive"
    SIGNATURE_VERSION = "v1"
    OPERATION_DOWNLOAD = "download"
    OPERATION_UPLOAD = "upload"

    @classmethod
    def create_download_signature(cls, archive_path: SandboxArchivePath, expires_at: int, nonce: str) -> str:
        return cls._create_signature(
            archive_path=archive_path,
            operation=cls.OPERATION_DOWNLOAD,
            expires_at=expires_at,
            nonce=nonce,
        )

    @classmethod
    def create_upload_signature(cls, archive_path: SandboxArchivePath, expires_at: int, nonce: str) -> str:
        return cls._create_signature(
            archive_path=archive_path,
            operation=cls.OPERATION_UPLOAD,
            expires_at=expires_at,
            nonce=nonce,
        )

    @classmethod
    def verify_download_signature(
        cls, archive_path: SandboxArchivePath, expires_at: int, nonce: str, sign: str
    ) -> bool:
        return cls._verify_signature(
            archive_path=archive_path,
            operation=cls.OPERATION_DOWNLOAD,
            expires_at=expires_at,
            nonce=nonce,
            sign=sign,
        )

    @classmethod
    def verify_upload_signature(cls, archive_path: SandboxArchivePath, expires_at: int, nonce: str, sign: str) -> bool:
        return cls._verify_signature(
            archive_path=archive_path,
            operation=cls.OPERATION_UPLOAD,
            expires_at=expires_at,
            nonce=nonce,
            sign=sign,
        )

    @classmethod
    def _verify_signature(
        cls,
        *,
        archive_path: SandboxArchivePath,
        operation: str,
        expires_at: int,
        nonce: str,
        sign: str,
    ) -> bool:
        if expires_at <= 0:
            return False

        expected_sign = cls._create_signature(
            archive_path=archive_path,
            operation=operation,
            expires_at=expires_at,
            nonce=nonce,
        )
        if not hmac.compare_digest(sign, expected_sign):
            return False

        current_time = int(time.time())
        if expires_at < current_time:
            return False

        if expires_at - current_time > dify_config.FILES_ACCESS_TIMEOUT:
            return False

        return True

    @classmethod
    def build_signed_url(
        cls,
        *,
        archive_path: SandboxArchivePath,
        expires_in: int,
        action: str,
    ) -> str:
        expires_in = min(expires_in, dify_config.FILES_ACCESS_TIMEOUT)
        expires_at = int(time.time()) + max(expires_in, 1)
        nonce = os.urandom(16).hex()
        sign = cls._create_signature(
            archive_path=archive_path,
            operation=action,
            expires_at=expires_at,
            nonce=nonce,
        )

        base_url = dify_config.FILES_URL
        url = f"{base_url}/files/sandbox-archives/{archive_path.proxy_path()}/{action}"
        query = urllib.parse.urlencode({"expires_at": expires_at, "nonce": nonce, "sign": sign})
        return f"{url}?{query}"

    @classmethod
    def _create_signature(
        cls,
        *,
        archive_path: SandboxArchivePath,
        operation: str,
        expires_at: int,
        nonce: str,
    ) -> str:
        key = cls._tenant_key(str(archive_path.tenant_id))
        message = (
            f"{cls.SIGNATURE_PREFIX}|{cls.SIGNATURE_VERSION}|{operation}|"
            f"{archive_path.tenant_id}|{archive_path.sandbox_id}|{expires_at}|{nonce}"
        )
        sign = hmac.new(key, message.encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(sign).decode()

    @classmethod
    def _tenant_key(cls, tenant_id: str) -> bytes:
        try:
            rsa_key, _ = rsa.get_decrypt_decoding(tenant_id)
        except rsa.PrivkeyNotFoundError as exc:
            raise ValueError(f"Tenant private key missing for tenant_id={tenant_id}") from exc
        private_key = rsa_key.export_key()
        return hashlib.sha256(private_key).digest()
