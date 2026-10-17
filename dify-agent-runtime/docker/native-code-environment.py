# ruff: noqa: E402 -- disable bytecode writes before importing any other modules
"""Bounded image-content evidence, never permission to execute a native scope.

Run with system `python -I`. The later admission owner must independently bind
this receipt to reviewed source/OCI bytes and actual scope imports/mounts. This
probe measures selected concrete runtime files, not the complete OS dependency
closure, reproducibility, network isolation, or physical cleanup.
"""

import sys

# Isolated mode ignores PYTHONDONTWRITEBYTECODE; inspection must never write pyc.
sys.dont_write_bytecode = True

import hashlib
import importlib
import importlib.machinery
import importlib.metadata
import importlib.util
import json
import os
import platform
import re
import selectors
import signal
import stat
import subprocess
import sysconfig
import time
from pathlib import Path, PurePosixPath

SCHEMA = "dify.native-code-environment/v1"
PREFIX = "/usr/local"
SITE = "lib/python3.13/site-packages"
PACKAGES = {"Jinja2": "3.1.6", "MarkupSafe": "3.0.3"}
MAX_FILES = 256
MAX_ENTRIES = 512
PROBE_TIMEOUT_SECONDS = 15
MAX_FILE_BYTES = 160 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_DEPTH = 8
MAX_PATH_BYTES = 240
MAX_OUTPUT_BYTES = 128 * 1024
NODE_OUTPUT_BYTES = 128
NODE_TIMEOUT_SECONDS = 2.0


class Refusal(Exception):
    """Only fixed reason codes are emitted; no inspected data or exceptions."""


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("ascii")


def validate_profile(profile):
    if (
        profile.get("implementation") != "CPython"
        or not re.fullmatch(r"3\.13\.\d+", profile.get("python", ""))
        or profile.get("gil_disabled") is not False
    ):
        raise Refusal("unsupported_python")
    if profile.get("platform") != "linux" or profile.get("architecture") not in {
        "aarch64",
        "x86_64",
    }:
        raise Refusal("unsupported_platform")
    if profile.get("node") != "v24.20.0":
        raise Refusal("unsupported_node")
    if profile.get("packages") != PACKAGES:
        raise Refusal("unsupported_packages")


def require_origin(actual, expected):
    if actual != expected:
        raise Refusal("unexpected_package_origin")


def _stamp(info):
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_uid,
        info.st_gid,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def _trusted(info, directory=False):
    correct_type = (
        stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    )
    if not correct_type or info.st_uid != 0 or info.st_mode & 0o022:
        raise Refusal("mutable_or_unexpected_origin")


def _root_fd(stamps=None):
    """Capture the fixed absolute chain without following any path symlinks."""
    if stamps is None:
        stamps = {}
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        _trusted(info, directory=True)
        stamps["/"] = _stamp(info)
        path = ""
        for name in ("usr", "local"):
            parent = os.fstat(fd)
            if _stamp(parent) != stamps[path or "/"]:
                raise Refusal("path_chain_changed")
            child = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
            )
            try:
                info = os.fstat(child)
                _trusted(info, directory=True)
                if _stamp(parent) != _stamp(os.fstat(fd)) or _stamp(
                    os.stat(name, dir_fd=fd, follow_symlinks=False)
                ) != _stamp(info):
                    raise Refusal("path_chain_changed")
            except BaseException:
                os.close(child)
                raise
            os.close(fd)
            fd = child
            path += "/" + name
            stamps[path] = _stamp(info)
        return fd
    except BaseException:
        os.close(fd)
        raise


