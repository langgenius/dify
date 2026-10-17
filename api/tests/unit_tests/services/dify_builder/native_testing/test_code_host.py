"""Actual retained lifetime and C02 wrapper, external persistence is a double."""

from time import monotonic
from uuid import uuid4

import pytest
from services.dify_builder.native_testing.call_adapter import NativeCallAdapter
from services.dify_builder.native_testing.contracts import ApprovalWait
from services.dify_builder.native_testing.control import (
    NativeApprovalWait,
    NativePolicyStop,
)
from services.dify_builder.native_testing.host_lifetime import (
    NativeHostLifetime,
    NativeHostLifetimeRegistry,
)
from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import REF
from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
    LaunchCase,
)


def code_case():
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

    case = LaunchCase()
    life = NativeHostLifetime(context=case.state.context, dispatch_id=str(uuid4()))
    registry = NativeHostLifetimeRegistry()
    registry.activate(lifetime=life)
    assert case.host._checkpoints is not None
    case.host = NativeHostLaunch(
        context=case.state.context,
        dispatch_id=life.dispatch_id,
        lifetime=life,
        journal=case.journal,
        checkpoints=case.host._checkpoints,
        fence_pending=case.ports.fence_pending,
        stop_sealer=case.ports,
        authorization=case.authorization,
        http_baseline=(1.0, 1.0, 1.0),
    )
    case.lifetime, case.registry = life, registry
    return case


def test_acquisition_requires_exact_current_lifetime_even_with_identical_ids():
    from services.dify_builder.native_testing.sandbox.host import NativeCodeHostOwner

    case = code_case()
    owner = NativeCodeHostOwner(host=case.host, loader=object())
    owner.check_current(owner.acquisition)
    forged = owner.acquisition.model_copy(update={"acquisition_id": str(uuid4())})
    with pytest.raises(ValueError):
        owner.check_current(forged)
    case.registry._current.clear()  # Simulate trusted registry retirement, not a DTO toggle.
    with pytest.raises(ValueError):
        owner.check_current(owner.acquisition)


def test_code_wait_and_replay_do_not_register_participants_or_dispatch():
    from services.dify_builder.native_testing.host_execution import HostBoundCodeCalls

    case = code_case()
    intent = case.prepared().intent.model_copy(update={"kind": "code"})
    calls = HostBoundCodeCalls(
        host=case.host,
        adapter=NativeCallAdapter(
            state=case.state,
            authorization=case.authorization,
            journal=case.journal,
            max_result_bytes=100,
        ),
        allowance=1,
    )
    case.authorization.decisions[0] = ApprovalWait(
        pending_operation_id="pending", wait_reason="approval"
    )
    with pytest.raises(NativeApprovalWait):
        calls.call(
            ref=REF,
            intent=intent,
            dispatch=lambda permit: pytest.fail("wait dispatched"),
        )
    assert not case.lifetime.code_participants
    assert not case.authorization.claimed


def test_registration_before_reservation_is_retained_and_root_limit_is_two():
    from services.dify_builder.native_testing.sandbox.host import NativeCodeHostOwner

    case = code_case()
    owner = NativeCodeHostOwner(host=case.host, loader=object())
    with case.lifetime.call_scope() as ticket, ticket.callback_scope():
        first = owner.register(
            ticket=ticket,
            operation_id=str(uuid4()),
            deadline=monotonic() + 1,
            close_deadline=monotonic() + 2,
        )
        second = owner.register(
            ticket=ticket,
            operation_id=str(uuid4()),
            deadline=monotonic() + 1,
            close_deadline=monotonic() + 2,
        )
        with pytest.raises(ValueError):
            owner.register(
                ticket=ticket,
                operation_id=str(uuid4()),
                deadline=monotonic() + 1,
                close_deadline=monotonic() + 2,
            )
    assert case.lifetime.code_participants == (first, second)
    case.lifetime.request_close(reason="cancel", deadline=monotonic())
    assert case.lifetime.settle() == "unknown"
    with pytest.raises(ValueError):
        case.lifetime.consume_cleanup(
            ref=REF, generation=0, dispatch_id=case.lifetime.dispatch_id
        )
    assert case.lifetime.code_participants == (first, second)


