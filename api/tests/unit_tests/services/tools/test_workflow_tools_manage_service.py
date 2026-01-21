import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.tools.errors import WorkflowToolHumanInputNotSupportedError
from models.model import App
from models.tools import WorkflowToolProvider
from services.tools import workflow_tools_manage_service


class DummyWorkflow:
    def __init__(self, graph_dict: dict, version: str = "1.0.0") -> None:
        self._graph_dict = graph_dict
        self.version = version

    @property
    def graph_dict(self) -> dict:
        return self._graph_dict


class FakeQuery:
    def __init__(self, result):
        self._result = result

    def where(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class DummySession:
    def __init__(self) -> None:
        self.added: list[object] = []

    def add(self, obj) -> None:
        self.added.append(obj)

    def begin(self):
        return DummyBegin(self)


class DummyBegin:
    def __init__(self, session: DummySession) -> None:
        self._session = session

    def __enter__(self) -> DummySession:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class DummySessionContext:
    def __init__(self, session: DummySession) -> None:
        self._session = session

    def __enter__(self) -> DummySession:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class DummySessionFactory:
    def __init__(self, session: DummySession) -> None:
        self._session = session

    def create_session(self) -> DummySessionContext:
        return DummySessionContext(self._session)


def _build_fake_session(app) -> SimpleNamespace:
    def query(model):
        if model is WorkflowToolProvider:
            return FakeQuery(None)
        if model is App:
            return FakeQuery(app)
        return FakeQuery(None)

    return SimpleNamespace(query=query)


def test_create_workflow_tool_rejects_human_input_nodes(monkeypatch):
    workflow = DummyWorkflow(graph_dict={"nodes": [{"id": "node_1", "data": {"type": "human-input"}}]})
    app = SimpleNamespace(workflow=workflow)

    fake_session = _build_fake_session(app)
    monkeypatch.setattr(workflow_tools_manage_service.db, "session", fake_session)

    mock_from_db = MagicMock()
    monkeypatch.setattr(workflow_tools_manage_service.WorkflowToolProviderController, "from_db", mock_from_db)
    mock_invalidate = MagicMock()
    monkeypatch.setattr(workflow_tools_manage_service.ToolProviderListCache, "invalidate_cache", mock_invalidate)

    parameters = [{"name": "input", "description": "input", "form": "form"}]

    with pytest.raises(WorkflowToolHumanInputNotSupportedError) as exc_info:
        workflow_tools_manage_service.WorkflowToolManageService.create_workflow_tool(
            user_id="user-id",
            tenant_id="tenant-id",
            workflow_app_id="app-id",
            name="tool_name",
            label="Tool",
            icon={"type": "emoji", "emoji": "tool"},
            description="desc",
            parameters=parameters,
        )

    assert exc_info.value.error_code == "workflow_tool_human_input_not_supported"
    mock_from_db.assert_not_called()
    mock_invalidate.assert_not_called()


def test_create_workflow_tool_success(monkeypatch):
    workflow = DummyWorkflow(graph_dict={"nodes": [{"id": "node_1", "data": {"type": "start"}}]})
    app = SimpleNamespace(workflow=workflow)

    fake_session = _build_fake_session(app)
    monkeypatch.setattr(workflow_tools_manage_service.db, "session", fake_session)

    dummy_session = DummySession()
    monkeypatch.setattr(workflow_tools_manage_service, "session_factory", DummySessionFactory(dummy_session))

    mock_from_db = MagicMock()
    monkeypatch.setattr(workflow_tools_manage_service.WorkflowToolProviderController, "from_db", mock_from_db)
    mock_invalidate = MagicMock()
    monkeypatch.setattr(workflow_tools_manage_service.ToolProviderListCache, "invalidate_cache", mock_invalidate)

    parameters = [{"name": "input", "description": "input", "form": "form"}]
    icon = {"type": "emoji", "emoji": "tool"}

    result = workflow_tools_manage_service.WorkflowToolManageService.create_workflow_tool(
        user_id="user-id",
        tenant_id="tenant-id",
        workflow_app_id="app-id",
        name="tool_name",
        label="Tool",
        icon=icon,
        description="desc",
        parameters=parameters,
    )

    assert result == {"result": "success"}
    assert len(dummy_session.added) == 1
    created_provider = dummy_session.added[0]
    assert created_provider.name == "tool_name"
    assert created_provider.label == "Tool"
    assert created_provider.icon == json.dumps(icon)
    assert created_provider.version == workflow.version
    mock_from_db.assert_called_once()
    mock_invalidate.assert_called_once_with("tenant-id")
