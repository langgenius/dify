"""Admitted Console transport contracts over real application services/SQLite.

Five-role cookie/CSRF admission is covered by real dev acceptance. These unit
tests deliberately enter the resource's unwrapped admitted handler so real SQL
scope, domain failures, response projection and wire statuses remain observable.
No service result or remote Task receipt is injected.
"""

from __future__ import annotations

import inspect
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Protocol, runtime_checkable
from uuid import UUID, uuid4

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import TypeAdapter
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.console.agent.external import (
    ExternalAgentApi,
    ExternalAgentConnectionApi,
    ExternalAgentEnabledApi,
    ExternalAgentInfoApi,
    ExternalAgentOperationApi,
    ExternalAgentReferencesApi,
    ExternalAgentsApi,
    ExternalAgentTracingApi,
    ExternalAgentVerifyApi,
)
from controllers.console.agent.external_observability import (
    AppExternalAgentTraceCaptureApi,
    ExternalAgentInvocationTraceApi,
    ExternalAgentInvocationTraceRawApi,
    ExternalAgentMonitoringApi,
    ExternalAgentTraceDeliveriesApi,
    ExternalAgentTraceDeliveryRetryApi,
    ExternalAgentTracingConfigApi,
)
from extensions.ext_application_services import ApplicationServices
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentKind, AgentScope, AgentSource, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.external_agent import ExternalAgentConnectionRevision, ExternalAgentHead, ExternalAgentInvocation
from models.model import App, AppMode, IconType
from models.workflow import Workflow, WorkflowType
from repositories.external_agents.asset_repository import ExternalAssetRepository
from repositories.tag_repository import TagRepository
from services.external_agents.contracts import VerificationEvidence
from services.tag_application_service import CreateTagInput, TagBindingInput
from tests.helpers.unit.model_factories import make_app, make_upload_file


@runtime_checkable
class AdmittedHandler(Protocol):
    def __call__(self, resource: Resource, context: RequestContext, **path: object) -> object: ...


def wire(value: object) -> dict[str, object]:
    """Validate dynamic transport output at the Python/JSON mapping boundary."""
    return TypeAdapter(dict[str, object]).validate_python(value)


type EndpointDomain = tuple[Flask, RequestContext, str, ApplicationServices, sessionmaker[Session]]


