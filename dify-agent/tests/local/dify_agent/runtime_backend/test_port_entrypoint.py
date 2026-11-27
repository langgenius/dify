from __future__ import annotations

from dataclasses import dataclass

import pytest

from dify_agent.runtime_backend import (
    BindingAcquireError,
    PortEntrypoint,
    PortEntrypointUnsupportedError,
    RuntimeLayout,
)
from dify_agent.runtime_backend.e2b import E2BRuntimeLease
from dify_agent.runtime_backend.enterprise import EnterpriseRuntimeLease
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend
from dify_agent.runtime_backend.openshell import OpenShellRuntimeLease
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease, create_shellctl_lease
from tests.local.dify_agent.runtime_backend.test_local import _Factory


def test_local_backend_derives_port_entrypoint_from_endpoint_authority() -> None:
    backend = LocalExecutionBindingBackend(endpoint="http://local_sandbox:5004", auth_token="")

    assert backend._port_entrypoint(9333) == PortEntrypoint(base_url="http://local_sandbox:9333")


@pytest.mark.anyio
async def test_local_acquire_lease_exposes_port_entrypoint() -> None:
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://local_sandbox:5004",
        auth_token="",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    lease = await backend.acquire("binding-1:workspace-1")

    assert lease.port_entrypoint(9333) == PortEntrypoint(base_url="http://local_sandbox:9333")
    await backend.release(lease)


def test_shellctl_lease_without_factory_reports_unsupported() -> None:
    lease = ShellctlRuntimeLease(
        handle="binding-1:workspace-1",
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace"),
        client=object(),  # pyright: ignore[reportArgumentType]
        commands=object(),  # pyright: ignore[reportArgumentType]
    )

    with pytest.raises(PortEntrypointUnsupportedError):
        lease.port_entrypoint(9333)


def test_shellctl_lease_with_factory_delegates() -> None:
    lease = create_shellctl_lease(
        handle="binding-1:workspace-1",
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace"),
        entrypoint="http://local_sandbox:5004",
        token="",
        client_factory=lambda: object(),  # pyright: ignore[reportReturnValue]
        port_entrypoint_factory=lambda port: PortEntrypoint(base_url=f"http://local_sandbox:{port}"),
    )

    assert lease.port_entrypoint(9333) == PortEntrypoint(base_url="http://local_sandbox:9333")
    assert lease.port_entrypoint(1) == PortEntrypoint(base_url="http://local_sandbox:1")


@dataclass(frozen=True)
class _FakeSandbox:
    sandbox_id: str = "sbx-1"
    traffic_access_token: str | None = "token-1"

    def get_host(self, port: int) -> str:
        return f"{port}-{self.sandbox_id}.e2b.dev"


def test_e2b_lease_builds_hosted_entrypoint_with_traffic_token() -> None:
    lease = E2BRuntimeLease(
        sandbox=_FakeSandbox(),  # pyright: ignore[reportArgumentType]
        data_plane=None,  # pyright: ignore[reportArgumentType]
    )

    assert lease.port_entrypoint(9333) == PortEntrypoint(
        base_url="https://9333-sbx-1.e2b.dev",
        headers={"e2b-traffic-access-token": "token-1"},
    )


def test_e2b_lease_without_traffic_token_fails() -> None:
    lease = E2BRuntimeLease(
        sandbox=_FakeSandbox(traffic_access_token=None),  # pyright: ignore[reportArgumentType]
        data_plane=None,  # pyright: ignore[reportArgumentType]
    )

    with pytest.raises(BindingAcquireError, match="traffic access token"):
        lease.port_entrypoint(9333)


def test_openshell_lease_reports_unsupported() -> None:
    lease = OpenShellRuntimeLease(data_plane=object())  # pyright: ignore[reportArgumentType]

    with pytest.raises(PortEntrypointUnsupportedError, match="OpenShell"):
        lease.port_entrypoint(9333)


def test_enterprise_lease_reports_unsupported() -> None:
    lease = EnterpriseRuntimeLease(data_plane=object())  # pyright: ignore[reportArgumentType]

    with pytest.raises(PortEntrypointUnsupportedError, match="Enterprise"):
        lease.port_entrypoint(9333)
