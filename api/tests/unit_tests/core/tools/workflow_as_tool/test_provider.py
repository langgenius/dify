from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import PropertyMock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import session_factory
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
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from core.tools.workflow_as_tool.tool import WorkflowTool
from extensions.ext_database import db
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.account import Account
from models.base import TypeBase
from models.model import App, AppMode, IconType
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType


@pytest.fixture
def database_session(sqlite_engine: Engine) -> Iterator[Session]:
    models = (Account, App, Workflow, WorkflowToolProvider)
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    with (
        patch.object(session_factory, "create_session", session_maker),
        patch.object(type(db), "engine", new_callable=PropertyMock, return_value=sqlite_engine),
    ):
        with session_maker() as session:
            yield session


def _controller(provider_id: str = "provider-1") -> WorkflowToolProviderController:
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
    return WorkflowToolProviderController(entity=entity, provider_id=provider_id)


def _app(*, tenant_id: str | None = None) -> App:
    return App(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id or str(uuid.uuid4()),
        name="Workflow App",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="workflow",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=False,
    )


def _account() -> Account:
    return Account(name="Alice", email="alice@example.com")


def _workflow(app: App, account: Account | None = None) -> Workflow:
    return Workflow.new(
        tenant_id=app.tenant_id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW.value,
        version="1",
        graph=json.dumps({"nodes": []}),
        features="{}",
        created_by=account.id if account else str(uuid.uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
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


def _workflow_tool(name: str = "workflow_tool") -> WorkflowTool:
    app = _app()
    workflow = _workflow(app)
    return WorkflowTool(
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

    session.add_all([account, db_provider])
    if include_app:
        session.add(app)
    if include_workflow:
        session.add(workflow)
    session.commit()
    return db_provider, app, account, workflow


def test_get_db_provider_tool_builds_entity(database_session: Session):
    db_provider, app, user, _ = _persist_provider_graph(
        database_session,
        parameter_configuration=json.dumps(
            [
                {"name": "country", "description": "Country", "form": ToolParameter.ToolParameterForm.FORM.value},
                {"name": "files", "description": "files", "form": ToolParameter.ToolParameterForm.FORM.value},
            ]
        ),
    )
    controller = _controller(db_provider.id)
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
            "core.tools.workflow_as_tool.provider.WorkflowAppConfigManager.convert_features",
            return_value=SimpleNamespace(file_upload=True),
        ),
        patch(
            "core.tools.workflow_as_tool.provider.WorkflowToolConfigurationUtils.get_workflow_graph_variables",
            return_value=variables,
        ),
        patch(
            "core.tools.workflow_as_tool.provider.WorkflowToolConfigurationUtils.get_workflow_graph_output",
            return_value=outputs,
        ),
    ):
        tool = controller._get_db_provider_tool(db_provider, app, session=database_session, user=user)

    assert tool.entity.identity.name == "workflow_tool"
    # "json" output is reserved for ToolInvokeMessage.VariableMessage and filtered out.
    properties = cast(dict[str, Any], tool.entity.output_schema["properties"])
    assert properties == {"answer": {"type": "string", "description": ""}}
    assert "json" not in properties
    assert tool.entity.parameters[0].type == ToolParameter.ToolParameterType.SELECT
    assert tool.entity.parameters[1].type == ToolParameter.ToolParameterType.SYSTEM_FILES
    assert controller.provider_type == ToolProviderType.WORKFLOW


def test_get_tool_returns_hit_or_none():
    controller = _controller()
    tool = _workflow_tool()
    controller.tools = [tool]

    assert controller.get_tool("workflow_tool") is tool
    assert controller.get_tool("missing") is None


def test_get_tools_returns_cached():
    controller = _controller()
    cached_tools = [_workflow_tool("wf-cached")]
    controller.tools = cached_tools

    assert controller.get_tools("tenant-1") == cached_tools


def test_from_db_builds_controller(database_session: Session):
    db_provider, app, user, workflow = _persist_provider_graph(database_session)

    with (
        patch(
            "core.tools.workflow_as_tool.provider.WorkflowAppConfigManager.convert_features",
            return_value=SimpleNamespace(file_upload=False),
        ),
        patch(
            "core.tools.workflow_as_tool.provider.WorkflowToolConfigurationUtils.get_workflow_graph_variables",
            return_value=[],
        ),
        patch(
            "core.tools.workflow_as_tool.provider.WorkflowToolConfigurationUtils.get_workflow_graph_output",
            return_value=[],
        ),
    ):
        built = WorkflowToolProviderController.from_db(db_provider)

    assert isinstance(built, WorkflowToolProviderController)
    assert built.entity.identity.author == user.name
    assert built.provider_id == db_provider.id
    assert built.tools is not None
    assert built.tools[0].workflow_app_id == app.id
    assert built.tools[0].workflow_entities["workflow"].id == workflow.id


def test_get_tools_returns_empty_when_provider_missing(database_session: Session):
    db_provider, _, _, _ = _persist_provider_graph(database_session)
    controller = _controller(db_provider.id)
    controller.tools = None

    assert controller.get_tools(str(uuid.uuid4())) == []


def test_get_tools_raises_when_app_missing(database_session: Session):
    db_provider, _, _, _ = _persist_provider_graph(
        database_session,
        include_app=False,
        include_workflow=False,
    )
    controller = _controller(db_provider.id)
    controller.tools = None

    with pytest.raises(ValueError, match="app not found"):
        controller.get_tools(db_provider.tenant_id)
