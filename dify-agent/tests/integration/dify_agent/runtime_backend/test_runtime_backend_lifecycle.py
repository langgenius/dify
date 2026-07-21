"""Reproducible runtime-backend lifecycle integration contracts.

From the repository root, run the Local contract in a fresh disposable
container with default path isolation. The runner selects an unused host port
and removes the exact container on exit:

    cd dify-agent
    tests/integration/dify_agent/runtime_backend/run_local_integration.sh

Or point the same contract at an explicitly managed real shellctl endpoint:

    cd dify-agent
    DIFY_AGENT_TEST_LOCAL_SHELLCTL_ENDPOINT=http://127.0.0.1:5004 \
      pdm run pytest --import-mode=importlib tests/integration/dify_agent/runtime_backend -k local

Run the real E2B contract with an explicitly opted-in secret:

    cd dify-agent
    DIFY_AGENT_TEST_E2B_API_KEY="${E2B_API_KEY:-$E2B_API_TOKEN}" \
      DIFY_AGENT_TEST_E2B_TEMPLATE=difys-default-team/dify-agent-local-sandbox \
      pdm run pytest --import-mode=importlib tests/integration/dify_agent/runtime_backend -k e2b

``DIFY_AGENT_TEST_LOCAL_SHELLCTL_AUTH_TOKEN`` is optional. The E2B template can
be overridden with ``DIFY_AGENT_TEST_E2B_TEMPLATE`` and defaults to the
published Dify template. Tests skip with an actionable reason when their
required endpoint or credential is absent.
"""

from __future__ import annotations

import json
import os
import sys
from typing import cast
import uuid

import httpx2 as httpx
import pytest

from dify_agent.runtime_backend import (
    InitializeHomeSnapshotSpec,
    SandboxCreateSpec,
    SandboxLease,
)
from dify_agent.runtime_backend.e2b import E2BHomeSnapshotDriver, E2BSDKControlPlane, E2BSandboxDriver
from dify_agent.runtime_backend.enterprise import EnterpriseSandboxDriver
from dify_agent.runtime_backend.errors import SandboxLostError
from dify_agent.runtime_backend.local import LocalHomeSnapshotDriver, LocalSandboxDriver

pytestmark = pytest.mark.integration

_DEFAULT_E2B_TEMPLATE = "difys-default-team/dify-agent-local-sandbox"


def _required_env(name: str, purpose: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        pytest.skip(f"set {name} to run the {purpose} integration contract")
    return value


@pytest.mark.anyio
async def test_local_two_runtime_sessions_remain_isolated_through_resume_and_delete() -> None:
    endpoint = _required_env("DIFY_AGENT_TEST_LOCAL_SHELLCTL_ENDPOINT", "real Local shellctl")
    token = os.environ.get("DIFY_AGENT_TEST_LOCAL_SHELLCTL_AUTH_TOKEN", "")
    marker = uuid.uuid4().hex
    session_a = f"integration-a-{marker}"
    session_b = f"integration-b-{marker}"
    snapshot_ref: str | None = None
    created_handles: set[str] = set()
    active_leases: list[SandboxLease] = []
    home_driver = LocalHomeSnapshotDriver(endpoint=endpoint, auth_token=token)
    sandbox_driver = LocalSandboxDriver(endpoint=endpoint, auth_token=token)

    try:
        snapshot_ref = await home_driver.initialize(
            InitializeHomeSnapshotSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                home_snapshot_id=marker,
            )
        )
        for session_id, content in ((session_a, b"content-a"), (session_b, b"content-b")):
            lease = await sandbox_driver.create(
                SandboxCreateSpec(
                    tenant_id="integration-tenant",
                    agent_id="integration-agent",
                    agent_config_version_id=marker,
                    runtime_session_id=session_id,
                    home_snapshot_ref=snapshot_ref,
                )
            )
            created_handles.add(lease.handle)
            active_leases.append(lease)
            await lease.files.upload(
                content=content,
                remote_path=f"{lease.layout.workspace_dir}/same-relative-path.txt",
            )
            await sandbox_driver.suspend(lease)
            active_leases.remove(lease)

        for session_id, expected in ((session_a, b"content-a"), (session_b, b"content-b")):
            lease = await sandbox_driver.resume(session_id)
            active_leases.append(lease)
            captured = await lease.files.read_bytes(
                workspace_dir=lease.layout.workspace_dir,
                path="same-relative-path.txt",
                max_bytes=1024,
            )
            assert lease.handle == session_id
            assert captured.content == expected
            await sandbox_driver.suspend(lease)
            active_leases.remove(lease)

        await sandbox_driver.delete(session_a)
        created_handles.remove(session_a)
        with pytest.raises(SandboxLostError):
            _ = await sandbox_driver.resume(session_a)

        surviving_lease = await sandbox_driver.resume(session_b)
        active_leases.append(surviving_lease)
        surviving_content = await surviving_lease.files.read_bytes(
            workspace_dir=surviving_lease.layout.workspace_dir,
            path="same-relative-path.txt",
            max_bytes=1024,
        )
        assert surviving_content.content == b"content-b"
        await sandbox_driver.suspend(surviving_lease)
        active_leases.remove(surviving_lease)
    finally:
        primary_error = sys.exc_info()[0] is not None
        cleanup_errors: list[BaseException] = []
        for lease in active_leases:
            try:
                await sandbox_driver.suspend(lease)
            except BaseException as exc:
                cleanup_errors.append(exc)
        for handle in created_handles:
            try:
                await sandbox_driver.delete(handle)
            except BaseException as exc:
                cleanup_errors.append(exc)
        if snapshot_ref is not None:
            try:
                await home_driver.delete(snapshot_ref)
            except BaseException as exc:
                cleanup_errors.append(exc)
        if cleanup_errors and not primary_error:
            raise cleanup_errors[0]


