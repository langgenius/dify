"""Real C03 codec/store logic with explicit SQL-loader and encrypted-storage stand-ins.

These unit doubles model transaction rollback and ordering, not PostgreSQL locks,
real encryption, actual Graphon identity, or authorization-owner qualification.
"""

from __future__ import annotations

import copy
import json
import warnings
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import NoReturn, cast

import pytest
from sqlalchemy import Select, inspect

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import JsonValue, NativeTestContextRef, OperationKey, operation_digest
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing import state_store as module
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader

NATIVE_ID = "81d492fd-05ce-46a8-8c82-a35d4b343d48"
CANARY = "private-input-canary-982314"


class SQLStandIn:
    def __init__(self, owner: LoaderStandIn) -> None:
        self.owner = owner

    def scalar[T](self, query: Select[tuple[T]]) -> T | None:
        entity = query.column_descriptions[0]["entity"]
        if entity is NativeInvocationState:
            return cast(T, self.owner.state)
        if entity is NativePayloadObject:
            filters = {key.rsplit("_", 1)[0]: value for key, value in query.compile().params.items()}
            return cast(
                T | None,
                next(
                    (
                        row
                        for row in self.owner.rows
                        if all(inspect(row).attrs[key].value == value for key, value in filters.items())
                    ),
                    None,
                ),
            )
        raise AssertionError("unexpected SQL entity")

    def scalars(self, query: Select[tuple[object, ...]]) -> list[NativeInvocationState] | list[str]:
        entity = query.column_descriptions[0]["entity"]
        if entity is NativeInvocationState:
            return [self.owner.state, *self.owner.ancestors]
        if entity is NativeTestInvocation:
            return [self.owner.ref.invocation_id, *self.owner.active_ancestors]
        raise AssertionError("unexpected SQL entities")

    def get[T](self, model: type[T], identity: object, *, populate_existing: bool = False) -> T | None:
        del populate_existing
        assert model is DifyBuilderExecutionRequest
        assert identity == self.owner.ref.request_id
        return cast(T, self.owner.request)

    def add(self, row: NativePayloadObject) -> None:
        self.owner.rows.append(row)

    def flush(self) -> None:
        if self.owner.fail_flush:
            raise OSError(CANARY)


class LoaderStandIn:
    def __init__(self) -> None:
        self.ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
        self.state = NativeInvocationState(
            pending_ids=[],
            resolution=[],
            tenant_id="tenant",
            request_id="request",
            invocation_id="inv",
            app_id="app",
            workflow_id="workflow",
            parent_invocation_id=None,
            context_object_id="context",
            generation=0,
            state="running",
        )
        self.scope = NativeTestScope(
            request_id="request",
            tenant_id="tenant",
            max_calls=100,
            max_dispatches=100,
            max_cost_units=100,
            generation=0,
            task_approved=True,
            budget_limits={},
            budget_spent={},
            profile={},
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
            cancelled=False,
        )
        self.request = DifyBuilderExecutionRequest(
            id="request",
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            actor_id="actor",
            session_id="session",
            test_input_id="input",
            context_digest=self.ref.context_digest,
            context={"native_run_id": "run", "mode": "native"},
            native_run_id=None,
        )
        self.owned = OwnedNativeTest(
            session_id="session",
            test_input_id="input",
            bindings={},
            task_approved=True,
            revision_context=None,
            ref=self.ref,
            tenant_id="tenant",
            actor_id="actor",
            app_id="app",
            workflow_id="workflow",
            generation=0,
            expires_at=self.scope.expires_at,
            state="running",
        )
        self.rows: list[NativePayloadObject] = []
        self.ancestors: list[NativeInvocationState] = []
        self.active_ancestors: list[str] = []
        self.writing = False
        self.active = True
        self.before_lock: Callable[[], None] = lambda: None
        self.fail_commit = False
        self.fail_flush = False

    def load(self, *, ref: NativeTestContextRef) -> OwnedNativeTest:
        if ref != self.ref:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        if self.scope.cancelled:
            raise BuilderExecutionPolicyError("native_cancelled")
        if not self.active:
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        if self.owned.state not in {"running", "waiting"}:
            raise BuilderExecutionPolicyError("native_request_terminal")
        return self.owned

    def _load(
        self, session: SQLStandIn, *, ref: NativeTestContextRef, lock: bool = False
    ) -> tuple[OwnedNativeTest, NativeTestScope]:
        assert isinstance(session, SQLStandIn)
        assert not lock
        return self.load(ref=ref), self.scope

    @contextmanager
    def session_factory(self) -> Generator[SQLStandIn]:
        assert not self.writing
        yield SQLStandIn(self)

    @contextmanager
    def locked(self, *, ref: NativeTestContextRef) -> Generator[tuple[SQLStandIn, OwnedNativeTest, NativeTestScope]]:
        self.before_lock()
        owned = self.load(ref=ref)
        old_rows = self.rows.copy()
        self.writing = True
        try:
            yield SQLStandIn(self), owned, self.scope
            if self.fail_commit:
                raise OSError(CANARY)
        except Exception:
            self.rows = old_rows
            raise
        finally:
            self.writing = False


