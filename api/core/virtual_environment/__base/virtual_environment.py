from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from io import BytesIO
from typing import Any

from core.virtual_environment.__base.entities import CommandStatus, ConnectionHandle, FileState, Metadata
from core.virtual_environment.channel.transport import Transport


class VirtualEnvironment(ABC):
    """
    Base class for virtual environment implementations.
    """

    def __init__(self, options: Mapping[str, Any], environments: Mapping[str, Any] | None = None) -> None:
        """
        Initialize the virtual environment with metadata.
        """

        self.options = options
        self.metadata = self.construct_environment(options, environments or {})

    @abstractmethod
    def construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, Any]) -> Metadata:
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

    @abstractmethod
    def execute_command(
        self, connection_handle: ConnectionHandle, command: list[str]
    ) -> tuple[str, Transport, Transport, Transport]:
        """
        Execute a command in the virtual environment.

        Args:
            connection_handle (ConnectionHandle): The handle for managing the connection.
            command (list[str]): The command to execute as a list of strings.

        Returns:
            tuple[int, Transport, Transport, Transport]: A tuple containing pid and 3 handle
            to os.pipe(): (stdin, stdout, stderr).
            After exuection, the 3 handles will be closed by caller.
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
