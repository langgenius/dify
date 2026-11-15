"""OpenShell backend adapters with shellctl as the command data plane.

One OpenShell sandbox represents both a Binding and its Workspace (the E2B
shape). Sandbox ids change across stop/start cycles, so every operation —
exec, readiness, and service exposure — addresses the sandbox by its stable
canonical *name*. The gateway replaces
the image entrypoint with its supervisor, so shellctl is started through an
idempotent exec bootstrap on acquire, and the shellctl HTTP data plane is
reached through the gateway's native service exposure (``ExposeService``),
which proxies requests to the sandbox's loopback port. The endpoint is
exposed with bearer passthrough, so the shellctl bearer token on
``Authorization`` reaches shellctl unchanged; the deployment gateway
credential stays on the gRPC control plane and is never attached to service
HTTP requests.

OpenShell has no native snapshot capability; this backend never creates Home
Snapshots and materializes every new Binding image-fresh — a supplied
``home_snapshot_ref`` is ignored rather than honored approximately.

The sandbox policy sent with every create REPLACES OpenShell's built-in
restrictive default (``restrictive_default_policy()``) instead of merging with
it, so it restates the default path set and adds ``/dev/pts``
(shellctl's tmux allocates PTYs via forkpty).

Network egress control is opt-in: when ``egress_allow`` is configured, the
policy carries one enforced allowlist rule per ``(host, port)`` endpoint and
sandbox egress is restricted to exactly those endpoints; when empty, the
policy carries no network rules and egress follows the gateway/driver default.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import shlex
import ssl
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, NoReturn, Protocol, cast
from urllib.parse import urlsplit, urlunsplit

import httpx2 as httpx
from shellctl.client import ShellctlClientError

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.shellctl import (
    ShellctlRuntimeLease,
    create_owned_shellctl_lease,
)

if TYPE_CHECKING:
    from openshell import SandboxClient
    from openshell._proto import openshell_pb2, sandbox_pb2

logger = logging.getLogger(__name__)

DEFAULT_OPENSHELL_SANDBOX_IMAGE = "langgenius/dify-agent-local-sandbox:latest"
_SAFE_REF_PART = re.compile(r"^[A-Za-z0-9._-]+$")
_SHELLCTL_READY_MAX_ATTEMPTS = 3
_SHELLCTL_READY_RETRY_INTERVAL_SECONDS = 0.5
# The gateway rejects sandbox names longer than 19 characters, so Binding ids
# (uuids) cannot appear verbatim; names and labels carry a deterministic
# digest instead of product identifiers.
_SANDBOX_NAME_DIGEST_LENGTH = 14
_POLICY_READ_ONLY = ("/usr", "/lib", "/proc", "/dev/urandom", "/app", "/etc", "/var/log")
_POLICY_READ_WRITE = ("/tmp", "/dev/null", "/dev/pts")
_EXPOSE_SERVICE_NAME = "shellctl"
_EXPOSE_SERVICE_TIMEOUT_SECONDS = 30.0
_EXPOSE_SERVICE_MAX_ATTEMPTS = 3
_EXPOSED_SERVICE_HOST_SUFFIX = ".openshell.localhost"
_SERVICE_DATA_PLANE_TIMEOUT_SECONDS = 60.0


class OpenShellNotFoundError(RuntimeError):
    """Confirmed-loss boundary error every ``OpenShellControlPlane`` must raise.

    Implementations raise this for gateway resources that no longer exist so
    the backends can map confirmed loss to ``BindingLostError`` and treat
    deletes as idempotent.
    """


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
    ) -> None: ...

    async def wait_ready(self, name: str) -> str:
        """Wait for READY and return the sandbox's canonical *name*."""
        ...

    async def start_sandbox(self, name: str) -> None:
        """Start the sandbox when stopped; no-op for running phases."""
        ...

    async def stop_sandbox(self, name: str) -> None: ...

    async def delete_sandbox(self, name: str) -> None: ...

    async def exec_script(self, sandbox_name: str, script: str) -> tuple[int, str]: ...

    async def expose_service(self, name: str, port: int) -> str:
        """Upsert the sandbox's exposed service endpoint and return its URL.

        Keyed by the stable sandbox *name* so the endpoint survives sandbox id
        changes across stop/start cycles; repeated calls refresh the
        association rather than stacking endpoints.
        """
        ...

    def create_service_http_client(self, base_url: str) -> httpx.AsyncClient:
        """Build the lease-local data-plane HTTP client for a service URL."""
        ...


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

    def _sandbox_spec(self) -> openshell_pb2.SandboxSpec:
        from google.protobuf.json_format import ParseDict
        from google.protobuf.struct_pb2 import Struct

        from openshell._proto import openshell_pb2, sandbox_pb2

        driver_config = ParseDict(self.driver_config, Struct())
        policy = sandbox_pb2.SandboxPolicy(
            version=1,
            filesystem=sandbox_pb2.FilesystemPolicy(
                include_workdir=True,
                read_only=list(_POLICY_READ_ONLY),
                read_write=list(_POLICY_READ_WRITE),
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
                        enforcement=sandbox_pb2.NETWORK_ENFORCEMENT_MODE_ENFORCE,
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
    ) -> None:
        def call() -> None:
            client = self._client()
            client.create(
                workspace=self.workspace,
                spec=self._sandbox_spec(),
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
            return ref.name

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

    async def exec_script(self, sandbox_name: str, script: str) -> tuple[int, str]:
        def call() -> tuple[int, str]:
            # The gateway logs a preview of the assembled exec argv; scripts
            # can embed the shellctl token, so they travel via stdin (the
            # gateway logs only its length) and the argv stays secret-free.
            # The SDK addresses exec by the sandbox's canonical *name*.
            result = self._client().exec(
                sandbox_name,
                ["/bin/sh", "-s"],
                workspace=self.workspace,
                stdin=script.encode(),
                timeout_seconds=self.exec_timeout_seconds,
                no_login_shell=True,
            )
            output = f"{result.stdout}{result.stderr}"
            return result.exit_code, output

        return await asyncio.to_thread(self._run_normalizing_not_found, call)

    async def expose_service(self, name: str, port: int) -> str:
        def call() -> str:
            import grpc

            from openshell._proto import datamodel_pb2, openshell_pb2

            # The Python SDK exposes service management only through its raw
            # generated stub; ExposeService upserts by sandbox *name* and
            # returns the routed URL. Concurrent upserts can ABORT in the
            # gateway store; the call is idempotent, so retry only that code.
            stub = self._client()._stub  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
            for attempt in range(_EXPOSE_SERVICE_MAX_ATTEMPTS):
                try:
                    response = stub.ExposeService(
                        openshell_pb2.ExposeServiceRequest(
                            workspace_scope=datamodel_pb2.WorkspaceSelector(workspace=self.workspace),
                            name=_EXPOSE_SERVICE_NAME,
                            target_port=port,
                            domain=True,
                            sandbox=name,
                            authorization_mode=openshell_pb2.SERVICE_AUTHORIZATION_MODE_BEARER_PASSTHROUGH,
                        ),
                        timeout=_EXPOSE_SERVICE_TIMEOUT_SECONDS,
                    )
                except grpc.RpcError as exc:
                    if _rpc_status_code(exc) == grpc.StatusCode.ABORTED and attempt + 1 < _EXPOSE_SERVICE_MAX_ATTEMPTS:
                        continue
                    raise
                return _validated_exposed_service_url(response)
            raise RuntimeError("unreachable")  # pragma: no cover

        return await asyncio.to_thread(self._run_normalizing_not_found, call)

    def create_service_http_client(self, base_url: str) -> httpx.AsyncClient:
        """Build an HTTP client for one exposed service URL.

        ``Authorization`` on this client belongs to the in-sandbox shellctl
        (the endpoint is exposed with bearer passthrough), so the deployment
        gateway credential — a gRPC control-plane credential — is deliberately
        not attached. Redirects stay off so credentials cannot follow a
        cross-origin redirect. Plain ``http`` is accepted only for loopback
        and ``*.openshell.localhost`` service hosts; the latter are dialled
        via ``127.0.0.1`` with the returned authority preserved on ``Host``
        because wildcard localhost DNS is not reliably resolved and the
        gateway routes on it. ``https`` keeps the returned host for SNI and
        routes through the deployment TLS material.
        """
        url = _validated_service_url(base_url)
        parsed = urlsplit(url)
        headers: dict[str, str] = {}
        verify: ssl.SSLContext | bool = True
        if parsed.scheme == "https":
            context = ssl.create_default_context(cafile=self.tls_ca_path)
            if self.tls_client_cert_path and self.tls_client_key_path:
                context.load_cert_chain(self.tls_client_cert_path, self.tls_client_key_path)
            verify = context
        else:
            host = parsed.hostname or ""
            if not _is_local_service_host(host):
                raise ValueError("plaintext http service URLs are only accepted for local service hosts")
            if host not in {"127.0.0.1", "::1", "localhost"}:
                headers["Host"] = parsed.netloc
                url = urlunsplit(("http", f"127.0.0.1:{parsed.port or 80}", "/", "", ""))
        return httpx.AsyncClient(
            base_url=url,
            headers=headers,
            # Redirect following could forward the shellctl bearer cross-origin.
            follow_redirects=False,
            # trust_env would route service traffic through HTTP(S)_PROXY.
            trust_env=False,
            timeout=httpx.Timeout(_SERVICE_DATA_PLANE_TIMEOUT_SECONDS),
            verify=verify,
        )

    def _run_normalizing_not_found[ResultT](self, call: Callable[[], ResultT]) -> ResultT:
        import grpc

        try:
            return call()
        except grpc.RpcError as exc:
            if _rpc_status_code(exc) == grpc.StatusCode.NOT_FOUND:
                raise OpenShellNotFoundError(str(exc)) from exc
            raise


@dataclass(slots=True)
class OpenShellExecutionBindingBackend:
    """Manage OpenShell sandboxes as coupled physical Bindings and Workspaces."""

    control_plane: OpenShellControlPlane
    shellctl_auth_token: str = ""
    shellctl_port: int = 5004
    layout: RuntimeLayout = field(
        default_factory=lambda: RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    )

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        """Create one stopped sandbox with an image-fresh Home.

        This backend has no snapshot capability: ``spec.home_snapshot_ref`` is
        deliberately ignored rather than honored approximately, so a new
        Binding always starts from the deployment image's default Home.
        """
        if spec.existing_workspace_ref is not None:
            raise SharedWorkspaceUnsupportedError("current OpenShell backend cannot attach to an existing Workspace")
        name = _binding_sandbox_name(spec.binding_id)
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
            )
            created = True
            sandbox_name = await self.control_plane.wait_ready(name)
            exit_code, output = await self.control_plane.exec_script(
                sandbox_name,
                self._create_script(),
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
        """Start the sandbox when needed, bootstrap shellctl, and refresh its exposed service.

        A failed acquisition closes only the attempt's lease-local clients; it
        does not stop the shared sandbox or interrupt other leases on it.
        """
        data_plane: ShellctlRuntimeLease | None = None
        try:
            await self.control_plane.start_sandbox(binding_ref)
            sandbox_name = await self.control_plane.wait_ready(binding_ref)
            token = self._shellctl_token(sandbox_name)
            layout_code, _ = await self.control_plane.exec_script(
                sandbox_name,
                "\n".join(
                    [
                        "set -eu",
                        f"test -d {shlex.quote(self.layout.home_dir)}",
                        f"test -d {shlex.quote(self.layout.workspace_dir)}",
                    ]
                ),
            )
            if layout_code != 0:
                raise BindingLostError(f"OpenShell Binding {binding_ref!r} no longer contains its Home or Workspace")
            exit_code, output = await self.control_plane.exec_script(sandbox_name, self._bootstrap_script(token=token))
            if exit_code != 0:
                raise BindingAcquireError(f"shellctl bootstrap failed: {output}")
            # Expose on every acquire: sandbox ids change across restarts, so
            # refresh the name-keyed endpoint association before connecting.
            base_url = await self.control_plane.expose_service(binding_ref, self.shellctl_port)
            data_plane = await self._data_plane(binding_ref, base_url, token=token)
            await _wait_for_shellctl_ready(data_plane.client)
            return OpenShellRuntimeLease(data_plane=data_plane)
        except OpenShellNotFoundError as exc:
            raise BindingLostError(f"OpenShell Binding {binding_ref!r} no longer exists") from exc
        except BaseException as exc:
            if data_plane is not None:
                await _best_effort(
                    data_plane.close,
                    message="failed to close OpenShell RuntimeLease after acquisition failed",
                    binding_ref=binding_ref,
                )
            _reraise_as(exc, error=BindingAcquireError, passthrough=(BindingLostError,))

    async def release(self, lease: RuntimeLease) -> None:
        """Close lease-owned connections without stopping the shared physical sandbox."""
        # TODO: Revisit idle resource reclamation when upstream sandbox expiration leases are available:
        # https://github.com/NVIDIA/OpenShell/issues/2591
        # Expiration deletes the sandbox/workspace, so account for active leases and retention before adopting it.
        if not isinstance(lease, OpenShellRuntimeLease):
            raise TypeError("OpenShellExecutionBindingBackend can only release its own RuntimeLease")
        # The exposed endpoint is shared by all leases on the Binding and
        # outlives them; release only closes the lease-local HTTP client and
        # deliberately neither deletes the service nor stops the sandbox.
        try:
            await lease.data_plane.close()
        except Exception as exc:
            raise BindingAcquireError(str(exc)) from exc

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

    def _create_script(self) -> str:
        home = shlex.quote(self.layout.home_dir)
        workspace = shlex.quote(self.layout.workspace_dir)
        return "\n".join(
            [
                "set -eu",
                f"rm -rf -- {workspace}",
                f"mkdir -p {workspace}",
                f"chmod 700 {home} {workspace}",
            ]
        )

    def _shellctl_token(self, sandbox_name: str) -> str:
        """Derive the per-sandbox shellctl bearer from the deployment master token.

        Keyed by the canonical stable sandbox name, so each sandbox gets a
        distinct credential while the master token stays backend-side and
        never enters the sandbox.
        """
        return hmac.new(
            self.shellctl_auth_token.encode(),
            f"dify-agent/openshell/shellctl/v1:{sandbox_name}".encode(),
            hashlib.sha256,
        ).hexdigest()

    def _bootstrap_script(self, *, token: str) -> str:
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
                f"export SHELLCTL_AUTH_TOKEN={shlex.quote(token)}",
                "export SHELLCTL_ENABLE_PATH_ISOLATION=false",
                f"if {health}; then exit 0; fi",
                f"setsid /usr/local/bin/shellctl serve --listen {listen} </dev/null >>/tmp/shellctl.log 2>&1 &",
                "i=0",
                f"until {health}; do",
                "  i=$((i+1))",
                '  [ "$i" -ge 10 ] && exit 1',
                "  sleep 1",
                "done",
            ]
        )

    async def _data_plane(self, binding_ref: str, base_url: str, *, token: str) -> ShellctlRuntimeLease:
        http_client = self.control_plane.create_service_http_client(base_url)

        def client_factory() -> ShellctlClientProtocol:
            from shellctl.client import ShellctlClient

            return cast(
                ShellctlClientProtocol,
                cast(object, ShellctlClient(base_url, token=token, client=http_client)),
            )

        return await create_owned_shellctl_lease(
            handle=binding_ref,
            layout=self.layout,
            entrypoint=base_url,
            token=token,
            client_factory=client_factory,
            owned_transport=http_client,
        )


