import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.tools.entities.tool_entities import ToolParameter, WorkflowToolParameterConfiguration
from services.tools import workflow_tools_manage_service as service_module
from services.tools.workflow_tools_manage_service import WorkflowToolManageService


def _build_parameters() -> list[WorkflowToolParameterConfiguration]:
    return [
        WorkflowToolParameterConfiguration(
            name="query",
            description="input query",
            form=ToolParameter.ToolParameterForm.LLM,
        )
    ]


def _query_chain_with_first(first_result: Any) -> MagicMock:
    query = MagicMock()
    query.where.return_value.first.return_value = first_result
    return query


def test_create_workflow_tool_should_raise_when_name_or_app_already_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    existing = MagicMock()
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(existing)
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="already exists"):
        WorkflowToolManageService.create_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_app_id="app-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_create_workflow_tool_should_raise_when_app_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(None),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="App app-1 not found"):
        WorkflowToolManageService.create_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_app_id="app-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_create_workflow_tool_should_raise_when_workflow_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    app = SimpleNamespace(workflow=None)
    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(app),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="Workflow not found for app app-1"):
        WorkflowToolManageService.create_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_app_id="app-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_create_workflow_tool_should_raise_when_provider_controller_validation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    workflow = SimpleNamespace(graph_dict={"nodes": []}, version="1.2.3")
    app = SimpleNamespace(workflow=workflow)
    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(app),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)
    monkeypatch.setattr(
        service_module.WorkflowToolProviderController,
        "from_db",
        MagicMock(side_effect=RuntimeError("invalid provider")),
    )

    # Act / Assert
    with pytest.raises(ValueError, match="invalid provider"):
        WorkflowToolManageService.create_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_app_id="app-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_create_workflow_tool_should_persist_provider_and_update_labels(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    workflow = SimpleNamespace(graph_dict={"nodes": [{"data": {"type": "start"}}]}, version="2.0.0")
    app = SimpleNamespace(workflow=workflow)

    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(app),
    ]

    stored: list[Any] = []

    class _SessionContext:
        def __enter__(self) -> "_SessionContext":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def begin(self) -> "_SessionContext":
            return self

        def add(self, obj: Any) -> None:
            stored.append(obj)

    monkeypatch.setattr(service_module, "db", SimpleNamespace(session=db_session, engine=MagicMock()))
    monkeypatch.setattr(service_module, "Session", lambda *args, **kwargs: _SessionContext())
    monkeypatch.setattr(service_module.WorkflowToolProviderController, "from_db", MagicMock(return_value=MagicMock()))

    workflow_controller = MagicMock()
    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_controller", MagicMock(return_value=workflow_controller))
    update_labels_mock = MagicMock()
    monkeypatch.setattr(service_module.ToolLabelManager, "update_tool_labels", update_labels_mock)

    # Act
    result = WorkflowToolManageService.create_workflow_tool(
        user_id="user-1",
        tenant_id="tenant-1",
        workflow_app_id="app-1",
        name="tool-a",
        label="Tool A",
        icon={"type": "emoji", "content": "A"},
        description="desc",
        parameters=_build_parameters(),
        privacy_policy="privacy",
        labels=["automation"],
    )

    # Assert
    assert result == {"result": "success"}
    assert len(stored) == 1
    assert stored[0].name == "tool-a"
    assert stored[0].icon == json.dumps({"type": "emoji", "content": "A"})
    assert stored[0].version == "2.0.0"
    update_labels_mock.assert_called_once_with(workflow_controller, ["automation"])


