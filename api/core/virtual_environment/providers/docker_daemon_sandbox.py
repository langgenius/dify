import logging
import socket
import tarfile
import threading
from collections.abc import Mapping, Sequence
from enum import IntEnum, StrEnum
from functools import lru_cache
from io import BytesIO
from pathlib import PurePosixPath
from queue import Queue
from typing import Any, cast
from uuid import uuid4

import docker.errors
from docker.models.containers import Container

import docker
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
from core.virtual_environment.channel.socket_transport import SocketWriteCloser
from core.virtual_environment.channel.transport import TransportReadCloser, TransportWriteCloser


class DockerStreamType(IntEnum):
    """
    Docker multiplexed stream types.

    When Docker exec runs with tty=False, it multiplexes stdout and stderr over a single
    socket connection. Each frame is prefixed with an 8-byte header:

        [stream_type (1 byte)][0][0][0][payload_size (4 bytes, big-endian)]

    This allows the client to distinguish between stdout (type=1) and stderr (type=2).
    See: https://docs.docker.com/engine/api/v1.41/#operation/ContainerAttach
    """

    STDIN = 0
    STDOUT = 1
    STDERR = 2


class DockerDemuxer:
    """
    Demultiplexes Docker's combined stdout/stderr stream using producer-consumer pattern.

    Docker exec with tty=False sends stdout and stderr over a single socket,
    each frame prefixed with an 8-byte header:
        - Byte 0: stream type (1=stdout, 2=stderr)
        - Bytes 1-3: reserved (zeros)
        - Bytes 4-7: payload size (big-endian uint32)

    THREAD SAFETY:
    A single background thread reads frames from the socket and dispatches payloads
    to thread-safe queues. This avoids race conditions where multiple threads
    calling _read_next_frame() simultaneously caused frame header/body corruption,
    resulting in incomplete stdout/stderr output.
    """

    _HEADER_SIZE = 8

    def __init__(self, sock: socket.SocketIO):
        self._sock = sock
        self._stdout_queue: Queue[bytes | None] = Queue()
        self._stderr_queue: Queue[bytes | None] = Queue()
        self._closed = False
        self._error: BaseException | None = None

        self._demux_thread = threading.Thread(
            target=self._demux_loop,
            daemon=True,
            name="docker-demuxer",
        )
        self._demux_thread.start()

    def _demux_loop(self) -> None:
        try:
            while not self._closed:
                header = self._read_exact(self._HEADER_SIZE)
                if not header or len(header) < self._HEADER_SIZE:
                    break

                frame_type = header[0]
                payload_size = int.from_bytes(header[4:8], "big")

                if payload_size == 0:
                    continue

                payload = self._read_exact(payload_size)
                if not payload:
                    break

                if frame_type == DockerStreamType.STDOUT:
                    self._stdout_queue.put(payload)
                elif frame_type == DockerStreamType.STDERR:
                    self._stderr_queue.put(payload)

        except BaseException as e:
            self._error = e
        finally:
            self._stdout_queue.put(None)
            self._stderr_queue.put(None)

    def _read_exact(self, size: int) -> bytes:
        data = bytearray()
        remaining = size
        while remaining > 0:
            try:
                chunk = self._sock.read(remaining)
                if not chunk:
                    return bytes(data) if data else b""
                data.extend(chunk)
                remaining -= len(chunk)
            except (ConnectionResetError, BrokenPipeError):
                return bytes(data) if data else b""
        return bytes(data)

    def read_stdout(self) -> bytes:
        return self._read_from_queue(self._stdout_queue)

    def read_stderr(self) -> bytes:
        return self._read_from_queue(self._stderr_queue)

    def _read_from_queue(self, queue: Queue[bytes | None]) -> bytes:
        if self._error:
            raise TransportEOFError(f"Demuxer error: {self._error}") from self._error

        chunk = queue.get()
        if chunk is None:
            if self._error:
                raise TransportEOFError(f"Demuxer error: {str(self._error)}")
            raise TransportEOFError("End of demuxed stream")
        return chunk

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                self._sock.close()
            except Exception:
                logging.error("Failed to close Docker demuxer socket", exc_info=True)


class DemuxedStdoutReader(TransportReadCloser):
    def __init__(self, demuxer: DockerDemuxer):
        self._demuxer = demuxer
        self._buffer = bytearray()

    def read(self, n: int) -> bytes:
        if self._buffer:
            data = bytes(self._buffer[:n])
            del self._buffer[:n]
            if data:
                return data

        chunk = self._demuxer.read_stdout()
        if len(chunk) <= n:
            return chunk

        self._buffer.extend(chunk[n:])
        return chunk[:n]

    def close(self) -> None:
        self._demuxer.close()


class DemuxedStderrReader(TransportReadCloser):
    def __init__(self, demuxer: DockerDemuxer):
        self._demuxer = demuxer
        self._buffer = bytearray()

    def read(self, n: int) -> bytes:
        if self._buffer:
            data = bytes(self._buffer[:n])
            del self._buffer[:n]
            if data:
                return data

        chunk = self._demuxer.read_stderr()
        if len(chunk) <= n:
            return chunk

        self._buffer.extend(chunk[n:])
        return chunk[:n]

    def close(self) -> None:
        self._demuxer.close()


