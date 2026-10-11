"""Strict, pure contracts for one human-consented real Builder Tool call.

These models describe what a person approved, never secrets: credentials are
referenced by ID and opaque internal revisions only. Scope digests are keyed
HMACs over canonical finite JSON, so they reveal nothing about binding inputs.
Expiry blocks only new phases (``validate_phase``); durable recording of an
already-dispatched phase's outcome is owned by the consent service.
"""

import hashlib
import hmac
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, Protocol

from pydantic import AfterValidator, BeforeValidator, Field, StrictBool, StrictInt, model_validator

from core.dify_builder.execution_policy import (
    BoundedID,
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
    Digest,
    _TrustedModel,
    canonical_json,
)

ConsentState = Literal[
    "prepared", "confirmed", "claimed", "completed", "failed", "unknown", "declined", "expired", "invalidated"
]
Phase = Literal["refresh", "business"]

# One canonical path segment: no slash, dot segment, query, fragment, percent
# escape, whitespace or non-ASCII. Bytes are bound exactly; nothing is normalized.
MESSAGE_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,256}\Z")
GMAIL_API_HOST = "gmail.googleapis.com"
GMAIL_MESSAGE_PATH = "/gmail/v1/users/me/messages/{message_id}"
GMAIL_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"

_SCOPE_DOMAIN = b"dify-builder/real-call-consent/scope/v1\x00"
_SPENT_STATES = frozenset({"claimed", "completed", "failed", "unknown"})

# Proposed server-only companion headers of a confirmed tenant dispatch. They
# state the contract a daemon must enforce; sending them is not evidence that a
# deployed daemon supports it (qualification stays a separate rollout gate).
EXPECTED_PLUGIN_IDENTIFIER_HEADER = "X-Dify-Expected-Plugin-Identifier"
EXPECTED_INSTALLATION_ID_HEADER = "X-Dify-Expected-Installation-ID"
CONFIRMED_DISPATCH_HEADER = "X-Dify-Confirmed-Dispatch"
CONFIRMED_DISPATCH_VERSION = "v1"
_CONFIRMED_HEADER_NAMES = frozenset(
    {EXPECTED_PLUGIN_IDENTIFIER_HEADER, EXPECTED_INSTALLATION_ID_HEADER, CONFIRMED_DISPATCH_HEADER}
)
# Visible ASCII only: no whitespace, CR/LF or other header-splitting bytes.
_HEADER_VALUE = re.compile(r"[\x21-\x7e]{1,256}\Z")


def _message_id(value: str) -> str:
    if MESSAGE_ID_PATTERN.fullmatch(value) is None:
        raise ValueError("unsafe message ID")
    return value


def _utc(value: datetime) -> datetime:
    offset = value.utcoffset()
    if offset is None or offset.total_seconds() != 0:
        raise ValueError("timestamp must be UTC")
    return value.astimezone(UTC)


def _exact_int(value: Any) -> Any:
    # Literal[1] alone accepts True; limits must be real integers.
    if type(value) is not int:
        raise ValueError("expected integer")
    return value


def _exact_bool(value: Any) -> Any:
    # Literal[False] alone accepts 0.
    if type(value) is not bool:
        raise ValueError("expected boolean")
    return value


BoundedText = Annotated[str, Field(strict=True, min_length=1, max_length=256)]
ReasonCode = Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9_]{0,127}$")]
MessageID = Annotated[str, Field(strict=True), AfterValidator(_message_id)]
UTCDateTime = Annotated[datetime, Field(strict=True), AfterValidator(_utc)]
ExactlyOne = Annotated[Literal[1], BeforeValidator(_exact_int)]
AlwaysFalse = Annotated[Literal[False], BeforeValidator(_exact_bool)]
Version = Annotated[StrictInt, Field(ge=0)]


class ActionOutcome(_TrustedModel):
    """Sanitized terminal outcome; never carries message content or provider text."""

    state: Literal["completed", "failed", "unknown"]
    reason_code: ReasonCode


class GmailReadParameters(_TrustedModel):
    message_id: MessageID
    include_body: StrictBool
    include_attachments: StrictBool


class InstalledToolBinding(_TrustedModel):
    """Exact audited installation. Only local runtime dispatch is qualified."""

    tenant_id: BoundedID
    installation_id: BoundedID
    plugin_id: BoundedText
    provider_id: BoundedText
    tool_name: BoundedID
    unique_identifier: BoundedText
    version: BoundedID
    checksum: Digest
    schema_digest: Digest
    source_audit_revision: BoundedText
    daemon_contract_revision: BoundedText
    runtime_type: Literal["local"]


