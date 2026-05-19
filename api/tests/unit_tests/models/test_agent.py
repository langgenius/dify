import json

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from models.agent import (
    Agent,
    AgentConfigVersion,
    AgentConfigVersionOperation,
    AgentConfigVersionRevision,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.types import LongText


def test_agent_enums_match_prd_boundaries():
    assert AgentKind.DIFY_AGENT.value == "dify_agent"
    assert AgentScope.ROSTER.value == "roster"
    assert AgentScope.WORKFLOW_ONLY.value == "workflow_only"
    assert AgentSource.AGENT_APP.value == "agent_app"
    assert AgentSource.WORKFLOW.value == "workflow"
    assert AgentStatus.ACTIVE.value == "active"
    assert AgentStatus.ARCHIVED.value == "archived"
    assert AgentConfigVersionOperation.SAVE_CURRENT_VERSION.value == "save_current_version"
    assert WorkflowAgentBindingType.ROSTER_AGENT.value == "roster_agent"
    assert WorkflowAgentBindingType.INLINE_AGENT.value == "inline_agent"


def test_agent_table_uses_db_unique_constraint_for_active_roster_names():
    unique_constraints = {
        constraint.name: tuple(column.name for column in constraint.columns)
        for constraint in Agent.__table__.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    }

    assert unique_constraints["agent_tenant_roster_name_unique"] == ("tenant_id", "roster_unique_name")

    roster_unique_name = Agent.__table__.c.roster_unique_name
    assert roster_unique_name.computed is not None
    computed_sql = str(roster_unique_name.computed.sqltext)
    assert "scope = 'roster'" in computed_sql
    assert "status = 'active'" in computed_sql


def test_active_roster_agent_name_unique_constraint_allows_archived_and_workflow_only_duplicates():
    engine = sa.create_engine("sqlite:///:memory:")
    Agent.__table__.create(engine)
    insert_agent = Agent.__table__.insert()

    with engine.begin() as conn:
        conn.execute(
            insert_agent,
            {
                "id": "agent-1",
                "tenant_id": "tenant-1",
                "name": "Analyst",
                "scope": AgentScope.ROSTER.value,
                "source": AgentSource.WORKFLOW.value,
                "status": AgentStatus.ACTIVE.value,
            },
        )
        conn.execute(
            insert_agent,
            {
                "id": "agent-2",
                "tenant_id": "tenant-1",
                "name": "Analyst",
                "scope": AgentScope.ROSTER.value,
                "source": AgentSource.WORKFLOW.value,
                "status": AgentStatus.ARCHIVED.value,
            },
        )
        conn.execute(
            insert_agent,
            {
                "id": "agent-3",
                "tenant_id": "tenant-1",
                "name": "Analyst",
                "scope": AgentScope.WORKFLOW_ONLY.value,
                "source": AgentSource.WORKFLOW.value,
                "status": AgentStatus.ACTIVE.value,
            },
        )

        with pytest.raises(IntegrityError):
            conn.execute(
                insert_agent,
                {
                    "id": "agent-4",
                    "tenant_id": "tenant-1",
                    "name": "Analyst",
                    "scope": AgentScope.ROSTER.value,
                    "source": AgentSource.WORKFLOW.value,
                    "status": AgentStatus.ACTIVE.value,
                },
            )


def test_agent_config_version_stores_agent_soul_snapshot_as_long_text_json():
    config_snapshot = {
        "schema_version": 1,
        "prompt": {"system_prompt": "You are a proposal analysis agent."},
        "env": {"secret_refs": [{"provider_credential_id": "cred-1"}]},
    }
    version = AgentConfigVersion(
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=json.dumps(config_snapshot),
    )

    config_snapshot_column = AgentConfigVersion.__table__.c.config_snapshot
    assert isinstance(config_snapshot_column.type, LongText)
    assert config_snapshot_column.server_default is None
    assert version.config_snapshot_dict == config_snapshot
    assert version.config_snapshot_dict["env"]["secret_refs"][0]["provider_credential_id"] == "cred-1"


def test_workflow_binding_stores_node_job_config_separately_from_agent_soul():
    node_job_config = {
        "schema_version": 1,
        "workflow_prompt": "Review the bid and identify clarification questions.",
        "previous_node_output_refs": [{"node_id": "start", "output": "rfp"}],
        "declared_outputs": [{"name": "questions", "type": "array"}],
    }
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="agent-node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        agent_config_version_id="version-1",
        node_job_config=json.dumps(node_job_config),
    )

    node_job_config_column = WorkflowAgentNodeBinding.__table__.c.node_job_config
    assert isinstance(node_job_config_column.type, LongText)
    assert node_job_config_column.server_default is None
    assert binding.node_job_config_dict == node_job_config
    assert "prompt" not in binding.node_job_config_dict


def test_long_text_columns_do_not_use_mysql_incompatible_server_defaults():
    for column in (
        Agent.__table__.c.description,
        AgentConfigVersion.__table__.c.config_snapshot,
        AgentConfigVersionRevision.__table__.c.config_snapshot,
        AgentConfigVersionRevision.__table__.c.previous_config_snapshot,
        WorkflowAgentNodeBinding.__table__.c.node_job_config,
    ):
        assert isinstance(column.type, LongText)
        assert column.server_default is None


def test_agent_config_version_revision_records_audit_snapshot():
    snapshot = {"schema_version": 1, "prompt": {"system_prompt": "new"}}
    previous_snapshot = {"schema_version": 1, "prompt": {"system_prompt": "old"}}
    revision = AgentConfigVersionRevision(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_version_id="version-1",
        revision=2,
        operation=AgentConfigVersionOperation.SAVE_CURRENT_VERSION,
        config_snapshot=json.dumps(snapshot),
        previous_config_snapshot=json.dumps(previous_snapshot),
    )

    unique_constraints = {
        constraint.name: tuple(column.name for column in constraint.columns)
        for constraint in AgentConfigVersionRevision.__table__.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    }

    assert unique_constraints["agent_config_version_revision_version_revision_unique"] == (
        "agent_config_version_id",
        "revision",
    )
    assert revision.config_snapshot_dict == snapshot
    assert revision.previous_config_snapshot_dict == previous_snapshot