@pytest.fixture
def endpoint_domain(
    sqlite_session_factory: sessionmaker[Session], account_application_services: ApplicationServices
) -> EndpointDomain:
    """Persist a real Owner/asset/revision and wire the existing composition root."""
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Endpoint workspace")
        account = Account(name="Owner", email="endpoint-owner@example.test")
        session.add_all((tenant, account))
        session.flush()
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER))
        agent = Agent(
            tenant_id=tenant.id,
            name="Endpoint asset",
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            agent_kind=AgentKind.EXTERNAL_A2A,
            created_by=account.id,
            updated_by=account.id,
        )
        session.add(agent)
        session.flush()
        revision = str(uuid4())
        session.add(
            ExternalAgentConnectionRevision(
                id=revision,
                tenant_id=tenant.id,
                agent_id=agent.id,
                endpoint="https://example.test",
                interface_url="https://example.test/a2a",
                auth_type="bearer",
                credential_ciphertext="opaque-encrypted-value",
                agent_card={"name": "Service", "description": "Declared", "metadata": {"private": "not-public"}},
                capabilities={"streaming": False},
                fingerprint="a" * 64,
                auth_check="not_exercised",
                created_by=account.id,
                verified_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        session.add(ExternalAgentHead(agent_id=agent.id, tenant_id=tenant.id, active_connection_revision_id=revision))
        context = RequestContext("endpoint", None, account.id, tenant.id)
        identifier = agent.id
    services = replace(
        account_application_services,
        external_agents=replace(account_application_services.external_agents, enabled=True),
    )
    app = Flask(__name__)
    app.extensions["application_services"] = services
    return app, context, identifier, services, sqlite_session_factory


def invoke(
    domain: EndpointDomain,
    resource: type[Resource],
    method: str,
    *,
    query: str = "",
    body: dict[str, object] | None = None,
    context: RequestContext | None = None,
    **path: object,
) -> object:
    """Call a real admitted method inside an actual Flask request context."""
    app, admitted, _, _, _ = domain
    raw_handler = inspect.unwrap(vars(resource)[method])
    assert isinstance(raw_handler, AdmittedHandler)
    handler = raw_handler
    with app.test_request_context("/" + query, method=method.upper(), json=body):
        return handler(resource(), context or admitted, **path)


def test_roster_detail_and_reference_wire_projection_never_exposes_ciphertext(endpoint_domain: EndpointDomain) -> None:
    """Real list/detail/refs use the same asset while exposing only public fields."""
    _, _, identifier, _, _ = endpoint_domain
    listing = wire(invoke(endpoint_domain, ExternalAgentsApi, "get", query="?page=1&limit=20&keyword=Endpoint"))
    assert listing["total"] == 1
    detail = wire(invoke(endpoint_domain, ExternalAgentApi, "get", agent_id=UUID(identifier)))
    assert wire(detail["asset"])["id"] == identifier
    assert wire(detail["connection"])["has_credential"] is True
    assert "credential_ciphertext" not in str(detail)
    assert "opaque-encrypted-value" not in str(detail)
    assert "metadata" not in wire(wire(detail["connection"])["card"])
    references = invoke(endpoint_domain, ExternalAgentReferencesApi, "get", agent_id=UUID(identifier))
    assert references == {"apps": [], "may_have_in_flight": False}


def test_reference_http_contract_returns_latest_app_icons_and_refreshable_image_urls(
    endpoint_domain: EndpointDomain,
) -> None:
    """Actual JSON GETs preserve App icon protocol through SQL, service and response projection."""
    app, context, agent_id, _, sessions = endpoint_domain
    app_id, workflow_id, file_id = (str(uuid4()) for _ in range(3))
    with sessions.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=context.active_workspace_id,
                mode=AppMode.WORKFLOW,
                icon_type=IconType.EMOJI,
                icon="🔎",
                icon_background="#FFF2CC",
            )
        )
        session.add(
            make_upload_file(
                file_id=file_id,
                tenant_id=context.active_workspace_id,
                created_by=context.account_id,
                name="app.png",
                extension="png",
                mime_type="image/png",
            )
        )
        session.add(
            Workflow(
                id=workflow_id,
                tenant_id=context.active_workspace_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT,
                graph="{}",
                _features="{}",
                created_by=context.account_id,
            )
        )
        for node_id in ("node-1", "node-2"):
            session.add(
                WorkflowAgentNodeBinding(
                    tenant_id=context.active_workspace_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    workflow_version=Workflow.VERSION_DRAFT,
                    node_id=node_id,
                    agent_id=agent_id,
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    node_job_config=WorkflowNodeJobConfig(),
                )
            )
    handler = inspect.unwrap(vars(ExternalAgentReferencesApi)["get"])
    assert isinstance(handler, AdmittedHandler)

    def references_get(agent_id: UUID) -> dict[str, object]:
        """Exercise the admitted handler through Flask's real HTTP/JSON adapter."""
        return wire(handler(ExternalAgentReferencesApi(), context, agent_id=agent_id))

    app.add_url_rule(
        "/external-agents/<uuid:agent_id>/references",
        view_func=references_get,
    )
    client = app.test_client()
    path = f"/external-agents/{agent_id}/references"
    response = client.get(path)
    assert response.status_code == 200
    row = response.get_json()["apps"][0]
    assert row == {
        "app_id": app_id,
        "name": "Test App",
        "mode": "workflow",
        "node_ids": ["node-1", "node-2"],
        "icon_type": "emoji",
        "icon": "🔎",
        "icon_background": "#FFF2CC",
        "icon_url": None,
    }
    with sessions.begin() as session:
        stored_app = session.get(App, app_id)
        assert stored_app is not None
        stored_app.icon_type, stored_app.icon = IconType.IMAGE, file_id
    image = client.get(path)
    assert image.status_code == 200
    row = image.get_json()["apps"][0]
    assert row["icon_type"] == "image"
    assert row["icon"] == file_id
    assert isinstance(row["icon_url"], str)
    assert file_id in row["icon_url"]
    assert client.get(path).get_json()["apps"][0]["icon_url"] != row["icon_url"]


