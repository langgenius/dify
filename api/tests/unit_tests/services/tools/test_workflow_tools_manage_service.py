"""
Unit tests for services.tools.workflow_tools_manage_service

Covers WorkflowToolManageService: create, update, list, delete, get, list_single.
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.tools.entities.tool_entities import ToolParameter, WorkflowToolParameterConfiguration
from core.tools.errors import WorkflowToolHumanInputNotSupportedError
from models.model import App
from models.tools import WorkflowToolProvider
from services.tools import workflow_tools_manage_service
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

# ---------------------------------------------------------------------------
# Shared helpers / fake infrastructure
# ---------------------------------------------------------------------------


class DummyWorkflow:
    """Minimal in-memory Workflow substitute."""

    def __init__(self, graph_dict: dict, version: str = "1.0.0") -> None:
        self._graph_dict = graph_dict
        self.version = version

    @property
    def graph_dict(self) -> dict:
        return self._graph_dict


class FakeQuery:
    """Chainable query object that always returns a fixed result."""

    def __init__(self, result: object) -> None:
        self._result = result

    def where(self, *args: object, **kwargs: object) -> "FakeQuery":
        return self

    def first(self) -> object:
        return self._result

    def delete(self) -> int:
        return 1


class DummySession:
    """Minimal SQLAlchemy session substitute."""

    def __init__(self) -> None:
        self.added: list[WorkflowToolProvider] = []
        self.committed: bool = False

    def __enter__(self) -> "DummySession":
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
        return False

    def add(self, obj: WorkflowToolProvider) -> None:
        self.added.append(obj)

    def begin(self) -> "DummySession":
        return self

    def commit(self) -> None:
        self.committed = True


def _build_parameters() -> list[WorkflowToolParameterConfiguration]:
    return [
        WorkflowToolParameterConfiguration(name="input", description="input", form=ToolParameter.ToolParameterForm.LLM),
    ]


def _build_fake_db(
    *,
    existing_tool: WorkflowToolProvider | None = None,
    app: object | None = None,
    tool_by_id: WorkflowToolProvider | None = None,
) -> tuple[MagicMock, DummySession]:
    """
    Build a fake db object plus a DummySession for Session context-manager.

    query(WorkflowToolProvider) returns existing_tool on first call,
    then tool_by_id on subsequent calls (or None if not provided).
    query(App) returns app.
    """
    call_counts: dict[str, int] = {"wftp": 0}

    def query(model: type) -> FakeQuery:
        if model is WorkflowToolProvider:
            call_counts["wftp"] += 1
            if call_counts["wftp"] == 1:
                return FakeQuery(existing_tool)
            return FakeQuery(tool_by_id)
        if model is App:
            return FakeQuery(app)
        return FakeQuery(None)

    fake_db = MagicMock()
    fake_db.session = SimpleNamespace(query=query, commit=MagicMock())
    dummy_session = DummySession()
    return fake_db, dummy_session


# ---------------------------------------------------------------------------
# TestCreateWorkflowTool
# ---------------------------------------------------------------------------


class TestCreateWorkflowTool:
    """Tests for WorkflowToolManageService.create_workflow_tool."""

    def test_should_raise_when_human_input_nodes_present(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Human-input nodes must be rejected before any provider is created."""
        # Arrange
        workflow = DummyWorkflow(graph_dict={"nodes": [{"id": "n1", "data": {"type": "human-input"}}]})
        app = SimpleNamespace(workflow=workflow)
        fake_session = SimpleNamespace(query=lambda m: FakeQuery(None) if m is WorkflowToolProvider else FakeQuery(app))
        monkeypatch.setattr(workflow_tools_manage_service.db, "session", fake_session)
        mock_from_db = MagicMock()
        monkeypatch.setattr(workflow_tools_manage_service.WorkflowToolProviderController, "from_db", mock_from_db)

        # Act + Assert
        with pytest.raises(WorkflowToolHumanInputNotSupportedError) as exc_info:
            WorkflowToolManageService.create_workflow_tool(
                user_id="user-id",
                tenant_id="tenant-id",
                workflow_app_id="app-id",
                name="tool_name",
                label="Tool",
                icon={"type": "emoji", "emoji": "🔧"},
                description="desc",
                parameters=_build_parameters(),
            )

        assert exc_info.value.error_code == "workflow_tool_human_input_not_supported"
        mock_from_db.assert_not_called()

    def test_should_raise_when_duplicate_name_or_app_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Existing provider with same name or app_id raises ValueError."""
        # Arrange
        existing = MagicMock(spec=WorkflowToolProvider)
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(existing)),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="already exists"):
            WorkflowToolManageService.create_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_app_id="app-1",
                name="dup",
                label="Dup",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_raise_when_app_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the referenced App does not exist."""
        # Arrange
        call_count = {"n": 0}

        def query(m: type) -> FakeQuery:
            call_count["n"] += 1
            if m is WorkflowToolProvider:
                return FakeQuery(None)
            return FakeQuery(None)  # App returns None

        monkeypatch.setattr(workflow_tools_manage_service.db, "session", SimpleNamespace(query=query))

        # Act + Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowToolManageService.create_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_app_id="missing-app",
                name="n",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_raise_when_workflow_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the App has no attached Workflow."""
        # Arrange
        app_no_workflow = SimpleNamespace(workflow=None)

        def query(m: type) -> FakeQuery:
            if m is WorkflowToolProvider:
                return FakeQuery(None)
            return FakeQuery(app_no_workflow)

        monkeypatch.setattr(workflow_tools_manage_service.db, "session", SimpleNamespace(query=query))

        # Act + Assert
        with pytest.raises(ValueError, match="Workflow not found"):
            WorkflowToolManageService.create_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_app_id="app-id",
                name="n",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_raise_when_from_db_fails(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Exceptions from WorkflowToolProviderController.from_db are wrapped as ValueError."""
        # Arrange
        workflow = DummyWorkflow(graph_dict={"nodes": []})
        app = SimpleNamespace(workflow=workflow)

        def query(m: type) -> FakeQuery:
            if m is WorkflowToolProvider:
                return FakeQuery(None)
            return FakeQuery(app)

        fake_db = MagicMock()
        fake_db.session = SimpleNamespace(query=query)
        monkeypatch.setattr(workflow_tools_manage_service, "db", fake_db)
        dummy_session = DummySession()
        monkeypatch.setattr(workflow_tools_manage_service, "Session", lambda *_, **__: dummy_session)
        monkeypatch.setattr(
            workflow_tools_manage_service.WorkflowToolProviderController,
            "from_db",
            MagicMock(side_effect=RuntimeError("bad config")),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="bad config"):
            WorkflowToolManageService.create_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_app_id="app-id",
                name="n",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_succeed_and_persist_provider(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Happy path: provider is added to session and success dict is returned."""
        # Arrange
        workflow = DummyWorkflow(graph_dict={"nodes": []}, version="2.0.0")
        app = SimpleNamespace(workflow=workflow)

        def query(m: type) -> FakeQuery:
            if m is WorkflowToolProvider:
                return FakeQuery(None)
            return FakeQuery(app)

        fake_db = MagicMock()
        fake_db.session = SimpleNamespace(query=query)
        monkeypatch.setattr(workflow_tools_manage_service, "db", fake_db)
        dummy_session = DummySession()
        monkeypatch.setattr(workflow_tools_manage_service, "Session", lambda *_, **__: dummy_session)
        monkeypatch.setattr(workflow_tools_manage_service.WorkflowToolProviderController, "from_db", MagicMock())

        icon = {"type": "emoji", "emoji": "🔧"}

        # Act
        result = WorkflowToolManageService.create_workflow_tool(
            user_id="user-id",
            tenant_id="tenant-id",
            workflow_app_id="app-id",
            name="tool_name",
            label="Tool",
            icon=icon,
            description="desc",
            parameters=_build_parameters(),
        )

        # Assert
        assert result == {"result": "success"}
        assert len(dummy_session.added) == 1
        created: WorkflowToolProvider = dummy_session.added[0]
        assert created.name == "tool_name"
        assert created.label == "Tool"
        assert created.icon == json.dumps(icon)
        assert created.version == "2.0.0"

    def test_should_call_label_manager_when_labels_provided(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Labels are forwarded to ToolLabelManager when provided."""
        # Arrange
        workflow = DummyWorkflow(graph_dict={"nodes": []})
        app = SimpleNamespace(workflow=workflow)

        def query(m: type) -> FakeQuery:
            if m is WorkflowToolProvider:
                return FakeQuery(None)
            return FakeQuery(app)

        fake_db = MagicMock()
        fake_db.session = SimpleNamespace(query=query)
        monkeypatch.setattr(workflow_tools_manage_service, "db", fake_db)
        dummy_session = DummySession()
        monkeypatch.setattr(workflow_tools_manage_service, "Session", lambda *_, **__: dummy_session)
        monkeypatch.setattr(workflow_tools_manage_service.WorkflowToolProviderController, "from_db", MagicMock())
        mock_label_mgr = MagicMock()
        monkeypatch.setattr(workflow_tools_manage_service.ToolLabelManager, "update_tool_labels", mock_label_mgr)
        mock_to_ctrl = MagicMock()
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService, "workflow_provider_to_controller", mock_to_ctrl
        )

        # Act
        WorkflowToolManageService.create_workflow_tool(
            user_id="u",
            tenant_id="t",
            workflow_app_id="app-id",
            name="n",
            label="L",
            icon={},
            description="",
            parameters=[],
            labels=["tag1", "tag2"],
        )

        # Assert
        mock_label_mgr.assert_called_once()


