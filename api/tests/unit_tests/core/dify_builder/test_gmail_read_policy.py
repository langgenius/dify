"""Pure Gmail get_message policy: parameters, admission, envelope and outcome.

The audited official 0.2.7 success grammar is progress TEXT, a ``message_id``
variable, then JSON ``{"message": {"id": ...}, "message_id": id}``; failures are
TEXT only. The classifier receives JSON payloads only, so text is never parsed.
Qualified fixtures below are HYPOTHETICAL local bindings that exercise domain
logic; they are not runtime qualification of any installed artifact.
"""

import copy
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from core.dify_builder import gmail_read_policy
from core.dify_builder.execution_policy import BuilderExecutionPolicyError, RestrictedAdmissionSnapshot
from core.dify_builder.gmail_read_policy import (
    GmailGetMessageEnvelope,
    admit_get_message_workflow,
    classify_get_message_result,
    get_message_disclosure,
    get_message_envelope,
    normalize_get_message_parameters,
    qualify_installed_action,
)
from core.dify_builder.real_call_consent import CredentialReference, GmailReadParameters, InstalledToolBinding

Graph = dict[str, list[dict[str, object]]]
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=UTC)
PROVIDER = "langgenius/dify-gmail/dify-gmail"
# HYPOTHETICAL reviewed local binding; never an actual qualified revision.
HYPOTHETICAL_ARTIFACT = "langgenius/dify-gmail:9.9.9@" + "f" * 64
HYPOTHETICAL_SCHEMA = "e" * 64
HYPOTHETICAL_AUDIT = "hypothetical-audit-revision"


def params(**overrides: object) -> dict[str, object]:
    return {"message_id": "18cab_1", "include_body": False, "include_attachments": False, **overrides}


def success(message_id: str = "18cab_1", **message: object) -> dict[str, object]:
    return {"message": {"id": message_id, "thread_id": "thread-1", **message}, "message_id": message_id}


# --- parameters -------------------------------------------------------------------


@pytest.mark.parametrize("message_id", ["../m", "a/b", "a%2Fb", "a?x", "a#x", " a", "a\n", "é", "", "a" * 257, 7])
def test_rejects_noncanonical_message_path(message_id: object) -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        normalize_get_message_parameters(params(message_id=message_id))


@pytest.mark.parametrize(
    "extra",
    [{"include_body": "false"}, {"include_body": 0}, {"include_attachments": None}, {"other": True}, {"format": "raw"}],
)
def test_rejects_coercion_and_unapproved_parameters(extra: dict[str, object]) -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        normalize_get_message_parameters(params(**extra))


@pytest.mark.parametrize("missing", ["include_body", "include_attachments", "message_id"])
def test_rejects_missing_explicit_flags(missing: str) -> None:
    values = params()
    del values[missing]
    with pytest.raises(BuilderExecutionPolicyError):
        normalize_get_message_parameters(values)


def test_normalizes_exact_bytes() -> None:
    assert normalize_get_message_parameters(params(message_id="Ab-_9", include_body=True)) == GmailReadParameters(
        message_id="Ab-_9", include_body=True, include_attachments=False
    )


# --- outcome ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("completed", "messages"),
    [
        (False, [success()]),
        (True, []),
        (True, [success("different")]),
    ],
)
def test_missing_partial_or_wrong_message_is_unknown(completed: bool, messages: list[dict[str, object]]) -> None:
    outcome = classify_get_message_result(
        expected_message_id="18cab_1", json_messages=messages, stream_completed=completed, declared_failure=False
    )
    assert outcome.state == "unknown"


def test_expected_message_success_is_completed_without_content() -> None:
    outcome = classify_get_message_result(
        expected_message_id="18cab_1",
        json_messages=[success(subject="secret subject", body="secret body")],
        stream_completed=True,
        declared_failure=False,
    )
    assert outcome.state == "completed"
    assert outcome.model_dump() == {"state": "completed", "reason_code": "message_returned"}


