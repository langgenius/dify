"""Stable Builder run metadata and fixture types for persisted records."""

import hashlib
import json
import math
from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from runtime_contracts.builder.string_enum import BuilderStringEnum


class HttpFixtureSource(BuilderStringEnum):
    USER_SAMPLE = "user_sample"
    GENERATED_SAMPLE = "generated_sample"


class HttpFixtureContentType(BuilderStringEnum):
    APPLICATION_JSON = "application/json"
    TEXT_PLAIN = "text/plain"


class EvidencePolicyVersion(BuilderStringEnum):
    BUILDER_RESTRICTED_V1 = "builder-restricted-v1"
    BUILDER_CONFIRMED_GMAIL_READ_V1 = "builder-confirmed-gmail-read-v1"
    BUILDER_JSON_PARSE_V1 = "builder-json-parse-v1"
    BUILDER_CONFIRMED_RUN_V1 = "builder-confirmed-run-v1"


class EvidenceExecutionMode(BuilderStringEnum):
    RESTRICTED = "restricted"
    MOCK = "mock"
    CONFIRMED_TOOL = "confirmed_tool"
    CONFIRMED_RUN = "confirmed_run"


class SafetyOutcome(BuilderStringEnum):
    UNSUPPORTED_SAFE_EXECUTION = "unsupported_safe_execution"
    EXECUTION_BLOCKED = "execution_blocked"
    SIMULATION_COMPLETED = "simulation_completed"
    RESTRICTED_EXECUTION_COMPLETED = "restricted_execution_completed"
    CONFIRMED_TOOL_COMPLETED = "confirmed_tool_completed"
    CONFIRMED_RUN_COMPLETED = "confirmed_run_completed"
    EXECUTION_EVIDENCE_UNKNOWN = "execution_evidence_unknown"
    NATIVE_FAILED = "native_failed"
    PREPARATION_FAILED = "preparation_failed"


class EvidenceFailurePhase(BuilderStringEnum):
    PREPARATION = "preparation"
    EXECUTION = "execution"


class ExecutionFailureReason(BuilderStringEnum):
    CONNECTION_REFUSED = "connection_refused"
    TIMEOUT = "timeout"
    AUTHENTICATION = "authentication"
    PERMISSION_DENIED = "permission_denied"
    CREDENTIAL_UNAVAILABLE = "credential_unavailable"
    AUTHORIZATION_LOOKUP_FAILED = "authorization_lookup_failed"
    RATE_LIMIT = "rate_limit"
    SERVICE_UNAVAILABLE = "service_unavailable"
    UNKNOWN = "unknown"


class FailureResourceKind(BuilderStringEnum):
    MODEL = "model"
    TOOL = "tool"


class EvidenceSandboxProfile(BuilderStringEnum):
    DISABLED = "disabled"
    NETWORK_DISABLED_V1 = "network-disabled-v1"
    NATIVE = "native"