# ---------------------------------------------------------------------------
# TestUpdateWorkflowTool
# ---------------------------------------------------------------------------


class TestUpdateWorkflowTool:
    """Tests for WorkflowToolManageService.update_workflow_tool."""

    def _make_provider(self) -> WorkflowToolProvider:
        p = MagicMock(spec=WorkflowToolProvider)
        p.app_id = "app-id"
        p.tenant_id = "tenant-id"
        return p

    def test_should_raise_when_name_duplicated(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """If another tool with the given name already exists, raise ValueError."""
        # Arrange
        existing = MagicMock(spec=WorkflowToolProvider)

        def query(m: type) -> FakeQuery:
            return FakeQuery(existing)

        monkeypatch.setattr(workflow_tools_manage_service.db, "session", SimpleNamespace(query=query))

        # Act + Assert
        with pytest.raises(ValueError, match="already exists"):
            WorkflowToolManageService.update_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_tool_id="tool-1",
                name="dup",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_raise_when_tool_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the workflow tool to update does not exist."""
        # Arrange
        call_count = {"n": 0}

        def query(m: type) -> FakeQuery:
            call_count["n"] += 1
            # 1st call: name uniqueness check → None (no duplicate)
            # 2nd call: fetch tool by id → None (not found)
            return FakeQuery(None)

        monkeypatch.setattr(workflow_tools_manage_service.db, "session", SimpleNamespace(query=query))

        # Act + Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowToolManageService.update_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_tool_id="missing",
                name="n",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_raise_when_app_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the tool's referenced App has been removed."""
        # Arrange
        provider = self._make_provider()
        call_count = {"n": 0}

        def query(m: type) -> FakeQuery:
            call_count["n"] += 1
            if m is WorkflowToolProvider:
                # 1st: duplicate name check (None), 2nd: fetch provider
                return FakeQuery(None) if call_count["n"] == 1 else FakeQuery(provider)
            return FakeQuery(None)  # App not found

        monkeypatch.setattr(workflow_tools_manage_service.db, "session", SimpleNamespace(query=query))

        # Act + Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowToolManageService.update_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_tool_id="tool-1",
                name="n",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_raise_when_workflow_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the App exists but has no Workflow."""
        # Arrange
        provider = self._make_provider()
        app_no_wf = SimpleNamespace(workflow=None)
        call_count = {"n": 0}

        def query(m: type) -> FakeQuery:
            call_count["n"] += 1
            if m is WorkflowToolProvider:
                return FakeQuery(None) if call_count["n"] == 1 else FakeQuery(provider)
            return FakeQuery(app_no_wf)

        monkeypatch.setattr(workflow_tools_manage_service.db, "session", SimpleNamespace(query=query))

        # Act + Assert
        with pytest.raises(ValueError, match="Workflow not found"):
            WorkflowToolManageService.update_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_tool_id="tool-1",
                name="n",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_raise_when_from_db_fails(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Exceptions from from_db are re-raised as ValueError."""
        # Arrange
        provider = self._make_provider()
        workflow = DummyWorkflow(graph_dict={"nodes": []})
        app = SimpleNamespace(workflow=workflow)
        call_count = {"n": 0}

        def query(m: type) -> FakeQuery:
            call_count["n"] += 1
            if m is WorkflowToolProvider:
                return FakeQuery(None) if call_count["n"] == 1 else FakeQuery(provider)
            return FakeQuery(app)

        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=query, commit=MagicMock()),
        )
        monkeypatch.setattr(
            workflow_tools_manage_service.WorkflowToolProviderController,
            "from_db",
            MagicMock(side_effect=RuntimeError("from_db error")),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="from_db error"):
            WorkflowToolManageService.update_workflow_tool(
                user_id="u",
                tenant_id="t",
                workflow_tool_id="tool-1",
                name="n",
                label="L",
                icon={},
                description="",
                parameters=[],
            )

    def test_should_succeed_and_call_commit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Happy path: provider fields are updated and session committed."""
        # Arrange
        provider = self._make_provider()
        workflow = DummyWorkflow(graph_dict={"nodes": []}, version="3.0.0")
        app = SimpleNamespace(workflow=workflow)
        call_count = {"n": 0}

        def query(m: type) -> FakeQuery:
            call_count["n"] += 1
            if m is WorkflowToolProvider:
                return FakeQuery(None) if call_count["n"] == 1 else FakeQuery(provider)
            return FakeQuery(app)

        mock_commit = MagicMock()
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=query, commit=mock_commit),
        )
        monkeypatch.setattr(workflow_tools_manage_service.WorkflowToolProviderController, "from_db", MagicMock())

        icon = {"type": "emoji", "emoji": "🛠"}

        # Act
        result = WorkflowToolManageService.update_workflow_tool(
            user_id="u",
            tenant_id="t",
            workflow_tool_id="tool-1",
            name="new_name",
            label="New Label",
            icon=icon,
            description="new desc",
            parameters=_build_parameters(),
        )

        # Assert
        assert result == {"result": "success"}
        mock_commit.assert_called_once()
        assert provider.name == "new_name"
        assert provider.label == "New Label"
        assert provider.icon == json.dumps(icon)
        assert provider.version == "3.0.0"

    def test_should_call_label_manager_when_labels_provided(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Labels are forwarded to ToolLabelManager during update."""
        # Arrange
        provider = self._make_provider()
        workflow = DummyWorkflow(graph_dict={"nodes": []})
        app = SimpleNamespace(workflow=workflow)
        call_count = {"n": 0}

        def query(m: type) -> FakeQuery:
            call_count["n"] += 1
            if m is WorkflowToolProvider:
                return FakeQuery(None) if call_count["n"] == 1 else FakeQuery(provider)
            return FakeQuery(app)

        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=query, commit=MagicMock()),
        )
        monkeypatch.setattr(workflow_tools_manage_service.WorkflowToolProviderController, "from_db", MagicMock())
        mock_label_mgr = MagicMock()
        monkeypatch.setattr(workflow_tools_manage_service.ToolLabelManager, "update_tool_labels", mock_label_mgr)
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService, "workflow_provider_to_controller", MagicMock()
        )

        # Act
        WorkflowToolManageService.update_workflow_tool(
            user_id="u",
            tenant_id="t",
            workflow_tool_id="tool-1",
            name="n",
            label="L",
            icon={},
            description="",
            parameters=[],
            labels=["a"],
        )

        # Assert
        mock_label_mgr.assert_called_once()