@pytest.mark.parametrize(
    "messages",
    [
        [success(), success()],
        [success(), {"message_id": "18cab_1"}],
        [{"message": {"id": "18cab_1"}, "message_id": "other"}],
        [{"message": {"id": "other"}, "message_id": "18cab_1"}],
        [{"message": {"thread_id": "t"}, "message_id": "18cab_1"}],
        [{"message": {"id": "18cab_1"}}],
        [{"message_id": "18cab_1"}],
        [{**success(), "status": "ok"}],
        [{"message": "18cab_1", "message_id": "18cab_1"}],
        [success(error="Error parsing message: bad header")],
        [success(size_estimate=float("nan"))],
        [success(size_estimate=float("inf"))],
        [success(subject="\ud800")],
        ["18cab_1"],
    ],
)
def test_duplicate_conflicting_unrecognized_or_nonfinite_json_is_unknown(messages: list[dict[str, object]]) -> None:
    outcome = classify_get_message_result(
        expected_message_id="18cab_1", json_messages=messages, stream_completed=True, declared_failure=False
    )
    assert outcome.state == "unknown"


def test_audited_text_only_parse_error_is_unknown_not_failed() -> None:
    # "Error parsing message: ..." is TEXT only in the audited grammar: no JSON reaches the classifier.
    outcome = classify_get_message_result(
        expected_message_id="18cab_1", json_messages=[], stream_completed=True, declared_failure=False
    )
    assert (outcome.state, outcome.reason_code) == ("unknown", "result_missing")


def test_declared_structured_failure_is_failed() -> None:
    outcome = classify_get_message_result(
        expected_message_id="18cab_1", json_messages=[], stream_completed=True, declared_failure=True
    )
    assert (outcome.state, outcome.reason_code) == ("failed", "declared_failure")


@pytest.mark.parametrize(("completed", "messages"), [(False, []), (False, [success()]), (True, [success()])])
def test_declared_failure_never_overrides_transport_loss_or_conflicting_success(
    completed: bool, messages: list[dict[str, object]]
) -> None:
    outcome = classify_get_message_result(
        expected_message_id="18cab_1", json_messages=messages, stream_completed=completed, declared_failure=True
    )
    assert outcome.state == "unknown"


def test_transport_loss_overrides_success_looking_json() -> None:
    outcome = classify_get_message_result(
        expected_message_id="18cab_1", json_messages=[success()], stream_completed=False, declared_failure=False
    )
    assert (outcome.state, outcome.reason_code) == ("unknown", "stream_incomplete")


def test_classifier_refuses_unsafe_expected_id() -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        classify_get_message_result(
            expected_message_id="a/b", json_messages=[success("a/b")], stream_completed=True, declared_failure=False
        )


# --- qualification and envelope ---------------------------------------------------


def installed(**overrides: object) -> InstalledToolBinding:
    return InstalledToolBinding.model_validate(
        {
            "tenant_id": "tenant-1",
            "installation_id": "installation-1",
            "plugin_id": "langgenius/dify-gmail",
            "provider_id": PROVIDER,
            "tool_name": "get_message",
            "unique_identifier": HYPOTHETICAL_ARTIFACT,
            "version": "9.9.9",
            "checksum": "f" * 64,
            "schema_digest": HYPOTHETICAL_SCHEMA,
            "source_audit_revision": HYPOTHETICAL_AUDIT,
            "daemon_contract_revision": "confirmed-tenant-dispatch-v1",
            "runtime_type": "local",
            **overrides,
        }
    )


def credential() -> CredentialReference:
    return CredentialReference.model_validate(
        {
            "credential_id": "credential-1",
            "provider_id": PROVIDER,
            "alias": "Team mailbox",
            "credential_type": "oauth2",
            "visibility": "workspace",
            "revision": "c" * 64,
            "oauth_client_revision": "e" * 64,
            "expires_at": -1,
        }
    )


