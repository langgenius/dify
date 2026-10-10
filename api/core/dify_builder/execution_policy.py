"""Immutable Builder execution bindings and pure, conservative effect admission.

Admission describes supported computation. Runtime capability boundaries and
native authoritative completion are separately owned by the workflow layer.
"""

import hashlib
import json
import math
import re
from collections.abc import Mapping
from typing import Annotated, Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

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


def canonical_digest(value: Any) -> str:
    """Canonical finite UTF-8 JSON; arrays retain execution-significant order."""
    try:
        _finite_json(value)
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise BuilderExecutionPolicyError("invalid_canonical_json") from None


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


def context_digest(context: BuilderExecutionContext) -> str:
    return canonical_digest(context.model_dump(mode="json", exclude={"context_digest"}))


def fixture_digest(execution_revision: str, fixtures: tuple[HttpResponseFixtureV1, ...]) -> str:
    return canonical_digest(
        HttpFixtureSetV1(execution_revision=execution_revision, fixtures=fixtures).model_dump(mode="json")
    )


class BuilderExecutionObservation(_TrustedModel):
    observation_id: BoundedID
    invocation_id: BoundedID
    request_id: BoundedID
    node_id: BoundedID
    kind: Literal["fixture_served", "effect_blocked", "sandbox_started", "sandbox_completed", "sandbox_failed"]
    implementation_version: Annotated[str, Field(strict=True, min_length=1, max_length=256)]
    reason_code: Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9_]{0,127}$")]
    fixture_digest: Digest | None = None
    profile_digest: Digest | None = None
    request_hmac: Digest | None = None


class BuilderExecutionRecorder(Protocol):
    @property
    def healthy(self) -> bool: ...

    def record(self, observation: BuilderExecutionObservation) -> None: ...


class ExecutionEvidenceSummary(_TrustedModel):
    request_id: BoundedID
    policy_version: Literal["builder-restricted-v1"] = "builder-restricted-v1"
    mode: Literal["restricted", "mock"]
    sealed: bool
    safety_outcome: Literal[
        "unsupported_safe_execution",
        "execution_blocked",
        "simulation_completed",
        "restricted_execution_completed",
        "execution_evidence_unknown",
        "native_failed",
    ]
    simulated_node_ids: tuple[BoundedID, ...] = ()
    blocked_node_ids: tuple[BoundedID, ...] = ()
    sandbox_profile: Literal["disabled", "network-disabled-v1"]
    fixture_digest: Digest
    native_run_id: BoundedID | None = None


class BuilderExecutionRefusal(_TrustedModel):
    """Typed prelaunch refusal; no request/run identity is fabricated."""

    safety_outcome: Literal["unsupported_safe_execution"] = "unsupported_safe_execution"
    reason_code: Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9_]{0,127}$")]


class RestrictedAdmissionSnapshot(_TrustedModel):
    """Untrusted raw graph/config snapshot, held only for inspection."""

    app_mode: str
    workflow_kind: str
    graph: dict[str, Any]
    input_schema: dict[str, Any]
    features: dict[str, Any]
    has_environment_variables: bool
    has_conversation_variables: bool
    has_external_tracing: bool


_DISABLED_FEATURES = frozenset(
    {
        "file_upload",
        "speech_to_text",
        "text_to_speech",
        "retriever_resource",
        "sensitive_word_avoidance",
        "suggested_questions_after_answer",
        "annotation_reply",
        "more_like_this",
    }
)


def _admit_disabled_feature(key: str, value: Any) -> None:
    """Accept reviewed native disabled shapes without feature-owner side effects."""
    if not isinstance(value, dict) or value.get("enabled", False) is not False:
        raise BuilderExecutionPolicyError("unsupported_features")
    string_fields: set[str] = set()
    list_fields: set[str] = set()
    allowed = {"enabled"}
    if key == "text_to_speech":
        string_fields = {"voice", "language"}
        allowed |= string_fields | {"autoPlay"}
        if "autoPlay" in value and value["autoPlay"] not in ("enabled", "disabled"):
            raise BuilderExecutionPolicyError("unsupported_features")
    elif key == "suggested_questions_after_answer":
        string_fields = {"prompt"}
        allowed |= string_fields
    elif key == "sensitive_word_avoidance":
        allowed |= {"type", "config", "configs"}
        if value.get("type", "") != "" or value.get("config", {}) != {} or value.get("configs", []) != []:
            raise BuilderExecutionPolicyError("unsupported_features")
    elif key == "file_upload":
        list_fields = {"allowed_file_types", "allowed_file_extensions", "allowed_file_upload_methods"}
        allowed |= list_fields | {"image", "number_limits"}
        if "number_limits" in value and (type(value["number_limits"]) is not int or value["number_limits"] < 0):
            raise BuilderExecutionPolicyError("unsupported_features")
        if "image" in value:
            image = value["image"]
            if (
                not isinstance(image, dict)
                or image.get("enabled", False) is not False
                or set(image) - {"enabled", "number_limits", "detail", "transfer_methods"}
                or ("detail" in image and image["detail"] not in ("high", "low"))
                or (
                    "number_limits" in image and (type(image["number_limits"]) is not int or image["number_limits"] < 0)
                )
                or (
                    "transfer_methods" in image
                    and (
                        not isinstance(image["transfer_methods"], list)
                        or any(method not in ("local_file", "remote_url") for method in image["transfer_methods"])
                    )
                )
            ):
                raise BuilderExecutionPolicyError("unsupported_features")
    if (
        set(value) - allowed
        or any(name in value and not isinstance(value[name], str) for name in string_fields)
        or any(
            name in value and (not isinstance(value[name], list) or any(not isinstance(v, str) for v in value[name]))
            for name in list_fields
        )
    ):
        raise BuilderExecutionPolicyError("unsupported_features")


