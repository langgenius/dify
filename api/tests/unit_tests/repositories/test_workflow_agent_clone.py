"""Inline clones consume detached source rows and share the workflow transaction."""

from unittest.mock import Mock

import pytest
from sqlalchemy import Select, event, select
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from extensions.application_services.agent_bindings import build_workflow_agent_service
from models.agent import Agent, AgentConfigRevision, AgentConfigSnapshot, AgentScope, AgentSource
from models.agent_config_entities import AgentConfigSkillRefConfig, AgentSoulConfig
from models.model import App, AppModelConfig
from repositories.agent.workflow_binding_repository import workflow_binding_scope
from services.agent.dsl_service import AgentDslService
from tests.unit_tests.model_factories import make_workflow


@pytest.mark.parametrize("rollback", [False, True])
def test_clone_uses_loaded_source_and_commits_all_resources_together(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, rollback: bool
) -> None:
    soul = AgentSoulConfig(config_skills=[AgentConfigSkillRefConfig(name="summarize", file_id="skill-file")])
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                Agent(
                    id="source",
                    tenant_id="tenant-1",
                    name="Source",
                    description="About",
                    role="Writer",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                ),
                AgentConfigSnapshot(
                    id="soul", tenant_id="tenant-1", agent_id="source", version=1, config_snapshot=soul
                ),
            ]
        )
    monkeypatch.setattr(AgentDslService, "__init__", Mock(side_effect=AssertionError("clone reentered DSL service")))
    reads: list[str] = []

    def read(state: ORMExecuteState) -> None:
        if isinstance(state.statement, Select):
            reads.append(str(state.statement.compile(compile_kwargs={"literal_binds": True})))

    with sqlite_session_factory() as session:
        event.listen(session, "do_orm_execute", read)
        agent, snapshot_id = build_workflow_agent_service(session)._clone_inline_graph_binding_for_node(
            draft_workflow=workflow_binding_scope(make_workflow()),
            node_id="pasted",
            source_agent_id="source",
            source_snapshot_id="soul",
            account_id="account-1",
        )
        # Only the two initial owned reads reference the source. No adapter reloads it.
        assert len([sql for sql in reads if "'source'" in sql]) == 2
        assert agent.id != "source"
        assert agent.metadata.name == "Source"
        assert agent.metadata.description == "About"
        assert agent.metadata.role == "Writer"
        event.remove(session, "do_orm_execute", read)
        if rollback:
            session.rollback()
        else:
            session.commit()
    with sqlite_session_factory() as session:
        cloned = session.get(Agent, agent.id)
        snapshot = session.get(AgentConfigSnapshot, snapshot_id)
        revisions = list(session.scalars(select(AgentConfigRevision).where(AgentConfigRevision.agent_id == agent.id)))
        apps = list(session.scalars(select(App)))
        configs = list(session.scalars(select(AppModelConfig)))
        if rollback:
            assert cloned is None
            assert snapshot is None
            assert not revisions
            assert not apps
            assert not configs
        else:
            assert cloned is not None
            assert snapshot is not None
            assert snapshot.config_snapshot_dict == soul.model_dump(mode="json")
            assert cloned.active_config_snapshot_id == snapshot.id
            assert len(revisions) == len(apps) == len(configs) == 1
            assert cloned.backing_app_id == apps[0].id
            assert apps[0].app_model_config_id == configs[0].id
