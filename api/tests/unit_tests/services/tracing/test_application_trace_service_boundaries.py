"""Exercise public orchestration, privacy, and delivery decisions against durable rows."""

from datetime import datetime
from uuid import UUID, uuid4

import pytest
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.model import Trace
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import RecordingEgress
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowNodeExecutionStatus
from models.application_trace import ApplicationTraceRun
from models.enums import CreatorUserRole
from models.model import Message, TraceAppConfig
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.application_trace_repository import TraceCollectionError
from services.tracing import provider_configs as provider_configs_module
from services.tracing import service as service_module
from services.tracing.registry import provider_class
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_message, make_workflow
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    batch_for,
    claim,
    identifier,
    ingest,
    install_delivery,
    no_egress,
    seed,
    terminal,
    tracing_service,
)

FROZEN_LANGFUSE: dict[str, object] = {
    "public_key": "encrypted-public",
    "secret_key": "encrypted-original",
    "host": "https://langfuse.test",
    "project_key": "original",
}


def source(case: Collection) -> dict[str, str]:
    return {
        "tenant_id": case.run.tenant_id,
        "app_id": case.run.app_id,
        "source_kind": "message",
        "source_id": case.run.source_id,
    }


def forbid_credentials(monkeypatch: pytest.MonkeyPatch, reason: str) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail(reason)

    monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", forbidden)


def freeze_config(case: Collection, provider: str, config: dict[str, object]) -> None:
    with case.sessions.begin() as session:
        run = session.get(ApplicationTraceRun, case.run.id)
        assert run is not None
        run.provider = provider
        run.provider_config = config


def test_prepare_invocation_returns_only_opaque_context_and_respects_capture_gate(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    case = seed(sqlite_session_factory, "prepare", capture_content=True)
    service = tracing_service(case, no_egress())
    context = service.prepare_invocation(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        agent_id=identifier("agent"),
        source_kind="message",
        source_id=case.run.source_id,
        session_id="ignored-new-session",
        node_execution_id=None,
        attempt=0,
        call_key="call",
    )
    assert context is not None
    assert context.run_id == UUID(case.run.id)
    assert context.capture_content is True
    assert context.session_id == "session-original"
    assert "encrypted-original" not in context.model_dump_json()
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
    assert (
        service.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
            session_id="new",
        )
        is None
    )


@pytest.mark.parametrize("missing", ["tenant", "app", "message"])
def test_status_denies_foreign_or_absent_source_without_destination_details(
    sqlite_session_factory: sessionmaker[Session], missing: str
) -> None:
    case = seed(sqlite_session_factory, "scope")
    identity = source(case)
    identity[{"tenant": "tenant_id", "app": "app_id", "message": "source_id"}[missing]] = identifier("foreign")
    with pytest.raises(TraceCollectionError) as caught:
        tracing_service(case, no_egress()).status(**identity)
    assert caught.value.code == "tracing_source_not_found"
    assert caught.value.status == 404
    assert "encrypted-original" not in str(caught.value)


def test_status_uses_frozen_destination_and_selects_latest_node_attempt(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = seed(sqlite_session_factory, "status")
    with case.sessions.begin() as session:
        config = session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == case.run.app_id))
        assert config is not None
        config.tracing_config = {**FROZEN_LANGFUSE, "host": "https://new.example", "project_key": "new"}
    forbid_credentials(monkeypatch, "status must not decrypt credentials")
    node_id = identifier("selected-node")
    invocation = case.repository.invocation(
        run_id=case.run.id, agent_id=identifier("agent"), node_execution_id=node_id, attempt=1, call_key="node:1"
    )
    ingest(case, batch_for(case.run, invocation))
    terminal(case)
    lease = claim(case)
    assert lease is not None
    case.repository.complete(
        case.run.id,
        lease[1],
        state="accepted",
        result=SendResult(
            trace_id="provider-trace",
            trace_url="https://frozen.example/trace",
            span_urls={invocation.span_id: "https://frozen.example/span"},
        ),
    )
    service = tracing_service(case, no_egress())
    result = service.status(**source(case), node_execution_id=node_id)
    assert result["status"] == "accepted"
    assert result["provider"] == "langfuse"
    assert result["trace_id"] == "provider-trace"
    assert result["span_url"] == "https://frozen.example/span"
    assert result["project_url"] == "https://langfuse.test/project/original"
    assert result["config_revision"] == case.run.config_revision
    assert result["queryable"] is None
    assert result["capture_content"] is False
    capabilities = result["capabilities"]
    assert isinstance(capabilities, dict)
    assert capabilities["provider"] == "langfuse"
    assert "provider_config" not in result
    assert "encrypted-original" not in str(result)
    with pytest.raises(TraceCollectionError, match="tracing_node_not_found"):
        service.status(**source(case), node_execution_id=identifier("another-node"))


