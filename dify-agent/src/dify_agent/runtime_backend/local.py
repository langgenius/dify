"""Local working-environment backend over one shared shellctl daemon.

Materialized Homes and Workspaces live under separate roots. A Binding ref
encodes both logical path segments so this stateless adapter can reacquire the
same pair without maintaining a resource catalog.
"""

from __future__ import annotations

import asyncio
import json
import logging
import posixpath
import re
import shlex
from dataclasses import dataclass, field
from typing import cast

import httpx2 as httpx

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientFactory, ShellctlClientProtocol, ShellctlJobStatus
from dify_agent.protocol.execution_binding import InspectExecutionBindingRequest, InspectExecutionBindingResponse
from dify_agent.protocol.native_testing import NativeDTO
from typing import Literal

from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    HomeSnapshotCreateError,
)
from dify_agent.runtime_backend.native_test_scope import NativeScopeCommands, NativeScopeLease, native_binding_identity
from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.shellctl import (
    ShellctlRuntimeLease,
    create_shellctl_lease,
    run_shellctl_control_command,
    run_shellctl_inspection_command,
)
from shellctl.client.sdk import ShellctlClient, ShellctlClientError
from shellctl.shared.schemas import NativeScopeHandle, NativeScopeSpec

_SAFE_REF_PART = re.compile(r"^[A-Za-z0-9._-]+$")
_BINDING_REF_SEPARATOR = ":"
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LocalHomeSnapshotBackend:
    endpoint: str
    auth_token: str
    snapshot_root: str = "/home/dify/.snapshots"
    client_factory: ShellctlClientFactory | None = None

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        snapshot_ref = _local_snapshot_ref(spec.home_snapshot_id)
        target = self._snapshot_dir(snapshot_ref)
        lease = self._control_lease(snapshot_ref, paths=(source.layout.home_dir, target))
        script = "\n".join(
            [
                "set -eu",
                f"test -d {shlex.quote(source.layout.home_dir)}",
                f"mkdir -p {shlex.quote(target)}",
                f"cp -a {shlex.quote(source.layout.home_dir)}/. {shlex.quote(target)}/",
                f"chmod 700 {shlex.quote(target)}",
            ]
        )
        try:
            result = await run_shellctl_control_command(lease.commands, script)
            if result.exit_code != 0:
                raise HomeSnapshotCreateError(result.output)
            return snapshot_ref
        except BaseException as exc:
            await _remove_partial(lease.commands, target=target, resource_ref=snapshot_ref)
            if isinstance(exc, HomeSnapshotCreateError):
                raise
            if isinstance(exc, Exception):
                raise HomeSnapshotCreateError(str(exc)) from exc
            raise
        finally:
            await _close_best_effort(lease, resource_ref=snapshot_ref)

    async def delete(self, snapshot_ref: str) -> None:
        normalized = _validated_ref_part(snapshot_ref)
        lease = self._control_lease(normalized)
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                f"rm -rf -- {shlex.quote(self._snapshot_dir(normalized))}",
            )
            if result.exit_code != 0:
                raise BindingDestroyError(result.output)
        except BaseException:
            await _close_best_effort(lease, resource_ref=normalized)
            raise
        else:
            await lease.close()

    def _snapshot_dir(self, snapshot_ref: str) -> str:
        return f"{self.snapshot_root.rstrip('/')}/{snapshot_ref}"

    def _control_lease(self, handle: str, *, paths: tuple[str, ...] = ()) -> ShellctlRuntimeLease:
        control_root = _control_root(paths or (self.snapshot_root,))
        layout = RuntimeLayout(home_dir=control_root, workspace_dir=control_root)
        return create_shellctl_lease(
            handle=handle,
            layout=layout,
            entrypoint=self.endpoint,
            token=self.auth_token,
            client_factory=self.client_factory,
        )


