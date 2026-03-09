"""
AWS Bedrock AgentCore Code Interpreter sandbox provider.

Uses the AgentCore Code Interpreter built-in tool to provide a sandboxed code execution
environment with shell access and file operations. The Code Interpreter runs in an
isolated microVM managed by AWS and communicates via the `InvokeCodeInterpreter` API.

Two boto3 clients are involved:
- **bedrock-agentcore-control** (Control Plane): manages the Code Interpreter resource
  (create / delete). Users must create one beforehand or use the system-provided
  ``aws.codeinterpreter.v1``.
- **bedrock-agentcore** (Data Plane): manages sessions and executes operations
  (start/stop session, execute commands, file I/O).

Key differences from other providers:
- stdin is not supported (same as E2B) — uses ``NopTransportWriteCloser``.
- ``executeCommand`` returns the full stdout/stderr once the command completes,
  rather than streaming incrementally. We wrap the result with
  ``QueueTransportReadCloser`` so the upper-layer ``CommandFuture`` works unchanged.
- ``get_command_status`` raises ``NotSupportedOperationError`` (same as E2B).
  The synchronous ``executeCommand`` path is used instead.
"""

import logging
import posixpath
import shlex
import threading
from collections.abc import Mapping, Sequence
from enum import StrEnum
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

# Maximum time in seconds that the boto3 read on the EventStream socket is
# allowed to block. Must exceed the longest expected command execution.
_BOTO3_READ_TIMEOUT_SECONDS = COMMAND_EXECUTION_TIMEOUT_SECONDS + 60


