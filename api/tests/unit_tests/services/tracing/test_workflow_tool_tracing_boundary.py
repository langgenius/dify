"""Hidden Workflow Tool Agents must not invent a trace owned by the source app."""

import json
from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.ops.entities.trace_entity import WorkflowTraceInfo
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from models.application_trace import ApplicationTraceRun
from models.enums import CreatorUserRole
from models.model import App, AppMode, TraceAppConfig
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
)
from repositories.application_trace_repository import ApplicationTraceRepository
from services.tracing import runtime_bridge
from services.tracing.normalization import remap_outer_trace
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_app, make_workflow
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    batch_for,
    identifier,
    ingest,
)
from tests.unit_tests.services.tracing.test_runtime_bridge import workflow_context, workflow_entity


def seed(
    sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    *,
    root_has_agent: bool,
    source_enabled: bool = True,
) -> tuple[ApplicationTracingService, WorkflowAgentRuntimeBuildContext, dict[str, str]]:
    ids = {
        name: identifier("tool-boundary-" + name)
        for name in [
            "tenant",
            "root",
            "source",
            "root_workflow",
            "source_workflow",
            "run",
            "root_agent",
            "root_tool",
            "child",
            "actor",
        ]
    }
    root_graph: dict[str, list[dict[str, object]]] = {
        "nodes": [{"id": "tool", "data": {"type": "tool", "title": "Root tool"}}],
        "edges": [],
    }
    if root_has_agent:
        root_graph["nodes"].append(
            {
                "id": "root-agent",
                "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Root Agent"},
            }
        )
    now = datetime(2026, 10, 21, tzinfo=UTC)
    with sessions.begin() as session:
        for app, provider, enabled, content in [
            ("root", "langfuse", True, False),
            ("source", "langsmith", source_enabled, True),
        ]:
            session.add(
                make_app(
                    app_id=ids[app],
                    tenant_id=ids["tenant"],
                    mode=AppMode.WORKFLOW,
                    tracing=json.dumps({"enabled": enabled, "tracing_provider": provider, "capture_content": content}),
                )
            )
            session.add(
                make_workflow(
                    workflow_id=ids[app + "_workflow"],
                    app_id=ids[app],
                    tenant_id=ids["tenant"],
                    graph=root_graph if app == "root" else {"nodes": [], "edges": []},
                )
            )
            session.add(
                TraceAppConfig(
                    app_id=ids[app],
                    tracing_provider=provider,
                    tracing_config={"project_url": "https://tracing.test/" + app},
                )
            )
        session.add(
            WorkflowRun(
                id=ids["run"],
                tenant_id=ids["tenant"],
                app_id=ids["root"],
                workflow_id=ids["root_workflow"],
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="1",
                graph=json.dumps(root_graph),
                inputs="{}",
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_by=ids["actor"],
                created_by_role=CreatorUserRole.ACCOUNT,
                created_at=now,
                finished_at=now + timedelta(seconds=3),
            )
        )
        for key, node_type in [("root_agent", "agent"), ("root_tool", "tool"), ("child", "agent")]:
            child = key == "child"
            app = "source" if child else "root"
            session.add(
                WorkflowNodeExecutionModel(
                    id=ids[key],
                    tenant_id=ids["tenant"],
                    app_id=ids[app],
                    workflow_id=ids[app + "_workflow"],
                    workflow_run_id=ids["run"],
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
                    if child
                    else WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                    triggered_from_workflow_id=ids["root_workflow"] if child else None,
                    triggered_from_node_execution_id=ids["root_tool"] if child else None,
                    node_execution_id=ids[key],
                    index=1,
                    node_id=key,
                    node_type=node_type,
                    title=key,
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    created_by=ids["actor"],
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_at=now,
                    finished_at=now + timedelta(seconds=2),
                    inputs="{}",
                    outputs="{}",
                    process_data=json.dumps(
                        {"workflow_tool_root_app_id": ids["root"], "workflow_tool_invocation_id": "tool-call"}
                    )
                    if child
                    else "{}",
                )
            )
    service = ApplicationTracingService(ApplicationTraceRepository(sessions))
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    monkeypatch.setattr(runtime_bridge, "_service", lambda: service)
    entity = workflow_entity()
    entity.app_config = entity.app_config.model_copy(
        update={"app_id": ids["root"], "tenant_id": ids["tenant"], "workflow_id": ids["root_workflow"]}
    )
    runtime_bridge.freeze_workflow_run(
        entity,
        workflow_id=ids["root_workflow"],
        workflow_run_id=ids["run"],
        conversation_id=None,
        graph_data=root_graph,
    )
    original = workflow_context(False)
    context = replace(
        original,
        dify_context=original.dify_context.model_copy(
            update={"tenant_id": ids["tenant"], "app_id": ids["source"], "workflow_tool_invocation_id": "tool-call"}
        ),
        workflow_id=ids["source_workflow"],
        workflow_run_id=ids["run"],
        node_execution_id=ids["child"],
    )
    return service, context, ids


