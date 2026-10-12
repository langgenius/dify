"""Gmail ``get_message`` action adapter: admission, envelope, disclosure and outcome.

This is the only real-call profile. It stays unavailable until an audited
artifact, schema and source revision are recorded below; a rollout flag never
substitutes for that. Comparison is exact.

Outcome grammar (reviewed official 0.2.7 source): success emits progress TEXT,
a ``message_id`` variable, then JSON ``{"message": {"id": ...}, "message_id": id}``.
Action and parser failures emit TEXT only, so they classify as unknown; text is
never inspected. ``declared_failure`` is reserved for an audited adapter's
machine-readable failure grammar and is never derived from client input.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import Field, ValidationError, model_validator

from core.dify_builder.execution_policy import (
    AdmittedNodeBinding,
    BoundedID,
    BuilderExecutionPolicyError,
    RestrictedAdmissionSnapshot,
    _TrustedModel,
    admit_raw_execution_metadata,
    canonical_digest,
    canonical_json,
)
from core.dify_builder.real_call_consent import (
    GMAIL_MESSAGE_PATH,
    GMAIL_OAUTH_TOKEN_URL,
    MESSAGE_ID_PATTERN,
    ActionOutcome,
    BoundedText,
    ConsentDisclosure,
    CredentialReference,
    GmailReadParameters,
    InstalledToolBinding,
    gmail_message_url,
)

# Explicitly unavailable until a reviewed local artifact passes its audit.
QUALIFIED_GMAIL_ARTIFACT: str | None = None
QUALIFIED_GMAIL_SCHEMA_DIGEST: str | None = None
GMAIL_SOURCE_AUDIT_REVISION: str | None = None
DAEMON_CONTRACT_REVISION = "confirmed-tenant-dispatch-v1"

GMAIL_PLUGIN_ID = "langgenius/dify-gmail"
GMAIL_PROVIDER_ID = "langgenius/dify-gmail/dify-gmail"
GET_MESSAGE_TOOL = "get_message"
# Canonical native ``CredentialType.OAUTH2`` value; this domain module does not import plugin entities.
_OAUTH2_CREDENTIAL_TYPE = "oauth2"
_PARAMETER_NAMES = frozenset({"message_id", "include_body", "include_attachments"})
_START_INPUT_TYPES = frozenset({"text-input", "paragraph", "number", "checkbox", "select"})
_TOOL_OUTPUTS = frozenset({"text", "json"})
_COMMON_KEYS = frozenset({"type", "title", "desc", "version", "selected"})
_ALLOWED_KEYS = {
    "start": _COMMON_KEYS | {"variables"},
    "end": _COMMON_KEYS | {"outputs"},
    "tool": _COMMON_KEYS
    | {
        "provider_id",
        "provider_type",
        "provider_name",
        "tool_name",
        "tool_label",
        "tool_configurations",
        "credential_id",
        "plugin_unique_identifier",
        "tool_parameters",
        "tool_node_version",
        "retry_config",
        "error_strategy",
        "default_value",
    },
}


class GmailReadAdmission(_TrustedModel):
    """Admitted Start → Tool → End bindings and the Tool's literal parameters."""

    nodes: tuple[AdmittedNodeBinding, AdmittedNodeBinding, AdmittedNodeBinding]
    tool_node_id: BoundedID
    provider_id: BoundedText
    credential_id: BoundedID
    plugin_unique_identifier: BoundedText | None
    parameters: GmailReadParameters


# Fixed 28-character prefix plus the full 256-character canonical message ID.
_MAX_ENVELOPE_PATH = len(GMAIL_MESSAGE_PATH.format(message_id="")) + 256


class GmailGetMessageEnvelope(_TrustedModel):
    """Internal full non-secret request envelope; never a public outcome."""

    method: Literal["GET"] = "GET"
    host: Literal["gmail.googleapis.com"] = "gmail.googleapis.com"
    api_version: Literal["v1"] = "v1"
    path: Annotated[str, Field(strict=True, min_length=1, max_length=_MAX_ENVELOPE_PATH)]
    format: Literal["full"] = "full"
    installed: InstalledToolBinding
    credential: CredentialReference
    parameters: GmailReadParameters

    @model_validator(mode="after")
    def fixed_path(self) -> "GmailGetMessageEnvelope":
        if self.path != GMAIL_MESSAGE_PATH.format(message_id=self.parameters.message_id):
            raise ValueError("envelope path does not match message")
        return self


