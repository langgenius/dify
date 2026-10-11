"""Pure consent contracts: strict binding, keyed scope, phase rules and context union.

No credential, runtime, network or database owner is exercised here.
"""

import ast
import inspect
from datetime import UTC, datetime, timedelta, timezone
from typing import get_args

import pytest
from pydantic import TypeAdapter, ValidationError
from pydantic.fields import FieldInfo

from configs.feature import WorkflowConfig
from core.dify_builder import execution_policy
from core.dify_builder.execution_policy import (
    AdmittedNodeBinding,
    BuilderExecutionContext,
    BuilderExecutionContextValue,
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
    RestrictedAdmissionSnapshot,
    admit_restricted_workflow,
    context_digest,
    validate_execution_context,
)
from core.dify_builder.real_call_consent import (
    ActionOutcome,
    ConsentBinding,
    ConsentDisclosure,
    ConsentReceipt,
    scope_digest,
    validate_phase,
    validate_scope,
)

KEY = b"k" * 32
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=UTC)
D = "a" * 64
MESSAGE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/18cab_1?format=full"


def installed(**overrides: object) -> dict[str, object]:
    return {
        "tenant_id": "tenant-1",
        "installation_id": "installation-1",
        "plugin_id": "langgenius/dify-gmail",
        "provider_id": "langgenius/dify-gmail/dify-gmail",
        "tool_name": "get_message",
        "unique_identifier": "langgenius/dify-gmail:0.2.7@" + "7" * 64,
        "version": "0.2.7",
        "checksum": "7" * 64,
        "schema_digest": "8" * 64,
        "source_audit_revision": "audit-1",
        "daemon_contract_revision": "confirmed-tenant-dispatch-v1",
        "runtime_type": "local",
        **overrides,
    }


def credential(**overrides: object) -> dict[str, object]:
    return {
        "credential_id": "credential-1",
        "provider_id": "langgenius/dify-gmail/dify-gmail",
        "alias": "Team mailbox",
        "credential_type": "oauth2",
        "visibility": "workspace",
        "revision": "c" * 64,
        "oauth_client_revision": "e" * 64,
        "expires_at": -1,
        **overrides,
    }


def binding_values(**overrides: object) -> dict[str, object]:
    return {
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "actor_id": "actor-1",
        "session_id": "session-1",
        "prepared_commit_id": "commit-1",
        "interaction_id": "interaction-1",
        "plan_identity": "1" * 64,
        "test_input_id": "input-1",
        "execution_revision": "2" * 64,
        "graph_revision": "3" * 64,
        "submitted_inputs_digest": "4" * 64,
        "effective_inputs_digest": "5" * 64,
        "node_id": "tool",
        "node_implementation": "graphon.nodes.tool.tool_node.ToolNode",
        "node_config_digest": "6" * 64,
        "policy_version": "builder-confirmed-gmail-read-v1",
        "disclosure_version": "gmail-get-message-disclosure-v1",
        "prepared_version": 3,
        "installed": installed(),
        "credential": credential(),
        "parameters": {"message_id": "18cab_1", "include_body": False, "include_attachments": False},
        "expires_at": NOW + timedelta(minutes=10),
        **overrides,
    }


def binding(**overrides: object) -> ConsentBinding:
    return ConsentBinding.model_validate(binding_values(**overrides))


def disclosure_values(**overrides: object) -> dict[str, object]:
    return {
        "action": "get_message",
        "credential_id": "credential-1",
        "credential_alias": "Team mailbox",
        "credential_type": "oauth2",
        "identity_basis": "workspace_credential",
        "remote_account_status": "unknown",
        "message_id": "18cab_1",
        "request_method": "GET",
        "request_url": MESSAGE_URL,
        "response_format": "full",
        "include_body": False,
        "include_attachments": False,
        "oauth_refresh": "if_needed",
        "oauth_refresh_method": "POST",
        "oauth_refresh_url": "https://oauth2.googleapis.com/token",
        "native_attempt_limit": 1,
        "refresh_limit": 1,
        "automatic_replay": False,
        "quota_usage": "possible",
        "monetary_estimate": "unknown",
        "output_retention": "native_run_retention",
        "data_description": "gmail_message_headers_snippet_and_selected_body_or_attachment_metadata",
        "expires_at": NOW + timedelta(minutes=10),
        **overrides,
    }


def receipt_values(**overrides: object) -> dict[str, object]:
    return {
        "consent_id": "consent-1",
        "scope_digest": D,
        "state": "prepared",
        "at_version": 3,
        "disclosure": disclosure_values(),
        "command_id": None,
        "execution_request_id": None,
        "native_run_id": None,
        "native_node_execution_id": None,
        "reason_code": None,
        "refresh_claimed": False,
        "business_claimed": False,
        "can_retry": True,
        **overrides,
    }


