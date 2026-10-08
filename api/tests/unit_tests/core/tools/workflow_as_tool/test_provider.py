from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import Mock, create_autospec, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolParameter,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
)
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.tools.workflow.provider import WorkflowToolProviderController
from services.tools.workflow.tool import WorkflowTool
from services.workflow.execution.ports import WorkflowRuntime
from tests.unit_tests.model_factories import make_account, make_app, make_workflow


@pytest.fixture
def database_session(sqlite_engine: Engine) -> Iterator[Session]:
    models = (Account, App, Workflow, WorkflowToolProvider)
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    with session_maker() as session:
        yield session


def _controller(provider_id: str = "provider-1", *, workflow_queries) -> WorkflowToolProviderController:
    entity = ToolProviderEntity(
        identity=ToolProviderIdentity(
            author="author",
            name="wf-provider",
            description=I18nObject(en_US="desc"),
            icon="icon.svg",
            label=I18nObject(en_US="WF"),
        ),
        credentials_schema=[],
    )
    return WorkflowToolProviderController(
        draft_variable_saver=Mock(
            return_value=create_autospec(DraftVariableSaverFactory, instance=True, spec_set=True)
        ),
        entity=entity,
        provider_id=provider_id,
        queries=workflow_queries,
    )


def _app(*, tenant_id: str | None = None) -> App:
    return make_app(
        app_id=str(uuid.uuid4()),
        tenant_id=tenant_id or str(uuid.uuid4()),
        name="Workflow App",
        mode=AppMode.WORKFLOW,
        icon="workflow",
        enable_api=False,
    )


def _account() -> Account:
    return make_account(account_id=None, name="Alice", email="alice@example.com")


def _workflow(app: App, account: Account | None = None) -> Workflow:
    return make_workflow(
        tenant_id=app.tenant_id,
        app_id=app.id,
        version="1",
        graph={"nodes": []},
        created_by=account.id if account else str(uuid.uuid4()),
    )


def _db_provider(
    app: App,
    account: Account,
    *,
    parameter_configuration: str = "[]",
) -> WorkflowToolProvider:
    return WorkflowToolProvider(
        name="workflow_tool",
        label="WF Provider",
        icon="icon.svg",
        app_id=app.id,
        version="1",
        user_id=account.id,
        tenant_id=app.tenant_id,
        description="desc",
        parameter_configuration=parameter_configuration,
    )


def _workflow_tool(
    name: str = "workflow_tool", *, tenant_id: str | None = None, workflow_runtime: WorkflowRuntime
) -> WorkflowTool:
    app = _app(tenant_id=tenant_id)
    workflow = _workflow(app)
    return WorkflowTool(
        draft_variable_saver=Mock(
            return_value=create_autospec(DraftVariableSaverFactory, instance=True, spec_set=True)
        ),
        workflow_as_tool_id="provider-1",
        entity=ToolEntity(
            identity=ToolIdentity(
                author="author",
                name=name,
                label=I18nObject(en_US=name),
                provider="provider-1",
            ),
            description=ToolDescription(human=I18nObject(en_US="desc"), llm="desc"),
            parameters=[],
        ),
        runtime=ToolRuntime(tenant_id=app.tenant_id),
        workflow_app_id=app.id,
        workflow_entities={"app": app, "workflow": workflow},
        version="1",
        workflow_call_depth=0,
        workflow_runtime=workflow_runtime,
        queries=workflow_runtime.tools,
    )


def _persist_provider_graph(
    session: Session,
    *,
    parameter_configuration: str = "[]",
    include_app: bool = True,
    include_workflow: bool = True,
) -> tuple[WorkflowToolProvider, App, Account, Workflow]:
    account = _account()
    app = _app()
    workflow = _workflow(app, account)
    db_provider = _db_provider(app, account, parameter_configuration=parameter_configuration)

    tenant = Tenant(name="Tenant")
    tenant.id = app.tenant_id
    session.add_all(
        [
            account,
            db_provider,
            tenant,
            TenantAccountJoin(account_id=account.id, tenant_id=app.tenant_id, role=TenantAccountRole.OWNER),
        ]
    )
    if include_app:
        session.add(app)
    if include_workflow:
        session.add(workflow)
    session.commit()
    return db_provider, app, account, workflow


