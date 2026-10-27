"""Local, idle-expiring OpenAPI export cache. Contract bytes never touch the filesystem.

The POSIX server owns a private Unix socket and an empty lifecycle lock. It caches
the document in RAM. A single-threaded snapshot preloads only dependency modules,
never controllers. Each refresh imports controllers in a fresh fork; edits to a
preloaded dependency re-exec the snapshot before exporting. Unsupported platforms
or unsafe snapshots use the ordinary fresh-process exporter.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib.machinery
import io
import json
import os
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Never

API_ROOT = Path(__file__).resolve().parents[1]
TIMEOUT = 90
IDLE_TIMEOUT = 120
MAX_BYTES = 64 * 1024 * 1024


def source_imports() -> None:
    """Read editable backend modules from source, preserving installed-library bytecode caches."""
    original = importlib.machinery.SourceFileLoader.get_code

    def get_code(self: importlib.machinery.SourceFileLoader, fullname: str):
        path = Path(self.path)
        if path.is_relative_to(API_ROOT) and ".venv" not in path.parts:
            return self.source_to_code(self.get_data(self.path), self.path)
        return original(self, fullname)

    importlib.machinery.SourceFileLoader.get_code = get_code
    sys.dont_write_bytecode = True


def source_state() -> dict[str, tuple[int, int, int]]:
    """Match the Console descriptor's inputs, excluding tests and local environments."""
    files = [API_ROOT / "pyproject.toml", API_ROOT / "uv.lock", Path.cwd() / ".env"]
    for directory, children, names in os.walk(API_ROOT):
        children[:] = [name for name in children if name not in {".venv", ".git", "__pycache__"}]
        if Path(directory) == API_ROOT:
            children[:] = [name for name in children if name != "tests"]
        files.extend(Path(directory) / name for name in names if name.endswith(".py"))
    return {str(file): file_stamp(file) for file in files}


def file_stamp(file: Path) -> tuple[int, int, int]:
    try:
        stat = file.stat()
        return stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size
    except FileNotFoundError:
        return 0, 0, 0


def fresh_export() -> bytes:
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-c",
            "import sys;sys.path.insert(0,sys.argv[1]);"
            "from dev.cached_console_openapi import source_imports;source_imports();"
            "from dev.export_console_openapi import main;main()",
            str(API_ROOT),
        ],
        capture_output=True,
        timeout=TIMEOUT,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-16000:])
    return result.stdout


def single_threaded() -> bool:
    """Check native threads too: threading.active_count misses C library pools."""
    try:
        if sys.platform.startswith("linux"):
            return len(os.listdir("/proc/self/task")) == 1
        if sys.platform == "darwin":
            # Darwin -M always prints its thread header, even with -o pid=.
            output = subprocess.check_output(["ps", "-M", "-p", str(os.getpid())], timeout=5)
            return len(output.strip().splitlines()) == 2
    except (OSError, subprocess.SubprocessError):
        return False
    return False


def preload() -> tuple[bool, dict[str, tuple[int, int, int]]]:
    """Load schema dependencies without retaining route registries or controller classes."""
    import urllib.request

    getproxies = urllib.request.getproxies
    try:
        if sys.platform == "darwin":
            # macOS SystemConfiguration starts native threads. Resolve its proxy
            # settings in a helper, preserving the values without forking those threads.
            proxies = json.loads(
                subprocess.check_output(
                    [sys.executable, "-c", "import json,urllib.request;print(json.dumps(urllib.request.getproxies()))"],
                    timeout=10,
                )
            )
            urllib.request.getproxies = lambda: proxies
        sys.path.insert(0, str(API_ROOT))
        from dev.generate_swagger_specs import apply_runtime_defaults

        apply_runtime_defaults()
        # Keep runtime composition (and libraries with native thread pools) out
        # of the snapshot. These pure model dependencies account for much of startup.
        import dify_agent.protocol.schemas

        import core.mcp.types
        import graphon.nodes.parameter_extractor.entities
        import models
        import services.knowledge_fs.product_dto

        _ = core.mcp.types, dify_agent.protocol.schemas, graphon.nodes.parameter_extractor.entities
        _ = models, services.knowledge_fs.product_dto
        safe = not any(name.startswith("controllers.") for name in sys.modules) and single_threaded()
    except Exception:
        # A cache optimization must not prevent a normal export from working.
        safe = False
    finally:
        urllib.request.getproxies = getproxies
    dependencies = {}
    for module in tuple(sys.modules.values()):
        filename = getattr(module, "__file__", None)  # guard-ignore: no-new-getattr -- optional module source metadata
        if isinstance(filename, str):
            dependencies[str(Path(filename).resolve())] = file_stamp(Path(filename))
    for filename in (API_ROOT / "pyproject.toml", API_ROOT / "uv.lock", Path.cwd() / ".env"):
        dependencies[str(filename)] = file_stamp(filename)
    return safe, dependencies


def export_worker(write_fd: int) -> Never:
    """Run the isolated exporter and keep its pipe open through process exit."""
    try:
        from dev.export_console_openapi import main

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            main()
        payload = b"OK\n" + output.getvalue().encode()
    except BaseException:
        payload = b"ERROR\n" + traceback.format_exc().encode()
    try:
        with os.fdopen(write_fd, "wb") as pipe:
            pipe.write(payload)
            pipe.flush()
            # Keep the pipe open through process exit. Closing it first lets
            # the parent kill a successful worker while exit instrumentation
            # (for example, subprocess coverage) is still flushing its data.
            os._exit(0)
    finally:
        os._exit(1)


