"""Shared immutable Builder execution contracts and compatible context decoding."""

import hashlib
import json
import math
from collections.abc import Mapping
from typing import Annotated, Any, Literal, Protocol

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

ScalarValue = str | int | float | bool | None
BoundedID = Annotated[str, Field(strict=True, min_length=1, max_length=128)]
Digest = Annotated[str, Field(strict=True, pattern=r"^[0-9a-f]{64}$")]
MAX_OBSERVATIONS = 4096


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
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise BuilderExecutionPolicyError("invalid_canonical_json") from None


def canonical_digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def scalar_inputs_digest(inputs: Mapping[str, Any]) -> str:
    if not isinstance(inputs, dict) or any(type(v) not in (str, int, float, bool, type(None)) for v in inputs.values()):
        raise BuilderExecutionPolicyError("unsupported_input_value")
    return canonical_digest(inputs)


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
    source: Literal["user_sample", "generated_sample"]
    status_code: Annotated[int, Field(strict=True, ge=100, le=599)]
    content_type: Literal["application/json", "text/plain"]
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
            except (ValueError, TypeError, UnicodeError, RecursionError):
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
    except (ValidationError, ValueError, TypeError, UnicodeError):
        raise BuilderExecutionPolicyError("invalid_http_fixtures") from None


def decode_http_fixture_set(raw: Any) -> HttpFixtureSetV1 | None:
    """SQL NULL is historical absence; a stored malformed envelope refuses use."""
    if raw is None:
        return None
    try:
        return HttpFixtureSetV1.model_validate(raw)
    except (ValidationError, ValueError, TypeError, UnicodeError):
        raise BuilderExecutionPolicyError("invalid_http_fixture_envelope") from None


class AdmittedNodeBinding(_TrustedModel):
    node_id: BoundedID
    implementation: Annotated[str, Field(strict=True, min_length=1, max_length=256)]
    node_version: Literal["1"]
    normalized_config_digest: Digest


class BuilderExecutionContext(_TrustedModel):
    policy_version: Literal["builder-restricted-v1"] = "builder-restricted-v1"
    request_id: BoundedID
    tenant_id: BoundedID
    app_id: BoundedID
    workflow_id: BoundedID
    actor_id: BoundedID
    session_id: BoundedID
    test_input_id: BoundedID
    execution_revision: Digest
    graph_revision: Digest
    submitted_inputs_digest: Digest
    effective_inputs_digest: Digest
    fixture_digest: Digest
    context_digest: Digest
    mode: Literal["restricted", "mock"]
    sandbox_profile: Literal["disabled", "network-disabled-v1"]
    admitted_nodes: Annotated[tuple[AdmittedNodeBinding, ...], Field(max_length=128)]
    http_fixtures: Annotated[tuple[HttpResponseFixtureV1, ...], Field(max_length=128)]


class ConfirmedToolExecutionContext(_TrustedModel):
    """One consented native Tool run. Holds consent references, never credentials.

    The service reconstructs this from its durable reservation; it is not an
    authorization object a client may submit.
    """

    policy_version: Literal["builder-confirmed-gmail-read-v1"]
    request_id: BoundedID
    tenant_id: BoundedID
    app_id: BoundedID
    workflow_id: BoundedID
    actor_id: BoundedID
    session_id: BoundedID
    test_input_id: BoundedID
    execution_revision: Digest
    graph_revision: Digest
    submitted_inputs_digest: Digest
    effective_inputs_digest: Digest
    context_digest: Digest
    mode: Literal["confirmed_tool"]
    sandbox_profile: Literal["disabled"]
    admitted_nodes: Annotated[tuple[AdmittedNodeBinding, ...], Field(max_length=128)]
    consent_id: BoundedID
    scope_digest: Digest
    command_id: BoundedID


