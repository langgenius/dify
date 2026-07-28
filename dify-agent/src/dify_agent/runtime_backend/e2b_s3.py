"""E2B Workspace backend with independently persisted S3 Home Snapshots."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from dataclasses import dataclass
import logging
import shlex
from typing import Protocol

import opendal

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.agent_stub.protocol import (
    AGENT_STUB_API_BASE_URL_ENV_VAR,
    AGENT_STUB_AUTH_JWE_ENV_VAR,
)
from dify_agent.agent_stub.server.tokens.home_snapshot import (
    HOME_SNAPSHOT_SCOPE_READ,
    HOME_SNAPSHOT_SCOPE_WRITE,
    HomeSnapshotTransferScope,
    HomeSnapshotTransferTokenCodec,
)
from dify_agent.runtime_backend.e2b import (
    E2BControlPlane,
    E2BControlPlaneNotFoundError,
    E2BSandbox,
    E2BSandboxFileSystem,
    create_e2b_shellctl_lease,
)
from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    HomeArchiveConflictError,
    HomeArchiveStoreError,
    HomeSnapshotCreateError,
    HomeSnapshotNotFoundError,
)
from dify_agent.runtime_backend.home_snapshot_refs import (
    build_home_snapshot_ref,
    validate_home_snapshot_ref,
    validate_ref_segment,
)
from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    FileSystem,
    HomeSnapshotCreateSpec,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.shellctl import (
    CONTROL_COMMAND_OUTPUT_LIMIT,
    ShellctlRuntimeLease,
    execute_complete_with_commands,
)

_HOME_ROOT = "/home/dify/.dify-agent-materialized-homes"
_RUNTIME_ROOT = "/home/dify/.dify-agent-runtime"
_WORKSPACE_DIR = "/home/dify/workspace"
_WORKSPACE_ID_FILE = f"{_RUNTIME_ROOT}/workspace-id"
_BOOTSTRAP_HOME = "/home/dify"
_BINDING_REF_SEPARATOR = ":"
_BASELINE_EXCLUDES = (
    "workspace",
    ".dify-agent-materialized-homes",
    ".dify-agent-runtime",
    ".local/share/shellctl",
)
logger = logging.getLogger(__name__)


class OpenDALAsyncFile(Protocol):
    def read(self, size: int | None = None, /) -> Awaitable[bytes]: ...

    def write(self, data: bytes, /) -> Awaitable[int]: ...

    def close(self) -> Awaitable[None]: ...


@dataclass(slots=True)
class _OpenDALArchiveFile:
    """Normalize AsyncFile I/O failures at the OpenDAL backend boundary."""

    file: OpenDALAsyncFile

    async def read(self, size: int | None = None) -> bytes:
        try:
            return await self.file.read(size)
        except Exception as exc:
            raise HomeArchiveStoreError(str(exc)) from exc

    async def write(self, data: bytes) -> int:
        try:
            return await self.file.write(data)
        except (opendal.exceptions.AlreadyExists, opendal.exceptions.ConditionNotMatch) as exc:
            raise HomeArchiveConflictError("Home Snapshot object already exists") from exc
        except Exception as exc:
            raise HomeArchiveStoreError(str(exc)) from exc

    async def close(self) -> None:
        try:
            await self.file.close()
        except (opendal.exceptions.AlreadyExists, opendal.exceptions.ConditionNotMatch) as exc:
            raise HomeArchiveConflictError("Home Snapshot object already exists") from exc
        except Exception as exc:
            raise HomeArchiveStoreError(str(exc)) from exc


@dataclass(slots=True)
class OpenDALHomeArchiveStore:
    """Small OpenDAL boundary for immutable Home Snapshot archive objects."""

    operator: opendal.AsyncOperator

    @classmethod
    def create_s3(
        cls,
        *,
        bucket: str,
        root: str,
        region: str | None = None,
        endpoint: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        session_token: str | None = None,
    ) -> "OpenDALHomeArchiveStore":
        options = {"bucket": bucket, "root": root}
        optional = {
            "region": region,
            "endpoint": endpoint,
            "access_key_id": access_key_id,
            "secret_access_key": secret_access_key,
            "session_token": session_token,
        }
        options.update({key: value for key, value in optional.items() if value is not None and value.strip()})
        return cls(operator=opendal.AsyncOperator("s3", **options))

    async def open_writer(self, snapshot_ref: str) -> OpenDALAsyncFile:
        path = validate_home_snapshot_ref(snapshot_ref)
        try:
            return _OpenDALArchiveFile(
                await self.operator.open(path, "wb", if_not_exists=True)  # pyright: ignore[reportUnknownMemberType]
            )
        except (opendal.exceptions.AlreadyExists, opendal.exceptions.ConditionNotMatch) as exc:
            raise HomeArchiveConflictError(f"Home Snapshot object {path!r} already exists") from exc
        except Exception as exc:
            raise HomeArchiveStoreError(str(exc)) from exc

    async def open_reader(self, snapshot_ref: str) -> OpenDALAsyncFile:
        path = validate_home_snapshot_ref(snapshot_ref)
        try:
            return _OpenDALArchiveFile(
                await self.operator.open(path, "rb")  # pyright: ignore[reportUnknownMemberType]
            )
        except opendal.exceptions.NotFound as exc:
            raise HomeSnapshotNotFoundError(f"Home Snapshot object {path!r} does not exist") from exc
        except Exception as exc:
            raise HomeArchiveStoreError(str(exc)) from exc

    async def delete(self, snapshot_ref: str) -> None:
        path = validate_home_snapshot_ref(snapshot_ref)
        try:
            await self.operator.delete(path)
        except opendal.exceptions.NotFound:
            return
        except Exception as exc:
            raise HomeArchiveStoreError(str(exc)) from exc


class HomeSnapshotTransferError(RuntimeError):
    """A lifecycle CLI job could not transfer one immutable archive."""


@dataclass(slots=True)
class E2BHomeSnapshotCLI:
    """Invoke hidden archive commands in one operation-local shellctl lease."""

    token_codec: HomeSnapshotTransferTokenCodec
    agent_stub_api_base_url: str
    shellctl_auth_token: str
    shellctl_port: int

    async def upload(
        self,
        *,
        sandbox: E2BSandbox,
        home_dir: str,
        snapshot_ref: str,
        excludes: tuple[str, ...] = (),
    ) -> None:
        argv = ["dify-agent", "home-snapshot", "upload"]
        for excluded in excludes:
            argv.extend(("--exclude", excluded))
        await self._invoke(
            sandbox=sandbox,
            home_dir=home_dir,
            snapshot_ref=snapshot_ref,
            scope=HOME_SNAPSHOT_SCOPE_WRITE,
            argv=argv,
        )

    async def download(
        self,
        *,
        sandbox: E2BSandbox,
        home_dir: str,
        snapshot_ref: str,
    ) -> None:
        await self._invoke(
            sandbox=sandbox,
            home_dir=home_dir,
            snapshot_ref=snapshot_ref,
            scope=HOME_SNAPSHOT_SCOPE_READ,
            argv=["dify-agent", "home-snapshot", "download"],
        )

    async def _invoke(
        self,
        *,
        sandbox: E2BSandbox,
        home_dir: str,
        snapshot_ref: str,
        scope: HomeSnapshotTransferScope,
        argv: list[str],
    ) -> None:
        layout = RuntimeLayout(home_dir=home_dir, workspace_dir=home_dir)
        lease = await create_e2b_shellctl_lease(
            sandbox=sandbox,
            layout=layout,
            shellctl_auth_token=self.shellctl_auth_token,
            shellctl_port=self.shellctl_port,
        )
        primary_error: BaseException | None = None
        try:
            token = self.token_codec.encode_token(scope=scope, snapshot_ref=snapshot_ref)
            result = await execute_complete_with_commands(
                lease.commands,
                shlex.join(argv),
                cwd=None,
                env={
                    AGENT_STUB_API_BASE_URL_ENV_VAR: self.agent_stub_api_base_url,
                    AGENT_STUB_AUTH_JWE_ENV_VAR: token,
                },
                timeout=None,
                max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
            )
            if result.exit_code != 0 or not result.output_complete:
                detail = result.output.strip() or result.incomplete_reason or result.status
                raise HomeSnapshotTransferError(f"Home Snapshot CLI failed: {detail}")
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            try:
                await lease.close()
            except BaseException:
                if primary_error is None:
                    raise
                logger.warning("failed to close Home Snapshot control lease", exc_info=True)


@dataclass(slots=True)
class E2BS3HomeSnapshotBackend:
    """Persist Home archives independently from E2B Sandbox lifecycle."""

    control_plane: E2BControlPlane
    archive_store: OpenDALHomeArchiveStore
    lifecycle_cli: E2BHomeSnapshotCLI
    template: str
    active_timeout_seconds: int

    async def initialize(self, spec: HomeSnapshotCreateSpec) -> str:
        """Capture the deployment template's baseline Home into a new object."""
        sandbox: E2BSandbox | None = None
        try:
            snapshot_ref = build_home_snapshot_ref(spec)
            sandbox = await self.control_plane.create(
                self.template,
                timeout=self.active_timeout_seconds,
                metadata={
                    "dify.resource": "home-snapshot-bootstrap",
                    "dify.tenant_id": spec.tenant_id,
                    "dify.agent_id": spec.agent_id,
                    "dify.home_snapshot_id": spec.home_snapshot_id,
                },
                on_timeout="kill",
            )
            await self.lifecycle_cli.upload(
                sandbox=sandbox,
                home_dir=_BOOTSTRAP_HOME,
                snapshot_ref=snapshot_ref,
                excludes=_BASELINE_EXCLUDES,
            )
            return snapshot_ref
        except BaseException as exc:
            if isinstance(exc, HomeSnapshotCreateError):
                raise
            if isinstance(exc, Exception):
                raise HomeSnapshotCreateError(str(exc)) from exc
            raise
        finally:
            if sandbox is not None:
                try:
                    _ = await sandbox.kill()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.warning("failed to kill temporary Home Snapshot Sandbox", exc_info=True)

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        if not isinstance(source, E2BS3RuntimeLease):
            raise HomeSnapshotCreateError("e2b_s3 Home Snapshot requires an E2BS3RuntimeLease")
        try:
            snapshot_ref = build_home_snapshot_ref(spec)
            await self.lifecycle_cli.upload(
                sandbox=source.sandbox,
                home_dir=source.layout.home_dir,
                snapshot_ref=snapshot_ref,
            )
            return snapshot_ref
        except BaseException as exc:
            if isinstance(exc, HomeSnapshotCreateError):
                raise
            if isinstance(exc, Exception):
                raise HomeSnapshotCreateError(str(exc)) from exc
            raise

    async def delete(self, snapshot_ref: str) -> None:
        try:
            await self.archive_store.delete(snapshot_ref)
        except ValueError as exc:
            raise HomeArchiveStoreError(str(exc)) from exc


