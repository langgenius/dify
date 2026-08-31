"""OpenShell backend adapters with shellctl as the command data plane.

One OpenShell sandbox represents both a Binding and its Workspace (the E2B
shape), addressed by its stable sandbox *name*; sandbox ids change across
stop/start cycles and are re-resolved on every operation. The gateway replaces
the image entrypoint with its supervisor, so shellctl is started through an
idempotent exec bootstrap on acquire, and the shellctl HTTP data plane is
reached through a per-lease ``ForwardTcp`` tunnel.

Home Snapshots require an operator-provided shared volume mounted into every
sandbox via ``SandboxTemplate.driver_config``: snapshots are directory copies
under ``<shared_mount_path>/home-snapshots/<tenant-digest>/`` because OpenShell
has no native snapshot capability. Landlock is best-effort, so production
deployments must use one OpenShell workspace and one dedicated volume per
tenant. Snapshot deletion runs in a short-lived maintenance sandbox that is
granted that tenant's snapshot root — unlinking the snapshot directory itself
requires write on its parent under Landlock.

The sandbox policy sent with every create REPLACES OpenShell's built-in
restrictive default (``restrictive_default_policy()``) instead of merging with
it, so it restates the default path set and adds ``/dev/pts``
(shellctl's tmux allocates PTYs via forkpty) plus the tenant snapshot
directory — not the whole shared mount.

Network egress control is opt-in: when ``egress_allow`` is configured, the
policy carries one enforced allowlist rule per ``(host, port)`` endpoint and
sandbox egress is restricted to exactly those endpoints; when empty, the
policy carries no network rules and egress follows the gateway/driver default.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import shlex
import threading
import time
import uuid
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, NoReturn, Protocol, cast

import httpx2 as httpx
from shellctl.client import ShellctlClientError

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    HomeSnapshotCreateError,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend.openshell_tunnel import ForwardTcpCall, ForwardTcpTunnel
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
    create_owned_shellctl_lease,
    run_shellctl_control_command,
)

if TYPE_CHECKING:
    from openshell import SandboxClient
    from openshell._proto import openshell_pb2, sandbox_pb2

logger = logging.getLogger(__name__)

DEFAULT_OPENSHELL_SANDBOX_IMAGE = "langgenius/dify-agent-local-sandbox:latest"
DEFAULT_OPENSHELL_SHARED_MOUNT_PATH = "/mnt/dify-agent-shared"
_SNAPSHOT_SUBDIR = "home-snapshots"
_SAFE_REF_PART = re.compile(r"^[A-Za-z0-9._-]+$")
_SHELLCTL_READY_MAX_ATTEMPTS = 3
_SHELLCTL_READY_RETRY_INTERVAL_SECONDS = 0.5
# The gateway hard-caps ForwardTcp at 3 concurrent streams per session token.
_TUNNEL_MAX_CONNECTIONS = 3
# The gateway rejects sandbox names longer than 19 characters, so Binding ids
# (uuids) cannot appear verbatim; names and labels carry a deterministic
# digest instead of product identifiers.
_SANDBOX_NAME_DIGEST_LENGTH = 14
_SSH_SESSION_RENEWAL_MARGIN_MS = 60_000
_POLICY_READ_ONLY = ("/usr", "/lib", "/proc", "/dev/urandom", "/app", "/etc", "/var/log")
_POLICY_READ_WRITE = ("/tmp", "/dev/null", "/dev/pts")


class OpenShellNotFoundError(RuntimeError):
    """Confirmed-loss boundary error every ``OpenShellControlPlane`` must raise.

    Implementations raise this for gateway resources that no longer exist so
    the backends can map confirmed loss to ``BindingLostError`` and treat
    deletes as idempotent.
    """


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass(slots=True)
class _SshSessionTokenSupplier:
    """Thread-safe mint-and-renew supplier for ForwardTcp session tokens.

    The gateway reaps SSH sessions after ``expires_at_ms``; every new tunnel
    connection presents the current token, so the supplier re-mints one
    renewal-margin ahead of expiry. A zero ``expires_at_ms`` means the gateway
    set no expiry and the first token is kept for the tunnel's lifetime.

    A failed re-mint raises: a tunnel must not present a token that the
    gateway may already have reaped. Renewal covers new tunnel connections
    only; streams already established with an earlier token live until the
    gateway reaps that session.
    """

    mint: Callable[[], tuple[str, int]]
    clock_ms: Callable[[], int] = _now_ms
    renewal_margin_ms: int = _SSH_SESSION_RENEWAL_MARGIN_MS
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _token: str = field(default="", init=False, repr=False)
    _expires_at_ms: int = field(default=0, init=False, repr=False)

    def __call__(self) -> str:
        with self._lock:
            if not self._token or self._renewal_due():
                self._token, self._expires_at_ms = self.mint()
            return self._token

    def _renewal_due(self) -> bool:
        return self._expires_at_ms > 0 and self.clock_ms() >= self._expires_at_ms - self.renewal_margin_ms


@dataclass(slots=True)
class _ForwardTcpFrameCodec:
    """Builds ForwardTcp frames for one sandbox port; every connection's init
    frame presents the supplier's current session token."""

    supplier: _SshSessionTokenSupplier
    sandbox_id: str
    port: int

    def init_frame(self) -> object:
        from openshell._proto import openshell_pb2

        return openshell_pb2.TcpForwardFrame(
            init=openshell_pb2.TcpForwardInit(
                sandbox_id=self.sandbox_id,
                tcp=openshell_pb2.TcpRelayTarget(host="127.0.0.1", port=self.port),
                authorization_token=self.supplier(),
            )
        )

    def data_frame(self, data: bytes) -> object:
        from openshell._proto import openshell_pb2

        return openshell_pb2.TcpForwardFrame(data=data)


