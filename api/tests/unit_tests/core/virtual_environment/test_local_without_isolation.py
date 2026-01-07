from io import BytesIO
from pathlib import Path

import pytest

from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.transport import TransportReadCloser
from core.virtual_environment.providers import local_without_isolation
from core.virtual_environment.providers.local_without_isolation import LocalVirtualEnvironment


def _drain_transport(transport: TransportReadCloser) -> bytes:
    chunks: list[bytes] = []
    try:
        while True:
            data = transport.read(4096)
            if not data:
                break
            chunks.append(data)
    except TransportEOFError:
        pass
    return b"".join(chunks)


@pytest.fixture
def local_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> LocalVirtualEnvironment:
    monkeypatch.setattr(local_without_isolation, "machine", lambda: "x86_64")
    return LocalVirtualEnvironment({"base_working_path": str(tmp_path)})


def test_construct_environment_creates_working_path(local_env: LocalVirtualEnvironment):
    working_path = local_env.get_working_path()
    assert local_env.metadata.id
    assert Path(working_path).is_dir()


def test_upload_download_roundtrip(local_env: LocalVirtualEnvironment):
    content = BytesIO(b"payload")
    local_env.upload_file("nested/file.txt", content)

    downloaded = local_env.download_file("nested/file.txt")

    assert downloaded.getvalue() == b"payload"


def test_list_files_respects_limit(local_env: LocalVirtualEnvironment):
    local_env.upload_file("dir/file_a.txt", BytesIO(b"a"))
    local_env.upload_file("file_b.txt", BytesIO(b"b"))

    all_files = local_env.list_files("", limit=10)
    all_paths = {state.path for state in all_files}

    assert "dir/file_a.txt" in all_paths or "dir\\file_a.txt" in all_paths
    assert "file_b.txt" in all_paths

    limited_files = local_env.list_files("", limit=1)
    assert len(limited_files) == 1


def test_execute_command_uses_working_directory(local_env: LocalVirtualEnvironment):
    local_env.upload_file("message.txt", BytesIO(b"hello"))
    connection = local_env.establish_connection()
    command = ["/bin/sh", "-c", "cat message.txt"]

    _, stdin_transport, stdout_transport, stderr_transport = local_env.execute_command(connection, command)

    try:
        stdin_transport.close()
        stdout = _drain_transport(stdout_transport)
        stderr = _drain_transport(stderr_transport)
    finally:
        stdout_transport.close()
        stderr_transport.close()

    assert stdout == b"hello"
    assert stderr == b""


def test_execute_command_pipes_stdio(local_env: LocalVirtualEnvironment):
    connection = local_env.establish_connection()
    command = ["/bin/sh", "-c", "tr a-z A-Z < /dev/stdin; printf ERR >&2"]

    _, stdin_transport, stdout_transport, stderr_transport = local_env.execute_command(connection, command)

    try:
        stdin_transport.write(b"abc")
        stdin_transport.close()
        stdout = _drain_transport(stdout_transport)
        stderr = _drain_transport(stderr_transport)
    finally:
        stdout_transport.close()
        stderr_transport.close()

    assert stdout == b"ABC"
    assert stderr == b"ERR"


def test_run_command_returns_output(local_env: LocalVirtualEnvironment):
    local_env.upload_file("message.txt", BytesIO(b"hello"))
    connection = local_env.establish_connection()

    result = local_env.run_command(connection, ["/bin/sh", "-c", "cat message.txt"]).result(timeout=10)

    assert result.stdout == b"hello"
    assert result.stderr == b""
    assert result.exit_code == 0


def test_run_command_captures_stderr(local_env: LocalVirtualEnvironment):
    connection = local_env.establish_connection()

    result = local_env.run_command(connection, ["/bin/sh", "-c", "echo OUT; echo ERR >&2"]).result(timeout=10)

    assert b"OUT" in result.stdout
    assert b"ERR" in result.stderr
    assert result.exit_code == 0
