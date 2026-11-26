"""Consumer-owned A2A 1.0 profile, values and I/O port.

No method retries business dispatch. The owner persists send_started before
calling send; an unknown acceptance must never be converted to a fresh send.
"""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal, Protocol

from .contracts import AgentCardFieldError, VerificationFailureSubreason
from .io_contracts import JsonObject, JsonValue

PROFILE_VERSION = "a2a-1.0-http-json.v1"
TRACEABILITY_URI = "https://github.com/a2aproject/a2a-samples/extensions/traceability/v1"


class VerificationAuthCheck(StrEnum):
    PASSED_FOR_READ_ENDPOINT = "passed_for_read_endpoint"
    NOT_EXERCISED = "not_exercised"


class GatewayUsageSource(StrEnum):
    TASK = "task"
    MESSAGE = "message"
    STATUS_UPDATE = "statusUpdate"


class GatewayReceiptKind(StrEnum):
    TASK = "task"
    MESSAGE = "message"


class ResponseIssue(StrEnum):
    """Fixed facts about a received invalid initial direct Message.

    These values contain no peer field names, values or text. Absence of a
    diagnostic never implies a valid reply or a rejected business submission.
    """

    MESSAGE_CONTEXT_ID_MISSING = "message_context_id_missing"
    MESSAGE_CONTEXT_ID_INVALID = "message_context_id_invalid"
    MESSAGE_ROLE_MISSING = "message_role_missing"
    MESSAGE_ROLE_INVALID = "message_role_invalid"
    MESSAGE_CONTEXT_ID_AND_ROLE_INVALID = "message_context_id_and_role_invalid"


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
    auth_check: VerificationAuthCheck
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
class GatewayUsageCarrier:
    """Transient, gateway-correlated source for one reported usage object.

    The fixed source names identify actual wire carriers, never an inferred
    location in an assembled Task. The value remains untrusted until a supported
    usage profile validates it; it is not part of durable response payloads.
    """

    source: GatewayUsageSource
    value: JsonValue = field(repr=False)


@dataclass(frozen=True, slots=True, kw_only=True)
class GatewayReceipt:
    """Validated wire response; payload is one assembled v1.0 Task or Message.

    task_id/state are absent for direct Message. Missing optional Task context
    remains absent; correlation with carried context belongs to the invocation
    owner, not invented transport state.
    """

    kind: GatewayReceiptKind
    payload: JsonObject
    task_id: str | None = None
    context_id: str | None = None
    state: str | None = None
    # None means the current wire carrier did not supply usage, not zero tokens.
    usage_carrier: GatewayUsageCarrier | None = None


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
        verification_subreason: VerificationFailureSubreason | None = None,
        card_errors: tuple[AgentCardFieldError, ...] = (),
        response_issue: ResponseIssue | None = None,
    ) -> None:
        """Retain safe gateway facts without changing runtime dispatch semantics.

        Pre: diagnostics contain only validated fixed identifiers; response_issue
        describes a received invalid initial direct Message, never a transport
        failure or an observation after a known receipt.
        Post: omitted diagnostics mean no reliable refinement; runtime codes,
        acceptance uncertainty and retry policy remain independent of them.
        """
        super().__init__(message)
        self.code = code
        self.submission_unknown = submission_unknown
        self.known_receipt = known_receipt
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        self.verification_subreason = verification_subreason
        self.card_errors = card_errors
        self.response_issue = response_issue


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