def normalize_get_message_parameters(parameters: Mapping[str, object]) -> GmailReadParameters:
    """Exactly three explicit parameters; no coercion, trimming or decoding."""
    if not isinstance(parameters, Mapping) or set(parameters) != _PARAMETER_NAMES:
        raise BuilderExecutionPolicyError("unsupported_tool_parameters")
    message_id = parameters["message_id"]
    if not isinstance(message_id, str) or MESSAGE_ID_PATTERN.fullmatch(message_id) is None:
        raise BuilderExecutionPolicyError("unsafe_message_id")
    if type(parameters["include_body"]) is not bool or type(parameters["include_attachments"]) is not bool:
        raise BuilderExecutionPolicyError("unsupported_tool_parameters")
    return GmailReadParameters.model_validate(dict(parameters))


def qualify_installed_action(installed: InstalledToolBinding) -> None:
    """Exact match against the reviewed artifact; anything unknown is unsupported."""
    if (
        QUALIFIED_GMAIL_ARTIFACT is None
        or QUALIFIED_GMAIL_SCHEMA_DIGEST is None
        or GMAIL_SOURCE_AUDIT_REVISION is None
        or not isinstance(installed, InstalledToolBinding)
        or installed.unique_identifier != QUALIFIED_GMAIL_ARTIFACT
        or installed.unique_identifier != f"{installed.plugin_id}:{installed.version}@{installed.checksum}"
        or installed.schema_digest != QUALIFIED_GMAIL_SCHEMA_DIGEST
        or installed.source_audit_revision != GMAIL_SOURCE_AUDIT_REVISION
        or installed.daemon_contract_revision != DAEMON_CONTRACT_REVISION
        or installed.plugin_id != GMAIL_PLUGIN_ID
        or installed.provider_id != GMAIL_PROVIDER_ID
        or installed.tool_name != GET_MESSAGE_TOOL
        or installed.runtime_type != "local"
    ):
        raise BuilderExecutionPolicyError("unsupported_action")


def require_oauth_credential(credential: CredentialReference) -> None:
    """The approved slice uses an explicit existing OAuth credential only (canonical ``oauth2``).

    API-key and unauthorized rows of the same provider stay valid for ordinary
    native workflows; they are never admitted here. The OAuth client snapshot
    the reference bound (including a missing client) is not judged here.
    """
    if credential.credential_type != _OAUTH2_CREDENTIAL_TYPE:
        raise BuilderExecutionPolicyError("credential_required")


def get_message_envelope(
    *, installed: InstalledToolBinding, credential: CredentialReference, parameters: GmailReadParameters
) -> GmailGetMessageEnvelope:
    qualify_installed_action(installed)
    if credential.provider_id != installed.provider_id:
        raise BuilderExecutionPolicyError("credential_provider_mismatch")
    require_oauth_credential(credential)
    return GmailGetMessageEnvelope(
        path=GMAIL_MESSAGE_PATH.format(message_id=parameters.message_id),
        installed=installed,
        credential=credential,
        parameters=parameters,
    )


def get_message_disclosure(
    *,
    credential: CredentialReference,
    parameters: GmailReadParameters,
    expires_at: datetime,
    prior_uncertain_consent_id: str | None = None,
) -> ConsentDisclosure:
    """Public disclosure: alias is display text, not a verified mailbox identity."""
    return ConsentDisclosure(
        action="get_message",
        credential_id=credential.credential_id,
        credential_alias=credential.alias,
        credential_type=credential.credential_type,
        identity_basis="workspace_credential",
        remote_account_status="unknown",
        message_id=parameters.message_id,
        request_method="GET",
        request_url=gmail_message_url(parameters.message_id),
        response_format="full",
        include_body=parameters.include_body,
        include_attachments=parameters.include_attachments,
        oauth_refresh="if_needed",
        oauth_refresh_method="POST",
        oauth_refresh_url=GMAIL_OAUTH_TOKEN_URL,
        native_attempt_limit=1,
        refresh_limit=1,
        automatic_replay=False,
        quota_usage="possible",
        monetary_estimate="unknown",
        output_retention="native_run_retention",
        data_description="gmail_message_headers_snippet_and_selected_body_or_attachment_metadata",
        expires_at=expires_at,
        prior_uncertain_consent_id=prior_uncertain_consent_id,
    )