# --- strict binding -------------------------------------------------------


def test_binding_is_frozen_and_fixes_limits_and_node_version() -> None:
    value = binding()
    assert (value.native_attempt_limit, value.refresh_limit, value.node_version) == (1, 1, "1")
    with pytest.raises(ValidationError):
        value.actor_id = "other"  # type: ignore[misc]


@pytest.mark.parametrize(
    "overrides",
    [
        {"prepared_version": True},
        {"prepared_version": "3"},
        {"native_attempt_limit": True},
        {"native_attempt_limit": 2},
        {"refresh_limit": True},
        {"node_version": "2"},
        {"unexpected": "x"},
        {"credentials": {"access_token": "secret"}},
        {"expires_at": datetime(2026, 10, 11, 12, 10)},
        {"expires_at": datetime(2026, 10, 11, 12, 10, tzinfo=timezone(timedelta(hours=8)))},
        {"actor_id": ""},
        {"actor_id": "x" * 129},
        {"actor_id": "bad\ud800"},
        {"graph_revision": "A" * 64},
        {"installed": installed(runtime_type="serverless")},
        {"installed": installed(runtime_type="remote")},
        {"installed": installed(extra="x")},
        {"credential": credential(expires_at=True)},
        {"credential": credential(access_token="secret")},
        {"parameters": {"message_id": "18cab_1", "include_body": 0, "include_attachments": False}},
        {"parameters": {"message_id": "a/b", "include_body": False, "include_attachments": False}},
    ],
)
def test_binding_refuses_coercion_extras_and_unbounded_values(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        binding(**overrides)


# --- keyed scope ------------------------------------------------------------


@pytest.mark.parametrize("key", [b"", "text-key"])
def test_scope_digest_refuses_empty_or_non_bytes_key(key: object) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        scope_digest(binding(), key=key)  # type: ignore[arg-type]
    assert raised.value.reason_code == "invalid_scope_key"


def test_scope_digest_is_keyed_and_independent_of_key_order() -> None:
    values = binding_values()
    reordered = {key: values[key] for key in reversed(list(values))}
    reordered["installed"] = dict(reversed(list(installed().items())))
    digest = scope_digest(binding(), key=KEY)
    assert len(digest) == 64
    assert digest == scope_digest(ConsentBinding.model_validate(reordered), key=KEY)
    assert digest != scope_digest(binding(), key=b"other-key")
    assert digest != execution_policy.canonical_digest(binding().model_dump(mode="json"))


@pytest.mark.parametrize(
    "overrides",
    [
        {"actor_id": "actor-2"},
        {"graph_revision": "9" * 64},
        {"submitted_inputs_digest": "9" * 64},
        {"effective_inputs_digest": "9" * 64},
        {"installed": installed(checksum="9" * 64)},
        {"installed": installed(unique_identifier="langgenius/dify-gmail:0.2.8@" + "9" * 64)},
        {"credential": credential(oauth_client_revision="9" * 64)},
        {"credential": credential(revision="9" * 64)},
        {"parameters": {"message_id": "18cab_1", "include_body": True, "include_attachments": False}},
        {"expires_at": NOW + timedelta(minutes=9)},
    ],
)
def test_scope_changes_alter_digest_and_fail_validation(overrides: dict[str, object]) -> None:
    changed = binding(**overrides)
    assert scope_digest(changed, key=KEY) != scope_digest(binding(), key=KEY)
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        validate_scope(binding(), changed)
    assert raised.value.reason_code == "consent_scope_changed"


def test_validate_scope_accepts_identical_binding() -> None:
    validate_scope(binding(), binding())


# --- phases and terminal recording -------------------------------------------


def phase(**overrides: object) -> None:
    values: dict[str, object] = {
        "state": "claimed",
        "phase": "business",
        "claimed": False,
        "expires_at": NOW + timedelta(seconds=1),
        "now": NOW,
        "refresh_uncertain": False,
        **overrides,
    }
    validate_phase(**values)  # type: ignore[arg-type]


def test_phase_allowed_for_claimed_grant_before_expiry() -> None:
    phase()
    phase(phase="refresh")


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"expires_at": NOW}, "consent_expired"),
        ({"expires_at": NOW - timedelta(seconds=1)}, "consent_expired"),
        ({"state": "confirmed"}, "consent_not_claimed"),
        ({"state": "completed"}, "consent_not_claimed"),
        ({"state": "unknown"}, "consent_not_claimed"),
        ({"claimed": True}, "phase_already_claimed"),
        ({"refresh_uncertain": True}, "refresh_uncertain"),
        ({"refresh_uncertain": True, "phase": "refresh"}, "refresh_uncertain"),
        ({"now": datetime(2026, 10, 11, 12, 0)}, "invalid_consent_time"),
        ({"phase": "invoke"}, "unsupported_phase"),
    ],
)
def test_phase_denials(overrides: dict[str, object], reason: str) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        phase(**overrides)
    assert raised.value.reason_code == reason