@dataclass(slots=True)
class LocalExecutionBindingBackend:
    endpoint: str
    auth_token: str
    materialized_home_root: str = "/home/dify"
    workspace_root: str = "/workspace"
    snapshot_root: str = "/home/dify/.snapshots"
    client_factory: ShellctlClientFactory | None = None
    native_scope_client: LocalNativeScopeClient | None = None

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        if spec.native_test_scope is not None:
            scope = spec.native_test_scope
            if (
                self.native_scope_client is None
                or spec.existing_workspace_ref is not None
                or scope.binding_ref != spec.binding_id
                or scope.scope_id != spec.binding_id
                or scope.base_snapshot_ref != spec.home_snapshot_ref
            ):
                raise BindingCreateError("native_scope_unavailable")
            try:
                if spec.native_scope_reconcile:
                    await self.native_scope_client.inspect(scope.scope_id, scope.generation)
                else:
                    await self.native_scope_client.create(scope)
            except ShellctlClientError as exc:
                raise BindingCreateError("native_scope_unavailable") from exc
            ref = f"native:{scope.scope_id}:{scope.generation}"
            return ExecutionBindingAllocation(binding_ref=ref, workspace_ref=ref)
        binding_id = _validated_ref_part(spec.binding_id)
        workspace_id = _validated_ref_part(spec.workspace_id)
        workspace_ref = workspace_id
        if spec.existing_workspace_ref is not None:
            existing_workspace_ref = _validated_ref_part(spec.existing_workspace_ref)
            if existing_workspace_ref != workspace_ref:
                raise BindingCreateError("existing Workspace ref does not match workspace_id")
        snapshot_dir: str | None = None
        if spec.home_snapshot_ref is not None:
            snapshot_ref = _validated_ref_part(spec.home_snapshot_ref)
            snapshot_dir = f"{self.snapshot_root.rstrip('/')}/{snapshot_ref}"
        binding_ref = _local_binding_ref(binding_id=binding_id, workspace_id=workspace_id)
        home_dir = self._home_dir(binding_id)
        workspace_dir = self._workspace_dir(workspace_id)
        creates_workspace = spec.existing_workspace_ref is None
        workspace_setup = (
            f"mkdir -p {shlex.quote(workspace_dir)}" if creates_workspace else f"test -d {shlex.quote(workspace_dir)}"
        )
        setup = ["set -eu"]
        if snapshot_dir is not None:
            setup.append(f"test -d {shlex.quote(snapshot_dir)}")
        setup.extend([workspace_setup, f"mkdir -p {shlex.quote(home_dir)}"])
        if snapshot_dir is not None:
            setup.append(f"cp -a {shlex.quote(snapshot_dir)}/. {shlex.quote(home_dir)}/")
        setup.append(f"chmod 700 {shlex.quote(home_dir)} {shlex.quote(workspace_dir)}")
        script = "\n".join(setup)
        lease = self._control_lease(binding_ref)
        try:
            result = await run_shellctl_control_command(lease.commands, script)
            if result.exit_code != 0:
                raise BindingCreateError(
                    result.output
                    or (
                        "Local binding setup failed "
                        f"(job_id={result.job_id}, status={result.status}, exit_code={result.exit_code}). "
                        "Inspect runtime logs, including stderr, for the cause."
                    )
                )
            return ExecutionBindingAllocation(binding_ref=binding_ref, workspace_ref=workspace_ref)
        except BaseException as exc:
            targets = [home_dir]
            if creates_workspace:
                targets.append(workspace_dir)
            await _remove_partial(
                lease.commands,
                target=" ".join(shlex.quote(target) for target in targets),
                resource_ref=binding_ref,
                target_is_shell_words=True,
            )
            if isinstance(exc, BindingCreateError):
                raise
            if isinstance(exc, Exception):
                raise BindingCreateError(str(exc)) from exc
            raise
        finally:
            await _close_best_effort(lease, resource_ref=binding_ref)

    async def inspect_binding(self, request: InspectExecutionBindingRequest) -> InspectExecutionBindingResponse:
        """Probe exact ordinary paths read-only; ambiguity never proves absence.

        Preconditions: trusted configured roots and caller-selected physical refs.
        Postconditions: no binding lifecycle operation; only bounded coherent
        filesystem evidence is returned. One five-second absolute budget starts
        before lease construction, reserves one second for bounded sanitized
        cleanup, and makes any probe/cleanup timeout or failure uncertain.
        """
        deadline = asyncio.get_running_loop().time() + 5.0
        selection = request.model_dump()
        try:
            binding_id, workspace_id = _parse_local_binding_ref(request.binding_ref)
            if workspace_id != request.workspace_ref:
                raise ValueError("workspace identity mismatch")
        except ValueError:
            return InspectExecutionBindingResponse(
                **selection, adapter="local", state="uncertain", evidence_code="identity_mismatch"
            )
        expected = dict(
            **selection,
            home_root=self.materialized_home_root,
            workspace_root=self.workspace_root,
            home_path=self._home_dir(binding_id),
            workspace_path=self._workspace_dir(workspace_id),
        )
        try:
            lease = self._control_lease(request.binding_ref)
        except Exception:
            return InspectExecutionBindingResponse(
                **selection, adapter="local", state="uncertain", evidence_code="probe_unavailable"
            )
        try:
            script = "python3 -c " + shlex.quote(_LOCAL_INSPECTION_PROBE) + " " + shlex.quote(json.dumps(expected))
            result = await run_shellctl_inspection_command(lease, script, deadline=deadline, cleanup_budget=1.0)
            if result.exit_code != 0 or len(result.output.encode("utf-8")) > 8192:
                raise ValueError("invalid probe")
            evidence = _LocalInspectionEvidence.model_validate_json(result.output)
            if evidence.model_dump(exclude={"evidence_code"}) != expected:
                raise ValueError("probe identity mismatch")
            code = evidence.evidence_code
            state = (
                "usable" if code == "paths_present" else ("definitively_gone" if code == "path_absent" else "uncertain")
            )
            return InspectExecutionBindingResponse(**selection, adapter="local", state=state, evidence_code=code)
        except ValueError:
            return InspectExecutionBindingResponse(
                **selection, adapter="local", state="uncertain", evidence_code="invalid_probe"
            )
        except Exception:
            return InspectExecutionBindingResponse(
                **selection, adapter="local", state="uncertain", evidence_code="probe_unavailable"
            )

    async def read_job_status(self, binding_ref: str, job_id: str) -> ShellctlJobStatus:
        """Read only; do not acquire, validate paths, refresh, or release a Binding."""
        if binding_ref.startswith("native:"):
            raise BindingAcquireError("binding_job_status_unsupported")
        lease = self._lease(binding_ref)
        try:
            return await lease.client.status(job_id)
        finally:
            await lease.close()

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        identity = native_binding_identity(binding_ref)
        if identity is not None:
            if self.native_scope_client is None:
                raise BindingAcquireError("native_scope_unavailable")
            scope_id, generation = identity
            try:
                handle = await self.native_scope_client.inspect(scope_id, generation)
            except ShellctlClientError as exc:
                raise BindingLostError("native_scope_unavailable") from exc
            client = cast(ShellctlClientProtocol, self.native_scope_client.job_client(handle))
            return NativeScopeLease(
                handle=binding_ref,
                layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace"),
                client=client,
                commands=NativeScopeCommands(client=client),
                workspace_generation=generation,
            )
        lease = self._lease(binding_ref)
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                "\n".join(
                    [
                        "set -eu",
                        f"test -d {shlex.quote(lease.layout.home_dir)}",
                        f"test -d {shlex.quote(lease.layout.workspace_dir)}",
                    ]
                ),
                timeout=10.0,
            )
            if result.exit_code != 0:
                raise BindingLostError(f"Local Binding {binding_ref!r} no longer exists")
            return lease
        except BaseException as exc:
            await _close_best_effort(lease, resource_ref=binding_ref)
            if isinstance(exc, BindingLostError):
                raise
            if isinstance(exc, Exception):
                raise BindingAcquireError(str(exc)) from exc
            raise

    async def release(self, lease: RuntimeLease) -> None:
        if not isinstance(lease, ShellctlRuntimeLease):
            raise TypeError("LocalExecutionBindingBackend can only release its own RuntimeLease")
        try:
            await lease.close()
        except Exception as exc:
            raise BindingAcquireError(str(exc)) from exc

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        identity = native_binding_identity(spec.binding_ref)
        if identity is not None:
            if self.native_scope_client is None or not spec.destroy_workspace or spec.workspace_ref != spec.binding_ref:
                raise BindingDestroyError("native_scope_cleanup_unavailable")
            try:
                await self.native_scope_client.destroy(*identity)
            except ShellctlClientError as exc:
                raise BindingDestroyError("native_scope_cleanup_unavailable") from exc
            return
        binding_id, workspace_id = _parse_local_binding_ref(spec.binding_ref)
        if spec.destroy_workspace:
            workspace_ref = _validated_ref_part(spec.workspace_ref or "")
            if workspace_ref != workspace_id:
                raise BindingDestroyError("Workspace ref does not match Binding ref")
        lease = self._control_lease(spec.binding_ref)
        targets = [self._home_dir(binding_id)]
        if spec.destroy_workspace:
            targets.append(self._workspace_dir(workspace_id))
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                "rm -rf -- " + " ".join(shlex.quote(target) for target in targets),
            )
            if result.exit_code != 0:
                raise BindingDestroyError(result.output)
        except BaseException:
            await _close_best_effort(lease, resource_ref=spec.binding_ref)
            raise
        else:
            await lease.close()

    def _lease(self, binding_ref: str) -> ShellctlRuntimeLease:
        binding_id, workspace_id = _parse_local_binding_ref(binding_ref)
        return create_shellctl_lease(
            handle=binding_ref,
            layout=RuntimeLayout(
                home_dir=self._home_dir(binding_id),
                workspace_dir=self._workspace_dir(workspace_id),
            ),
            entrypoint=self.endpoint,
            token=self.auth_token,
            client_factory=self.client_factory,
        )

    def _control_lease(self, handle: str) -> ShellctlRuntimeLease:
        control_root = _control_root((self.materialized_home_root, self.workspace_root, self.snapshot_root))
        layout = RuntimeLayout(home_dir=control_root, workspace_dir=control_root)
        if control_root == "/":
            # Keep the canonical root-level Workspace separate instead of
            # broadening the control job's writable layout to the whole filesystem.
            layout = RuntimeLayout(
                home_dir=posixpath.commonpath((self.materialized_home_root, self.snapshot_root)),
                workspace_dir=self.workspace_root,
            )
        return create_shellctl_lease(
            handle=handle,
            layout=layout,
            entrypoint=self.endpoint,
            token=self.auth_token,
            client_factory=self.client_factory,
        )

    def _home_dir(self, binding_id: str) -> str:
        return f"{self.materialized_home_root.rstrip('/')}/{binding_id}"

    def _workspace_dir(self, workspace_id: str) -> str:
        return f"{self.workspace_root.rstrip('/')}/{workspace_id}"