def admit_raw_execution_metadata(snapshot: RestrictedAdmissionSnapshot) -> None:
    if snapshot.app_mode != "workflow" or snapshot.workflow_kind != "standard":
        raise BuilderExecutionPolicyError("unsupported_workflow")
    if snapshot.has_environment_variables or snapshot.has_conversation_variables:
        raise BuilderExecutionPolicyError("unsupported_variables")
    if snapshot.has_external_tracing:
        raise BuilderExecutionPolicyError("unsupported_external_tracing")
    for key, value in snapshot.features.items():
        if key in {"opening_statement", "suggested_questions", "external_data_tools", "external_data_variables"}:
            if value not in ("", [], None):
                raise BuilderExecutionPolicyError("unsupported_features")
        elif key in _DISABLED_FEATURES:
            _admit_disabled_feature(key, value)
        else:
            raise BuilderExecutionPolicyError("unsupported_features")
    canonical_digest(snapshot.features)


def admitted_node_bindings(snapshot: RestrictedAdmissionSnapshot) -> tuple[AdmittedNodeBinding, ...]:
    """Resolve audited class identities before class-owned data validation."""
    from core.workflow.node_factory import resolve_workflow_node_class
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.http_request.node import HttpRequestNode
    from graphon.nodes.start.start_node import StartNode

    admit_raw_execution_metadata(snapshot)
    graph = snapshot.graph
    canonical_digest(graph)
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not 2 <= len(nodes) <= 128 or not isinstance(edges, list):
        raise BuilderExecutionPolicyError("unsupported_graph")
    audited = {"start": StartNode, "end": EndNode, "http-request": HttpRequestNode}
    bindings = []
    types: dict[str, str] = {}
    raw_data: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
            raise BuilderExecutionPolicyError("unsupported_graph")
        data, node_id = node["data"], node.get("id")
        if not isinstance(node_id, str) or not node_id or len(node_id) > 128 or node_id in types:
            raise BuilderExecutionPolicyError("unsupported_graph")
        if any(
            node.get(k) or data.get(k)
            for k in ("parentId", "parent_id", "iteration_id", "loop_id", "isInIteration", "isInLoop")
        ):
            raise BuilderExecutionPolicyError("unsupported_graph")
        node_type, version = data.get("type"), data.get("version", "1")
        if not isinstance(node_type, str) or node_type not in audited or version != "1":
            raise BuilderExecutionPolicyError("unsupported_node_implementation")
        cls = resolve_workflow_node_class(node_type=node_type, node_version=version, node_data=data)
        if cls is not audited[node_type] or cls.version() != "1":
            raise BuilderExecutionPolicyError("unsupported_node_implementation")
        try:
            cls.validate_node_data(data)
        except (ValidationError, ValueError, TypeError):
            raise BuilderExecutionPolicyError("invalid_node_configuration") from None
        bindings.append(
            AdmittedNodeBinding(
                node_id=node_id,
                implementation=f"{cls.__module__}.{cls.__qualname__}",
                node_version="1",
                normalized_config_digest=canonical_digest({**data, "version": "1"}),
            )
        )
        types[node_id], raw_data[node_id] = node_type, data
    starts, ends = [n for n, t in types.items() if t == "start"], [n for n, t in types.items() if t == "end"]
    if len(starts) != 1 or len(ends) != 1 or len(edges) != len(nodes) - 1:
        raise BuilderExecutionPolicyError("unsupported_graph")
    outgoing: dict[str, str] = {}
    incoming: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict):
            raise BuilderExecutionPolicyError("unsupported_graph")
        source, target = edge.get("source"), edge.get("target")
        if (
            not isinstance(source, str)
            or not isinstance(target, str)
            or source not in types
            or target not in types
            or source in outgoing
            or target in incoming
            or source == ends[0]
            or target == starts[0]
        ):
            raise BuilderExecutionPolicyError("unsupported_graph")
        if edge.get("sourceHandle", "source") != "source" or edge.get("targetHandle", "target") != "target":
            raise BuilderExecutionPolicyError("unsupported_graph")
        outgoing[source] = target
        incoming.add(target)
    seen: set[str] = set()
    current = starts[0]
    upstream: dict[str, set[str]] = {}
    while current not in seen:
        upstream[current] = set(seen)
        seen.add(current)
        if current not in outgoing:
            break
        current = outgoing[current]
    if len(seen) != len(nodes) or current != ends[0]:
        raise BuilderExecutionPolicyError("unsupported_graph")
    variables = raw_data[starts[0]].get("variables", [])
    if not isinstance(variables, list) or any(
        not isinstance(v, dict) or v.get("type") not in {"text-input", "paragraph", "number", "checkbox", "select"}
        for v in variables
    ):
        raise BuilderExecutionPolicyError("unsupported_start_input")
    start_outputs = {v.get("variable") for v in variables}

    def selector_allowed(node_id: str, selector: Any) -> bool:
        if (
            not isinstance(selector, (list, tuple))
            or len(selector) != 2
            or not isinstance(selector[0], str)
            or selector[0] not in upstream[node_id]
        ):
            return False
        return selector[1] in (start_outputs if types[selector[0]] == "start" else {"body", "status_code", "headers"})

    for node_id, data in raw_data.items():
        if types[node_id] == "http-request":
            auth = data.get("authorization")
            if (
                not isinstance(auth, dict)
                or auth.get("type") != "no-auth"
                or set(auth) - {"type", "config"}
                or auth.get("config") not in (None, {})
            ):
                raise BuilderExecutionPolicyError("unsupported_http_authorization")
            if data.get("method", "").upper() not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}:
                raise BuilderExecutionPolicyError("unsupported_http_method")
            headers = data.get("headers", "")
            if headers and (
                not isinstance(headers, str)
                or headers.lower().strip()
                not in {
                    "content-type:application/json",
                    "content-type: application/json",
                    "content-type:text/plain",
                    "content-type: text/plain",
                }
            ):
                raise BuilderExecutionPolicyError("unsupported_http_headers")
            body = data.get("body")
            if body is not None:
                if not isinstance(body, dict) or body.get("type") not in {"none", "raw-text", "json"}:
                    raise BuilderExecutionPolicyError("unsupported_http_body")
                items = body.get("data", [])
                if isinstance(items, str):
                    items = [{"type": "text", "value": items}]
                if not isinstance(items, list) or any(
                    not isinstance(item, dict) or item.get("type") != "text" or item.get("file") for item in items
                ):
                    raise BuilderExecutionPolicyError("unsupported_http_body")
            for key in ("default_value", "default_values"):
                if data.get(key):
                    raise BuilderExecutionPolicyError("unsupported_http_defaults")
        if types[node_id] == "end":
            if any(not selector_allowed(node_id, output.get("value_selector")) for output in data.get("outputs", [])):
                raise BuilderExecutionPolicyError("unsupported_selector")
        serialized = json.dumps(data, ensure_ascii=False)
        for node, output in re.findall(r"\{\{#([^.#]+)\.([^#]+)#\}\}", serialized):
            if not selector_allowed(node_id, [node, output]):
                raise BuilderExecutionPolicyError("unsupported_selector")
    return tuple(bindings)


