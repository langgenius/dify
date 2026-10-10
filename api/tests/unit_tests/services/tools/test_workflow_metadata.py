"""Management, declaration and execution reads share one tenant-scoped repository."""

from typing import NoReturn

import pytest
from sqlalchemy import Connection, inspect, select
from sqlalchemy.orm import Mapper, Session, sessionmaker

from core.agent.entities import AgentToolEntity
from core.db.session_factory import session_factory
from core.tools.entities.tool_entities import ToolProviderType, WorkflowToolParameterConfiguration
from core.tools.errors import ToolNotFoundError, ToolProviderNotFoundError
from models.account import TenantAccountJoin, TenantAccountRole
from models.model import AppMode
from models.tool_runtime_contracts import WorkflowToolQueries
from models.tools import ToolLabelBinding, WorkflowToolProvider
from repositories.tools.provider_repository import ToolProviderRepository
from services.tools.tool_manager import ToolManager
from services.tools.workflow_tools_manage_service import WorkflowToolManageService
from tests.unit_tests.model_factories import make_account, make_app, make_tenant, make_workflow


@pytest.fixture
def published_tool(
    sqlite_session_factory: sessionmaker[Session],
    workflow_tools: WorkflowToolManageService,
    monkeypatch: pytest.MonkeyPatch,
) -> str:
    app = make_app(mode=AppMode.WORKFLOW)
    workflow = make_workflow(
        version="published",
        graph={
            "nodes": [
                {
                    "id": "start",
                    "data": {
                        "type": "start",
                        "title": "Start",
                        "variables": [
                            {"variable": "question", "label": "Question", "type": "text-input", "required": True}
                        ],
                    },
                }
            ],
            "edges": [],
        },
    )
    app.workflow_id = workflow.id
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                app,
                workflow,
                make_account(),
                make_tenant(),
                TenantAccountJoin(tenant_id="tenant-1", account_id="account-1", role=TenantAccountRole.OWNER),
            ]
        )
    # Metadata construction must not rely on a Flask context, global factory or execution runtime.
    monkeypatch.setattr(session_factory, "create_session", sessionmaker())
    workflow_tools.create_workflow_tool(
        user_id="account-1",
        tenant_id="tenant-1",
        workflow_app_id=app.id,
        name="answer",
        label="Answer",
        icon={"content": "💡", "background": "#fff"},
        description="Answer a question",
        parameters=[WorkflowToolParameterConfiguration(name="question", description="Question", form="llm")],
        labels=["productivity"],
    )
    with sqlite_session_factory() as session:
        provider_id = session.scalar(select(WorkflowToolProvider.id))
    assert provider_id is not None
    return provider_id


def test_metadata_management_and_runtime_declaration_without_execution_dependency(
    published_tool: str,
    workflow_tools: WorkflowToolManageService,
    tool_providers: ToolProviderRepository,
    workflow_queries: WorkflowToolQueries,
) -> None:
    provider_id = published_tool
    detail = workflow_tools.get_workflow_tool_by_tool_id("account-1", "tenant-1", provider_id)
    assert detail["synced"] is True
    assert detail["tool"].name == "answer"
    assert workflow_tools.get_workflow_tool_by_app_id("account-1", "tenant-1", "app-1") == detail
    assert workflow_tools.list_single_workflow_tools("account-1", "tenant-1", provider_id)[0].name == "answer"
    assert workflow_tools.list_tenant_workflow_tools("account-1", "tenant-1")[0].tools[0].name == "answer"
    assert (
        ToolManager.list_providers_from_api(
            "account-1", "tenant-1", "workflow", workflow_queries=workflow_queries, tool_providers=tool_providers
        )[0].id
        == provider_id
    )
    # Agent metadata uses the same factory as execution, without constructing an execution runtime.
    runtime = ToolManager.get_agent_tool_runtime(
        "tenant-1",
        "app-1",
        AgentToolEntity(
            provider_type=ToolProviderType.WORKFLOW, provider_id=provider_id, tool_name="answer", tool_parameters={}
        ),
        tool_providers=tool_providers,
        workflow_queries=workflow_queries,
    )
    assert runtime.entity.identity.name == "answer"
    assert runtime.entity.parameters[0].name == "question"