def _local_snapshot_ref(home_snapshot_id: str) -> str:
    return f"home-{_validated_ref_part(home_snapshot_id)}"


def _local_binding_ref(*, binding_id: str, workspace_id: str) -> str:
    return f"{_validated_ref_part(binding_id)}{_BINDING_REF_SEPARATOR}{_validated_ref_part(workspace_id)}"


def _parse_local_binding_ref(binding_ref: str) -> tuple[str, str]:
    parts = binding_ref.split(_BINDING_REF_SEPARATOR)
    if len(parts) != 2:
        raise ValueError("Local Binding ref is invalid")
    return _validated_ref_part(parts[0]), _validated_ref_part(parts[1])


def _validated_ref_part(value: str) -> str:
    if value in {"", ".", ".."} or _SAFE_REF_PART.fullmatch(value) is None:
        raise ValueError("runtime backend ref must be a safe path segment")
    return value


def _control_root(paths: tuple[str, ...]) -> str:
    normalized = tuple(posixpath.normpath(path) for path in paths)
    common = posixpath.commonpath(normalized)
    if len(normalized) == 1 or common in normalized:
        common = posixpath.dirname(common)
    return common or "/"


async def _remove_partial(
    commands: ShellCommandProtocol,
    *,
    target: str,
    resource_ref: str,
    target_is_shell_words: bool = False,
) -> None:
    try:
        target_words = target if target_is_shell_words else shlex.quote(target)
        result = await run_shellctl_control_command(commands, f"rm -rf -- {target_words}")
        if result.exit_code != 0:
            logger.warning("failed to remove partial local resource", extra={"resource_ref": resource_ref})
    except BaseException:
        logger.warning("failed to remove partial local resource", exc_info=True, extra={"resource_ref": resource_ref})