def admit_restricted_workflow(context: BuilderExecutionContext, snapshot: RestrictedAdmissionSnapshot) -> None:
    if context.context_digest != context_digest(context):
        raise BuilderExecutionPolicyError("context_digest_mismatch")
    if context.admitted_nodes != admitted_node_bindings(snapshot):
        raise BuilderExecutionPolicyError("node_binding_mismatch")
    nodes = {binding.node_id: binding for binding in context.admitted_nodes}
    if len({f.node_id for f in context.http_fixtures}) != len(context.http_fixtures):
        raise BuilderExecutionPolicyError("invalid_http_fixtures")
    for fixture in context.http_fixtures:
        binding = nodes.get(fixture.node_id)
        if binding is None or (binding.implementation, binding.node_version) != (
            fixture.implementation,
            fixture.node_version,
        ):
            raise BuilderExecutionPolicyError("unused_http_fixture")
    if context.fixture_digest != fixture_digest(context.execution_revision, context.http_fixtures):
        raise BuilderExecutionPolicyError("fixture_digest_mismatch")
    if context.mode != ("mock" if context.http_fixtures else "restricted"):
        raise BuilderExecutionPolicyError("execution_mode_mismatch")
    if context.sandbox_profile != "disabled":
        raise BuilderExecutionPolicyError("sandbox_capability_unverified")