def test_workflow_queries_enforce_tenant_ownership_for_all_entry_points(
    published_tool: str,
    workflow_tools: WorkflowToolManageService,
    tool_providers: ToolProviderRepository,
    workflow_queries: WorkflowToolQueries,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_tenant(tenant_id="other-tenant"))
    assert workflow_queries.provider(tenant_id="other-tenant", provider_id=published_tool) is None
    assert workflow_queries.providers(tenant_id="other-tenant") == []
    assert workflow_queries.provider_for_app(tenant_id="other-tenant", app_id="app-1") is None
    assert workflow_queries.actor(tenant_id="other-tenant", user_id="account-1") is None
    assert workflow_queries.labels(tenant_id="other-tenant", provider_ids=[published_tool]) == {}
    for query in [workflow_queries.app, workflow_queries.current_workflow]:
        with pytest.raises(ToolNotFoundError):
            query(tenant_id="other-tenant", app_id="app-1")
    with pytest.raises(ToolNotFoundError):
        workflow_queries.workflow(tenant_id="other-tenant", app_id="app-1", version="published")
    with pytest.raises(ValueError, match="Tool not found"):
        workflow_tools.get_workflow_tool_by_tool_id("account-1", "other-tenant", published_tool)
    with pytest.raises(ToolProviderNotFoundError):
        ToolManager.get_tool_runtime(
            ToolProviderType.WORKFLOW,
            published_tool,
            "answer",
            "other-tenant",
            tool_providers=tool_providers,
            workflow_queries=workflow_queries,
        )
    assert inspect(workflow_queries.app(tenant_id="tenant-1", app_id="app-1")).detached


def test_workflow_management_updates_and_deletes_through_injected_store(
    published_tool: str,
    workflow_tools: WorkflowToolManageService,
    workflow_queries: WorkflowToolQueries,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workflow_tools.update_workflow_tool(
        "account-1",
        "tenant-1",
        published_tool,
        "renamed",
        "Renamed",
        {"content": "💡", "background": "#fff"},
        "Updated",
        [WorkflowToolParameterConfiguration(name="question", description="Question", form="llm")],
        labels=["search"],
    )
    detail = workflow_tools.get_workflow_tool_by_tool_id("account-1", "tenant-1", published_tool)
    assert detail["tool"].name == "renamed"
    assert workflow_queries.labels(tenant_id="tenant-1", provider_ids=[published_tool]) == {published_tool: ["search"]}
    workflow_tools.delete_workflow_tool("account-1", "other-tenant", published_tool)
    assert workflow_queries.provider(tenant_id="tenant-1", provider_id=published_tool) is not None
    workflow_tools.delete_workflow_tool("account-1", "tenant-1", published_tool)
    assert workflow_queries.provider(tenant_id="tenant-1", provider_id=published_tool) is None
    with sqlite_session_factory() as session:
        assert session.scalar(select(ToolLabelBinding).where(ToolLabelBinding.tool_id == published_tool)) is None


def test_metadata_update_and_labels_roll_back_together(
    published_tool: str,
    workflow_tools: WorkflowToolManageService,
    workflow_queries: WorkflowToolQueries,
) -> None:
    from sqlalchemy import event

    original_labels = workflow_queries.labels(tenant_id="tenant-1", provider_ids=[published_tool])

    def fail_label_insert(
        _mapper: Mapper[ToolLabelBinding], _connection: Connection, _target: ToolLabelBinding
    ) -> NoReturn:
        raise RuntimeError("label write failed")

    event.listen(ToolLabelBinding, "before_insert", fail_label_insert)
    try:
        with pytest.raises(RuntimeError, match="label write failed"):
            workflow_tools.update_workflow_tool(
                "account-1",
                "tenant-1",
                published_tool,
                "changed",
                "Changed",
                {"content": "💡", "background": "#fff"},
                "Updated",
                [WorkflowToolParameterConfiguration(name="question", description="Question", form="llm")],
                labels=["search"],
            )
    finally:
        event.remove(ToolLabelBinding, "before_insert", fail_label_insert)
    provider = workflow_queries.provider(tenant_id="tenant-1", provider_id=published_tool)
    assert provider is not None
    assert provider.name == "answer"
    assert workflow_queries.labels(tenant_id="tenant-1", provider_ids=[published_tool]) == original_labels
