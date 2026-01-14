from collections.abc import Mapping
from io import BytesIO
from typing import Any

import pytest

from core.virtual_environment.__base.entities import (
    Arch,
    CommandStatus,
    ConnectionHandle,
    FileState,
    Metadata,
    OperatingSystem,
)
from core.virtual_environment.__base.exec import CommandExecutionError
from core.virtual_environment.__base.helpers import execute, try_execute, with_connection
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.transport import TransportReadCloser, TransportWriteCloser


class MockReadTransport(TransportReadCloser):
    """Mock transport that returns data once then raises EOF."""

    def __init__(self, data: bytes):
        self._data = data
        self._read = False

    def read(self, n: int) -> bytes:
        if self._read:
            raise TransportEOFError()
        self._read = True
        return self._data[:n] if n < len(self._data) else self._data

    def close(self) -> None:
        pass


class MockWriteTransport(TransportWriteCloser):
    """Mock transport for stdin (no-op)."""

    def write(self, data: bytes) -> None:
        pass

    def close(self) -> None:
        pass


class FakeVirtualEnvironment(VirtualEnvironment):
    """Fake virtual environment for testing connection utilities."""

    def __init__(
        self,
        *,
        exit_code: int | None = 0,
        stdout: bytes = b"",
        stderr: bytes = b"",
    ):
        self._exit_code = exit_code
        self._stdout = stdout
        self._stderr = stderr
        self._connection_established = False
        self._connection_released = False
        self._establish_count = 0
        self._release_count = 0
        super().__init__(tenant_id="test-tenant", options={}, environments={})

    def _construct_environment(self, _options: Mapping[str, Any], _environments: Mapping[str, str]) -> Metadata:
        return Metadata(id="fake-id", arch=Arch.AMD64, os=OperatingSystem.LINUX)

    def upload_file(self, _path: str, _content: BytesIO) -> None:
        raise NotImplementedError

    def download_file(self, _path: str) -> BytesIO:
        raise NotImplementedError

    def list_files(self, _directory_path: str, _limit: int) -> list[FileState]:
        return []

    def establish_connection(self) -> ConnectionHandle:
        self._connection_established = True
        self._establish_count += 1
        return ConnectionHandle(id=f"test-conn-{self._establish_count}")

    def release_connection(self, _connection_handle: ConnectionHandle) -> None:
        self._connection_released = True
        self._release_count += 1

    def release_environment(self) -> None:
        pass

    def execute_command(
        self,
        _connection_handle: ConnectionHandle,
        _command: list[str],
        _environments: Mapping[str, str] | None = None,
        _cwd: str | None = None,
    ) -> tuple[str, TransportWriteCloser, TransportReadCloser, TransportReadCloser]:
        """Return mock transports for testing."""
        return (
            "test-pid",
            MockWriteTransport(),
            MockReadTransport(self._stdout),
            MockReadTransport(self._stderr),
        )

    def get_command_status(self, _connection_handle: ConnectionHandle, _pid: str) -> CommandStatus:
        return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=self._exit_code)

    @classmethod
    def validate(cls, _options: Mapping[str, Any]) -> None:
        pass


class TestWithConnection:
    def test_connection_established_and_released(self):
        env = FakeVirtualEnvironment()

        with with_connection(env) as conn:
            assert env._connection_established is True
            assert conn.id == "test-conn-1"

        assert env._connection_released is True

    def test_connection_released_on_exception(self):
        env = FakeVirtualEnvironment()

        with pytest.raises(ValueError):
            with with_connection(env):
                raise ValueError("test error")

        assert env._connection_released is True


