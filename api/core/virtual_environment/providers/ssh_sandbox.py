from __future__ import annotations

import contextlib
import logging
import shlex
import stat
import threading
import time
from collections.abc import Mapping, Sequence
from enum import StrEnum
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any
from uuid import uuid4

from core.entities.provider_entities import BasicProviderConfig
from core.virtual_environment.__base.entities import (
    Arch,
    CommandStatus,
    ConnectionHandle,
    FileState,
    Metadata,
    OperatingSystem,
)
from core.virtual_environment.__base.exec import SandboxConfigValidationError, VirtualEnvironmentLaunchFailedError
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.queue_transport import QueueTransportReadCloser
from core.virtual_environment.channel.transport import TransportWriteCloser
from core.virtual_environment.constants import COMMAND_EXECUTION_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)


class _SSHStdinTransport(TransportWriteCloser):
    def __init__(self, channel: Any):
        self._channel = channel
        self._closed = False

    def write(self, data: bytes) -> None:
        if self._closed:
            raise TransportEOFError("Transport is closed")
        if not data:
            return
        self._channel.sendall(data)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        with contextlib.suppress(Exception):
            self._channel.shutdown_write()


class SSHSandboxEnvironment(VirtualEnvironment):
    _DEFAULT_SSH_HOST = "agentbox"
    _DEFAULT_SSH_PORT = 22
    _DEFAULT_BASE_WORKING_PATH = "/workspace/sandboxes"
    _SSH_CONNECT_TIMEOUT_SECONDS = 10
    _SSH_OPERATION_TIMEOUT_SECONDS = 30
    _COMMAND_TIMEOUT_EXIT_CODE = 124

    class OptionsKey(StrEnum):
        SSH_HOST = "ssh_host"
        SSH_PORT = "ssh_port"
        SSH_USERNAME = "ssh_username"
        SSH_PASSWORD = "ssh_password"
        BASE_WORKING_PATH = "base_working_path"

    def __init__(
        self,
        tenant_id: str,
        options: Mapping[str, Any],
        environments: Mapping[str, str] | None = None,
        user_id: str | None = None,
    ) -> None:
        self._connections: dict[str, Any] = {}
        self._commands: dict[str, CommandStatus] = {}
        self._lock = threading.Lock()
        super().__init__(tenant_id=tenant_id, options=options, environments=environments, user_id=user_id)

    @classmethod
    def get_config_schema(cls) -> list[BasicProviderConfig]:
        return [
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.SSH_HOST),
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.SSH_PORT),
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.SSH_USERNAME),
            BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=cls.OptionsKey.SSH_PASSWORD),
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.BASE_WORKING_PATH),
        ]

    @classmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        cls._require_non_empty_option(options, cls.OptionsKey.SSH_USERNAME)
        cls._require_non_empty_option(options, cls.OptionsKey.SSH_PASSWORD)
        with cls._create_ssh_client(options):
            return

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        environment_id = uuid4().hex
        working_path = self._workspace_path_from_id(environment_id)

        try:
            with self._client() as client:
                self._run_command(client, f"mkdir -p {shlex.quote(working_path)}")
                arch_stdout = self._run_command(client, "uname -m")
                os_stdout = self._run_command(client, "uname -s")
        except SandboxConfigValidationError as e:
            raise ValueError(f"SSH configuration validation failed, please check sandbox provider: {e}") from e
        except Exception as e:
            raise VirtualEnvironmentLaunchFailedError(f"Failed to construct SSH environment: {e}") from e

        return Metadata(
            id=environment_id,
            arch=self._parse_arch(arch_stdout.decode("utf-8", errors="replace").strip()),
            os=self._parse_os(os_stdout.decode("utf-8", errors="replace").strip()),
            store={"working_path": working_path},
        )

    def establish_connection(self) -> ConnectionHandle:
        connection_id = uuid4().hex
        client = self._create_ssh_client(self.options)
        with self._lock:
            self._connections[connection_id] = client
        return ConnectionHandle(id=connection_id)

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        with self._lock:
            client = self._connections.pop(connection_handle.id, None)
        if client is not None:
            with contextlib.suppress(Exception):
                client.close()

    def release_environment(self) -> None:
        working_path = self.get_working_path()
        with contextlib.suppress(Exception):
            with self._client() as client:
                self._run_command(client, f"rm -rf {shlex.quote(working_path)}")

    def execute_command(
        self,
        connection_handle: ConnectionHandle,
        command: list[str],
        environments: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> tuple[str, TransportWriteCloser, QueueTransportReadCloser, QueueTransportReadCloser]:
        client = self._get_connection(connection_handle)
        transport = client.get_transport()
        if transport is None:
            raise RuntimeError("SSH transport is not available")

        channel = transport.open_session()
        channel.settimeout(self._SSH_OPERATION_TIMEOUT_SECONDS)
        channel.set_combine_stderr(False)

        execution_command = self._build_exec_command(command, environments, cwd)
        channel.exec_command(execution_command)

        pid = uuid4().hex
        stdin_transport = _SSHStdinTransport(channel)
        stdout_transport = QueueTransportReadCloser()
        stderr_transport = QueueTransportReadCloser()

        with self._lock:
            self._commands[pid] = CommandStatus(status=CommandStatus.Status.RUNNING, exit_code=None)

        threading.Thread(
            target=self._consume_channel_output,
            args=(pid, channel, stdout_transport, stderr_transport, COMMAND_EXECUTION_TIMEOUT_SECONDS),
            daemon=True,
        ).start()

        return pid, stdin_transport, stdout_transport, stderr_transport

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        with self._lock:
            status = self._commands.get(pid)
        if status is None:
            return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=None)
        return status

    def upload_file(self, path: str, content: BytesIO) -> None:
        destination_path = self._workspace_path(path)
        with self._client() as client:
            sftp = client.open_sftp()
            try:
                self._set_sftp_operation_timeout(sftp)
                self._sftp_mkdirs(sftp, str(PurePosixPath(destination_path).parent))
                with sftp.file(destination_path, "wb") as remote_file:
                    remote_file.write(content.getvalue())
            finally:
                sftp.close()

    def download_file(self, path: str) -> BytesIO:
        source_path = self._workspace_path(path)
        with self._client() as client:
            sftp = client.open_sftp()
            try:
                self._set_sftp_operation_timeout(sftp)
                with sftp.file(source_path, "rb") as remote_file:
                    return BytesIO(remote_file.read())
            finally:
                sftp.close()

    def list_files(self, directory_path: str, limit: int) -> Sequence[FileState]:
        if limit <= 0:
            return []

        root_directory = self._workspace_path(directory_path)
        files: list[FileState] = []

        with self._client() as client:
            sftp = client.open_sftp()
            try:
                self._set_sftp_operation_timeout(sftp)
                pending = [root_directory]
                while pending and len(files) < limit:
                    current_directory = pending.pop(0)
                    with contextlib.suppress(FileNotFoundError):
                        for attr in sftp.listdir_attr(current_directory):
                            current_path = str(PurePosixPath(current_directory) / attr.filename)
                            mode = attr.st_mode
                            if stat.S_ISDIR(mode):
                                pending.append(current_path)
                                continue

                            files.append(
                                FileState(
                                    path=self._to_relative_workspace_path(current_path),
                                    size=attr.st_size,
                                    created_at=int(attr.st_mtime),
                                    updated_at=int(attr.st_mtime),
                                )
                            )
                            if len(files) >= limit:
                                break
            finally:
                sftp.close()

        return files

    @classmethod
    def _require_non_empty_option(cls, options: Mapping[str, Any], key: OptionsKey) -> str:
        value = options.get(key)
        if not isinstance(value, str) or not value.strip():
            raise SandboxConfigValidationError(f"Missing required option: {key}")
        return value.strip()

    @classmethod
    def _create_ssh_client(cls, options: Mapping[str, Any]) -> Any:
        import paramiko

        host = options.get(cls.OptionsKey.SSH_HOST, cls._DEFAULT_SSH_HOST)
        port = options.get(cls.OptionsKey.SSH_PORT, cls._DEFAULT_SSH_PORT)
        username = cls._require_non_empty_option(options, cls.OptionsKey.SSH_USERNAME)
        password = cls._require_non_empty_option(options, cls.OptionsKey.SSH_PASSWORD)

        if not isinstance(host, str) or not host.strip():
            raise SandboxConfigValidationError(f"Invalid option value: {cls.OptionsKey.SSH_HOST}")

        try:
            port_int = int(port)
        except (TypeError, ValueError) as e:
            raise SandboxConfigValidationError(f"Invalid option value: {cls.OptionsKey.SSH_PORT}") from e

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            client.connect(
                hostname=host.strip(),
                port=port_int,
                username=username,
                password=password,
                look_for_keys=False,
                allow_agent=False,
                timeout=cls._SSH_CONNECT_TIMEOUT_SECONDS,
                banner_timeout=cls._SSH_CONNECT_TIMEOUT_SECONDS,
                auth_timeout=cls._SSH_CONNECT_TIMEOUT_SECONDS,
            )
            transport = client.get_transport()
            if transport is not None:
                transport.set_keepalive(30)
        except Exception as e:
            with contextlib.suppress(Exception):
                client.close()
            raise SandboxConfigValidationError(f"SSH connection failed: {e}") from e

        return client

    @contextlib.contextmanager
    def _client(self):
        client = self._create_ssh_client(self.options)
        try:
            yield client
        finally:
            with contextlib.suppress(Exception):
                client.close()

    def _get_connection(self, connection_handle: ConnectionHandle) -> Any:
        with self._lock:
            client = self._connections.get(connection_handle.id)
        if client is None:
            raise ValueError(f"Connection handle not found: {connection_handle.id}")
        return client

    def _workspace_path_from_id(self, environment_id: str) -> str:
        base_path = self.options.get(self.OptionsKey.BASE_WORKING_PATH, self._DEFAULT_BASE_WORKING_PATH)
        if not isinstance(base_path, str) or not base_path.strip():
            base_path = self._DEFAULT_BASE_WORKING_PATH
        return str(PurePosixPath(base_path) / environment_id)

    def get_working_path(self) -> str:
        working_path = self.metadata.store.get("working_path")
        if not isinstance(working_path, str) or not working_path:
            return self._workspace_path_from_id(self.metadata.id)
        return working_path

    def _workspace_path(self, path: str | None) -> str:
        if not path:
            return self.get_working_path()

        normalized = PurePosixPath(path)
        if normalized.is_absolute():
            return str(normalized)
        return str(PurePosixPath(self.get_working_path()) / self._normalize_relative_path(path))

    @staticmethod
    def _normalize_relative_path(path: str) -> PurePosixPath:
        parts: list[str] = []
        for part in PurePosixPath(path).parts:
            if part in ("", ".", "/"):
                continue
            if part == "..":
                if not parts:
                    raise ValueError("Path escapes the workspace.")
                parts.pop()
                continue
            parts.append(part)
        return PurePosixPath(*parts)

    def _to_relative_workspace_path(self, path: str) -> str:
        workspace = PurePosixPath(self.get_working_path())
        target = PurePosixPath(path)
        if target.is_relative_to(workspace):
            return target.relative_to(workspace).as_posix()
        return target.as_posix()

    def _build_exec_command(
        self, command: list[str], environments: Mapping[str, str] | None = None, cwd: str | None = None
    ) -> str:
        working_path = self._workspace_path(cwd)
        command_body = f"cd {shlex.quote(working_path)} && "

        if environments:
            env_clause = " ".join(f"{key}={shlex.quote(value)}" for key, value in environments.items())
            command_body += f"{env_clause} "

        command_body += shlex.join(command)
        return f"sh -lc {shlex.quote(command_body)}"

    @classmethod
    def _run_command(cls, client: Any, command: str) -> bytes:
        _, stdout, stderr = client.exec_command(command, timeout=cls._SSH_OPERATION_TIMEOUT_SECONDS)
        stdout.channel.settimeout(cls._SSH_OPERATION_TIMEOUT_SECONDS)

        deadline = time.monotonic() + COMMAND_EXECUTION_TIMEOUT_SECONDS
        while not stdout.channel.exit_status_ready():
            if time.monotonic() >= deadline:
                with contextlib.suppress(Exception):
                    stdout.channel.close()
                raise TimeoutError(f"SSH command timed out after {COMMAND_EXECUTION_TIMEOUT_SECONDS}s")
            time.sleep(0.05)

        exit_code = stdout.channel.recv_exit_status()
        stdout_data = stdout.read()
        stderr_data = stderr.read()

        if exit_code != 0:
            stderr_text = stderr_data.decode("utf-8", errors="replace")
            raise RuntimeError(f"SSH command failed ({exit_code}): {stderr_text}")

        return stdout_data

    def _consume_channel_output(
        self,
        pid: str,
        channel: Any,
        stdout_transport: QueueTransportReadCloser,
        stderr_transport: QueueTransportReadCloser,
        max_runtime_seconds: int,
    ) -> None:
        stdout_writer = stdout_transport.get_write_handler()
        stderr_writer = stderr_transport.get_write_handler()
        exit_code: int | None = None
        started_at = time.monotonic()

        try:
            while True:
                if time.monotonic() - started_at >= max_runtime_seconds:
                    exit_code = self._COMMAND_TIMEOUT_EXIT_CODE
                    stderr_writer.write(f"Command timed out after {max_runtime_seconds}s".encode())
                    break

                if channel.recv_ready():
                    stdout_writer.write(channel.recv(4096))
                if channel.recv_stderr_ready():
                    stderr_writer.write(channel.recv_stderr(4096))

                if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                    exit_code = int(channel.recv_exit_status())
                    break

                time.sleep(0.05)
        except TimeoutError:
            logger.warning("SSH channel read timed out for command %s", pid)
            exit_code = self._COMMAND_TIMEOUT_EXIT_CODE
        finally:
            with contextlib.suppress(Exception):
                stdout_transport.close()
            with contextlib.suppress(Exception):
                stderr_transport.close()
            with contextlib.suppress(Exception):
                channel.close()

            with self._lock:
                self._commands[pid] = CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=exit_code)

    def _set_sftp_operation_timeout(self, sftp: Any) -> None:
        with contextlib.suppress(Exception):
            sftp.get_channel().settimeout(self._SSH_OPERATION_TIMEOUT_SECONDS)

    @staticmethod
    def _parse_arch(raw_arch: str) -> Arch:
        arch = raw_arch.lower()
        if arch in {"x86_64", "amd64"}:
            return Arch.AMD64
        if arch in {"arm64", "aarch64"}:
            return Arch.ARM64
        return Arch.AMD64

    @staticmethod
    def _parse_os(raw_os: str) -> OperatingSystem:
        system_name = raw_os.lower()
        if system_name == "darwin":
            return OperatingSystem.DARWIN
        return OperatingSystem.LINUX

    @staticmethod
    def _sftp_mkdirs(sftp: Any, directory: str) -> None:
        if not directory or directory == "/":
            return

        path = PurePosixPath(directory)
        current = PurePosixPath("/") if path.is_absolute() else PurePosixPath()

        for part in path.parts:
            if part in ("", "/"):
                continue
            current = current / part
            current_path = str(current)
            try:
                attrs = sftp.stat(current_path)
                if not stat.S_ISDIR(attrs.st_mode):
                    raise OSError(f"Path exists but is not a directory: {current_path}")
                continue
            except OSError as e:
                missing = isinstance(e, FileNotFoundError) or getattr(e, "errno", None) == 2
                missing = missing or "no such file" in str(e).lower()
                if not missing:
                    raise

            try:
                sftp.mkdir(current_path)
            except OSError:
                # Some SFTP servers report generic "Failure" when directory already exists.
                attrs = sftp.stat(current_path)
                if not stat.S_ISDIR(attrs.st_mode):
                    raise OSError(f"Failed to create directory: {current_path}")