class PhysicalStore:
    """Explicit non-SQL owner double; real adapter/host/bridge/SDK are exercised."""

    def __init__(self, owner, events, *, unknown_failure=False):
        self.owner, self.events, self.unknown_failure = owner, events, unknown_failure
        self.row = None

    def reserve_scope(self, **kwargs):
        from types import SimpleNamespace

        assert self.owner.host.lifetime.code_participants
        self.events.append("reserve_scope")
        assert self.row is None
        native = kwargs["spec"].native.model_copy(
            update={
                "deadline": kwargs.get(
                    "physical_deadline", kwargs["spec"].native.deadline
                )
            }
        )
        from services.dify_builder.execution_contracts import canonical_digest

        self.row = SimpleNamespace(
            scope_expires_at=native.deadline,
            scope_spec_digest=canonical_digest(native.model_dump(mode="json")),
            operation_id=kwargs["permit"].operation_id,
            ref=kwargs["ref"],
            scope_id=kwargs["spec"].native.scope_id,
            scope_generation=1,
            destroyed_at=None,
        )
        return self.row

    def bind(self, **kwargs):
        return self

    def assert_claim(self, identity):
        self.owner.check_current(self.owner.acquisition)
        assert self.row is not None
        assert identity.operation_ref == self.row.operation_id

    def reserve_dispatch(self, identity, **kwargs):
        assert "reserve_job" not in self.events
        self.events.append("reserve_job")

    def associate_job(self, identity, job_id):
        assert job_id == "job1"
        self.events.append("associate")

    def ack_scope(self, **kwargs):
        self.events.append("scope_ack")

    def observe_output(self, **kwargs):
        assert (kwargs["job_id"], kwargs["expected_offset"], kwargs["next_offset"]) == (
            "job1",
            0,
            2,
        )
        self.events.append("offset")

    def mark_unknown(self, *args, **kwargs):
        self.events.append("unknown")
        if self.unknown_failure:
            raise ValueError("SQL unavailable")

    def ack_destroyed(self, **kwargs):
        from datetime import UTC, datetime

        assert self.row is not None
        self.row.destroyed_at = datetime.now(UTC)
        self.events.append("destroy_ack")

    def load_for_settlement(self, **kwargs):
        assert kwargs["acquisition"] == self.owner.acquisition
        return self.row