class CredentialReference(_TrustedModel):
    """Selected credential metadata. Revisions are internal and stay out of public DTOs."""

    credential_id: BoundedID
    provider_id: BoundedText
    alias: BoundedText
    credential_type: BoundedID
    visibility: BoundedID
    revision: Digest
    oauth_client_revision: Digest
    expires_at: Annotated[StrictInt, Field(ge=-1)]


class ConsentBinding(_TrustedModel):
    """Everything a consent covers; any difference invalidates it."""

    tenant_id: BoundedID
    app_id: BoundedID
    workflow_id: BoundedID
    actor_id: BoundedID
    session_id: BoundedID
    prepared_commit_id: BoundedID
    interaction_id: BoundedID
    plan_identity: Digest
    test_input_id: BoundedID
    execution_revision: Digest
    graph_revision: Digest
    submitted_inputs_digest: Digest
    effective_inputs_digest: Digest
    node_id: BoundedID
    node_implementation: BoundedText
    node_version: Literal["1"] = "1"
    node_config_digest: Digest
    policy_version: BoundedText
    disclosure_version: BoundedText
    prepared_version: Version
    installed: InstalledToolBinding
    credential: CredentialReference
    parameters: GmailReadParameters
    expires_at: UTCDateTime
    native_attempt_limit: ExactlyOne = 1
    refresh_limit: ExactlyOne = 1


class ConsentDisclosure(_TrustedModel):
    """Immutable public statement of the concrete effect a person may approve."""

    action: Literal["get_message"]
    credential_id: BoundedID
    credential_alias: BoundedText
    credential_type: BoundedID
    identity_basis: Literal["workspace_credential"]
    remote_account_status: Literal["unknown"]
    message_id: MessageID
    request_method: Literal["GET"]
    request_url: Annotated[str, Field(strict=True, max_length=512)]
    # The plugin always fetches format=full; output flags only shape its result.
    response_format: Literal["full"]
    include_body: StrictBool
    include_attachments: StrictBool
    oauth_refresh: Literal["if_needed"]
    oauth_refresh_method: Literal["POST"]
    oauth_refresh_url: Literal["https://oauth2.googleapis.com/token"]
    native_attempt_limit: ExactlyOne
    refresh_limit: ExactlyOne
    automatic_replay: AlwaysFalse
    quota_usage: Literal["possible"]
    monetary_estimate: Literal["unknown"]
    output_retention: Literal["native_run_retention"]
    data_description: Literal["gmail_message_headers_snippet_and_selected_body_or_attachment_metadata"]
    expires_at: UTCDateTime
    prior_uncertain_consent_id: BoundedID | None = None

    @model_validator(mode="after")
    def fixed_target(self) -> "ConsentDisclosure":
        if self.request_url != gmail_message_url(self.message_id):
            raise ValueError("disclosed target does not match message")
        return self


class ConsentReceipt(_TrustedModel):
    consent_id: BoundedID
    scope_digest: Digest
    state: ConsentState
    at_version: Version
    disclosure: ConsentDisclosure
    command_id: BoundedID | None
    execution_request_id: BoundedID | None
    native_run_id: BoundedID | None
    native_node_execution_id: BoundedID | None
    reason_code: ReasonCode | None
    refresh_claimed: StrictBool
    business_claimed: StrictBool
    can_retry: StrictBool

    @model_validator(mode="after")
    def no_retry_after_spend(self) -> "ConsentReceipt":
        spent = self.refresh_claimed or self.business_claimed
        if spent and self.state not in _SPENT_STATES:
            raise ValueError("phase claim requires a claimed grant")
        if self.can_retry and (self.command_id is not None or spent or self.state in _SPENT_STATES):
            raise ValueError("a reserved or claimed grant cannot be retried")
        return self


class ConfirmedToolBinding(_TrustedModel):
    """Immutable INTERNAL in-process handle for one confirmed native Tool node.

    The consent service reconstructs it from its own durable reservation and the
    native Run/node records. It is never a public DTO, and deserializing one is
    never permission authority.
    """

    context: ConfirmedToolExecutionContext
    node_id: BoundedID
    native_run_id: BoundedID
    native_node_execution_id: BoundedID