class ContentManifest:
    """Measure fixed selected trees through held directory FDs with finite bounds."""

    def __init__(self, root_fd):
        self.root_fd = root_fd
        self.entries = {}
        self.total_bytes = 0
        self.visited_entries = 0
        self.stamps = {}
        self.directories = set()
        self._remember_directory("", self.root_fd)

    def _remember_directory(self, path, fd):
        info = os.fstat(fd)
        _trusted(info, directory=True)
        stamp = _stamp(info)
        if path in self.stamps and self.stamps[path] != stamp:
            raise Refusal("path_chain_changed")
        if path not in self.directories:
            self._visit()
            self.directories.add(path)
        self.stamps[path] = stamp

    def revalidate(self):
        """Check every captured directory's identity and original path connection."""
        try:
            for path in sorted(self.directories):
                if not path:
                    self._remember_directory("", self.root_fd)
                    continue
                parent, name = self._parent(path)
                try:
                    fd = os.open(
                        name,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=parent,
                    )
                    try:
                        self._remember_directory(path, fd)
                        if (
                            _stamp(os.stat(name, dir_fd=parent, follow_symlinks=False))
                            != self.stamps[path]
                        ):
                            raise Refusal("path_chain_changed")
                        self._remember_directory(path.rpartition("/")[0], parent)
                    finally:
                        os.close(fd)
                finally:
                    os.close(parent)
        except OSError:
            raise Refusal("path_chain_changed") from None

    def _parts(self, path):
        parts = PurePosixPath(path).parts
        if (
            not parts
            or path.startswith("/")
            or any(p in {".", ".."} for p in path.split("/"))
            or str(PurePosixPath(path)) != path
            or len(parts) > MAX_DEPTH
            or len(path.encode("utf-8")) > MAX_PATH_BYTES
        ):
            raise Refusal("unexpected_path")
        return parts

    def _parent(self, path):
        parts = self._parts(path)
        fd = os.dup(self.root_fd)
        try:
            prefix = ""
            self._remember_directory(prefix, fd)
            for part in parts[:-1]:
                child = os.open(
                    part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
                )
                try:
                    info = os.fstat(child)
                    self._remember_directory(prefix, fd)
                    if _stamp(
                        os.stat(part, dir_fd=fd, follow_symlinks=False)
                    ) != _stamp(info):
                        raise Refusal("path_chain_changed")
                except BaseException:
                    os.close(child)
                    raise
                os.close(fd)
                fd = child
                prefix = prefix + "/" + part if prefix else part
                self._remember_directory(prefix, fd)
            return fd, parts[-1]
        except BaseException:
            os.close(fd)
            raise

    def _visit(self):
        self.visited_entries += 1
        if self.visited_entries > MAX_ENTRIES:
            raise Refusal("content_budget_exceeded")

    def add_file(self, path):
        self._visit()
        parent, name = self._parent(path)
        try:
            fd = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent
            )
            try:
                before = os.fstat(fd)
                _trusted(before)
                if (
                    path in self.entries
                    or len(self.entries) >= MAX_FILES
                    or before.st_size > MAX_FILE_BYTES
                    or self.total_bytes + before.st_size > MAX_TOTAL_BYTES
                ):
                    raise Refusal("content_budget_exceeded")
                digest = hashlib.sha256()
                size = 0
                while True:
                    chunk = os.read(fd, min(1024 * 1024, MAX_FILE_BYTES - size + 1))
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > before.st_size:
                        raise Refusal("content_changed")
                    digest.update(chunk)
                after = os.fstat(fd)
                if (
                    _stamp(before) != _stamp(after)
                    or size != before.st_size
                    or _stamp(os.stat(name, dir_fd=parent, follow_symlinks=False))
                    != _stamp(before)
                ):
                    raise Refusal("content_changed")
                self.entries[path] = {
                    "path": path,
                    "size": size,
                    "sha256": digest.hexdigest(),
                    "mode": stat.S_IMODE(before.st_mode),
                }
                self.stamps[path] = _stamp(before)
                self.total_bytes += size
            finally:
                os.close(fd)
        finally:
            os.close(parent)

    def add_tree(self, path):
        self._visit()
        self._parts(path)
        parent, name = self._parent(path)
        try:
            fd = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
            )
            try:
                before = os.fstat(fd)
                self._remember_directory(path, fd)
                # scandir/listdir would allocate arbitrary directory contents first.
                # Iteration stops before collecting more than the finite tree budget.
                names = []
                with os.scandir(fd) as entries:
                    for entry in entries:
                        names.append(entry.name)
                        if len(names) > MAX_FILES:
                            raise Refusal("content_budget_exceeded")
                for child in sorted(names):
                    relative = path + "/" + child
                    info = os.stat(child, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        self.add_tree(relative)
                    else:
                        self.add_file(relative)
                if _stamp(before) != _stamp(os.fstat(fd)) or _stamp(
                    os.stat(name, dir_fd=parent, follow_symlinks=False)
                ) != _stamp(before):
                    raise Refusal("content_changed")
                self.stamps[path] = _stamp(before)
            finally:
                os.close(fd)
        finally:
            os.close(parent)

    def files(self):
        return [self.entries[path] for path in sorted(self.entries)]


def node_version(binary):
    """Fixed argv, minimal environment, bounded combined output and wall time."""
    with subprocess.Popen(
        [binary, "--version"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd="/",
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        close_fds=True,
    ) as process:
        try:
            output = bytearray()
            deadline = time.monotonic() + NODE_TIMEOUT_SECONDS
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise Refusal("node_timeout")
                    chunk = os.read(
                        process.stdout.fileno(), NODE_OUTPUT_BYTES + 1 - len(output)
                    )
                    if not chunk:
                        break
                    output.extend(chunk)
                    if len(output) > NODE_OUTPUT_BYTES:
                        raise Refusal("node_output_exceeded")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise Refusal("node_timeout")
            if process.wait(timeout=remaining) != 0:
                raise Refusal("node_failed")
            version = bytes(output).decode("ascii").strip()
            if not re.fullmatch(r"v\d+\.\d+\.\d+", version):
                raise Refusal("unsupported_node")
            return version
        except subprocess.TimeoutExpired:
            raise Refusal("node_timeout") from None
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=1)


def make_receipt(profile, files):
    validate_profile(profile)
    result = {
        "schema": SCHEMA,
        "status": "observed",
        "profile": profile,
        "root": PREFIX,
        "files": sorted(files, key=lambda item: item["path"]),
    }
    result["environment_content_sha256"] = hashlib.sha256(canonical(result)).hexdigest()
    if len(canonical(result)) > MAX_OUTPUT_BYTES:
        raise Refusal("receipt_output_exceeded")
    return result


def collect_environment():
    profile = {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "architecture": platform.machine(),
        "platform": sys.platform,
        "gil_disabled": bool(sysconfig.get_config_var("Py_GIL_DISABLED")),
        "node": None,
        "packages": PACKAGES.copy(),
    }
    # Validate Python/platform before any package discovery/import or child process.
    validate_profile({**profile, "node": "v24.20.0"})
    if (
        not sys.flags.isolated
        or sys.prefix != PREFIX
        or sys.base_prefix != PREFIX
        or os.path.realpath(sys.executable) != PREFIX + "/bin/python3.13"
    ):
        raise Refusal("unexpected_python_origin")
    root_chain = {}
    fd = _root_fd(root_chain)
    try:

        def measure():
            manifest = ContentManifest(fd)
            for path in ("bin/python3.13", "bin/node", "lib/libpython3.13.so.1.0"):
                manifest.add_file(path)
            for path in (
                "jinja2",
                "markupsafe",
                "jinja2-3.1.6.dist-info",
                "markupsafe-3.0.3.dist-info",
            ):
                manifest.add_tree(SITE + "/" + path)
            return manifest

        before = measure()

        def revalidate():
            current_chain = {}
            try:
                current_fd = _root_fd(current_chain)
                try:
                    if (
                        current_chain != root_chain
                        or _stamp(os.fstat(fd)) != current_chain[PREFIX]
                    ):
                        raise Refusal("path_chain_changed")
                    before.revalidate()
                finally:
                    os.close(current_fd)
            except OSError:
                raise Refusal("path_chain_changed") from None

        def checked(operation, *args):
            # Absolute package and executable accesses must still connect to the
            # held measurement root before AND after the actual operation.
            revalidate()
            try:
                return operation(*args)
            finally:
                revalidate()

        def package_version(name, dirname):
            dist = importlib.metadata.PathDistribution(Path(PREFIX, SITE, dirname))
            if dist.metadata["Name"] != name:
                raise Refusal("unexpected_package_origin")
            return dist.version

        versions = {}
        for name, dirname in (
            ("Jinja2", "jinja2-3.1.6.dist-info"),
            ("MarkupSafe", "markupsafe-3.0.3.dist-info"),
        ):
            versions[name] = checked(package_version, name, dirname)
        profile["packages"] = versions
        profile["node"] = checked(node_version, PREFIX + "/bin/node")
        validate_profile(profile)
        for name in ("jinja2", "markupsafe"):
            expected = PREFIX + "/" + SITE + "/" + name + "/__init__.py"
            require_origin(checked(importlib.util.find_spec, name).origin, expected)
            module = checked(importlib.import_module, name)
            require_origin(module.__file__, expected)
        expected = (
            PREFIX
            + "/"
            + SITE
            + "/markupsafe/_speedups"
            + sysconfig.get_config_var("EXT_SUFFIX")
        )
        spec = checked(importlib.util.find_spec, "markupsafe._speedups")
        require_origin(spec.origin, expected)
        if not isinstance(spec.loader, importlib.machinery.ExtensionFileLoader):
            raise Refusal("unexpected_package_origin")
        speedups = checked(importlib.import_module, "markupsafe._speedups")
        require_origin(speedups.__file__, expected)
        after = measure()
        revalidate()
        if before.files() != after.files() or before.stamps != after.stamps:
            raise Refusal("content_changed")
        return make_receipt(profile, after.files())
    finally:
        os.close(fd)


def observe():
    try:
        return collect_environment()
    except Refusal as error:
        return {"schema": SCHEMA, "status": "unsupported", "reason": str(error)}
    except (
        OSError,
        ValueError,
        ImportError,
        AttributeError,
        TypeError,
        subprocess.SubprocessError,
    ):
        return {
            "schema": SCHEMA,
            "status": "unsupported",
            "reason": "missing_or_uninspectable_runtime",
        }


def _deadline(_signum, _frame):
    raise Refusal("probe_timeout")


if __name__ == "__main__":
    signal.signal(signal.SIGALRM, _deadline)
    signal.alarm(PROBE_TIMEOUT_SECONDS)
    receipt = (
        observe()
        if len(sys.argv) == 1
        else {
            "schema": SCHEMA,
            "status": "unsupported",
            "reason": "unsupported_arguments",
        }
    )
    signal.alarm(0)
    sys.stdout.buffer.write(canonical(receipt) + b"\n")
    raise SystemExit(0 if receipt["status"] == "observed" else 1)
