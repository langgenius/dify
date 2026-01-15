from unittest.mock import MagicMock, patch

import pytest

from core.app.layers.sandbox_layer import SandboxInitializationError, SandboxLayer
from core.sandbox import SandboxManager
from core.virtual_environment.__base.entities import Arch
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
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


class MockVMBuilder:
    def __init__(self, sandbox: VirtualEnvironment):
        self._sandbox = sandbox

    def environments(self, _):
        return self

    def initializer(self, _):
        return self

    def build(self):
        return self._sandbox


@pytest.fixture(autouse=True)
def clean_sandbox_manager():
    SandboxManager.clear()
    yield
    SandboxManager.clear()


@pytest.fixture
def mock_archive_storage():
    with patch("core.app.layers.sandbox_layer.ArchiveSandboxStorage") as mock_class:
        mock_instance = MagicMock()
        mock_instance.mount.return_value = False
        mock_instance.unmount.return_value = True
        mock_class.return_value = mock_instance
        yield mock_instance


def create_mock_builder(sandbox):
    return MockVMBuilder(sandbox)


class TestSandboxLayer:
    def test_init_with_parameters(self):
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id="test-sandbox")

        assert layer._tenant_id == "test-tenant"  # pyright: ignore[reportPrivateUsage]
        assert layer._app_id == "test-app"  # pyright: ignore[reportPrivateUsage]
        assert layer._sandbox_id == "test-sandbox"  # pyright: ignore[reportPrivateUsage]

    def test_sandbox_property_raises_when_not_initialized(self):
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id="test-sandbox")

        with pytest.raises(RuntimeError) as exc_info:
            _ = layer.sandbox

        assert "Sandbox not found" in str(exc_info.value)

    def test_sandbox_property_returns_sandbox_after_initialization(self, mock_archive_storage):
        sandbox_id = "test-exec-id"
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id=sandbox_id)
        mock_sandbox = MockVirtualEnvironment()

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ):
            layer.on_graph_start()

        assert layer.sandbox is mock_sandbox

    def test_on_graph_start_creates_sandbox_and_registers_with_manager(self, mock_archive_storage):
        sandbox_id = "test-exec-123"
        layer = SandboxLayer(tenant_id="test-tenant-123", app_id="test-app-123", sandbox_id=sandbox_id)
        mock_sandbox = MockVirtualEnvironment()

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ) as mock_create:
            layer.on_graph_start()
            mock_create.assert_called_once_with("test-tenant-123")

        assert SandboxManager.get(sandbox_id) is mock_sandbox

    def test_on_graph_start_raises_sandbox_initialization_error_on_failure(self):
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id="test-sandbox")

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            side_effect=Exception("Sandbox provider not available"),
        ):
            with pytest.raises(SandboxInitializationError) as exc_info:
                layer.on_graph_start()

            assert "Failed to initialize sandbox" in str(exc_info.value)
            assert "Sandbox provider not available" in str(exc_info.value)

    def test_on_event_is_noop(self):
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id="test-sandbox")

        layer.on_event(GraphRunStartedEvent())
        layer.on_event(GraphRunSucceededEvent(outputs={}))
        layer.on_event(GraphRunFailedEvent(error="test error", exceptions_count=1))

    def test_on_graph_end_releases_sandbox_and_unregisters_from_manager(self, mock_archive_storage):
        sandbox_id = "test-exec-456"
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id=sandbox_id)
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ):
            layer.on_graph_start()

        assert SandboxManager.has(sandbox_id)

        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()
        assert not SandboxManager.has(sandbox_id)

    def test_on_graph_end_releases_sandbox_even_on_error(self, mock_archive_storage):
        sandbox_id = "test-exec-789"
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id=sandbox_id)
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ):
            layer.on_graph_start()

        layer.on_graph_end(error=Exception("Workflow failed"))

        mock_sandbox.release_environment.assert_called_once()
        assert not SandboxManager.has(sandbox_id)

    def test_on_graph_end_handles_release_failure_gracefully(self, mock_archive_storage):
        sandbox_id = "test-exec-fail"
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id=sandbox_id)
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()
        mock_sandbox.release_environment.side_effect = Exception("Container already removed")

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ):
            layer.on_graph_start()

        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()

    def test_on_graph_end_noop_when_sandbox_not_registered(self):
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id="nonexistent-sandbox")

        layer.on_graph_end(error=None)

    def test_on_graph_end_is_idempotent(self, mock_archive_storage):
        sandbox_id = "test-exec-idempotent"
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id=sandbox_id)
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ):
            layer.on_graph_start()

        layer.on_graph_end(error=None)
        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()

    def test_layer_inherits_from_graph_engine_layer(self):
        layer = SandboxLayer(tenant_id="test-tenant", app_id="test-app", sandbox_id="test-sandbox")

        with pytest.raises(GraphEngineLayerNotInitializedError):
            _ = layer.graph_runtime_state

        assert layer.command_channel is None


class TestSandboxLayerIntegration:
    def test_full_lifecycle_with_mocked_provider(self, mock_archive_storage):
        sandbox_id = "integration-test-exec"
        layer = SandboxLayer(tenant_id="integration-tenant", app_id="integration-app", sandbox_id=sandbox_id)
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata(sandbox_id="integration-sandbox")

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ):
            layer.on_graph_start()

        assert layer.sandbox is mock_sandbox
        assert SandboxManager.get(sandbox_id) is mock_sandbox

        layer.on_graph_end(error=None)

        assert not SandboxManager.has(sandbox_id)
        mock_sandbox.release_environment.assert_called_once()

    def test_lifecycle_with_workflow_error(self, mock_archive_storage):
        sandbox_id = "integration-error-test"
        layer = SandboxLayer(tenant_id="error-tenant", app_id="error-app", sandbox_id=sandbox_id)
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch(
            "services.sandbox.sandbox_provider_service.SandboxProviderService.create_sandbox_builder",
            return_value=create_mock_builder(mock_sandbox),
        ):
            layer.on_graph_start()

        assert layer.sandbox.metadata.id is not None

        layer.on_graph_end(error=Exception("Workflow execution failed"))

        assert not SandboxManager.has(sandbox_id)
        mock_sandbox.release_environment.assert_called_once()
