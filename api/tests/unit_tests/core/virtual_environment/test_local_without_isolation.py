import os
from io import BytesIO
from pathlib import Path

import pytest

from core.virtual_environment.providers import local_without_isolation
from core.virtual_environment.providers.local_without_isolation import LocalVirtualEnvironment


def _read_all(fd: int) -> bytes:
    chunks: list[bytes] = []
    while True:
        data = os.read(fd, 4096)
        if not data:
            break
        chunks.append(data)
    return b"".join(chunks)


def _close_fds(*fds: int) -> None:
    for fd in fds:
        try:
            os.close(fd)
        except OSError:
            pass


@pytest.fixture
def local_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> LocalVirtualEnvironment:
    monkeypatch.setattr(local_without_isolation, "machine", lambda: "x86_64")
    return LocalVirtualEnvironment({"base_working_path": str(tmp_path)})


def test_construct_environment_creates_working_path(local_env: LocalVirtualEnvironment):
    working_path = local_env.get_working_path()
    assert local_env.metadata.id
    assert os.path.isdir(working_path)


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

    assert os.path.join("dir", "file_a.txt") in all_paths
    assert "file_b.txt" in all_paths

    limited_files = local_env.list_files("", limit=1)
    assert len(limited_files) == 1


def test_execute_command_uses_working_directory(local_env: LocalVirtualEnvironment):
    local_env.upload_file("message.txt", BytesIO(b"hello"))
    connection = local_env.establish_connection()
    command = ["/bin/sh", "-c", "cat message.txt"]

    pid, stdin_fd, stdout_fd, stderr_fd = local_env.execute_command(connection, command)

    try:
        os.close(stdin_fd)
        if hasattr(os, "waitpid"):
            os.waitpid(pid, 0)
        stdout = _read_all(stdout_fd)
        stderr = _read_all(stderr_fd)
    finally:
        _close_fds(stdin_fd, stdout_fd, stderr_fd)

    assert stdout == b"hello"
    assert stderr == b""


def test_execute_command_pipes_stdio(local_env: LocalVirtualEnvironment):
    connection = local_env.establish_connection()
    command = ["/bin/sh", "-c", "tr a-z A-Z < /dev/stdin; printf ERR >&2"]

    pid, stdin_fd, stdout_fd, stderr_fd = local_env.execute_command(connection, command)

    try:
        os.write(stdin_fd, b"abc")
        os.close(stdin_fd)
        if hasattr(os, "waitpid"):
            os.waitpid(pid, 0)
        stdout = _read_all(stdout_fd)
        stderr = _read_all(stderr_fd)
    finally:
        _close_fds(stdin_fd, stdout_fd, stderr_fd)

    assert stdout == b"ABC"
    assert stderr == b"ERR"
