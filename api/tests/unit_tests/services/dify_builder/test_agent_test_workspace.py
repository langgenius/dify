"""Allocation boundary checks; real SQL locking/concurrency is CI-owned."""

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from tests.unit_tests.services.dify_builder import native_owner_fixtures

operations_service = native_owner_fixtures.operations_service
preparation_sql = native_owner_fixtures.preparation_sql


def test_resource_metadata_cannot_authorize_an_operation(operations_service, sqlite_session):
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import binding, intent

    effect = intent()
    from dataclasses import replace

    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import preparation_owner

    owner = replace(preparation_owner(), bindings={"_agent_workspace_v1": binding(effect).model_dump(mode="json")})
    with pytest.raises(BuilderExecutionPolicyError, match="native_cursor_mismatch"):
        EffectAuthorizationService(operations_service.loader)._binding(sqlite_session, owner, effect)


def test_native_allocation_reservation_preserves_effect_entries():
    from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec

    from models.dify_builder_native_tests import NativeTestInvocation
    from services.dify_builder.native_testing.agent_workspace import AgentWorkspaceAllocation, store_allocation

    row = NativeTestInvocation(
        tenant_id="tenant",
        request_id="request",
        invocation_id="inv",
        active=True,
        bindings={"a" * 64: {"intent_digest": "protected"}},
    )
    scope = NativeScopeSpec(
        scope_id="binding",
        generation=1,
        binding_ref="binding",
        base_snapshot_ref="home",
        capability_digest="b" * 64,
        deadline=datetime.now(UTC) + timedelta(seconds=60),
        limits=NativeScopeLimits(
            cpu_quota=1000,
            memory_bytes=64 << 20,
            pids=8,
            fds=32,
            wall_seconds=60,
            input_bytes=1024,
            output_bytes=4096,
            disk_bytes=1 << 20,
        ),
    )
    allocation = AgentWorkspaceAllocation(
        tenant_id="tenant",
        app_id="app",
        request_id="request",
        invocation_id="inv",
        owner_run_id="run",
        binding_id="binding",
        workspace_id="workspace",
        agent_id="agent",
        pinned_snapshot_id="snapshot",
        home_snapshot_id="home",
        native_scope=scope,
        phase="allocating",
    )
    store_allocation(row, allocation)
    assert row.bindings["a" * 64] == {"intent_digest": "protected"}
    assert row.bindings["_agent_workspace_v1"]["binding_id"] == "binding"


