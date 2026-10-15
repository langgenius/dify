"""Published metadata must not expose editable Soul/configuration internals."""

from dataclasses import asdict
from uuid import uuid4

import pytest

from models.agent import Agent, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig


def test_projection_is_published_and_output_contract_is_honest():
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    agent = Agent(id=str(uuid4()), tenant_id=str(uuid4()), name="Risk reviewer", description="EDITABLE DRAFT SECRET")
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()),
        agent_id=agent.id,
        tenant_id=agent.tenant_id,
        version=3,
        summary="Review risk evidence",
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "app_variables": [{"name": "report", "type": "string", "required": True, "default": "PRIVATE DEFAULT"}],
                "prompt": {"system": "PRIVATE SYSTEM"},
                "env": {"variables": [{"name": "PRIVATE_ENV", "value": "PRIVATE VALUE"}]},
            }
        ),
    )
    candidate = project_published_agent(agent=agent, snapshot=snapshot)
    assert candidate.snapshot_id == snapshot.id
    assert candidate.display_version == 3
    assert candidate.description == "Review risk evidence"
    assert candidate.input_schema == {"report": {"type": "string", "required": True}}
    assert candidate.output_schema is None
    assert candidate.output_contract_source == "node_job_required"
    assert candidate.input_contract_source == "published_soul.app_variables"
    assert "PRIVATE" not in repr(asdict(candidate))
    assert "EDITABLE" not in repr(asdict(candidate))


def test_projection_rejects_cross_owner_snapshot():
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    agent = Agent(id=str(uuid4()), tenant_id=str(uuid4()), name="Reviewer")
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()), tenant_id=str(uuid4()), agent_id=agent.id, version=1, config_snapshot=AgentSoulConfig()
    )
    with pytest.raises(ValueError, match="owner"):
        project_published_agent(agent=agent, snapshot=snapshot)


def test_catalog_source_failure_is_not_an_empty_catalog(monkeypatch, sqlite_session):
    from services.agent import access_service
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService

    monkeypatch.setattr(access_service, "require_builder_agent_access", lambda **_kwargs: None)
    monkeypatch.setattr(
        access_service,
        "resolve_current_agent_access_filter",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )
    with pytest.raises(RuntimeError, match="unavailable"):
        AgentCatalogService(sqlite_session).list_candidates(
            tenant_id=str(uuid4()), actor_id=str(uuid4()), app_id=str(uuid4()), query=None
        )


def test_selected_agent_uses_existing_resource_option_and_fresh_binding(monkeypatch):
    from services.dify_builder.agent import build, resources
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    agent = Agent(id=str(uuid4()), tenant_id=str(uuid4()), name="Risk reviewer")
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()),
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        version=1,
        summary="Risk review",
        config_snapshot=AgentSoulConfig(),
    )
    item = project_published_agent(agent=agent, snapshot=snapshot)
    ref = resources.ResourceRef(id=item.resource_id, label=item.name)
    inv = resources.TenantResources(models=[], datasets=[], tools=[], agents=[ref])
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    monkeypatch.setattr(build.llm, "invoke_json", lambda *_args, **_kwargs: {"resource_ids": [item.resource_id]})
    options = build.discover_resources(object(), agent.tenant_id, ["Review risk"])
    assert len(options) == 1
    assert options[0].kind == "agent"
    assert options[0].id == item.resource_id
    assert item.resource_id in build.bind_resources(None, agent.tenant_id, ["Review risk"], [item.resource_id])[0]


def test_changed_agent_selection_cannot_silently_rebind(monkeypatch):
    from services.dify_builder.agent import build, resources
    from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged

    ref = resources.ResourceRef(id="agent:agent-1:snapshot-4:" + "a" * 64, label="Reviewer")
    monkeypatch.setattr(
        resources,
        "list_tenant_resources",
        lambda *_args, **_kwargs: resources.TenantResources(models=[], datasets=[], tools=[], agents=[ref]),
    )
    with pytest.raises(AgentSnapshotChanged):
        build.bind_resources(None, "tenant-1", ["Review"], ["agent:agent-1:snapshot-3:" + "a" * 64])


def test_native_catalog_filters_before_pagination(sqlite_session, monkeypatch):
    from configs import dify_config
    from models.account import Tenant
    from models.agent import AgentStatus
    from services.agent import access_service
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService
    from tests.builder_agent_fixtures import add_agent, make_case

    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
    case = make_case(sqlite_session)
    hidden, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Hidden")
    unpublished, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Unpublished", published=False)
    archived, _ = add_agent(
        sqlite_session, tenant_id=case.actor.tenant_id, name="Archived", status=AgentStatus.ARCHIVED
    )
    other = Tenant(name="Other workspace")
    sqlite_session.add(other)
    sqlite_session.flush()
    other_agent, _ = add_agent(sqlite_session, tenant_id=other.id, name="Other tenant")
    monkeypatch.setattr(
        access_service,
        "resolve_current_agent_access_filter",
        lambda **_kwargs: access_service.AgentAccessFilter(
            accessible_agent_ids={case.agent.id, unpublished.id, archived.id, other_agent.id}
        ),
    )
    result = AgentCatalogService(sqlite_session).list_candidates(
        tenant_id=case.actor.tenant_id, actor_id=case.actor.account_id, app_id=case.workflow.app_id, query=None, limit=1
    )
    assert [item.agent_id for item in result] == [case.agent.id]
    unpaginated = AgentCatalogService(sqlite_session).list_candidates(
        tenant_id=case.actor.tenant_id, actor_id=case.actor.account_id, app_id=case.workflow.app_id, query=None
    )
    assert [item.agent_id for item in unpaginated] == [case.agent.id]


def test_missing_tool_credentials_remain_discoverable_with_setup_status(sqlite_session, monkeypatch):
    from configs import dify_config
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService
    from tests.builder_agent_fixtures import make_case

    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
    case = make_case(sqlite_session)
    candidates = AgentCatalogService(sqlite_session).list_candidates(
        tenant_id=case.actor.tenant_id, actor_id=case.actor.account_id, app_id=case.workflow.app_id, query=None
    )
    assert len(candidates) == 1
    assert candidates[0].readiness == "missing_config"
    assert candidates[0].dependencies == ("model:model-plugin/provider/test-model", "tool:plugin/provider/read")