class QualifiedJsonToolBinding(_TrustedModel):
    """Installed, runtime-qualified parse action and its expected scalar call."""

    node_id: BoundedID
    tenant_id: BoundedID
    installation_id: BoundedID
    plugin_id: BoundedID
    provider_id: BoundedID
    tool_name: Literal["parse"]
    unique_identifier: Annotated[str, Field(strict=True, min_length=1, max_length=256)]
    version: BoundedID
    checksum: Digest
    provider_schema_digest: Digest
    tool_schema_digest: Digest
    runtime_type: Literal["local", "serverless"]
    qualification_digest: Digest
    final_parameters_digest: Digest


class JsonToolExecutionContext(_TrustedModel):
    """One restricted native JSON Parse run; no fixture or consent authority."""

    policy_version: Literal["builder-json-parse-v1"]
    request_id: BoundedID
    tenant_id: BoundedID
    app_id: BoundedID
    workflow_id: BoundedID
    actor_id: BoundedID
    session_id: BoundedID
    test_input_id: BoundedID
    execution_revision: Digest
    graph_revision: Digest
    submitted_inputs_digest: Digest
    effective_inputs_digest: Digest
    context_digest: Digest
    mode: Literal["restricted"]
    sandbox_profile: Literal["disabled"]
    admitted_nodes: Annotated[tuple[AdmittedNodeBinding, AdmittedNodeBinding, AdmittedNodeBinding], Field()]
    qualified_tool: QualifiedJsonToolBinding

    @model_validator(mode="after")
    def validate_binding(self) -> "JsonToolExecutionContext":
        if (
            self.qualified_tool.tenant_id != self.tenant_id
            or self.qualified_tool.node_id != self.admitted_nodes[1].node_id
        ):
            raise ValueError("JSON binding owner mismatch")
        return self


BuilderExecutionContextValue = Annotated[
    BuilderExecutionContext | ConfirmedToolExecutionContext | JsonToolExecutionContext,
    Field(discriminator="policy_version"),
]
_CONTEXT_VALUE_ADAPTER: TypeAdapter[
    BuilderExecutionContext | ConfirmedToolExecutionContext | JsonToolExecutionContext
] = TypeAdapter(BuilderExecutionContextValue)


def context_digest(context: BuilderExecutionContext | ConfirmedToolExecutionContext | JsonToolExecutionContext) -> str:
    """The dumped policy tag domain-separates all execution digests."""
    return canonical_digest(context.model_dump(mode="json", exclude={"context_digest"}))


def validate_execution_context(
    raw: Any,
) -> BuilderExecutionContext | ConfirmedToolExecutionContext | JsonToolExecutionContext:
    """Decode a tagged context at a JSON/process boundary and verify its digest.

    Only an absent tag is filled with the restricted default; it never infers the
    other variants, whose exclusive fields then fail restricted validation.
    """
    if isinstance(raw, dict) and "policy_version" not in raw:
        raw = {**raw, "policy_version": "builder-restricted-v1"}
    try:
        context = _CONTEXT_VALUE_ADAPTER.validate_python(raw)
    except (ValidationError, ValueError, TypeError, UnicodeError):
        raise BuilderExecutionPolicyError("invalid_execution_context") from None
    if context.context_digest != context_digest(context):
        raise BuilderExecutionPolicyError("context_digest_mismatch")
    return context


def fixture_digest(execution_revision: str, fixtures: tuple[HttpResponseFixtureV1, ...]) -> str:
    return canonical_digest(
        HttpFixtureSetV1(execution_revision=execution_revision, fixtures=fixtures).model_dump(mode="json")
    )