@pytest.mark.parametrize("root_has_agent", [False, True])
@pytest.mark.parametrize("source_enabled", [False, True])
def test_hidden_child_never_reserves_source_policy_or_changes_root_freeze(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    root_has_agent: bool,
    source_enabled: bool,
) -> None:
    service, context, ids = seed(
        sqlite_session_factory, monkeypatch, root_has_agent=root_has_agent, source_enabled=source_enabled
    )
    with sqlite_session_factory() as session:
        before = deepcopy([dict(row) for row in session.execute(select(ApplicationTraceRun.__table__)).mappings()])
    service_lookups: list[bool] = []

    def lookup() -> ApplicationTracingService:
        service_lookups.append(True)
        return service

    monkeypatch.setattr(runtime_bridge, "_service", lookup)
    # Marked children never consult policy or ownership, even for malformed
    # empty markers or a foreign tenant. They cannot create an orphan B run.
    for tenant in (ids["tenant"], identifier("foreign-tool-tenant")):
        for marker in ("tool-call", ""):
            child = replace(
                context,
                dify_context=context.dify_context.model_copy(
                    update={
                        "tenant_id": tenant,
                        "workflow_tool_invocation_id": marker,
                    }
                ),
            )
            assert runtime_bridge.prepare_workflow_agent(child, None) is None
    assert service_lookups == []
    with sqlite_session_factory() as session:
        observed = [
            (r.app_id, r.provider, r.capture_content, r.source_id) for r in session.scalars(select(ApplicationTraceRun))
        ]
        assert observed == ([(ids["root"], "langfuse", False, ids["run"])] if root_has_agent else [])
        after = [dict(row) for row in session.execute(select(ApplicationTraceRun.__table__)).mappings()]
    assert after == before
    assert (
        service.repository.source_run(
            tenant_id=ids["tenant"], app_id=ids["source"], source_kind="workflow", source_id=ids["run"]
        )
        is None
    )


def test_hidden_child_skip_keeps_normal_root_agent_trace_assemblable(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, child, ids = seed(sqlite_session_factory, monkeypatch, root_has_agent=True)
    assert runtime_bridge.prepare_workflow_agent(child, None) is None
    root_context = replace(
        child,
        dify_context=child.dify_context.model_copy(update={"app_id": ids["root"], "workflow_tool_invocation_id": None}),
        workflow_id=ids["root_workflow"],
        node_execution_id=ids["root_agent"],
    )
    runtime = runtime_bridge.prepare_workflow_agent(root_context, None)
    assert runtime is not None
    run = service.repository.get(str(runtime.run_id))
    assert run is not None
    assert run.app_id == ids["root"]
    frozen = deepcopy(run.provider_config)
    with sqlite_session_factory.begin() as session:
        owner = session.get(App, ids["root"])
        assert owner is not None
        owner.tracing = json.dumps({"enabled": True, "tracing_provider": "langsmith", "capture_content": True})
        workflow = session.get(WorkflowRun, ids["run"])
        assert workflow is not None
    actor = make_account(account_id=ids["actor"])
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id=ids["tenant"],
        user=actor,
        app_id=ids["root"],
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    info = WorkflowTraceInfo(
        workflow_data=workflow,
        workflow_id=ids["root_workflow"],
        tenant_id=ids["tenant"],
        workflow_run_id=ids["run"],
        workflow_run_elapsed_time=3,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        total_tokens=0,
        file_list=[],
        query="",
        metadata={"app_id": ids["root"]},
    )
    outer = CanonicalTraceBuilder(lambda _info: nodes.get_by_workflow_execution(ids["run"])).build(info)
    assert outer is not None
    outer = remap_outer_trace(outer, trace_id=run.trace_id, capture_content=False, agent_message=False)
    service.repository.terminal(run.id, outer.model_dump(mode="json"), outer.root_span_id)
    invocation = service.repository.collected(run.id)[0][0]
    ingest(Collection(service.repository, sqlite_session_factory, run), batch_for(run, invocation))
    current = service.repository.get(run.id)
    assert current is not None
    trace = service.assemble(current)
    span_ids = {span.id for span in trace.spans}
    assert all(span.parent_id is None or span.parent_id in span_ids for span in trace.spans)
    assert current.provider_config == frozen
    assert current.provider == "langfuse"
    assert current.capture_content is False
