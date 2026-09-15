import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.ops import trace_source
from core.ops.trace_data import CompletedTrace, QueuedTrace, TraceProviderSettings
from enterprise.telemetry import draft_trace, operation_trace
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient
from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole
from models.model import App, AppMode
from models.provider import Provider, ProviderCredential, ProviderModel, ProviderModelCredential, ProviderType
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowType,
)


@dataclass(frozen=True)
class DraftCredentialOwner:
    tenant_id: str
    user_id: str
    app_id: str
    workflow_id: str
    provider_credential_id: str
    model_credential_id: str
    name: str


def create_draft_credential_owner(session: Session, name: str) -> DraftCredentialOwner:
    tenant = Tenant(name=name)
    user = Account(name=name, email=f"{name}@example.com")
    session.add_all([tenant, user])
    session.flush()
    app = App(tenant_id=tenant.id, name=name, mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    session.add_all([app, TenantAccountJoin(tenant_id=tenant.id, account_id=user.id, role=TenantAccountRole.OWNER)])
    session.flush()
    workflow = Workflow(
        tenant_id=tenant.id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW,
        version="draft",
        graph="{}",
        _features="{}",
        created_by=user.id,
    )
    provider_credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name="provider",
        credential_name=f"{name} provider key",
        encrypted_config=f"{name} provider ciphertext",
        user_id=user.id,
    )
    model_credential = ProviderModelCredential(
        tenant_id=tenant.id,
        provider_name="provider",
        model_name="model",
        model_type=ModelType.LLM,
        credential_name=f"{name} model key",
        encrypted_config=f"{name} model ciphertext",
    )
    session.add_all([workflow, provider_credential, model_credential])
    session.flush()
    session.add_all(
        [
            Provider(tenant_id=tenant.id, provider_name="provider", credential_id=provider_credential.id),
            ProviderModel(
                tenant_id=tenant.id,
                provider_name="provider",
                model_name="model",
                model_type=ModelType.LLM,
                credential_id=model_credential.id,
            ),
        ]
    )
    session.commit()
    return DraftCredentialOwner(
        tenant.id, user.id, app.id, workflow.id, provider_credential.id, model_credential.id, name
    )