async def _close_best_effort(lease: ShellctlRuntimeLease, *, resource_ref: str) -> None:
    try:
        await lease.close()
    except BaseException:
        logger.warning("failed to close local RuntimeLease", exc_info=True, extra={"resource_ref": resource_ref})


__all__ = ["LocalExecutionBindingBackend", "LocalHomeSnapshotBackend", "LocalNativeScopeClient"]


@dataclass(slots=True)
class LocalNativeScopeClient:
    """Private native scope transport. Lost scopes are never recreated by inspect."""

    endpoint: str
    auth_token: str = field(repr=False)

    async def _request(
        self, method: str, path: str, *, generation: int | None = None, spec: NativeScopeSpec | None = None
    ) -> dict[str, object]:
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        if generation is not None:
            headers["X-Scope-Generation"] = str(generation)
        async with httpx.AsyncClient(base_url=self.endpoint, follow_redirects=False, timeout=15.0) as client:
            response = await client.request(
                method, path, headers=headers, json=spec.model_dump(mode="json") if spec else None
            )
        if response.status_code not in (200, 201):
            raise ShellctlClientError(response.status_code, "native_scope_unavailable", "Native scope request failed")
        result: object = response.json()
        if not isinstance(result, dict):
            raise ShellctlClientError(502, "native_scope_invalid_response", "Invalid native scope response")
        return result

    async def create(self, spec: NativeScopeSpec) -> NativeScopeHandle:
        handle = NativeScopeHandle.model_validate(await self._request("POST", "/v1/test-scopes", spec=spec))
        if handle.scope_id != spec.scope_id or handle.generation != spec.generation:
            raise ShellctlClientError(502, "native_scope_identity_mismatch", "Scope identity mismatch")
        return handle

    async def inspect(self, scope_id: str, generation: int) -> NativeScopeHandle:
        scope_id = _validated_ref_part(scope_id)
        handle = NativeScopeHandle.model_validate(
            await self._request("GET", f"/v1/test-scopes/{scope_id}", generation=generation)
        )
        if handle.scope_id != scope_id or handle.generation != generation:
            raise ShellctlClientError(502, "native_scope_identity_mismatch", "Scope identity mismatch")
        return handle

    async def destroy(self, scope_id: str, generation: int) -> None:
        scope_id = _validated_ref_part(scope_id)
        result = await self._request("DELETE", f"/v1/test-scopes/{scope_id}", generation=generation)
        if result.get("status") != "destroyed":
            raise ShellctlClientError(502, "native_scope_cleanup_unconfirmed", "Scope cleanup is unconfirmed")

    def job_client(self, handle: NativeScopeHandle) -> ShellctlClient:
        return ShellctlClient(base_url=self.endpoint, token=self.auth_token, native_scope=handle)