"""
EXAMPLE:


from collections.abc import Mapping
from typing import Any
from 

from core.virtual_environment.providers.docker_daemon_sandbox import DockerDaemonEnvironment

options: Mapping[str, Any] = {
    # OptionsKey values are optional
    # DockerDaemonEnvironment.OptionsKey.DOCKER_SOCK: "unix:///var/run/docker.sock",
    # DockerDaemonEnvironment.OptionsKey.DOCKER_AGENT_IMAGE: "ubuntu:latest",
    # DockerDaemonEnvironment.OptionsKey.DOCKER_AGENT_COMMAND
    #
    "docker_sock": "unix:///var/run/docker.sock", # optional, default to unix socket
    "docker_agent_image": "ubuntu:latest", # optional, default to ubuntu:latest
    "docker_agent_command": "/bin/sh -c 'while true; do sleep 1; done'", # optional, default to None
}


environment = DockerDaemonEnvironment(options=options)
connection_handle = environment.establish_connection()

pid, transport_stdout, transport_stderr, transport_stdin = environment.execute_command(
    connection_handle, ["uname", "-a"]
)

print(f"Executed command with PID: {pid}")

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


class DockerDaemonEnvironment(VirtualEnvironment):
    _WORKING_DIR = "/workspace"
    _DEAFULT_DOCKER_IMAGE = "ubuntu:latest"
    _DEFAULT_DOCKER_SOCK = (
        "unix:///var/run/docker.sock"  # Use an invalid default to avoid accidental local docker usage
    )

    class OptionsKey(StrEnum):
        DOCKER_SOCK = "docker_sock"
        DOCKER_IMAGE = "docker_image"
        DOCKER_COMMAND = "docker_command"

    @classmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        docker_sock = options.get(cls.OptionsKey.DOCKER_SOCK, cls._DEFAULT_DOCKER_SOCK)
        try:
            client = docker.DockerClient(base_url=docker_sock)
            client.ping()
        except docker.errors.DockerException as e:
            raise SandboxConfigValidationError(f"Docker connection failed: {e}") from e

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        """
        Construct the Docker daemon virtual environment.
        """
        docker_client = self.get_docker_daemon(
            docker_sock=options.get(self.OptionsKey.DOCKER_SOCK, self._DEFAULT_DOCKER_SOCK)
        )

        default_docker_image = options.get(self.OptionsKey.DOCKER_IMAGE, self._DEAFULT_DOCKER_IMAGE)
        container_command = options.get(self.OptionsKey.DOCKER_COMMAND)

        container = docker_client.containers.run(
            image=default_docker_image,
            command=container_command,
            detach=True,
            remove=True,
            stdin_open=True,
            working_dir=self._WORKING_DIR,
            environment=dict(environments),
        )

        # wait for the container to be fully started
        container.reload()

        if not container.id:
            raise VirtualEnvironmentLaunchFailedError("Failed to start Docker container for DockerDaemonEnvironment.")

        return Metadata(
            id=container.id,
            arch=self._get_container_architecture(container),
            os=OperatingSystem.LINUX,
        )

    @classmethod
    @lru_cache(maxsize=5)
    def get_docker_daemon(cls, docker_sock: str) -> docker.DockerClient:
        """
        Get the Docker daemon client.

        NOTE: I guess nobody will use more than 5 different docker sockets in practice....
        """
        return docker.DockerClient(base_url=docker_sock)

    @classmethod
    @lru_cache(maxsize=5)
    def get_docker_api_client(cls, docker_sock: str) -> docker.APIClient:
        """
        Get the Docker low-level API client.
        """
        return docker.APIClient(base_url=docker_sock)

    def get_docker_sock(self) -> str:
        """
        Get the Docker socket path.
        """
        return self.options.get(self.OptionsKey.DOCKER_SOCK, self._DEFAULT_DOCKER_SOCK)

    @property
    def _working_dir(self) -> str:
        """
        Get the working directory inside the Docker container.
        """
        return self._WORKING_DIR

    def _get_container(self) -> Container:
        """
        Get the Docker container instance.
        """
        docker_client = self.get_docker_daemon(self.get_docker_sock())
        return docker_client.containers.get(self.metadata.id)

    def _normalize_relative_path(self, path: str) -> PurePosixPath:
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

    def _relative_path(self, path: str) -> PurePosixPath:
        normalized = self._normalize_relative_path(path)
        if normalized.parts:
            return normalized
        return PurePosixPath()

    def _container_path(self, path: str) -> str:
        relative = self._relative_path(path)
        if not relative.parts:
            return self._working_dir
        return f"{self._working_dir}/{relative.as_posix()}"

    def upload_file(self, path: str, content: BytesIO) -> None:
        container = self._get_container()
        relative_path = self._relative_path(path)
        if not relative_path.parts:
            raise ValueError("Upload path must point to a file within the workspace.")

        payload = content.getvalue()
        tar_stream = BytesIO()
        with tarfile.open(fileobj=tar_stream, mode="w") as tar:
            tar_info = tarfile.TarInfo(name=relative_path.as_posix())
            tar_info.size = len(payload)
            tar.addfile(tar_info, BytesIO(payload))
        tar_stream.seek(0)
        container.put_archive(self._working_dir, tar_stream.read())  # pyright: ignore[reportUnknownMemberType] #

    def download_file(self, path: str) -> BytesIO:
        container = self._get_container()
        container_path = self._container_path(path)
        stream, _ = container.get_archive(container_path)
        tar_stream = BytesIO()
        for chunk in stream:
            tar_stream.write(chunk)
        tar_stream.seek(0)

        with tarfile.open(fileobj=tar_stream, mode="r:*") as tar:
            members = [member for member in tar.getmembers() if member.isfile()]
            if not members:
                return BytesIO()
            extracted = tar.extractfile(members[0])
            if extracted is None:
                return BytesIO()
            return BytesIO(extracted.read())

    def list_files(self, directory_path: str, limit: int) -> Sequence[FileState]:
        container = self._get_container()
        container_path = self._container_path(directory_path)
        relative_base = self._relative_path(directory_path)
        try:
            stream, _ = container.get_archive(container_path)
        except docker.errors.NotFound:
            return []
        tar_stream = BytesIO()
        for chunk in stream:
            tar_stream.write(chunk)
        tar_stream.seek(0)

        files: list[FileState] = []
        archive_root = PurePosixPath(container_path).name
        with tarfile.open(fileobj=tar_stream, mode="r:*") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                member_path = PurePosixPath(member.name)
                if member_path.parts and member_path.parts[0] == archive_root:
                    member_path = PurePosixPath(*member_path.parts[1:])
                if not member_path.parts:
                    continue
                relative_path = relative_base / member_path
                files.append(
                    FileState(
                        path=relative_path.as_posix(),
                        size=member.size,
                        created_at=int(member.mtime),
                        updated_at=int(member.mtime),
                    )
                )
                if len(files) >= limit:
                    break
        return files

    def establish_connection(self) -> ConnectionHandle:
        return ConnectionHandle(id=uuid4().hex)

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        # No action needed for Docker exec connections
        pass

    def release_environment(self) -> None:
        try:
            container = self._get_container()
        except docker.errors.NotFound:
            return
        try:
            container.remove(force=True)
        except docker.errors.NotFound:
            return

    def execute_command(
        self, connection_handle: ConnectionHandle, command: list[str], environments: Mapping[str, str] | None = None
    ) -> tuple[str, TransportWriteCloser, TransportReadCloser, TransportReadCloser]:
        container = self._get_container()
        container_id = container.id
        if not isinstance(container_id, str) or not container_id:
            raise RuntimeError("Docker container ID is not available for exec.")
        api_client = self.get_docker_api_client(self.get_docker_sock())
        exec_info: dict[str, object] = cast(
            dict[str, object],
            api_client.exec_create(  # pyright: ignore[reportUnknownMemberType] #
                container_id,
                cmd=command,
                stdin=True,
                stdout=True,
                stderr=True,
                tty=False,
                workdir=self._working_dir,
                environment=environments,
            ),
        )

        if not isinstance(exec_info.get("Id"), str):
            raise RuntimeError("Failed to create Docker exec instance.")

        exec_id: str = str(exec_info.get("Id"))
        raw_sock: socket.SocketIO = cast(socket.SocketIO, api_client.exec_start(exec_id, socket=True, tty=False))  # pyright: ignore[reportUnknownMemberType] #

        stdin_transport = SocketWriteCloser(raw_sock)
        demuxer = DockerDemuxer(raw_sock)
        stdout_transport = DemuxedStdoutReader(demuxer)
        stderr_transport = DemuxedStderrReader(demuxer)

        return exec_id, stdin_transport, stdout_transport, stderr_transport

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        api_client = self.get_docker_api_client(self.get_docker_sock())
        inspect: dict[str, object] = cast(dict[str, object], api_client.exec_inspect(pid))  # pyright: ignore[reportUnknownMemberType] #
        exit_code = inspect.get("ExitCode")
        if inspect.get("Running") or exit_code is None:
            return CommandStatus(status=CommandStatus.Status.RUNNING, exit_code=None)
        if not isinstance(exit_code, int):
            exit_code = None
        return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=exit_code)

    def _get_container_architecture(self, container: Container) -> Arch:
        """
        Get the architecture of the Docker container.
        """
        return Arch.ARM64

        # container.reload()
        # arch_str = str(container.attrs["Architecture"])
        # match arch_str.lower():
        #     case "x86_64" | "amd64":
        #         return Arch.AMD64
        #     case "aarch64" | "arm64":
        #         return Arch.ARM64
        #     case _:
        #         raise ArchNotSupportedError(f"Architecture {arch_str} is not supported in DockerDaemonEnvironment.")