class OpenShellTunnelHandle(Protocol):
    """One open data-plane tunnel to shellctl inside a sandbox."""

    @property
    def base_url(self) -> str: ...

    async def close(self) -> None: ...


class OpenShellControlPlane(Protocol):
    """Gateway operations the backends need, at deployment-config granularity.

    Image, policy, driver config, and workspace are deployment constants owned
    by the implementation; backends pass only per-resource identity.
    """

    async def create_sandbox(
        self,
        *,
        name: str,
        labels: dict[str, str],
        extra_read_write: tuple[str, ...] = (),
    ) -> None: ...

    async def wait_ready(self, name: str) -> str:
        """Wait for READY and return the sandbox's *current* id."""
        ...

    async def start_sandbox(self, name: str) -> None:
        """Start the sandbox when stopped; no-op for running phases."""
        ...

    async def stop_sandbox(self, name: str) -> None: ...

    async def delete_sandbox(self, name: str) -> None: ...

    async def exec_script(self, sandbox_id: str, script: str) -> tuple[int, str]: ...

    async def open_tunnel(self, sandbox_id: str, port: int) -> OpenShellTunnelHandle: ...


@dataclass(slots=True)
class _SdkTunnelHandle:
    tunnel: ForwardTcpTunnel
    base_url: str

    async def close(self) -> None:
        await asyncio.to_thread(self.tunnel.close)