def test_get_tools_builds_entity(database_session: Session, *, workflow_queries):
    db_provider, app, user, _ = _persist_provider_graph(
        database_session,
        parameter_configuration=json.dumps(
            [
                {"name": "country", "description": "Country", "form": ToolParameter.ToolParameterForm.FORM.value},
                {"name": "files", "description": "files", "form": ToolParameter.ToolParameterForm.FORM.value},
            ]
        ),
    )
    controller = _controller(db_provider.id, workflow_queries=workflow_queries)
    variables = [
        VariableEntity(
            variable="country",
            label="Country",
            description="Country",
            type=VariableEntityType.SELECT,
            required=True,
            options=["US", "IN"],
        )
    ]
    outputs = [
        SimpleNamespace(variable="json", value_type="string"),
        SimpleNamespace(variable="answer", value_type="string"),
    ]

    with (
        patch(
            "services.tools.workflow.provider.BaseAppConfigManager.convert_features",
            return_value=SimpleNamespace(file_upload=True),
        ),
        patch(
            "services.tools.workflow.provider.WorkflowToolConfigurationUtils.get_workflow_graph_variables",
            return_value=variables,
        ),
        patch(
            "services.tools.workflow.provider.WorkflowToolConfigurationUtils.get_workflow_graph_output",
            return_value=outputs,
        ),
    ):
        tool = controller.get_tools(db_provider.tenant_id)[0]

    assert tool.entity.identity.name == "workflow_tool"
    # "json" output is reserved for ToolInvokeMessage.VariableMessage and filtered out.
    properties = cast(dict[str, Any], tool.entity.output_schema["properties"])
    assert properties == {"answer": {"type": "string", "description": ""}}
    assert "json" not in properties
    assert tool.entity.parameters[0].type == ToolParameter.ToolParameterType.SELECT
    assert tool.entity.parameters[1].type == ToolParameter.ToolParameterType.SYSTEM_FILES
    assert controller.provider_type == ToolProviderType.WORKFLOW


def test_get_tool_returns_hit_or_none(*, workflow_runtime: WorkflowRuntime, workflow_queries):
    controller = _controller(workflow_queries=workflow_queries)
    tool = _workflow_tool(workflow_runtime=workflow_runtime)
    controller.tools = [tool]

    assert controller.get_tool("workflow_tool") is tool
    assert controller.get_tool("missing") is None


def test_get_tools_returns_cached(*, workflow_runtime: WorkflowRuntime, workflow_queries):
    controller = _controller(workflow_queries=workflow_queries)
    cached_tools = [_workflow_tool("wf-cached", tenant_id="tenant-1", workflow_runtime=workflow_runtime)]
    controller.tools = cached_tools

    assert controller.get_tools("tenant-1") == cached_tools


def test_from_db_builds_controller(database_session: Session, *, workflow_queries):
    db_provider, app, user, workflow = _persist_provider_graph(database_session)

    with (
        patch(
            "services.tools.workflow.provider.BaseAppConfigManager.convert_features",
            return_value=SimpleNamespace(file_upload=False),
        ),
        patch(
            "services.tools.workflow.provider.WorkflowToolConfigurationUtils.get_workflow_graph_variables",
            return_value=[],
        ),
        patch(
            "services.tools.workflow.provider.WorkflowToolConfigurationUtils.get_workflow_graph_output",
            return_value=[],
        ),
    ):
        built = WorkflowToolProviderController.from_db(
            db_provider,
            draft_variable_saver=Mock(
                return_value=create_autospec(DraftVariableSaverFactory, instance=True, spec_set=True)
            ),
            queries=workflow_queries,
        )

    assert isinstance(built, WorkflowToolProviderController)
    assert built.entity.identity.author == user.name
    assert built.provider_id == db_provider.id
    assert built.tools is not None
    assert built.tools[0].workflow_app_id == app.id
    assert built.tools[0].workflow_entities["workflow"].id == workflow.id


def test_get_tools_returns_empty_when_provider_missing(database_session: Session, *, workflow_queries):
    db_provider, _, _, _ = _persist_provider_graph(database_session)
    controller = _controller(db_provider.id, workflow_queries=workflow_queries)
    controller.tools = None

    assert controller.get_tools(str(uuid.uuid4())) == []


def test_get_tools_raises_when_app_missing(database_session: Session, *, workflow_queries):
    db_provider, _, _, _ = _persist_provider_graph(
        database_session,
        include_app=False,
        include_workflow=False,
    )
    controller = _controller(db_provider.id, workflow_queries=workflow_queries)
    controller.tools = None

    with pytest.raises(ValueError, match="app not found"):
        controller.get_tools(db_provider.tenant_id)
