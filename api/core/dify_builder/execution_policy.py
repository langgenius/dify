"""Pure, conservative Builder effect admission; shared DTOs live in services."""

import json
import math
import re
from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from services.dify_builder.execution_contracts import (
    MAX_OBSERVATIONS as MAX_OBSERVATIONS,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    AdmittedNodeBinding,
    BuilderExecutionContext,
    BuilderExecutionPolicyError,
    _TrustedModel,
    canonical_digest,
    context_digest,
    fixture_digest,
)
from services.dify_builder.execution_contracts import (
    BoundedID as BoundedID,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    BuilderExecutionContextValue as BuilderExecutionContextValue,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    BuilderExecutionObservation as BuilderExecutionObservation,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    BuilderExecutionRecorder as BuilderExecutionRecorder,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    BuilderExecutionRefusal as BuilderExecutionRefusal,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    ConfirmedToolExecutionContext as ConfirmedToolExecutionContext,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    Digest as Digest,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    ExecutionEvidenceSummary as ExecutionEvidenceSummary,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    HttpFixtureSetV1 as HttpFixtureSetV1,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    HttpResponseFixtureV1 as HttpResponseFixtureV1,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    JsonToolExecutionContext as JsonToolExecutionContext,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    QualifiedJsonToolBinding as QualifiedJsonToolBinding,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    ReasonCode as ReasonCode,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    ScalarValue as ScalarValue,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    TrustedExecutionCompletion as TrustedExecutionCompletion,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    canonical_json as canonical_json,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    decode_http_fixture_set as decode_http_fixture_set,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    decode_http_fixture_submission as decode_http_fixture_submission,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    scalar_inputs_digest as scalar_inputs_digest,  # noqa: PLC0414 - preserve historical core import path
)
from services.dify_builder.execution_contracts import (
    validate_execution_context as validate_execution_context,  # noqa: PLC0414 - preserve historical core import path
)


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
    from services.dify_builder.execution_features import is_citation_display_metadata

    if snapshot.app_mode != "workflow" or snapshot.workflow_kind != "standard":
        raise BuilderExecutionPolicyError("unsupported_workflow")
    if snapshot.has_environment_variables or snapshot.has_conversation_variables:
        raise BuilderExecutionPolicyError("unsupported_variables")
    if snapshot.has_external_tracing:
        raise BuilderExecutionPolicyError("unsupported_external_tracing")
    for key, value in snapshot.features.items():
        if key == "retriever_resource" and is_citation_display_metadata(value):
            continue
        if key in {"opening_statement", "suggested_questions", "external_data_tools", "external_data_variables"}:
            if value not in ("", [], None):
                raise BuilderExecutionPolicyError("unsupported_features")
        elif key in _DISABLED_FEATURES:
            _admit_disabled_feature(key, value)
        else:
            raise BuilderExecutionPolicyError("unsupported_features")
    canonical_digest(snapshot.features)


def validate_restricted_http_defaults(data: Mapping[str, Any]) -> None:
    """Only the reviewed native scalar HTTP default-output fields are admitted."""
    if data.get("default_values") not in (None, []):
        raise BuilderExecutionPolicyError("unsupported_http_defaults")
    defaults = data.get("default_value")
    if defaults is None:
        return
    if not isinstance(defaults, list) or len(defaults) > 2:
        raise BuilderExecutionPolicyError("unsupported_http_defaults")
    seen: set[str] = set()
    for item in defaults:
        if not isinstance(item, dict) or set(item) != {"type", "key", "value"}:
            raise BuilderExecutionPolicyError("unsupported_http_defaults")
        key, kind, value = item["key"], item["type"], item["value"]
        if not isinstance(key, str) or key in seen:
            raise BuilderExecutionPolicyError("unsupported_http_defaults")
        seen.add(key)
        if key == "body" and kind == "string" and type(value) is str:
            try:
                if len(value.encode("utf-8")) <= 65536:
                    continue
            except UnicodeError:
                pass
        if key == "status_code" and kind == "number" and type(value) in (int, float):
            try:
                if math.isfinite(value):
                    continue
            except OverflowError:
                # Refuse integers outside the native finite float range before
                # concrete validation or any later native number conversion.
                pass
        raise BuilderExecutionPolicyError("unsupported_http_defaults")