def test_external_list_http_preserves_repeated_uuid_tags_and_current_labels(endpoint_domain: EndpointDomain) -> None:
    """Actual HTTP query decoding requires all tags before counters and serializes current labels/ACLs."""
    app, context, identifier, _, sessions = endpoint_domain
    tags = TagRepository(sessions)
    first = tags.create_tag(context.active_workspace_id, context.account_id, CreateTagInput("Shared A", "agent"))
    second = tags.create_tag(context.active_workspace_id, context.account_id, CreateTagInput("Shared B", "agent"))
    tags.create_bindings(
        context.active_workspace_id, context.account_id, TagBindingInput((first.id,), identifier, "agent")
    )
    handler = inspect.unwrap(vars(ExternalAgentsApi)["get"])
    assert isinstance(handler, AdmittedHandler)
    app.add_url_rule("/external-agents", view_func=lambda: wire(handler(ExternalAgentsApi(), context)))
    client = app.test_client()
    path = f"/external-agents?tag_ids={first.id}&tag_ids={second.id}"
    missing = client.get(path)
    assert missing.status_code == 200
    assert missing.get_json()["total"] == missing.get_json()["enabled_count"] == 0
    tags.create_bindings(
        context.active_workspace_id, context.account_id, TagBindingInput((second.id,), identifier, "agent")
    )
    matched = client.get(path)
    assert matched.status_code == 200
    body = matched.get_json()
    assert body["total"] == body["enabled_count"] == 1
    assert body["disabled_count"] == 0
    assert body["items"][0]["tags"] == [
        {"id": first.id, "name": "Shared A", "type": "agent"},
        {"id": second.id, "name": "Shared B", "type": "agent"},
    ]
    assert "agent.acl.edit" in body["items"][0]["permission_keys"]
    assert client.get(f"/external-agents?tag_ids={first.id}&tag_ids={first.id}").get_json()["total"] == 1


