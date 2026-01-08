import os
import pathlib
import subprocess
from collections.abc import Mapping, Sequence
from functools import cached_property
from io import BytesIO
from platform import machine
from typing import Any
from uuid import uuid4

from core.virtual_environment.__base.entities import Arch, CommandStatus, ConnectionHandle, FileState, Metadata
from core.virtual_environment.__base.exec import ArchNotSupportedError
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.pipe_transport import PipeReadCloser, PipeWriteCloser
from core.virtual_environment.channel.transport import TransportReadCloser, TransportWriteCloser

"""
USAGE:

import logging
from collections.abc import Mapping
from typing import Any

from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.providers.local_without_isolation import LocalVirtualEnvironment

options: Mapping[str, Any] = {}

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG)

environment = LocalVirtualEnvironment(options=options)

connection_handle = environment.establish_connection()

pid, transport_stdin, transport_stdout, transport_stderr = environment.execute_command(
    connection_handle,
    ["sh", "-lc", "for i in 1 2 3 4 5; do date '+%F %T'; sleep 1; done"],
)

logger.info("Executed command with PID: %s", pid)

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


class LocalVirtualEnvironment(VirtualEnvironment):
    """
    Local virtual environment provider without isolation.

    WARNING: This provider does not provide any isolation. It's only suitable for development and testing purposes.
    NEVER USE IT IN PRODUCTION ENVIRONMENTS.
    """

    @classmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        pass

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        """
        Construct the local virtual environment.

        Under local without isolation, this method simply create a path for the environment and return the metadata.
        """
        id = uuid4().hex
        working_path = os.path.join(self._base_working_path, id)
        os.makedirs(working_path, exist_ok=True)
        return Metadata(
            id=id,
            arch=self._get_os_architecture(),
        )

    def release_environment(self) -> None:
        """
        Release the local virtual environment.

        Just simply remove the working directory.
        """
        working_path = self.get_working_path()
        if os.path.exists(working_path):
            os.rmdir(working_path)

    def upload_file(self, path: str, content: BytesIO) -> None:
        """
        Upload a file to the local virtual environment.

        Args:
            path (str): The path to upload the file to.
            content (BytesIO): The content of the file.
        """
        working_path = self.get_working_path()
        full_path = os.path.join(working_path, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        pathlib.Path(full_path).write_bytes(content.getbuffer())

    def download_file(self, path: str) -> BytesIO:
        """
        Download a file from the local virtual environment.

        Args:
            path (str): The path to download the file from.
        Returns:
            BytesIO: The content of the file.
        """
        working_path = self.get_working_path()
        full_path = os.path.join(working_path, path)
        content = pathlib.Path(full_path).read_bytes()
        return BytesIO(content)

    def list_files(self, directory_path: str, limit: int) -> Sequence[FileState]:
        """
        List files in a directory of the local virtual environment.
        """
        working_path = self.get_working_path()
        full_directory_path = os.path.join(working_path, directory_path)
        files: list[FileState] = []
        for root, _, filenames in os.walk(full_directory_path):
            for filename in filenames:
                if len(files) >= limit:
                    break
                file_path = os.path.relpath(os.path.join(root, filename), working_path)
                state = os.stat(os.path.join(root, filename))
                files.append(
                    FileState(
                        path=file_path,
                        size=state.st_size,
                        created_at=int(state.st_ctime),
                        updated_at=int(state.st_mtime),
                    )
                )
            if len(files) >= limit:
                # break the outer loop as well
                return files

        return files

    def establish_connection(self) -> ConnectionHandle:
        """
        Establish a connection to the local virtual environment.
        """
        return ConnectionHandle(
            id=uuid4().hex,
        )

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        """
        Release the connection to the local virtual environment.
        """
        # No action needed for local without isolation
        pass

    def execute_command(
        self, connection_handle: ConnectionHandle, command: list[str], environments: Mapping[str, str] | None = None
    ) -> tuple[str, TransportWriteCloser, TransportReadCloser, TransportReadCloser]:
        """
        Execute a command in the local virtual environment.

        Args:
            connection_handle (ConnectionHandle): The connection handle.
            command (list[str]): The command to execute.
        """
        working_path = self.get_working_path()
        stdin_read_fd, stdin_write_fd = os.pipe()
        stdout_read_fd, stdout_write_fd = os.pipe()
        stderr_read_fd, stderr_write_fd = os.pipe()
        try:
            process = subprocess.Popen(
                command,
                stdin=stdin_read_fd,
                stdout=stdout_write_fd,
                stderr=stderr_write_fd,
                cwd=working_path,
                close_fds=True,
                env=environments,
            )
        except Exception:
            # Clean up file descriptors if process creation fails
            for fd in (
                stdin_read_fd,
                stdin_write_fd,
                stdout_read_fd,
                stdout_write_fd,
                stderr_read_fd,
                stderr_write_fd,
            ):
                try:
                    os.close(fd)
                except OSError:
                    pass
            raise

        # Close unused fds in the parent process
        os.close(stdin_read_fd)
        os.close(stdout_write_fd)
        os.close(stderr_write_fd)

        # Create PipeTransport instances for stdin, stdout, and stderr
        stdin_transport = PipeWriteCloser(w_fd=stdin_write_fd)
        stdout_transport = PipeReadCloser(r_fd=stdout_read_fd)
        stderr_transport = PipeReadCloser(r_fd=stderr_read_fd)

        # Return the process ID and file descriptors for stdin, stdout, and stderr
        return str(process.pid), stdin_transport, stdout_transport, stderr_transport

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        pid_int = int(pid)
        try:
            waited_pid, wait_status = os.waitpid(pid_int, os.WNOHANG)
            if waited_pid == 0:
                return CommandStatus(status=CommandStatus.Status.RUNNING, exit_code=None)

            if os.WIFEXITED(wait_status):
                exit_code = os.WEXITSTATUS(wait_status)
            elif os.WIFSIGNALED(wait_status):
                exit_code = -os.WTERMSIG(wait_status)
            else:
                exit_code = None

            return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=exit_code)
        except ChildProcessError:
            return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=None)

    def _get_os_architecture(self) -> Arch:
        """
        Get the operating system architecture.

        Returns:
            Arch: The operating system architecture.
        """

        arch = machine()
        match arch.lower():
            case "x86_64" | "amd64":
                return Arch.AMD64
            case "aarch64" | "arm64":
                return Arch.ARM64
            case _:
                raise ArchNotSupportedError(f"Unsupported architecture: {arch}")

    @cached_property
    def _base_working_path(self) -> str:
        """
        Get the base working path for the local virtual environment.

        Args:
            options (Mapping[str, Any]): Options for requesting the virtual environment.

        Returns:
            str: The base working path.
        """
        cwd = os.getcwd()
        return self.options.get("base_working_path", os.path.join(cwd, "local_virtual_environments"))

    def get_working_path(self) -> str:
        """
        Get the working path for the local virtual environment.

        Returns:
            str: The working path.
        """
        return os.path.join(self._base_working_path, self.metadata.id)