@pytest.fixture
def hypothetical_qualified(monkeypatch: pytest.MonkeyPatch) -> None:
    """HYPOTHETICAL qualification so domain matching can be exercised; not runtime evidence."""
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_ARTIFACT", HYPOTHETICAL_ARTIFACT)
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_SCHEMA_DIGEST", HYPOTHETICAL_SCHEMA)
    monkeypatch.setattr(gmail_read_policy, "GMAIL_SOURCE_AUDIT_REVISION", HYPOTHETICAL_AUDIT)


def test_actual_qualification_remains_unavailable() -> None:
    assert gmail_read_policy.QUALIFIED_GMAIL_ARTIFACT is None
    assert gmail_read_policy.QUALIFIED_GMAIL_SCHEMA_DIGEST is None
    assert gmail_read_policy.GMAIL_SOURCE_AUDIT_REVISION is None
    assert gmail_read_policy.DAEMON_CONTRACT_REVISION == "confirmed-tenant-dispatch-v1"


@pytest.mark.parametrize(
    "candidate",
    [
        installed(),
        installed(
            unique_identifier="langgenius/dify-gmail:0.2.7@" + "7" * 64,
            version="0.2.7",
            checksum="7" * 64,
            schema_digest="8ab39aaeee071d91f9f9d32a1d784f15ad9e61a9a0cb21acb0200c5fb886f80b",
            source_audit_revision="unavailable",
        ),
    ],
)
def test_unqualified_profile_fails_closed(candidate: InstalledToolBinding) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        qualify_installed_action(candidate)
    assert raised.value.reason_code == "unsupported_action"
    with pytest.raises(BuilderExecutionPolicyError):
        get_message_envelope(
            installed=candidate, credential=credential(), parameters=GmailReadParameters.model_validate(params())
        )


@pytest.mark.usefixtures("hypothetical_qualified")
@pytest.mark.parametrize(
    "overrides",
    [
        {"unique_identifier": "langgenius/dify-gmail:9.9.8@" + "f" * 64},
        {"schema_digest": "d" * 64},
        {"source_audit_revision": "other-audit"},
        {"daemon_contract_revision": "confirmed-tenant-dispatch-v0"},
        {"tool_name": "send_message"},
        {"plugin_id": "other/dify-gmail"},
        {"provider_id": "other/dify-gmail/dify-gmail"},
    ],
)
def test_hypothetical_qualification_requires_exact_match(overrides: dict[str, object]) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        qualify_installed_action(installed(**overrides))
    assert raised.value.reason_code == "unsupported_action"


@pytest.mark.usefixtures("hypothetical_qualified")
def test_hypothetical_envelope_is_fixed_and_separate_from_outcome() -> None:
    qualify_installed_action(installed())
    envelope = get_message_envelope(
        installed=installed(), credential=credential(), parameters=GmailReadParameters.model_validate(params())
    )
    dumped = envelope.model_dump(mode="json")
    assert (dumped["method"], dumped["host"], dumped["api_version"], dumped["format"]) == (
        "GET",
        "gmail.googleapis.com",
        "v1",
        "full",
    )
    assert dumped["path"] == "/gmail/v1/users/me/messages/18cab_1"
    assert dumped["parameters"] == params()
    assert dumped["installed"]["unique_identifier"] == HYPOTHETICAL_ARTIFACT
    assert dumped["credential"]["credential_id"] == "credential-1"
    assert "access_token" not in str(dumped)