@dataclass(slots=True)
class OpenShellSDKControlPlane:
    """Deployment-scoped OpenShell SDK boundary.

    Holds only deployment constants plus a lazily created, cached gRPC client;
    no per-resource state lives here. The synchronous SDK runs inside
    ``asyncio.to_thread``. gRPC NOT_FOUND is normalized to
    ``OpenShellNotFoundError`` so backends can distinguish confirmed resource
    loss from transient failures.
    """

    endpoint: str
    workspace: str = "default"
    bearer_token: str | None = None
    tls_ca_path: str | None = None
    tls_client_cert_path: str | None = None
    tls_client_key_path: str | None = None
    insecure: bool = False
    image: str = DEFAULT_OPENSHELL_SANDBOX_IMAGE
    driver_config: dict[str, object] = field(default_factory=dict)
    shared_mount_path: str = DEFAULT_OPENSHELL_SHARED_MOUNT_PATH
    # Opt-in egress allowlist as (host, port) pairs; empty sends no network
    # policy, leaving sandbox egress to the gateway/driver default.
    egress_allow: tuple[tuple[str, int], ...] = ()
    ready_timeout_seconds: float = 300.0
    exec_timeout_seconds: int = 120
    _client_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _client_cache: SandboxClient | None = field(default=None, init=False, repr=False)

    def _client(self) -> SandboxClient:
        with self._client_lock:
            if self._client_cache is None:
                import pathlib

                from openshell import SandboxClient, TlsConfig

                tls: TlsConfig | None
                if self.insecure:
                    tls = None
                else:
                    tls = TlsConfig(
                        ca_path=pathlib.Path(self.tls_ca_path) if self.tls_ca_path else None,
                        cert_path=pathlib.Path(self.tls_client_cert_path) if self.tls_client_cert_path else None,
                        key_path=pathlib.Path(self.tls_client_key_path) if self.tls_client_key_path else None,
                    )
                self._client_cache = SandboxClient(
                    self.endpoint,
                    tls=tls,
                    bearer_token=self.bearer_token or None,
                )
            return self._client_cache

    def _sandbox_spec(self, extra_read_write: tuple[str, ...] = ()) -> openshell_pb2.SandboxSpec:
        from google.protobuf.json_format import ParseDict
        from google.protobuf.struct_pb2 import Struct

        from openshell._proto import openshell_pb2, sandbox_pb2

        driver_config = ParseDict(self.driver_config, Struct())
        policy = sandbox_pb2.SandboxPolicy(
            version=1,
            filesystem=sandbox_pb2.FilesystemPolicy(
                include_workdir=True,
                read_only=list(_POLICY_READ_ONLY),
                read_write=[*_POLICY_READ_WRITE, *extra_read_write],
            ),
            landlock=sandbox_pb2.LandlockPolicy(compatibility="best_effort"),
            network_policies=self._network_policies(),
        )
        return openshell_pb2.SandboxSpec(
            template=openshell_pb2.SandboxTemplate(image=self.image, driver_config=driver_config),
            policy=policy,
        )

    def _network_policies(self) -> dict[str, sandbox_pb2.NetworkPolicyRule]:
        from openshell._proto import sandbox_pb2

        policies: dict[str, sandbox_pb2.NetworkPolicyRule] = {}
        for index, (host, port) in enumerate(self.egress_allow):
            # The map key doubles as the rule name; the index keeps entries
            # unique even when sanitized endpoints would collide.
            name = f"allow_{index}_" + re.sub(r"[^0-9A-Za-z]", "_", f"{host}_{port}")
            policies[name] = sandbox_pb2.NetworkPolicyRule(
                name=name,
                endpoints=[
                    sandbox_pb2.NetworkEndpoint(
                        host=host,
                        port=port,
                        protocol="rest",
                        enforcement="enforce",
                        rules=[sandbox_pb2.L7Rule(allow=sandbox_pb2.L7Allow(method="*", path="/**"))],
                    )
                ],
                # OpenShell also gates which in-sandbox binaries may open the
                # connection; "/**" allows any (the Agent Stub client plus
                # tools the agent runs) — the endpoint list is the allowlist.
                binaries=[sandbox_pb2.NetworkBinary(path="/**")],
            )
        return policies

    async def create_sandbox(
        self,
        *,
        name: str,
        labels: dict[str, str],
        extra_read_write: tuple[str, ...] = (),
    ) -> None:
        def call() -> None:
            client = self._client()
            _ = client.create(
                workspace=self.workspace,
                spec=self._sandbox_spec(extra_read_write),
                name=name,
                labels=labels,
            )

        await asyncio.to_thread(self._run_normalizing_not_found, call)

    async def wait_ready(self, name: str) -> str:
        def call() -> str:
            ref = self._client().wait_ready(
                name,
                workspace=self.workspace,
                timeout_seconds=self.ready_timeout_seconds,
            )
            return str(ref.id)

        return await asyncio.to_thread(self._run_normalizing_not_found, call)

    async def start_sandbox(self, name: str) -> None:
        def call() -> None:
            from openshell._proto import openshell_pb2

            client = self._client()
            sandbox = client.get(name, workspace=self.workspace)
            phase = sandbox.status.phase
            if phase in (openshell_pb2.SANDBOX_PHASE_STOPPED, openshell_pb2.SANDBOX_PHASE_STOPPING):
                _ = client.start(name, workspace=self.workspace)

        await asyncio.to_thread(self._run_normalizing_not_found, call)

    async def stop_sandbox(self, name: str) -> None:
        def call() -> None:
            _ = self._client().stop(name, workspace=self.workspace)

        await asyncio.to_thread(self._run_normalizing_not_found, call)

    async def delete_sandbox(self, name: str) -> None:
        def call() -> None:
            _ = self._client().delete(name, workspace=self.workspace)

        await asyncio.to_thread(self._run_normalizing_not_found, call)

    async def exec_script(self, sandbox_id: str, script: str) -> tuple[int, str]:
        def call() -> tuple[int, str]:
            # The gateway logs a preview of the assembled exec argv; scripts
            # can embed the shellctl token, so they travel via stdin (the
            # gateway logs only its length) and the argv stays secret-free.
            result = self._client().exec(
                sandbox_id,
                ["/bin/sh", "-s"],
                stdin=script.encode(),
                timeout_seconds=self.exec_timeout_seconds,
            )
            output = f"{result.stdout}{result.stderr}"
            return int(result.exit_code), output

        return await asyncio.to_thread(self._run_normalizing_not_found, call)

    async def open_tunnel(self, sandbox_id: str, port: int) -> OpenShellTunnelHandle:
        def call() -> _SdkTunnelHandle:
            from openshell._proto import openshell_pb2

            client = self._client()
            # The Python SDK exposes CreateSshSession/ForwardTcp only through
            # its raw generated stub; sessions authorize ForwardTcp streams.
            stub = client._stub  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]

            def mint() -> tuple[str, int]:
                # Bounded: mint runs under the supplier lock inside tunnel
                # connection threads, so a hung call must not stall them all.
                session = stub.CreateSshSession(
                    openshell_pb2.CreateSshSessionRequest(sandbox_id=sandbox_id),
                    timeout=30.0,
                )
                return str(session.token), int(session.expires_at_ms)

            token_supplier = _SshSessionTokenSupplier(mint=mint)
            _ = token_supplier()  # mint eagerly so acquire fails here, not mid-run

            def stream_factory(request_iterator: Iterator[object]) -> ForwardTcpCall:
                return cast(ForwardTcpCall, stub.ForwardTcp(request_iterator))

            tunnel = ForwardTcpTunnel(
                stream_factory=stream_factory,
                frame_codec=_ForwardTcpFrameCodec(supplier=token_supplier, sandbox_id=sandbox_id, port=port),
            )
            return _SdkTunnelHandle(tunnel=tunnel, base_url=tunnel.open())

        return await asyncio.to_thread(self._run_normalizing_not_found, call)

    def _run_normalizing_not_found[ResultT](self, call: Callable[[], ResultT]) -> ResultT:
        import grpc

        try:
            return call()
        except grpc.RpcError as exc:
            code = exc.code() if isinstance(exc, grpc.Call) else None
            if code == grpc.StatusCode.NOT_FOUND:
                raise OpenShellNotFoundError(str(exc)) from exc
            raise