def test_new_run_freezes_updated_project_without_changing_previous_run(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    case = seed(sqlite_session_factory, "updated-project")
    new_id = identifier("new-message")
    with case.sessions.begin() as session:
        config = session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == case.run.app_id))
        assert config is not None
        config.tracing_config = {**FROZEN_LANGFUSE, "host": "https://new.example", "project_key": "new"}
        message = session.get(Message, case.run.source_id)
        assert message is not None
        session.add(
            make_message(
                message_id=new_id,
                app_id=case.run.app_id,
                conversation_id=message.conversation_id,
                inputs={},
                query="new run",
                message={},
                answer="done",
                message_unit_price=message.message_unit_price,
                answer_unit_price=message.answer_unit_price,
                currency=message.currency,
                from_source=message.from_source,
            )
        )
    new_run = case.repository.start(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="message",
        source_id=new_id,
        session_id="new-session",
    )
    assert new_run is not None
    service = tracing_service(case, no_egress())
    assert service.status(**source(case))["project_url"] == "https://langfuse.test/project/original"
    assert service.status(**{**source(case), "source_id": new_id})["project_url"] == "https://new.example/project/new"


@pytest.mark.parametrize(
    "frozen",
    [
        {key: value for key, value in FROZEN_LANGFUSE.items() if key != "public_key"},
        {**FROZEN_LANGFUSE, "host": 1},
        {**FROZEN_LANGFUSE, "host": "javascript:alert(1)"},
        {**FROZEN_LANGFUSE, "host": "//example.com/project"},
        {**FROZEN_LANGFUSE, "host": "https://user:secret@example.com/project"},
        {**FROZEN_LANGFUSE, "host": "https://@example.com"},
        {**FROZEN_LANGFUSE, "host": "https://example.com\\@other.test"},
        {**FROZEN_LANGFUSE, "host": "https://[invalid/project"},
    ],
)
def test_status_hides_unavailable_or_unsafe_frozen_project_urls(
    sqlite_session_factory: sessionmaker[Session], frozen: dict[str, object]
) -> None:
    case = seed(sqlite_session_factory, "invalid-project")
    freeze_config(case, "langfuse", frozen)
    result = tracing_service(case, no_egress()).status(**source(case))
    assert result["project_url"] is None
    assert "encrypted-original" not in str(result)


@pytest.mark.parametrize(
    ("provider", "frozen"),
    [
        ("langfuse", FROZEN_LANGFUSE),
        ("aliyun", {"license_key": "encrypted-license", "endpoint": "https://tracing.aliyun.example"}),
        (
            "tencent",
            {"token": "encrypted-token", "endpoint": "https://apm.tencent.example", "service_name": "dify-app"},
        ),
    ],
)
def test_status_derives_project_link_from_frozen_provider_not_stored_urls(
    sqlite_session_factory: sessionmaker[Session], provider: str, frozen: dict[str, object]
) -> None:
    case = seed(sqlite_session_factory, "platform-console")
    freeze_config(case, provider, {**frozen, "project_url": "https://stored.example/project"})
    destination = provider_class(provider)
    expected = destination(no_egress()).project_url(destination.config_model.model_validate(frozen))
    result = tracing_service(case, no_egress()).status(**source(case))
    assert expected is not None
    assert result["project_url"] == expected
    capabilities = result["capabilities"]
    assert isinstance(capabilities, dict)
    assert capabilities["provider"] == provider


@pytest.mark.parametrize("disabled", [True, False])
def test_uncollected_status_and_missing_run_retry_do_not_construct_provider(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, disabled: bool
) -> None:
    case = seed(sqlite_session_factory, "missing", enabled=not disabled)
    if not disabled:
        with case.sessions.begin() as session:
            stored = session.get(ApplicationTraceRun, case.run.id)
            assert stored is not None
            session.delete(stored)

    def forbidden(_provider_id: str) -> None:
        pytest.fail("an uncollected source has no destination to construct")

    monkeypatch.setattr(service_module, "provider_class", forbidden)
    service = tracing_service(case, no_egress())
    assert service.status(**source(case)) == {
        "status": "not_collected",
        "source_kind": "message",
        "source_id": case.run.source_id,
    }
    if not disabled:
        with pytest.raises(TraceCollectionError, match="tracing_run_not_found"):
            service.retry(**source(case), acknowledge_possible_duplicates=True)