@pytest.mark.usefixtures("hypothetical_qualified")
@pytest.mark.parametrize("length", [1, 228, 229, 256])
def test_hypothetical_envelope_accepts_every_supported_message_id_length(length: int) -> None:
    # Full pure chain: parameters -> HYPOTHETICAL qualified envelope -> public disclosure.
    message_id = "a" * length
    selected = credential()
    parameters = normalize_get_message_parameters(params(message_id=message_id))
    envelope = get_message_envelope(installed=installed(), credential=selected, parameters=parameters)
    assert envelope.path == "/gmail/v1/users/me/messages/" + message_id
    assert envelope.parameters.message_id == message_id
    disclosure = get_message_disclosure(
        credential=selected, parameters=parameters, expires_at=NOW + timedelta(minutes=10)
    )
    assert disclosure.request_url == (
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + message_id + "?format=full"
    )
    assert disclosure.message_id == message_id
    assert disclosure.credential_id == selected.credential_id
    assert disclosure.expires_at == NOW + timedelta(minutes=10)
    assert disclosure.expires_at.utcoffset() == timedelta(0)
    assert len(message_id) <= 256


@pytest.mark.usefixtures("hypothetical_qualified")
def test_hypothetical_envelope_rejects_overlong_or_tampered_path() -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        normalize_get_message_parameters(params(message_id="a" * 257))
    valid = get_message_envelope(
        installed=installed(), credential=credential(), parameters=GmailReadParameters.model_validate(params())
    ).model_dump()
    for path in (
        "/gmail/v1/users/me/messages/" + "a" * 257,
        "/gmail/v1/users/me/messages/18cab_1/extra",
        "/gmail/v1/users/other/messages/18cab_1",
    ):
        with pytest.raises(ValidationError):
            GmailGetMessageEnvelope.model_validate({**valid, "path": path})


@pytest.mark.usefixtures("hypothetical_qualified")
def test_envelope_refuses_credential_for_other_provider() -> None:
    other = credential().model_copy(update={"provider_id": "other/provider/provider"})
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        get_message_envelope(
            installed=installed(), credential=other, parameters=GmailReadParameters.model_validate(params())
        )
    assert raised.value.reason_code == "credential_provider_mismatch"


@pytest.mark.usefixtures("hypothetical_qualified")
@pytest.mark.parametrize("credential_type", ["api-key", "unauthorized", "OAuth2", "oauth2 ", "oauth"])
def test_envelope_admits_only_the_canonical_oauth_credential_type(credential_type: str) -> None:
    # The approved slice binds an explicit existing OAuth credential: an API-key or unauthorized
    # row of the same provider (its client is "missing", which the generic reference binds) is
    # refused, as is any non-canonical spelling.
    other = credential().model_copy(update={"credential_type": credential_type})
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        get_message_envelope(
            installed=installed(), credential=other, parameters=GmailReadParameters.model_validate(params())
        )
    assert raised.value.reason_code == "credential_required"


@pytest.mark.usefixtures("hypothetical_qualified")
def test_envelope_keeps_the_bound_oauth_client_snapshot_semantics() -> None:
    # An OAuth credential is admitted whatever client snapshot the reference bound (including the
    # opaque revision of a "missing" client); the client contract is owned by the reference.
    for client_revision in ("e" * 64, "0" * 64):
        selected = credential().model_copy(update={"oauth_client_revision": client_revision})
        envelope = get_message_envelope(
            installed=installed(), credential=selected, parameters=GmailReadParameters.model_validate(params())
        )
        assert envelope.credential.credential_type == "oauth2"


def test_false_flags_still_disclose_full_format_fetch() -> None:
    disclosure = get_message_disclosure(
        credential=credential(),
        parameters=GmailReadParameters.model_validate(params()),
        expires_at=NOW + timedelta(minutes=10),
    )
    dumped = disclosure.model_dump(mode="json")
    assert dumped["include_body"] is False
    assert dumped["include_attachments"] is False
    assert dumped["response_format"] == "full"
    assert dumped["request_url"] == "https://gmail.googleapis.com/gmail/v1/users/me/messages/18cab_1?format=full"
    assert dumped["oauth_refresh_url"] == "https://oauth2.googleapis.com/token"
    assert (dumped["identity_basis"], dumped["remote_account_status"]) == ("workspace_credential", "unknown")
    assert (dumped["native_attempt_limit"], dumped["refresh_limit"], dumped["automatic_replay"]) == (1, 1, False)
    assert dumped["credential_alias"] == "Team mailbox"
    assert not {"revision", "oauth_client_revision", "credential_revision"} & set(dumped)