@dataclass(slots=True)
class OpenShellHomeSnapshotBackend:
    """Directory-copy Home Snapshots on the operator-provided shared volume."""

    control_plane: OpenShellControlPlane
    shared_mount_path: str = DEFAULT_OPENSHELL_SHARED_MOUNT_PATH

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        if not isinstance(source, OpenShellRuntimeLease):
            raise HomeSnapshotCreateError("OpenShell Home Snapshot requires an OpenShell RuntimeLease")
        snapshot_ref = _snapshot_ref_for(spec.tenant_id, spec.home_snapshot_id)
        target = _snapshot_dir(self.shared_mount_path, snapshot_ref, error=HomeSnapshotCreateError)
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
            result = await run_shellctl_control_command(source.commands, script)
            if result.exit_code != 0:
                raise HomeSnapshotCreateError(result.output)
            return snapshot_ref
        except BaseException as exc:
            await _remove_partial_snapshot(source.commands, target=target, snapshot_ref=snapshot_ref)
            _reraise_as(exc, error=HomeSnapshotCreateError)

    async def delete(self, snapshot_ref: str) -> None:
        """Remove one snapshot directory through a short-lived maintenance sandbox.

        The sandbox is granted the tenant snapshot root rather than the target
        alone: Landlock requires write on the parent directory to unlink the
        snapshot directory itself, and the root stays a single-tenant trust
        boundary.
        """
        target = _snapshot_dir(self.shared_mount_path, snapshot_ref, error=BindingDestroyError)
        tenant_root = target.rsplit("/", 1)[0]
        gc_name = f"gc-{uuid.uuid4().hex[:16]}"
        created = False
        try:
            await self.control_plane.create_sandbox(
                name=gc_name,
                labels={"dify.resource": "snapshot-gc"},
                extra_read_write=(tenant_root,),
            )
            created = True
            sandbox_id = await self.control_plane.wait_ready(gc_name)
            exit_code, output = await self.control_plane.exec_script(
                sandbox_id,
                f"rm -rf -- {shlex.quote(target)}",
            )
            if exit_code != 0:
                raise BindingDestroyError(output)
        except BindingDestroyError:
            raise
        except Exception as exc:
            raise BindingDestroyError(str(exc)) from exc
        finally:
            if created:
                await _best_effort(
                    lambda: self.control_plane.delete_sandbox(gc_name),
                    message="failed to delete OpenShell snapshot maintenance sandbox",
                    sandbox_name=gc_name,
                )