def composed(case, monkeypatch, *, failure=None, logical_seconds=5):
    import contextlib
    from datetime import UTC, datetime, timedelta

    import httpx
    from services.code_execution.native_scope_transport import (
        NativeCodeBounds,
        NativeCodeProfile,
    )
    from services.dify_builder.native_testing.host_execution import HostBoundCodeCalls
    from services.dify_builder.native_testing.sandbox import scope_client
    from services.dify_builder.native_testing.sandbox.contracts import CodeScopeSpec
    from services.dify_builder.native_testing.sandbox.host import (
        HostNativeCodeTransport,
        NativeCodeHostOwner,
    )
    from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec

    events = []
    owner = NativeCodeHostOwner(host=case.host, loader=object())
    from services.dify_builder.native_testing.sandbox import host as host_module

    store = PhysicalStore(owner, events, unknown_failure=failure == "unknown")
    monkeypatch.setattr(
        host_module, "NativeCodePhysicalRepository", lambda *args, **kwargs: store
    )
    calls = HostBoundCodeCalls(
        host=case.host,
        adapter=NativeCallAdapter(
            state=case.state,
            authorization=case.authorization,
            journal=case.journal,
            max_result_bytes=100,
        ),
        allowance=2,
    )
    intent = case.prepared().intent.model_copy(update={"kind": "code"})
    scope_id = "code_" + "a" * 32
    spec = CodeScopeSpec(
        native=NativeScopeSpec(
            scope_id=scope_id,
            generation=1,
            binding_ref="binding",
            base_snapshot_ref="empty",
            capability_digest="c" * 64,
            deadline=datetime.now(UTC) + timedelta(seconds=logical_seconds),
            limits=NativeScopeLimits(
                cpu_quota=1000,
                memory_bytes=64 << 20,
                pids=8,
                fds=32,
                wall_seconds=5,
                input_bytes=4096,
                output_bytes=4096,
                disk_bytes=1 << 20,
            ),
        ),
        environment_digest="e" * 64,
        base_snapshot_digest="b" * 64,
    )
    prefix = "/v1/test-scopes/" + scope_id

    def request(method, url, **kwargs):
        path = httpx.URL(url).path
        events.append((method, path))
        assert kwargs["max_retries"] == 0 and kwargs["follow_redirects"] is False
        if method == "DELETE":
            body = {"status": "missing" if failure == "destroy" else "destroyed"}
        elif path == "/v1/test-scopes" or path == prefix:
            if failure in ("create", "unknown"):
                raise ValueError("scope create ACK lost")
            body = {
                "scope_id": scope_id,
                "generation": 1,
                "status": "ready",
                "token": "scope-secret",
            }
        elif path.endswith("/run"):
            assert "reserve_job" in events
            body = {
                "job_id": "job1",
                "done": False,
                "status": "running",
                "output_path": "out",
                "output": "",
                "offset": 0,
                "truncated": False,
            }
            if failure == "job":
                raise ValueError("job ACK lost")
        elif path.endswith("/input"):
            assert "associate" in events
            if failure == "input":
                raise ValueError("input ACK lost")
            body = {
                "job_id": "job1",
                "done": True,
                "status": "exited",
                "exit_code": 0,
                "output_path": "out",
                "output": "ok",
                "offset": 2,
                "truncated": False,
            }
        elif path.endswith("/job1"):
            body = {
                "job_id": "job1",
                "status": "exited",
                "done": True,
                "exit_code": 0,
                "created_at": "now",
                "offset": 2,
            }
        else:
            raise AssertionError(path)
        return httpx.Response(200, json=body)

    monkeypatch.setattr(scope_client.ssrf_proxy, "make_request", request)
    monkeypatch.setattr(
        scope_client, "sensitive_http_telemetry", contextlib.nullcontext
    )

    def dispatch(permit):
        return HostNativeCodeTransport(
            owner=owner,
            calls=calls,
            ref=REF,
            intent=intent,
            permit=permit,
            spec=spec,
            profile=NativeCodeProfile("python3", "/usr/bin/python3", "e" * 64),
            bounds=NativeCodeBounds(0.5, 4096, 2, 4096, 0.25),
            endpoint="http://scope.internal:9000",
            auth_token="control-secret",
            create_seconds=0.1,
            join_seconds=0.1,
        ).execute(language="python3", preload="", code="print('ok')")

    return calls, intent, dispatch, owner, events, prefix


def test_real_adapter_sdk_loop_scope_destruction_precedes_c02_completion(monkeypatch):
    case = code_case()
    calls, intent, dispatch, _owner, events, prefix = composed(case, monkeypatch)
    assert calls.call(ref=REF, intent=intent, dispatch=dispatch) == "ok"
    (operation,) = case.lifetime.code_participants
    assert operation.cleanup_complete
    assert events.index("reserve_scope") < events.index(("POST", "/v1/test-scopes"))
    assert events.index("scope_ack") < events.index("reserve_job")
    assert events.index("associate") < events.index(
        ("POST", prefix + "/jobs/job1/input")
    )
    assert (
        events.index("offset")
        < events.index(("DELETE", prefix))
        < events.index("destroy_ack")
    )
    assert case.authorization.outcomes[0][0] == "completed"