def admitted_node_bindings(snapshot: RestrictedAdmissionSnapshot) -> tuple[AdmittedNodeBinding, ...]:
    """Resolve audited class identities before class-owned data validation."""
    from core.workflow.node_factory import resolve_workflow_node_class
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.http_request.node import HttpRequestNode
    from graphon.nodes.start.start_node import StartNode
    from graphon.nodes.template_transform.template_transform_node import TemplateTransformNode
    from services.dify_builder.revision import node_config_digest
    from services.dify_builder.template_execution import validate_template_configuration, validate_template_source

    admit_raw_execution_metadata(snapshot)
    graph = snapshot.graph
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not 2 <= len(nodes) <= 128 or not isinstance(edges, list):
        raise BuilderExecutionPolicyError("unsupported_graph")
    # Source limits precede the existing graph digest's UTF-8 allocation.
    for node in nodes:
        if isinstance(node, dict) and isinstance(node.get("data"), dict):
            if node["data"].get("type") == "template-transform":
                validate_template_source(node["data"].get("template"))
    canonical_digest(graph)
    audited = {
        "start": StartNode,
        "end": EndNode,
        "http-request": HttpRequestNode,
        "template-transform": TemplateTransformNode,
    }
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
        if node_type == "http-request":
            validate_restricted_http_defaults(data)
        elif node_type == "template-transform":
            validate_template_configuration(data)
        try:
            cls.validate_node_data(data)
        except (ValidationError, ValueError, TypeError):
            raise BuilderExecutionPolicyError("invalid_node_configuration") from None
        bindings.append(
            AdmittedNodeBinding(
                node_id=node_id,
                implementation=f"{cls.__module__}.{cls.__qualname__}",
                node_version="1",
                normalized_config_digest=node_config_digest(data),
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

    def selector_allowed(node_id: str, selector: Any, *, template_input: bool = False) -> bool:
        if (
            not isinstance(selector, (list, tuple))
            or len(selector) != 2
            or not isinstance(selector[0], str)
            or not isinstance(selector[1], str)
            or selector[0] not in upstream[node_id]
        ):
            return False
        outputs = {
            "start": start_outputs,
            "http-request": {"body"} if template_input else {"body", "status_code", "headers"},
            "template-transform": {"output"},
        }
        return selector[1] in outputs[types[selector[0]]]

    for node_id, data in raw_data.items():
        if types[node_id] == "template-transform":
            if any(
                not selector_allowed(node_id, variable["value_selector"], template_input=True)
                for variable in data["variables"]
            ):
                raise BuilderExecutionPolicyError("unsupported_template_selector")
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
                    "content-type:application/json; charset=utf-8",
                    "content-type: application/json; charset=utf-8",
                    "content-type:text/plain; charset=utf-8",
                    "content-type: text/plain; charset=utf-8",
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
            validate_restricted_http_defaults(data)
        if types[node_id] == "end":
            if any(not selector_allowed(node_id, output.get("value_selector")) for output in data.get("outputs", [])):
                raise BuilderExecutionPolicyError("unsupported_selector")
        serialized = json.dumps(data, ensure_ascii=False)
        for node, output in re.findall(r"\{\{#([^.#]+)\.([^#]+)#\}\}", serialized):
            if not selector_allowed(node_id, [node, output]):
                raise BuilderExecutionPolicyError("unsupported_selector")
    return tuple(bindings)


def admit_restricted_workflow(context: BuilderExecutionContext, snapshot: RestrictedAdmissionSnapshot) -> None:
    if not isinstance(context, BuilderExecutionContext):
        raise BuilderExecutionPolicyError("unsupported_execution_policy")
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
