from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
from dataclasses import dataclass, field
import json
from typing import cast

import httpx2 as httpx
import pytest

from dify_agent.adapters.shell.protocols import CompleteShellCommandResult, ShellCommandProtocol, ShellProviderError
from dify_agent.runtime_backend import (
    CreateHomeSnapshotRequest,
    HomeSnapshotFile,
    HomeSnapshotSource,
    SandboxCreateError,
    SandboxCreateSpec,
    SandboxLayout,
    SandboxLostError,
    SandboxResumeError,
)
from dify_agent.runtime_backend.enterprise import (
    EnterpriseGatewayClient,
    EnterpriseHomeSnapshotDriver,
    EnterpriseSandboxDriver,
)
from dify_agent.runtime_backend.errors import SandboxBackendUnavailableError
from dify_agent.runtime_backend.shellctl import ShellctlSandboxLease


def _result(*, exit_code: int) -> CompleteShellCommandResult:
    return CompleteShellCommandResult(
        job_id="job-1",
        status="exited",
        done=True,
        exit_code=exit_code,
        output="",
        output_complete=True,
        incomplete_reason=None,
        offset=0,
    )


@dataclass(slots=True)
class _FakeLease:
    layout: SandboxLayout
    handle: str = "sandbox-1"
    commands: ShellCommandProtocol = cast(ShellCommandProtocol, object())
    close_calls: int = 0
    close_error: BaseException | None = None

    async def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass(slots=True)
class _FakeGateway:
    handle: str = "sandbox-1"
    create_error: BaseException | None = None
    delete_error: BaseException | None = None
    close_error: BaseException | None = None
    create_calls: list[SandboxCreateSpec] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    close_calls: int = 0

    async def create_home_snapshot(self, request: CreateHomeSnapshotRequest) -> str:
        del request
        if self.create_error is not None:
            raise self.create_error
        return "snapshot-1"

    async def create_sandbox(self, spec: SandboxCreateSpec) -> str:
        self.create_calls.append(spec)
        if self.create_error is not None:
            raise self.create_error
        return self.handle

    async def delete_sandbox(self, handle: str) -> None:
        self.deleted.append(handle)
        if self.delete_error is not None:
            raise self.delete_error

    async def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


def _create_spec() -> SandboxCreateSpec:
    return SandboxCreateSpec(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        runtime_session_id="session-1",
        home_snapshot_ref="snapshot-1",
    )


def _patch_gateway_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "dify_agent.runtime_backend.enterprise.httpx.AsyncClient",
        lambda **kwargs: async_client(transport=httpx.MockTransport(handler), **kwargs),
    )