def service_fixture(monkeypatch, sqlite_session, operations_service, invocation_id="inv"):
    from shellctl.shared.schemas import NativeScopeLimits

    from services.agent.workspace_service import AgentWorkspaceService
    from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceService

    ref = NativeTestContextRef(request_id="request", invocation_id=invocation_id, context_digest="c" * 64)
    from models.agent import AgentConfigSnapshot, AgentHomeSnapshot, AgentWorkspace, AgentWorkspaceBinding
    from models.agent_config_entities import AgentSoulConfig
    from models.dify_builder_native_tests import NativeTestInvocation

    session = sqlite_session
    row = NativeTestInvocation(
        tenant_id="tenant",
        request_id=ref.request_id,
        invocation_id=invocation_id,
        active=True,
        bindings={"a" * 64: {"protected": True}},
    )
    if session.get(AgentConfigSnapshot, "snapshot") is None:
        session.add(
            AgentConfigSnapshot(
                id="snapshot",
                tenant_id="tenant",
                agent_id="agent",
                version=1,
                config_snapshot=AgentSoulConfig(),
                home_snapshot_id="home",
            )
        )
        session.add(
            AgentHomeSnapshot(
                id="home",
                tenant_id="tenant",
                agent_id="agent",
                snapshot_ref="home-published",
            )
        )
    session.add(row)
    session.commit()
    session.info["workspace_additions"] = []
    if not session.info.get("observe_workspace_additions"):

        def record_workspace_addition(_session, instance):
            if isinstance(instance, AgentWorkspace | AgentWorkspaceBinding):
                session.info["workspace_additions"].append(instance)

        event.listen(session, "after_attach", record_workspace_addition)
        session.info["observe_workspace_additions"] = True
    from dataclasses import replace

    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import preparation_owner, resolved_context

    owned = replace(preparation_owner(), ref=ref, expires_at=datetime.now(UTC) + timedelta(minutes=5))
    transactions = []
    loader = operations_service.loader

    @contextmanager
    def locked(**kwargs):
        del kwargs
        transactions.append(True)
        try:
            with session.begin():
                yield session, owned, None
        finally:
            transactions.pop()

    monkeypatch.setattr(loader, "locked", locked)
    monkeypatch.setattr(loader, "load", lambda **_kwargs: owned)
    state = operations_service.state_store
    context = resolved_context(
        ref=ref,
        native_run_id="run",
        graph={"nodes": [{"data": {"agent_binding": {"agent_id": "agent", "current_snapshot_id": "snapshot"}}}]},
    )
    monkeypatch.setattr(state, "load_context", lambda **_kwargs: context)
    limits = NativeScopeLimits(
        cpu_quota=1000,
        memory_bytes=64 << 20,
        pids=8,
        fds=32,
        wall_seconds=60,
        input_bytes=1024,
        output_bytes=4096,
        disk_bytes=1 << 20,
    )
    service = AgentTestWorkspaceService(loader, state_store=state, limits=limits)
    requests = []
    from dify_agent.client import Client

    client = Client(base_url="http://agent.invalid")
    session.info["destroy_requests"] = []
    monkeypatch.setattr(
        client, "destroy_execution_binding_sync", lambda request: session.info["destroy_requests"].append(request)
    )

    def create(request):
        from dify_agent.protocol.execution_binding import CreateExecutionBindingResponse

        assert not transactions, "physical I/O under SQL owner lock"
        assert row.bindings["_agent_workspace_v1"]["binding_id"] == request.binding_id
        requests.append(request)
        backend_ref = f"native:{request.binding_id}:1"
        return CreateExecutionBindingResponse(binding_ref=backend_ref, workspace_ref=backend_ref)

    monkeypatch.setattr(client, "create_execution_binding_sync", create)

    @contextmanager
    def backend_client():
        yield client

    monkeypatch.setattr(AgentWorkspaceService, "_client", backend_client)
    return service, ref, row, session, requests, client


def test_prepare_pins_home_and_never_allocates_conversation_or_updates_soul(
    monkeypatch, sqlite_session, operations_service
):
    from models.agent import AgentWorkspace, AgentWorkspaceBinding, AgentWorkspaceOwnerType

    service, ref, row, session, requests, client = service_fixture(monkeypatch, sqlite_session, operations_service)
    result = service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=())
    assert requests[0].home_snapshot_ref == "home-published"
    assert requests[0].native_test_scope.network_targets == ()
    assert row.bindings["a" * 64] == {"protected": True}
    workspace, binding = session.info["workspace_additions"]
    assert isinstance(workspace, AgentWorkspace)
    assert workspace.owner_type == AgentWorkspaceOwnerType.WORKFLOW_RUN
    assert workspace.owner_scope_key == "native:inv"
    assert isinstance(binding, AgentWorkspaceBinding)
    assert binding.base_home_snapshot_id == "home"
    assert service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=()) == result
    assert len(requests) == 1