@dataclass(slots=True)
class OpenShellRuntimeLease:
    """The owned shellctl data plane for one invocation."""

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


def _rpc_status_code(exc: BaseException) -> object:
    """Return the gRPC status code of a stub or SDK failure, when known.

    Raw generated-stub calls raise ``grpc.Call`` errors; SDK helper calls
    wrap them in ``openshell.GatewayError``, an ``RpcError`` that is not a
    ``grpc.Call`` but still answers ``code()``.
    """
    import grpc

    from openshell import GatewayError

    return exc.code() if isinstance(exc, (grpc.Call, GatewayError)) else None


def _validated_exposed_service_url(response: "openshell_pb2.ServiceEndpointResponse") -> str:
    """Return the exposed service URL, failing when the gateway ignored the requested auth mode.

    Gateways predating ``authorization_mode`` leave the field UNSPECIFIED (or
    apply STRIP); silently proceeding would send shellctl bearer tokens into a
    proxy that drops or misroutes them, so this is a hard configuration error.
    """
    from openshell._proto import openshell_pb2

    if not response.HasField("endpoint"):
        raise RuntimeError("gateway returned no service endpoint for the exposed service")
    if response.endpoint.authorization_mode != openshell_pb2.SERVICE_AUTHORIZATION_MODE_BEARER_PASSTHROUGH:
        raise RuntimeError(
            "gateway did not apply bearer-passthrough authorization to the exposed service; "
            "upgrade the OpenShell gateway to v0.1.3 or newer"
        )
    return _validated_service_url(response.url)