def fork_export() -> bytes:
    """Export from a clean controller registry; the parent snapshot is never mutated."""
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        export_worker(write_fd)
    os.close(write_fd)
    chunks: list[bytes] = []
    size = 0
    deadline = time.monotonic() + TIMEOUT
    try:
        while True:
            if not select.select([read_fd], [], [], max(0, deadline - time.monotonic()))[0]:
                raise TimeoutError("OpenAPI refresh timed out")
            chunk = os.read(read_fd, 65536)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("OpenAPI export exceeds the response limit")
            chunks.append(chunk)
        result = b"".join(chunks)
        status, _, payload = result.partition(b"\n")
        if status != b"OK":
            raise RuntimeError(payload.decode(errors="replace") or "OpenAPI worker exited without a response")
        return payload
    finally:
        os.close(read_fd)
        # A worker can fail after closing its pipe. Never leave it running or unreaped.
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)


def socket_path() -> Path:
    directory = Path(tempfile.gettempdir()) / f"dify-openapi-{os.getuid()}"
    # macOS Unix socket paths have a small length limit.
    if len(str(directory)) > 55:
        directory = Path("/tmp") / f"dify-openapi-{os.getuid()}"
    directory.mkdir(mode=0o700, exist_ok=True)
    stat = directory.lstat()
    if directory.is_symlink() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise PermissionError("OpenAPI IPC directory must be private to the current user")
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"_", "PWD", "OLDPWD", "SHLVL", "UV_RUN_RECURSION_DEPTH"}
    }
    key = hashlib.sha256(json.dumps([str(API_ROOT), os.getcwd(), sys.executable, environment], sort_keys=True).encode())
    key.update(Path(__file__).read_bytes())
    return directory / f"{key.hexdigest()[:24]}.sock"


def serve(path: Path, inherited: list[str]) -> None:
    import fcntl

    if inherited:
        listener = socket.socket(fileno=int(inherited[0]))
        lock_fd = int(inherited[1])
    else:
        lock_fd = os.open(path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(lock_fd)
            return
        path.unlink(missing_ok=True)
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(str(path))
        listener.listen(16)
    listener.settimeout(IDLE_TIMEOUT)
    baseline = source_state()
    safe, dependencies = preload()
    snapshot_dirty = source_state() != baseline
    cached_state: dict[str, tuple[int, int, int]] | None = None
    cached = b""
    try:
        while True:
            try:
                connection, _ = listener.accept()
            except TimeoutError:
                return
            with connection:
                connection.settimeout(TIMEOUT)
                try:
                    request = b""
                    while not request.endswith(b"\n") and len(request) < 16:
                        part = connection.recv(16 - len(request))
                        if not part:
                            break
                        request += part
                    if request == b"stop\n":
                        connection.sendall(b"OK\n")
                        return
                    if request != b"export\n":
                        continue
                    current = source_state()
                    stale = (
                        snapshot_dirty
                        or set(current) != set(baseline)
                        or any(file_stamp(Path(file)) != stamp for file, stamp in dependencies.items())
                    )
                    if stale:
                        # No reload(sys.modules): restart all preloaded dependencies.
                        connection.sendall(b"RETRY\n")
                        connection.close()
                        os.set_inheritable(listener.fileno(), True)
                        os.set_inheritable(lock_fd, True)
                        os.execv(
                            sys.executable,
                            [sys.executable, __file__, "--serve", str(path), str(listener.fileno()), str(lock_fd)],
                        )
                    if current != cached_state:
                        output = fork_export() if safe and single_threaded() else fresh_export()
                        # Do not publish a contract assembled while source files changed.
                        if source_state() != current:
                            connection.sendall(b"RETRY\n")
                            continue
                        payload: Any = json.loads(output)
                        if not isinstance(payload, dict) or set(payload) != {"console", "fast"}:
                            raise ValueError("Invalid Console export response")
                        cached, cached_state = output, current
                    connection.sendall(b"OK\n" + cached)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception:
                    with contextlib.suppress(OSError):
                        connection.sendall(b"ERROR\n" + traceback.format_exc().encode()[-16000:])
    finally:
        listener.close()
        path.unlink(missing_ok=True)
        os.close(lock_fd)


def request_export(*, stop: bool = False) -> bytes:
    if not hasattr(os, "fork"):
        return b"" if stop else fresh_export()
    path = socket_path()
    deadline = time.monotonic() + TIMEOUT
    launched = False
    while time.monotonic() < deadline:
        try:
            with socket.socket(socket.AF_UNIX) as connection:
                connection.settimeout(max(0.1, deadline - time.monotonic()))
                connection.connect(str(path))
                connection.sendall(b"stop\n" if stop else b"export\n")
                chunks: list[bytes] = []
                size = 0
                while chunk := connection.recv(65536):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("OpenAPI response exceeds the limit")
                    chunks.append(chunk)
            status, _, payload = b"".join(chunks).partition(b"\n")
            if status == b"OK":
                return payload
            if status == b"ERROR":
                raise RuntimeError(payload.decode(errors="replace"))
            if status != b"RETRY":
                raise RuntimeError("Incomplete OpenAPI cache response")
        except (FileNotFoundError, ConnectionRefusedError):
            if stop:
                return b""
            if not launched:
                subprocess.Popen(
                    [sys.executable, __file__, "--serve", str(path)],
                    start_new_session=True,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                launched = True
        time.sleep(0.03)
    raise TimeoutError("OpenAPI cache did not respond in time")


if __name__ == "__main__":
    # Timestamp-based .pyc files can serve stale code after same-size edits within one second.
    source_imports()
    if sys.argv[1:2] == ["--serve"]:
        serve(Path(sys.argv[2]), sys.argv[3:])
    elif sys.argv[1:] == ["--stop"]:
        request_export(stop=True)
    else:
        sys.stdout.buffer.write(request_export())