def test_disclosure_retains_prior_uncertain_consent() -> None:
    disclosure = get_message_disclosure(
        credential=credential(),
        parameters=GmailReadParameters.model_validate(params()),
        expires_at=NOW,
        prior_uncertain_consent_id="consent-0",
    )
    assert disclosure.prior_uncertain_consent_id == "consent-0"


def test_parameters_model_is_strict() -> None:
    with pytest.raises(ValidationError):
        GmailReadParameters.model_validate(params(include_body=1))


# --- three-node admission -----------------------------------------------------------


def tool_parameters(**changes: object) -> dict[str, object]:
    values: dict[str, object] = {name: {"type": "constant", "value": value} for name, value in params().items()}
    return {**values, **changes}


def tool_data(**overrides: object) -> dict[str, object]:
    return {
        "type": "tool",
        "title": "Get message",
        "provider_id": PROVIDER,
        "provider_type": "builtin",
        "provider_name": PROVIDER,
        "tool_name": "get_message",
        "tool_label": "Get message",
        "tool_configurations": {},
        "credential_id": "credential-1",
        "tool_node_version": "2",
        "tool_parameters": tool_parameters(),
        **overrides,
    }


def gmail_graph(
    tool: dict[str, object] | None = None,
    end_outputs: list[dict[str, object]] | None = None,
    start_variables: list[dict[str, object]] | None = None,
) -> Graph:
    nodes: list[dict[str, object]] = [
        {"id": "start", "data": {"type": "start", "title": "Start", "variables": start_variables or []}},
        {"id": "tool", "data": tool or tool_data()},
        {
            "id": "end",
            "data": {
                "type": "end",
                "title": "End",
                "outputs": end_outputs
                if end_outputs is not None
                else [{"variable": "result", "value_selector": ["tool", "json"]}],
            },
        },
    ]
    return {
        "nodes": nodes,
        "edges": [{"source": a["id"], "target": b["id"]} for a, b in zip(nodes, nodes[1:], strict=False)],
    }


def snapshot(
    graph: Graph | None = None, features: dict[str, object] | None = None, **flags: bool
) -> RestrictedAdmissionSnapshot:
    return RestrictedAdmissionSnapshot(
        app_mode="workflow",
        workflow_kind="standard",
        graph=graph if graph is not None else gmail_graph(),
        input_schema={},
        features=features or {},
        has_environment_variables=flags.get("env", False),
        has_conversation_variables=flags.get("conversation", False),
        has_external_tracing=flags.get("tracing", False),
    )


def test_admits_exact_three_node_literal_get_message() -> None:
    admission = admit_get_message_workflow(snapshot())
    assert admission.tool_node_id == "tool"
    assert admission.credential_id == "credential-1"
    assert admission.provider_id == PROVIDER
    assert admission.parameters == GmailReadParameters.model_validate(params())
    assert [binding.node_id for binding in admission.nodes] == ["start", "tool", "end"]
    tool_binding = admission.nodes[1]
    assert tool_binding.implementation == "graphon.nodes.tool.tool_node.ToolNode"
    assert tool_binding.node_version == "1"


def test_admission_digest_binds_full_tool_configuration() -> None:
    changed = gmail_graph(tool=tool_data(title="Renamed"))
    assert (
        admit_get_message_workflow(snapshot()).nodes[1].normalized_config_digest
        != admit_get_message_workflow(snapshot(changed)).nodes[1].normalized_config_digest
    )


def _with_param(name: str, value: dict[str, object]) -> dict[str, object]:
    return tool_data(tool_parameters=tool_parameters(**{name: value}))