def test_ambiguous_allocation_reconciles_exact_ids_without_new_create(monkeypatch, sqlite_session, operations_service):
    service, ref, row, session, requests, client = service_fixture(monkeypatch, sqlite_session, operations_service)
    create = client.create_execution_binding_sync

    def lost(request):
        create(request)
        raise TimeoutError("allocation response lost")

    monkeypatch.setattr(client, "create_execution_binding_sync", lost)
    with pytest.raises(TimeoutError):
        service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=())
    assert session.info["workspace_additions"] == []
    monkeypatch.setattr(client, "create_execution_binding_sync", create)
    service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=())
    assert requests[0].binding_id == requests[1].binding_id
    assert requests[0].workspace_id == requests[1].workspace_id
    assert requests[0].native_test_scope == requests[1].native_test_scope
    assert requests[0].native_scope_reconcile is False
    assert requests[1].native_scope_reconcile is True


def test_cross_tenant_or_changed_pin_and_input_import_refuse_before_io(monkeypatch, sqlite_session, operations_service):
    service, ref, row, session, requests, client = service_fixture(monkeypatch, sqlite_session, operations_service)
    with pytest.raises(BuilderExecutionPolicyError, match="native_input_import_requires_capability"):
        service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=("file",))
    assert not requests
    service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=())
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_generation_mismatch"):
        service.prepare(ref=ref, pinned_snapshot_id="other", input_file_refs=())
    row.bindings = {
        **row.bindings,
        "_agent_workspace_v1": {**row.bindings["_agent_workspace_v1"], "tenant_id": "other"},
    }
    session.commit()
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_owner_mismatch"):
        service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=())
    assert len(requests) == 1


def test_cancel_between_physical_allocation_and_finalize_cleans_same_scope(
    monkeypatch, sqlite_session, operations_service
):
    service, ref, row, session, requests, client = service_fixture(monkeypatch, sqlite_session, operations_service)
    original = service.loader.locked
    calls = 0

    @contextmanager
    def cancelled(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise BuilderExecutionPolicyError("native_cancelled")
        with original(**kwargs) as value:
            yield value

    monkeypatch.setattr(service.loader, "locked", cancelled)
    with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
        service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=())
    assert len(session.info["destroy_requests"]) == 1
    cleanup = session.info["destroy_requests"][0]
    assert cleanup.binding_ref == f"native:{requests[0].binding_id}:1"
    assert row.bindings["_agent_workspace_v1"]["phase"] == "retired"
    assert session.info["workspace_additions"] == []


def test_separate_invocations_reserve_distinct_mutable_home_and_workspace_ids(
    monkeypatch, sqlite_session, operations_service
):
    first, ref1, _, _, requests1, _ = service_fixture(monkeypatch, sqlite_session, operations_service)
    home1 = first.prepare(ref=ref1, pinned_snapshot_id="snapshot", input_file_refs=())
    second, ref2, _, _, requests2, _ = service_fixture(
        monkeypatch, sqlite_session, operations_service, invocation_id="inv-2"
    )
    home2 = second.prepare(ref=ref2, pinned_snapshot_id="snapshot", input_file_refs=())
    assert home1.binding_id != home2.binding_id
    assert home1.workspace_id != home2.workspace_id
    assert home1.backend_binding_ref != home2.backend_binding_ref
    assert requests1[0].home_snapshot_ref == requests2[0].home_snapshot_ref == "home-published"


def test_known_native_binding_requires_actual_owned_workspace_rows(monkeypatch, sqlite_session, operations_service):
    service, ref, _, session, requests, _ = service_fixture(monkeypatch, sqlite_session, operations_service)
    result = service.prepare(ref=ref, pinned_snapshot_id="snapshot", input_file_refs=())
    assert service.validate_binding(ref=ref, binding_ref=result.backend_binding_ref) == result
    from sqlalchemy import delete

    from models.agent import AgentWorkspaceBinding

    session.execute(delete(AgentWorkspaceBinding).where(AgentWorkspaceBinding.id == result.binding_id))
    session.commit()
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_owner_mismatch"):
        service.validate_binding(ref=ref, binding_ref=result.backend_binding_ref)
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_owner_mismatch"):
        service.validate_binding(ref=ref, binding_ref="native:foreign:1")
    assert len(requests) == 1
