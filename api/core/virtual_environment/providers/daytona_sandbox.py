import logging
import posixpath
import shlex
import threading
import time
from collections.abc import Mapping, Sequence
from datetime import datetime
from enum import StrEnum
from io import BytesIO
from typing import Any, TypedDict, cast
from uuid import uuid4

from daytona import (
    CodeLanguage,
    CreateSandboxFromImageParams,
    CreateSandboxFromSnapshotParams,
    Daytona,
    DaytonaConfig,
    Sandbox,
)

logger = logging.getLogger(__name__)


class _CommandRecord(TypedDict):
    """Record for tracking command execution state."""

    thread: threading.Thread
    exit_code: int | None


from core.virtual_environment.__base.entities import (
    Arch,
    CommandStatus,
    ConnectionHandle,
    FileState,
    Metadata,
    OperatingSystem,
)
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.queue_transport import QueueTransportReadCloser
from core.virtual_environment.channel.transport import (
    NopTransportWriteCloser,
    TransportReadCloser,
    TransportWriteCloser,
)


class DaytonaEnvironment(VirtualEnvironment):
    """
    Daytona virtual environment provider backed by Daytona Sandboxes.
    """

    _DEFAULT_DAYTONA_API_URL = "https://app.daytona.io/api"

    class OptionsKey(StrEnum):
        API_KEY = "api_key"
        API_URL = "api_url"
        TARGET = "target"
        LANGUAGE = "language"
        SNAPSHOT = "snapshot"
        IMAGE = "image"
        AUTO_STOP_INTERVAL = "auto_stop_interval"
        AUTO_ARCHIVE_INTERVAL = "auto_archive_interval"
        AUTO_DELETE_INTERVAL = "auto_delete_interval"
        PUBLIC = "public"
        NAME = "name"
        LABELS = "labels"

    class StoreKey(StrEnum):
        DAYTONA = "daytona"
        SANDBOX = "sandbox"
        WORKDIR = "workdir"
        COMMANDS = "commands"
        COMMANDS_LOCK = "commands_lock"

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        config = DaytonaConfig(
            api_key=cast(str | None, options.get(self.OptionsKey.API_KEY)),
            api_url=cast(str | None, options.get(self.OptionsKey.API_URL, self._DEFAULT_DAYTONA_API_URL)),
            target=cast(str | None, options.get(self.OptionsKey.TARGET)),
        )
        daytona = Daytona(config)

        language = cast(CodeLanguage, options.get(self.OptionsKey.LANGUAGE, CodeLanguage.PYTHON))
        auto_stop_interval = cast(int | None, options.get(self.OptionsKey.AUTO_STOP_INTERVAL))
        auto_archive_interval = cast(int | None, options.get(self.OptionsKey.AUTO_ARCHIVE_INTERVAL))
        auto_delete_interval = cast(int | None, options.get(self.OptionsKey.AUTO_DELETE_INTERVAL))
        public = cast(bool | None, options.get(self.OptionsKey.PUBLIC))
        name = cast(str | None, options.get(self.OptionsKey.NAME))
        labels = cast(dict[str, str] | None, options.get(self.OptionsKey.LABELS))

        image = cast(str | None, options.get(self.OptionsKey.IMAGE))
        snapshot = cast(str | None, options.get(self.OptionsKey.SNAPSHOT))

        if image is not None:
            params = CreateSandboxFromImageParams(
                image=image,
                language=language,
                env_vars=dict(environments or {}),
                auto_stop_interval=auto_stop_interval,
                auto_archive_interval=auto_archive_interval,
                auto_delete_interval=auto_delete_interval,
                public=public,
                name=name,
                labels=labels,
            )
        else:
            params = CreateSandboxFromSnapshotParams(
                snapshot=snapshot,
                language=language,
                env_vars=dict(environments or {}),
                auto_stop_interval=auto_stop_interval,
                auto_archive_interval=auto_archive_interval,
                auto_delete_interval=auto_delete_interval,
                public=public,
                name=name,
                labels=labels,
            )

        sandbox = daytona.create(params=params)
        workdir = sandbox.get_work_dir()

        return Metadata(
            id=sandbox.id,
            arch=Arch.AMD64,
            os=OperatingSystem.LINUX,
            store={
                self.StoreKey.DAYTONA: daytona,
                self.StoreKey.SANDBOX: sandbox,
                self.StoreKey.WORKDIR: workdir,
                self.StoreKey.COMMANDS: {},
                self.StoreKey.COMMANDS_LOCK: threading.Lock(),
            },
        )

    def release_environment(self) -> None:
        daytona: Daytona = self.metadata.store[self.StoreKey.DAYTONA]
        sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        try:
            daytona.delete(sandbox)
        except Exception:
            logger.exception("Failed to delete Daytona sandbox %s during cleanup", sandbox.id)

    def establish_connection(self) -> ConnectionHandle:
        return ConnectionHandle(id=uuid4().hex)

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        pass

    def upload_file(self, path: str, content: BytesIO) -> None:
        remote_path = self._workspace_path(path)
        sandbox: Sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        sandbox.fs.upload_file(content.getvalue(), remote_path)

    def download_file(self, path: str) -> BytesIO:
        remote_path = self._workspace_path(path)
        sandbox: Sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        data = sandbox.fs.download_file(remote_path)
        return BytesIO(data)

    def list_files(self, directory_path: str, limit: int) -> Sequence[FileState]:
        remote_dir = self._workspace_path(directory_path)
        sandbox: Sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        try:
            file_infos = sandbox.fs.list_files(remote_dir)
        except Exception:
            logger.exception("Failed to list files in directory %s", remote_dir)
            return []

        files: list[FileState] = []
        for info in file_infos:
            full_path = posixpath.join(remote_dir, info.name)
            relative_path = posixpath.relpath(full_path, self._working_dir)
            files.append(
                FileState(
                    path=relative_path,
                    size=info.size,
                    created_at=self._parse_mod_time(info.mod_time),
                    updated_at=self._parse_mod_time(info.mod_time),
                )
            )
            if len(files) >= limit:
                break
        return files

    def execute_command(
        self,
        connection_handle: ConnectionHandle,
        command: list[str],
        environments: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> tuple[str, TransportWriteCloser, TransportReadCloser, TransportReadCloser]:
        sandbox: Sandbox = self.metadata.store[self.StoreKey.SANDBOX]

        stdout_stream = QueueTransportReadCloser()
        stderr_stream = QueueTransportReadCloser()
        pid = uuid4().hex

        working_dir = cwd or self._working_dir

        thread = threading.Thread(
            target=self._exec_thread,
            args=(pid, sandbox, command, environments or {}, working_dir, stdout_stream, stderr_stream),
            daemon=True,
        )

        thread.start()

        return pid, NopTransportWriteCloser(), stdout_stream, stderr_stream

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        commands: dict[str, _CommandRecord] = self.metadata.store[self.StoreKey.COMMANDS]
        commands_lock: threading.Lock = self.metadata.store[self.StoreKey.COMMANDS_LOCK]

        with commands_lock:
            record = commands.get(pid)
        if not record:
            return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=None)

        thread: threading.Thread = record["thread"]
        exit_code = record.get("exit_code")
        if thread.is_alive():
            return CommandStatus(status=CommandStatus.Status.RUNNING, exit_code=None)
        return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=exit_code)

    @property
    def _working_dir(self) -> str:
        return cast(str, self.metadata.store[self.StoreKey.WORKDIR])

    def _workspace_path(self, path: str) -> str:
        normalized = posixpath.normpath(path)
        if normalized in ("", "."):
            return self._working_dir
        if normalized.startswith("/"):
            return normalized
        return posixpath.join(self._working_dir, normalized)

    def _exec_thread(
        self,
        pid: str,
        sandbox: Sandbox,
        command: list[str],
        environments: Mapping[str, str],
        cwd: str,
        stdout_stream: QueueTransportReadCloser,
        stderr_stream: QueueTransportReadCloser,
    ) -> None:
        commands: dict[str, _CommandRecord] = self.metadata.store[self.StoreKey.COMMANDS]
        commands_lock: threading.Lock = self.metadata.store[self.StoreKey.COMMANDS_LOCK]

        stdout_writer = stdout_stream.get_write_handler()
        stderr_writer = stderr_stream.get_write_handler()
        exit_code: int | None = None
        try:
            response = sandbox.process.exec(
                command=shlex.join(command),
                env=dict(environments),
                cwd=cwd,
            )
            exit_code = response.exit_code
            output = response.artifacts.stdout if response.artifacts and response.artifacts.stdout else response.result
            if output:
                stdout_writer.write(output.encode())
        except Exception as exc:
            stderr_writer.write(str(exc).encode())
            exit_code = 1
        finally:
            stdout_stream.close()
            stderr_stream.close()
            with commands_lock:
                if pid in commands:
                    commands[pid]["exit_code"] = exit_code

    def _parse_mod_time(self, mod_time: str) -> int:
        try:
            cleaned = mod_time.replace("Z", "+00:00")
            return int(datetime.fromisoformat(cleaned).timestamp())
        except (ValueError, AttributeError, OSError):
            logger.warning("Failed to parse modification time '%s', falling back to current time", mod_time)
            return int(time.time())
