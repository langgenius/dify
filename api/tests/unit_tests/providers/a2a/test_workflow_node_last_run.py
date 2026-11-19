"""Last Run projects frozen external inputs and reported usage over real SQL."""

from dataclasses import replace

import pytest
from sqlalchemy import select

from graphon.enums import ErrorStrategy, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events.node import PauseRequestedEvent, StreamCompletedEvent
from models.agent import WorkflowAgentNodeBinding
from models.base import TypeBase
from models.external_agent import ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentTraceRecord, ExternalAgentTraceUsageSummary
from models.workflow import (
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
)
from providers.a2a.workflow_node import DifyExternalWorkflowWake, ExternalAgentNodeData, last_run_inputs
from repositories.external_agents.observability_repository import ExternalObservabilityRepository
from services.external_agents.contracts import ExternalOrigin
from services.external_agents.traceability import ReportedCallUsage, TraceLimits
from services.external_agents.workflow_runtime import ExternalNodeJob
from services.workflow_service import WorkflowService
from tests.unit_tests.providers.a2a.test_workflow_node_branches import node_case
from tests.unit_tests.repositories.external_agents import test_runtime_repository as fixtures
from tests.unit_tests.repositories.external_agents.test_runtime_repository import (
    RemoteAgent,
    WorkflowDomain,
    bound_engine,
    command,
    present,
    stored,
)

domain = fixtures.domain
workflow_domain = fixtures.workflow_domain


@pytest.mark.parametrize(("total", "storage_failure"), [(23071, False), (0, False), (None, False), (None, True)])
def test_standalone_terminal_recovers_frozen_inputs_and_known_usage(
    workflow_domain: WorkflowDomain, total: int | None, storage_failure: bool, caplog: pytest.LogCaptureFixture
) -> None:
    """An old paused row is completed without rerendering its later variable pool."""
    db_domain, identity, workflow_id, _ = workflow_domain
    repository, sessions, scope, agent, revision = db_domain
    scope = replace(scope, origin=ExternalOrigin.NODE_DEBUG)
    debug_domain = (repository, sessions, scope, agent, revision)
    job = ExternalNodeJob(agent_task="Translate {{#source.input#}} now")
    owned = (db_domain, identity, workflow_id, job)
    TypeBase.metadata.create_all(
        bound_engine(sessions),
        tables=[
            TypeBase.metadata.tables[model.__tablename__]
            for model in (
                WorkflowDraftVariable,
                WorkflowDraftVariableFile,
                WorkflowNodeExecutionOffload,
                ExternalAgentTraceRecord,
                ExternalAgentTraceUsageSummary,
            )
        ],
    )
    with sessions.begin() as session:
        caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
        caller.workflow_run_id = None
        caller.node_execution_id = identity.execution_id
        caller.triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
        caller.status = WorkflowNodeExecutionStatus.PAUSED
        caller.inputs = None
        caller.execution_metadata = (
            '{"iteration_id":"preserved-container","total_tokens":999,"legacy_unknown":{"value":"must-not-be-logged"}}'
        )
        binding = session.scalars(select(WorkflowAgentNodeBinding)).one()
        binding.external_job_config = job.model_dump(mode="json", exclude_unset=True)
    remote = RemoteAgent(direct=True)
    node, runtime, clock = node_case(owned, debug=True, remote=remote)
    node.runtime_state.variable_pool.add(("source", "input"), "resolved value")
    assert isinstance(list(node._run())[0], PauseRequestedEvent)
    invocation = present(repository.for_execution(scope, replace(identity, workflow_run_id=None)))
    assert invocation.sequence == 0
    with sessions() as session:
        initial = stored(session, ExternalAgentInvocation, invocation.id)
        assert initial.sequence == initial.runtime_snapshot["sequence"] == 0
    command(debug_domain, runtime, clock, "dispatch")
    observations = ExternalObservabilityRepository(sessions=sessions, limits=TraceLimits())
    if total is not None:
        observations.record_usage(
            owner=observations.owner(tenant_id=scope.tenant_id, invocation_id=invocation.id, now=clock.now()),
            usage=ReportedCallUsage(total, "metadata.usage.totalTokens", "remote-metadata-usage-v1"),
            revision=1,
            now=clock.now(),
        )
    node.runtime_state.variable_pool.add(("source", "input"), "later changed value")
    if storage_failure:
        TypeBase.metadata.tables[ExternalAgentTraceUsageSummary.__tablename__].drop(bound_engine(sessions))
    wake = DifyExternalWorkflowWake(
        sessions=sessions,
        usage=ExternalObservabilityRepository(sessions=sessions, limits=TraceLimits()),
        enqueue_resume=lambda _run: None,
        now=clock.now,
    )
    assert wake.wake(scope, repository.get(scope, invocation.id))
    assert wake.wake(scope, repository.get(scope, invocation.id))
    with sessions() as session:
        caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
        assert caller.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert caller.inputs_dict == {"agent_task": "Translate resolved value now"}
        assert caller.execution_metadata_dict["iteration_id"] == "preserved-container"
        assert "legacy_unknown" not in caller.execution_metadata_dict
        if total is None:
            assert "total_tokens" not in caller.execution_metadata_dict
        else:
            assert caller.execution_metadata_dict["total_tokens"] == total
    assert len(remote.sent) == 1
    assert "unsupported_field_count=1" in caplog.text
    assert "must-not-be-logged" not in caplog.text


