"""
Unit tests for the SandboxFactory.

This module tests the factory pattern implementation for creating VirtualEnvironment instances
based on sandbox type, including error handling for unsupported types.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.factory import VMFactory, VMType


class TestSandboxType:
    """Test cases for SandboxType enum."""

    def test_sandbox_type_values(self):
        """Test that SandboxType enum has expected values."""
        assert VMType.DOCKER == "docker"
        assert VMType.E2B == "e2b"
        assert VMType.LOCAL == "local"

    def test_sandbox_type_is_string_enum(self):
        """Test that SandboxType values are strings."""
        assert isinstance(VMType.DOCKER.value, str)
        assert isinstance(VMType.E2B.value, str)
        assert isinstance(VMType.LOCAL.value, str)


class TestSandboxFactory:
    """Test cases for SandboxFactory."""

    def test_create_docker_sandbox_success(self):
        """Test successful Docker sandbox creation."""
        mock_sandbox_instance = MagicMock(spec=VirtualEnvironment)
        mock_sandbox_class = MagicMock(return_value=mock_sandbox_instance)

        with patch.object(VMFactory, "_get_sandbox_class", return_value=mock_sandbox_class):
            result = VMFactory.create(
                tenant_id="test-tenant",
                vm_type=VMType.DOCKER,
                options={"docker_image": "python:3.11-slim"},
                environments={"PYTHONUNBUFFERED": "1"},
            )

            mock_sandbox_class.assert_called_once_with(
                tenant_id="test-tenant",
                options={"docker_image": "python:3.11-slim"},
                environments={"PYTHONUNBUFFERED": "1"},
                user_id=None,
            )
            assert result is mock_sandbox_instance

    def test_create_with_none_options_uses_empty_dict(self):
        """Test that None options are converted to empty dict."""
        mock_sandbox_instance = MagicMock(spec=VirtualEnvironment)
        mock_sandbox_class = MagicMock(return_value=mock_sandbox_instance)

        with patch.object(VMFactory, "_get_sandbox_class", return_value=mock_sandbox_class):
            VMFactory.create(tenant_id="test-tenant", vm_type=VMType.DOCKER, options=None, environments=None)

            mock_sandbox_class.assert_called_once_with(
                tenant_id="test-tenant", options={}, environments={}, user_id=None
            )

    def test_create_with_default_parameters(self):
        """Test sandbox creation with default parameters."""
        mock_sandbox_instance = MagicMock(spec=VirtualEnvironment)
        mock_sandbox_class = MagicMock(return_value=mock_sandbox_instance)

        with patch.object(VMFactory, "_get_sandbox_class", return_value=mock_sandbox_class):
            result = VMFactory.create(tenant_id="test-tenant", vm_type=VMType.DOCKER)

            mock_sandbox_class.assert_called_once_with(
                tenant_id="test-tenant", options={}, environments={}, user_id=None
            )
            assert result is mock_sandbox_instance

    def test_get_sandbox_class_docker_returns_correct_class(self):
        """Test that DOCKER type returns DockerDaemonEnvironment class."""
        # Test by creating with mock to verify the class lookup works
        mock_instance = MagicMock(spec=VirtualEnvironment)

        with patch(
            "core.virtual_environment.providers.docker_daemon_sandbox.DockerDaemonEnvironment",
            return_value=mock_instance,
        ) as mock_docker_class:
            VMFactory.create(tenant_id="test-tenant", vm_type=VMType.DOCKER)
            mock_docker_class.assert_called_once()

    def test_get_sandbox_class_local_returns_correct_class(self):
        """Test that LOCAL type returns LocalVirtualEnvironment class."""
        mock_instance = MagicMock(spec=VirtualEnvironment)

        with patch(
            "core.virtual_environment.providers.local_without_isolation.LocalVirtualEnvironment",
            return_value=mock_instance,
        ) as mock_local_class:
            VMFactory.create(tenant_id="test-tenant", vm_type=VMType.LOCAL)
            mock_local_class.assert_called_once()

    def test_get_sandbox_class_e2b_returns_correct_class(self):
        """Test that E2B type returns E2BEnvironment class."""
        mock_instance = MagicMock(spec=VirtualEnvironment)

        with patch(
            "core.virtual_environment.providers.e2b_sandbox.E2BEnvironment",
            return_value=mock_instance,
        ) as mock_e2b_class:
            VMFactory.create(tenant_id="test-tenant", vm_type=VMType.E2B)
            mock_e2b_class.assert_called_once()

    def test_create_with_unsupported_type_raises_value_error(self):
        """Test that unsupported sandbox type raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            VMFactory.create(tenant_id="test-tenant", vm_type="unsupported_type")  # type: ignore[arg-type]

        assert "Unsupported sandbox type: unsupported_type" in str(exc_info.value)

    def test_create_propagates_instantiation_error(self):
        """Test that sandbox instantiation errors are propagated."""
        mock_sandbox_class = MagicMock()
        mock_sandbox_class.side_effect = Exception("Docker daemon not available")

        with patch.object(VMFactory, "_get_sandbox_class", return_value=mock_sandbox_class):
            with pytest.raises(Exception) as exc_info:
                VMFactory.create(tenant_id="test-tenant", vm_type=VMType.DOCKER)

            assert "Docker daemon not available" in str(exc_info.value)


class TestSandboxFactoryIntegration:
    """Integration tests for SandboxFactory with real providers (using LOCAL type)."""

    def test_create_local_sandbox_integration(self, tmp_path: Path):
        """Test creating a real local sandbox."""
        sandbox = VMFactory.create(
            tenant_id="test-tenant",
            vm_type=VMType.LOCAL,
            options={"base_working_path": str(tmp_path)},
            environments={},
        )

        try:
            assert sandbox is not None
            assert sandbox.metadata.id is not None
            assert sandbox.metadata.arch is not None
        finally:
            sandbox.release_environment()