def test_expiry_blocks_new_phases_but_outcome_representation_needs_no_clock() -> None:
    # Pure distinction only; durable finish-after-expiry is owned by Task 4 finish / Task 8 CI.
    expired_at = NOW - timedelta(minutes=1)
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        phase(expires_at=expired_at)
    assert raised.value.reason_code == "consent_expired"
    assert set(ActionOutcome.model_fields) == {"state", "reason_code"}
    receipt = ConsentReceipt.model_validate(
        receipt_values(
            state="completed",
            disclosure=disclosure_values(expires_at=expired_at),
            command_id="command-1",
            business_claimed=True,
            can_retry=False,
        )
    )
    assert receipt.state == "completed"
    assert binding(expires_at=expired_at).expires_at == expired_at


@pytest.mark.parametrize(
    "values",
    [
        {"state": "completed", "reason_code": "ok", "body": "message text"},
        {"state": "failed", "reason_code": "Error: Message not found"},
        {"state": "claimed", "reason_code": "ok"},
    ],
)
def test_action_outcome_carries_no_body_or_provider_text(values: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ActionOutcome.model_validate(values)


# --- disclosure and receipt -----------------------------------------------------


def test_disclosure_states_full_format_and_unknown_identity() -> None:
    value = ConsentDisclosure.model_validate(disclosure_values())
    dumped = value.model_dump(mode="json")
    assert dumped["response_format"] == "full"
    assert dumped["remote_account_status"] == "unknown"
    assert dumped["automatic_replay"] is False
    assert dumped["prior_uncertain_consent_id"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"request_url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/other?format=full"},
        {"request_url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/18cab_1?format=metadata"},
        {"remote_account_status": "known"},
        {"automatic_replay": True},
        {"automatic_replay": 0},
        {"native_attempt_limit": True},
        {"refresh_limit": 2},
        {"monetary_estimate": "0"},
        {"access_token": "secret"},
        {"credential_revision": "c" * 64},
        {"expires_at": datetime(2026, 10, 11, 12, 10)},
    ],
)
def test_disclosure_refuses_drift_and_secret_fields(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ConsentDisclosure.model_validate(disclosure_values(**overrides))


@pytest.mark.parametrize(
    "overrides",
    [
        {"command_id": "command-1"},
        {"state": "claimed"},
        {"state": "unknown"},
        {"business_claimed": True, "state": "claimed"},
    ],
)
def test_receipt_cannot_offer_retry_after_reservation_or_claim(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ConsentReceipt.model_validate(receipt_values(**overrides))


@pytest.mark.parametrize(
    "overrides",
    [
        {"at_version": True},
        {"refresh_claimed": 1, "can_retry": False, "state": "claimed"},
        {"refresh_claimed": True, "can_retry": False, "state": "confirmed"},
        {"state": "running"},
    ],
)
def test_receipt_is_strict(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ConsentReceipt.model_validate(receipt_values(**overrides))


# --- execution context union --------------------------------------------------


def restricted_values(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "request_id": "request-1",
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "actor_id": "actor-1",
        "session_id": "session-1",
        "test_input_id": "input-1",
        "execution_revision": D,
        "graph_revision": D,
        "submitted_inputs_digest": D,
        "effective_inputs_digest": D,
        "fixture_digest": D,
        "context_digest": "0" * 64,
        "mode": "restricted",
        "sandbox_profile": "disabled",
        "admitted_nodes": [],
        "http_fixtures": [],
        **overrides,
    }
    values["context_digest"] = context_digest(BuilderExecutionContext.model_validate(values))
    return values


def confirmed_values(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "policy_version": "builder-confirmed-gmail-read-v1",
        "request_id": "request-1",
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "actor_id": "actor-1",
        "session_id": "session-1",
        "test_input_id": "input-1",
        "execution_revision": D,
        "graph_revision": D,
        "submitted_inputs_digest": D,
        "effective_inputs_digest": D,
        "context_digest": "0" * 64,
        "mode": "confirmed_tool",
        "sandbox_profile": "disabled",
        "admitted_nodes": [
            {
                "node_id": "tool",
                "implementation": "graphon.nodes.tool.tool_node.ToolNode",
                "node_version": "1",
                "normalized_config_digest": D,
            }
        ],
        "consent_id": "consent-1",
        "scope_digest": D,
        "command_id": "command-1",
        **overrides,
    }
    values["context_digest"] = context_digest(ConfirmedToolExecutionContext.model_validate(values))
    return values


CONTEXT = TypeAdapter(BuilderExecutionContextValue)


def test_context_value_is_the_exact_locked_field_discriminated_union() -> None:
    union, field = get_args(BuilderExecutionContextValue)
    assert set(get_args(union)) == {BuilderExecutionContext, ConfirmedToolExecutionContext}
    assert isinstance(field, FieldInfo)
    assert field.discriminator == "policy_version"


def test_exact_union_requires_tag_while_restricted_class_keeps_default() -> None:
    implicit = restricted_values()
    assert "policy_version" not in implicit
    with pytest.raises(ValidationError):
        CONTEXT.validate_python(implicit)
    assert BuilderExecutionContext.model_validate(implicit).policy_version == "builder-restricted-v1"
    explicit = {**implicit, "policy_version": "builder-restricted-v1"}
    assert type(CONTEXT.validate_python(explicit)) is BuilderExecutionContext
    dumped = BuilderExecutionContext.model_validate(explicit).model_dump_json()
    assert type(CONTEXT.validate_json(dumped)) is BuilderExecutionContext


def test_safe_boundary_fills_only_a_missing_tag_with_restricted() -> None:
    implicit = restricted_values()
    context = validate_execution_context(implicit)
    assert type(context) is BuilderExecutionContext
    assert "policy_version" not in implicit
    untagged_confirmed = {k: v for k, v in confirmed_values().items() if k != "policy_version"}
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        validate_execution_context(untagged_confirmed)
    assert raised.value.reason_code == "invalid_execution_context"


def test_confirmed_context_round_trips_and_digest_is_union_aware() -> None:
    confirmed = validate_execution_context(confirmed_values())
    assert type(confirmed) is ConfirmedToolExecutionContext
    assert validate_execution_context(confirmed.model_dump(mode="json")) == confirmed
    restricted = validate_execution_context(restricted_values())
    assert type(restricted) is BuilderExecutionContext
    assert context_digest(confirmed) != context_digest(restricted)


@pytest.mark.parametrize(
    "raw",
    [
        {**confirmed_values(), "policy_version": "builder-confirmed-other-v1"},
        {**restricted_values(), "policy_version": None},
        {**confirmed_values(), "context_digest": "f" * 64},
        {**restricted_values(), "context_digest": "f" * 64},
        {key: value for key, value in confirmed_values().items() if key != "consent_id"},
        {key: value for key, value in confirmed_values().items() if key != "scope_digest"},
        {key: value for key, value in confirmed_values().items() if key != "command_id"},
        {**confirmed_values(), "mode": "restricted"},
        {**confirmed_values(), "sandbox_profile": "network-disabled-v1"},
        {**confirmed_values(), "http_fixtures": []},
        {**confirmed_values(), "credentials": {"access_token": "secret"}},
        {**restricted_values(), "consent_id": "consent-1"},
        "not-a-context",
    ],
)
def test_unknown_forged_or_incomplete_context_is_refused(raw: object) -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        validate_execution_context(raw)


def test_restricted_admission_refuses_confirmed_context() -> None:
    confirmed = ConfirmedToolExecutionContext.model_validate(confirmed_values())
    snapshot = RestrictedAdmissionSnapshot(
        app_mode="workflow",
        workflow_kind="standard",
        graph={"nodes": [], "edges": []},
        input_schema={},
        features={},
        has_environment_variables=False,
        has_conversation_variables=False,
        has_external_tracing=False,
    )
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        admit_restricted_workflow(confirmed, snapshot)  # type: ignore[arg-type]
    assert raised.value.reason_code == "unsupported_execution_policy"


def test_confirmed_context_carries_only_admitted_bindings() -> None:
    assert set(ConfirmedToolExecutionContext.model_fields) & {"http_fixtures", "fixture_digest", "credentials"} == set()
    node = ConfirmedToolExecutionContext.model_validate(confirmed_values()).admitted_nodes[0]
    assert isinstance(node, AdmittedNodeBinding)


def test_execution_policy_does_not_import_consent_module() -> None:
    tree = ast.parse(inspect.getsource(execution_policy))
    imported = {
        node.module if isinstance(node, ast.ImportFrom) else alias.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    assert not any(name and "real_call_consent" in name for name in imported)


def test_confirmed_tool_rollout_flag_defaults_off() -> None:
    assert WorkflowConfig.model_fields["DIFY_BUILDER_CONFIRMED_TOOL_ENABLED"].default is False