@dataclass
class NodeInputsCase:
    store: module.NativeExecutionStateStore
    loader: LoaderStandIn
    ref: NativeTestContextRef
    context: ResolvedNativeTestContext
    workflow: Workflow
    events: list[str]
    after_readback: list[Callable[[], None]]
    blobs: dict[str, bytes]


def ancestor_state(invocation_id: str, state: str) -> NativeInvocationState:
    return NativeInvocationState(
        tenant_id="tenant",
        request_id="request",
        invocation_id=invocation_id,
        context_object_id="ancestor-context",
        generation=0,
        state=state,
        pending_ids=[],
        resolution=[],
    )


@pytest.fixture
def case(monkeypatch: pytest.MonkeyPatch) -> NodeInputsCase:
    loader = LoaderStandIn()
    context = ResolvedNativeTestContext(
        ref=loader.ref,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        graph={"nodes": []},
        inputs={},
        graph_revision="revision",
        input_revision=canonical_digest({}),
        resource_manifest=(),
        generation=0,
        root_native_run_id="run",
        native_run_id="run",
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="request",
        cancellation_ref="request",
        execution_mode="native",
    )
    workflow = Workflow(graph=json.dumps(context.graph))
    blobs: dict[str, bytes] = {}
    events: list[str] = []
    after_readback = [lambda: None]

    def save(key: str, data: bytes) -> None:
        assert not loader.writing, "storage inside write transaction"
        events.append("save")
        blobs[key] = data

    def load(key: str) -> bytes:
        assert not loader.writing, "storage inside write transaction"
        events.append("load")
        value = blobs[key]
        after_readback[0]()
        return value

    def encrypt(tenant: str, raw: str) -> str:
        assert tenant == "tenant"
        assert not loader.writing
        return raw.encode().hex()

    def decrypt(tenant: str, raw: str) -> str:
        assert tenant == "tenant"
        assert not loader.writing
        return bytes.fromhex(raw).decode()

    def private_read(owner: LoaderStandIn, ref: NativeTestContextRef) -> PrivateReadOwner:
        owner.load(ref=ref)
        assert loader.state.app_id is not None
        assert loader.state.workflow_id is not None
        return PrivateReadOwner(
            tenant_id="tenant",
            actor_id="actor",
            app_id=loader.state.app_id,
            workflow_id=loader.state.workflow_id,
            parent_invocation_id=loader.state.parent_invocation_id,
            context_object_id=loader.state.context_object_id,
            generation=loader.state.generation,
            graph_revision="revision",
            root_revision_matches=True,
            input_revision=canonical_digest({}),
            expires_at=loader.scope.expires_at,
            cancelled=loader.scope.cancelled,
            active=loader.active,
            request_state=loader.owned.state,
        )

    monkeypatch.setattr(module.storage, "save", save)
    monkeypatch.setattr(module.storage, "load", load)
    monkeypatch.setattr(module.encrypter, "encrypt_token", encrypt)
    monkeypatch.setattr(module.encrypter, "decrypt_token", decrypt)
    monkeypatch.setattr(module, "validate_private_read", private_read)
    monkeypatch.setattr(module, "validate_invocation_workflow", lambda *_args, **_kwargs: workflow)
    monkeypatch.setattr(module, "native_workflow_revision", lambda _workflow: "revision")
    store = module.NativeExecutionStateStore(cast(OwnedNativeTestLoader, loader))
    receipt = store.prepare_object(
        ref=loader.ref,
        tenant_id="tenant",
        kind="context",
        logical_key="context",
        payload=context.model_dump(mode="json"),
    )
    row = module.NativePayloadObject(**vars(receipt))
    loader.rows.append(row)
    loader.state.context_object_id = row.id
    events.clear()
    return NodeInputsCase(
        store=store,
        loader=loader,
        ref=loader.ref,
        context=context,
        workflow=workflow,
        events=events,
        after_readback=after_readback,
        blobs=blobs,
    )


def persist(case: NodeInputsCase, inputs: object) -> str:
    """Pass malformed JSON unchanged to exercise the runtime validation boundary."""
    method = case.store.store_node_inputs
    assert callable(method), "independent node input persistence is unavailable"
    return method(ref=case.ref, generation=0, native_execution_id=NATIVE_ID, inputs=cast(JsonValue, inputs))


