from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from io import BytesIO
from typing import Any

from core.entities.provider_entities import BasicProviderConfig
from core.virtual_environment.__base.entities import CommandStatus, ConnectionHandle, FileState, Metadata
from core.virtual_environment.channel.transport import TransportReadCloser, TransportWriteCloser


class VirtualEnvironment(ABC):
    """
    Base class for virtual environment implementations.

    ``VirtualEnvironment`` instances are configured at construction time but do
    not allocate provider resources until ``open_enviroment()`` is called.
    This keeps object construction side-effect free and gives callers a chance
    to own startup error handling explicitly.
    """

    tenant_id: str
    user_id: str | None
    options: Mapping[str, Any]
    _environments: Mapping[str, str]
    _metadata: Metadata | None

    def __init__(
        self,
        tenant_id: str,
        options: Mapping[str, Any],
        environments: Mapping[str, str] | None = None,
        user_id: str | None = None,
    ) -> None:
        """
        Initialize the virtual environment configuration.

        Args:
            tenant_id: The tenant ID associated with this environment (required).
            options: Provider-specific configuration options.
            environments: Environment variables to set in the virtual environment.
            user_id: The user ID associated with this environment (optional).

        The provider runtime itself is created later by ``open_enviroment()``.
        """

        self.tenant_id = tenant_id
        self.user_id = user_id
        self.options = options
        self._environments = dict(environments or {})
        self._metadata = None

    @property
    def metadata(self) -> Metadata:
        """Provider metadata for a started environment.

        Raises:
            RuntimeError: If the environment has not been started yet.
        """

        if self._metadata is None:
            raise RuntimeError("Virtual environment has not been started")
        return self._metadata

    def open_enviroment(self) -> Metadata:
        """Allocate provider resources and return the resulting metadata.

        Multiple calls are safe and return the existing metadata after the first
        successful start.
        """

        if self._metadata is None:
            self._metadata = self._construct_environment(self.options, self._environments)
        return self._metadata

    @abstractmethod
    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        """
        Construct the unique identifier for the virtual environment.

        Returns:
            str: The unique identifier of the virtual environment.
        """

    @abstractmethod
    def upload_file(self, path: str, content: BytesIO) -> None:
        """
        Upload a file to the virtual environment.

        Args:
            path (str): The destination path in the virtual environment.
            content (BytesIO): The content of the file to upload.

        Raises:
            Exception: If the file cannot be uploaded.
        """

    @abstractmethod
    def download_file(self, path: str) -> BytesIO:
        """
        Download a file from the virtual environment.

        Args:
            source_path (str): The source path in the virtual environment.
        Returns:
            BytesIO: The content of the downloaded file.
        Raises:
            Exception: If the file cannot be downloaded.
        """

    @abstractmethod
    def list_files(self, directory_path: str, limit: int) -> Sequence[FileState]:
        """
        List files in a directory of the virtual environment.

        Args:
            directory_path (str): The directory path in the virtual environment.
            limit (int): The maximum number of files(including recursive paths) to return.
        Returns:
            Sequence[FileState]: A list of file states in the specified directory.
        Raises:
            Exception: If the files cannot be listed.

        Example:
            If the directory structure is like:
            /dir
              /subdir1
                file1.txt
              /subdir2
                file2.txt
            And limit is 2, the returned list may look like:
            [
                FileState(path="/dir/subdir1/file1.txt", is_directory=False, size=1234, created_at=..., updated_at=...),
                FileState(path="/dir/subdir2", is_directory=True, size=0, created_at=..., updated_at=...),
            ]
        """

    @abstractmethod
    def establish_connection(self) -> ConnectionHandle:
        """
        Establish a connection to the virtual environment.

        Returns:
            ConnectionHandle: Handle for managing the connection to the virtual environment.

        Raises:
            Exception: If the connection cannot be established.
        """

    @abstractmethod
    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        """
        Release the connection to the virtual environment.

        Args:
            connection_handle (ConnectionHandle): The handle for managing the connection.

        Raises:
            Exception: If the connection cannot be released.
        """

    @abstractmethod
    def release_environment(self) -> None:
        """
        Release the virtual environment.

        Raises:
            Exception: If the environment cannot be released.
            Multiple calls to `release_environment` with the same `environment_id` is acceptable.
        """

    def terminate_command(self, connection_handle: ConnectionHandle, pid: str) -> bool:
        """Best-effort termination hook for a running command.

        Providers that can map ``pid`` back to a real process/session should
        override this method and stop the command. The default implementation is
        a no-op so providers without a termination mechanism remain compatible.
        """

        _ = connection_handle
        _ = pid
        return False

    @abstractmethod
    def execute_command(
        self,
        connection_handle: ConnectionHandle,
        command: list[str],
        environments: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> tuple[str, TransportWriteCloser, TransportReadCloser, TransportReadCloser]:
        """
        Execute a command in the virtual environment.

        Args:
            connection_handle (ConnectionHandle): The handle for managing the connection.
            command (list[str]): The command to execute as a list of strings.
            environments (Mapping[str, str] | None): Environment variables for the command.
            cwd (str | None): Working directory for the command. If None, uses the provider's default.

        Returns:
            tuple[int, TransportWriteCloser, TransportReadCloser, TransportReadCloser]
            a tuple containing pid and 3 handle to os.pipe(): (stdin, stdout, stderr).
            After exuection, the 3 handles will be closed by caller.
        """

    @classmethod
    @abstractmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        """
        Validate that options can connect to the provider.

        Raises:
            SandboxConfigValidationError: If validation fails
        """

    @abstractmethod
    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        """
        Get the status of a command executed in the virtual environment.

        Args:
            connection_handle (ConnectionHandle): The handle for managing the connection.
            pid (int): The process ID of the command.
        Returns:
            CommandStatus: The status of the command execution.
        """

    @classmethod
    @abstractmethod
    def get_config_schema(cls) -> list[BasicProviderConfig]:
        pass