@pytest.fixture
def draft_credential_owner(
    sqlite_session: Session, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> DraftCredentialOwner:
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(draft_trace, "telemetry_emit", operation_trace.record_enterprise_operation)
    monkeypatch.setattr(
        trace_source,
        "get_trace_provider_settings",
        lambda tenant_id, app_id: (
            TraceProviderSettings(
                tenant_id=tenant_id, app_id=app_id, provider_name="enterprise", destination_type="enterprise"
            ),
        ),
    )
    return create_draft_credential_owner(sqlite_session, "first")


def capture_draft(owner: DraftCredentialOwner) -> QueuedTrace | None:
    started = datetime.now(UTC)
    execution = WorkflowNodeExecutionModel(
        id=str(uuid4()),
        tenant_id=owner.tenant_id,
        app_id=owner.app_id,
        workflow_id=owner.workflow_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        workflow_run_id=None,
        index=1,
        node_id="llm",
        node_type="llm",
        title="Draft LLM",
        inputs=json.dumps({"query": f"{owner.name} private query"}),
        process_data=json.dumps({"model_provider": "provider", "model_name": "model"}),
        outputs=json.dumps({"answer": f"{owner.name} private answer"}),
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        elapsed_time=1,
        execution_metadata="{}",
        created_at=started,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=owner.user_id,
        finished_at=started + timedelta(seconds=1),
    )
    application = Flask(__name__)
    queue = Mock()
    application.extensions["ops_trace_queue"] = queue
    with application.app_context():
        draft_trace.enqueue_draft_node_execution_trace(
            execution=execution, outputs=None, workflow_execution_id=None, user_id=owner.user_id
        )
    if not queue.submit_trace.called:
        return None
    queue.submit_trace.assert_called_once()
    return QueuedTrace.model_validate_json(queue.submit_trace.call_args.args[0].model_dump_json())


def export_draft(queued: QueuedTrace, *, include_content: bool) -> dict[str, str]:
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    send_traces = Mock()
    client.otlp.send_traces = send_traces
    client.otlp.send_metrics = Mock()
    client.logger = Mock()
    client.export_trace(CompletedTrace.model_validate_json(queued.trace_json))
    exported = send_traces.call_args.args[0].resource_spans[0].scope_spans[0].spans[0]
    fields = {attribute.key: attribute.value.string_value for attribute in exported.attributes}
    for key in ("dify.credential.id", "dify.credential.name"):
        assert fields.get(key) == client.logger.info.call_args.kwargs["extra"]["attributes"].get(key)
    return fields


@pytest.mark.parametrize("include_content", [True, False])
@pytest.mark.parametrize("scope", ["model", "provider", "deleted_model", "deleted_provider", "system"])
def test_draft_builder_captures_configured_credential_before_queueing(
    draft_credential_owner: DraftCredentialOwner, sqlite_session: Session, include_content: bool, scope: str
) -> None:
    owner = draft_credential_owner
    provider = sqlite_session.scalar(select(Provider).where(Provider.tenant_id == owner.tenant_id))
    assert provider is not None
    if scope in {"provider", "deleted_provider", "system"}:
        sqlite_session.execute(delete(ProviderModel).where(ProviderModel.tenant_id == owner.tenant_id))
    if scope == "system":
        provider.provider_type = ProviderType.SYSTEM
    elif scope == "deleted_model":
        sqlite_session.execute(
            delete(ProviderModelCredential).where(ProviderModelCredential.id == owner.model_credential_id)
        )
    elif scope == "deleted_provider":
        sqlite_session.execute(delete(ProviderCredential).where(ProviderCredential.id == owner.provider_credential_id))
    sqlite_session.commit()
    queued = capture_draft(owner)
    assert queued is not None
    assert b"ciphertext" not in queued.trace_json
    # Export consumes only the immutable capture, even when credentials are removed after queueing.
    sqlite_session.execute(delete(ProviderModelCredential).where(ProviderModelCredential.tenant_id == owner.tenant_id))
    sqlite_session.execute(delete(ProviderCredential).where(ProviderCredential.tenant_id == owner.tenant_id))
    sqlite_session.commit()
    fields = export_draft(queued, include_content=include_content)
    if scope == "system":
        assert "dify.credential.id" not in fields
        assert "dify.credential.name" not in fields
    else:
        credential_scope = "provider" if "provider" in scope else "model"
        assert fields["dify.credential.id"] == (
            owner.provider_credential_id if credential_scope == "provider" else owner.model_credential_id
        )
        assert fields["dify.credential.name"] == (
            "" if scope.startswith("deleted") else f"first {credential_scope} key"
        )
    if not include_content:
        assert "private" not in str(fields)


@pytest.mark.parametrize(
    ("credential_scope", "scope"),
    [
        ("provider", "tenant"),
        ("provider", "provider"),
        ("model", "tenant"),
        ("model", "provider"),
        ("model", "model"),
        ("model", "model_type"),
    ],
)
def test_draft_credential_name_requires_complete_owner_scope(
    draft_credential_owner: DraftCredentialOwner, sqlite_session: Session, scope: str, credential_scope: str
) -> None:
    owner = draft_credential_owner
    other = create_draft_credential_owner(sqlite_session, "second")
    if credential_scope == "provider":
        sqlite_session.execute(delete(ProviderModel).where(ProviderModel.tenant_id == owner.tenant_id))
        credential = sqlite_session.get(ProviderCredential, owner.provider_credential_id)
    else:
        credential = sqlite_session.get(ProviderModelCredential, owner.model_credential_id)
    assert credential is not None
    if scope == "tenant":
        credential.tenant_id = other.tenant_id
    elif scope == "provider":
        credential.provider_name = "other_provider"
    elif isinstance(credential, ProviderModelCredential):
        if scope == "model":
            credential.model_name = "other_model"
        else:
            credential.model_type = ModelType.TEXT_EMBEDDING
    sqlite_session.commit()
    queued = capture_draft(owner)
    assert queued is not None
    fields = export_draft(queued, include_content=True)
    assert fields["dify.credential.id"] == (
        owner.provider_credential_id if credential_scope == "provider" else owner.model_credential_id
    )
    assert fields["dify.credential.name"] == ""


@pytest.mark.parametrize("app_destination", [False, True])
def test_draft_without_enterprise_destination_does_not_read_credentials(
    draft_credential_owner: DraftCredentialOwner, monkeypatch: pytest.MonkeyPatch, app_destination: bool
) -> None:
    monkeypatch.setattr(
        trace_source,
        "get_trace_provider_settings",
        lambda tenant_id, app_id: (
            (
                TraceProviderSettings(
                    tenant_id=tenant_id, app_id=app_id, provider_name="example", config_id=str(uuid4())
                ),
            )
            if app_destination
            else ()
        ),
    )
    lookup = Mock(side_effect=AssertionError("Credential lookup must be skipped"))
    monkeypatch.setattr(operation_trace, "_read_draft_model_credential", lookup)
    assert capture_draft(draft_credential_owner) is None
    lookup.assert_not_called()


@pytest.mark.parametrize("owner_field", ["app_id", "workflow_id"])
def test_draft_rejects_another_tenants_owner_before_reading_credentials(
    draft_credential_owner: DraftCredentialOwner,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    owner_field: str,
) -> None:
    other = create_draft_credential_owner(sqlite_session, "second")
    lookup = Mock(side_effect=AssertionError("Credential lookup must follow owner validation"))
    monkeypatch.setattr(operation_trace, "_read_draft_model_credential", lookup)
    other_owner_id = other.app_id if owner_field == "app_id" else other.workflow_id
    mismatched = replace(draft_credential_owner, **{owner_field: other_owner_id})
    with pytest.raises(ValueError, match="Trace workflow not found"):
        capture_draft(mismatched)
    lookup.assert_not_called()


def test_concurrent_drafts_keep_tenants_users_and_credentials_separate(
    draft_credential_owner: DraftCredentialOwner, sqlite_session: Session
) -> None:
    owners = (draft_credential_owner, create_draft_credential_owner(sqlite_session, "second"))

    def run(owner: DraftCredentialOwner) -> tuple[CompletedTrace, dict[str, str]]:
        queued = capture_draft(owner)
        assert queued is not None
        return CompletedTrace.model_validate_json(queued.trace_json), export_draft(queued, include_content=True)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(run, owners))
    for owner, (trace, fields) in zip(owners, results, strict=True):
        assert trace.source.tenant_id == owner.tenant_id
        assert trace.source.actor_id == owner.user_id
        assert trace.source.app_id == owner.app_id
        assert fields["dify.credential.id"] == owner.model_credential_id
        assert fields["dify.credential.name"] == f"{owner.name} model key"
        assert fields["gen_ai.user.id"] == owner.user_id
        assert json.loads(fields["dify.node.inputs"]) == {"query": f"{owner.name} private query"}