def _without_param(name: str) -> dict[str, object]:
    return tool_data(tool_parameters={k: v for k, v in tool_parameters().items() if k != name})


def _branching_graph() -> Graph:
    graph = gmail_graph()
    graph["edges"].append({"source": "start", "target": "end"})
    return graph


def _four_nodes() -> Graph:
    graph = gmail_graph()
    second = copy.deepcopy(graph["nodes"][1])
    second["id"] = "tool2"
    graph["nodes"].insert(2, second)
    graph["edges"] = [
        {"source": a["id"], "target": b["id"]} for a, b in zip(graph["nodes"], graph["nodes"][1:], strict=False)
    ]
    return graph


def _two_nodes() -> Graph:
    graph = gmail_graph()
    del graph["nodes"][1]
    graph["edges"] = [{"source": "start", "target": "end"}]
    return graph


def _http_instead_of_tool() -> Graph:
    return gmail_graph(
        tool={
            "type": "http-request",
            "method": "GET",
            "url": "https://example.invalid",
            "authorization": {"type": "no-auth"},
        }
    )


@pytest.mark.parametrize(
    ("graph", "reason"),
    [
        pytest.param(_four_nodes(), "unsupported_graph", id="four-nodes"),
        pytest.param(_two_nodes(), "unsupported_graph", id="no-tool"),
        pytest.param(_branching_graph(), "unsupported_graph", id="branch"),
        pytest.param(_http_instead_of_tool(), "unsupported_node_implementation", id="http-node"),
        pytest.param(gmail_graph(tool=tool_data(version="2")), "unsupported_node_implementation", id="node-version"),
        pytest.param(gmail_graph(tool=tool_data(provider_type="plugin")), "unsupported_action", id="provider-type"),
        pytest.param(gmail_graph(tool=tool_data(provider_type="mcp")), "unsupported_action", id="mcp"),
        pytest.param(
            gmail_graph(tool=tool_data(provider_id="other/provider/provider")), "unsupported_action", id="provider"
        ),
        pytest.param(gmail_graph(tool=tool_data(tool_name="send_message")), "unsupported_action", id="send"),
        pytest.param(gmail_graph(tool=tool_data(credential_id=None)), "credential_required", id="no-credential"),
        pytest.param(gmail_graph(tool=tool_data(credential_id="")), "credential_required", id="empty-credential"),
        pytest.param(
            gmail_graph(tool=tool_data(tool_configurations={"api_key": "x"})),
            "unsupported_tool_configuration",
            id="config",
        ),
        pytest.param(
            gmail_graph(tool=tool_data(tool_node_version=None)), "unsupported_tool_configuration", id="legacy-params"
        ),
        pytest.param(gmail_graph(tool=tool_data(paramSchemas=[])), "unsupported_node_configuration", id="schema-field"),
        pytest.param(
            gmail_graph(tool=tool_data(output_schema={})), "unsupported_node_configuration", id="output-schema"
        ),
        pytest.param(
            gmail_graph(tool=tool_data(default_value=[{"key": "text", "type": "string", "value": ""}])),
            "unsupported_default_output",
            id="default-output",
        ),
        pytest.param(
            gmail_graph(tool=tool_data(error_strategy="default-value")),
            "unsupported_default_output",
            id="error-strategy",
        ),
        pytest.param(
            gmail_graph(tool=tool_data(retry_config={"retry_enabled": True, "max_retries": 1, "retry_interval": 0})),
            "unsupported_node_retry",
            id="retry",
        ),
        pytest.param(gmail_graph(tool=tool_data(isInIteration=True)), "unsupported_graph", id="iteration"),
        pytest.param(
            gmail_graph(tool=_with_param("message_id", {"type": "variable", "value": ["start", "id"]})),
            "unsupported_tool_parameters",
            id="var",
        ),
        pytest.param(
            gmail_graph(tool=_with_param("message_id", {"type": "mixed", "value": "18cab_1"})),
            "unsupported_tool_parameters",
            id="mixed",
        ),
        pytest.param(
            gmail_graph(tool=_with_param("message_id", {"type": "constant", "value": "a/b"})),
            "unsafe_message_id",
            id="unsafe-id",
        ),
        pytest.param(
            gmail_graph(tool=_with_param("include_body", {"type": "constant", "value": "false"})),
            "unsupported_tool_parameters",
            id="coerce",
        ),
        pytest.param(
            gmail_graph(tool=_with_param("include_body", {"type": "constant", "value": None})),
            "unsupported_tool_parameters",
            id="none",
        ),
        pytest.param(
            gmail_graph(tool=_with_param("format", {"type": "constant", "value": "raw"})),
            "unsupported_tool_parameters",
            id="extra-param",
        ),
        pytest.param(
            gmail_graph(tool=_with_param("include_body", {"type": "constant", "value": False, "default": True})),
            "unsupported_tool_parameters",
            id="param-default-field",
        ),
        pytest.param(
            gmail_graph(tool=_without_param("include_attachments")), "unsupported_tool_parameters", id="missing-flag"
        ),
        pytest.param(
            gmail_graph(end_outputs=[{"variable": "f", "value_selector": ["tool", "files"]}]),
            "unsupported_selector",
            id="files-out",
        ),
        pytest.param(
            gmail_graph(end_outputs=[{"variable": "f", "value_selector": ["other", "x"]}]),
            "unsupported_selector",
            id="bad-selector",
        ),
        pytest.param(
            gmail_graph(start_variables=[{"variable": "f", "type": "file", "label": "f", "required": False}]),
            "unsupported_start_input",
            id="file-input",
        ),
    ],
)
def test_admission_refuses_everything_but_the_exact_slice(graph: Graph, reason: str) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        admit_get_message_workflow(snapshot(graph))
    assert raised.value.reason_code == reason