@pytest.mark.parametrize("failure", ["create", "job", "input", "destroy", "unknown"])
def test_uncertain_ack_never_creates_again_or_resends_input_and_attempts_destroy(
    monkeypatch, failure
):
    case = code_case()
    calls, intent, dispatch, _owner, events, prefix = composed(
        case, monkeypatch, failure=failure
    )
    with pytest.raises(NativePolicyStop):
        calls.call(ref=REF, intent=intent, dispatch=dispatch)
    assert case.authorization.outcomes[0][0] == "unknown"
    assert events.count(("POST", "/v1/test-scopes")) == 1
    assert events.count(("POST", prefix + "/jobs/job1/input")) <= 1
    assert events.count(("DELETE", prefix)) == 1
    if failure == "destroy":
        assert not case.lifetime.code_participants[0].cleanup_complete


def test_successful_code_cleanup_is_consumed_only_after_actual_host_worker_exit(
    monkeypatch,
):
    from tests.unit_tests.services.dify_builder.native_testing.test_host_lifetime import (
        worker,
    )

    case = code_case()
    calls, intent, dispatch, owner, _events, _prefix = composed(case, monkeypatch)
    worker(case.lifetime).join(1)
    assert calls.call(ref=REF, intent=intent, dispatch=dispatch) == "ok"
    case.lifetime.request_close(reason="exhausted", deadline=monotonic() + 1)
    assert case.lifetime.settle() == "settled"
    case.lifetime.consume_cleanup(
        ref=REF, generation=0, dispatch_id=case.lifetime.dispatch_id
    )
    assert not case.lifetime.code_participants
    assert owner._operations == {}
    with pytest.raises(ValueError):
        case.lifetime.consume_cleanup(
            ref=REF, generation=0, dispatch_id=case.lifetime.dispatch_id
        )


def test_recorded_code_replay_creates_no_additional_scope_or_participant(monkeypatch):
    from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import (
        INPUT,
        PATH,
    )

    case = code_case()
    calls, intent, dispatch, _owner, events, _prefix = composed(case, monkeypatch)
    assert calls.call(ref=REF, intent=intent, dispatch=dispatch) == "ok"
    before = tuple(events)
    cursor = case.journal.open(ref=REF, occurrence_path=PATH)
    cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    replay = intent.model_copy(update={"key": cursor.next_key()})
    assert (
        calls.call(
            ref=REF, intent=replay, dispatch=lambda _: pytest.fail("replay dispatched")
        )
        == "ok"
    )
    assert tuple(events) == before
    assert len(case.lifetime.code_participants) == 1


def test_same_operation_cannot_replace_retained_repository_after_uncertain_reservation():
    from services.dify_builder.native_testing.sandbox.host import NativeCodeHostOwner

    case = code_case()
    owner = NativeCodeHostOwner(host=case.host, loader=object())
    operation_id = str(uuid4())
    with case.lifetime.call_scope() as ticket, ticket.callback_scope():
        first = owner.register(
            ticket=ticket,
            operation_id=operation_id,
            deadline=monotonic() + 1,
            close_deadline=monotonic() + 2,
        )
        with pytest.raises(ValueError):
            owner.register(
                ticket=ticket,
                operation_id=operation_id,
                deadline=monotonic() + 1,
                close_deadline=monotonic() + 2,
            )
    assert owner._operations[operation_id] is first
    with pytest.raises(ValueError):
        NativeCodeHostOwner(host=case.host, loader=object())


@pytest.mark.parametrize(
    "create,join",
    [(float("nan"), 1), (5, float("inf")), (0, 1), (5, 0), (6, 1), (5, 2), (True, 1)],
)
def test_transport_requires_finite_separate_bounded_create_and_join(create, join):
    from services.dify_builder.native_testing.sandbox.host import (
        HostNativeCodeTransport,
    )

    with pytest.raises(ValueError, match="budget_invalid"):
        HostNativeCodeTransport(
            owner=None,
            calls=None,
            ref=None,
            intent=None,
            permit=None,
            spec=None,
            profile=None,
            bounds=None,
            endpoint="",
            auth_token="",
            create_seconds=create,
            join_seconds=join,
        )


