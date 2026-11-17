from collections.abc import Mapping
from typing import Any, Protocol

from flask import Request
from pydantic import TypeAdapter

from core.plugin.utils.http_parser import deserialize_request, serialize_request


class TriggerRequestStorage(Protocol):
    def save(self, filename: str, data: bytes) -> None: ...
    def load_once(self, filename: str) -> bytes: ...


class TriggerHttpRequestCachingService:
    """
    Service for caching trigger requests.
    """

    _TRIGGER_STORAGE_PATH = "triggers"

    def __init__(self, *, storage: TriggerRequestStorage) -> None:
        self._storage = storage

    def get_raw_request(self, request_id: str) -> bytes:
        """Return the persisted HTTP request bytes for an existing request ID."""
        return self._storage.load_once(f"{self._TRIGGER_STORAGE_PATH}/{request_id}.raw")

    def get_request(self, request_id: str) -> Request:
        """
        Get the request object from the storage.

        Args:
            request_id: The ID of the request.

        Returns:
            The request object.
        """
        return deserialize_request(self.get_raw_request(request_id))

    def get_payload(self, request_id: str) -> Mapping[str, Any]:
        """
        Get the payload from the storage.

        Args:
            request_id: The ID of the request.

        Returns:
            The payload.
        """
        return TypeAdapter(Mapping[str, Any]).validate_json(
            self._storage.load_once(f"{self._TRIGGER_STORAGE_PATH}/{request_id}.payload")
        )

    def persist_request(self, request_id: str, request: Request) -> None:
        """
        Persist the request in the storage.

        Args:
            request_id: The ID of the request.
            request: The request object.
        """
        self._storage.save(f"{self._TRIGGER_STORAGE_PATH}/{request_id}.raw", serialize_request(request))

    def persist_payload(self, request_id: str, payload: Mapping[str, Any]) -> None:
        """
        Persist the payload in the storage.
        """
        self._storage.save(
            f"{self._TRIGGER_STORAGE_PATH}/{request_id}.payload",
            TypeAdapter(Mapping[str, Any]).dump_json(payload),
        )