def classify_get_message_result(
    *,
    expected_message_id: str,
    json_messages: Sequence[Mapping[str, object]],
    stream_completed: bool,
    declared_failure: bool,
) -> ActionOutcome:
    """Only one exact success object on a completed stream is completed."""
    if not isinstance(expected_message_id, str) or MESSAGE_ID_PATTERN.fullmatch(expected_message_id) is None:
        raise BuilderExecutionPolicyError("unsafe_message_id")
    if (
        type(stream_completed) is not bool
        or type(declared_failure) is not bool
        or not isinstance(json_messages, (list, tuple))
    ):
        raise BuilderExecutionPolicyError("invalid_outcome_input")
    # Transport loss overrides anything received, including success-looking JSON.
    if not stream_completed:
        return ActionOutcome(state="unknown", reason_code="stream_incomplete")
    if declared_failure:
        if json_messages:
            return ActionOutcome(state="unknown", reason_code="conflicting_result")
        return ActionOutcome(state="failed", reason_code="declared_failure")
    if not json_messages:
        return ActionOutcome(state="unknown", reason_code="result_missing")
    if len(json_messages) != 1:
        return ActionOutcome(state="unknown", reason_code="duplicate_result")
    payload = json_messages[0]
    try:
        canonical_json(payload)
    except BuilderExecutionPolicyError:
        return ActionOutcome(state="unknown", reason_code="invalid_result_json")
    if not isinstance(payload, dict) or set(payload) != {"message", "message_id"}:
        return ActionOutcome(state="unknown", reason_code="unrecognized_result")
    message = payload["message"]
    # The parser reports problems through an ``error`` key; never treat that as a read.
    if not isinstance(message, dict) or "error" in message:
        return ActionOutcome(state="unknown", reason_code="unrecognized_result")
    if payload["message_id"] != expected_message_id or message.get("id") != expected_message_id:
        return ActionOutcome(state="unknown", reason_code="message_mismatch")
    return ActionOutcome(state="completed", reason_code="message_returned")


def _validate_tool_raw(data: Mapping[str, Any]) -> tuple[str, str | None, GmailReadParameters]:
    if (
        data.get("provider_type") != "builtin"
        or data.get("provider_id") != GMAIL_PROVIDER_ID
        or data.get("tool_name") != GET_MESSAGE_TOOL
    ):
        raise BuilderExecutionPolicyError("unsupported_action")
    credential_id = data.get("credential_id")
    if not isinstance(credential_id, str) or not 1 <= len(credential_id) <= 128:
        raise BuilderExecutionPolicyError("credential_required")
    plugin_unique_identifier = data.get("plugin_unique_identifier")
    if plugin_unique_identifier is not None and (
        not isinstance(plugin_unique_identifier, str) or not 1 <= len(plugin_unique_identifier) <= 256
    ):
        raise BuilderExecutionPolicyError("unsupported_tool_configuration")
    # No secret/form configuration, legacy parameter parsing, retry or default output.
    if data.get("tool_configurations") != {} or data.get("tool_node_version") != "2":
        raise BuilderExecutionPolicyError("unsupported_tool_configuration")
    retry = data.get("retry_config", {})
    if (
        not isinstance(retry, dict)
        or set(retry) - {"retry_enabled", "max_retries", "retry_interval"}
        or retry.get("retry_enabled", False) is not False
        or retry.get("max_retries", 0) != 0
        or type(retry.get("max_retries", 0)) is not int
        or type(retry.get("retry_interval", 0)) is not int
    ):
        raise BuilderExecutionPolicyError("unsupported_node_retry")
    if data.get("error_strategy") is not None or data.get("default_value") not in (None, []):
        raise BuilderExecutionPolicyError("unsupported_default_output")
    raw_parameters = data.get("tool_parameters")
    if not isinstance(raw_parameters, dict) or set(raw_parameters) != _PARAMETER_NAMES:
        raise BuilderExecutionPolicyError("unsupported_tool_parameters")
    literals: dict[str, object] = {}
    for name, item in raw_parameters.items():
        # Only literal constants: no variable, template or mixed binding can inject values.
        if not isinstance(item, dict) or set(item) != {"type", "value"} or item["type"] != "constant":
            raise BuilderExecutionPolicyError("unsupported_tool_parameters")
        literals[name] = item["value"]
    if "{{#" in json.dumps(data, ensure_ascii=False):
        raise BuilderExecutionPolicyError("unsupported_selector")
    return credential_id, plugin_unique_identifier, normalize_get_message_parameters(literals)