class AWSCodeInterpreterEnvironment(VirtualEnvironment):
    """
    AWS Bedrock AgentCore Code Interpreter virtual environment provider.

    The provider maps the ``VirtualEnvironment`` protocol onto the AgentCore
    Code Interpreter Data-Plane API (``InvokeCodeInterpreter``).

    Lifecycle:
        1. ``_construct_environment`` starts a new session via
           ``StartCodeInterpreterSession``.
        2. Commands and file operations invoke ``InvokeCodeInterpreter`` with
           the appropriate ``name`` (``executeCommand``, ``writeFiles``, etc.).
        3. ``release_environment`` stops the session via
           ``StopCodeInterpreterSession``.

    Configuration (``OptionsKey``):
        - ``aws_access_key_id`` / ``aws_secret_access_key``: IAM credentials.
        - ``aws_region``: AWS region (e.g. ``us-east-1``).
        - ``code_interpreter_id``: the Code Interpreter resource identifier
          (e.g. ``aws.codeinterpreter.v1`` for the system-provided one).
        - ``session_timeout_seconds``: optional; defaults to 900 (15 min).
    """

    _WORKDIR = "/home/user"

    class OptionsKey(StrEnum):
        AWS_ACCESS_KEY_ID = "aws_access_key_id"
        AWS_SECRET_ACCESS_KEY = "aws_secret_access_key"
        AWS_REGION = "aws_region"
        CODE_INTERPRETER_ID = "code_interpreter_id"
        SESSION_TIMEOUT_SECONDS = "session_timeout_seconds"

    class StoreKey(StrEnum):
        CLIENT = "client"
        SESSION_ID = "session_id"
        CODE_INTERPRETER_ID = "code_interpreter_id"

    # ------------------------------------------------------------------
    # Config schema & validation
    # ------------------------------------------------------------------

    @classmethod
    def get_config_schema(cls) -> list[BasicProviderConfig]:
        return [
            BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=cls.OptionsKey.AWS_ACCESS_KEY_ID),
            BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=cls.OptionsKey.AWS_SECRET_ACCESS_KEY),
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.AWS_REGION),
            BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name=cls.OptionsKey.CODE_INTERPRETER_ID),
        ]

    @classmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        """Validate credentials by starting then immediately stopping a session."""
        import boto3
        from botocore.exceptions import ClientError

        for key in (cls.OptionsKey.AWS_ACCESS_KEY_ID, cls.OptionsKey.AWS_SECRET_ACCESS_KEY, cls.OptionsKey.AWS_REGION):
            if not options.get(key):
                raise SandboxConfigValidationError(f"{key} is required")

        code_interpreter_id = options.get(cls.OptionsKey.CODE_INTERPRETER_ID, "")
        if not code_interpreter_id:
            raise SandboxConfigValidationError("code_interpreter_id is required")

        client = boto3.client(
            "bedrock-agentcore",
            region_name=options[cls.OptionsKey.AWS_REGION],
            aws_access_key_id=options[cls.OptionsKey.AWS_ACCESS_KEY_ID],
            aws_secret_access_key=options[cls.OptionsKey.AWS_SECRET_ACCESS_KEY],
        )

        try:
            resp = client.start_code_interpreter_session(
                codeInterpreterIdentifier=code_interpreter_id,
                sessionTimeoutSeconds=60,
            )
            session_id = resp["sessionId"]
            # Immediately stop the validation session.
            client.stop_code_interpreter_session(
                codeInterpreterIdentifier=code_interpreter_id,
                sessionId=session_id,
            )
        except ClientError as exc:
            raise SandboxConfigValidationError(f"AWS AgentCore Code Interpreter validation failed: {exc}") from exc
        except Exception as exc:
            raise SandboxConfigValidationError(f"AWS AgentCore Code Interpreter connection failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Environment lifecycle
    # ------------------------------------------------------------------

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        """Start a new Code Interpreter session and detect platform info."""
        import boto3
        from botocore.config import Config

        code_interpreter_id: str = options.get(self.OptionsKey.CODE_INTERPRETER_ID, "")
        timeout_seconds: int = int(options.get(self.OptionsKey.SESSION_TIMEOUT_SECONDS, 900))

        client = boto3.client(
            "bedrock-agentcore",
            region_name=options[self.OptionsKey.AWS_REGION],
            aws_access_key_id=options[self.OptionsKey.AWS_ACCESS_KEY_ID],
            aws_secret_access_key=options[self.OptionsKey.AWS_SECRET_ACCESS_KEY],
            config=Config(read_timeout=_BOTO3_READ_TIMEOUT_SECONDS),
        )

        resp = client.start_code_interpreter_session(
            codeInterpreterIdentifier=code_interpreter_id,
            sessionTimeoutSeconds=timeout_seconds,
        )
        session_id: str = resp["sessionId"]

        logger.info(
            "AgentCore Code Interpreter session started: code_interpreter_id=%s, session_id=%s",
            code_interpreter_id,
            session_id,
        )

        # Detect architecture and OS via a quick command.
        arch = Arch.AMD64
        operating_system = OperatingSystem.LINUX
        try:
            result = self._invoke(client, code_interpreter_id, session_id, "executeCommand", {"command": "uname -m -s"})
            system_info = (result.get("stdout") or "").strip()
            parts = system_info.split()
            if len(parts) >= 2:
                operating_system = self._convert_operating_system(parts[0])
                arch = self._convert_architecture(parts[1])
            elif len(parts) == 1:
                arch = self._convert_architecture(parts[0])
        except Exception:
            logger.warning("Failed to detect platform info, defaulting to Linux/AMD64")

        # Inject environment variables if provided.
        if environments:
            export_parts = [f"export {k}={shlex.quote(v)}" for k, v in environments.items()]
            export_cmd = " && ".join(export_parts)
            try:
                self._invoke(client, code_interpreter_id, session_id, "executeCommand", {"command": export_cmd})
            except Exception:
                logger.warning("Failed to inject environment variables into AgentCore session")

        return Metadata(
            id=session_id,
            arch=arch,
            os=operating_system,
            store={
                self.StoreKey.CLIENT: client,
                self.StoreKey.SESSION_ID: session_id,
                self.StoreKey.CODE_INTERPRETER_ID: code_interpreter_id,
            },
        )

    def release_environment(self) -> None:
        """Stop the Code Interpreter session and release resources."""
        client = self._client
        try:
            client.stop_code_interpreter_session(
                codeInterpreterIdentifier=self._code_interpreter_id,
                sessionId=self._session_id,
            )
            logger.info("AgentCore Code Interpreter session stopped: session_id=%s", self._session_id)
        except Exception:
            logger.warning(
                "Failed to stop AgentCore Code Interpreter session: session_id=%s",
                self._session_id,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # Connection (virtual — no real connection needed)
    # ------------------------------------------------------------------

    def establish_connection(self) -> ConnectionHandle:
        return ConnectionHandle(id=uuid4().hex)

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        pass

    # ------------------------------------------------------------------
    # Command execution
    # ------------------------------------------------------------------

    def execute_command(
        self,
        connection_handle: ConnectionHandle,
        command: list[str],
        environments: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> tuple[str, TransportWriteCloser, TransportReadCloser, TransportReadCloser]:
        """
        Execute a shell command via AgentCore Code Interpreter.

        The command is executed synchronously on the AWS side; a background thread
        calls ``executeCommand`` and feeds the result into queue-based transports
        so the caller sees the standard Transport interface.

        stdin is not supported — ``NopTransportWriteCloser`` is returned.
        """
        stdout_stream = QueueTransportReadCloser()
        stderr_stream = QueueTransportReadCloser()

        working_dir = self._workspace_path(cwd) if cwd else self._WORKDIR
        cmd_str = shlex.join(command)

        # Wrap env vars and cwd into the command string since the API only
        # accepts a flat ``command`` string argument.
        prefix_parts: list[str] = []
        if environments:
            for k, v in environments.items():
                prefix_parts.append(f"export {k}={shlex.quote(v)}")
        prefix_parts.append(f"cd {shlex.quote(working_dir)}")
        full_cmd = " && ".join([*prefix_parts, cmd_str])

        threading.Thread(
            target=self._cmd_thread,
            args=(full_cmd, stdout_stream, stderr_stream),
            daemon=True,
        ).start()

        return (
            "N/A",
            NopTransportWriteCloser(),
            stdout_stream,
            stderr_stream,
        )

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        """Not supported — same as E2B. ``CommandFuture`` handles this gracefully."""
        raise NotSupportedOperationError("AgentCore Code Interpreter does not support getting command status.")

    # ------------------------------------------------------------------
    # File operations
    # ------------------------------------------------------------------

    def upload_file(self, path: str, content: BytesIO) -> None:
        """Upload a file to the Code Interpreter session."""
        remote_path = self._workspace_path(path)
        file_bytes = content.read()

        self._invoke(
            self._client,
            self._code_interpreter_id,
            self._session_id,
            "writeFiles",
            {"content": [{"path": remote_path, "blob": file_bytes}]},
        )

    def download_file(self, path: str) -> BytesIO:
        """Download a file from the Code Interpreter session."""
        remote_path = self._workspace_path(path)

        result = self._invoke(
            self._client,
            self._code_interpreter_id,
            self._session_id,
            "readFiles",
            {"path": remote_path},
        )

        # The response content blocks may contain blob or text data.
        content_blocks: list[dict[str, Any]] = result.get("content", [])
        for block in content_blocks:
            resource = block.get("resource")
            if resource:
                blob = resource.get("blob")
                if blob:
                    return BytesIO(blob if isinstance(blob, bytes) else blob.encode())
                text = resource.get("text")
                if text:
                    return BytesIO(text.encode("utf-8"))
            # Fallback: check top-level data/text fields.
            if block.get("data"):
                data = block["data"]
                return BytesIO(data if isinstance(data, bytes) else data.encode())
            if block.get("text"):
                return BytesIO(block["text"].encode("utf-8"))

        return BytesIO(b"")

    def list_files(self, directory_path: str, limit: int) -> Sequence[FileState]:
        """List files in a directory of the Code Interpreter session."""
        remote_dir = self._workspace_path(directory_path)

        result = self._invoke(
            self._client,
            self._code_interpreter_id,
            self._session_id,
            "listFiles",
            {"directoryPath": remote_dir},
        )

        # The API returns file information in content blocks.
        # Since the exact structure may vary, we also fall back to running
        # a shell command to list files if the content format is not parseable.
        content_blocks: list[dict[str, Any]] = result.get("content", [])
        files: list[FileState] = []

        for block in content_blocks:
            text = block.get("text", "")
            name = block.get("name", "")
            size = block.get("size", 0)
            uri = block.get("uri", "")

            file_path = uri or name or text
            if not file_path:
                continue

            # Normalise to relative path from workdir.
            if file_path.startswith(self._WORKDIR):
                file_path = posixpath.relpath(file_path, self._WORKDIR)

            files.append(
                FileState(
                    path=file_path,
                    size=size or 0,
                    created_at=0,
                    updated_at=0,
                )
            )

            if len(files) >= limit:
                break

        return files

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def _client(self) -> Any:
        return self.metadata.store[self.StoreKey.CLIENT]

    @property
    def _session_id(self) -> str:
        return str(self.metadata.store[self.StoreKey.SESSION_ID])

    @property
    def _code_interpreter_id(self) -> str:
        return str(self.metadata.store[self.StoreKey.CODE_INTERPRETER_ID])

    def _workspace_path(self, path: str) -> str:
        """Convert a path to an absolute path in the Code Interpreter session."""
        normalized = posixpath.normpath(path)
        if normalized in ("", "."):
            return self._WORKDIR
        if normalized.startswith("/"):
            return normalized
        return posixpath.join(self._WORKDIR, normalized)

    def _cmd_thread(
        self,
        command: str,
        stdout_stream: QueueTransportReadCloser,
        stderr_stream: QueueTransportReadCloser,
    ) -> None:
        """Background thread that executes a command and feeds output into queue transports."""
        stdout_writer = stdout_stream.get_write_handler()
        stderr_writer = stderr_stream.get_write_handler()

        try:
            result = self._invoke(
                self._client,
                self._code_interpreter_id,
                self._session_id,
                "executeCommand",
                {"command": command},
            )
            stdout_data = result.get("stdout", "")
            stderr_data = result.get("stderr", "")

            if stdout_data:
                stdout_writer.write(stdout_data.encode("utf-8") if isinstance(stdout_data, str) else stdout_data)
            if stderr_data:
                stderr_writer.write(stderr_data.encode("utf-8") if isinstance(stderr_data, str) else stderr_data)
        except Exception as exc:
            error_msg = f"Command execution failed: {type(exc).__name__}: {exc}\n"
            stderr_writer.write(error_msg.encode())
        finally:
            stdout_stream.close()
            stderr_stream.close()

    @staticmethod
    def _invoke(
        client: Any,
        code_interpreter_id: str,
        session_id: str,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Call ``InvokeCodeInterpreter`` and extract the structured result.

        The API returns an EventStream; this helper iterates over it and merges
        ``structuredContent`` and ``content`` from all ``result`` events into a
        single dict.

        Returns a dict that may contain:
            - ``stdout``, ``stderr``, ``exitCode``, ``taskId``, ``taskStatus``,
              ``executionTime`` (from ``structuredContent``)
            - ``content`` (list of content blocks)
            - ``isError`` (bool)
        """
        response = client.invoke_code_interpreter(
            codeInterpreterIdentifier=code_interpreter_id,
            sessionId=session_id,
            name=name,
            arguments=arguments,
        )

        merged: dict[str, Any] = {"content": []}

        stream = response.get("stream")
        if stream is None:
            return merged

        for event in stream:
            result = event.get("result")
            if result is None:
                # Check for exception events.
                for exc_key in (
                    "accessDeniedException",
                    "validationException",
                    "resourceNotFoundException",
                    "throttlingException",
                    "internalServerException",
                ):
                    if event.get(exc_key):
                        raise RuntimeError(f"AgentCore error ({exc_key}): {event[exc_key]}")
                continue

            if result.get("isError"):
                merged["isError"] = True

            structured = result.get("structuredContent")
            if structured:
                merged.update(structured)

            content = result.get("content")
            if content:
                merged["content"].extend(content)

        return merged

    @staticmethod
    def _convert_architecture(arch_str: str) -> Arch:
        arch_map: dict[str, Arch] = {
            "x86_64": Arch.AMD64,
            "aarch64": Arch.ARM64,
            "armv7l": Arch.ARM64,
            "arm64": Arch.ARM64,
            "amd64": Arch.AMD64,
        }
        if arch_str in arch_map:
            return arch_map[arch_str]
        raise ArchNotSupportedError(f"Unsupported architecture: {arch_str}")

    @staticmethod
    def _convert_operating_system(os_str: str) -> OperatingSystem:
        os_map: dict[str, OperatingSystem] = {
            "Linux": OperatingSystem.LINUX,
            "Darwin": OperatingSystem.DARWIN,
        }
        if os_str in os_map:
            return os_map[os_str]
        raise ArchNotSupportedError(f"Unsupported operating system: {os_str}")
