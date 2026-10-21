"""Actual C03/loader/HTTP owners over SQL, permission and encrypted-object boundary doubles."""

import importlib.util
import json
import traceback
from collections.abc import Callable, Generator
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import NoReturn, Protocol, cast

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from models.model import App
from models.workflow import Workflow
from runtime_contracts.builder.execution import canonical_digest
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.http_binding import (
    NativeHttpBindingResolver,
    build_native_http_profile,
    describe_http_resource,
)
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_owner import create_http_observation_guard
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, native_workflow_revision
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import (
    SENTINEL,
    graph_data,
)
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import context as sample_context


@dataclass
class ObservationOwnerCase:
    store: NativeExecutionStateStore
    shape: str
    loader: OwnedNativeTestLoader
    context: ResolvedNativeTestContext
    request: DifyBuilderExecutionRequest
    local: NativeInvocationState
    workflow: Workflow
    rows: dict[type[object], list[object]]
    events: list[str]
    reads: int = 0
    on_read: Callable[[int], None] | None = None
    notices: list[str] = field(default_factory=list)

    def rebind(self) -> None:
        ref = self.context.ref.model_copy(update={"context_digest": canonical_digest(self.request.context)})
        self.request.context_digest = ref.context_digest
        self.context = self.context.model_copy(update={"ref": ref}, deep=True)


@dataclass
class PretendExecutionState:
    """Deliberately wrong state class with plausible methods, rejected before IO."""

    loader: OwnedNativeTestLoader
    context: ResolvedNativeTestContext

    def load_context(self, **_kwargs: object) -> ResolvedNativeTestContext:
        return self.context


def owner_rows_snapshot(rows: dict[type[object], list[object]]) -> dict[type[object], list[tuple[object, ...]]]:
    """Compare all actual mapped owner values before and after the observation read."""
    snapshot: dict[type[object], list[tuple[object, ...]]] = {}
    for model, values in rows.items():
        mapper = inspect(model)
        assert mapper is not None
        records = []
        for row in values:
            state = inspect(row)
            assert state is not None
            records.append(tuple(state.attrs[column.key].value for column in mapper.column_attrs))
        snapshot[model] = records
    return deepcopy(snapshot)


class GuardFactory(Protocol):
    def __call__(
        self, *, state: NativeExecutionStateStore, context: ResolvedNativeTestContext, on_failure: Callable[[], None]
    ) -> NativeObservationGuard: ...


def owner() -> GuardFactory:
    name = "services.dify_builder.native_testing.observation_owner"
    assert importlib.util.find_spec(name) is not None, "trusted observation owner is missing"
    return create_http_observation_guard


