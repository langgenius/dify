from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from core.sandbox import SandboxBuilder, SandboxType
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class TestVMType:
    def test_values(self):
        assert SandboxType.DOCKER == "docker"
        assert SandboxType.E2B == "e2b"
        assert SandboxType.LOCAL == "local"

    def test_is_string_enum(self):
        assert isinstance(SandboxType.DOCKER.value, str)
        assert isinstance(SandboxType.E2B.value, str)
        assert isinstance(SandboxType.LOCAL.value, str)


class TestVMBuilder:
    def test_build_docker(self):
        mock_instance = MagicMock(spec=VirtualEnvironment)
        mock_class = MagicMock(return_value=mock_instance)

        with patch(
            "core.virtual_environment.providers.docker_daemon_sandbox.DockerDaemonEnvironment",
            mock_class,
        ):
            result = (
                SandboxBuilder("test-tenant", SandboxType.DOCKER)
                .options({"docker_image": "python:3.11-slim"})
                .environments({"PYTHONUNBUFFERED": "1"})
                .build()
            )

            mock_class.assert_called_once_with(
                tenant_id="test-tenant",
                options={"docker_image": "python:3.11-slim"},
                environments={"PYTHONUNBUFFERED": "1"},
                user_id=None,
            )
            assert result is mock_instance

    def test_build_with_user(self):
        mock_instance = MagicMock(spec=VirtualEnvironment)
        mock_class = MagicMock(return_value=mock_instance)

        with patch(
            "core.virtual_environment.providers.docker_daemon_sandbox.DockerDaemonEnvironment",
            mock_class,
        ):
            SandboxBuilder("test-tenant", SandboxType.DOCKER).user("user-123").build()

            mock_class.assert_called_once_with(
                tenant_id="test-tenant",
                options={},
                environments={},
                user_id="user-123",
            )

    def test_build_with_initializers(self):
        mock_instance = MagicMock(spec=VirtualEnvironment)
        mock_class = MagicMock(return_value=mock_instance)
        mock_initializer = MagicMock()

        with patch(
            "core.virtual_environment.providers.docker_daemon_sandbox.DockerDaemonEnvironment",
            mock_class,
        ):
            SandboxBuilder("test-tenant", SandboxType.DOCKER).initializer(mock_initializer).build()

            mock_initializer.initialize.assert_called_once_with(mock_instance)

    def test_build_local(self):
        mock_instance = MagicMock(spec=VirtualEnvironment)

        with patch(
            "core.virtual_environment.providers.local_without_isolation.LocalVirtualEnvironment",
            return_value=mock_instance,
        ) as mock_class:
            SandboxBuilder("test-tenant", SandboxType.LOCAL).build()
            mock_class.assert_called_once()

    def test_build_e2b(self):
        mock_instance = MagicMock(spec=VirtualEnvironment)

        with patch(
            "core.virtual_environment.providers.e2b_sandbox.E2BEnvironment",
            return_value=mock_instance,
        ) as mock_class:
            SandboxBuilder("test-tenant", SandboxType.E2B).build()
            mock_class.assert_called_once()

    def test_build_unsupported_type_raises(self):
        with pytest.raises(ValueError, match="Unsupported VM type"):
            SandboxBuilder("test-tenant", "unsupported").build()  # type: ignore[arg-type]

    def test_validate(self):
        mock_class = MagicMock()

        with patch(
            "core.virtual_environment.providers.docker_daemon_sandbox.DockerDaemonEnvironment",
            mock_class,
        ):
            SandboxBuilder.validate(SandboxType.DOCKER, {"key": "value"})
            mock_class.validate.assert_called_once_with({"key": "value"})


class TestVMBuilderIntegration:
    def test_local_sandbox(self, tmp_path: Path):
        sandbox = SandboxBuilder("test-tenant", SandboxType.LOCAL).options({"base_working_path": str(tmp_path)}).build()

        try:
            assert sandbox is not None
            assert sandbox.metadata.id is not None
            assert sandbox.metadata.arch is not None
        finally:
            sandbox.release_environment()