@dataclass(slots=True)
class OpenShellExecutionBindingBackend:
    """Manage OpenShell sandboxes as coupled physical Bindings and Workspaces."""

    control_plane: OpenShellControlPlane
    shellctl_auth_token: str = ""
    shellctl_port: int = 5004
    shared_mount_path: str = DEFAULT_OPENSHELL_SHARED_MOUNT_PATH
    layout: RuntimeLayout = field(
        default_factory=lambda: RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    )

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        """Create one stopped sandbox, optionally materializing a Home Snapshot."""
        if spec.existing_workspace_ref is not None:
            raise SharedWorkspaceUnsupportedError("current OpenShell backend cannot attach to an existing Workspace")
        name = _binding_sandbox_name(spec.binding_id)
        tenant_root = _tenant_snapshot_root(
            self.shared_mount_path, spec.tenant_id, error=BindingCreateError
        )
        created = False
        try:
            await self.control_plane.create_sandbox(
                name=name,
                labels={
                    "dify.resource": "runtime-sandbox",
                    "dify.binding": _opaque_id(spec.binding_id, error=BindingCreateError),
                    "dify.workspace": _opaque_id(spec.workspace_id, error=BindingCreateError),
                    "dify.tenant": _opaque_id(spec.tenant_id, error=BindingCreateError),
                    "dify.agent": _opaque_id(spec.agent_id, error=BindingCreateError),
                },
                extra_read_write=(tenant_root,),
            )
            created = True
            sandbox_id = await self.control_plane.wait_ready(name)
            exit_code, output = await self.control_plane.exec_script(
                sandbox_id,
                self._create_script(spec.home_snapshot_ref),
            )
            if exit_code != 0:
                raise BindingCreateError(output)
            await self.control_plane.stop_sandbox(name)
            return ExecutionBindingAllocation(binding_ref=name, workspace_ref=name)
        except BaseException as exc:
            if created:
                await _best_effort(
                    lambda: self.control_plane.delete_sandbox(name),
                    message="failed to delete OpenShell sandbox after Binding creation failed",
                    binding_ref=name,
                )
            _reraise_as(exc, error=BindingCreateError)

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        """Start the sandbox when needed, bootstrap shellctl, and open the tunnel."""
        tunnel: OpenShellTunnelHandle | None = None
        data_plane: ShellctlRuntimeLease | None = None
        try:
            await self.control_plane.start_sandbox(binding_ref)
            sandbox_id = await self.control_plane.wait_ready(binding_ref)
            layout_code, _ = await self.control_plane.exec_script(
                sandbox_id,
                "\n".join(
                    [
                        "set -eu",
                        f"test -d {shlex.quote(self.layout.home_dir)}",
                        f"test -d {shlex.quote(self.layout.workspace_dir)}",
                    ]
                ),
            )
            if layout_code != 0:
                raise BindingLostError(
                    f"OpenShell Binding {binding_ref!r} no longer contains its Home or Workspace"
                )
            exit_code, output = await self.control_plane.exec_script(sandbox_id, self._bootstrap_script())
            if exit_code != 0:
                raise BindingAcquireError(f"shellctl bootstrap failed: {output}")
            tunnel = await self.control_plane.open_tunnel(sandbox_id, self.shellctl_port)
            data_plane = await self._data_plane(binding_ref, tunnel.base_url)
            await _wait_for_shellctl_ready(data_plane.client)
            return OpenShellRuntimeLease(tunnel=tunnel, data_plane=data_plane)
        except OpenShellNotFoundError as exc:
            raise BindingLostError(f"OpenShell Binding {binding_ref!r} no longer exists") from exc
        except BaseException as exc:
            if data_plane is not None:
                await _best_effort(
                    data_plane.close,
                    message="failed to close OpenShell RuntimeLease after acquisition failed",
                    binding_ref=binding_ref,
                )
            if tunnel is not None:
                await _best_effort(
                    tunnel.close,
                    message="failed to close OpenShell tunnel after acquisition failed",
                    binding_ref=binding_ref,
                )
            await _best_effort(
                lambda: self.control_plane.stop_sandbox(binding_ref),
                message="failed to stop OpenShell sandbox after acquisition failed",
                binding_ref=binding_ref,
            )
            _reraise_as(exc, error=BindingAcquireError, passthrough=(BindingLostError,))

    async def release(self, lease: RuntimeLease) -> None:
        """Close the tunnel-backed data plane and stop the physical sandbox."""
        if not isinstance(lease, OpenShellRuntimeLease):
            raise TypeError("OpenShellExecutionBindingBackend can only release its own RuntimeLease")
        close_error: Exception | None = None
        try:
            await lease.data_plane.close()
        except Exception as exc:
            close_error = exc
        try:
            await lease.tunnel.close()
        except Exception as exc:
            close_error = close_error or exc
        try:
            await self.control_plane.stop_sandbox(lease.handle)
        except OpenShellNotFoundError as exc:
            raise BindingLostError(f"OpenShell Binding {lease.handle!r} no longer exists") from exc
        except Exception as exc:
            raise BindingAcquireError(str(exc)) from exc
        if close_error is not None:
            raise BindingAcquireError(str(close_error)) from close_error

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        """Destroy the coupled physical Binding and Workspace idempotently."""
        if not spec.destroy_workspace:
            raise WorkspacePreservationUnsupportedError(
                "current OpenShell backend cannot destroy a Binding while preserving its Workspace"
            )
        if spec.workspace_ref != spec.binding_ref:
            raise BindingDestroyError("OpenShell Workspace ref must equal its Binding ref")
        try:
            await self.control_plane.delete_sandbox(spec.binding_ref)
        except OpenShellNotFoundError:
            return
        except Exception as exc:
            raise BindingDestroyError(str(exc)) from exc

    def _create_script(self, home_snapshot_ref: str | None) -> str:
        home = shlex.quote(self.layout.home_dir)
        workspace = shlex.quote(self.layout.workspace_dir)
        lines = ["set -eu"]
        if home_snapshot_ref is not None:
            snapshot_dir = shlex.quote(
                _snapshot_dir(self.shared_mount_path, home_snapshot_ref, error=BindingCreateError)
            )
            lines.extend(
                [
                    # Fail (not fall back) when the immutable snapshot is missing.
                    f"test -d {snapshot_dir}",
                    f"cp -a {snapshot_dir}/. {home}/",
                    # The snapshot carries the source's shellctl runtime state
                    # (SQLite job db, tmux socket); a new Binding must not
                    # resume it.
                    f"rm -rf -- {home}/.local/share/shellctl",
                ]
            )
        lines.extend(
            [
                f"rm -rf -- {workspace}",
                f"mkdir -p {workspace}",
                f"chmod 700 {home} {workspace}",
            ]
        )
        return "\n".join(lines)

    def _bootstrap_script(self) -> str:
        """Idempotently start shellctl on the sandbox loopback.

        The supervisor replaces the image entrypoint, so shellctl never starts
        on its own. Landlock path isolation inside shellctl stays off: the
        sandbox policy's Landlock layer is authoritative here and stacking the
        two would require re-granting every device path twice.
        """
        listen = f"127.0.0.1:{self.shellctl_port}"
        health = f"curl -fsS -m 2 http://{listen}/healthz >/dev/null 2>&1"
        return "\n".join(
            [
                "set -eu",
                f"export HOME={shlex.quote(self.layout.home_dir)}",
                f"export SHELLCTL_AUTH_TOKEN={shlex.quote(self.shellctl_auth_token)}",
                "export SHELLCTL_ENABLE_PATH_ISOLATION=false",
                f"if {health}; then exit 0; fi",
                f"setsid /usr/local/bin/shellctl serve --listen {listen} </dev/null >>/tmp/shellctl.log 2>&1 &",
                "i=0",
                f"until {health}; do",
                '  i=$((i+1))',
                '  [ "$i" -ge 10 ] && exit 1',
                "  sleep 1",
                "done",
            ]
        )

    async def _data_plane(self, binding_ref: str, base_url: str) -> ShellctlRuntimeLease:
        http_client = httpx.AsyncClient(
            base_url=base_url,
            follow_redirects=True,
            timeout=httpx.Timeout(60.0),
            # trust_env would route the loopback tunnel through HTTP(S)_PROXY.
            trust_env=False,
            limits=httpx.Limits(
                max_connections=_TUNNEL_MAX_CONNECTIONS,
                max_keepalive_connections=_TUNNEL_MAX_CONNECTIONS,
            ),
        )

        def client_factory() -> ShellctlClientProtocol:
            from shellctl.client import ShellctlClient

            return cast(
                ShellctlClientProtocol,
                cast(object, ShellctlClient(base_url, token=self.shellctl_auth_token, client=http_client)),
            )

        return await create_owned_shellctl_lease(
            handle=binding_ref,
            layout=self.layout,
            entrypoint=base_url,
            token=self.shellctl_auth_token,
            client_factory=client_factory,
            owned_transport=http_client,
        )