class ConfirmedToolGuard(Protocol):
    """INTERNAL in-process callbacks binding one claimed grant to the native Tool owners.

    Only the consent service constructs an implementation, from its own durable
    state; no HTTP or queue payload can supply one. The native owners call it in
    this order and never with an open SQL transaction: ``before_refresh`` (spend
    the refresh phase) → native refresh → ``persist_refresh`` (short CAS; the
    caller then invalidates the ordinary credential cache) → native conversion
    → ``before_invoke`` with the complete final envelope (spend the business
    phase) → one dispatch with ``dispatch_headers`` → ``observe_json`` per JSON
    message → exactly one ``finish_stream``. A spent refresh that is never
    recorded ends there too: the refresh owner calls ``finish_stream`` once with
    ``complete=False`` and no business phase follows. Any refusal raises
    ``BuilderExecutionPolicyError``; nothing is retried.
    """

    binding: ConfirmedToolBinding

    def before_refresh(self) -> None: ...

    def persist_refresh(self, encrypted_credentials: str, expires_at: int) -> str: ...

    def before_invoke(self, parameters: Mapping[str, object]) -> None: ...

    def observe_json(self, message: Mapping[str, object]) -> None: ...

    def finish_stream(self, *, complete: bool, declared_failure: bool) -> None: ...

    def dispatch_headers(self) -> dict[str, str]: ...


def confirmed_dispatch_headers(installed: InstalledToolBinding) -> dict[str, str]:
    """The exact companion headers pinning a confirmed dispatch to the stored installation."""
    if not isinstance(installed, InstalledToolBinding):
        raise BuilderExecutionPolicyError("confirmed_dispatch_headers_invalid")
    return validate_confirmed_dispatch_headers(
        {
            EXPECTED_PLUGIN_IDENTIFIER_HEADER: installed.unique_identifier,
            EXPECTED_INSTALLATION_ID_HEADER: installed.installation_id,
            CONFIRMED_DISPATCH_HEADER: CONFIRMED_DISPATCH_VERSION,
        }
    )


def validate_confirmed_dispatch_headers(headers: Mapping[str, str]) -> dict[str, str]:
    """Exactly the three companion headers, safe values and the supported version; anything else refuses."""
    if not isinstance(headers, Mapping) or set(headers) != _CONFIRMED_HEADER_NAMES:
        raise BuilderExecutionPolicyError("confirmed_dispatch_headers_invalid")
    checked = {name: headers[name] for name in sorted(_CONFIRMED_HEADER_NAMES)}
    if any(type(value) is not str or _HEADER_VALUE.fullmatch(value) is None for value in checked.values()):
        raise BuilderExecutionPolicyError("confirmed_dispatch_headers_invalid")
    if checked[CONFIRMED_DISPATCH_HEADER] != CONFIRMED_DISPATCH_VERSION:
        raise BuilderExecutionPolicyError("confirmed_dispatch_headers_invalid")
    return checked


def gmail_message_url(message_id: str) -> str:
    return f"https://{GMAIL_API_HOST}{GMAIL_MESSAGE_PATH.format(message_id=message_id)}?format=full"


def scope_digest(binding: ConsentBinding, *, key: bytes) -> str:
    """Opaque domain-separated HMAC-SHA256; key rotation invalidates outstanding grants."""
    if type(key) is not bytes or not key:
        raise BuilderExecutionPolicyError("invalid_scope_key")
    if not isinstance(binding, ConsentBinding):
        raise BuilderExecutionPolicyError("invalid_consent_binding")
    message = _SCOPE_DOMAIN + canonical_json(binding.model_dump(mode="json"))
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def validate_scope(expected: ConsentBinding, current: ConsentBinding) -> None:
    if (
        not isinstance(expected, ConsentBinding)
        or not isinstance(current, ConsentBinding)
        or expected.model_dump(mode="json") != current.model_dump(mode="json")
    ):
        raise BuilderExecutionPolicyError("consent_scope_changed")


def _aware(value: Any) -> bool:
    return isinstance(value, datetime) and value.utcoffset() is not None


def validate_phase(
    *, state: ConsentState, phase: Phase, claimed: bool, expires_at: datetime, now: datetime, refresh_uncertain: bool
) -> None:
    """Pre-effect check before spending a phase. ``claimed`` is that phase's own spent flag.

    Only starting a phase calls this; finishing an already-dispatched phase does not.
    """
    if phase not in ("refresh", "business"):
        raise BuilderExecutionPolicyError("unsupported_phase")
    if not _aware(expires_at) or not _aware(now):
        raise BuilderExecutionPolicyError("invalid_consent_time")
    if type(claimed) is not bool or type(refresh_uncertain) is not bool:
        raise BuilderExecutionPolicyError("invalid_phase_input")
    if state != "claimed":
        raise BuilderExecutionPolicyError("consent_not_claimed")
    if claimed:
        raise BuilderExecutionPolicyError("phase_already_claimed")
    # An uncertain refresh may have rotated tokens remotely; nothing further may run.
    if refresh_uncertain:
        raise BuilderExecutionPolicyError("refresh_uncertain")
    if now >= expires_at:
        raise BuilderExecutionPolicyError("consent_expired")
