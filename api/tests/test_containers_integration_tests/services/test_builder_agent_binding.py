"""Normal-CI PostgreSQL evidence for native catalog and atomic draft bindings.

No models/tools/credentials/runtime backends are invoked by these tests.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from psycopg2 import Error as Psycopg2Error
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.account import Tenant
from models.agent import Agent, AgentConfigSnapshot, AgentStatus, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.workflow import Workflow
from services.agent import access_service
from services.dify_builder.native_testing.agent_binding import (
    AgentBindingSelection,
    AgentBindingService,
)
from services.dify_builder.native_testing.agent_catalog import AgentCatalogService, project_published_agent
from tests.builder_agent_fixtures import add_agent
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import NativeOwner
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414 - shared fixture
)

type BindingCase = tuple[sessionmaker[Session], Actor, str, AgentBindingSelection]


@pytest.fixture
def binding_case(native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch) -> BindingCase:
    from configs import dify_config

    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
    factory, actor, app, workflow, *_ = native_owner
    with factory.begin() as session:
        agent, snapshot = add_agent(session, tenant_id=actor.tenant_id, name="Published reviewer")
        candidate = project_published_agent(agent=agent, snapshot=snapshot)
        selection = AgentBindingSelection(
            agent_id=agent.id, snapshot_id=snapshot.id, capability_digest=candidate.capability_digest
        )
    return factory, actor, workflow.id, selection


def test_real_catalog_filters_publication_tenant_and_actor_before_pagination(
    binding_case: BindingCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, workflow_id, selection = binding_case
    with factory.begin() as session:
        workflow = require_instance(session.get(Workflow, workflow_id), Workflow)
        unpublished, _ = add_agent(session, tenant_id=actor.tenant_id, name="Unpublished", published=False)
        archived, _ = add_agent(session, tenant_id=actor.tenant_id, name="Archived", status=AgentStatus.ARCHIVED)
        hidden, _ = add_agent(session, tenant_id=actor.tenant_id, name="Actor inaccessible")
        model_less, _ = add_agent(session, tenant_id=actor.tenant_id, name="No model")
        model_less.active_config_has_model = False
        other = Tenant(name="Other tenant")
        session.add(other)
        session.flush()
        other_agent, _ = add_agent(session, tenant_id=other.id, name="Other tenant Agent")
        monkeypatch.setattr(
            access_service,
            "resolve_current_agent_access_filter",
            lambda **_kwargs: access_service.AgentAccessFilter(
                accessible_agent_ids={selection.agent_id, model_less.id, unpublished.id, archived.id, other_agent.id}
            ),
        )
        result = AgentCatalogService(session).list_candidates(
            tenant_id=actor.tenant_id,
            actor_id=actor.account_id,
            app_id=require_instance(workflow, Workflow).app_id,
            query=None,
            limit=1,
        )
        assert [candidate.agent_id for candidate in result] == [selection.agent_id]
        unpaginated = AgentCatalogService(session).list_candidates(
            tenant_id=actor.tenant_id,
            actor_id=actor.account_id,
            app_id=require_instance(workflow, Workflow).app_id,
            query=None,
        )
        assert [candidate.agent_id for candidate in unpaginated] == [selection.agent_id]
        assert result[0].output_schema is None
        assert result[0].dependencies == ("model:model-plugin/provider/test-model", "tool:plugin/provider/read")
        assert "HIDDEN" not in repr(result)


def test_draft_graph_and_native_binding_rollback_together(binding_case: BindingCase) -> None:
    factory, actor, workflow_id, selection = binding_case
    with factory() as session:
        assert session is not None
        original_graph = require_instance(session.get(Workflow, workflow_id), Workflow).graph

    class AbortError(Exception):
        pass

    with pytest.raises(AbortError):  # noqa: PT012 - verify transaction rollback on abort
        with factory.begin() as session:
            workflow = require_instance(session.get(Workflow, workflow_id), Workflow)
            service = AgentBindingService(session)
            data = service.prepare_node(
                actor=actor,
                workflow=workflow,
                node_id="review",
                selection=selection,
                node_job=WorkflowNodeJobConfig(declared_outputs=[{"name": "summary", "type": "string"}]),
            )
            assert workflow is not None
            graph = workflow.graph_dict
            graph["nodes"].append({"id": "review", "data": data})
            assert workflow is not None
            workflow.graph = json.dumps(graph)
            service.sync_prepared_bindings(actor=actor, workflow=workflow, selections={"review": selection})
            assert session.scalar(
                select(WorkflowAgentNodeBinding.id).where(WorkflowAgentNodeBinding.workflow_id == workflow_id)
            )
            raise AbortError()
    with factory() as session:
        assert session is not None
        assert require_instance(session.get(Workflow, workflow_id), Workflow).graph == original_graph
        assert (
            session.scalar(
                select(WorkflowAgentNodeBinding.id).where(WorkflowAgentNodeBinding.workflow_id == workflow_id)
            )
            is None
        )


def test_publication_pointer_cannot_change_between_prepare_and_native_sync(binding_case: BindingCase) -> None:
    factory, actor, workflow_id, selection = binding_case
    with factory.begin() as session:
        old = require_instance(session.get(AgentConfigSnapshot, selection.snapshot_id), AgentConfigSnapshot)
        assert old is not None
        replacement = AgentConfigSnapshot(
            tenant_id=actor.tenant_id, agent_id=selection.agent_id, version=2, config_snapshot=old.config_snapshot
        )
        session.add(replacement)
        session.flush()
        replacement_id = replacement.id
    entered = Event()

    def publish_while_locked() -> None:
        with factory.begin() as session:
            session.execute(text("SET LOCAL lock_timeout = '150ms'"))
            entered.set()
            session.execute(
                update(Agent)
                .where(Agent.id == selection.agent_id, Agent.tenant_id == actor.tenant_id)
                .values(active_config_snapshot_id=replacement_id)
            )

    with factory.begin() as session:
        workflow = require_instance(session.get(Workflow, workflow_id), Workflow)
        service = AgentBindingService(session)
        data = service.prepare_node(
            actor=actor, workflow=workflow, node_id="review", selection=selection, node_job=WorkflowNodeJobConfig()
        )
        with ThreadPoolExecutor(max_workers=1) as pool:
            attempted = pool.submit(publish_while_locked)
            assert entered.wait(timeout=5)
            with pytest.raises(DBAPIError) as error:
                attempted.result(timeout=5)
            assert isinstance(error.value.orig, Psycopg2Error)
            assert error.value.orig.pgcode == "55P03"
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"].append({"id": "review", "data": data})
        assert workflow is not None
        workflow.graph = json.dumps(graph)
        service.sync_prepared_bindings(actor=actor, workflow=workflow, selections={"review": selection})
    with factory() as session:
        assert session is not None
        assert (
            require_instance(session.get(Agent, selection.agent_id), Agent).active_config_snapshot_id
            == selection.snapshot_id
        )
        binding = session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == workflow_id)
        )
        assert binding is not None
        assert binding.current_snapshot_id == selection.snapshot_id