class BuilderExecutionObservation(_TrustedModel):
    observation_id: BoundedID
    invocation_id: BoundedID
    request_id: BoundedID
    node_id: BoundedID
    kind: Literal[
        "fixture_served",
        "effect_blocked",
        "sandbox_started",
        "sandbox_completed",
        "sandbox_failed",
        "qualified_json_completed",
    ]
    implementation_version: Annotated[str, Field(strict=True, min_length=1, max_length=256)]
    reason_code: Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9_]{0,127}$")]
    fixture_digest: Digest | None = None
    profile_digest: Digest | None = None
    request_hmac: Digest | None = None
    native_node_execution_id: BoundedID | None = None
    qualification_digest: Digest | None = None
    installed_binding_digest: Digest | None = None
    final_parameters_digest: Digest | None = None
    pre_binding_digest: Digest | None = None
    post_binding_digest: Digest | None = None
    native_text_output_digest: Digest | None = None
    text_bytes: Annotated[int, Field(strict=True, ge=0, le=65536)] | None = None
    text_messages: Annotated[int, Field(strict=True, ge=0, le=8)] | None = None

    @model_validator(mode="after")
    def validate_json_receipt(self) -> "BuilderExecutionObservation":
        json_values = (
            self.native_node_execution_id,
            self.qualification_digest,
            self.installed_binding_digest,
            self.final_parameters_digest,
            self.pre_binding_digest,
            self.post_binding_digest,
            self.native_text_output_digest,
            self.text_bytes,
            self.text_messages,
        )
        if self.kind == "qualified_json_completed":
            if any(value is None for value in json_values) or any(
                value is not None for value in (self.fixture_digest, self.profile_digest, self.request_hmac)
            ):
                raise ValueError("invalid JSON completion receipt")
        elif any(value is not None for value in json_values):
            raise ValueError("non-JSON receipt contains JSON metadata")
        return self


class BuilderExecutionRecorder(Protocol):
    @property
    def healthy(self) -> bool: ...

    def record(self, observation: BuilderExecutionObservation) -> None: ...


ReasonCode = Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9_]{0,127}$")]


class ExecutionEvidenceSummary(_TrustedModel):
    """Sealed Builder evidence for one launch; IDs, statuses and reason codes only.

    Confirmed summaries carry the consent reference and the sanitized action
    outcome (state/reason code) as metadata; the consent owner stays the only
    outcome authority and native Run storage the only content owner.
    """

    request_id: BoundedID
    policy_version: Literal["builder-restricted-v1", "builder-confirmed-gmail-read-v1", "builder-json-parse-v1"] = (
        "builder-restricted-v1"
    )
    mode: Literal["restricted", "mock", "confirmed_tool"]
    sealed: bool
    safety_outcome: Literal[
        "unsupported_safe_execution",
        "execution_blocked",
        "simulation_completed",
        "restricted_execution_completed",
        "confirmed_tool_completed",
        "execution_evidence_unknown",
        "native_failed",
    ]
    simulated_node_ids: tuple[BoundedID, ...] = ()
    blocked_node_ids: tuple[BoundedID, ...] = ()
    sandbox_profile: Literal["disabled", "network-disabled-v1"]
    # ``None`` only for a confirmed run, which serves no fixtures.
    fixture_digest: Digest | None = None
    native_run_id: BoundedID | None = None
    # Confirmed only: the grant this launch spent and its sanitized outcome, if recorded.
    consent_id: BoundedID | None = None
    action_state: Literal["completed", "failed", "unknown"] | None = None
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


class TrustedExecutionCompletion(_TrustedModel):
    """Transient finish facts captured by the native worker/port owner, never posted."""

    context: BuilderExecutionContextValue
    native_run_id: BoundedID | None
    task_id: BoundedID | None
    worker_finished: StrictBool
    worker_exit: Literal["returned", "policy_refused", "stopped", "failed", "not_observed"]
    recorder_healthy: StrictBool
    response_completed: StrictBool
    refusal: BuilderExecutionRefusal | None = None
    preworker_refusal: StrictBool = False

    @model_validator(mode="after")
    def validate_completion(self) -> "TrustedExecutionCompletion":
        if (self.native_run_id is None) != (self.task_id is None):
            raise ValueError("incomplete claim identity")
        if self.worker_exit == "not_observed" and self.worker_finished:
            raise ValueError("unobserved worker cannot be finished")
        if self.preworker_refusal and (
            self.refusal is None
            or self.native_run_id is not None
            or self.recorder_healthy
            or self.worker_finished
            or self.worker_exit != "not_observed"
        ):
            raise ValueError("invalid preworker refusal origin")
        return self
