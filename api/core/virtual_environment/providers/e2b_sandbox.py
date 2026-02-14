import logging
import posixpath
import shlex
import threading
from collections.abc import Mapping, Sequence
from enum import StrEnum
from functools import cached_property
from io import BytesIO
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
from core.virtual_environment.__base.exec import (
    ArchNotSupportedError,
    NotSupportedOperationError,
    SandboxConfigValidationError,
)
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.queue_transport import QueueTransportReadCloser
from core.virtual_environment.channel.transport import (
    NopTransportWriteCloser,
    TransportReadCloser,
    TransportWriteCloser,
)
from core.virtual_environment.constants import COMMAND_EXECUTION_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)


"""
import logging
from collections.abc import Mapping
from typing import Any

from core.virtual_environment.providers.e2b_sandbox import E2BEnvironment

options: Mapping[str, Any] = {
    E2BEnvironment.OptionsKey.API_KEY: "?????????",
    E2BEnvironment.OptionsKey.E2B_DEFAULT_TEMPLATE: "code-interpreter-v1",
    E2BEnvironment.OptionsKey.E2B_LIST_FILE_DEPTH: 2,
    E2BEnvironment.OptionsKey.E2B_API_URL: "https://api.e2b.app",
}


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG)

# environment = DockerDaemonEnvironment(options=options)
# environment = LocalVirtualEnvironment(options=options)
environment = E2BEnvironment(options=options)

connection_handle = environment.establish_connection()

pid, transport_stdin, transport_stdout, transport_stderr = environment.execute_command(
    connection_handle, ["uname", "-a"]
)

logger.info("Executed command with PID: %s", pid)

# consume stdout
# consume stdout
while True:
    try:
        output = transport_stdout.read(1024)
    except TransportEOFError:
        logger.info("End of stdout reached")
        break

    logger.info("Command output: %s", output.decode().strip())


environment.release_connection(connection_handle)
environment.release_environment()

"""