@pytest.mark.parametrize(
    "value",
    [
        snapshot(env=True),
        snapshot(conversation=True),
        snapshot(tracing=True),
        snapshot(features={"file_upload": {"enabled": True}}),
        snapshot(features={"unknown_feature": {}}),
    ],
)
def test_admission_reuses_raw_feature_restrictions(value: RestrictedAdmissionSnapshot) -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        admit_get_message_workflow(value)


@pytest.mark.parametrize(
    ("graph", "reason"),
    [
        pytest.param(
            gmail_graph(start_variables=[{"variable": ["x"], "type": "text-input", "label": "x"}]),
            "unsupported_start_input",
            id="list-variable-name",
        ),
        pytest.param(
            gmail_graph(start_variables=[{"variable": {"x": 1}, "type": "text-input", "label": "x"}]),
            "unsupported_start_input",
            id="dict-variable-name",
        ),
        pytest.param(
            gmail_graph(start_variables=[{"variable": 7, "type": "number", "label": "x"}]),
            "unsupported_start_input",
            id="number-variable-name",
        ),
        pytest.param(
            gmail_graph(end_outputs=[{"variable": "r", "value_selector": ["start", ["x"]]}]),
            "unsupported_selector",
            id="list-start-output",
        ),
        pytest.param(
            gmail_graph(end_outputs=[{"variable": "r", "value_selector": ["tool", {"json": 1}]}]),
            "unsupported_selector",
            id="dict-tool-output",
        ),
        pytest.param(
            gmail_graph(end_outputs=[{"variable": "r", "value_selector": [["tool"], "json"]}]),
            "unsupported_selector",
            id="list-node-id",
        ),
        pytest.param(
            gmail_graph(end_outputs=[{"variable": "r", "value_selector": [{"tool": 1}, "json"]}]),
            "unsupported_selector",
            id="dict-node-id",
        ),
    ],
)
def test_malformed_json_names_and_selectors_are_sanitized_refusals(graph: Graph, reason: str) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        admit_get_message_workflow(snapshot(graph))
    assert raised.value.reason_code == reason