class _TrackingTransport(httpx.MockTransport):
    close_calls: int

    def __init__(self, handler) -> None:
        super().__init__(handler)
        self.close_calls = 0

    async def aclose(self) -> None:
        self.close_calls += 1
        await super().aclose()


@pytest.mark.anyio
async def test_enterprise_create_suspend_resume_delete_uses_real_http_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[tuple[str, str, object]] = []
    transports: list[_TrackingTransport] = []
    async_client_type = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, payload))
        if request.url.path == "/v1/sandboxes" and request.method == "POST":
            assert request.headers["X-Inner-Api-Key"] == "enterprise-secret"
            return httpx.Response(201, json={"sandboxId": "enterprise-sandbox-1"})
        if request.url.path == "/proxy/v1/jobs/run":
            assert request.headers["X-Sandbox-Id"] == "enterprise-sandbox-1"
            assert request.headers["X-Inner-Api-Key"] == "enterprise-secret"
            assert request.headers["Authorization"] == "Bearer enterprise-secret"
            assert payload is not None
            assert cast(dict[str, object], payload)["script"] == "test -d /home/dify/workspace"
            return httpx.Response(
                200,
                json={
                    "job_id": "workspace-probe",
                    "done": True,
                    "status": "exited",
                    "exit_code": 0,
                    "output_path": "/tmp/workspace-probe.log",
                    "output": "",
                    "offset": 0,
                    "truncated": False,
                },
            )
        if request.url.path == "/proxy/v1/jobs/workspace-probe" and request.method == "DELETE":
            assert request.url.params["force"] == "true"
            return httpx.Response(200, json={"job_id": "workspace-probe", "deleted": True})
        if request.url.path == "/v1/sandboxes/enterprise-sandbox-1" and request.method == "DELETE":
            assert request.headers["X-Inner-Api-Key"] == "enterprise-secret"
            return httpx.Response(204)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    def async_client_factory(
        *,
        base_url: str,
        headers: dict[str, str],
        timeout: httpx.Timeout,
        follow_redirects: bool = False,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> httpx.AsyncClient:
        del transport
        tracking_transport = _TrackingTransport(handler)
        transports.append(tracking_transport)
        return async_client_type(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
            follow_redirects=follow_redirects,
            transport=tracking_transport,
        )

    monkeypatch.setattr("dify_agent.runtime_backend.enterprise.httpx.AsyncClient", async_client_factory)
    driver = EnterpriseSandboxDriver(
        gateway_endpoint="http://enterprise-gateway",
        auth_token="enterprise-secret",
    )
    spec = SandboxCreateSpec(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        runtime_session_id="session-1",
        home_snapshot_ref="home-1",
    )

    created = await driver.create(spec)
    assert created.handle == "enterprise-sandbox-1"
    assert created.layout.workspace_dir == "/home/dify/workspace"
    await driver.suspend(created)
    resumed = await driver.resume(created.handle)
    assert resumed.handle == created.handle
    assert resumed.layout.workspace_dir == created.layout.workspace_dir
    await driver.suspend(resumed)
    await driver.delete(resumed.handle)

    create_payloads = [payload for method, path, payload in requests if (method, path) == ("POST", "/v1/sandboxes")]
    assert create_payloads == [
        {
            "runtimeSessionId": "session-1",
            "tenantId": "tenant-1",
            "agentId": "agent-1",
            "agentConfigVersionId": "config-1",
            "homeSnapshotRef": "home-1",
        }
    ]
    workspace_probes = [payload for method, path, payload in requests if (method, path) == ("POST", "/proxy/v1/jobs/run")]
    assert workspace_probes
    assert all(cast(dict[str, object], payload)["script"] == "test -d /home/dify/workspace" for payload in workspace_probes)
    methods_and_paths = {(method, path) for method, path, _payload in requests}
    assert ("DELETE", "/proxy/v1/jobs/workspace-probe") in methods_and_paths
    assert ("DELETE", "/v1/sandboxes/enterprise-sandbox-1") in methods_and_paths
    assert transports
    assert all(transport.close_calls == 1 for transport in transports)


@pytest.mark.anyio
async def test_e2b_snapshot_and_workspace_survive_new_driver_instance() -> None:
    api_key = _required_env("DIFY_AGENT_TEST_E2B_API_KEY", "real E2B")
    template = os.environ.get("DIFY_AGENT_TEST_E2B_TEMPLATE", _DEFAULT_E2B_TEMPLATE).strip()
    timeout_seconds = int(os.environ.get("DIFY_AGENT_TEST_E2B_ACTIVE_TIMEOUT_SECONDS", "900"))
    marker = uuid.uuid4().hex
    snapshot_ref: str | None = None
    sandbox_handle: str | None = None
    active_lease: tuple[E2BSandboxDriver, SandboxLease] | None = None
    first_control_plane = E2BSDKControlPlane(api_key=api_key)
    home_driver = E2BHomeSnapshotDriver(
        control_plane=first_control_plane,
        template=template,
        active_timeout_seconds=timeout_seconds,
    )
    first_driver = E2BSandboxDriver(
        control_plane=first_control_plane,
        active_timeout_seconds=timeout_seconds,
    )

    try:
        snapshot_ref = await home_driver.initialize(
            InitializeHomeSnapshotSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                home_snapshot_id=marker,
            )
        )
        first_lease = await first_driver.create(
            SandboxCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                agent_config_version_id=marker,
                runtime_session_id=f"integration-{marker}",
                home_snapshot_ref=snapshot_ref,
            )
        )
        sandbox_handle = first_lease.handle
        active_lease = (first_driver, first_lease)
        await first_lease.files.upload(
            content=b"workspace-persists",
            remote_path=f"{first_lease.layout.workspace_dir}/persisted.txt",
        )
        before_pause = await first_lease.files.read_bytes(
            workspace_dir=first_lease.layout.workspace_dir,
            path="persisted.txt",
            max_bytes=1024,
        )
        assert before_pause.content == b"workspace-persists"
        await first_driver.suspend(first_lease)
        active_lease = None

        second_control_plane = E2BSDKControlPlane(api_key=api_key)
        second_driver = E2BSandboxDriver(
            control_plane=second_control_plane,
            active_timeout_seconds=timeout_seconds,
        )
        resumed = await second_driver.resume(sandbox_handle)
        active_lease = (second_driver, resumed)
        after_resume = await resumed.files.read_bytes(
            workspace_dir=resumed.layout.workspace_dir,
            path="persisted.txt",
            max_bytes=1024,
        )
        assert resumed.handle == sandbox_handle
        assert after_resume.content == b"workspace-persists"
        await second_driver.suspend(resumed)
        active_lease = None
        await second_driver.delete(sandbox_handle)
        sandbox_handle = None
        second_home_driver = E2BHomeSnapshotDriver(
            control_plane=second_control_plane,
            template=template,
            active_timeout_seconds=timeout_seconds,
        )
        await second_home_driver.delete(snapshot_ref)
        snapshot_ref = None
    finally:
        primary_error = sys.exc_info()[0] is not None
        cleanup_errors: list[BaseException] = []
        if active_lease is not None:
            owner, lease = active_lease
            try:
                await owner.suspend(lease)
            except BaseException as exc:
                cleanup_errors.append(exc)
            active_lease = None
        if sandbox_handle is not None:
            try:
                await first_driver.delete(sandbox_handle)
            except BaseException as exc:
                cleanup_errors.append(exc)
            sandbox_handle = None
        if snapshot_ref is not None:
            try:
                await home_driver.delete(snapshot_ref)
            except BaseException as exc:
                cleanup_errors.append(exc)
            snapshot_ref = None
        if cleanup_errors and not primary_error:
            raise cleanup_errors[0]