class E2BEnvironment(VirtualEnvironment):
    """
    E2B virtual environment provider.
    """

    _WORKDIR = "/home/user"
    _E2B_API_URL = "https://api.e2b.app"

    class OptionsKey(StrEnum):
        API_KEY = "api_key"
        E2B_LIST_FILE_DEPTH = "e2b_list_file_depth"
        E2B_DEFAULT_TEMPLATE = "e2b_default_template"
        E2B_API_URL = "e2b_api_url"

    class StoreKey(StrEnum):
        SANDBOX = "sandbox"
        KEEPALIVE_STOP = "keepalive_stop"

    @classmethod
    def get_config_schema(cls) -> list[BasicProviderConfig]:
        return [
            BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=cls.OptionsKey.API_KEY),
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.E2B_API_URL),
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.E2B_DEFAULT_TEMPLATE),
        ]

    @classmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        # Import E2B SDK lazily so it is loaded after gevent monkey-patching.
        # See `api/gunicorn.conf.py` for how we patch other third-party libs (e.g. gRPC).
        from e2b.exceptions import (
            AuthenticationException,  # type: ignore[import-untyped]
        )
        from e2b_code_interpreter import Sandbox  # type: ignore[import-untyped]

        api_key = options.get(cls.OptionsKey.API_KEY, "")
        if not api_key:
            raise SandboxConfigValidationError("E2B API key is required")

        try:
            Sandbox.list(api_key=api_key, limit=1).next_items()
        except AuthenticationException as e:
            raise SandboxConfigValidationError(f"E2B authentication failed: {e}") from e
        except Exception as e:
            raise SandboxConfigValidationError(f"E2B connection failed: {e}") from e

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        """
        Construct a new E2B virtual environment.
        """
        # Import E2B SDK lazily so it is loaded after gevent monkey-patching.
        from e2b_code_interpreter import Sandbox  # type: ignore[import-untyped]

        # TODO: add Dify as the user agent
        sandbox = Sandbox.create(
            template=options.get(self.OptionsKey.E2B_DEFAULT_TEMPLATE, "code-interpreter-v1"),
            api_key=options.get(self.OptionsKey.API_KEY, ""),
            api_url=options.get(self.OptionsKey.E2B_API_URL, self._E2B_API_URL),
            envs=dict(environments),
        )
        info = sandbox.get_info(api_key=options.get(self.OptionsKey.API_KEY, ""))
        system_info = sandbox.commands.run("uname -m -s").stdout.strip()
        system_parts = system_info.split()
        if len(system_parts) == 2:
            os_part, arch_part = system_parts
        else:
            arch_part = system_parts[0]
            os_part = system_parts[1] if len(system_parts) > 1 else ""

        stop_event = threading.Event()
        threading.Thread(
            target=self._keepalive_thread,
            args=(sandbox, stop_event),
            daemon=True,
        ).start()

        return Metadata(
            id=info.sandbox_id,
            arch=self._convert_architecture(arch_part.strip()),
            os=self._convert_operating_system(os_part.strip()),
            store={
                self.StoreKey.SANDBOX: sandbox,
                self.StoreKey.KEEPALIVE_STOP: stop_event,
            },
        )

    def release_environment(self) -> None:
        """
        Release the E2B virtual environment.
        """
        from e2b_code_interpreter import Sandbox  # type: ignore[import-untyped]

        stop_event: threading.Event | None = self.metadata.store.get(self.StoreKey.KEEPALIVE_STOP)
        if stop_event:
            stop_event.set()

        if not Sandbox.kill(api_key=self.api_key, sandbox_id=self.metadata.id):
            raise Exception(f"Failed to release E2B sandbox with ID: {self.metadata.id}")

    def establish_connection(self) -> ConnectionHandle:
        """
        Establish a connection to the E2B virtual environment.
        """
        return ConnectionHandle(id=uuid4().hex)

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        """
        Release the connection to the E2B virtual environment.
        """
        pass

    def upload_file(self, path: str, content: BytesIO) -> None:
        """
        Upload a file to the E2B virtual environment.

        Args:
            path (str): The path to upload the file to.
            content (BytesIO): The content of the file.
        """
        remote_path = self._workspace_path(path)
        sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        sandbox.files.write(remote_path, content)  # pyright: ignore[reportUnknownMemberType] #

    def download_file(self, path: str) -> BytesIO:
        """
        Download a file from the E2B virtual environment.

        Args:
            path (str): The path to download the file from.
        Returns:
            BytesIO: The content of the file.
        """
        remote_path = self._workspace_path(path)
        sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        content = sandbox.files.read(remote_path, format="bytes")
        return BytesIO(bytes(content))

    def list_files(self, directory_path: str, limit: int) -> Sequence[FileState]:
        """
        List files in a directory of the E2B virtual environment.
        """
        sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        remote_dir = self._workspace_path(directory_path)
        files_info = sandbox.files.list(remote_dir, depth=self.options.get(self.OptionsKey.E2B_LIST_FILE_DEPTH, 3))
        return [
            FileState(
                path=posixpath.relpath(file_info.path, self._WORKDIR),
                size=file_info.size,
                created_at=int(file_info.modified_time.timestamp()),
                updated_at=int(file_info.modified_time.timestamp()),
            )
            for file_info in files_info
        ]

    def execute_command(
        self,
        connection_handle: ConnectionHandle,
        command: list[str],
        environments: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> tuple[str, TransportWriteCloser, TransportReadCloser, TransportReadCloser]:
        """
        Execute a command in the E2B virtual environment.

        STDIN is not yet supported. E2B's API is such a terrible mess... to support it may lead a bad design.
        as a result we leave it for future improvement.
        """
        sandbox = self.metadata.store[self.StoreKey.SANDBOX]
        stdout_stream = QueueTransportReadCloser()
        stderr_stream = QueueTransportReadCloser()

        working_dir = self._workspace_path(cwd) if cwd else self._WORKDIR

        threading.Thread(
            target=self._cmd_thread,
            args=(sandbox, command, environments, working_dir, stdout_stream, stderr_stream),
        ).start()

        return (
            "N/A",
            NopTransportWriteCloser(),  # stdin not supported yet
            stdout_stream,
            stderr_stream,
        )

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        """
        Nop, E2B does not support getting command status yet.
        """
        raise NotSupportedOperationError("E2B does not support getting command status yet.")

    def _cmd_thread(
        self,
        sandbox: Any,
        command: list[str],
        environments: Mapping[str, str] | None,
        cwd: str,
        stdout_stream: QueueTransportReadCloser,
        stderr_stream: QueueTransportReadCloser,
    ) -> None:
        stdout_stream_write_handler = stdout_stream.get_write_handler()
        stderr_stream_write_handler = stderr_stream.get_write_handler()

        try:
            sandbox.commands.run(
                cmd=shlex.join(command),
                envs=dict(environments or {}),
                cwd=cwd,
                on_stdout=lambda data: stdout_stream_write_handler.write(data.encode()),
                on_stderr=lambda data: stderr_stream_write_handler.write(data.encode()),
                timeout=COMMAND_EXECUTION_TIMEOUT_SECONDS,
            )
        except Exception as e:
            # Capture exceptions and write to stderr stream so they can be retrieved via CommandFuture
            # This prevents uncaught exceptions from being printed to console
            error_msg = f"Command execution failed: {type(e).__name__}: {str(e)}\n"
            stderr_stream_write_handler.write(error_msg.encode())
        finally:
            # Close the write handlers to signal EOF
            stdout_stream.close()
            stderr_stream.close()

    def _keepalive_thread(self, sandbox: Any, stop_event: threading.Event) -> None:
        while not stop_event.wait(timeout=60):
            try:
                sandbox.set_timeout(300)
            except Exception:
                logger.warning("Failed to refresh E2B sandbox timeout, sandbox may have been killed")
                break

    @cached_property
    def api_key(self) -> str:
        """
        Get the API key for the E2B environment.
        """
        return self.options.get(self.OptionsKey.API_KEY, "")

    def _workspace_path(self, path: str) -> str:
        """
        Convert a path to an absolute path in the E2B environment.
        Absolute paths are returned as-is, relative paths are joined with _WORKDIR.
        """
        normalized = posixpath.normpath(path)
        if normalized in ("", "."):
            return self._WORKDIR
        if normalized.startswith("/"):
            return normalized
        return posixpath.join(self._WORKDIR, normalized)

    def _convert_architecture(self, arch_str: str) -> Arch:
        arch_map = {
            "x86_64": Arch.AMD64,
            "aarch64": Arch.ARM64,
            "armv7l": Arch.ARM64,
            "arm64": Arch.ARM64,
            "amd64": Arch.AMD64,
            "arm64v8": Arch.ARM64,
            "arm64v7": Arch.ARM64,
        }
        if arch_str in arch_map:
            return arch_map[arch_str]

        raise ArchNotSupportedError(f"Unsupported architecture: {arch_str}")

    def _convert_operating_system(self, os_str: str) -> OperatingSystem:
        os_map = {
            "Linux": OperatingSystem.LINUX,
            "Darwin": OperatingSystem.DARWIN,
        }
        if os_str in os_map:
            return os_map[os_str]

        raise ArchNotSupportedError(f"Unsupported operating system: {os_str}")