@dataclass(slots=True)
class OpenShellRuntimeLease:
    """Invocation-local ForwardTcp tunnel plus the owned shellctl data plane."""

    tunnel: OpenShellTunnelHandle
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


def _binding_sandbox_name(binding_id: str) -> str:
    return f"dify-{_opaque_id(binding_id, error=BindingCreateError)}"


def _opaque_id(value: str, *, error: type[Exception]) -> str:
    digest = hashlib.sha256(_validated_ref_part(value, error=error).encode()).hexdigest()
    return digest[:_SANDBOX_NAME_DIGEST_LENGTH]


def _snapshot_ref_for(tenant_id: str, home_snapshot_id: str) -> str:
    tenant = _opaque_id(tenant_id, error=HomeSnapshotCreateError)
    name = f"home-{_validated_ref_part(home_snapshot_id, error=HomeSnapshotCreateError)}"
    return f"{tenant}--{name}"


def _split_snapshot_ref(snapshot_ref: str, *, error: type[Exception]) -> tuple[str, str]:
    normalized = _validated_ref_part(snapshot_ref, error=error)
    tenant, separator, name = normalized.partition("--")
    if not separator or not tenant or not name:
        raise error("runtime backend ref must be a safe path segment")
    return _validated_ref_part(tenant, error=error), _validated_ref_part(name, error=error)


