"""Consumer-owned A2A 1.0 profile, values and I/O port.

No method retries business dispatch. The owner persists send_started before
calling send; an unknown acceptance must never be converted to a fresh send.
"""

from dataclasses import dataclass, field
from typing import Literal, Protocol

from .io_contracts import JsonObject

PROFILE_VERSION = "a2a-1.0-http-json.v1"
TRACEABILITY_URI = "https://github.com/a2aproject/a2a-samples/extensions/traceability/v1"


@dataclass(frozen=True, slots=True)
class NoAuth:
    kind: Literal["none"] = "none"


@dataclass(frozen=True, slots=True)
class BearerAuth:
    token: str = field(repr=False)
    kind: Literal["bearer"] = "bearer"


@dataclass(frozen=True, slots=True)
class SealedBearerAuth:
    """Persistent credential reference decrypted only inside the I/O adapter."""

    tenant_id: str
    ciphertext: str = field(repr=False)
    kind: Literal["sealed_bearer"] = "sealed_bearer"


class CredentialDecoderPort(Protocol):
    def decrypt(self, tenant_id: str, ciphertext: str) -> str:
        """Decrypt only the admitted tenant's ciphertext, returning a transient secret."""
        ...


type Authentication = NoAuth | BearerAuth | SealedBearerAuth


@dataclass(frozen=True, slots=True, kw_only=True)
class ConnectionSpec:
    """Frozen connection material; interface_url is absent before discovery only.

    remote_tenant is the remote Card routing value, never a Dify tenant ID.
    enabled_extensions contains only explicitly enabled supported URI profiles.
    supports_streaming is read from the immutable verified Card revision for
    execution, never from a caller job. It is false before Card discovery.
    """

    endpoint: str
    authentication: Authentication
    interface_url: str | None = None
    remote_tenant: str | None = None
    enabled_extensions: tuple[str, ...] = ()
    supports_streaming: bool = False


@dataclass(frozen=True, slots=True, kw_only=True)
class VerificationResult:
    """Read-only verification evidence, which never proves business task success."""

    card: JsonObject
    interface_url: str
    remote_tenant: str | None
    auth_check: Literal["passed_for_read_endpoint", "not_exercised"]
    card_fingerprint: str
    streaming: bool
    required_extensions: tuple[str, ...]
    profile_version: str = PROFILE_VERSION


@dataclass(frozen=True, slots=True, kw_only=True)
class SendRequest:
    """Validated input Parts with new message ID; context_id is server-returned only."""

    message_id: str
    parts: tuple[JsonObject, ...]
    context_id: str | None = None
    accepted_output_modes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class GatewayReceipt:
    """Validated wire response; payload is one assembled v1.0 Task or Message.

    task_id/state are absent for direct Message. Missing optional Task context
    remains absent; correlation with carried context belongs to the invocation
    owner, not invented transport state.
    """

    kind: Literal["task", "message"]
    payload: JsonObject
    task_id: str | None = None
    context_id: str | None = None
    state: str | None = None


class GatewayError(ValueError):
    """Safe application failure; no remote body, credential or protocol status leaks."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        submission_unknown: bool = False,
        known_receipt: GatewayReceipt | None = None,
        retryable: bool = False,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.submission_unknown = submission_unknown
        self.known_receipt = known_receipt
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds


class GatewayPort(Protocol):
    def verify(self, connection: ConnectionSpec, *, timeout_seconds: float = 30) -> VerificationResult:
        """Read Card/protected read endpoint only; never creates a remote Task."""
        ...

    def send(
        self,
        connection: ConnectionSpec,
        request: SendRequest,
        *,
        streaming: bool,
        timeout_seconds: float = 30,
    ) -> GatewayReceipt:
        """Perform exactly one business POST, bounded by caller's remaining budget.

        SSE may yield a known nonterminal Task at the listening cutoff. Its owner
        queries that same Task. Failure before a known Task is conservatively
        submission_unknown after transport admission, never automatically retried.
        """
        ...

    def get_task(self, connection: ConnectionSpec, task_id: str, *, timeout_seconds: float = 30) -> GatewayReceipt:
        """Read an existing Task once; caller owns read backoff and absolute budget."""
        ...

    def cancel_task(self, connection: ConnectionSpec, task_id: str, *, timeout_seconds: float = 30) -> GatewayReceipt:
        """Request cancellation once; only authoritative returned state proves cancellation."""
        ...
