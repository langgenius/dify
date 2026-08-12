"""Ports for capability-authenticated, manifest-bounded KnowledgeFS BFF calls."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Literal, NamedTuple, Protocol

from pydantic import JsonValue

from services.knowledge_fs.product_dto import KnowledgeFSPublicFailureResponse, KnowledgeFSTechnicalSummary


class KnowledgeFSProductRemoteError(RuntimeError):
    """KnowledgeFS could not provide an authoritative product response."""

    def __init__(
        self,
        message: str,
        *,
        failure: KnowledgeFSPublicFailureResponse | None = None,
    ) -> None:
        super().__init__(message)
        self.failure = failure


class KnowledgeFSProductResourceNotFoundError(KnowledgeFSProductRemoteError):
    """KnowledgeFS authoritatively reported that an authorized child resource is absent."""


class KnowledgeFSOperationUnavailableError(RuntimeError):
    """The Dify/KFS/Capability operation manifests are not yet aligned."""


class KnowledgeFSProductRequestRejectedError(RuntimeError):
    """A bounded product request was rejected locally or by authoritative KFS validation."""

    def __init__(
        self,
        *,
        status_code: Literal[400, 403, 409, 413, 422, 429],
        failure: KnowledgeFSPublicFailureResponse | None = None,
    ) -> None:
        super().__init__(f"KnowledgeFS rejected the product request with HTTP {status_code}")
        self.status_code = status_code
        self.failure = failure


class KnowledgeFSRemoteJSONRequest(NamedTuple):
    operation_id: str
    method: str
    path: str
    namespace_id: str
    knowledge_space_id: str
    capability_token: str
    trace_id: str
    payload: JsonValue | None
    query: tuple[tuple[str, str], ...] = ()
    headers: tuple[tuple[str, str], ...] = ()


class KnowledgeFSRemoteBinaryRequest(NamedTuple):
    operation_id: str
    method: str
    path: str
    namespace_id: str
    knowledge_space_id: str
    capability_token: str
    trace_id: str
    body: bytes
    query: tuple[tuple[str, str], ...]


class KnowledgeFSRemoteMultipartFile(NamedTuple):
    filename: str
    content_type: str
    body: bytes


class KnowledgeFSRemoteMultipartRequest(NamedTuple):
    operation_id: str
    method: str
    path: str
    namespace_id: str
    knowledge_space_id: str
    capability_token: str
    trace_id: str
    file: KnowledgeFSRemoteMultipartFile
    query: tuple[tuple[str, str], ...] = ()


class KnowledgeFSRemoteSSERequest(NamedTuple):
    operation_id: str
    method: str
    path: str
    capability_token: str
    trace_id: str
    payload: JsonValue | None
    query: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class KnowledgeFSRemoteSSEResponse:
    status_code: int
    headers: tuple[tuple[str, str], ...]
    chunks: Iterator[bytes]
    close: Callable[[], None]


class KnowledgeFSProductRemotePort(Protocol):
    def batch_space_summaries(
        self,
        *,
        namespace_id: str,
        knowledge_space_ids: tuple[str, ...],
        capability_token: str,
        trace_id: str,
    ) -> dict[str, KnowledgeFSTechnicalSummary]:
        """Fetch exactly the explicit authorized Space IDs in one remote call."""

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> JsonValue:
        """Execute one manifest-approved JSON request using only its operation capability."""

    def execute_binary(self, request: KnowledgeFSRemoteBinaryRequest) -> JsonValue:
        """Execute one strictly bounded binary request using only its operation capability."""

    def execute_multipart(self, request: KnowledgeFSRemoteMultipartRequest) -> JsonValue:
        """Execute one strictly bounded multipart request using only its operation capability."""

    def execute_sse(self, request: KnowledgeFSRemoteSSERequest) -> KnowledgeFSRemoteSSEResponse:
        """Open one manifest-approved SSE request through the internal KnowledgeFS endpoint."""


class UnavailableKnowledgeFSProductRemote:
    """Fail-closed default until a manifest-aligned KFS transport is assembled."""

    def batch_space_summaries(
        self,
        *,
        namespace_id: str,
        knowledge_space_ids: tuple[str, ...],
        capability_token: str,
        trace_id: str,
    ) -> dict[str, KnowledgeFSTechnicalSummary]:
        _ = (namespace_id, knowledge_space_ids, capability_token, trace_id)
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product remote is not configured")

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> JsonValue:
        _ = request
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product remote is not configured")

    def execute_binary(self, request: KnowledgeFSRemoteBinaryRequest) -> JsonValue:
        _ = request
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product remote is not configured")

    def execute_multipart(self, request: KnowledgeFSRemoteMultipartRequest) -> JsonValue:
        _ = request
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product remote is not configured")

    def execute_sse(self, request: KnowledgeFSRemoteSSERequest) -> KnowledgeFSRemoteSSEResponse:
        _ = request
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product remote is not configured")


__all__ = [
    "KnowledgeFSOperationUnavailableError",
    "KnowledgeFSProductRemoteError",
    "KnowledgeFSProductRemotePort",
    "KnowledgeFSProductRequestRejectedError",
    "KnowledgeFSProductResourceNotFoundError",
    "KnowledgeFSRemoteBinaryRequest",
    "KnowledgeFSRemoteJSONRequest",
    "KnowledgeFSRemoteMultipartFile",
    "KnowledgeFSRemoteMultipartRequest",
    "KnowledgeFSRemoteSSERequest",
    "KnowledgeFSRemoteSSEResponse",
    "UnavailableKnowledgeFSProductRemote",
]