def _tenant_snapshot_root(shared_mount_path: str, tenant_id: str, *, error: type[Exception]) -> str:
    return f"{shared_mount_path.rstrip('/')}/{_SNAPSHOT_SUBDIR}/{_opaque_id(tenant_id, error=error)}"


def _snapshot_dir(shared_mount_path: str, snapshot_ref: str, *, error: type[Exception]) -> str:
    tenant, name = _split_snapshot_ref(snapshot_ref, error=error)
    return f"{shared_mount_path.rstrip('/')}/{_SNAPSHOT_SUBDIR}/{tenant}/{name}"


def _validated_ref_part(value: str, *, error: type[Exception]) -> str:
    if value in {"", ".", ".."} or _SAFE_REF_PART.fullmatch(value) is None:
        raise error("runtime backend ref must be a safe path segment")
    return value


async def _wait_for_shellctl_ready(client: ShellctlClientProtocol) -> None:
    for attempt in range(_SHELLCTL_READY_MAX_ATTEMPTS):
        try:
            _ = await client.health()
            return
        except (httpx.TimeoutException, httpx.RequestError):
            if attempt == _SHELLCTL_READY_MAX_ATTEMPTS - 1:
                raise
        except ShellctlClientError as exc:
            if not 500 <= exc.status_code < 600 or attempt == _SHELLCTL_READY_MAX_ATTEMPTS - 1:
                raise
        await asyncio.sleep(_SHELLCTL_READY_RETRY_INTERVAL_SECONDS)