@pytest.mark.parametrize("total", [23071, 0, None])
@pytest.mark.parametrize("remote_state", ["completed", "failed"])
def test_resumed_node_projects_the_selected_frozen_invocation(
    workflow_domain: WorkflowDomain, total: int | None, remote_state: str
) -> None:
    """Success and failure use frozen task values after the pool has changed."""
    db_domain, identity, workflow_id, _ = workflow_domain
    repository, sessions, scope, _, _ = db_domain
    job = ExternalNodeJob(agent_task="Run {{#source.input#}}")
    TypeBase.metadata.create_all(
        bound_engine(sessions),
        tables=[
            TypeBase.metadata.tables[model.__tablename__]
            for model in (ExternalAgentTraceRecord, ExternalAgentTraceUsageSummary)
        ],
    )
    with sessions.begin() as session:
        binding = session.scalars(select(WorkflowAgentNodeBinding)).one()
        binding.external_job_config = job.model_dump(mode="json", exclude_unset=True)
    remote = RemoteAgent()
    remote.state = remote_state
    node, runtime, clock = node_case((db_domain, identity, workflow_id, job), remote=remote)
    node.runtime_state.variable_pool.add(("source", "input"), "frozen value")
    assert isinstance(list(node._run())[0], PauseRequestedEvent)
    invocation = present(repository.for_execution(scope, identity))
    command(db_domain, runtime, clock, "dispatch")
    observations = ExternalObservabilityRepository(sessions=sessions, limits=TraceLimits())
    if total is not None:
        observations.record_usage(
            owner=observations.owner(tenant_id=scope.tenant_id, invocation_id=invocation.id, now=clock.now()),
            usage=ReportedCallUsage(total, "metadata.usage.totalTokens", "remote-metadata-usage-v1"),
            revision=1,
            now=clock.now(),
        )
    node.runtime_state.variable_pool.remove(("source", "input"))
    result = list(node._run())
    assert len(result) == 1
    assert isinstance(result[0], StreamCompletedEvent)
    expected_status = (
        WorkflowNodeExecutionStatus.SUCCEEDED if remote_state == "completed" else WorkflowNodeExecutionStatus.FAILED
    )
    assert result[0].node_run_result.status == expected_status
    assert result[0].node_run_result.inputs == {"agent_task": "Run frozen value"}
    if total is None:
        assert "total_tokens" not in result[0].node_run_result.metadata
    else:
        assert result[0].node_run_result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == total
    if remote_state == "failed":
        for strategy in (ErrorStrategy.DEFAULT_VALUE, ErrorStrategy.FAIL_BRANCH):
            strategy_node, _, _ = node_case(
                (db_domain, identity, workflow_id, job),
                data=ExternalAgentNodeData.model_validate(
                    {
                        **job.model_dump(exclude_unset=True),
                        "error_strategy": strategy.value,
                        "default_value": [{"key": "text", "type": "string", "value": "fallback"}]
                        if strategy == ErrorStrategy.DEFAULT_VALUE
                        else [],
                    }
                ),
            )
            handled = WorkflowService(session_maker=sessions)._apply_error_strategy(
                strategy_node, result[0].node_run_result
            )
            assert handled.status == WorkflowNodeExecutionStatus.EXCEPTION
            assert handled.inputs == {"agent_task": "Run frozen value"}
            assert (
                handled.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]
                == result[0].node_run_result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]
            )
            assert handled.metadata[WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY] == strategy
            if total is None:
                assert WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS not in handled.metadata
            else:
                assert handled.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == total
            assert handled.outputs.get("text") == ("fallback" if strategy == ErrorStrategy.DEFAULT_VALUE else None)
    assert len(remote.sent) == 1


def test_frozen_file_input_projection_exposes_only_ordered_internal_references() -> None:
    """Last Run cannot leak wire content or URLs through additional stored keys."""
    result = last_run_inputs(
        (
            {"text": "Read "},
            {"fileRef": {"file_id": "first", "kind": "upload", "uri": "https://untrusted", "raw": "base64"}},
            {"text": " then "},
            {"fileRef": {"file_id": "second", "kind": "tool", "credential": "not-for-last-run"}},
            {"fileRef": {"file_id": "invalid", "kind": ["upload"]}},
        )
    )
    assert result == {
        "agent_task": "Read  then ",
        "file_refs": [{"file_id": "first", "kind": "upload"}, {"file_id": "second", "kind": "tool"}],
    }