@dataclass(slots=True)
class E2BS3ExecutionBindingBackend:
    """Map one shared E2B Sandbox to a Workspace and private participant Homes."""

    control_plane: E2BControlPlane
    lifecycle_cli: E2BHomeSnapshotCLI
    template: str
    active_timeout_seconds: int
    shellctl_auth_token: str
    shellctl_port: int

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        binding_id = ""
        sandbox: E2BSandbox | None = None
        creates_workspace = spec.existing_workspace_ref is None
        home_created = False
        try:
            binding_id = validate_ref_segment(spec.binding_id)
            workspace_id = validate_ref_segment(spec.workspace_id)
            snapshot_ref = (
                validate_home_snapshot_ref(spec.home_snapshot_ref) if spec.home_snapshot_ref is not None else None
            )
            if creates_workspace:
                sandbox = await self.control_plane.create(
                    self.template,
                    timeout=self.active_timeout_seconds,
                    metadata={
                        "dify.resource": "runtime-workspace",
                        "dify.tenant_id": spec.tenant_id,
                        "dify.workspace_id": workspace_id,
                    },
                    on_timeout="pause",
                )
                sandbox_id = validate_ref_segment(sandbox.sandbox_id)
                await self._prepare_new_workspace(sandbox, workspace_id=workspace_id)
            else:
                sandbox_id = validate_ref_segment(spec.existing_workspace_ref or "")
                sandbox = await self.control_plane.connect(
                    sandbox_id,
                    timeout=self.active_timeout_seconds,
                )
                await self._validate_workspace(sandbox, workspace_id=workspace_id)

            home_dir = _home_dir(binding_id)
            if await sandbox.files.exists(home_dir):
                raise BindingCreateError(f"Materialized Home for Binding {binding_id!r} already exists")
            home_created = True
            _ = await sandbox.files.make_dir(home_dir)
            if not await _is_real_directory(sandbox.files, home_dir):
                raise BindingCreateError(f"Materialized Home for Binding {binding_id!r} is not a real directory")
            await self._chmod_home(sandbox, home_dir=home_dir)
            if snapshot_ref is not None:
                await self.lifecycle_cli.download(
                    sandbox=sandbox,
                    home_dir=home_dir,
                    snapshot_ref=snapshot_ref,
                )
            allocation = ExecutionBindingAllocation(
                workspace_ref=sandbox_id,
                binding_ref=_binding_ref(sandbox_id=sandbox_id, binding_id=binding_id),
            )
            if creates_workspace:
                _ = await sandbox.pause(keep_memory=True)
            return allocation
        except BaseException as exc:
            if sandbox is not None:
                if creates_workspace:
                    try:
                        _ = await sandbox.kill()
                    except BaseException:
                        logger.warning("failed to kill partial e2b_s3 Workspace Sandbox", exc_info=True)
                elif home_created:
                    await _remove_home_best_effort(sandbox, binding_id=binding_id)
            if isinstance(exc, BindingCreateError):
                raise
            if isinstance(exc, Exception):
                raise BindingCreateError(str(exc)) from exc
            raise

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        sandbox: E2BSandbox | None = None
        try:
            sandbox_id, binding_id = _parse_binding_ref(binding_ref)
            sandbox = await self.control_plane.connect(
                sandbox_id,
                timeout=self.active_timeout_seconds,
            )
            home_dir = _home_dir(binding_id)
            required_directories = (home_dir, _WORKSPACE_DIR, _HOME_ROOT, _RUNTIME_ROOT)
            if not all([await _is_real_directory(sandbox.files, path) for path in required_directories]):
                raise BindingLostError(f"e2b_s3 Binding {binding_ref!r} no longer contains its Home or Workspace")
            data_plane = await create_e2b_shellctl_lease(
                sandbox=sandbox,
                layout=RuntimeLayout(home_dir=home_dir, workspace_dir=_WORKSPACE_DIR),
                shellctl_auth_token=self.shellctl_auth_token,
                shellctl_port=self.shellctl_port,
            )
            return E2BS3RuntimeLease(sandbox=sandbox, data_plane=data_plane)
        except E2BControlPlaneNotFoundError as exc:
            raise BindingLostError(f"e2b_s3 Binding {binding_ref!r} no longer exists") from exc
        except BindingLostError:
            raise
        except BaseException as exc:
            if isinstance(exc, Exception):
                raise BindingAcquireError(str(exc)) from exc
            raise

    async def release(self, lease: RuntimeLease) -> None:
        if not isinstance(lease, E2BS3RuntimeLease):
            raise TypeError("E2BS3ExecutionBindingBackend can only release its own RuntimeLease")
        try:
            await lease.data_plane.close()
        except Exception as exc:
            raise BindingAcquireError(str(exc)) from exc

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        try:
            sandbox_id, binding_id = _parse_binding_ref(spec.binding_ref)
        except ValueError as exc:
            raise BindingDestroyError(str(exc)) from exc
        if spec.destroy_workspace:
            try:
                workspace_ref = validate_ref_segment(spec.workspace_ref or "")
            except ValueError as exc:
                raise BindingDestroyError(str(exc)) from exc
            if workspace_ref != sandbox_id:
                raise BindingDestroyError("e2b_s3 Workspace ref must match the Binding Sandbox")
            try:
                _ = await self.control_plane.kill(sandbox_id)
            except E2BControlPlaneNotFoundError:
                return
            except Exception as exc:
                raise BindingDestroyError(str(exc)) from exc
            return

        try:
            sandbox = await self.control_plane.connect(
                sandbox_id,
                timeout=self.active_timeout_seconds,
            )
            home_dir = _home_dir(binding_id)
            if await sandbox.files.exists(home_dir):
                await sandbox.files.remove(home_dir)
        except E2BControlPlaneNotFoundError:
            return
        except Exception as exc:
            raise BindingDestroyError(str(exc)) from exc

    async def _prepare_new_workspace(self, sandbox: E2BSandbox, *, workspace_id: str) -> None:
        for path in (_WORKSPACE_DIR, _HOME_ROOT, _RUNTIME_ROOT):
            if await sandbox.files.exists(path):
                await sandbox.files.remove(path)
        _ = await sandbox.files.make_dir(_WORKSPACE_DIR)
        _ = await sandbox.files.make_dir(_HOME_ROOT)
        _ = await sandbox.files.make_dir(_RUNTIME_ROOT)
        for path in (_WORKSPACE_DIR, _HOME_ROOT, _RUNTIME_ROOT):
            if not await _is_real_directory(sandbox.files, path):
                raise BindingCreateError(f"new e2b_s3 layout path {path!r} is not a real directory")
        _ = await sandbox.files.write(_WORKSPACE_ID_FILE, f"{workspace_id}\n")

    async def _validate_workspace(self, sandbox: E2BSandbox, *, workspace_id: str) -> None:
        for path in (_WORKSPACE_DIR, _HOME_ROOT, _RUNTIME_ROOT):
            if not await _is_real_directory(sandbox.files, path):
                raise BindingCreateError(f"existing e2b_s3 layout path {path!r} is not a real directory")
        if not await sandbox.files.exists(_WORKSPACE_ID_FILE):
            raise BindingCreateError("existing e2b_s3 Workspace metadata is missing")
        stored_workspace_id = (await sandbox.files.read(_WORKSPACE_ID_FILE)).strip()
        if stored_workspace_id != workspace_id:
            raise BindingCreateError("existing e2b_s3 Workspace ref does not match workspace_id")

    async def _chmod_home(self, sandbox: E2BSandbox, *, home_dir: str) -> None:
        lease = await create_e2b_shellctl_lease(
            sandbox=sandbox,
            layout=RuntimeLayout(home_dir=home_dir, workspace_dir=home_dir),
            shellctl_auth_token=self.shellctl_auth_token,
            shellctl_port=self.shellctl_port,
        )
        primary_error: BaseException | None = None
        try:
            result = await execute_complete_with_commands(
                lease.commands,
                'chmod 700 -- "$HOME"',
                cwd=None,
                env=None,
                timeout=30.0,
                max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
            )
            if result.exit_code != 0 or not result.output_complete:
                raise BindingCreateError(result.output or "failed to set Materialized Home permissions")
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            try:
                await lease.close()
            except BaseException:
                if primary_error is None:
                    raise
                logger.warning("failed to close Materialized Home control lease", exc_info=True)


