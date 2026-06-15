from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, Mock, patch

import pytest

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
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.account import Account
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType


def _controller() -> WorkflowToolProviderController:
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
    return WorkflowToolProviderController(entity=entity, provider_id="provider-1")


def _app() -> App:
    return App(id="app-1")


def _account() -> Account:
    return Account(name="Alice", email="alice@example.com")


def _workflow() -> Workflow:
    return Workflow.new(
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW.value,
        version="1",
        graph=json.dumps({"nodes": []}),
        features="{}",
        created_by="user-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _db_provider(*, parameter_configuration: str = "[]") -> WorkflowToolProvider:
    return WorkflowToolProvider(
        name="workflow_tool",
        label="WF Provider",
        icon="icon.svg",
        app_id="app-1",
        version="1",
        user_id="user-1",
        tenant_id="tenant-1",
        description="desc",
        parameter_configuration=parameter_configuration,
    )


def _workflow_tool(name: str = "workflow_tool") -> WorkflowTool:
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
        runtime=ToolRuntime(tenant_id="tenant-1"),
        workflow_app_id="app-1",
        workflow_entities={"app": _app(), "workflow": _workflow()},
        version="1",
        workflow_call_depth=0,
    )


def _mock_session_with_begin() -> Mock:
    session = Mock()
    begin_cm = Mock()
    begin_cm.__enter__ = Mock(return_value=None)
    begin_cm.__exit__ = Mock(return_value=False)
    session.begin.return_value = begin_cm
    return session


def test_get_db_provider_tool_builds_entity():
    controller = _controller()
    session = Mock()
    workflow = _workflow()
    session.scalar.return_value = workflow
    app = _app()
    db_provider = _db_provider(
        parameter_configuration=json.dumps(
            [
                {"name": "country", "description": "Country", "form": ToolParameter.ToolParameterForm.FORM.value},
                {"name": "files", "description": "files", "form": ToolParameter.ToolParameterForm.FORM.value},
            ]
        )
    )
    user = _account()
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
        tool = controller._get_db_provider_tool(db_provider, app, session=session, user=user)

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


def test_from_db_builds_controller():
    app = _app()
    user = _account()
    db_provider = _db_provider()
    session = _mock_session_with_begin()
    session.scalar.return_value = db_provider
    session.get.side_effect = [app, user]
    fake_cm = MagicMock()
    fake_cm.__enter__.return_value = session
    fake_cm.__exit__.return_value = False
    fake_session_factory = Mock()
    fake_session_factory.create_session.return_value = fake_cm

    with patch("core.tools.workflow_as_tool.provider.session_factory", fake_session_factory):
        with patch.object(
            WorkflowToolProviderController,
            "_get_db_provider_tool",
            return_value=_workflow_tool("wf"),
        ):
            built = WorkflowToolProviderController.from_db(db_provider)
    assert isinstance(built, WorkflowToolProviderController)
    assert built.tools


def test_get_tools_returns_empty_when_provider_missing():
    controller = _controller()
    controller.tools = None

    with patch("core.tools.workflow_as_tool.provider.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.workflow_as_tool.provider.Session") as session_cls:
            session = _mock_session_with_begin()
            session.scalar.return_value = None
            session_cls.return_value.__enter__.return_value = session

            assert controller.get_tools("tenant-1") == []


def test_get_tools_raises_when_app_missing():
    controller = _controller()
    controller.tools = None
    db_provider = _db_provider()

    with patch("core.tools.workflow_as_tool.provider.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.workflow_as_tool.provider.Session") as session_cls:
            session = _mock_session_with_begin()
            session.scalar.return_value = db_provider
            session.get.return_value = None
            session_cls.return_value.__enter__.return_value = session
            with pytest.raises(ValueError, match="app not found"):
                controller.get_tools("tenant-1")