def test_insufficient_reserved_cleanup_and_join_refuses_before_reservation(monkeypatch):
    case = code_case()
    calls, intent, dispatch, owner, events, _ = composed(case, monkeypatch)
    calls._allowance = 0.5  # Exactly the two 0.25 cleanup phases, no join/create/exec.
    with pytest.raises(NativePolicyStop):
        calls.call(ref=REF, intent=intent, dispatch=dispatch)
    assert not owner._operations and "reserve_scope" not in events


def test_late_create_reply_never_reserves_job_and_destroys_original_scope(monkeypatch):
    from time import sleep

    from services.dify_builder.native_testing.sandbox import scope_client

    case = code_case()
    calls, intent, dispatch, owner, events, prefix = composed(case, monkeypatch)
    request = scope_client.ssrf_proxy.make_request

    def late(method, url, **kwargs):
        if method == "POST" and url.endswith("/v1/test-scopes"):
            sleep(
                0.12
            )  # Origin I/O cannot be preempted; native create allowance is 0.1.
        return request(method, url, **kwargs)

    monkeypatch.setattr(scope_client.ssrf_proxy, "make_request", late)
    with pytest.raises(NativePolicyStop):
        calls.call(ref=REF, intent=intent, dispatch=dispatch)
    assert "reserve_job" not in events and ("DELETE", prefix) in events
    (operation,) = owner._operations.values()
    assert not operation.bridge._created
    assert operation.bridge.joined and operation.bridge.loop_closed
    assert case.lifetime.unknown


def test_long_logical_expiry_sends_persisted_a7_compatible_wire_deadline(monkeypatch):
    import json
    from datetime import UTC, datetime

    from services.dify_builder.execution_contracts import canonical_digest
    from services.dify_builder.native_testing.sandbox import scope_client

    case = code_case()
    calls, intent, dispatch, owner, _events, _ = composed(
        case, monkeypatch, logical_seconds=300
    )
    request = scope_client.ssrf_proxy.make_request
    observed = []

    def checked(method, url, **kwargs):
        if method == "POST" and url.endswith("/v1/test-scopes"):
            wire = json.loads(kwargs["content"])
            expiry = datetime.fromisoformat(wire["deadline"])
            # Exact Go Validate boundary, without importing/running a backend.
            assert (
                0
                < (expiry - datetime.now(UTC)).total_seconds()
                <= wire["limits"]["wall_seconds"]
            )
            operation = next(iter(owner._operations.values()))
            assert expiry == operation.physical.scope_expires_at
            assert canonical_digest(wire) == operation.physical.scope_spec_digest
            observed.append(wire)
        return request(method, url, **kwargs)

    monkeypatch.setattr(scope_client.ssrf_proxy, "make_request", checked)
    assert calls.call(ref=REF, intent=intent, dispatch=dispatch) == "ok"
    assert len(observed) == 1


@pytest.mark.parametrize("damage", ["digest", "expired", "cleanup_only", "extended"])
def test_invalid_or_short_persisted_deadline_never_creates_or_claims_cleanup(
    monkeypatch, damage
):
    from datetime import UTC, datetime, timedelta

    from services.dify_builder.execution_contracts import canonical_digest

    original = PhysicalStore.reserve_scope

    def altered(store, **kwargs):
        row = original(store, **kwargs)
        if damage == "digest":
            row.scope_spec_digest = "0" * 64
        else:
            row.scope_expires_at = datetime.now(UTC) + timedelta(
                seconds=-1
                if damage == "expired"
                else (60 if damage == "extended" else 0.6)
            )
            native = kwargs["spec"].native.model_copy(
                update={"deadline": row.scope_expires_at}
            )
            row.scope_spec_digest = canonical_digest(native.model_dump(mode="json"))
        return row

    monkeypatch.setattr(PhysicalStore, "reserve_scope", altered)
    case = code_case()
    calls, intent, dispatch, owner, events, _ = composed(case, monkeypatch)
    with pytest.raises(NativePolicyStop):
        calls.call(ref=REF, intent=intent, dispatch=dispatch)
    assert not any(isinstance(e, tuple) and e[0] == "POST" for e in events)
    operation = next(iter(owner._operations.values()))
    assert operation.physical.destroyed_at is None and not operation.cleanup_complete
    assert "destroy_ack" not in events