class TestExecute:
    def test_execute_success(self):
        env = FakeVirtualEnvironment(exit_code=0, stdout=b"hello world")

        result = execute(env, ["echo", "hello"])

        assert result.stdout == b"hello world"
        assert result.exit_code == 0
        assert env._connection_released is True

    def test_execute_raises_on_nonzero_exit_code(self):
        env = FakeVirtualEnvironment(exit_code=1, stderr=b"command not found")

        with pytest.raises(CommandExecutionError, match="Command failed: command not found") as exc_info:
            execute(env, ["invalid-command"])

        assert exc_info.value.exit_code == 1
        assert exc_info.value.stderr == b"command not found"
        assert env._connection_released is True

    def test_execute_with_custom_error_message(self):
        env = FakeVirtualEnvironment(exit_code=1, stderr=b"error")

        with pytest.raises(CommandExecutionError, match="Custom error: error"):
            execute(env, ["cmd"], error_message="Custom error")

    def test_execute_releases_connection_on_error(self):
        env = FakeVirtualEnvironment(exit_code=1, stderr=b"error")

        with pytest.raises(CommandExecutionError):
            execute(env, ["cmd"])

        assert env._connection_released is True


class TestTryExecute:
    def test_try_execute_success(self):
        env = FakeVirtualEnvironment(exit_code=0, stdout=b"output")

        result = try_execute(env, ["echo", "test"])

        assert result.stdout == b"output"
        assert result.exit_code == 0
        assert env._connection_released is True

    def test_try_execute_returns_error_result(self):
        env = FakeVirtualEnvironment(exit_code=1, stderr=b"error message")

        result = try_execute(env, ["failing-command"])

        assert result.exit_code == 1
        assert result.stderr == b"error message"
        assert result.is_error is True
        assert env._connection_released is True

    def test_try_execute_does_not_raise(self):
        env = FakeVirtualEnvironment(exit_code=127, stderr=b"not found")

        result = try_execute(env, ["nonexistent"])

        assert result.exit_code == 127
        assert env._connection_released is True


class TestConnectionReuse:
    def test_execute_with_reused_connection(self):
        """Test that execute reuses provided connection without creating new one."""
        env = FakeVirtualEnvironment(exit_code=0, stdout=b"output")

        with with_connection(env) as conn:
            # Execute with reused connection
            result = execute(env, ["cmd1"], connection=conn)
            assert result.stdout == b"output"

            # Should have only established one connection (from with_connection)
            assert env._establish_count == 1
            assert env._release_count == 0  # Not released yet

        # Now connection should be released
        assert env._release_count == 1

    def test_execute_without_connection_creates_new(self):
        """Test that execute without connection creates and releases its own."""
        env = FakeVirtualEnvironment(exit_code=0, stdout=b"output")

        execute(env, ["cmd1"])

        assert env._establish_count == 1
        assert env._release_count == 1

    def test_multiple_executes_with_same_connection(self):
        """Test multiple execute calls reusing the same connection."""
        env = FakeVirtualEnvironment(exit_code=0, stdout=b"output")

        with with_connection(env) as conn:
            execute(env, ["cmd1"], connection=conn)
            execute(env, ["cmd2"], connection=conn)
            execute(env, ["cmd3"], connection=conn)

            # Only one connection established
            assert env._establish_count == 1
            assert env._release_count == 0

        # Released once at the end
        assert env._release_count == 1

    def test_try_execute_with_reused_connection(self):
        """Test that try_execute reuses provided connection."""
        env = FakeVirtualEnvironment(exit_code=0, stdout=b"output")

        with with_connection(env) as conn:
            result = try_execute(env, ["cmd1"], connection=conn)
            assert result.stdout == b"output"
            assert env._establish_count == 1
            assert env._release_count == 0

        assert env._release_count == 1

    def test_mixed_execute_and_try_execute_reuse(self):
        """Test mixing execute and try_execute with same connection."""
        env = FakeVirtualEnvironment(exit_code=0, stdout=b"output")

        with with_connection(env) as conn:
            execute(env, ["cmd1"], connection=conn)
            try_execute(env, ["cmd2"], connection=conn)
            execute(env, ["cmd3"], connection=conn)

            assert env._establish_count == 1

        assert env._release_count == 1
