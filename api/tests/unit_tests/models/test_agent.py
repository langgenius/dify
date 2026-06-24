import json
from typing import cast

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentIconType,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.types import JSONModelColumn, LongText


def test_agent_enums_match_prd_boundaries():
    assert AgentKind.DIFY_AGENT.value == "dify_agent"
    assert AgentIconType.EMOJI.value == "emoji"
    assert AgentScope.ROSTER.value == "roster"
    assert AgentScope.WORKFLOW_ONLY.value == "workflow_only"
    assert AgentSource.ROSTER.value == "roster"
    assert AgentSource.AGENT_APP.value == "agent_app"
    assert AgentSource.WORKFLOW.value == "workflow"
    assert AgentStatus.ACTIVE.value == "active"
    assert AgentStatus.ARCHIVED.value == "archived"
    assert AgentConfigRevisionOperation.SAVE_CURRENT_VERSION.value == "save_current_version"
    assert AgentConfigRevisionOperation.RESTORE_VERSION.value == "restore_version"
    assert WorkflowAgentBindingType.ROSTER_AGENT.value == "roster_agent"
    assert WorkflowAgentBindingType.INLINE_AGENT.value == "inline_agent"


def test_agent_table_uses_db_unique_constraint_for_active_roster_names():
    agent_table = cast(sa.Table, Agent.__table__)
    unique_constraints = {
        str(constraint.name): tuple(column.name for column in constraint.columns)
        for constraint in agent_table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    }

    assert unique_constraints["agents_tenant_id_key"] == ("tenant_id", "roster_unique_name")

    roster_unique_name = agent_table.c.roster_unique_name
    assert roster_unique_name.computed is not None
    computed_sql = str(roster_unique_name.computed.sqltext)
    assert "scope = 'roster'" in computed_sql
    assert "status = 'active'" in computed_sql

    indexes = {str(index.name): tuple(column.name for column in index.columns) for index in agent_table.indexes}
    assert indexes["agent_tenant_updated_at_idx"] == ("tenant_id", "updated_at")
    assert indexes["agent_tenant_scope_idx"] == ("tenant_id", "scope")


def test_active_roster_agent_name_unique_constraint_allows_archived_and_workflow_only_duplicates():
    engine = sa.create_engine("sqlite:///:memory:")
    agent_table = cast(sa.Table, Agent.__table__)
    agent_table.create(engine)
    insert_agent = agent_table.insert()

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


def test_current_snapshot_stores_agent_soul_snapshot_as_long_text_json():
    config_snapshot = AgentSoulConfig.model_validate(
        {
            "schema_version": 1,
            "prompt": {"system_prompt": "You are a proposal analysis agent."},
            "env": {"secret_refs": [{"provider_credential_id": "cred-1"}]},
        }
    )
    version = AgentConfigSnapshot(
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=config_snapshot,
    )

    config_snapshot_column = AgentConfigSnapshot.__table__.c.config_snapshot
    assert isinstance(config_snapshot_column.type, JSONModelColumn)
    assert config_snapshot_column.server_default is None
    assert version.config_snapshot_dict == config_snapshot.model_dump(mode="json")
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
        node_id="agent-node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        current_snapshot_id="version-1",
        node_job_config=json.dumps(node_job_config),
    )

    node_job_config_column = WorkflowAgentNodeBinding.__table__.c.node_job_config
    assert isinstance(node_job_config_column.type, JSONModelColumn)
    assert node_job_config_column.server_default is None
    assert binding.node_job_config_dict == node_job_config
    assert "prompt" not in binding.node_job_config_dict


def test_long_text_columns_do_not_use_mysql_incompatible_server_defaults():
    for column in (Agent.__table__.c.description,):
        assert isinstance(column.type, LongText)
        assert column.server_default is None
    assert AgentConfigSnapshot.__table__.c.config_snapshot.server_default is None
    assert WorkflowAgentNodeBinding.__table__.c.node_job_config.server_default is None


def test_agent_config_revision_links_previous_and_current_snapshots():
    revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id="agent-1",
        previous_snapshot_id="version-0",
        current_snapshot_id="version-1",
        revision=2,
        operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
    )

    revision_table = cast(sa.Table, AgentConfigRevision.__table__)
    unique_constraints = {
        str(constraint.name): tuple(column.name for column in constraint.columns)
        for constraint in revision_table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    }

    assert unique_constraints["agent_config_revision_agent_revision_unique"] == (
        "agent_id",
        "revision",
    )
    assert revision.previous_snapshot_id == "version-0"
    assert revision.current_snapshot_id == "version-1"