def test_update_workflow_tool_should_raise_when_name_conflicts(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(MagicMock())
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="already exists"):
        WorkflowToolManageService.update_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_tool_id="tool-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_update_workflow_tool_should_raise_when_tool_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(None),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="Tool tool-1 not found"):
        WorkflowToolManageService.update_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_tool_id="tool-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_update_workflow_tool_should_raise_when_workflow_app_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    workflow_tool = SimpleNamespace(app_id="app-1", id="tool-1")
    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(workflow_tool),
        _query_chain_with_first(None),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="App app-1 not found"):
        WorkflowToolManageService.update_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_tool_id="tool-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_update_workflow_tool_should_raise_when_workflow_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    workflow_tool = SimpleNamespace(app_id="app-1", id="tool-1")
    app = SimpleNamespace(workflow=None)
    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(workflow_tool),
        _query_chain_with_first(app),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="Workflow not found"):
        WorkflowToolManageService.update_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_tool_id="tool-1",
            name="tool-a",
            label="Tool A",
            icon={"type": "emoji", "content": "A"},
            description="desc",
            parameters=_build_parameters(),
        )


def test_update_workflow_tool_should_raise_when_controller_validation_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    workflow = SimpleNamespace(graph_dict={"nodes": [{"data": {"type": "start"}}]}, version="2.0.0")
    workflow_tool = SimpleNamespace(
        app_id="app-1",
        id="tool-1",
        tenant_id="tenant-1",
        name="old",
        label="old",
        icon="{}",
        description="old",
        parameter_configuration="[]",
        privacy_policy="",
        version="1.0.0",
        updated_at=None,
    )
    app = SimpleNamespace(workflow=workflow)

    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(workflow_tool),
        _query_chain_with_first(app),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)
    monkeypatch.setattr(
        service_module.WorkflowToolProviderController,
        "from_db",
        MagicMock(side_effect=RuntimeError("broken config")),
    )

    # Act / Assert
    with pytest.raises(ValueError, match="broken config"):
        WorkflowToolManageService.update_workflow_tool(
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_tool_id="tool-1",
            name="tool-new",
            label="Tool New",
            icon={"type": "emoji", "content": "N"},
            description="new",
            parameters=_build_parameters(),
        )