@dataclass(slots=True)
class E2BS3RuntimeLease:
    """Operation-local access to one private Home in a shared E2B Workspace."""

    sandbox: E2BSandbox
    data_plane: ShellctlRuntimeLease

    @property
    def handle(self) -> str:
        return self.data_plane.handle

    @property
    def layout(self) -> RuntimeLayout:
        return self.data_plane.layout

    @property
    def commands(self) -> ShellCommandProtocol:
        return self.data_plane.commands

    @property
    def files(self) -> FileSystem:
        return self.data_plane.files


def _home_dir(binding_id: str) -> str:
    return f"{_HOME_ROOT}/{validate_ref_segment(binding_id)}"


def _binding_ref(*, sandbox_id: str, binding_id: str) -> str:
    return f"{validate_ref_segment(sandbox_id)}{_BINDING_REF_SEPARATOR}{validate_ref_segment(binding_id)}"


def _parse_binding_ref(binding_ref: str) -> tuple[str, str]:
    parts = binding_ref.split(_BINDING_REF_SEPARATOR)
    if len(parts) != 2:
        raise ValueError("e2b_s3 Binding ref is invalid")
    return validate_ref_segment(parts[0]), validate_ref_segment(parts[1])


async def _is_real_directory(files: E2BSandboxFileSystem, path: str) -> bool:
    if not await files.exists(path):
        return False
    info = await files.get_info(path)
    return info.symlink_target is None and info.type is not None and info.type.value == "dir"


async def _remove_home_best_effort(sandbox: E2BSandbox, *, binding_id: str) -> None:
    try:
        home_dir = _home_dir(binding_id)
        if await sandbox.files.exists(home_dir):
            await sandbox.files.remove(home_dir)
    except BaseException:
        logger.warning("failed to remove partial e2b_s3 Materialized Home", exc_info=True)


__all__ = [
    "E2BHomeSnapshotCLI",
    "E2BS3ExecutionBindingBackend",
    "E2BS3HomeSnapshotBackend",
    "E2BS3RuntimeLease",
    "HomeSnapshotTransferError",
    "OpenDALHomeArchiveStore",
]