def test_connection_conflict_reload_exposes_the_current_saver_and_save_time(endpoint_domain: EndpointDomain) -> None:
    """Actual Save/CAS/detail serialization distinguish editor, verifier and unrelated asset changes."""
    _, original, identifier, _, sessions = endpoint_domain
    before = wire(invoke(endpoint_domain, ExternalAgentApi, "get", agent_id=UUID(identifier)))
    original_connection = wire(before["connection"])
    assert wire(original_connection["saved_by"]) == {"id": original.account_id, "name": "Owner"}
    with sessions.begin() as session:
        member = Account(name="Latest connection saver", email="latest-saver@example.test")
        session.add(member)
        session.flush()
        editor = original._replace(account_id=member.id)
        session.add(
            TenantAccountJoin(
                tenant_id=original.active_workspace_id, account_id=member.id, role=TenantAccountRole.ADMIN
            )
        )
    previous = original_connection["revision_id"]
    assert isinstance(previous, str)
    verified_at = datetime.now(UTC) - timedelta(minutes=2)
    repo = ExternalAssetRepository(session_factory=sessions)
    proof = VerificationEvidence(
        id=str(uuid4()),
        tenant_id=original.active_workspace_id,
        actor_id=editor.account_id,
        agent_id=identifier,
        endpoint="https://new-connection.example.test",
        interface_url="https://new-connection.example.test/a2a",
        auth_type="none",
        credential_ciphertext=None,
        auth_check="not_exercised",
        card={"name": "Service", "description": "Declared"},
        capabilities={"streaming": False},
        fingerprint="b" * 64,
        expected_connection_revision_id=previous,
        created_at=verified_at,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    stale_proof = replace(proof, id=str(uuid4()), actor_id=original.account_id, fingerprint="c" * 64)
    repo.save_verification(proof)
    repo.save_verification(stale_proof)
    invoke(
        endpoint_domain,
        ExternalAgentConnectionApi,
        "put",
        context=editor,
        agent_id=UUID(identifier),
        body={"verification_id": proof.id, "expected_revision_id": previous, "idempotency_key": "new-save"},
    )
    with pytest.raises(Conflict):
        invoke(
            endpoint_domain,
            ExternalAgentConnectionApi,
            "put",
            agent_id=UUID(identifier),
            body={
                "verification_id": stale_proof.id,
                "expected_revision_id": previous,
                "idempotency_key": "stale-save",
            },
        )
    detail = wire(invoke(endpoint_domain, ExternalAgentApi, "get", agent_id=UUID(identifier)))
    connection = wire(detail["connection"])
    assert connection["revision_id"] != previous
    assert wire(connection["saved_by"]) == {"id": editor.account_id, "name": "Latest connection saver"}
    assert "email" not in wire(connection["saved_by"])
    assert TypeAdapter(datetime).validate_python(connection["verified_at"]) == verified_at
    assert TypeAdapter(datetime).validate_python(connection["saved_at"]) > verified_at
    assert wire(detail["asset"])["created_by"] == original.account_id
    invoke(
        endpoint_domain,
        ExternalAgentInfoApi,
        "patch",
        agent_id=UUID(identifier),
        body={
            "expected_revision": wire(detail["asset"])["metadata_revision"],
            "changes": {"description": "Later profile edit", "icon_type": "emoji", "icon": "robot"},
        },
    )
    invoke(endpoint_domain, ExternalAgentEnabledApi, "put", agent_id=UUID(identifier), body={"enabled": False})
    reloaded = wire(wire(invoke(endpoint_domain, ExternalAgentApi, "get", agent_id=UUID(identifier)))["connection"])
    assert reloaded["saved_by"] == connection["saved_by"]
    assert reloaded["saved_at"] == connection["saved_at"]


def test_display_edit_switch_and_delete_keep_real_domain_statuses(endpoint_domain: EndpointDomain) -> None:
    """PATCH persists only local info; disabled/new state and 204 deletion are exact."""
    _, _, identifier, _, _ = endpoint_domain
    before = wire(invoke(endpoint_domain, ExternalAgentApi, "get", agent_id=UUID(identifier)))
    changed = invoke(
        endpoint_domain,
        ExternalAgentInfoApi,
        "patch",
        agent_id=UUID(identifier),
        body={
            "expected_revision": wire(before["asset"])["metadata_revision"],
            "changes": {"description": "", "role": "Reviewer"},
        },
    )
    assert wire(changed)["description"] == ""
    assert wire(changed)["role"] == "Reviewer"
    disabled = invoke(
        endpoint_domain, ExternalAgentEnabledApi, "put", agent_id=UUID(identifier), body={"enabled": False}
    )
    assert wire(disabled)["enabled"] is False
    enabled = invoke(endpoint_domain, ExternalAgentEnabledApi, "put", agent_id=UUID(identifier), body={"enabled": True})
    assert wire(enabled)["enabled"] is True
    assert invoke(endpoint_domain, ExternalAgentApi, "delete", agent_id=UUID(identifier)) == ("", 204)
    with pytest.raises(NotFound):
        invoke(endpoint_domain, ExternalAgentApi, "get", agent_id=UUID(identifier))


def test_unauthorized_detail_and_missing_operation_are_protocol_errors(endpoint_domain: EndpointDomain) -> None:
    """Domain denial/not-found cannot become successful DTOs or leak other resources."""
    _, context, identifier, _, sessions = endpoint_domain
    with sessions.begin() as session:
        membership = session.query(TenantAccountJoin).filter_by(account_id=context.account_id).one()
        membership.role = TenantAccountRole.NORMAL
    with pytest.raises(Forbidden):
        invoke(endpoint_domain, ExternalAgentReferencesApi, "get", agent_id=UUID(identifier))
    with pytest.raises(Forbidden):
        invoke(
            endpoint_domain,
            ExternalAgentInfoApi,
            "patch",
            agent_id=UUID(identifier),
            body={"expected_revision": 1, "changes": {"name": "not allowed"}},
        )
    with sessions.begin() as session:
        membership = session.query(TenantAccountJoin).filter_by(account_id=context.account_id).one()
        membership.role = TenantAccountRole.OWNER
    with pytest.raises(NotFound):
        invoke(endpoint_domain, ExternalAgentOperationApi, "get", operation_id=uuid4())


def test_feature_gate_blocks_create_before_validating_or_dispatching(endpoint_domain: EndpointDomain) -> None:
    """The default-off deployment gate has priority over an otherwise invalid body."""
    app, _, _, services, _ = endpoint_domain
    app.extensions["application_services"] = replace(
        services, external_agents=replace(services.external_agents, enabled=False)
    )
    with pytest.raises(ServiceUnavailable):
        invoke(endpoint_domain, ExternalAgentsApi, "post", body={})


def test_saved_asset_mutation_failures_have_exact_http_error_types(endpoint_domain: EndpointDomain) -> None:
    """A stale revision or unsupported tracing mode cannot be serialized as success."""
    _, _, identifier, _, _ = endpoint_domain
    with pytest.raises(Conflict):
        invoke(
            endpoint_domain,
            ExternalAgentInfoApi,
            "patch",
            agent_id=UUID(identifier),
            body={"expected_revision": 999, "changes": {"name": "stale"}},
        )
    with pytest.raises(BadRequest):
        invoke(
            endpoint_domain,
            ExternalAgentInfoApi,
            "patch",
            agent_id=UUID(identifier),
            body={"expected_revision": 1, "changes": {"unknown": "cannot persist"}},
        )
    with pytest.raises(BadRequest):
        invoke(endpoint_domain, ExternalAgentTracingApi, "put", agent_id=UUID(identifier), body={"enabled": True})
    unchanged = wire(
        invoke(endpoint_domain, ExternalAgentTracingApi, "put", agent_id=UUID(identifier), body={"enabled": False})
    )
    assert unchanged["tracing_enabled"] is False
    with pytest.raises(Conflict):
        invoke(
            endpoint_domain,
            ExternalAgentConnectionApi,
            "put",
            agent_id=UUID(identifier),
            body={
                "verification_id": str(uuid4()),
                "expected_revision_id": str(uuid4()),
                "idempotency_key": "missing-proof",
            },
        )
    with pytest.raises(BadRequest):
        invoke(
            endpoint_domain,
            ExternalAgentsApi,
            "post",
            body={
                "verification_id": str(uuid4()),
                "idempotency_key": "missing-proof",
                "metadata": {"name": "no proof"},
            },
        )


def test_verify_role_rejection_precedes_any_outbound_gateway_call(endpoint_domain: EndpointDomain) -> None:
    """A syntactically valid endpoint is not permission to perform network verification."""
    _, context, _, _, sessions = endpoint_domain
    with sessions.begin() as session:
        row = session.query(TenantAccountJoin).filter_by(account_id=context.account_id).one()
        row.role = TenantAccountRole.NORMAL
    with pytest.raises(Forbidden):
        invoke(
            endpoint_domain,
            ExternalAgentVerifyApi,
            "post",
            body={"endpoint": "https://does-not-exist.invalid", "auth_type": "none", "credential_action": "remove"},
        )


def seed_observation(domain: EndpointDomain) -> UUID:
    """Seed a retained test owner, not a forged incoming protocol receipt."""
    _, context, agent, _, sessions = domain
    identifier = uuid4()
    with sessions.begin() as session:
        session.add(
            ExternalAgentInvocation(
                id=str(identifier),
                tenant_id=context.active_workspace_id,
                agent_id=agent,
                request_key=str(identifier),
                execution_key=str(identifier),
                origin="overview_test",
                initiator_id=context.account_id,
                tracing_enabled=False,
                ended_at=datetime.now(UTC).replace(tzinfo=None),
                local_state="succeeded",
            )
        )
    return identifier


def test_observation_routes_keep_empty_and_missing_data_distinct(endpoint_domain: EndpointDomain) -> None:
    """Trace-off, absent Raw and absent exporter states have separate wire outcomes."""
    _, _, agent, _, _ = endpoint_domain
    identifier = seed_observation(endpoint_domain)
    trace = wire(
        invoke(
            endpoint_domain, ExternalAgentInvocationTraceApi, "get", invocation_id=identifier, query="?limit=1&offset=0"
        )
    )
    assert trace["state"] == "not_requested"
    assert trace["steps"] == []
    assert wire(invoke(endpoint_domain, ExternalAgentTraceDeliveriesApi, "get", invocation_id=identifier)) == {
        "data": []
    }
    with pytest.raises(NotFound):
        invoke(
            endpoint_domain, ExternalAgentInvocationTraceRawApi, "get", invocation_id=identifier, step_key="not-present"
        )
    with pytest.raises(NotFound):
        invoke(
            endpoint_domain,
            ExternalAgentTraceDeliveryRetryApi,
            "post",
            invocation_id=identifier,
            delivery_id=uuid4(),
            body={"acknowledge_possible_duplicates": True},
        )
    config = wire(
        invoke(endpoint_domain, ExternalAgentTracingConfigApi, "get", agent_id=UUID(agent), provider="phoenix")
    )
    assert config == {"configuration": None}


def test_app_bound_capture_status_returns_only_owned_frozen_evidence(endpoint_domain: EndpointDomain) -> None:
    """Actual transport projection validates App identity before exposing frozen target state."""
    _, context, _, _, sessions = endpoint_domain
    identifier = seed_observation(endpoint_domain)
    app_id = uuid4()
    with sessions.begin() as session:
        session.add(make_app(app_id=str(app_id), tenant_id=context.active_workspace_id, created_by=context.account_id))
        invocation = session.get(ExternalAgentInvocation, str(identifier))
        assert invocation is not None
        invocation.app_id = str(app_id)
    result = wire(
        invoke(
            endpoint_domain,
            AppExternalAgentTraceCaptureApi,
            "get",
            app_id=app_id,
            invocation_id=identifier,
        )
    )
    assert result == {"invocation_id": str(identifier), "targets_frozen": False, "targets": []}
    with pytest.raises(NotFound):
        invoke(endpoint_domain, AppExternalAgentTraceCaptureApi, "get", app_id=uuid4(), invocation_id=identifier)


def test_monitoring_transport_omits_app_details_only_for_aggregate_role(endpoint_domain: EndpointDomain) -> None:
    """The same no-call cohort is not zero usage; Normal cannot enumerate App details."""
    _, context, agent, _, sessions = endpoint_domain
    query = "?start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z&timezone=UTC"
    owner = wire(invoke(endpoint_domain, ExternalAgentMonitoringApi, "get", agent_id=UUID(agent), query=query))
    assert wire(owner["summary"])["calls"] == 0
    assert wire(owner["summary"])["reported_tokens"] is None
    assert owner["apps"] == []
    with sessions.begin() as session:
        row = session.query(TenantAccountJoin).filter_by(account_id=context.account_id).one()
        row.role = TenantAccountRole.NORMAL
    normal = wire(invoke(endpoint_domain, ExternalAgentMonitoringApi, "get", agent_id=UUID(agent), query=query))
    assert "apps" not in normal
    assert wire(normal["summary"])["token_reporting_coverage"] is None


def test_tracing_target_transport_refuses_missing_revision_and_invalid_provider(
    endpoint_domain: EndpointDomain,
) -> None:
    """Config CAS and provider validation precede export and never create fake delivery success."""
    _, _, agent, _, _ = endpoint_domain
    with pytest.raises(Conflict):
        invoke(
            endpoint_domain,
            ExternalAgentTracingConfigApi,
            "delete",
            agent_id=UUID(agent),
            provider="phoenix",
            query="?expected_revision=1",
        )
    with pytest.raises(BadRequest):
        invoke(
            endpoint_domain,
            ExternalAgentTracingConfigApi,
            "put",
            agent_id=UUID(agent),
            provider="not-a-provider",
            body={"config": {}, "enabled": False, "capture_content": False, "expected_revision": 0},
        )


def test_trace_raw_endpoint_serializes_only_the_authorized_redacted_step(endpoint_domain: EndpointDomain) -> None:
    """The Raw wire envelope preserves redaction and the requested step identity."""
    _, context, agent, services, sessions = endpoint_domain
    identifier = seed_observation(endpoint_domain)
    with sessions.begin() as session:
        head = session.get(ExternalAgentHead, agent)
        assert head is not None
        revision = session.get(ExternalAgentConnectionRevision, head.active_connection_revision_id)
        assert revision is not None
        revision.auth_type, revision.credential_ciphertext = "none", None
        row = session.get(ExternalAgentInvocation, str(identifier))
        assert row is not None
        row.connection_revision_id, row.tracing_enabled = revision.id, True
        row.dispatched_at = datetime.now(UTC).replace(tzinfo=None)
    snapshot = services.external_agents.observability.record_trace(
        tenant_id=context.active_workspace_id,
        invocation_id=str(identifier),
        source_id="wire-carrier",
        payload={"trace_id": "remote", "steps": [{"step_id": "one", "parameters": {"authorization": "must-redact"}}]},
        received_at=datetime.now(UTC),
    )
    assert len(snapshot.steps) == 1
    raw = wire(
        invoke(
            endpoint_domain,
            ExternalAgentInvocationTraceRawApi,
            "get",
            invocation_id=identifier,
            step_key=snapshot.steps[0].key,
        )
    )
    assert "must-redact" not in str(raw)
    assert wire(wire(raw["data"])["parameters"])["authorization"] == "[redacted]"