@pytest.mark.anyio
async def test_gateway_sends_auth_and_exact_home_and_sandbox_payloads(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[tuple[str, str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Inner-Api-Key"] == "secret"
        payload = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, payload))
        if request.url.path == "/v1/home-snapshots" and request.method == "POST":
            return httpx.Response(201, json={"snapshotRef": "home-1"})
        if request.url.path == "/v1/sandboxes" and request.method == "POST":
            return httpx.Response(201, json={"sandboxId": "sandbox-1"})
        return httpx.Response(204)

    _patch_gateway_transport(monkeypatch, handler)
    gateway = EnterpriseGatewayClient("http://gateway/", "secret")
    home_request = CreateHomeSnapshotRequest(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        source_digest="digest-1",
        source=HomeSnapshotSource(files=(HomeSnapshotFile(path=".dify/config", content=b"home"),)),
    )

    assert await gateway.create_home_snapshot(home_request) == "home-1"
    await gateway.delete_home_snapshot("home-1")
    assert await gateway.create_sandbox(_create_spec()) == "sandbox-1"
    await gateway.delete_sandbox("sandbox-1")
    await gateway.close()

    assert requests == [
        (
            "POST",
            "/v1/home-snapshots",
            {
                "tenantId": "tenant-1",
                "agentId": "agent-1",
                "agentConfigVersionId": "config-1",
                "sourceDigest": "digest-1",
                "files": [{"path": ".dify/config", "contentBase64": base64.b64encode(b"home").decode("ascii")}],
            },
        ),
        ("DELETE", "/v1/home-snapshots/home-1", None),
        (
            "POST",
            "/v1/sandboxes",
            {
                "runtimeSessionId": "session-1",
                "tenantId": "tenant-1",
                "agentId": "agent-1",
                "agentConfigVersionId": "config-1",
                "homeSnapshotRef": "snapshot-1",
            },
        ),
        ("DELETE", "/v1/sandboxes/sandbox-1", None),
    ]


@pytest.mark.anyio
async def test_gateway_404_delete_is_idempotent_for_both_drivers(monkeypatch: pytest.MonkeyPatch) -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(404, request=request)

    _patch_gateway_transport(monkeypatch, handler)
    home_driver = EnterpriseHomeSnapshotDriver(gateway_endpoint="http://gateway", auth_token="secret")
    sandbox_driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret")

    await home_driver.delete("missing-home")
    await sandbox_driver.delete("missing-sandbox")

    assert paths == ["/v1/home-snapshots/missing-home", "/v1/sandboxes/missing-sandbox"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("failure", "message"),
    [
        ("timeout", "timed out"),
        ("request", "request failed"),
        ("status", "returned 503"),
    ],
)
async def test_gateway_translates_transport_and_status_failures(
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
    message: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if failure == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        if failure == "request":
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(503, text="unavailable", request=request)

    _patch_gateway_transport(monkeypatch, handler)
    gateway = EnterpriseGatewayClient("http://gateway", "secret")

    with pytest.raises(SandboxBackendUnavailableError, match=message):
        _ = await gateway.create_sandbox(_create_spec())

    await gateway.close()


@pytest.mark.anyio
async def test_home_snapshot_create_cancellation_closes_gateway_and_is_not_wrapped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _FakeGateway(create_error=asyncio.CancelledError())
    driver = EnterpriseHomeSnapshotDriver(gateway_endpoint="http://gateway", auth_token="secret")
    monkeypatch.setattr(
        EnterpriseHomeSnapshotDriver,
        "_gateway",
        lambda _driver: cast(EnterpriseGatewayClient, cast(object, gateway)),
    )
    request = CreateHomeSnapshotRequest(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        source_digest="digest-1",
        source=HomeSnapshotSource(),
    )

    with pytest.raises(asyncio.CancelledError):
        _ = await driver.create(request)

    assert gateway.close_calls == 1


@pytest.mark.anyio
async def test_resume_probes_configured_workspace_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/srv/work space")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    lease = _FakeLease(layout=layout)
    scripts: list[str] = []

    async def run_control(
        _commands: ShellCommandProtocol,
        script: str,
        **_kwargs: object,
    ) -> CompleteShellCommandResult:
        scripts.append(script)
        return _result(exit_code=0)

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(
        EnterpriseSandboxDriver,
        "_lease",
        lease_for_handle,
    )
    monkeypatch.setattr("dify_agent.runtime_backend.enterprise.run_shellctl_control_command", run_control)

    resumed = await driver.resume("sandbox-1")

    assert resumed is lease
    assert scripts == ["test -d '/srv/work space'"]


@pytest.mark.anyio
async def test_resume_maps_missing_workspace_directory_to_sandbox_lost(monkeypatch: pytest.MonkeyPatch) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    lease = _FakeLease(layout=layout)

    async def run_control(
        _commands: ShellCommandProtocol,
        _script: str,
        **_kwargs: object,
    ) -> CompleteShellCommandResult:
        return _result(exit_code=1)

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(
        EnterpriseSandboxDriver,
        "_lease",
        lease_for_handle,
    )
    monkeypatch.setattr("dify_agent.runtime_backend.enterprise.run_shellctl_control_command", run_control)

    with pytest.raises(SandboxLostError, match="unavailable"):
        _ = await driver.resume("sandbox-1")

    assert lease.close_calls == 1


@pytest.mark.anyio
async def test_resume_does_not_classify_message_only_not_found_as_lost(monkeypatch: pytest.MonkeyPatch) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    lease = _FakeLease(layout=layout)

    async def run_control(*_args: object, **_kwargs: object) -> CompleteShellCommandResult:
        raise RuntimeError("proxy said 404 not_found because sandbox expired")

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(EnterpriseSandboxDriver, "_lease", lease_for_handle)
    monkeypatch.setattr("dify_agent.runtime_backend.enterprise.run_shellctl_control_command", run_control)

    with pytest.raises(SandboxResumeError, match="404 not_found"):
        _ = await driver.resume("sandbox-1")

    assert lease.close_calls == 1


@pytest.mark.anyio
async def test_resume_classifies_structured_shellctl_not_found_as_lost(monkeypatch: pytest.MonkeyPatch) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    lease = _FakeLease(layout=layout, close_error=RuntimeError("close failed"))

    async def run_control(*_args: object, **_kwargs: object) -> CompleteShellCommandResult:
        raise ShellProviderError("sandbox expired", code="sandbox_not_found", status_code=404)

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(EnterpriseSandboxDriver, "_lease", lease_for_handle)
    monkeypatch.setattr("dify_agent.runtime_backend.enterprise.run_shellctl_control_command", run_control)

    with pytest.raises(SandboxLostError, match="no longer exists"):
        _ = await driver.resume("sandbox-1")

    assert lease.close_calls == 1


@pytest.mark.anyio
async def test_create_deletes_acquired_handle_when_lease_construction_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    gateway = _FakeGateway()

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        raise RuntimeError("lease construction failed")

    monkeypatch.setattr(
        EnterpriseSandboxDriver, "_gateway", lambda _driver: cast(EnterpriseGatewayClient, cast(object, gateway))
    )
    monkeypatch.setattr(EnterpriseSandboxDriver, "_lease", lease_for_handle)

    with pytest.raises(SandboxCreateError, match="lease construction failed"):
        _ = await driver.create(_create_spec())

    assert gateway.deleted == ["sandbox-1"]
    assert gateway.close_calls == 1


@pytest.mark.anyio
async def test_create_preserves_gateway_create_failure_when_gateway_close_also_fails(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    gateway = _FakeGateway(
        create_error=RuntimeError("gateway create failed"),
        close_error=RuntimeError("gateway close failed"),
    )

    monkeypatch.setattr(
        EnterpriseSandboxDriver,
        "_gateway",
        lambda _driver: cast(EnterpriseGatewayClient, cast(object, gateway)),
    )

    with caplog.at_level("WARNING", logger="dify_agent.runtime_backend.enterprise"):
        with pytest.raises(SandboxCreateError, match="gateway create failed"):
            _ = await driver.create(_create_spec())

    assert gateway.deleted == []
    assert gateway.close_calls == 1
    assert "gateway close failed" in caplog.text


@pytest.mark.anyio
async def test_create_preserves_lease_failure_when_delete_and_gateway_close_fail(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    gateway = _FakeGateway(
        delete_error=RuntimeError("delete failed"),
        close_error=RuntimeError("gateway close failed"),
    )

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        raise RuntimeError("lease construction failed")

    monkeypatch.setattr(
        EnterpriseSandboxDriver, "_gateway", lambda _driver: cast(EnterpriseGatewayClient, cast(object, gateway))
    )
    monkeypatch.setattr(EnterpriseSandboxDriver, "_lease", lease_for_handle)

    with caplog.at_level("WARNING", logger="dify_agent.runtime_backend.enterprise"):
        with pytest.raises(SandboxCreateError, match="lease construction failed"):
            _ = await driver.create(_create_spec())

    assert gateway.deleted == ["sandbox-1"]
    assert gateway.close_calls == 1
    assert "delete failed" in caplog.text
    assert "gateway close failed" in caplog.text


@pytest.mark.anyio
async def test_create_cleans_up_lease_and_handle_when_gateway_close_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    gateway = _FakeGateway(close_error=RuntimeError("gateway close failed"))
    lease = _FakeLease(layout=layout)

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(
        EnterpriseSandboxDriver, "_gateway", lambda _driver: cast(EnterpriseGatewayClient, cast(object, gateway))
    )
    monkeypatch.setattr(EnterpriseSandboxDriver, "_lease", lease_for_handle)

    with pytest.raises(SandboxCreateError, match="gateway close failed"):
        _ = await driver.create(_create_spec())

    assert lease.close_calls == 1
    assert gateway.deleted == ["sandbox-1"]
    assert gateway.close_calls == 1


@pytest.mark.anyio
async def test_create_preserves_gateway_close_failure_when_delete_also_fails(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    gateway = _FakeGateway(
        delete_error=RuntimeError("delete failed"),
        close_error=RuntimeError("gateway close failed"),
    )
    lease = _FakeLease(layout=layout, close_error=RuntimeError("lease close failed"))

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(
        EnterpriseSandboxDriver, "_gateway", lambda _driver: cast(EnterpriseGatewayClient, cast(object, gateway))
    )
    monkeypatch.setattr(EnterpriseSandboxDriver, "_lease", lease_for_handle)

    with caplog.at_level("WARNING", logger="dify_agent.runtime_backend.enterprise"):
        with pytest.raises(SandboxCreateError, match="gateway close failed"):
            _ = await driver.create(_create_spec())

    assert lease.close_calls == 1
    assert gateway.deleted == ["sandbox-1"]
    assert gateway.close_calls == 1
    assert "lease close failed" in caplog.text
    assert "delete failed" in caplog.text


@pytest.mark.anyio
async def test_create_cancellation_after_lease_acquisition_cleans_every_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    driver = EnterpriseSandboxDriver(gateway_endpoint="http://gateway", auth_token="secret", layout=layout)
    gateway = _FakeGateway(close_error=asyncio.CancelledError())
    lease = _FakeLease(layout=layout)

    async def lease_for_handle(_driver: EnterpriseSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(
        EnterpriseSandboxDriver,
        "_gateway",
        lambda _driver: cast(EnterpriseGatewayClient, cast(object, gateway)),
    )
    monkeypatch.setattr(EnterpriseSandboxDriver, "_lease", lease_for_handle)

    with pytest.raises(asyncio.CancelledError):
        _ = await driver.create(_create_spec())

    assert lease.close_calls == 1
    assert gateway.deleted == ["sandbox-1"]
    assert gateway.close_calls == 1
