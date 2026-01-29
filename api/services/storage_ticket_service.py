"""Storage ticket service for generating opaque download/upload URLs.

This service provides a ticket-based approach for file access. Instead of exposing
the real storage key in URLs, it generates a random UUID token and stores the mapping
in Redis with a TTL.

Usage:
    from services.storage_ticket_service import StorageTicketService

    # Generate a download ticket
    url = StorageTicketService.create_download_url("path/to/file.txt", expires_in=300)

    # Generate an upload ticket
    url = StorageTicketService.create_upload_url("path/to/file.txt", expires_in=300, max_bytes=10*1024*1024)

URL format:
    {FILES_URL}/files/storage-tickets/{token}

The token is validated by looking up the Redis key, which contains:
    - op: "download" or "upload"
    - storage_key: the real storage path
    - max_bytes: (upload only) maximum allowed upload size
    - filename: suggested filename for Content-Disposition header
"""

import json
import logging
from dataclasses import dataclass
from uuid import uuid4

from configs import dify_config
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

TICKET_KEY_PREFIX = "storage_files"
DEFAULT_DOWNLOAD_TTL = 300  # 5 minutes
DEFAULT_UPLOAD_TTL = 300  # 5 minutes
DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100MB


@dataclass
class StorageTicket:
    """Represents a storage access ticket."""

    op: str  # "download" or "upload"
    storage_key: str
    max_bytes: int | None = None  # upload only
    filename: str | None = None  # suggested filename for download

    def to_dict(self) -> dict:
        data = {"op": self.op, "storage_key": self.storage_key}
        if self.max_bytes is not None:
            data["max_bytes"] = str(self.max_bytes)
        if self.filename is not None:
            data["filename"] = self.filename
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "StorageTicket":
        return cls(
            op=data["op"],
            storage_key=data["storage_key"],
            max_bytes=data.get("max_bytes"),
            filename=data.get("filename"),
        )


class StorageTicketService:
    """Service for creating and validating storage access tickets."""

    @classmethod
    def create_download_url(
        cls,
        storage_key: str,
        *,
        expires_in: int = DEFAULT_DOWNLOAD_TTL,
        filename: str | None = None,
    ) -> str:
        """Create a download ticket and return the URL.

        Args:
            storage_key: The real storage path
            expires_in: TTL in seconds (default 300)
            filename: Suggested filename for Content-Disposition header

        Returns:
            Full URL with token
        """
        if filename is None:
            filename = storage_key.rsplit("/", 1)[-1]

        ticket = StorageTicket(op="download", storage_key=storage_key, filename=filename)
        token = cls._store_ticket(ticket, expires_in)
        return cls._build_url(token)

    @classmethod
    def create_upload_url(
        cls,
        storage_key: str,
        *,
        expires_in: int = DEFAULT_UPLOAD_TTL,
        max_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    ) -> str:
        """Create an upload ticket and return the URL.

        Args:
            storage_key: The real storage path
            expires_in: TTL in seconds (default 300)
            max_bytes: Maximum allowed upload size in bytes

        Returns:
            Full URL with token
        """
        ticket = StorageTicket(op="upload", storage_key=storage_key, max_bytes=max_bytes)
        token = cls._store_ticket(ticket, expires_in)
        return cls._build_url(token)

    @classmethod
    def get_ticket(cls, token: str) -> StorageTicket | None:
        """Retrieve a ticket by token.

        Args:
            token: The UUID token from the URL

        Returns:
            StorageTicket if found and valid, None otherwise
        """
        key = cls._ticket_key(token)
        try:
            data = redis_client.get(key)
            if data is None:
                return None
            if isinstance(data, bytes):
                data = data.decode("utf-8")
            return StorageTicket.from_dict(json.loads(data))
        except Exception:
            logger.warning("Failed to retrieve storage ticket: %s", token, exc_info=True)
            return None

    @classmethod
    def _store_ticket(cls, ticket: StorageTicket, ttl: int) -> str:
        """Store a ticket in Redis and return the token."""
        token = str(uuid4())
        key = cls._ticket_key(token)
        value = json.dumps(ticket.to_dict())
        redis_client.setex(key, ttl, value)
        return token

    @classmethod
    def _ticket_key(cls, token: str) -> str:
        """Generate Redis key for a token."""
        return f"{TICKET_KEY_PREFIX}:{token}"

    @classmethod
    def _build_url(cls, token: str) -> str:
        """Build the full URL for a token."""
        base_url = dify_config.FILES_URL
        return f"{base_url}/files/storage-files/{token}"