def test_update_workflow_tool_should_update_fields_commit_and_labels(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    workflow = SimpleNamespace(graph_dict={"nodes": [{"data": {"type": "start"}}]}, version="3.0.0")
    workflow_tool = SimpleNamespace(
        app_id="app-1",
        id="tool-1",
        tenant_id="tenant-1",
        name="old",
        label="old",
        icon="{}",
        description="old",
        parameter_configuration="[]",
        privacy_policy="",
        version="1.0.0",
        updated_at=None,
    )
    app = SimpleNamespace(workflow=workflow)

    db_session = MagicMock()
    db_session.query.side_effect = [
        _query_chain_with_first(None),
        _query_chain_with_first(workflow_tool),
        _query_chain_with_first(app),
    ]
    monkeypatch.setattr(service_module.db, "session", db_session)
    monkeypatch.setattr(service_module.WorkflowToolProviderController, "from_db", MagicMock(return_value=MagicMock()))

    workflow_controller = MagicMock()
    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_controller", MagicMock(return_value=workflow_controller))
    update_labels_mock = MagicMock()
    monkeypatch.setattr(service_module.ToolLabelManager, "update_tool_labels", update_labels_mock)

    # Act
    result = WorkflowToolManageService.update_workflow_tool(
        user_id="user-1",
        tenant_id="tenant-1",
        workflow_tool_id="tool-1",
        name="tool-new",
        label="Tool New",
        icon={"type": "emoji", "content": "N"},
        description="new",
        parameters=_build_parameters(),
        privacy_policy="privacy",
        labels=["ops"],
    )

    # Assert
    assert result == {"result": "success"}
    assert workflow_tool.name == "tool-new"
    assert workflow_tool.label == "Tool New"
    assert workflow_tool.icon == json.dumps({"type": "emoji", "content": "N"})
    assert workflow_tool.version == "3.0.0"
    db_session.commit.assert_called_once()
    update_labels_mock.assert_called_once_with(workflow_controller, ["ops"])


def test_list_tenant_workflow_tools_should_skip_invalid_controller_and_build_result(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    provider_valid = SimpleNamespace(id="provider-1", app_id="app-1")
    provider_invalid = SimpleNamespace(id="provider-2", app_id="app-2")
    db_session = MagicMock()
    db_session.scalars.return_value.all.return_value = [provider_valid, provider_invalid]
    monkeypatch.setattr(service_module.db, "session", db_session)

    valid_controller = MagicMock()
    valid_controller.provider_id = "provider-1"
    valid_controller.get_tools.return_value = [MagicMock()]

    def _to_controller(provider: Any) -> Any:
        if provider.id == "provider-2":
            raise RuntimeError("deleted")
        return valid_controller

    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_controller", MagicMock(side_effect=_to_controller))
    monkeypatch.setattr(service_module.ToolLabelManager, "get_tools_labels", MagicMock(return_value={"provider-1": ["L"]}))

    user_provider = MagicMock()
    user_provider.tools = []
    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_user_provider", MagicMock(return_value=user_provider))
    monkeypatch.setattr(service_module.ToolTransformService, "repack_provider", MagicMock())
    monkeypatch.setattr(
        service_module.ToolTransformService,
        "convert_tool_entity_to_api_entity",
        MagicMock(return_value=MagicMock()),
    )
    logger_exception_mock = MagicMock()
    monkeypatch.setattr(service_module.logger, "exception", logger_exception_mock)

    # Act
    result = WorkflowToolManageService.list_tenant_workflow_tools(user_id="user-1", tenant_id="tenant-1")

    # Assert
    assert len(result) == 1
    assert result[0] is user_provider
    assert len(user_provider.tools) == 1
    logger_exception_mock.assert_called_once()


def test_delete_workflow_tool_should_delete_and_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    query = MagicMock()
    query.where.return_value.delete.return_value = 1
    db_session = MagicMock()
    db_session.query.return_value = query
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act
    result = WorkflowToolManageService.delete_workflow_tool(user_id="user-1", tenant_id="tenant-1", workflow_tool_id="tool-1")

    # Assert
    assert result == {"result": "success"}
    query.where.return_value.delete.assert_called_once()
    db_session.commit.assert_called_once()


def test_get_workflow_tool_by_tool_id_should_delegate_to_private_getter(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    provider = SimpleNamespace(id="tool-1")
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(provider)
    monkeypatch.setattr(service_module.db, "session", db_session)
    private_mock = MagicMock(return_value={"name": "tool"})
    monkeypatch.setattr(WorkflowToolManageService, "_get_workflow_tool", private_mock)

    # Act
    result = WorkflowToolManageService.get_workflow_tool_by_tool_id("user-1", "tenant-1", "tool-1")

    # Assert
    assert result == {"name": "tool"}
    private_mock.assert_called_once_with("tenant-1", provider)


def test_get_workflow_tool_by_app_id_should_delegate_to_private_getter(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    provider = SimpleNamespace(id="tool-1")
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(provider)
    monkeypatch.setattr(service_module.db, "session", db_session)
    private_mock = MagicMock(return_value={"name": "tool"})
    monkeypatch.setattr(WorkflowToolManageService, "_get_workflow_tool", private_mock)

    # Act
    result = WorkflowToolManageService.get_workflow_tool_by_app_id("user-1", "tenant-1", "app-1")

    # Assert
    assert result == {"name": "tool"}
    private_mock.assert_called_once_with("tenant-1", provider)


def test_get_workflow_tool_should_raise_when_db_tool_missing() -> None:
    # Arrange
    db_tool = None

    # Act / Assert
    with pytest.raises(ValueError, match="Tool not found"):
        WorkflowToolManageService._get_workflow_tool("tenant-1", db_tool)


def test_get_workflow_tool_should_raise_when_app_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_tool = SimpleNamespace(app_id="app-1", tenant_id="tenant-1", id="tool-1")
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(None)
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="App app-1 not found"):
        WorkflowToolManageService._get_workflow_tool("tenant-1", db_tool)


def test_get_workflow_tool_should_raise_when_workflow_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_tool = SimpleNamespace(app_id="app-1", tenant_id="tenant-1", id="tool-1")
    app = SimpleNamespace(workflow=None)
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(app)
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="Workflow not found"):
        WorkflowToolManageService._get_workflow_tool("tenant-1", db_tool)


def test_get_workflow_tool_should_raise_when_no_runtime_tools_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_tool = SimpleNamespace(app_id="app-1", tenant_id="tenant-1", id="tool-1")
    app = SimpleNamespace(workflow=SimpleNamespace(version="1.0.0"))
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(app)
    monkeypatch.setattr(service_module.db, "session", db_session)

    controller = MagicMock()
    controller.get_tools.return_value = []
    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_controller", MagicMock(return_value=controller))

    # Act / Assert
    with pytest.raises(ValueError, match="Tool tool-1 not found"):
        WorkflowToolManageService._get_workflow_tool("tenant-1", db_tool)


def test_get_workflow_tool_should_return_full_payload_for_synced_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_tool = SimpleNamespace(
        app_id="app-1",
        tenant_id="tenant-1",
        id="tool-1",
        name="tool-name",
        label="Tool Name",
        icon=json.dumps({"type": "emoji", "content": "A"}),
        description="desc",
        parameter_configurations=_build_parameters(),
        version="2.0.0",
        privacy_policy="privacy",
    )
    app = SimpleNamespace(workflow=SimpleNamespace(version="2.0.0"))
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(app)
    monkeypatch.setattr(service_module.db, "session", db_session)

    runtime_tool = MagicMock()
    runtime_tool.entity.output_schema = {"answer": {"type": "string"}}

    controller = MagicMock()
    controller.get_tools.return_value = [runtime_tool]
    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_controller", MagicMock(return_value=controller))
    monkeypatch.setattr(service_module.ToolLabelManager, "get_tool_labels", MagicMock(return_value=["ops"]))
    api_tool = MagicMock()
    monkeypatch.setattr(service_module.ToolTransformService, "convert_tool_entity_to_api_entity", MagicMock(return_value=api_tool))

    # Act
    result = WorkflowToolManageService._get_workflow_tool("tenant-1", db_tool)

    # Assert
    assert result["name"] == "tool-name"
    assert result["workflow_tool_id"] == "tool-1"
    assert result["workflow_app_id"] == "app-1"
    assert result["icon"] == {"type": "emoji", "content": "A"}
    assert result["output_schema"] == {"answer": {"type": "string"}}
    assert result["tool"] is api_tool
    assert result["synced"] is True


def test_list_single_workflow_tools_should_raise_when_tool_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(None)
    monkeypatch.setattr(service_module.db, "session", db_session)

    # Act / Assert
    with pytest.raises(ValueError, match="Tool tool-1 not found"):
        WorkflowToolManageService.list_single_workflow_tools("user-1", "tenant-1", "tool-1")


def test_list_single_workflow_tools_should_raise_when_controller_returns_no_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_tool = SimpleNamespace(id="tool-1", tenant_id="tenant-1")
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(db_tool)
    monkeypatch.setattr(service_module.db, "session", db_session)

    controller = MagicMock()
    controller.get_tools.return_value = []
    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_controller", MagicMock(return_value=controller))

    # Act / Assert
    with pytest.raises(ValueError, match="Tool tool-1 not found"):
        WorkflowToolManageService.list_single_workflow_tools("user-1", "tenant-1", "tool-1")


def test_list_single_workflow_tools_should_return_single_api_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_tool = SimpleNamespace(id="tool-1", tenant_id="tenant-1")
    db_session = MagicMock()
    db_session.query.return_value = _query_chain_with_first(db_tool)
    monkeypatch.setattr(service_module.db, "session", db_session)

    runtime_tool = MagicMock()
    controller = MagicMock()
    controller.get_tools.return_value = [runtime_tool]
    monkeypatch.setattr(service_module.ToolTransformService, "workflow_provider_to_controller", MagicMock(return_value=controller))
    monkeypatch.setattr(service_module.ToolLabelManager, "get_tool_labels", MagicMock(return_value=["ops"]))
    api_tool = MagicMock()
    monkeypatch.setattr(service_module.ToolTransformService, "convert_tool_entity_to_api_entity", MagicMock(return_value=api_tool))

    # Act
    result = WorkflowToolManageService.list_single_workflow_tools("user-1", "tenant-1", "tool-1")

    # Assert
    assert result == [api_tool]

