"""Native local composition tests; the supervisor kernel proof is a separate CI gate."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from dify_agent.runtime_backend.local import LocalExecutionBindingBackend
from shellctl.shared.schemas import NativeScopeHandle, NativeScopeLimits, NativeScopeSpec


def scope():
    return NativeScopeSpec(
        scope_id="binding-1",
        generation=1,
        binding_ref="binding-1",
        base_snapshot_ref="home-published",
        capability_digest="a" * 64,
        deadline=datetime.now(UTC) + timedelta(seconds=60),
        limits=NativeScopeLimits(
            cpu_quota=10000,
            memory_bytes=64 << 20,
            pids=8,
            fds=32,
            wall_seconds=60,
            input_bytes=1024,
            output_bytes=4096,
            disk_bytes=1 << 20,
        ),
    )


class ScopeClient:
    def __init__(self):
        self.created = []
        self.inspected = []
        self.destroyed = []

    async def create(self, spec):
        self.created.append(spec)
        return NativeScopeHandle(
            scope_id=spec.scope_id, generation=spec.generation, status="ready", token=SecretStr("private")
        )

    async def inspect(self, scope_id, generation):
        self.inspected.append((scope_id, generation))
        return NativeScopeHandle(scope_id=scope_id, generation=generation, status="ready", token=SecretStr("private"))


def spec(native):
    return SimpleNamespace(
        tenant_id="tenant",
        agent_id="agent",
        binding_id="binding-1",
        workspace_id="workspace-1",
        existing_workspace_ref=None,
        home_snapshot_ref="home-published",
        native_test_scope=native,
        native_scope_reconcile=False,
    )


@pytest.mark.anyio
async def test_native_creation_uses_supervisor_not_ordinary_control_jobs():
    client = ScopeClient()

    def no_ordinary_client():
        pytest.fail("native allocation must never run an ordinary bootstrap shell")

    backend = LocalExecutionBindingBackend(
        endpoint="http://runtime", auth_token="private", native_scope_client=client, client_factory=no_ordinary_client
    )
    allocation = await backend.create_binding(spec(scope()))
    assert allocation.binding_ref == "native:binding-1:1"
    assert allocation.workspace_ref == "native:binding-1:1"
    assert len(client.created) == 1
    assert client.created[0].base_snapshot_ref == "home-published"


@pytest.mark.anyio
async def test_native_creation_without_enforcing_supervisor_fails_before_control_io():
    from dify_agent.runtime_backend.errors import BindingCreateError

    backend = LocalExecutionBindingBackend(
        endpoint="http://runtime", auth_token="private", client_factory=lambda: pytest.fail("ordinary fallback")
    )
    with pytest.raises(BindingCreateError, match="native_scope_unavailable"):
        await backend.create_binding(spec(scope()))


def test_lost_job_never_substitutes_another_process():
    from dify_agent.runtime_backend.native_test_scope import AgentJobUnavailable, ShellJobRef, validate_job_identity

    saved = ShellJobRef(
        binding_ref="native:binding-1:1",
        backend_revision="a7-v1",
        workspace_generation=1,
        job_id="job-8",
        output_offset=12,
    )
    with pytest.raises(AgentJobUnavailable):
        validate_job_identity(saved=saved, actual=saved.model_copy(update={"workspace_generation": 4}))
    validate_job_identity(saved=saved, actual=saved.model_copy(update={"output_offset": 18}))


@pytest.mark.anyio
async def test_shell_saves_job_identity_and_reconnects_without_replay():
    from dify_agent.layers.shell.layer import ShellSession
    from dify_agent.runtime_backend.native_test_scope import NativeScopeLease
    from tests.local.dify_agent.layers.shell.test_layer import FakeCommands, _command_result, _layer

    commands = FakeCommands(
        run_handler=lambda *_: _command_result("job-8", offset=12),
        input_handler=lambda job, text, offset, timeout: _command_result(job, offset=18, output="continued"),
    )
    session, _ = _layer(commands=commands)

    def lease(generation=1):
        return NativeScopeLease(
            handle="native:binding-1:1",
            layout=SimpleNamespace(home_dir="/home/dify", workspace_dir="/workspace"),
            client=SimpleNamespace(),
            commands=commands,
            workspace_generation=generation,
        )

    session.deps.resources.leases["runtime"] = lease()
    await session._tool_run("read line", timeout=1)
    assert session.runtime_state.job_refs["job-8"].output_offset == 12
    session.deps.resources.leases["runtime"] = lease()
    reconnected = ShellSession("shell", session.deps)
    result = await reconnected._tool_input("job-8", "hello\n", timeout=1)
    assert "continued" in result
    assert len(commands.run_calls) == 1
    assert commands.input_calls[0].offset == 12
    reconnected.deps.resources.leases["runtime"] = lease(2)
    with pytest.raises(Exception, match="native_job_identity_mismatch"):
        await reconnected._tool_input("job-8", "again\n", timeout=1)
    assert len(commands.run_calls) == 1
    assert len(commands.input_calls) == 1


@pytest.mark.anyio
async def test_marked_runtime_requires_stored_lineage_before_scope_acquire():
    from unittest.mock import AsyncMock

    from dify_agent.layers.runtime.configs import DifyRuntimeLayerConfig
    from dify_agent.layers.runtime.layer import Capability
    from dify_agent.runtime.native_continuation import NativePolicyStopped
    from tests.local.dify_agent.module_support import deps_for

    deps = deps_for("runtime", DifyRuntimeLayerConfig(backend_binding_ref="native:binding-1:1"), {})
    backend = SimpleNamespace(acquire=AsyncMock(), release=AsyncMock())
    deps.services.runtime_backend_profile = SimpleNamespace(execution_bindings=backend)
    deps.native_effects = SimpleNamespace(validate_shell_lineage=None)
    with pytest.raises(NativePolicyStopped, match="native_shell_lineage_unavailable"):
        await Capability("runtime").wrap_run(SimpleNamespace(deps=deps), handler=AsyncMock())
    backend.acquire.assert_not_called()


@pytest.mark.anyio
async def test_native_missing_job_is_terminal_control_not_retryable_model_text():
    from dify_agent.adapters.shell.protocols import ShellProviderError
    from dify_agent.runtime.native_continuation import NativePolicyStopped
    from dify_agent.runtime_backend.native_test_scope import NativeScopeLease
    from tests.local.dify_agent.layers.shell.test_layer import FakeCommands, _command_result, _layer

    def lost(*args):
        raise ShellProviderError("job unavailable")

    commands = FakeCommands(run_handler=lambda *_: _command_result("job-8", offset=12), input_handler=lost)
    session, _ = _layer(commands=commands)
    session.deps.resources.leases["runtime"] = NativeScopeLease(
        handle="native:binding-1:1",
        layout=SimpleNamespace(home_dir="/home/dify", workspace_dir="/workspace"),
        client=SimpleNamespace(),
        commands=commands,
    )
    await session._tool_run("read line", timeout=1)
    with pytest.raises(NativePolicyStopped, match="native_job_unavailable"):
        await session._tool_input("job-8", "hello\n", timeout=1)
    assert len(commands.run_calls) == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "module,name",
    [
        ("enterprise", "EnterpriseExecutionBindingBackend"),
        ("e2b", "E2BExecutionBindingBackend"),
        ("openshell", "OpenShellExecutionBindingBackend"),
    ],
)
async def test_unqualified_backend_stops_before_provider_access(module, name):
    import importlib

    from dify_agent.runtime_backend.errors import BindingAcquireError, BindingCreateError

    backend_type = getattr(importlib.import_module(f"dify_agent.runtime_backend.{module}"), name)
    backend = object.__new__(backend_type)
    with pytest.raises(BindingCreateError, match="native_scope_unavailable"):
        await backend.create_binding(spec(scope()))
    with pytest.raises(BindingAcquireError, match="native_scope_unavailable"):
        await backend.acquire("native:binding-1:1")


@pytest.mark.anyio
async def test_reconcile_only_inspects_reserved_scope_even_when_missing():
    from dify_agent.runtime_backend.errors import BindingCreateError

    client = ScopeClient()
    backend = LocalExecutionBindingBackend(endpoint="http://runtime", auth_token="private", native_scope_client=client)
    request = spec(scope())
    request.native_scope_reconcile = True
    result = await backend.create_binding(request)
    assert result.binding_ref == "native:binding-1:1"
    assert client.inspected == [("binding-1", 1)]
    assert client.created == []

    async def missing(*args):
        raise BindingCreateError("native_scope_unavailable")

    client.inspect = missing
    with pytest.raises(BindingCreateError):
        await backend.create_binding(request)
    assert client.created == []


@pytest.mark.anyio
async def test_wait_keeps_jobs_and_offsets_until_checkpoint_capture():
    from pydantic_ai import DeferredToolRequests

    from dify_agent.layers.shell.layer import Capability, State
    from dify_agent.runtime_backend.native_test_scope import NativeScopeLease
    from tests.local.dify_agent.layers.shell.test_layer import FakeCommands, _command_result, _layer

    commands = FakeCommands(run_handler=lambda *_: _command_result("job-8", offset=12))
    session, _ = _layer(commands=commands)
    session.deps.resources.leases["runtime"] = NativeScopeLease(
        handle="native:binding-1:1",
        layout=SimpleNamespace(home_dir="/home/dify", workspace_dir="/workspace"),
        client=SimpleNamespace(),
        commands=commands,
    )
    await session._tool_run("read line", timeout=1)
    state = session.runtime_state
    state.initialized = True
    session.save_state(state)
    session.deps.native_effects = SimpleNamespace(continuation=SimpleNamespace(job_refs=()))

    async def wait():
        return SimpleNamespace(output=DeferredToolRequests())

    await Capability("shell").wrap_run(SimpleNamespace(deps=session.deps), handler=wait)
    assert commands.delete_calls == []
    assert State.model_validate(session.deps.layers["shell"]["state"]).job_refs["job-8"].output_offset == 12

    async def complete():
        return SimpleNamespace(output="done")

    await Capability("shell").wrap_run(SimpleNamespace(deps=session.deps), handler=complete)
    assert len(commands.delete_calls) == 1
    assert State.model_validate(session.deps.layers["shell"]["state"]).job_refs == {}


@pytest.mark.anyio
async def test_reconnected_input_cannot_substitute_response_job_identity():
    from dify_agent.runtime.native_continuation import NativePolicyStopped
    from dify_agent.runtime_backend.native_test_scope import NativeScopeLease
    from tests.local.dify_agent.layers.shell.test_layer import FakeCommands, _command_result, _layer

    commands = FakeCommands(
        run_handler=lambda *_: _command_result("job-8", offset=12),
        input_handler=lambda *_: _command_result("job-9", offset=18),
    )
    session, _ = _layer(commands=commands)
    session.deps.resources.leases["runtime"] = NativeScopeLease(
        handle="native:binding-1:1",
        layout=SimpleNamespace(home_dir="/home/dify", workspace_dir="/workspace"),
        client=SimpleNamespace(),
        commands=commands,
    )
    await session._tool_run("read line", timeout=1)
    with pytest.raises(NativePolicyStopped, match="native_job_identity_mismatch"):
        await session._tool_input("job-8", "hello\n", timeout=1)
    assert len(commands.run_calls) == 1


def app_client(monkeypatch, token, *, configured_stub=False, legacy_stub=False):
    import base64
    from unittest.mock import AsyncMock

    from fastapi.testclient import TestClient

    from dify_agent.runtime_backend.protocols import RuntimeBackendProfile
    from dify_agent.server.app import create_app
    from dify_agent.server.settings import ServerSettings
    from tests.local.dify_agent.runtime_backend.test_local import _Factory

    monkeypatch.setitem(ServerSettings.model_config, "env_file", None)
    scope_client = ScopeClient()
    scope_client.destroy = AsyncMock()
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://runtime", auth_token="private", native_scope_client=scope_client, client_factory=factory
    )
    profile = RuntimeBackendProfile(
        home_snapshots=SimpleNamespace(create_from_runtime=AsyncMock()), execution_bindings=backend
    )
    monkeypatch.setattr(ServerSettings, "build_runtime_backend_profile", lambda self: profile)
    settings = ServerSettings(api_token=token)
    if configured_stub:
        settings = ServerSettings(
            api_token=token,
            inner_api_key="synthetic-legacy-stub-key" if legacy_stub else None,
            sandbox_files_base_url="http://files.example" if legacy_stub else None,
            agent_stub_api_base_url="http://stub/agent-stub",
            server_secret_key=base64.urlsafe_b64encode(b"x" * 32).rstrip(b"=").decode(),
        )
    app = create_app(settings)
    return TestClient(app), scope_client, factory, profile


@pytest.mark.parametrize(
    "token,header,status",
    [
        (None, None, 502),
        ("service-key", None, 401),
        ("service-key", "Bearer wrong", 401),
        ("service-key", "Bearer service-key", 201),
    ],
)
def test_actual_native_create_router_requires_configured_service_auth(monkeypatch, token, header, status):
    client, scope_client, factory, _ = app_client(monkeypatch, token)
    headers = {"Authorization": header} if header else {}
    request = {
        "tenant_id": "tenant",
        "agent_id": "agent",
        "binding_id": "binding-1",
        "workspace_id": "workspace-1",
        "home_snapshot_ref": "home-published",
        "native_test_scope": scope().model_dump(mode="json"),
    }
    response = client.post("/execution-bindings", json=request, headers=headers)
    assert response.status_code == status
    assert len(scope_client.created) == (1 if status == 201 else 0)
    assert factory.runs == []


def test_actual_ordinary_router_remains_compatible_without_token(monkeypatch):
    client, scope_client, factory, _ = app_client(monkeypatch, None)
    response = client.post(
        "/execution-bindings",
        json={"tenant_id": "tenant", "agent_id": "agent", "binding_id": "binding-1", "workspace_id": "workspace-1"},
    )
    assert response.status_code == 201
    assert factory.runs
    assert not scope_client.created


@pytest.mark.parametrize(
    "path,payload",
    [
        (
            "/execution-bindings/destroy",
            {"binding_ref": "native:binding-1:1", "workspace_ref": "native:binding-1:1", "destroy_workspace": True},
        ),
        (
            "/home-snapshots/from-binding",
            {
                "tenant_id": "tenant",
                "agent_id": "agent",
                "home_snapshot_id": "home",
                "backend_binding_ref": "native:binding-1:1",
            },
        ),
        ("/execution-bindings/files/list", {"backend_binding_ref": "native:binding-1:1", "path": "."}),
    ],
)
def test_existing_native_binding_cannot_downgrade_when_service_auth_removed(monkeypatch, path, payload):
    client, scope_client, factory, _ = app_client(monkeypatch, None)
    response = client.post(path, json=payload)
    assert response.status_code in (400, 404, 409, 502, 503)
    assert scope_client.created == []
    assert scope_client.inspected == []
    scope_client.destroy.assert_not_called()
    assert factory.runs == []


def test_native_home_export_is_refused_before_acquisition_even_with_auth(monkeypatch):
    client, scope_client, factory, profile = app_client(monkeypatch, "service-key")
    response = client.post(
        "/home-snapshots/from-binding",
        headers={"Authorization": "Bearer service-key"},
        json={
            "tenant_id": "tenant",
            "agent_id": "agent",
            "home_snapshot_id": "home",
            "backend_binding_ref": "native:binding-1:1",
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "native_home_export_requires_capability"
    assert not scope_client.inspected
    profile.home_snapshots.create_from_runtime.assert_not_called()
    assert not factory.runs


def test_ordinary_binding_wire_preserves_old_backend_contract():
    from dify_agent.protocol.execution_binding import CreateExecutionBindingRequest

    request = CreateExecutionBindingRequest(
        tenant_id="tenant", agent_id="agent", binding_id="binding", workspace_id="workspace"
    )
    assert "native_test_scope" not in request.model_dump_json()
    assert "native_scope_reconcile" not in request.model_dump_json()


def download_payload(binding_ref):
    return {
        "backend_binding_ref": binding_ref,
        "path": "report.txt",
        "execution_context": {
            "tenant_id": "tenant",
            "user_id": "account",
            "user_from": "account",
            "agent_mode": "workflow_run",
            "invoke_from": "service-api",
        },
    }


@pytest.mark.parametrize(
    "token,header,status",
    [
        (None, None, 409),
        ("service-key", "Bearer service-key", 409),
        ("service-key", None, 401),
        ("service-key", "Bearer wrong", 401),
    ],
)
def test_native_download_refuses_before_stub_token_acquire_or_upload(monkeypatch, token, header, status):
    from unittest.mock import AsyncMock

    from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
    from dify_agent.protocol import BindingFileDownloadRequest

    issued = []

    def issue_token(*args, **kwargs):
        issued.append((args, kwargs))
        raise AssertionError("native export minted an ordinary Agent Stub token")

    monkeypatch.setattr(AgentStubTokenCodec, "encode_connection_token", issue_token)
    client, scope_client, factory, _ = app_client(monkeypatch, token, configured_stub=True)
    acquire = AsyncMock(side_effect=AssertionError("native export acquired a runtime lease"))
    monkeypatch.setattr(LocalExecutionBindingBackend, "acquire", acquire)
    request = BindingFileDownloadRequest.model_validate(download_payload("native:binding-1:1"))
    response = client.post(
        "/execution-bindings/files/download",
        json=request.model_dump(mode="json"),
        headers={"Authorization": header} if header else {},
    )
    assert issued == []
    acquire.assert_not_called()
    assert scope_client.inspected == []
    assert scope_client.created == []
    assert factory.runs == []
    assert response.status_code == status
    if status == 409:
        assert response.json()["detail"]["code"] == "native_file_export_requires_capability"


@pytest.mark.parametrize("token,header", [(None, None), ("service-key", "Bearer service-key")])
def test_ordinary_download_with_configured_stub_still_uploads_once(monkeypatch, token, header):
    import json
    from unittest.mock import AsyncMock

    from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
    from dify_agent.runtime_backend.protocols import RuntimeLayout
    from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease
    from tests.local.dify_agent.server.test_binding_files import _REFERENCE, _Commands

    issued = []
    original = AgentStubTokenCodec.encode_connection_token

    def issue_token(codec, context, *, session_id):
        issued.append((context, session_id))
        return original(codec, context, session_id=session_id)

    monkeypatch.setattr(AgentStubTokenCodec, "encode_connection_token", issue_token)
    client, scope_client, factory, _ = app_client(monkeypatch, token, configured_stub=True, legacy_stub=True)
    commands = _Commands(outputs=[json.dumps({"reference": _REFERENCE, "transfer_method": "tool_file"})])
    runtime_client = SimpleNamespace(close=AsyncMock())
    lease = ShellctlRuntimeLease(
        handle="binding-1:workspace-1",
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace"),
        client=runtime_client,
        commands=commands,
    )
    acquire = AsyncMock(return_value=lease)
    monkeypatch.setattr(LocalExecutionBindingBackend, "acquire", acquire)
    response = client.post(
        "/execution-bindings/files/download",
        json=download_payload("binding-1:workspace-1"),
        headers={"Authorization": header} if header else {},
    )
    assert response.status_code == 200
    assert response.json() == {"reference": _REFERENCE}
    assert len(issued) == 1
    acquire.assert_awaited_once_with("binding-1:workspace-1")
    assert len(commands.calls) == 1
    assert commands.calls[0][0] == "dify-agent file upload --no-download-link /workspace/report.txt"
    assert commands.deletes == ["job-1"]
    runtime_client.close.assert_awaited_once()
    assert scope_client.inspected == []
    assert factory.runs == []


def test_empty_native_job_refs_preserve_legacy_shell_state_wire():
    import json

    from dify_agent.layers.shell.layer import State
    from dify_agent.runtime.modules import snapshot_modules
    from tests.local.dify_agent.layers.shell.test_layer import FakeCommands, _layer

    expected = {"initialized": True, "job_ids": [], "job_offsets": {}}
    state = State.model_validate(expected)
    assert state.model_dump(mode="json") == expected
    assert json.loads(state.model_dump_json()) == expected
    session, _ = _layer(commands=FakeCommands())
    session.save_state(state)
    assert session.deps.layers["shell"]["state"] == expected
    assert snapshot_modules(session.deps).layers["shell"] == expected


@pytest.mark.anyio
async def test_native_job_refs_survive_layer_snapshot_and_reconnect_without_run():
    import json

    from dify_agent.layers.shell.layer import ShellSession, State
    from dify_agent.runtime.modules import snapshot_modules
    from dify_agent.runtime_backend.native_test_scope import NativeScopeLease, ShellJobRef
    from tests.local.dify_agent.layers.shell.test_layer import FakeCommands, _command_result, _layer

    saved = ShellJobRef(
        binding_ref="native:binding-1:1",
        backend_revision="a7-v1",
        workspace_generation=1,
        job_id="job-8",
        output_offset=12,
    )
    state = State(initialized=True, job_ids=["job-8"], job_offsets={"job-8": 12}, job_refs={"job-8": saved})
    restored = State.model_validate_json(state.model_dump_json())
    assert restored.job_refs == {"job-8": saved}
    commands = FakeCommands(
        input_handler=lambda job, text, offset, timeout: _command_result(job, offset=18, output="continued")
    )
    session, _ = _layer(commands=commands)
    session.deps.resources.leases["runtime"] = NativeScopeLease(
        handle=saved.binding_ref,
        layout=SimpleNamespace(home_dir="/home/dify", workspace_dir="/workspace"),
        client=SimpleNamespace(),
        commands=commands,
    )
    session.save_state(restored)
    snapshot = snapshot_modules(session.deps)
    wire = json.loads(snapshot.model_dump_json())
    assert wire["layers"]["shell"]["job_refs"]["job-8"] == saved.model_dump(mode="json")
    session.deps.layers["shell"]["state"] = wire["layers"]["shell"]
    reconnected = ShellSession("shell", session.deps)
    result = await reconnected._tool_input("job-8", "hello\n", timeout=1)
    assert "continued" in result
    assert commands.run_calls == []
    assert len(commands.input_calls) == 1
    assert commands.input_calls[0].offset == 12


@pytest.mark.anyio
async def test_native_legacy_state_without_job_identity_never_sends_stdin():
    from dify_agent.layers.shell.layer import State
    from dify_agent.runtime.native_continuation import NativePolicyStopped
    from dify_agent.runtime_backend.native_test_scope import NativeScopeLease
    from tests.local.dify_agent.layers.shell.test_layer import FakeCommands, _layer

    commands = FakeCommands()
    session, _ = _layer(commands=commands)
    session.deps.resources.leases["runtime"] = NativeScopeLease(
        handle="native:binding-1:1",
        layout=SimpleNamespace(home_dir="/home/dify", workspace_dir="/workspace"),
        client=SimpleNamespace(),
        commands=commands,
    )
    session.save_state(State.model_validate({"initialized": True, "job_ids": ["job-8"], "job_offsets": {"job-8": 12}}))
    with pytest.raises(NativePolicyStopped, match="native_job_identity_missing"):
        await session._tool_input("job-8", "hello\n", timeout=1)
    assert commands.input_calls == []
    assert commands.run_calls == []


@pytest.mark.parametrize("token,header", [(None, None), ("service-key", "Bearer service-key")])
def test_strict_runless_download_refuses_without_owner_before_issuance_or_io(monkeypatch, token, header):
    from typing import cast
    from unittest.mock import AsyncMock

    from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
    from dify_agent.server import binding_files

    issued = []
    original_legacy = AgentStubTokenCodec.encode_connection_token
    original_runtime = AgentStubTokenCodec.encode_runtime_token

    def issue_legacy(codec, *args, **kwargs):
        issued.append("legacy")
        return original_legacy(codec, *args, **kwargs)

    def issue_runtime(codec, *args, **kwargs):
        issued.append("runtime")
        return original_runtime(codec, *args, **kwargs)

    monkeypatch.setattr(AgentStubTokenCodec, "encode_connection_token", issue_legacy)
    monkeypatch.setattr(AgentStubTokenCodec, "encode_runtime_token", issue_runtime)
    client, scope_client, factory, profile = app_client(monkeypatch, token, configured_stub=True)
    acquire = AsyncMock(side_effect=AssertionError("strict runless export acquired a runtime lease"))
    execute = AsyncMock(side_effect=AssertionError("strict runless export started an upload command"))
    monkeypatch.setattr(LocalExecutionBindingBackend, "acquire", acquire)
    monkeypatch.setattr(binding_files, "execute_complete_with_commands", execute)

    response = client.post(
        "/execution-bindings/files/download",
        json=download_payload("binding-1:workspace-1"),
        headers={"Authorization": header} if header else {},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "agent_stub_upload_unavailable"
    assert issued == []
    acquire.assert_not_called()
    execute.assert_not_called()
    assert factory.clients == []
    assert factory.runs == []
    assert scope_client.created == []
    assert scope_client.inspected == []
    cast(AsyncMock, getattr(scope_client, "destroy")).assert_not_called()
    cast(AsyncMock, profile.home_snapshots.create_from_runtime).assert_not_called()