@pytest.mark.parametrize("value", [True, "true", [1, None], "[1,null]", None, 1.5, {"file": {"ref": "file-id"}}])
def test_typed_inputs_roundtrip_in_independent_namespace(
    case: NodeInputsCase, value: None | bool | dict[str, object] | float | list[None | int] | str
) -> None:
    result_ref = persist(case, value)
    assert not case.loader.writing
    assert case.store.load_result(ref=case.ref, result_ref=result_ref) == value
    row = next(row for row in case.loader.rows if row.id == result_ref)
    assert (row.kind, row.logical_key) == ("result", "node-input:" + NATIVE_ID)
    key = OperationKey(invocation_id="inv", occurrence_path=(NATIVE_ID,), cursor=0)
    assert row.logical_key != operation_digest(key)
    effect = case.store.prepare_object(
        ref=case.ref, tenant_id="tenant", kind="result", logical_key=operation_digest(key), payload={"completed": True}
    )
    with case.loader.locked(ref=case.ref) as (session, _, _):
        effect_ref = case.store.acknowledge_object(session, effect).id
    assert effect_ref != result_ref
    assert case.store.load_result(ref=case.ref, result_ref=effect_ref) == {"completed": True}


@pytest.mark.parametrize(("first", "changed"), [(True, "true"), ([1, None], "[1,null]"), (None, "null"), (True, 1)])
def test_repeat_is_idempotent_but_typed_change_conflicts(
    case: NodeInputsCase, first: None | bool | list[None | int], changed: int | str
) -> None:
    original = persist(case, first)
    assert persist(case, copy.deepcopy(first)) == original
    with pytest.raises(BuilderExecutionPolicyError, match="native_payload_conflict"):
        persist(case, changed)
    assert len(case.loader.rows) == 2


def test_equal_inputs_under_different_native_ids_remain_independent(case: NodeInputsCase) -> None:
    first = persist(case, {"same": True})
    second = case.store.store_node_inputs(
        ref=case.ref, generation=0, native_execution_id="482b7069-1110-43b6-a0f3-2477c92d240a", inputs={"same": True}
    )
    assert first != second
    assert len(case.loader.rows) == 3


@pytest.mark.parametrize("generation", [False, 0.0, -1, 1, "0", None])
def test_generation_must_be_exact_current_integer_before_storage(
    case: NodeInputsCase, generation: None | bool | float | int | str
) -> None:
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        case.store.store_node_inputs(
            ref=case.ref, generation=cast(int, generation), native_execution_id=NATIVE_ID, inputs=None
        )
    assert "save" not in case.events


