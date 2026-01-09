from unittest.mock import MagicMock, patch

import pytest

from core.app.layers.sandbox_layer import SandboxInitializationError, SandboxLayer
from core.virtual_environment.__base.entities import Arch
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.sandbox_manager import SandboxManager
from core.workflow.graph_engine.layers.base import GraphEngineLayerNotInitializedError
from core.workflow.graph_events.graph import (
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)


class MockMetadata:
    def __init__(self, sandbox_id: str = "test-sandbox-id", arch: Arch = Arch.AMD64):
        self.id = sandbox_id
        self.arch = arch


class MockVirtualEnvironment:
    def __init__(self, sandbox_id: str = "test-sandbox-id"):
        self.metadata = MockMetadata(sandbox_id=sandbox_id)
        self._released = False

    def release_environment(self) -> None:
        self._released = True


class MockSystemVariableView:
    def __init__(self, workflow_execution_id: str | None = "test-workflow-exec-id"):
        self._workflow_execution_id = workflow_execution_id

    @property
    def workflow_execution_id(self) -> str | None:
        return self._workflow_execution_id


class MockReadOnlyGraphRuntimeStateWrapper:
    def __init__(self, workflow_execution_id: str | None = "test-workflow-exec-id"):
        self._system_variable = MockSystemVariableView(workflow_execution_id)

    @property
    def system_variable(self) -> MockSystemVariableView:
        return self._system_variable


@pytest.fixture(autouse=True)
def clean_sandbox_manager():
    SandboxManager.clear()
    yield
    SandboxManager.clear()


class TestSandboxLayer:
    def test_init_with_parameters(self):
        layer = SandboxLayer(
            tenant_id="test-tenant",
            options={"base_working_path": "/tmp/sandbox"},
            environments={"PYTHONUNBUFFERED": "1"},
        )

        assert layer._tenant_id == "test-tenant"  # pyright: ignore[reportPrivateUsage]
        assert layer._options == {"base_working_path": "/tmp/sandbox"}  # pyright: ignore[reportPrivateUsage]
        assert layer._environments == {"PYTHONUNBUFFERED": "1"}  # pyright: ignore[reportPrivateUsage]
        assert layer._workflow_execution_id is None  # pyright: ignore[reportPrivateUsage]

    def test_sandbox_property_raises_when_not_initialized(self):
        layer = SandboxLayer(tenant_id="test-tenant")

        with pytest.raises(RuntimeError) as exc_info:
            _ = layer.sandbox

        assert "Sandbox not initialized" in str(exc_info.value)

    def test_sandbox_property_returns_sandbox_after_initialization(self):
        layer = SandboxLayer(tenant_id="test-tenant")
        mock_sandbox = MockVirtualEnvironment()
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper("test-exec-id")
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ):
            layer.on_graph_start()

        assert layer.sandbox is mock_sandbox

    def test_on_graph_start_creates_sandbox_and_registers_with_manager(self):
        layer = SandboxLayer(
            tenant_id="test-tenant-123",
            environments={"PATH": "/usr/bin"},
        )
        mock_sandbox = MockVirtualEnvironment()
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper("test-exec-123")
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ) as mock_create:
            layer.on_graph_start()

            mock_create.assert_called_once_with(
                tenant_id="test-tenant-123",
                environments={"PATH": "/usr/bin"},
            )

        assert SandboxManager.get("test-exec-123") is mock_sandbox

    def test_on_graph_start_raises_sandbox_initialization_error_on_failure(self):
        layer = SandboxLayer(tenant_id="test-tenant")
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper("test-exec-id")
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            side_effect=Exception("Sandbox provider not available"),
        ):
            with pytest.raises(SandboxInitializationError) as exc_info:
                layer.on_graph_start()

            assert "Failed to initialize sandbox" in str(exc_info.value)
            assert "Sandbox provider not available" in str(exc_info.value)

    def test_on_graph_start_raises_when_workflow_execution_id_not_set(self):
        layer = SandboxLayer(tenant_id="test-tenant")
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper(workflow_execution_id=None)
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with pytest.raises(RuntimeError) as exc_info:
            layer.on_graph_start()

        assert "workflow_execution_id is not set" in str(exc_info.value)

    def test_on_event_is_noop(self):
        layer = SandboxLayer(tenant_id="test-tenant")

        layer.on_event(GraphRunStartedEvent())
        layer.on_event(GraphRunSucceededEvent(outputs={}))
        layer.on_event(GraphRunFailedEvent(error="test error", exceptions_count=1))

    def test_on_graph_end_releases_sandbox_and_unregisters_from_manager(self):
        layer = SandboxLayer(tenant_id="test-tenant")
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()
        workflow_execution_id = "test-exec-456"
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper(workflow_execution_id)
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ):
            layer.on_graph_start()

        assert SandboxManager.has(workflow_execution_id)

        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()
        assert layer._workflow_execution_id is None  # pyright: ignore[reportPrivateUsage]
        assert not SandboxManager.has(workflow_execution_id)

    def test_on_graph_end_releases_sandbox_even_on_error(self):
        layer = SandboxLayer(tenant_id="test-tenant")
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()
        workflow_execution_id = "test-exec-789"
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper(workflow_execution_id)
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ):
            layer.on_graph_start()

        layer.on_graph_end(error=Exception("Workflow failed"))

        mock_sandbox.release_environment.assert_called_once()
        assert layer._workflow_execution_id is None  # pyright: ignore[reportPrivateUsage]
        assert not SandboxManager.has(workflow_execution_id)

    def test_on_graph_end_handles_release_failure_gracefully(self):
        layer = SandboxLayer(tenant_id="test-tenant")
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()
        mock_sandbox.release_environment.side_effect = Exception("Container already removed")
        workflow_execution_id = "test-exec-fail"
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper(workflow_execution_id)
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ):
            layer.on_graph_start()

        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()
        assert layer._workflow_execution_id is None  # pyright: ignore[reportPrivateUsage]

    def test_on_graph_end_noop_when_sandbox_not_initialized(self):
        layer = SandboxLayer(tenant_id="test-tenant")

        layer.on_graph_end(error=None)

        assert layer._workflow_execution_id is None  # pyright: ignore[reportPrivateUsage]

    def test_on_graph_end_is_idempotent(self):
        layer = SandboxLayer(tenant_id="test-tenant")
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()
        workflow_execution_id = "test-exec-idempotent"
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper(workflow_execution_id)
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ):
            layer.on_graph_start()

        layer.on_graph_end(error=None)
        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()

    def test_layer_inherits_from_graph_engine_layer(self):
        layer = SandboxLayer(tenant_id="test-tenant")

        with pytest.raises(GraphEngineLayerNotInitializedError):
            _ = layer.graph_runtime_state

        assert layer.command_channel is None