def test_retry_acknowledgement_guards_schedule_and_keeps_frozen_snapshot(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = seed(sqlite_session_factory, "retry")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    lease = claim(case)
    assert lease is not None
    case.repository.complete(case.run.id, lease[1], state="uncertain", error_code="provider_acceptance_unknown")
    scheduled: list[str] = []
    service = tracing_service(case, no_egress())
    monkeypatch.setattr(service, "schedule", scheduled.append)
    with pytest.raises(TraceCollectionError, match="tracing_duplicate_acknowledgement_required"):
        service.retry(**source(case), acknowledge_possible_duplicates=False)
    assert scheduled == []
    result = service.retry(**source(case), acknowledge_possible_duplicates=True)
    assert scheduled == [case.run.id]
    assert result["status"] == "ready"
    assert result["config_revision"] == case.run.config_revision
    current = case.repository.get(case.run.id)
    assert current is not None
    assert current.provider_config == case.run.provider_config


@pytest.mark.parametrize(
    ("failure", "max_attempts", "state", "code"),
    [
        (ExportRetryableError("private-transport-error"), 1, "failed", "provider_retry_exhausted"),
        (ExportRetryableError("private-transport-error"), 2, "retrying", "provider_temporarily_unavailable"),
        (ExportRejectedError("private-rejection"), 2, "failed", "provider_export_rejected"),
        (ExportOutcomeUnknownError("private-acknowledgement"), 2, "uncertain", "provider_acceptance_unknown"),
        (ValueError("private-credential-error"), 2, "failed", "provider_export_rejected"),
    ],
)
def test_delivery_maps_provider_failures_to_stable_codes_without_vendor_details(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    failure: Exception,
    max_attempts: int,
    state: str,
    code: str,
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_MAX_ATTEMPTS=max_attempts)
    case = seed(sqlite_session_factory, "delivery")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    install_delivery(monkeypatch)
    destination = RecordingEgress([failure], grpc_target=None)
    service = tracing_service(case, destination)
    service.deliver(case.run.id)
    current = case.repository.get(case.run.id)
    assert current is not None
    assert (current.state, current.error_code) == (state, code)
    assert (current.next_attempt_at is not None) is (state == "retrying")
    assert current.attempts == 1
    assert len(destination.requests) == 1
    assert "private-" not in caplog.text
    service.deliver(identifier("missing-run"))


@pytest.mark.parametrize("unreadable", ["decryption", "validation"])
def test_unreadable_frozen_configuration_fails_before_provider_io(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    unreadable: str,
) -> None:
    case = seed(sqlite_session_factory, "unreadable")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    install_delivery(monkeypatch)
    if unreadable == "decryption":

        def undecryptable(_tenant_id: str, _tokens: list[str]) -> list[str]:
            raise ValueError("private-ciphertext")

        monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", undecryptable)
    else:
        freeze_config(case, "langfuse", {**FROZEN_LANGFUSE, "host": "private-host-without-scheme"})
    destination = RecordingEgress([], grpc_target=None)
    tracing_service(case, destination).deliver(case.run.id)
    current = case.repository.get(case.run.id)
    assert current is not None
    assert (current.state, current.error_code) == ("failed", "tracing_config_unreadable")
    assert destination.requests == []
    assert "private-" not in caplog.text
    with pytest.raises(TraceCollectionError, match="tracing_retry_not_allowed"):
        case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)


