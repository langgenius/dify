import json
from typing import cast

from enums.agent import WorkflowAgentBindingType
from models.agent_config_entities import (
    AgentSoulConfig,
    AgentSoulPromptConfig,
    WorkflowNodeJobConfig,
    WorkflowNodeJobMetadata,
)
from models.agent_runtime_contracts import AgentSnapshotRecord, WorkflowAgentBindingError, WorkflowBindingRecord


def test_agent_snapshot_config_dump_is_json_compatible_and_independent() -> None:
    config = AgentSoulConfig(
        prompt=AgentSoulPromptConfig(system_prompt="original prompt"),
        config_note="original note",
    )
    record = AgentSnapshotRecord(id="snapshot-1", agent_id="agent-1", config=config)

    materialized = record.config_snapshot_dict
    assert json.loads(json.dumps(materialized)) == materialized

    config.prompt.system_prompt = "source mutation"
    dumped_prompt = cast(dict[str, object], materialized["prompt"])
    dumped_prompt["system_prompt"] = "result mutation"

    assert config.prompt.system_prompt == "source mutation"
    fresh_prompt = cast(dict[str, object], record.config_snapshot_dict["prompt"])
    assert fresh_prompt["system_prompt"] == "source mutation"
    assert materialized["config_note"] == "original note"


def test_workflow_binding_job_dump_is_json_compatible_and_independent() -> None:
    job = WorkflowNodeJobConfig(
        workflow_prompt="original job",
        metadata=WorkflowNodeJobMetadata(agent_soul={"routing": {"enabled": True}}),
    )
    record = WorkflowBindingRecord(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="agent-node-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=job,
        created_by="account-1",
        updated_by=None,
    )

    materialized = record.node_job_config_dict
    assert json.loads(json.dumps(materialized)) == materialized

    source_agent_soul = job.metadata.agent_soul
    assert source_agent_soul is not None
    source_routing = cast(dict[str, object], source_agent_soul["routing"])
    source_routing["enabled"] = False

    dumped_metadata = cast(dict[str, object], materialized["metadata"])
    dumped_agent_soul = cast(dict[str, object], dumped_metadata["agent_soul"])
    dumped_routing = cast(dict[str, object], dumped_agent_soul["routing"])
    assert dumped_routing["enabled"] is True
    dumped_routing["enabled"] = "result mutation"

    fresh_metadata = cast(dict[str, object], record.node_job_config_dict["metadata"])
    fresh_agent_soul = cast(dict[str, object], fresh_metadata["agent_soul"])
    fresh_routing = cast(dict[str, object], fresh_agent_soul["routing"])
    assert fresh_routing["enabled"] is False


def test_workflow_agent_binding_error_preserves_code_and_message() -> None:
    error = WorkflowAgentBindingError("binding_not_found", "Agent binding is unavailable")

    assert error.error_code == "binding_not_found"
    assert str(error) == "Agent binding is unavailable"
    assert error.args == ("Agent binding is unavailable",)