def admit_get_message_workflow(snapshot: RestrictedAdmissionSnapshot) -> GmailReadAdmission:
    """Admit exactly Start → Tool(get_message) → End with literal parameters.

    Class identity and version resolve before class-owned data validation, and
    the raw workflow/feature restrictions are the restricted policy's own.
    """
    from core.workflow.node_factory import resolve_workflow_node_class
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.start.start_node import StartNode
    from graphon.nodes.tool.tool_node import ToolNode

    admit_raw_execution_metadata(snapshot)
    graph = snapshot.graph
    canonical_digest(graph)
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or len(nodes) != 3 or not isinstance(edges, list) or len(edges) != 2:
        raise BuilderExecutionPolicyError("unsupported_graph")
    audited = {"start": StartNode, "tool": ToolNode, "end": EndNode}
    found: dict[str, tuple[str, dict[str, Any], type]] = {}
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
            raise BuilderExecutionPolicyError("unsupported_graph")
        data, node_id = node["data"], node.get("id")
        if not isinstance(node_id, str) or not 1 <= len(node_id) <= 128 or node_id in {v[0] for v in found.values()}:
            raise BuilderExecutionPolicyError("unsupported_graph")
        if any(
            node.get(k) or data.get(k)
            for k in ("parentId", "parent_id", "iteration_id", "loop_id", "isInIteration", "isInLoop")
        ):
            raise BuilderExecutionPolicyError("unsupported_graph")
        node_type, version = data.get("type"), data.get("version", "1")
        if not isinstance(node_type, str) or node_type not in audited or node_type in found or version != "1":
            raise BuilderExecutionPolicyError("unsupported_node_implementation")
        cls = resolve_workflow_node_class(node_type=node_type, node_version=version, node_data=data)
        if cls is not audited[node_type] or cls.version() != "1":
            raise BuilderExecutionPolicyError("unsupported_node_implementation")
        if set(data) - _ALLOWED_KEYS[node_type]:
            raise BuilderExecutionPolicyError("unsupported_node_configuration")
        found[node_type] = (node_id, data, cls)
    start_id, tool_id, end_id = found["start"][0], found["tool"][0], found["end"][0]
    actual = set()
    for edge in edges:
        if (
            not isinstance(edge, dict)
            or not isinstance(edge.get("source"), str)
            or not isinstance(edge.get("target"), str)
        ):
            raise BuilderExecutionPolicyError("unsupported_graph")
        if edge.get("sourceHandle", "source") != "source" or edge.get("targetHandle", "target") != "target":
            raise BuilderExecutionPolicyError("unsupported_graph")
        actual.add((edge["source"], edge["target"]))
    if actual != {(start_id, tool_id), (tool_id, end_id)}:
        raise BuilderExecutionPolicyError("unsupported_graph")

    variables = found["start"][1].get("variables", [])
    # Names must be strings before they are hashed; other finite JSON is refused, not a TypeError.
    if not isinstance(variables, list) or any(
        not isinstance(v, dict) or v.get("type") not in _START_INPUT_TYPES or not isinstance(v.get("variable"), str)
        for v in variables
    ):
        raise BuilderExecutionPolicyError("unsupported_start_input")
    start_outputs = {v.get("variable") for v in variables}
    credential_id, plugin_unique_identifier, parameters = _validate_tool_raw(found["tool"][1])
    outputs = found["end"][1].get("outputs", [])
    if not isinstance(outputs, list):
        raise BuilderExecutionPolicyError("unsupported_selector")
    for output in outputs:
        selector = output.get("value_selector") if isinstance(output, dict) else None
        if not (
            isinstance(selector, list)
            and len(selector) == 2
            and isinstance(selector[0], str)
            and isinstance(selector[1], str)
            and (
                (selector[0] == start_id and selector[1] in start_outputs)
                or (selector[0] == tool_id and selector[1] in _TOOL_OUTPUTS)
            )
        ):
            raise BuilderExecutionPolicyError("unsupported_selector")
    if "{{#" in json.dumps(found["end"][1], ensure_ascii=False):
        raise BuilderExecutionPolicyError("unsupported_selector")

    bindings = []
    for node_type in ("start", "tool", "end"):
        node_id, data, cls = found[node_type]
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
    return GmailReadAdmission(
        nodes=(bindings[0], bindings[1], bindings[2]),
        tool_node_id=tool_id,
        provider_id=GMAIL_PROVIDER_ID,
        credential_id=credential_id,
        plugin_unique_identifier=plugin_unique_identifier,
        parameters=parameters,
    )