@pytest.fixture
def case(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> ObservationOwnerCase:
    """No database/crypto/RPC claim: real methods read explicitly modeled owner rows."""
    source = sample_context()
    graph, inputs = deepcopy(graph_data(source)), deepcopy(source.inputs)
    try:
        shape = request.param
    except AttributeError:
        shape = "literal_http"
    if shape == "start_end":
        graph.pop("viewport")
        graph["nodes"] = [n for n in graph["nodes"] if n["data"]["type"] != "http-request"]
        graph["nodes"][-1]["data"]["outputs"] = list[object]()
        graph["nodes"][-1]["data"]["title"] = SENTINEL
        graph["edges"] = [{"id": "e1", "source": "start", "target": "end", "sourceHandle": "source"}]
    workflow = Workflow(
        created_by="actor",
        id="workflow",
        app_id="app",
        tenant_id="tenant",
        version="draft",
        type="workflow",
        graph=json.dumps(graph),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
    )
    revision = native_workflow_revision(workflow)
    manifest = tuple(
        describe_http_resource(
            node_id=n["id"], raw=n["data"], workflow_revision=revision, app_id="app", workflow_id="workflow"
        )
        for n in graph["nodes"]
        if n["data"]["type"] == "http-request"
    )
    stored = {
        "policy_version": "builder-native-test-v1",
        "request_id": "request",
        "invocation_id": "invocation",
        "native_run_id": "run",
        "tenant_id": "tenant",
        "actor_id": "actor",
        "app_id": "app",
        "workflow_id": "workflow",
        "session_id": "session",
        "test_input_id": "input",
        "expected_version": 1,
        "execution_revision": revision,
        "input_revision": canonical_digest(inputs),
        "start_schema_hash": "schema",
        "mode": "native",
        "profile": build_native_http_profile().model_dump(mode="json"),
        "resource_manifest_digest": canonical_digest(list(manifest)),
    }
    ref = NativeTestContextRef(
        request_id="request", invocation_id="invocation", context_digest=canonical_digest(stored)
    )
    context = source.model_copy(
        update={"ref": ref, "graph": graph, "graph_revision": revision, "resource_manifest": manifest}, deep=True
    )
    builder_request = DifyBuilderExecutionRequest(
        id="request",
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        context=stored,
        context_digest=ref.context_digest,
        state="running",
    )
    state = NativeInvocationState(
        pending_ids=[],
        resolution=[],
        id="state",
        request_id="request",
        tenant_id="tenant",
        invocation_id="invocation",
        parent_invocation_id=None,
        context_object_id="context",
        app_id="app",
        workflow_id="workflow",
        generation=0,
        state="queued",
    )
    account = Account(name="Test", email="test@example.invalid", status=AccountStatus.ACTIVE)
    account.id = "actor"
    tenant = Tenant(name="Test", status=TenantStatus.NORMAL)
    tenant.id = "tenant"
    rows: dict[type[object], list[object]] = {
        Account: [account],
        Tenant: [tenant],
        TenantAccountJoin: [TenantAccountJoin(tenant_id="tenant", account_id="actor", role=TenantAccountRole.OWNER)],
        App: [App(id="app", tenant_id="tenant", status="normal")],
        Workflow: [workflow],
        DifyBuilderSession: [
            DifyBuilderSession(
                id="session",
                tenant_id="tenant",
                app_id="app",
                owner_account_id="actor",
                entry_mode="new",
                current_state="build.review",
            )
        ],
        DifyBuilderTestInput: [
            DifyBuilderTestInput(
                id="input", session_id="session", inputs=inputs, start_schema_hash="schema", source="mock"
            )
        ],
        DifyBuilderExecutionRequest: [builder_request],
        NativeInvocationState: [state],
        NativeTestScope: [
            NativeTestScope(
                max_calls=16,
                max_dispatches=16,
                max_cost_units=16,
                budget_limits={},
                budget_spent={},
                profile={},
                request_id="request",
                tenant_id="tenant",
                generation=0,
                cancelled=False,
                expires_at=datetime.now(UTC) + timedelta(minutes=20),
                task_approved=True,
            )
        ],
        NativeTestInvocation: [
            NativeTestInvocation(
                request_id="request", tenant_id="tenant", invocation_id="invocation", active=True, bindings={}
            )
        ],
        NativePayloadObject: [
            NativePayloadObject(
                logical_key="context",
                storage_key="private-context",
                payload_digest="a" * 64,
                value_digest="b" * 64,
                id="context",
                request_id="request",
                tenant_id="tenant",
                invocation_id="invocation",
                kind="context",
            )
        ],
    }
    events: list[str] = []
    sql = SQL(rows, events)
    depth = 0

    @contextmanager
    def factory() -> Generator[SQL]:
        nonlocal depth
        depth += 1
        try:
            yield sql
        finally:
            depth -= 1

    def forbidden(*_: object, **__: object) -> NoReturn:
        raise AssertionError("writer/provider/credential I/O forbidden")

    monkeypatch.setattr(factory, "begin", forbidden, raising=False)
    # Protected C03 object readback is the labeled boundary below. Any extra
    # decryption/storage access or real HTTP transport must remain unreachable.
    for path in (
        "core.helper.encrypter.decrypt_token",
        "extensions.ext_storage.storage.load",
        "httpx.Client.send",
        "httpx.AsyncClient.send",
    ):
        monkeypatch.setattr(path, forbidden)

    def permission(actor: Actor, app_id: str, sessions: object) -> None:
        assert depth == 0
        assert actor == Actor(tenant_id="tenant", account_id="actor")
        assert app_id == "app"
        assert sessions is factory
        events.append("permission")

    for path in [
        "services.dify_builder.execution_policy_service.check_execution_permission",
        "services.dify_builder.native_testing.private_reads.check_execution_permission",
        "services.dify_builder.native_testing.http_binding.check_execution_permission",
    ]:
        monkeypatch.setattr(path, permission)
    loader = OwnedNativeTestLoader(
        cast(sessionmaker[Session], factory),
        actor=Actor(tenant_id="tenant", account_id="actor"),
        resolver=NativeHttpBindingResolver(),
    )
    store = NativeExecutionStateStore(loader)
    c = ObservationOwnerCase(
        store=store,
        shape=shape,
        loader=loader,
        context=context,
        request=builder_request,
        local=state,
        workflow=workflow,
        rows=rows,
        events=events,
        reads=0,
        on_read=None,
        notices=[],
    )

    def protected_object(row: NativePayloadObject) -> dict[str, object]:
        assert depth == 0
        assert row.id == "context"
        c.reads += 1
        value = c.context.model_dump(mode="json")
        if c.on_read is not None:
            c.on_read(c.reads)
        return deepcopy(value)

    monkeypatch.setattr(NativeExecutionStateStore, "_read_object", staticmethod(protected_object))

    return c


def test_actual_stored_profile_builds_existing_guard_without_writes_or_effects(case: ObservationOwnerCase) -> None:
    c = case
    before = owner_rows_snapshot(c.rows)
    guard = owner()(state=c.store, context=c.context, on_failure=lambda: c.notices.append("unknown"))
    assert type(guard) is NativeObservationGuard
    assert not guard.failed
    assert SENTINEL not in json.dumps(guard.graph(c.context.graph))
    assert owner_rows_snapshot(c.rows) == before
    assert c.reads == 2
    assert c.events
    with pytest.raises(NativeObservationError):
        guard.fail()
    assert c.notices == ["unknown"]


def _refuses(c: ObservationOwnerCase, **overrides: object) -> None:
    kwargs: dict[str, object] = {
        "state": c.store,
        "context": c.context,
        "on_failure": lambda: c.notices.append("unexpected"),
    }
    kwargs.update(overrides)
    with pytest.raises(NativeObservationError) as error:
        owner()(
            state=cast(NativeExecutionStateStore, kwargs["state"]),
            context=cast(ResolvedNativeTestContext, kwargs["context"]),
            on_failure=cast(Callable[[], None], kwargs["on_failure"]),
        )
    assert str(error.value) == "native_observation_failed"
    assert c.notices == []


@pytest.mark.parametrize(
    "fault", ["missing_profile", "unsupported_profile", "profile_limits", "manifest", "stored_identity"]
)
def test_persisted_server_metadata_must_qualify_without_profile_fallback(
    case: ObservationOwnerCase, fault: str
) -> None:
    c = case
    if fault == "missing_profile":
        c.request.context.pop("profile")
    elif fault == "unsupported_profile":
        c.request.context["profile"]["profile_id"] = "ordinary-profile"
    elif fault == "profile_limits":
        c.request.context["profile"]["limits"]["calls"] = True
    elif fault == "manifest":
        c.request.context["resource_manifest_digest"] = "e" * 64
    else:
        c.request.context["app_id"] = "other-app"
    c.rebind()  # Valid reference digest; the requested composition must inspect stored contents.
    _refuses(c)


@pytest.mark.parametrize(
    ("field", "value"),
    [("generation", 1), ("native_run_id", "other-run"), ("resource_manifest", ()), ("inputs", {"forged": True})],
)
def test_caller_context_cannot_replace_actual_protected_snapshot(
    case: ObservationOwnerCase, field: str, value: dict[str, object] | int | str | tuple[()]
) -> None:
    _refuses(case, context=case.context.model_copy(update={field: value}, deep=True))


@pytest.mark.parametrize(
    "fault",
    ["fake_state", "fake_loader", "missing_context", "membership", "input_owner", "revision", "local_generation"],
)
def test_actual_c03_full_current_owner_chain_is_required(case: ObservationOwnerCase, fault: str) -> None:
    c = case
    if fault == "fake_state":
        _refuses(c, state=PretendExecutionState(c.loader, c.context))
        return
    if fault == "fake_loader":
        c.store.loader = cast(OwnedNativeTestLoader, object())
    elif fault == "missing_context":
        c.rows[NativePayloadObject] = []
    elif fault == "membership":
        c.rows[TenantAccountJoin] = []
    elif fault == "input_owner":
        test_input = c.rows[DifyBuilderTestInput][0]
        assert isinstance(test_input, DifyBuilderTestInput)
        test_input.session_id = "foreign"
    elif fault == "revision":
        c.workflow._features = '{"changed":true}'
    else:
        c.local.generation = 1
    _refuses(c)


@pytest.mark.parametrize(
    "fault", ["profile_first_read", "generation_first_read", "revision_first_read", "input_final_read"]
)
def test_private_read_boundaries_recheck_current_server_metadata_before_return(
    case: ObservationOwnerCase, fault: str
) -> None:
    c = case

    def mutate(count: int) -> None:
        if count == 1 and fault == "profile_first_read":
            c.request.context["profile"]["limits"]["calls"] = 1
        elif count == 1 and fault == "generation_first_read":
            c.local.generation += 1
        elif count == 1 and fault == "revision_first_read":
            c.workflow._features = '{"changed":true}'
        elif count == 2 and fault == "input_final_read":
            test_input = c.rows[DifyBuilderTestInput][0]
            assert isinstance(test_input, DifyBuilderTestInput)
            test_input.inputs = {"changed": True}

    c.on_read = mutate
    _refuses(c)


def test_safe_refusal_never_formats_unknown_payload_or_underlying_error(
    case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    c = case

    class Private:
        def __repr__(self) -> NoReturn:
            raise AssertionError("private repr invoked")

    _refuses(c, context=c.context.model_copy(update={"graph": {"private": Private()}}))

    def denied(*_: object, **__: object) -> NoReturn:
        raise RuntimeError(SENTINEL)

    monkeypatch.setattr("services.dify_builder.execution_policy_service.check_execution_permission", denied)
    with pytest.raises(NativeObservationError) as error:
        owner()(state=c.store, context=c.context, on_failure=lambda: None)
    assert SENTINEL not in "".join(traceback.format_exception(error.value))
    assert SENTINEL not in capsys.readouterr().err


def test_callback_validation_is_owned_by_existing_guard(case: ObservationOwnerCase) -> None:
    _refuses(case, on_failure=True)


@pytest.mark.parametrize("case", ["start_end", "literal_http"], indirect=True)
def test_initial_current_profile_observation_preserves_private_snapshot(case: ObservationOwnerCase) -> None:
    """Real owners over labeled SQL/object doubles; no run, claim or effect."""
    c = case
    # Match actual protected JSON reconstruction, rather than an unchecked DTO copy.
    from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext

    context = ResolvedNativeTestContext.model_validate(c.context.model_dump(mode="json"))
    assert bool(context.resource_manifest) == (c.shape == "literal_http")
    if c.shape == "start_end":
        assert set(context.graph) == {"nodes", "edges"}
        assert [set(node["data"]) for node in graph_data(context)["nodes"]] == [
            {"title", "type", "variables"},
            {"title", "type", "outputs"},
        ]
    before = owner_rows_snapshot(c.rows)
    guard = owner()(state=c.store, context=context, on_failure=lambda: c.notices.append("unknown"))
    assert type(guard) is NativeObservationGuard
    assert not guard.failed
    assert c.reads == 2
    assert owner_rows_snapshot(c.rows) == before
    assert c.notices == []
    projected = json.dumps(guard.graph(context.graph))
    assert SENTINEL not in projected
    assert context.graph == c.context.graph
    assert context.inputs == c.context.inputs


@pytest.mark.parametrize("case", ["start_end", "literal_http"], indirect=True)
@pytest.mark.parametrize("fault", ["membership", "cancelled", "inactive", "terminal", "profile", "manifest"])
def test_initial_current_profile_keeps_owner_active_and_descriptor_guards(
    case: ObservationOwnerCase, fault: str
) -> None:
    c = case
    if fault == "membership":
        c.rows[TenantAccountJoin] = []
    elif fault == "cancelled":
        scope = c.rows[NativeTestScope][0]
        assert isinstance(scope, NativeTestScope)
        scope.cancelled = True
    elif fault == "inactive":
        invocation = c.rows[NativeTestInvocation][0]
        assert isinstance(invocation, NativeTestInvocation)
        invocation.active = False
    elif fault == "terminal":
        c.request.state = "cancelled"
    elif fault == "profile":
        c.request.context["profile"]["implementation_revision"] = "other"
        c.rebind()
    else:
        c.context = c.context.model_copy(update={"resource_manifest": ({"node_id": "invented"},)})
    _refuses(c)


def test_code_stored_profile_requires_current_exact_qualification_owner(case: ObservationOwnerCase) -> None:
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeBindingResolver,
        describe_code_resource,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_code_qualification import (
        qualification,
        raw_code,
    )

    c = case
    q, _ = qualification()
    graph = deepcopy(graph_data(c.context))
    target = next(n for n in graph["nodes"] if n["data"]["type"] == "http-request")
    target["data"] = dict(raw_code())
    c.workflow.graph = json.dumps(graph)
    revision = native_workflow_revision(c.workflow)
    descriptor = describe_code_resource(
        qualification=q,
        node_id=target["id"],
        raw=target["data"],
        workflow_revision=revision,
        app_id=c.workflow.app_id,
        workflow_id=c.workflow.id,
    )
    c.context = c.context.model_copy(
        update={
            "graph": graph,
            "graph_revision": revision,
            "resource_manifest": (descriptor,),
        }
    )
    c.request.context = {
        **c.request.context,
        "execution_revision": revision,
        "profile": q.profile().model_dump(mode="json"),
        "resource_manifest_digest": canonical_digest([descriptor]),
    }
    c.rebind()
    # A stored profile/digest alone cannot select Code.
    _refuses(c)
    c.loader.resolver = NativeCodeBindingResolver(qualification=q)
    guard = owner()(state=c.store, context=c.context, on_failure=lambda: None)
    assert "CANARY" not in json.dumps(guard.graph(graph))
    q.owner.validate = lambda **_kw: (_ for _ in ()).throw(ValueError("revoked private reason"))
    _refuses(c)