def test_unavailable_frozen_provider_fails_before_decryption(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = seed(sqlite_session_factory, "retired-provider")
    ingest(case, batch_for(case.run, case.invocation()))
    terminal(case)
    freeze_config(case, "retired-provider", FROZEN_LANGFUSE)
    forbid_credentials(monkeypatch, "an unavailable provider must not decrypt credentials")
    tracing_service(case, no_egress()).deliver(case.run.id)
    current = case.repository.get(case.run.id)
    assert current is not None
    assert (current.state, current.error_code) == ("failed", "tracing_provider_unavailable")


@pytest.mark.parametrize("capture_content", [False, True])
@pytest.mark.parametrize(
    "status",
    [WorkflowNodeExecutionStatus.RUNNING, WorkflowNodeExecutionStatus.SUCCEEDED, WorkflowNodeExecutionStatus.FAILED],
)
def test_preview_terminal_uses_persisted_node_state_and_frozen_privacy(
    sqlite_session_factory: sessionmaker[Session], status: WorkflowNodeExecutionStatus, capture_content: bool
) -> None:
    case = seed(sqlite_session_factory, "preview", capture_content=capture_content)
    node_id = identifier("preview-node")
    workflow_id = identifier("preview-definition")
    with case.sessions.begin() as session:
        session.add(make_workflow(workflow_id=workflow_id, tenant_id=case.run.tenant_id, app_id=case.run.app_id))
        session.add(
            WorkflowNodeExecutionModel(
                id=node_id,
                node_execution_id=node_id,
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                workflow_id=workflow_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
                index=0,
                node_id="agent",
                node_type="agent",
                title="Agent preview",
                inputs='{"secret":"private-input"}',
                outputs='{"answer":"private-output"}',
                process_data="{}",
                status=status,
                elapsed_time=2,
                error="private-model-error" if status == WorkflowNodeExecutionStatus.FAILED else None,
                created_at=datetime(2026, 1, 1),
                created_by=identifier("account"),
                created_by_role=CreatorUserRole.ACCOUNT,
            )
        )
    run = case.repository.start(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="node",
        source_id=node_id,
        workflow_id=workflow_id,
        session_id="preview-session",
    )
    assert run is not None
    tracing_service(case, no_egress()).settle_preview(run)
    current = case.repository.get(run.id)
    assert current is not None
    if status == WorkflowNodeExecutionStatus.RUNNING:
        assert current.outer_trace is None
    else:
        assert current.outer_trace is not None
        trace = Trace.model_validate(current.outer_trace)
        root = trace.root
        assert root.span_id == run.root_span_id
        assert root.status.value == ("error" if status == WorkflowNodeExecutionStatus.FAILED else "ok")
        assert ("private-" in trace.model_dump_json()) is capture_content
        assert root.attributes["node_execution_id"] == node_id
        assert (root.end_time - root.start_time).total_seconds() == 2
        if not capture_content and status == WorkflowNodeExecutionStatus.FAILED:
            assert root.error == "Node execution failed"


@pytest.mark.parametrize(
    ("invalid", "code"),
    [
        ("empty", "tracing_invocation_empty"),
        ("foreign_parent", "tracing_invocation_parent_invalid"),
        ("no_invocation_root", "tracing_invocation_root_missing"),
        ("self_parent", "tracing_payload_invalid"),
        ("conflicting_span", "tracing_span_conflict"),
    ],
)
def test_invalid_runtime_tree_is_rejected_before_provider_credentials_or_io(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, invalid: str, code: str
) -> None:
    case = seed(sqlite_session_factory, "invalid-runtime")
    batch = batch_for(case.run, case.invocation())
    if invalid == "empty":
        batch.spans = []
    elif invalid == "foreign_parent":
        batch.spans[0] = batch.spans[0].model_copy(update={"parent_span_id": "f" * 16})
    elif invalid == "no_invocation_root":
        # Every parent is a collected span, but none of them hangs from the invocation.
        batch.spans = [
            batch.spans[0].model_copy(update={"parent_span_id": "b" * 16}),
            batch.spans[0].model_copy(update={"span_id": "b" * 16, "parent_span_id": "a" * 16}),
        ]
    elif invalid == "self_parent":
        batch.spans[0] = batch.spans[0].model_copy(update={"parent_span_id": batch.spans[0].span_id})
    else:
        ingest(case, batch.model_copy(update={"final": False}))
        batch = batch.model_copy(
            update={"batch_id": uuid4(), "spans": [batch.spans[0].model_copy(update={"name": "conflicting-version"})]}
        )
    ingest(case, batch)
    terminal(case)

    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("invalid trees must fail before credentials or provider requests")

    monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", forbidden)
    monkeypatch.setattr(service_module, "provider_class", forbidden)
    tracing_service(case, no_egress()).deliver(case.run.id)
    current = case.repository.get(case.run.id)
    assert current is not None
    assert current.state == "failed"
    assert current.error_code == code


def test_assemble_requires_a_persisted_business_terminal(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "no-terminal")
    with pytest.raises(TraceCollectionError, match="tracing_terminal_missing"):
        tracing_service(case, no_egress()).assemble(case.run)


def test_assembled_trace_nests_runtime_spans_under_their_invocation_with_trusted_identity(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    case = seed(sqlite_session_factory, "assembled")
    invocation = case.invocation()
    ingest(case, batch_for(case.run, invocation))
    terminal(case)
    stored = case.repository.get(case.run.id)
    assert stored is not None
    trace = tracing_service(case, no_egress()).assemble(stored)
    assert trace.trace_id == case.run.trace_id
    assert trace.session_id == "session-original"
    assert [(span.span_id, span.parent_span_id) for span in trace.spans] == [
        (case.run.root_span_id, None),
        (invocation.span_id, case.run.root_span_id),
        ("a" * 16, invocation.span_id),
    ]
    attempt = trace.spans[1]
    assert attempt.name == "Agent attempt 1"
    assert attempt.attributes["invocation_id"] == invocation.id
    assert (attempt.start_time, attempt.end_time) == (trace.spans[2].start_time, trace.spans[2].end_time)
    for span in trace.spans:
        assert span.attributes["dify.tracing.run_id"] == case.run.id
        assert span.attributes["dify.source.id"] == case.run.source_id
        assert span.attributes["tenant_id"] == case.run.tenant_id