class ExecutionActionState(BuilderStringEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    UNKNOWN = "unknown"


BoundedID = Annotated[str, Field(strict=True, min_length=1, max_length=128)]
Digest = Annotated[str, Field(strict=True, pattern=r"^[0-9a-f]{64}$")]


class BuilderExecutionPolicyError(ValueError):
    """Stable, sanitized refusal; never includes graph, request or response text."""

    def __init__(self, reason_code: str):
        self.reason_code = reason_code
        super().__init__(f"Builder execution policy refused: {reason_code}")


def _finite_json(value: Any) -> None:
    if value is None or type(value) in (bool, int):
        return
    if type(value) is float and math.isfinite(value):
        return
    if type(value) is str:
        value.encode("utf-8", errors="strict")
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _finite_json(item)
        return
    if isinstance(value, dict) and all(type(key) is str for key in value):
        for key, item in value.items():
            _finite_json(key)
            _finite_json(item)
        return
    raise ValueError("invalid finite JSON")


def canonical_json(value: Any) -> bytes:
    """Sorted compact finite UTF-8 JSON; arrays retain execution-significant order."""
    try:
        _finite_json(value)
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        return encoded.encode("utf-8")
    except (ValueError, TypeError, RecursionError):
        raise BuilderExecutionPolicyError("invalid_canonical_json") from None


def canonical_digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


class _TrustedModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

    @field_validator("*", mode="after")
    @classmethod
    def valid_utf8(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                value.encode("utf-8", errors="strict")
            except UnicodeError:
                raise ValueError("invalid UTF-8") from None
        return value


class HttpResponseFixtureV1(_TrustedModel):
    schema_version: Literal[1] = 1
    node_id: BoundedID
    node_type: Literal["http-request"] = "http-request"
    implementation: Literal["graphon.nodes.http_request.node.HttpRequestNode"] = (
        "graphon.nodes.http_request.node.HttpRequestNode"
    )
    node_version: Literal["1"] = "1"
    source: HttpFixtureSource
    status_code: Annotated[int, Field(strict=True, ge=100, le=599)]
    content_type: HttpFixtureContentType
    body: Annotated[str, Field(strict=True)]

    @field_validator("schema_version", mode="before")
    @classmethod
    def strict_version(cls, value: Any) -> Any:
        if type(value) is not int:
            raise ValueError("invalid schema version")
        return value

    @model_validator(mode="after")
    def validate_body(self) -> "HttpResponseFixtureV1":
        if len(self.body.encode("utf-8")) > 65536:
            raise ValueError("fixture body exceeds limit")
        if self.content_type == "application/json":
            try:
                _finite_json(json.loads(self.body))
            except (ValueError, TypeError, RecursionError):
                raise ValueError("invalid finite JSON fixture") from None
        return self


class HttpFixtureSetV1(_TrustedModel):
    schema_version: Literal[1] = 1
    execution_revision: Digest
    fixtures: Annotated[tuple[HttpResponseFixtureV1, ...], Field(max_length=128)]

    @field_validator("schema_version", mode="before")
    @classmethod
    def strict_version(cls, value: Any) -> Any:
        return HttpResponseFixtureV1.strict_version(value)

    @field_validator("fixtures")
    @classmethod
    def unique_fixtures(cls, fixtures: tuple[HttpResponseFixtureV1, ...]) -> tuple[HttpResponseFixtureV1, ...]:
        if len({f.node_id for f in fixtures}) != len(fixtures):
            raise ValueError("duplicate fixture node")
        return tuple(sorted(fixtures, key=lambda f: f.node_id))


def decode_http_fixture_submission(raw: Any) -> tuple[HttpResponseFixtureV1, ...]:
    """Decode only a public fixture list. Provenance cannot be impersonated."""
    if not isinstance(raw, list) or len(raw) > 128:
        raise BuilderExecutionPolicyError("invalid_http_fixtures")
    try:
        fixtures = []
        for item in raw:
            if not isinstance(item, dict) or item.get("source", "user_sample") != "user_sample":
                raise ValueError("invalid fixture source")
            fixtures.append(HttpResponseFixtureV1.model_validate({**item, "source": "user_sample"}))
        if len({f.node_id for f in fixtures}) != len(fixtures):
            raise ValueError("duplicate fixture")
        return tuple(sorted(fixtures, key=lambda f: f.node_id))
    except (ValidationError, ValueError, TypeError):
        raise BuilderExecutionPolicyError("invalid_http_fixtures") from None


def decode_http_fixture_set(raw: Any) -> HttpFixtureSetV1 | None:
    """SQL NULL is historical absence; a stored malformed envelope refuses use."""
    if raw is None:
        return None
    try:
        return HttpFixtureSetV1.model_validate(raw)
    except (ValidationError, ValueError, TypeError):
        raise BuilderExecutionPolicyError("invalid_http_fixture_envelope") from None


ReasonCode = Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9_]{0,127}$")]


class ExecutionEvidenceSummary(_TrustedModel):
    """Sealed Builder evidence for one launch; IDs, statuses and reason codes only.

    Confirmed summaries carry the consent reference and the sanitized action
    outcome (state/reason code) as metadata; the consent owner stays the only
    outcome authority and native Run storage the only content owner.
    """

    request_id: BoundedID
    policy_version: EvidencePolicyVersion = EvidencePolicyVersion.BUILDER_RESTRICTED_V1
    mode: EvidenceExecutionMode
    sealed: bool
    safety_outcome: SafetyOutcome
    failure_phase: EvidenceFailurePhase | None = None
    failure_reason: ExecutionFailureReason | None = None
    failure_resource: (
        tuple[
            FailureResourceKind,
            Annotated[str, Field(strict=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,127}$")],
            Annotated[str, Field(strict=True, pattern=r"^([A-Za-z0-9][A-Za-z0-9_./:@+-]{0,127})?$")],
        ]
        | None
    ) = None
    failure_node_ids: tuple[BoundedID, ...] = ()
    # Confirmed run: the side-effect nodes that returned a mocked result instead of running.
    simulated_node_ids: tuple[BoundedID, ...] = ()
    blocked_node_ids: tuple[BoundedID, ...] = ()
    # ``native`` only for a confirmed run, which uses the workspace's ordinary sandbox.
    sandbox_profile: EvidenceSandboxProfile
    # ``None`` only for a confirmed run, which serves no fixtures.
    fixture_digest: Digest | None = None
    native_run_id: BoundedID | None = None
    # Confirmed only: the grant this launch spent and its sanitized outcome, if recorded.
    consent_id: BoundedID | None = None
    action_state: ExecutionActionState | None = None
    action_reason_code: ReasonCode | None = None

    @model_validator(mode="before")
    @classmethod
    def require_raw_json_seal(cls, raw: Any) -> Any:
        if (
            isinstance(raw, Mapping)
            and raw.get("policy_version") == "builder-json-parse-v1"
            and "sealed" in raw
            and type(raw["sealed"]) is not bool
        ):
            raise ValueError("JSON sealed evidence requires an exact boolean")
        return raw

    @model_validator(mode="after")
    def validate_variant(self) -> "ExecutionEvidenceSummary":
        if self.policy_version == "builder-confirmed-run-v1":
            if (
                self.mode != "confirmed_run"
                or self.sandbox_profile != "native"
                or self.fixture_digest is not None
                or self.blocked_node_ids
                or (self.consent_id, self.action_state, self.action_reason_code) != (None, None, None)
                or self.safety_outcome
                not in {"confirmed_run_completed", "native_failed", "execution_evidence_unknown", "preparation_failed"}
            ):
                raise ValueError("invalid confirmed run evidence")
            if self.safety_outcome == "preparation_failed":
                if (
                    not self.sealed
                    or self.native_run_id is not None
                    or self.failure_phase != "preparation"
                    or self.failure_reason is None
                ):
                    raise ValueError("preparation failure requires observed pre-execution evidence")
                return self
            if self.failure_phase == "execution":
                if (
                    self.safety_outcome != "native_failed"
                    or not self.sealed
                    or self.native_run_id is None
                    or self.failure_reason not in {"service_unavailable", "authentication", "permission_denied"}
                    or self.failure_resource is None
                    or len(self.failure_node_ids) != 1
                ):
                    raise ValueError("runtime service failure requires sealed native node evidence")
                return self
            if (
                self.failure_phase is not None
                or self.failure_reason is not None
                or self.failure_resource is not None
                or self.failure_node_ids
            ):
                raise ValueError("failure preparation metadata requires pre-execution evidence")
            if self.safety_outcome != "execution_evidence_unknown" and (not self.sealed or self.native_run_id is None):
                raise ValueError("confirmed run outcome requires sealed native proof")
            return self
        if (
            self.mode == "confirmed_run"
            or self.sandbox_profile == "native"
            or self.safety_outcome in {"confirmed_run_completed", "preparation_failed"}
            or self.failure_phase is not None
            or self.failure_reason is not None
            or self.failure_resource is not None
            or self.failure_node_ids
        ):
            raise ValueError("confirmed run metadata requires the confirmed run policy")
        if self.policy_version == "builder-restricted-v1":
            if (
                self.mode == "confirmed_tool"
                or self.fixture_digest is None
                or self.safety_outcome == "confirmed_tool_completed"
                or (self.consent_id, self.action_state, self.action_reason_code) != (None, None, None)
            ):
                raise ValueError("restricted evidence cannot carry confirmed metadata")
            return self
        if self.policy_version == "builder-json-parse-v1":
            if (
                self.mode != "restricted"
                or self.sandbox_profile != "disabled"
                or self.fixture_digest is not None
                or self.simulated_node_ids
                or self.blocked_node_ids
                or (self.consent_id, self.action_state, self.action_reason_code) != (None, None, None)
                or self.safety_outcome in {"simulation_completed", "execution_blocked", "confirmed_tool_completed"}
            ):
                raise ValueError("invalid JSON execution evidence")
            if self.safety_outcome == "restricted_execution_completed" and (
                not self.sealed or self.native_run_id is None
            ):
                raise ValueError("JSON completion requires sealed native proof")
            return self
        if (
            self.mode != "confirmed_tool"
            or self.sandbox_profile != "disabled"
            or self.fixture_digest is not None
            or self.consent_id is None
            or self.simulated_node_ids
            or self.blocked_node_ids
            or self.safety_outcome in {"execution_blocked", "simulation_completed", "restricted_execution_completed"}
        ):
            raise ValueError("invalid confirmed evidence")
        if self.safety_outcome == "confirmed_tool_completed" and (
            not self.sealed or self.native_run_id is None or self.action_state != "completed"
        ):
            raise ValueError("confirmed completion requires sealed native proof and a completed action")
        return self


class BuilderExecutionRefusal(_TrustedModel):
    """Typed prelaunch refusal; no request/run identity is fabricated."""

    safety_outcome: Literal["unsupported_safe_execution"] = "unsupported_safe_execution"
    reason_code: ReasonCode
