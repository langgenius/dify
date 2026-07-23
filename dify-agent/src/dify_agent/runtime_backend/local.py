"""Local working-environment backend over one shared shellctl daemon.

Materialized Homes and Workspaces live under separate roots. A Binding ref
encodes both logical path segments so this stateless adapter can reacquire the
same pair without maintaining a resource catalog.
"""

from __future__ import annotations

import logging
import posixpath
import re
import shlex
from dataclasses import dataclass

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientFactory
from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    HomeSnapshotCreateError,
)
from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    InitializeHomeSnapshotSpec,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.shellctl import (
    ShellctlRuntimeLease,
    create_shellctl_lease,
    run_shellctl_control_command,
)

_SAFE_REF_PART = re.compile(r"^[A-Za-z0-9._-]+$")
_BINDING_REF_SEPARATOR = ":"
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LocalHomeSnapshotBackend:
    endpoint: str
    auth_token: str
    snapshot_root: str = "/home/dify/.dify-agent-home-snapshots"
    client_factory: ShellctlClientFactory | None = None

    async def initialize(self, spec: InitializeHomeSnapshotSpec) -> str:
        snapshot_ref = _local_snapshot_ref(spec.home_snapshot_id)
        lease = self._control_lease(snapshot_ref)
        target = self._snapshot_dir(snapshot_ref)
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                f"set -eu\nmkdir -p {shlex.quote(target)}\nchmod 700 {shlex.quote(target)}",
            )
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
    materialized_home_root: str = "/home/dify/.dify-agent-materialized-homes"
    workspace_root: str = "/home/dify/.dify-agent-workspaces"
    snapshot_root: str = "/home/dify/.dify-agent-home-snapshots"
    client_factory: ShellctlClientFactory | None = None

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        binding_id = _validated_ref_part(spec.binding_id)
        workspace_id = _validated_ref_part(spec.workspace_id)
        snapshot_ref = _validated_ref_part(spec.home_snapshot_ref)
        workspace_ref = workspace_id
        if spec.existing_workspace_ref is not None:
            existing_workspace_ref = _validated_ref_part(spec.existing_workspace_ref)
            if existing_workspace_ref != workspace_ref:
                raise BindingCreateError("existing Workspace ref does not match workspace_id")
        binding_ref = _local_binding_ref(binding_id=binding_id, workspace_id=workspace_id)
        lease = self._control_lease(binding_ref)
        home_dir = self._home_dir(binding_id)
        workspace_dir = self._workspace_dir(workspace_id)
        snapshot_dir = f"{self.snapshot_root.rstrip('/')}/{snapshot_ref}"
        creates_workspace = spec.existing_workspace_ref is None
        workspace_setup = (
            f"mkdir -p {shlex.quote(workspace_dir)}" if creates_workspace else f"test -d {shlex.quote(workspace_dir)}"
        )
        script = "\n".join(
            [
                "set -eu",
                f"test -d {shlex.quote(snapshot_dir)}",
                workspace_setup,
                f"mkdir -p {shlex.quote(home_dir)}",
                f"cp -a {shlex.quote(snapshot_dir)}/. {shlex.quote(home_dir)}/",
                f"chmod 700 {shlex.quote(home_dir)} {shlex.quote(workspace_dir)}",
            ]
        )
        try:
            result = await run_shellctl_control_command(lease.commands, script)
            if result.exit_code != 0:
                raise BindingCreateError(result.output)
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

    async def acquire(self, binding_ref: str) -> RuntimeLease:
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
        return create_shellctl_lease(
            handle=handle,
            layout=RuntimeLayout(home_dir=control_root, workspace_dir=control_root),
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


__all__ = ["LocalExecutionBindingBackend", "LocalHomeSnapshotBackend"]