class _LocalInspectionEvidence(NativeDTO):
    binding_ref: str
    workspace_ref: str
    home_root: str
    workspace_root: str
    home_path: str
    workspace_path: str
    evidence_code: Literal["paths_present", "path_absent", "root_unavailable", "path_ambiguous"]


# Fixed read-only program. No request can supply code or alter the selected paths.
# Ancestors need only be traversable; the configured roots must be readable.
# Only exact lstat ENOENT/ENOTDIR below validated roots counts as absence.
_LOCAL_INSPECTION_PROBE = r"""
import errno
import json
import os
import stat
import sys

value = json.loads(sys.argv[1])

def open_root(path):
    if not path.startswith("/") or os.path.normpath(path) != path or path == "/":
        raise ValueError("ambiguous configured root")
    directory_flags = os.O_DIRECTORY | os.O_NOFOLLOW
    read_flags = directory_flags | os.O_RDONLY
    search_flags = directory_flags | getattr(os, "O_PATH", os.O_RDONLY)
    parts = path.split("/")[1:]
    fd = os.open("/", search_flags)
    try:
        for index, part in enumerate(parts, start=1):
            is_root = index == len(parts)
            next_fd = os.open(part, read_flags if is_root else search_flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            info = os.fstat(fd)
            if not info.st_mode & 0o111 or (is_root and not info.st_mode & 0o444):
                raise PermissionError("inaccessible root")
        with os.scandir(fd) as entries:
            next(entries, None)
        return fd
    except (OSError, ValueError):
        os.close(fd)
        raise

def probe():
    roots = []
    try:
        try:
            for key in ("home_root", "workspace_root"):
                roots.append(open_root(value[key]))
        except (OSError, ValueError):
            return "root_unavailable"
        states = []
        for key, root_key, fd in zip(("home_path", "workspace_path"), ("home_root", "workspace_root"), roots):
            if os.path.dirname(value[key]) != value[root_key]:
                return "path_ambiguous"
            try:
                info = os.stat(os.path.basename(value[key]), dir_fd=fd, follow_symlinks=False)
                usable = (stat.S_ISDIR(info.st_mode) and info.st_mode & 0o444 and info.st_mode & 0o111
                          and os.access(os.path.basename(value[key]), os.R_OK | os.X_OK, dir_fd=fd, follow_symlinks=False))
                states.append("present" if usable else "uncertain")
            except OSError as error:
                states.append("missing" if error.errno in (errno.ENOENT, errno.ENOTDIR) else "uncertain")
        try:
            for key, fd in zip(("home_root", "workspace_root"), roots):
                current = open_root(value[key])
                try:
                    old, new = os.fstat(fd), os.fstat(current)
                    if (old.st_dev, old.st_ino) != (new.st_dev, new.st_ino):
                        return "root_unavailable"
                finally:
                    os.close(current)
        except (OSError, ValueError):
            return "root_unavailable"
        if "uncertain" in states:
            return "path_ambiguous"
        return "path_absent" if "missing" in states else "paths_present"
    finally:
        for fd in roots:
            os.close(fd)

print(json.dumps(dict(value, evidence_code=probe()), sort_keys=True))
"""
