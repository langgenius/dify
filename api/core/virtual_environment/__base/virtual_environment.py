from abc import ABC, abstractmethod
from collections.abc import Mapping
from io import BytesIO
from typing import Any

from core.virtual_environment.__base.entities import CommandStatus, ConnectionHandle, Metadata


class VirtualEnvironment(ABC):
    """
    Base class for virtual environment implementations.
    """

    @abstractmethod
    def request_environment(self, options: Mapping[str, Any]) -> Metadata:
        """
        Request a virtual environment with the given options.

        Args:
            options (Mapping[str, Any]): Options for requesting the virtual environment.
                Those options are implementation-specific, which can be defined in environment

        Returns:
            Metadata: Metadata about the requested virtual environment.

        Raises:
            Exception: If the environment cannot be requested.
        """

    @abstractmethod
    def upload_file(self, environment_id: str, destination_path: str, content: BytesIO) -> None:
        """
        Upload a file to the virtual environment.

        Args:
            environment_id (str): The unique identifier of the virtual environment.
            destination_path (str): The destination path in the virtual environment.
            content (BytesIO): The content of the file to upload.

        Raises:
            Exception: If the file cannot be uploaded.
        """

    @abstractmethod
    def establish_connection(self, environment_id: str) -> ConnectionHandle:
        """
        Establish a connection to the virtual environment.

        Args:
            environment_id (str): The unique identifier of the virtual environment.

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
    def release_environment(self, environment_id: str) -> None:
        """
        Release the virtual environment.

        Args:
            environment_id (str): The unique identifier of the virtual environment.

        Raises:
            Exception: If the environment cannot be released.
            Multiple calls to `release_environment` with the same `environment_id` is acceptable.
        """

    @abstractmethod
    def execute_command(self, connection_handle: ConnectionHandle, command: list[str]) -> tuple[int, int, int, int]:
        """
        Execute a command in the virtual environment.

        Args:
            connection_handle (ConnectionHandle): The handle for managing the connection.
            command (list[str]): The command to execute as a list of strings.

        Returns:
            tuple[int, int, int, int]: A tuple containing pid and 3 handle to os.pipe(): (stdin, stdout, stderr).
            After exuection, the 3 handles will be closed by `execute_command` itself.
        """

    @abstractmethod
    def get_command_status(self, connection_handle: ConnectionHandle, pid: int) -> CommandStatus:
        """
        Get the status of a command executed in the virtual environment.

        Args:
            connection_handle (ConnectionHandle): The handle for managing the connection.
            pid (int): The process ID of the command.
        Returns:
            CommandStatus: The status of the command execution.
        """