def test_malformed_constructed_ref_has_no_warnings_or_authority_access(
    case: NodeInputsCase, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    access: list[str] = []

    def forbidden_access(**_kwargs: object) -> NoReturn:
        access.append("loader")
        raise AssertionError("malformed reference reached loader")

    monkeypatch.setattr(case.loader, "load", forbidden_access)
    ref = case.ref.model_copy(update={"request_id": {"secret": CANARY}})
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with pytest.raises(BuilderExecutionPolicyError, match="native_payload_unavailable") as exc:
            case.store.store_node_inputs(ref=ref, generation=0, native_execution_id=NATIVE_ID, inputs=None)
    assert caught == []
    assert CANARY not in str(exc.value)
    assert CANARY not in caplog.text
    assert access == []
    assert case.events == []


@pytest.mark.parametrize("phase", ["before-save", "after-readback", "before-ack"])
def test_running_branch_retains_generation_after_unrelated_scope_resume(case: NodeInputsCase, phase: str) -> None:
    # Root contract: scope is a shared resume counter; running branches retain
    # their own invocation generation when an unrelated branch resumes.
    parent_id = "parent"
    context = case.context.model_copy(
        update={"parent_invocation_id": parent_id, "call_depth": 1, "native_run_id": "child-run"}
    )
    receipt = case.store.prepare_object(
        ref=case.ref, tenant_id="tenant", kind="context", logical_key="context", payload=context.model_dump(mode="json")
    )
    row = module.NativePayloadObject(**vars(receipt))
    case.loader.rows = [row]
    case.loader.state.context_object_id = row.id
    case.loader.state.parent_invocation_id = parent_id
    case.loader.ancestors = [ancestor_state(parent_id, "running")]
    case.loader.active_ancestors = [parent_id]
    case.events.clear()

    def resume_other_branch() -> None:
        case.loader.scope.generation = 1
        case.loader.owned = replace(case.loader.owned, generation=1)  # Scope counter, not this invocation.

    if phase == "before-save":
        resume_other_branch()
    elif phase == "after-readback":
        case.after_readback[0] = lambda: resume_other_branch() if "save" in case.events else None
    else:
        case.loader.before_lock = resume_other_branch
    input_ref = persist(case, {"branch": True})
    assert case.store.load_result(ref=case.ref, result_ref=input_ref) == {"branch": True}
    assert case.loader.state.generation == 0
    assert case.loader.scope.generation == 1


@pytest.mark.parametrize(
    "identity",
    ["", NATIVE_ID.upper(), NATIVE_ID.replace("-", ""), "{" + NATIVE_ID + "}", "not-a-uuid", "a" * 129, None],
)
def test_invalid_identity_fails_before_private_storage(case: NodeInputsCase, identity: object) -> None:
    method = case.store.store_node_inputs
    assert callable(method), "independent node input persistence is unavailable"
    with pytest.raises(BuilderExecutionPolicyError):
        method(ref=case.ref, generation=0, native_execution_id=cast(str, identity), inputs={"secret": CANARY})
    assert case.events == []


@pytest.mark.parametrize("value", [float("nan"), float("inf"), {1: CANARY}, (CANARY,), {"bad": object()}, "\ud800"])
def test_invalid_typed_json_has_no_storage_or_secret_diagnostics(
    case: NodeInputsCase, value: object, caplog: pytest.LogCaptureFixture
) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as exc:
        persist(case, value)
    assert CANARY not in str(exc.value)
    assert CANARY not in caplog.text
    assert case.events == []


@pytest.mark.parametrize("phase", ["before-save", "after-readback", "before-ack"])
@pytest.mark.parametrize(
    "mutation",
    [
        "generation",
        "context-owner",
        "parent",
        "context-object",
        "cancelled",
        "inactive",
        "terminal",
        "graph",
        "run",
        "missing-run",
        "mode",
        "ancestor",
        "expiry",
    ],
)
def test_current_authority_drift_never_acknowledges(case: NodeInputsCase, phase: str, mutation: str) -> None:
    def drift() -> None:
        owner = case.loader
        if mutation == "generation":
            owner.state.generation += 1
        elif mutation == "context-owner":
            owner.state.app_id = "foreign"
        elif mutation == "parent":
            owner.state.parent_invocation_id = "missing-parent"
        elif mutation == "context-object":
            owner.state.context_object_id = "foreign"
        elif mutation == "cancelled":
            owner.scope.cancelled = True
        elif mutation == "inactive":
            owner.active = False
        elif mutation == "terminal":
            owner.state.state = "completed"
        elif mutation == "graph":
            case.workflow.graph = '{"nodes":[{"id":"changed"}]}'
        elif mutation == "run":
            owner.request.context["native_run_id"] = "different"
        elif mutation == "missing-run":
            owner.request.context.pop("native_run_id")
        elif mutation == "mode":
            owner.request.context["mode"] = "mock"
        elif mutation == "ancestor":
            owner.state.parent_invocation_id = "quarantined"
            owner.ancestors = [ancestor_state("quarantined", "unknown")]
        elif mutation == "expiry":
            owner.scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)

    if phase == "before-save":
        drift()
    elif phase == "after-readback":
        # Context decryption is the first load; drift only after the input save.
        case.after_readback[0] = lambda: drift() if "save" in case.events else None
    else:
        case.loader.before_lock = drift
    with pytest.raises(BuilderExecutionPolicyError):
        persist(case, {"secret": CANARY})
    assert len(case.loader.rows) == 1
    assert not case.loader.writing
    if phase == "before-save":
        assert "save" not in case.events


@pytest.mark.parametrize("failure", ["save", "decrypt", "readback", "flush", "commit"])
def test_failed_storage_or_ack_never_returns_reference_or_leaks_inputs(
    case: NodeInputsCase, monkeypatch: pytest.MonkeyPatch, failure: str, caplog: pytest.LogCaptureFixture
) -> None:
    def fail() -> NoReturn:
        raise OSError(CANARY)

    def fail_inputs[**P, R](original: Callable[P, R]) -> Callable[P, R]:
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
            if "save" in case.events or failure == "save":
                return fail()
            return original(*args, **kwargs)

        return wrapped

    if failure == "save":
        monkeypatch.setattr(module.storage, "save", fail_inputs(module.storage.save))
    elif failure == "decrypt":
        monkeypatch.setattr(module.encrypter, "decrypt_token", fail_inputs(module.encrypter.decrypt_token))
    elif failure == "readback":
        monkeypatch.setattr(module.storage, "load", fail_inputs(module.storage.load))
    else:
        setattr(case.loader, "fail_" + failure, True)
    with pytest.raises(BuilderExecutionPolicyError, match="native_payload_unavailable") as exc:
        persist(case, {"secret": CANARY})
    assert CANARY not in str(exc.value)
    assert CANARY not in caplog.text
    assert len(case.loader.rows) == 1
    assert not case.loader.writing
