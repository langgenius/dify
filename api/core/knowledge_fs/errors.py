"""Errors and image-reference values shared across KnowledgeFS capability boundaries."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from core.knowledge_fs.retrieval_contracts import KnowledgeFSPublicFailureResponse

QUERY_IMAGE_MAX_COUNT = 4
QUERY_IMAGE_MAX_TOTAL_BYTES = 32 * 1024 * 1024


class KnowledgeFSAppAdmissionError(RuntimeError):
    """The app is not explicitly bound to an enabled KnowledgeFS channel."""


class KnowledgeFSAppBindingNotEnabledError(KnowledgeFSAppAdmissionError):
    """The requested app binding is missing, revoked, or outside the caller scope."""


class KnowledgeFSAppChannelDisabledError(KnowledgeFSAppAdmissionError):
    """The requested app caller channel is disabled for the control-space."""


class KnowledgeFSAppSpaceUnavailableError(KnowledgeFSAppAdmissionError):
    """The bound control-space is not active and provisioned for product traffic."""


class KnowledgeFSAppAuthorizationNotReadyError(KnowledgeFSAppAdmissionError):
    """Required local authorization policy or revision state is unavailable."""


class KnowledgeFSAppBindingManagementError(RuntimeError):
    """An app binding cannot be created or changed safely."""


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


class KnowledgeFSQueryImageError(ValueError):
    """A safe validation error raised before query model or retrieval work starts."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class KnowledgeFSWorkflowQueryImageReference:
    """One workflow-authorized Dify file reference safe to forward through KnowledgeFS."""

    upload_file_id: str
    access_grant: str = field(repr=False)
    byte_size: int
    mime_type: str
