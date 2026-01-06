"""
Unit tests for the SandboxLayer.

This module tests the SandboxLayer lifecycle management including initialization,
event handling, and cleanup of VirtualEnvironment instances.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from core.app.layers.sandbox_layer import SandboxInitializationError, SandboxLayer
from core.virtual_environment.__base.entities import Arch
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.factory import SandboxFactory, SandboxType
from core.workflow.graph_engine.layers.base import GraphEngineLayerNotInitializedError
from core.workflow.graph_events.graph import (
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)


class MockMetadata:
    """Mock metadata for testing."""

    def __init__(self, sandbox_id: str = "test-sandbox-id", arch: Arch = Arch.AMD64):
        self.id = sandbox_id
        self.arch = arch


class MockVirtualEnvironment:
    """Mock VirtualEnvironment for testing."""

    def __init__(self, sandbox_id: str = "test-sandbox-id"):
        self.metadata = MockMetadata(sandbox_id=sandbox_id)
        self._released = False

    def release_environment(self) -> None:
        self._released = True


class TestSandboxLayer:
    """Unit tests for SandboxLayer."""

    def test_init_with_default_parameters(self):
        """Test SandboxLayer initialization with default parameters."""
        layer = SandboxLayer()

        assert layer._sandbox_type == SandboxType.DOCKER
        assert layer._options == {}
        assert layer._environments == {}
        assert layer._sandbox is None

    def test_init_with_custom_parameters(self):
        """Test SandboxLayer initialization with custom parameters."""
        layer = SandboxLayer(
            sandbox_type=SandboxType.LOCAL,
            options={"base_working_path": "/tmp/sandbox"},
            environments={"PYTHONUNBUFFERED": "1"},
        )

        assert layer._sandbox_type == SandboxType.LOCAL
        assert layer._options == {"base_working_path": "/tmp/sandbox"}
        assert layer._environments == {"PYTHONUNBUFFERED": "1"}

    def test_sandbox_property_raises_when_not_initialized(self):
        """Test that accessing sandbox property raises error before initialization."""
        layer = SandboxLayer()

        with pytest.raises(RuntimeError) as exc_info:
            _ = layer.sandbox

        assert "Sandbox not initialized" in str(exc_info.value)

    def test_sandbox_property_returns_sandbox_after_initialization(self):
        """Test that sandbox property returns the sandbox after on_graph_start."""
        layer = SandboxLayer()
        mock_sandbox = MockVirtualEnvironment()

        with patch.object(SandboxFactory, "create", return_value=mock_sandbox):
            layer.on_graph_start()

        assert layer.sandbox is mock_sandbox

    def test_on_graph_start_creates_sandbox(self):
        """Test that on_graph_start creates a sandbox via factory."""
        layer = SandboxLayer(
            sandbox_type=SandboxType.DOCKER,
            options={"docker_image": "python:3.11"},
            environments={"PATH": "/usr/bin"},
        )
        mock_sandbox = MockVirtualEnvironment()

        with patch.object(SandboxFactory, "create", return_value=mock_sandbox) as mock_create:
            layer.on_graph_start()

            mock_create.assert_called_once_with(
                sandbox_type=SandboxType.DOCKER,
                options={"docker_image": "python:3.11"},
                environments={"PATH": "/usr/bin"},
            )

    def test_on_graph_start_raises_sandbox_initialization_error_on_failure(self):
        """Test that on_graph_start raises SandboxInitializationError on factory failure."""
        layer = SandboxLayer(sandbox_type=SandboxType.DOCKER)

        with patch.object(SandboxFactory, "create", side_effect=Exception("Docker not available")):
            with pytest.raises(SandboxInitializationError) as exc_info:
                layer.on_graph_start()

            assert "Failed to initialize docker sandbox" in str(exc_info.value)
            assert "Docker not available" in str(exc_info.value)

    def test_on_event_is_noop(self):
        """Test that on_event does nothing (no-op)."""
        layer = SandboxLayer()

        # These should not raise any exceptions
        layer.on_event(GraphRunStartedEvent())
        layer.on_event(GraphRunSucceededEvent(outputs={}))
        layer.on_event(GraphRunFailedEvent(error="test error", exceptions_count=1))

    def test_on_graph_end_releases_sandbox(self):
        """Test that on_graph_end releases the sandbox."""
        layer = SandboxLayer()
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch.object(SandboxFactory, "create", return_value=mock_sandbox):
            layer.on_graph_start()

        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()
        assert layer._sandbox is None

    def test_on_graph_end_releases_sandbox_even_on_error(self):
        """Test that on_graph_end releases sandbox even when workflow had an error."""
        layer = SandboxLayer()
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch.object(SandboxFactory, "create", return_value=mock_sandbox):
            layer.on_graph_start()

        layer.on_graph_end(error=Exception("Workflow failed"))

        mock_sandbox.release_environment.assert_called_once()
        assert layer._sandbox is None

    def test_on_graph_end_handles_release_failure_gracefully(self):
        """Test that on_graph_end handles release failures without raising."""
        layer = SandboxLayer()
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()
        mock_sandbox.release_environment.side_effect = Exception("Container already removed")

        with patch.object(SandboxFactory, "create", return_value=mock_sandbox):
            layer.on_graph_start()

        # Should not raise exception
        layer.on_graph_end(error=None)

        mock_sandbox.release_environment.assert_called_once()
        assert layer._sandbox is None

    def test_on_graph_end_noop_when_sandbox_not_initialized(self):
        """Test that on_graph_end is a no-op when sandbox was never initialized."""
        layer = SandboxLayer()

        # Should not raise exception
        layer.on_graph_end(error=None)

        assert layer._sandbox is None

    def test_on_graph_end_is_idempotent(self):
        """Test that calling on_graph_end multiple times is safe."""
        layer = SandboxLayer()
        mock_sandbox = MagicMock(spec=VirtualEnvironment)
        mock_sandbox.metadata = MockMetadata()

        with patch.object(SandboxFactory, "create", return_value=mock_sandbox):
            layer.on_graph_start()

        layer.on_graph_end(error=None)
        layer.on_graph_end(error=None)  # Second call should be no-op

        mock_sandbox.release_environment.assert_called_once()

    def test_layer_inherits_from_graph_engine_layer(self):
        """Test that SandboxLayer properly inherits from GraphEngineLayer."""
        layer = SandboxLayer()

        # Should have the graph_runtime_state property from base class
        with pytest.raises(GraphEngineLayerNotInitializedError):
            _ = layer.graph_runtime_state

        # Should have command_channel from base class
        assert layer.command_channel is None


class TestSandboxLayerIntegration:
    """Integration tests for SandboxLayer with real LocalVirtualEnvironment."""

    def test_full_lifecycle_with_local_sandbox(self, tmp_path: Path):
        """Test complete lifecycle: init -> start -> end with local sandbox."""
        layer = SandboxLayer(
            sandbox_type=SandboxType.LOCAL,
            options={"base_working_path": str(tmp_path)},
        )

        # Start
        layer.on_graph_start()

        # Verify sandbox is created
        assert layer._sandbox is not None
        sandbox_id = layer.sandbox.metadata.id
        assert sandbox_id is not None

        # End
        layer.on_graph_end(error=None)

        # Verify sandbox is released
        assert layer._sandbox is None

    def test_lifecycle_with_workflow_error(self, tmp_path: Path):
        """Test lifecycle when workflow encounters an error."""
        layer = SandboxLayer(
            sandbox_type=SandboxType.LOCAL,
            options={"base_working_path": str(tmp_path)},
        )

        layer.on_graph_start()
        assert layer.sandbox.metadata.id is not None

        # Simulate workflow error
        layer.on_graph_end(error=Exception("Workflow execution failed"))

        # Sandbox should still be cleaned up
        # pyright: ignore[reportPrivateUsage]
        assert layer._sandbox is None  # pyright: ignore[reportPrivateUsage]