def _validated_service_url(url: str) -> str:
    """Return a normalized root http(s) service URL or raise ``ValueError``.

    The URL becomes a client ``base_url`` carrying the shellctl bearer, so
    reject anything that could smuggle an authority or fragment into requests.
    """
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("exposed service URL must be an absolute http(s) URL with a host")
    if parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment:
        raise ValueError("exposed service URL must not contain credentials, a query, or a fragment")
    if parsed.path not in {"", "/"}:
        raise ValueError("exposed service URL must be the service root")
    return urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))


def _is_local_service_host(host: str) -> bool:
    return host in {"127.0.0.1", "::1", "localhost", "openshell.localhost"} or host.endswith(
        _EXPOSED_SERVICE_HOST_SUFFIX
    )


def _binding_sandbox_name(binding_id: str) -> str:
    return f"dify-{_opaque_id(binding_id, error=BindingCreateError)}"


def _opaque_id(value: str, *, error: type[Exception]) -> str:
    digest = hashlib.sha256(_validated_ref_part(value, error=error).encode()).hexdigest()
    return digest[:_SANDBOX_NAME_DIGEST_LENGTH]


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
    "OpenShellControlPlane",
    "OpenShellExecutionBindingBackend",
    "OpenShellNotFoundError",
    "OpenShellRuntimeLease",
    "OpenShellSDKControlPlane",
]