class TestSandboxLayerIntegration:
    def test_full_lifecycle_with_mocked_provider(self):
        layer = SandboxLayer(tenant_id="integration-tenant")
        workflow_execution_id = "integration-test-exec"
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper(workflow_execution_id)
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata(sandbox_id="integration-sandbox")

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ):
            layer.on_graph_start()

        assert layer._workflow_execution_id == workflow_execution_id  # pyright: ignore[reportPrivateUsage]
        assert layer.sandbox is mock_sandbox
        assert SandboxManager.get(workflow_execution_id) is mock_sandbox

        layer.on_graph_end(error=None)

        assert layer._workflow_execution_id is None  # pyright: ignore[reportPrivateUsage]
        assert not SandboxManager.has(workflow_execution_id)
        mock_sandbox.release_environment.assert_called_once()

    def test_lifecycle_with_workflow_error(self):
        layer = SandboxLayer(tenant_id="error-tenant")
        workflow_execution_id = "integration-error-test"
        mock_runtime_state = MockReadOnlyGraphRuntimeStateWrapper(workflow_execution_id)
        layer._graph_runtime_state = mock_runtime_state  # type: ignore[assignment]
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox",
            return_value=mock_sandbox,
        ):
            layer.on_graph_start()

        assert layer.sandbox.metadata.id is not None

        layer.on_graph_end(error=Exception("Workflow execution failed"))

        assert layer._workflow_execution_id is None  # pyright: ignore[reportPrivateUsage]
        assert not SandboxManager.has(workflow_execution_id)
        mock_sandbox.release_environment.assert_called_once()