async def _remove_partial_snapshot(commands: ShellCommandProtocol, *, target: str, snapshot_ref: str) -> None:
    try:
        result = await run_shellctl_control_command(commands, f"rm -rf -- {shlex.quote(target)}")
        if result.exit_code != 0:
            logger.warning("failed to remove partial OpenShell snapshot", extra={"snapshot_ref": snapshot_ref})
    except BaseException:
        logger.warning(
            "failed to remove partial OpenShell snapshot",
            exc_info=True,
            extra={"snapshot_ref": snapshot_ref},
        )


def _reraise_as(
    exc: BaseException,
    *,
    error: type[Exception],
    passthrough: tuple[type[Exception], ...] = (),
) -> NoReturn:
    """Re-raise domain errors as-is and wrap any other ``Exception`` in ``error``.

    Non-``Exception`` ``BaseException``s (cancellation, exit signals) propagate
    unwrapped.
    """
    if isinstance(exc, (error, *passthrough)):
        raise exc
    if isinstance(exc, Exception):
        raise error(str(exc)) from exc
    raise exc


async def _best_effort(action: Callable[[], Awaitable[object]], *, message: str, **extra: str) -> None:
    """Run one cleanup step, downgrading any failure to a warning log."""
    try:
        _ = await action()
    except BaseException:
        logger.warning(message, exc_info=True, extra=dict(extra))


__all__ = [
    "DEFAULT_OPENSHELL_SANDBOX_IMAGE",
    "DEFAULT_OPENSHELL_SHARED_MOUNT_PATH",
    "OpenShellControlPlane",
    "OpenShellExecutionBindingBackend",
    "OpenShellHomeSnapshotBackend",
    "OpenShellNotFoundError",
    "OpenShellRuntimeLease",
    "OpenShellSDKControlPlane",
    "OpenShellTunnelHandle",
]