def test_sql_elapsed_time_uses_original_clock_pair_without_extending_phases(
    monkeypatch,
):
    from datetime import datetime
    from time import sleep

    from services.dify_builder.native_testing.sandbox import host as module
    from services.dify_builder.native_testing.sandbox import scope_client

    calls_to_utc = []

    class Clock:
        fromisoformat = staticmethod(datetime.fromisoformat)

        @classmethod
        def now(cls, tz=None):
            calls_to_utc.append(None)
            return datetime.now(tz)

    monkeypatch.setattr(module, "datetime", Clock)
    original = PhysicalStore.reserve_scope
    admitted = []

    def delayed(store, **kwargs):
        row = original(store, **kwargs)
        operation = next(iter(store.owner._operations.values()))
        admitted.append(
            (
                operation.bridge.join_deadline,
                operation.bridge.close_deadline,
                operation.bridge.deadline,
                operation.bridge.create_deadline,
            )
        )
        sleep(0.02)
        return row

    monkeypatch.setattr(PhysicalStore, "reserve_scope", delayed)
    case = code_case()
    calls, intent, dispatch, owner, _events, _ = composed(case, monkeypatch)
    request = scope_client.ssrf_proxy.make_request
    checked = []

    def check(method, url, **kwargs):
        if method == "POST" and url.endswith("/v1/test-scopes"):
            operation = next(iter(owner._operations.values()))
            b = operation.bridge
            assert all(
                after <= before
                for after, before in zip(
                    (b.join_deadline, b.close_deadline, b.deadline, b.create_deadline),
                    admitted[0],
                    strict=True,
                )
            )
            assert b.join_deadline - b.close_deadline >= 0.099999
            assert b.close_deadline - b.deadline >= 0.499999
            checked.append(None)
        return request(method, url, **kwargs)

    monkeypatch.setattr(scope_client.ssrf_proxy, "make_request", check)
    assert calls.call(ref=REF, intent=intent, dispatch=dispatch) == "ok"
    assert len(checked) == 1 and len(calls_to_utc) == 1


def test_clock_sampling_delay_cannot_add_time_to_persisted_physical_allowance(monkeypatch):
    from datetime import datetime
    from time import sleep

    from services.dify_builder.native_testing.sandbox import host as module
    from services.dify_builder.native_testing.sandbox import scope_client

    sampled = []

    class Clock:
        fromisoformat = staticmethod(datetime.fromisoformat)

        @staticmethod
        def now(tz=None):
            value = datetime.now(tz)
            sampled.append((monotonic(), value))
            sleep(0.02)  # Time passes between receiving UTC and sampling monotonic.
            return value

    monkeypatch.setattr(module, "datetime", Clock)
    case = code_case()
    calls, intent, dispatch, owner, _events, _ = composed(case, monkeypatch)
    request = scope_client.ssrf_proxy.make_request
    checked = []

    def check(method, url, **kwargs):
        if method == "POST" and url.endswith("/v1/test-scopes"):
            operation = next(iter(owner._operations.values()))
            mono, utc = sampled[0]
            ceiling = mono + (operation.physical.scope_expires_at - utc).total_seconds()
            assert operation.bridge.join_deadline <= ceiling + 0.001
            checked.append(None)
        return request(method, url, **kwargs)

    monkeypatch.setattr(scope_client.ssrf_proxy, "make_request", check)
    assert calls.call(ref=REF, intent=intent, dispatch=dispatch) == "ok"
    assert len(checked) == len(sampled) == 1
