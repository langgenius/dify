from collections.abc import Mapping
from typing import Any

from flask import Request
from pydantic import TypeAdapter

from core.plugin.utils.http_parser import deserialize_request, serialize_request
from extensions.ext_storage import storage


class TriggerHttpRequestCachingService:
    """
    Service for caching trigger requests.
    """

    _TRIGGER_STORAGE_PATH = "triggers"

    @classmethod
    def get_request(cls, request_id: str) -> Request:
        """
        Get the request object from the storage.

        Args:
            request_id: The ID of the request.

        Returns:
            The request object.
        """
        return deserialize_request(storage.load_once(f"{cls._TRIGGER_STORAGE_PATH}/{request_id}.raw"))

    @classmethod
    def get_payload(cls, request_id: str) -> Mapping[str, Any]:
        """
        Get the payload from the storage.

        Args:
            request_id: The ID of the request.

        Returns:
            The payload.
        """
        return TypeAdapter(Mapping[str, Any]).validate_json(
            storage.load_once(f"{cls._TRIGGER_STORAGE_PATH}/{request_id}.payload")
        )

    @classmethod
    def persist_request(cls, request_id: str, request: Request) -> None:
        """
        Persist the request in the storage.

        Args:
            request_id: The ID of the request.
            request: The request object.
        """
        storage.save(f"{cls._TRIGGER_STORAGE_PATH}/{request_id}.raw", serialize_request(request))

    @classmethod
    def persist_payload(cls, request_id: str, payload: Mapping[str, Any]) -> None:
        """
        Persist the payload in the storage.
        """
        storage.save(
            f"{cls._TRIGGER_STORAGE_PATH}/{request_id}.payload",
            TypeAdapter(Mapping[str, Any]).dump_json(payload),  # type: ignore
        )
