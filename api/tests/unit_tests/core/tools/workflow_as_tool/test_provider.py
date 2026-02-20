from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolParameter,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController


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


def test_workflow_provider_get_db_provider_tool_and_get_tool():
    controller = _controller()
    session = Mock()
    workflow = SimpleNamespace(graph_dict={"nodes": []}, features_dict={})
    session.query.return_value.where.return_value.first.return_value = workflow
    app = SimpleNamespace(id="app-1")
    db_provider = SimpleNamespace(
        id="provider-1",
        app_id="app-1",
        version="1",
        label="WF Provider",
        description="desc",
        icon="icon.svg",
        name="workflow_tool",
        tenant_id="tenant-1",
        user_id="user-1",
        parameter_configurations=[
            SimpleNamespace(name="country", description="Country", form=ToolParameter.ToolParameterForm.FORM),
            SimpleNamespace(name="files", description="files", form=ToolParameter.ToolParameterForm.FORM),
        ],
    )
    user = SimpleNamespace(name="Alice")
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

    with patch("core.tools.workflow_as_tool.provider.WorkflowAppConfigManager.convert_features") as mock_features:
        mock_features.return_value = SimpleNamespace(file_upload=True)
        with patch(
            "core.tools.workflow_as_tool.provider.WorkflowToolConfigurationUtils.get_workflow_graph_variables",
            return_value=variables,
        ):
            with patch(
                "core.tools.workflow_as_tool.provider.WorkflowToolConfigurationUtils.get_workflow_graph_output",
                return_value=outputs,
            ):
                tool = controller._get_db_provider_tool(db_provider, app, session=session, user=user)

    assert tool.entity.identity.name == "workflow_tool"
    assert tool.entity.output_schema["properties"] == {"answer": {"type": "string", "description": ""}}
    assert tool.entity.parameters[0].type == ToolParameter.ToolParameterType.SELECT
    assert tool.entity.parameters[1].type == ToolParameter.ToolParameterType.SYSTEM_FILES
    assert controller.provider_type == ToolProviderType.WORKFLOW

    controller.tools = [tool]
    assert controller.get_tool("workflow_tool") is tool
    assert controller.get_tool("missing") is None


def test_workflow_provider_from_db_and_get_tools_branches():
    controller = _controller()
    cached_tools = [SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(name="wf-cached")))]
    controller.tools = cached_tools  # type: ignore[assignment]
    assert controller.get_tools("tenant-1") == cached_tools

    app = SimpleNamespace(id="app-1")
    user = SimpleNamespace(name="Alice")
    db_provider = SimpleNamespace(
        id="provider-1",
        app_id="app-1",
        version="1",
        user_id="user-1",
        label="WF Provider",
        description="desc",
        icon="icon.svg",
        name="workflow_tool",
        tenant_id="tenant-1",
        parameter_configurations=[],
    )
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = db_provider
    session.get.side_effect = [app, user]
    begin_cm = Mock()
    begin_cm.__enter__ = Mock(return_value=None)
    begin_cm.__exit__ = Mock(return_value=False)
    session.begin.return_value = begin_cm
    fake_cm = Mock()
    fake_cm.__enter__ = Mock(return_value=session)
    fake_cm.__exit__ = Mock(return_value=False)
    fake_session_factory = Mock()
    fake_session_factory.create_session.return_value = fake_cm

    with patch("core.tools.workflow_as_tool.provider.session_factory", fake_session_factory):
        with patch.object(
            WorkflowToolProviderController,
            "_get_db_provider_tool",
            return_value=SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(name="wf"))),
        ):
            built = WorkflowToolProviderController.from_db(db_provider)
    assert isinstance(built, WorkflowToolProviderController)
    assert built.tools

    # get_tools with db provider not found branch
    controller.tools = None  # type: ignore[assignment]
    with patch("core.tools.workflow_as_tool.provider.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.workflow_as_tool.provider.Session") as session_cls:
            s = Mock()
            begin_cm = Mock()
            begin_cm.__enter__ = Mock(return_value=None)
            begin_cm.__exit__ = Mock(return_value=False)
            s.begin.return_value = begin_cm
            s.query.return_value.where.return_value.first.return_value = None
            session_cls.return_value.__enter__.return_value = s
            assert controller.get_tools("tenant-1") == []

    # app not found branch
    controller.tools = None  # type: ignore[assignment]
    with patch("core.tools.workflow_as_tool.provider.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.workflow_as_tool.provider.Session") as session_cls:
            s = Mock()
            begin_cm = Mock()
            begin_cm.__enter__ = Mock(return_value=None)
            begin_cm.__exit__ = Mock(return_value=False)
            s.begin.return_value = begin_cm
            s.query.return_value.where.return_value.first.return_value = db_provider
            s.get.return_value = None
            session_cls.return_value.__enter__.return_value = s
            with pytest.raises(ValueError, match="app not found"):
                controller.get_tools("tenant-1")