# ---------------------------------------------------------------------------
# TestListTenantWorkflowTools
# ---------------------------------------------------------------------------


class TestListTenantWorkflowTools:
    """Tests for WorkflowToolManageService.list_tenant_workflow_tools."""

    def test_should_return_empty_list_when_no_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """An empty database yields an empty result list."""
        # Arrange
        fake_scalars = MagicMock()
        fake_scalars.all.return_value = []
        fake_db = MagicMock()
        fake_db.session.scalars.return_value = fake_scalars
        monkeypatch.setattr(workflow_tools_manage_service, "db", fake_db)

        # Act
        result = WorkflowToolManageService.list_tenant_workflow_tools("u", "t")

        # Assert
        assert result == []

    def test_should_skip_broken_providers_and_log(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Providers that fail to load are logged and skipped."""
        # Arrange
        good_provider = MagicMock(spec=WorkflowToolProvider)
        good_provider.id = "good-id"
        good_provider.app_id = "app-good"
        bad_provider = MagicMock(spec=WorkflowToolProvider)
        bad_provider.id = "bad-id"
        bad_provider.app_id = "app-bad"

        fake_scalars = MagicMock()
        fake_scalars.all.return_value = [good_provider, bad_provider]
        fake_db = MagicMock()
        fake_db.session.scalars.return_value = fake_scalars
        monkeypatch.setattr(workflow_tools_manage_service, "db", fake_db)

        good_ctrl = MagicMock()
        good_ctrl.provider_id = "good-id"

        def to_controller(provider: WorkflowToolProvider) -> MagicMock:
            if provider is bad_provider:
                raise RuntimeError("broken provider")
            return good_ctrl

        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService, "workflow_provider_to_controller", to_controller
        )
        mock_get_labels = MagicMock(return_value={})
        monkeypatch.setattr(workflow_tools_manage_service.ToolLabelManager, "get_tools_labels", mock_get_labels)
        mock_to_user = MagicMock()
        mock_to_user.return_value.tools = []
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService, "workflow_provider_to_user_provider", mock_to_user
        )
        monkeypatch.setattr(workflow_tools_manage_service.ToolTransformService, "repack_provider", MagicMock())
        mock_get_tools = MagicMock(return_value=[MagicMock()])
        good_ctrl.get_tools = mock_get_tools
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService, "convert_tool_entity_to_api_entity", MagicMock()
        )

        # Act
        result = WorkflowToolManageService.list_tenant_workflow_tools("u", "t")

        # Assert - only good provider contributed
        assert len(result) == 1

    def test_should_return_tools_for_all_providers(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """All successfully loaded providers appear in the result."""
        # Arrange
        provider = MagicMock(spec=WorkflowToolProvider)
        provider.id = "p-1"
        provider.app_id = "app-1"

        fake_scalars = MagicMock()
        fake_scalars.all.return_value = [provider]
        fake_db = MagicMock()
        fake_db.session.scalars.return_value = fake_scalars
        monkeypatch.setattr(workflow_tools_manage_service, "db", fake_db)

        ctrl = MagicMock()
        ctrl.provider_id = "p-1"
        ctrl.get_tools.return_value = [MagicMock()]
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService,
            "workflow_provider_to_controller",
            MagicMock(return_value=ctrl),
        )
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolLabelManager, "get_tools_labels", MagicMock(return_value={"p-1": []})
        )
        user_provider = MagicMock()
        user_provider.tools = []
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService,
            "workflow_provider_to_user_provider",
            MagicMock(return_value=user_provider),
        )
        monkeypatch.setattr(workflow_tools_manage_service.ToolTransformService, "repack_provider", MagicMock())
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService, "convert_tool_entity_to_api_entity", MagicMock()
        )

        # Act
        result = WorkflowToolManageService.list_tenant_workflow_tools("u", "t")

        # Assert
        assert len(result) == 1
        assert result[0] is user_provider


# ---------------------------------------------------------------------------
# TestDeleteWorkflowTool
# ---------------------------------------------------------------------------


class TestDeleteWorkflowTool:
    """Tests for WorkflowToolManageService.delete_workflow_tool."""

    def test_should_delete_and_commit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """delete_workflow_tool queries, deletes, commits, and returns success."""
        # Arrange
        mock_query = MagicMock()
        mock_query.where.return_value.delete.return_value = 1
        mock_commit = MagicMock()
        fake_session = SimpleNamespace(query=lambda m: mock_query, commit=mock_commit)
        monkeypatch.setattr(workflow_tools_manage_service.db, "session", fake_session)

        # Act
        result = WorkflowToolManageService.delete_workflow_tool("u", "t", "tool-1")

        # Assert
        assert result == {"result": "success"}
        mock_commit.assert_called_once()


# ---------------------------------------------------------------------------
# TestGetWorkflowToolByToolId / ByAppId
# ---------------------------------------------------------------------------


class TestGetWorkflowToolByToolIdAndAppId:
    """Tests for get_workflow_tool_by_tool_id and get_workflow_tool_by_app_id."""

    def test_get_by_tool_id_should_raise_when_db_tool_is_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Raises ValueError when no WorkflowToolProvider found by tool id."""
        # Arrange
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(None)),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="Tool not found"):
            WorkflowToolManageService.get_workflow_tool_by_tool_id("u", "t", "missing")

    def test_get_by_app_id_should_raise_when_db_tool_is_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Raises ValueError when no WorkflowToolProvider found by app id."""
        # Arrange
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(None)),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="Tool not found"):
            WorkflowToolManageService.get_workflow_tool_by_app_id("u", "t", "missing-app")


# ---------------------------------------------------------------------------
# TestGetWorkflowTool (private _get_workflow_tool)
# ---------------------------------------------------------------------------


class TestGetWorkflowTool:
    """Tests for the internal _get_workflow_tool helper."""

    def test_should_raise_when_db_tool_none(self) -> None:
        """_get_workflow_tool raises ValueError when db_tool is None."""
        with pytest.raises(ValueError, match="Tool not found"):
            WorkflowToolManageService._get_workflow_tool("t", None)

    def test_should_raise_when_app_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the corresponding App row is missing."""
        # Arrange
        db_tool = MagicMock(spec=WorkflowToolProvider)
        db_tool.app_id = "app-1"
        db_tool.tenant_id = "t"
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(None)),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowToolManageService._get_workflow_tool("t", db_tool)

    def test_should_raise_when_workflow_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when App has no attached Workflow."""
        # Arrange
        db_tool = MagicMock(spec=WorkflowToolProvider)
        db_tool.app_id = "app-1"
        db_tool.tenant_id = "t"
        app = SimpleNamespace(workflow=None)
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(app)),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="Workflow not found"):
            WorkflowToolManageService._get_workflow_tool("t", db_tool)

    def test_should_raise_when_no_workflow_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the controller returns no WorkflowTool instances."""
        # Arrange
        db_tool = MagicMock(spec=WorkflowToolProvider)
        db_tool.app_id = "app-1"
        db_tool.tenant_id = "t"
        db_tool.id = "tool-1"
        workflow = DummyWorkflow(graph_dict={"nodes": []})
        app = SimpleNamespace(workflow=workflow)
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(app)),
        )
        ctrl = MagicMock()
        ctrl.get_tools.return_value = []
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService,
            "workflow_provider_to_controller",
            MagicMock(return_value=ctrl),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowToolManageService._get_workflow_tool("t", db_tool)

    def test_should_return_dict_on_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Happy path: returns a dict with name, label, icon, synced, etc."""
        # Arrange
        db_tool = MagicMock(spec=WorkflowToolProvider)
        db_tool.app_id = "app-1"
        db_tool.tenant_id = "t"
        db_tool.id = "tool-1"
        db_tool.name = "my_tool"
        db_tool.label = "My Tool"
        db_tool.icon = json.dumps({"emoji": "🔧"})
        db_tool.description = "some desc"
        db_tool.privacy_policy = ""
        db_tool.version = "1.0"
        db_tool.parameter_configurations = []
        workflow = DummyWorkflow(graph_dict={"nodes": []}, version="1.0")
        app = SimpleNamespace(workflow=workflow)
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(app)),
        )

        workflow_tool = MagicMock()
        workflow_tool.entity.output_schema = {"type": "object"}
        ctrl = MagicMock()
        ctrl.get_tools.return_value = [workflow_tool]
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService,
            "workflow_provider_to_controller",
            MagicMock(return_value=ctrl),
        )
        mock_convert = MagicMock(return_value={"tool": "api_entity"})
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService, "convert_tool_entity_to_api_entity", mock_convert
        )
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolLabelManager, "get_tool_labels", MagicMock(return_value=[])
        )

        # Act
        result = WorkflowToolManageService._get_workflow_tool("t", db_tool)

        # Assert
        assert result["name"] == "my_tool"
        assert result["label"] == "My Tool"
        assert result["synced"] is True
        assert "icon" in result
        assert "output_schema" in result


# ---------------------------------------------------------------------------
# TestListSingleWorkflowTools
# ---------------------------------------------------------------------------


class TestListSingleWorkflowTools:
    """Tests for WorkflowToolManageService.list_single_workflow_tools."""

    def test_should_raise_when_tool_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the specified tool does not exist in DB."""
        # Arrange
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(None)),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowToolManageService.list_single_workflow_tools("u", "t", "tool-1")

    def test_should_raise_when_no_workflow_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ValueError when the controller yields no tools for the provider."""
        # Arrange
        db_tool = MagicMock(spec=WorkflowToolProvider)
        db_tool.id = "tool-1"
        db_tool.tenant_id = "t"
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(db_tool)),
        )
        ctrl = MagicMock()
        ctrl.get_tools.return_value = []
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService,
            "workflow_provider_to_controller",
            MagicMock(return_value=ctrl),
        )

        # Act + Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowToolManageService.list_single_workflow_tools("u", "t", "tool-1")

    def test_should_return_api_entity_list(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Happy path: returns list with one ToolApiEntity."""
        # Arrange
        db_tool = MagicMock(spec=WorkflowToolProvider)
        db_tool.id = "tool-1"
        db_tool.tenant_id = "t"
        monkeypatch.setattr(
            workflow_tools_manage_service.db,
            "session",
            SimpleNamespace(query=lambda m: FakeQuery(db_tool)),
        )
        workflow_tool = MagicMock()
        ctrl = MagicMock()
        ctrl.get_tools.return_value = [workflow_tool]
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService,
            "workflow_provider_to_controller",
            MagicMock(return_value=ctrl),
        )
        api_entity = MagicMock()
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolTransformService,
            "convert_tool_entity_to_api_entity",
            MagicMock(return_value=api_entity),
        )
        monkeypatch.setattr(
            workflow_tools_manage_service.ToolLabelManager, "get_tool_labels", MagicMock(return_value=[])
        )

        # Act
        result = WorkflowToolManageService.list_single_workflow_tools("u", "t", "tool-1")

        # Assert
        assert result == [api_entity]
