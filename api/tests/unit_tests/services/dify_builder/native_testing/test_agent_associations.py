"""Protected structural Agent state, not backend ACK/physical execution qualification.

Real C03 store/codec; SQL, encryption and storage ports are explicitly labeled
unit doubles. Actual PostgreSQL/tenant crypto witnesses remain normal-CI only.
"""

from __future__ import annotations

import ast
import importlib
import importlib.util
from collections.abc import Callable, Generator
from dataclasses import dataclass, replace
from types import ModuleType
from typing import NotRequired, cast, override

import pytest
import pytest_mock
from pydantic import ValidationError
from sqlalchemy import Select, inspect
from typing_extensions import TypedDict

from core.dify_builder.models import Actor
from models.base import Base, TypeBase
from models.dify_builder_native_tests import (
    NativeInvocationState,
    NativeTestInvocation,
    NativeTestScope,
)
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.contracts import JsonValue, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NodeJournalState,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.unit_tests.services.dify_builder.native_testing.test_node_inputs import LoaderStandIn, SQLStandIn

EXECUTION = "81d492fd-05ce-46a8-8c82-a35d4b343d48"
REF = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
INPUTS: dict[str, JsonValue] = {"typed": [True, 1, "1"]}


def contracts() -> ModuleType:
    name = "runtime_contracts.builder.native.agent_contracts"
    assert importlib.util.find_spec(name) is not None, "pure protected Agent association contracts are missing"
    return importlib.import_module(name)


class ParentData(TypedDict):
    ref: dict[str, str]
    execution_id: str
    input_result_ref: str
    input_digest: str


class WorkspaceData(TypedDict):
    binding_id: str
    workspace_id: str
    backend_binding_ref: str
    backend_workspace_ref: str
    pinned_snapshot_id: str
    home_snapshot_id: NotRequired[str | None]
    workspace_generation: int


class AssociationData(TypedDict):
    parent_node: ParentData
    workflow_native_run_id: str
    agent_run_id: str
    config_ref: str
    config_digest: str
    pinned_snapshot_id: str
    home_snapshot_id: NotRequired[str | None]
    workspace: WorkspaceData


class WaitData(TypedDict):
    parent_node: ParentData
    association_object_ref: str
    agent_generation: int
    checkpoint_object_ref: str
    checkpoint_digest: str
    backend_wait_event_id: str


def parent_data() -> ParentData:
    return {
        "ref": REF.model_dump(),
        "execution_id": EXECUTION,
        "input_result_ref": "input",
        "input_digest": canonical_digest(INPUTS),
    }


def workspace_data() -> WorkspaceData:
    return {
        "binding_id": "binding",
        "workspace_id": "workspace",
        "backend_binding_ref": "native:binding:1",
        "backend_workspace_ref": "native:binding:1",
        "pinned_snapshot_id": "snapshot",
        "home_snapshot_id": "home",
        "workspace_generation": 1,
    }


def association_data() -> AssociationData:
    return {
        "parent_node": parent_data(),
        "workflow_native_run_id": "workflow-run",
        "agent_run_id": "agent-run",
        "config_ref": "config",
        "config_digest": canonical_digest({"config": True}),
        "pinned_snapshot_id": "snapshot",
        "home_snapshot_id": "home",
        "workspace": workspace_data(),
    }


def wait_data() -> WaitData:
    return {
        "parent_node": parent_data(),
        "association_object_ref": "association",
        "agent_generation": 7,
        "checkpoint_object_ref": "agent-checkpoint",
        "checkpoint_digest": "b" * 64,
        "backend_wait_event_id": "1234-0",
    }


def checkpoint(wait: AgentWaitAssociation) -> NativeCheckpointPayload:
    journal = NodeJournalState(
        invocation_id=REF.invocation_id,
        occurrence_path=(EXECUTION,),
        input_result_ref="input",
        input_digest=canonical_digest(INPUTS),
        cursor=0,
        operation_keys=(),
        result_refs=(),
    )
    return NativeCheckpointPayload(
        schema_version="1",
        native_run_id="workflow-run",
        generation=2,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(journal,),
        child_refs=(),
        input_result_refs=("input",),
        agent_associations=(wait,),
    )


def test_pure_association_preserves_distinct_runs_and_no_effect_cursor() -> None:
    c = contracts()
    binding = c.AgentNodeAssociation.model_validate(association_data())
    wait = c.AgentWaitAssociation.model_validate(wait_data())
    saved = checkpoint(wait)
    assert binding.agent_run_id != binding.workflow_native_run_id
    assert saved.agent_associations == (wait,)
    assert saved.node_journals[0].cursor == 0
    assert saved.node_journals[0].operation_keys == ()
    assert saved.node_journals[0].result_refs == ()
    assert saved.child_refs == ()


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("execution_id", "not-an-execution-uuid"),
        ("execution_id", EXECUTION.upper()),
        ("input_digest", "wrong"),
        ("input_result_ref", True),
    ],
)
def test_parent_locator_rejects_untyped_or_noncanonical_identity(field: str, bad: object) -> None:
    c = contracts()
    with pytest.raises(ValidationError):
        c.AgentParentNodeRef.model_validate({**parent_data(), field: bad})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("agent_generation", True),
        ("agent_generation", -1),
        ("agent_generation", "7"),
        ("backend_wait_event_id", True),
        ("checkpoint_digest", "wrong"),
        ("redis_ack", True),
        ("physical_closed", True),
    ],
)
def test_wait_structure_never_accepts_caller_ack_or_cleanup_authority(field: str, value: object) -> None:
    c = contracts()
    with pytest.raises(ValidationError):
        c.AgentWaitAssociation.model_validate({**wait_data(), field: value})


@pytest.mark.parametrize("fault", ["duplicate", "occurrence", "input_ref", "input_digest", "invocation"])
def test_checkpoint_association_requires_one_exact_saved_parent_journal(fault: str) -> None:
    c = contracts()
    data = wait_data()
    if fault == "occurrence":
        data["parent_node"]["execution_id"] = "0f70ec4d-9d46-42c2-a9c5-30fa93ea590f"
    elif fault == "input_ref":
        data["parent_node"]["input_result_ref"] = "foreign-input"
    elif fault == "input_digest":
        data["parent_node"]["input_digest"] = "c" * 64
    elif fault == "invocation":
        data["parent_node"]["ref"]["invocation_id"] = "foreign"
    wait = c.AgentWaitAssociation.model_validate(data)
    if fault == "duplicate":
        value = checkpoint(wait)
        with pytest.raises(ValidationError):
            NativeCheckpointPayload.model_validate(
                {**value.model_dump(mode="json"), "agent_associations": [wait.model_dump(mode="json")] * 2}
            )
    else:
        with pytest.raises(ValidationError):
            checkpoint(wait)


def test_workspace_ref_remains_same_public_reexport() -> None:
    c = contracts()
    from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceRef

    assert AgentTestWorkspaceRef is c.AgentTestWorkspaceRef
    assert AgentTestWorkspaceRef.model_validate(workspace_data()).model_dump() == workspace_data()


def runtime_imports(source: str) -> set[str | None]:
    """Exclude only the guarded, statically type-only branch from runtime imports."""
    import ast
    from typing import override

    class RuntimeImports(ast.NodeVisitor):
        def __init__(self) -> None:
            self.modules = set()

        @override
        def visit_If(self, node: ast.If) -> None:
            if isinstance(node.test, ast.Name) and node.test.id == "TYPE_CHECKING":
                for child in node.orelse:
                    self.visit(child)
            else:
                self.generic_visit(node)

        @override
        def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
            self.modules.add(node.module)

        @override
        def visit_Import(self, node: ast.Import) -> None:
            self.modules.update(alias.name for alias in node.names)

    visitor = RuntimeImports()
    visitor.visit(ast.parse(source))
    return visitor.modules


def test_agent_contract_imports_are_pure_without_database_flask_or_backend_sdk() -> None:
    from pathlib import Path

    contract_file = contracts().__file__
    assert contract_file is not None
    assert runtime_imports(Path(contract_file).read_text()) <= {
        "dataclasses",
        "typing",
        "uuid",
        "pydantic",
        "runtime_contracts.builder.execution",
        "runtime_contracts.builder.native.contracts",
    }


@pytest.mark.parametrize("dependency", ["flask", "sqlalchemy", "dify_agent.protocol.schemas"])
@pytest.mark.parametrize("placement", ["direct", "runtime-branch", "type-only-else"])
def test_contract_purity_guard_detects_runtime_dependencies(dependency: str, placement: str) -> None:
    statement = f"import {dependency}"
    source = {
        "direct": statement,
        "runtime-branch": f"if enabled:\n    {statement}",
        "type-only-else": f"if TYPE_CHECKING:\n    pass\nelse:\n    {statement}",
    }[placement]
    assert dependency in runtime_imports(source)
    assert dependency not in runtime_imports(f"if TYPE_CHECKING:\n    {statement}")


class StoreAgentWaitArgs(TypedDict, closed=True):
    ref: NativeTestContextRef
    parent_node: AgentParentNodeRef
    association_object_ref: str
    agent_generation: int
    checkpoint: JsonValue
    backend_wait_event_id: str


class AgentLoaderState(LoaderStandIn):
    actor: Actor
    resources: dict[type[object], Base | TypeBase | None]
    invocation: NativeTestInvocation


def required_resource[T](loader: AgentLoaderState, model: type[T]) -> T:
    resource = loader.resources[model]
    assert isinstance(resource, model)
    return resource


@dataclass
class AgentStateCase:
    store: NativeExecutionStateStore
    loader: AgentLoaderState
    ref: NativeTestContextRef
    context: ResolvedNativeTestContext
    parent: AgentParentNodeRef
    blobs: dict[str, bytes]
    events: list[str]
    after_readback: list[Callable[[], None]]


@pytest.fixture
def state_case(monkeypatch: pytest.MonkeyPatch) -> AgentStateCase:
    """Actual state/codec; explicit SQL/permission/encryption/storage boundary doubles."""
    import json
    from contextlib import contextmanager

    from core.dify_builder.models import Actor
    from models.account import (
        Account,
        AccountStatus,
        Tenant,
        TenantAccountJoin,
        TenantAccountRole,
        TenantStatus,
    )
    from models.agent import (
        Agent,
        AgentConfigSnapshot,
        AgentConfigVersionKind,
        AgentHomeSnapshot,
        AgentScope,
        AgentSource,
        AgentStatus,
        AgentWorkingResourceStatus,
        AgentWorkspace,
        AgentWorkspaceBinding,
        AgentWorkspaceOwnerType,
        WorkflowAgentBindingType,
        WorkflowAgentNodeBinding,
    )
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
    from models.dify_builder_native_tests import (
        NativeContinuation,
        NativePayloadObject,
        NativeTestInvocation,
    )
    from models.model import App
    from runtime_contracts.builder.native.runtime_contracts import (
        ResolvedNativeTestContext,
    )
    from services.dify_builder.native_testing import state_store as module
    from services.dify_builder.native_testing.agent_binding import native_node_data
    from tests.unit_tests.services.dify_builder.native_testing.test_node_inputs import (
        SQLStandIn,
    )

    class AgentSQL(SQLStandIn):
        def __init__(self, owner: AgentLoaderState) -> None:
            super().__init__(owner)
            self.agent_owner = owner

        @override
        def scalar[T](self, query: Select[tuple[T]]) -> T | None:
            entity = query.column_descriptions[0]["entity"]
            if entity is NativeTestInvocation:
                return cast(T, self.agent_owner.invocation)
            if entity in (NativeContinuation, NativePayloadObject):
                params = {key.rsplit("_", 1)[0]: value for key, value in query.compile().params.items()}
                return cast(
                    T | None,
                    next(
                        (
                            row
                            for row in self.owner.rows
                            if isinstance(row, entity)
                            and all(inspect(row).attrs[key].value == value for key, value in params.items())
                        ),
                        None,
                    ),
                )
            if entity in self.agent_owner.resources:
                row = self.agent_owner.resources[entity]
                if row is None:
                    return None
                # SQL is a unit boundary double; assert the new access/pin queries
                # carry the actual fixture owners before returning their rows.
                params = query.compile().params
                for key, value in params.items():
                    field = key.rsplit("_", 1)[0]
                    if field in (
                        "tenant_id",
                        "account_id",
                        "app_id",
                        "agent_id",
                        "workflow_id",
                        "workflow_version",
                        "node_id",
                        "current_snapshot_id",
                        "binding_type",
                    ):
                        assert inspect(row).attrs[field].value == value
                return cast(T, inspect(row).attrs.id.value if entity is App else row)
            return super().scalar(query)

        @override
        def scalars(self, query: Select[tuple[object, ...]]) -> list[NativeInvocationState] | list[str]:
            if query.column_descriptions[0]["entity"] is NativePayloadObject:
                return [
                    row.logical_key
                    for row in self.owner.rows
                    if isinstance(row, NativePayloadObject) and row.kind == "result"
                ]
            return super().scalars(query)

        @override
        def get[T](self, model: type[T], identity: object, *, populate_existing: bool = False) -> T | None:
            if model in (Account, Tenant):
                assert populate_existing
            if model in self.agent_owner.resources:
                row = self.agent_owner.resources[model]
                return cast(T, row) if row is not None and inspect(row).attrs.id.value == identity else None
            return super().get(model, identity)

    class AgentLoader(AgentLoaderState):
        actor: Actor

        @override
        @contextmanager
        def session_factory(self) -> Generator[AgentSQL]:
            assert not self.writing
            yield AgentSQL(self)

        @override
        @contextmanager
        def locked(self, *, ref: NativeTestContextRef) -> Generator[tuple[AgentSQL, OwnedNativeTest, NativeTestScope]]:
            self.before_lock()
            owned = self.load(ref=ref)
            previous = self.rows.copy()
            self.writing = True
            try:
                yield AgentSQL(self), owned, self.scope
                if self.fail_commit:
                    raise OSError("lost-unit-ack")
            except Exception:
                self.rows = previous
                raise
            finally:
                self.writing = False

    loader = AgentLoader()
    loader.actor = Actor(account_id="actor", tenant_id="tenant")
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "unit-inert-model",
            }
        }
    )
    job = WorkflowNodeJobConfig(workflow_prompt="Unit Agent task")
    account = Account(name="Native owner", email="native-owner@example.invalid", status=AccountStatus.ACTIVE)
    account.id = "actor"
    tenant = Tenant(name="Native tenant", status=TenantStatus.NORMAL)
    tenant.id = "tenant"
    membership = TenantAccountJoin(tenant_id="tenant", account_id="actor", role=TenantAccountRole.OWNER)
    membership.id = "membership"
    loader.resources = {
        Account: account,
        Tenant: tenant,
        TenantAccountJoin: membership,
        App: App(id="app", tenant_id="tenant", status="normal"),
        Agent: Agent(
            id="agent",
            tenant_id="tenant",
            active_config_snapshot_id="snapshot",
            active_config_has_model=True,
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            status=AgentStatus.ACTIVE,
            created_by="actor",
            updated_by="actor",
        ),
        WorkflowAgentNodeBinding: WorkflowAgentNodeBinding(
            id="node-binding",
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            workflow_version="published",
            node_id="agent-node",
            agent_id="agent",
            current_snapshot_id="snapshot",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            node_job_config=job.model_dump(mode="json"),
        ),
        AgentConfigSnapshot: AgentConfigSnapshot(
            id="snapshot",
            tenant_id="tenant",
            agent_id="agent",
            home_snapshot_id="home",
            config_snapshot=soul.model_dump(mode="json"),
        ),
        AgentHomeSnapshot: AgentHomeSnapshot(
            id="home",
            tenant_id="tenant",
            agent_id="agent",
            snapshot_ref="published-home",
            status=AgentWorkingResourceStatus.ACTIVE,
        ),
        AgentWorkspace: AgentWorkspace(
            id="workspace",
            tenant_id="tenant",
            app_id="app",
            owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
            owner_id="workflow-run",
            owner_scope_key="native:inv",
            backend_workspace_ref="native:binding:1",
            status=AgentWorkingResourceStatus.ACTIVE,
        ),
        AgentWorkspaceBinding: AgentWorkspaceBinding(
            id="binding",
            tenant_id="tenant",
            app_id="app",
            agent_id="agent",
            workspace_id="workspace",
            base_home_snapshot_id="home",
            agent_config_version_id="snapshot",
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            backend_binding_ref="native:binding:1",
            status=AgentWorkingResourceStatus.ACTIVE,
        ),
    }
    from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec

    from services.dify_builder.native_testing.agent_workspace import (
        AgentWorkspaceAllocation,
    )

    allocation = AgentWorkspaceAllocation(
        tenant_id="tenant",
        app_id="app",
        request_id="request",
        invocation_id="inv",
        owner_run_id="workflow-run",
        binding_id="binding",
        workspace_id="workspace",
        agent_id="agent",
        pinned_snapshot_id="snapshot",
        home_snapshot_id="home",
        phase="ready",
        native_scope=NativeScopeSpec(
            scope_id="binding",
            binding_ref="binding",
            generation=1,
            base_snapshot_ref="published-home",
            capability_digest="c" * 64,
            deadline=loader.scope.expires_at,
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
        ),
    ).model_dump(mode="json")
    loader.invocation = NativeTestInvocation(
        tenant_id="tenant",
        request_id="request",
        invocation_id="inv",
        active=True,
        bindings={"_agent_workspace_v1": allocation},
    )
    graph = {
        "nodes": [
            {
                "id": "agent-node",
                "data": native_node_data(agent_id="agent", snapshot_id="snapshot", node_job=job),
            }
        ]
    }
    context = ResolvedNativeTestContext(
        ref=loader.ref,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        graph=graph,
        inputs={},
        graph_revision="revision",
        input_revision=canonical_digest({}),
        resource_manifest=(),
        generation=0,
        root_native_run_id="workflow-run",
        native_run_id="workflow-run",
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="request",
        cancellation_ref="request",
        execution_mode="native",
    )
    loader.request.context["native_run_id"] = "workflow-run"
    blobs: dict[str, bytes] = {}
    events: list[str] = []
    after_readback = [lambda: None]

    def save(key: str, value: bytes) -> None:
        assert not loader.writing, "storage inside SQL writer"
        events.append("save")
        blobs[key] = value

    def load(key: str) -> bytes:
        assert not loader.writing, "storage inside SQL writer"
        events.append("load")
        value = blobs[key]
        after_readback[0]()
        return value

    def encrypt(tenant: str, value: str) -> str:
        assert tenant == "tenant"
        assert not loader.writing
        return value.encode().hex()

    def decrypt(tenant: str, value: str) -> str:
        assert tenant == "tenant"
        assert not loader.writing
        return bytes.fromhex(value).decode()

    def authority(owner: AgentLoaderState, ref: NativeTestContextRef) -> PrivateReadOwner:
        assert not owner.writing, "permission outside SQL writer"
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
    monkeypatch.setattr(module, "validate_private_read", authority)
    monkeypatch.setattr(
        module,
        "validate_invocation_workflow",
        lambda *_args, **_kwargs: Workflow(graph=json.dumps(graph), version="published"),
    )
    monkeypatch.setattr(module, "native_workflow_revision", lambda _workflow: "revision")
    store = module.NativeExecutionStateStore(cast(OwnedNativeTestLoader, loader))
    receipt = store.prepare_object(
        ref=loader.ref,
        tenant_id="tenant",
        kind="context",
        logical_key="context",
        payload=context.model_dump(mode="json"),
    )
    loader.rows.append(NativePayloadObject(**vars(receipt)))
    loader.state.context_object_id = receipt.id
    input_ref = store.store_node_inputs(ref=loader.ref, generation=0, native_execution_id=EXECUTION, inputs=INPUTS)
    parent = contracts().AgentParentNodeRef(
        ref=loader.ref,
        execution_id=EXECUTION,
        input_result_ref=input_ref,
        input_digest=canonical_digest(INPUTS),
    )
    events.clear()
    return AgentStateCase(
        store=store,
        loader=loader,
        ref=loader.ref,
        context=context,
        parent=parent,
        blobs=blobs,
        events=events,
        after_readback=after_readback,
    )


def bound_state(c: AgentStateCase) -> tuple[dict[str, JsonValue], AgentNodeAssociation, str]:
    assert hasattr(c.store, "store_agent_config"), "protected Agent storage owner APIs are missing"
    config: dict[str, JsonValue] = {"model": {"selected": "protected-model"}, "typed": [True, 1, "1"]}
    config_ref = c.store.store_agent_config(
        ref=c.ref, parent_node=c.parent, expected_invocation_generation=c.loader.state.generation, config=config
    )
    association = contracts().AgentNodeAssociation.model_validate(
        {
            **association_data(),
            "parent_node": c.parent,
            "config_ref": config_ref,
            "config_digest": canonical_digest(config),
        }
    )
    ref = c.store.bind_agent_run(
        ref=c.ref,
        parent_node=c.parent,
        expected_invocation_generation=c.loader.state.generation,
        association=association,
    )
    return config, association, ref


def backend_checkpoint(
    c: AgentStateCase, association: AgentNodeAssociation, generation: int = 7
) -> dict[str, JsonValue]:
    return {
        "protocol_version": 1,
        "run_id": association.agent_run_id,
        "generation": generation,
        "ref": c.ref.model_dump(mode="json"),
        "config_ref": association.config_ref,
        "config_digest": association.config_digest,
        "stage": "tool",
        "pending_calls": [{"call_id": "real-backend-call"}],
        "history": [{"content": "private-history"}],
        "operation_cursor": 0,
        "result_refs": {},
        "job_refs": [],
        "session_snapshot": {"layers": {}},
    }


@pytest.mark.parametrize("fault", ["account", "tenant", "membership", "agent-pin", "published-binding"])
def test_actual_agent_access_and_publication_guards_precede_private_write(
    state_case: AgentStateCase, fault: str
) -> None:
    from models.account import (
        Account,
        AccountStatus,
        Tenant,
        TenantAccountJoin,
        TenantStatus,
    )
    from models.agent import Agent, WorkflowAgentNodeBinding
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    if fault == "account":
        required_resource(c.loader, Account).status = AccountStatus.BANNED
    elif fault == "tenant":
        required_resource(c.loader, Tenant).status = TenantStatus.ARCHIVE
    elif fault == "membership":
        c.loader.resources[TenantAccountJoin] = None
    elif fault == "agent-pin":
        required_resource(c.loader, Agent).active_config_snapshot_id = "foreign"
    else:
        c.loader.resources[WorkflowAgentNodeBinding] = None
    reason = "agent_access_denied" if fault in ("account", "tenant", "membership") else "native_agent_pin_mismatch"
    before = c.loader.rows.copy()
    with pytest.raises(BuilderExecutionPolicyError, match=reason):
        bound_state(c)
    assert "save" not in c.events
    assert c.loader.rows == before


def test_actual_state_nonempty_bind_wait_final_are_immutable_owned_objects(state_case: AgentStateCase) -> None:
    c = state_case
    config, association, ref = bound_state(c)
    stored = backend_checkpoint(c, association)
    wait = c.store.store_agent_wait(
        ref=c.ref,
        parent_node=c.parent,
        association_object_ref=ref,
        agent_generation=7,
        checkpoint=stored,
        backend_wait_event_id="1234-0",
    )
    state = c.store.load_agent_association(ref=c.ref, parent_node=c.parent, wait=wait)
    assert state.association == association
    assert state.checkpoint == stored
    assert state.wait == wait
    assert state.terminal_result is None
    before = c.events.count("save")
    assert bound_state(c) == (config, association, ref)
    assert (
        c.store.store_agent_wait(
            ref=c.ref,
            parent_node=c.parent,
            association_object_ref=ref,
            agent_generation=7,
            checkpoint=stored,
            backend_wait_event_id="1234-0",
        )
        == wait
    )
    assert c.events.count("save") == before
    result: dict[str, JsonValue] = {"output": [True, 1, "1"]}
    final = c.store.store_agent_final(
        ref=c.ref,
        parent_node=c.parent,
        association_object_ref=ref,
        agent_generation=8,
        terminal_result=result,
        backend_terminal_event_id="1235-0",
    )
    assert (
        c.store.store_agent_final(
            ref=c.ref,
            parent_node=c.parent,
            association_object_ref=ref,
            agent_generation=8,
            terminal_result=result,
            backend_terminal_event_id="1235-0",
        )
        == final
    )
    discover = c.store.load_agent_association(ref=c.ref, parent_node=c.parent)
    assert discover.terminal_result_ref == final
    assert discover.terminal_result == result
    assert discover.wait is None
    assert all(len(row.logical_key) <= 128 for row in c.loader.rows)
    assert not any(type(row).__name__ == "NativeEffectOperation" for row in c.loader.rows)


@pytest.mark.parametrize("fault", ["input_digest", "input_ref", "execution_id", "ref"])
def test_stored_parent_input_owner_rejects_before_agent_write(state_case: AgentStateCase, fault: str) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    data = c.parent.model_dump(mode="json")
    if fault == "input_digest":
        data["input_digest"] = "c" * 64
    elif fault == "input_ref":
        data["input_result_ref"] = c.loader.state.context_object_id
    elif fault == "execution_id":
        data["execution_id"] = "0f70ec4d-9d46-42c2-a9c5-30fa93ea590f"
    else:
        data["ref"]["invocation_id"] = "foreign"
    parent = contracts().AgentParentNodeRef.model_validate(data)
    assert hasattr(c.store, "store_agent_config"), "protected Agent storage owner APIs are missing"
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.store_agent_config(
            ref=c.ref, parent_node=parent, expected_invocation_generation=0, config={"config": True}
        )
    assert "save" not in c.events


def wait_state(c: AgentStateCase) -> tuple[AgentNodeAssociation, AgentWaitAssociation, dict[str, JsonValue]]:
    _, association, ref = bound_state(c)
    raw = backend_checkpoint(c, association)
    wait = c.store.store_agent_wait(
        ref=c.ref,
        parent_node=c.parent,
        association_object_ref=ref,
        agent_generation=7,
        checkpoint=raw,
        backend_wait_event_id="1234-0",
    )
    return association, wait, raw


def payload_for(c: AgentStateCase, wait: AgentWaitAssociation, generation: int = 0) -> NativeCheckpointPayload:
    parent = c.parent
    journal = NodeJournalState(
        invocation_id=c.ref.invocation_id,
        occurrence_path=(parent.execution_id,),
        input_result_ref=parent.input_result_ref,
        input_digest=parent.input_digest,
        cursor=0,
        operation_keys=(),
        result_refs=(),
    )
    return NativeCheckpointPayload(
        schema_version="1",
        native_run_id="workflow-run",
        generation=generation,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(journal,),
        child_refs=(),
        input_result_refs=(parent.input_result_ref,),
        agent_associations=(wait,),
    )


def test_expired_projection_keeps_agent_checkpoint_proof_without_writes(state_case: AgentStateCase) -> None:
    from datetime import UTC, datetime, timedelta

    c = state_case
    _, wait, _ = wait_state(c)
    cp = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload_for(c, wait))
    c.loader.scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    c.events.clear()
    projected = c.store.read_checkpoint(ref=c.ref, checkpoint=cp, for_projection=True)
    assert projected.agent_associations == (wait,)
    assert not any(event in {"save", "ack"} for event in c.events)
    with pytest.raises(BuilderExecutionPolicyError, match="native_expired"):
        c.store.read_checkpoint(ref=c.ref, checkpoint=cp)


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("association_object_ref", "foreign-bind"),
        ("checkpoint_object_ref", "foreign-checkpoint"),
        ("checkpoint_digest", "f" * 64),
        ("agent_generation", 8),
    ],
)
def test_commit_checkpoint_rejects_unselected_agent_private_material(
    state_case: AgentStateCase, field: str, bad: object
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    _, wait, _ = wait_state(c)
    forged = contracts().AgentWaitAssociation.model_validate({**wait.model_dump(mode="json"), field: bad})
    before = c.events.count("save")
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload_for(c, forged))
    assert c.events.count("save") == before


@pytest.mark.parametrize("fault", ["current_workspace", "checkpoint_bytes", "saved_generation"])
@pytest.mark.parametrize("for_projection", [False, True])
def test_read_checkpoint_revalidates_current_agent_private_relations(
    state_case: AgentStateCase, fault: str, for_projection: bool
) -> None:
    from datetime import UTC, datetime, timedelta

    from models.agent import AgentWorkspaceBinding
    from models.dify_builder_native_tests import NativeContinuation
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    _, wait, _ = wait_state(c)
    checkpoint_ref = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload_for(c, wait))
    if for_projection:
        c.loader.scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    if fault == "current_workspace":
        required_resource(c.loader, AgentWorkspaceBinding).backend_binding_ref = "foreign"
    elif fault == "checkpoint_bytes":
        row = next(row for row in c.loader.rows if row.id == wait.checkpoint_object_ref)
        c.blobs[row.storage_key] = b"corrupt-private-checkpoint"
    else:
        next(row for row in c.loader.rows if isinstance(row, NativeContinuation)).generation = 1
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.read_checkpoint(ref=c.ref, checkpoint=checkpoint_ref, for_projection=for_projection)


def test_second_distinct_occurrence_cannot_silently_reuse_single_workspace(state_case: AgentStateCase) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    bound_state(c)
    second_id = "0f70ec4d-9d46-42c2-a9c5-30fa93ea590f"
    inputs = c.store.store_node_inputs(ref=c.ref, generation=0, native_execution_id=second_id, inputs=INPUTS)
    parent = contracts().AgentParentNodeRef(
        ref=c.ref, execution_id=second_id, input_result_ref=inputs, input_digest=canonical_digest(INPUTS)
    )
    before = c.events.count("save")
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_single_workspace_limit"):
        c.store.store_agent_config(
            ref=c.ref, parent_node=parent, expected_invocation_generation=0, config={"second": True}
        )
    assert c.events.count("save") == before


def test_backend_generation_seven_cp_local_zero_remains_readable_at_local_two_scope_three(
    state_case: AgentStateCase,
) -> None:
    c = state_case
    _, wait, raw = wait_state(c)
    cp = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload_for(c, wait))
    c.loader.state.generation = 2
    c.loader.owned = replace(c.loader.owned, generation=2)
    c.loader.scope.generation = 3
    restored = c.store.read_checkpoint(ref=c.ref, checkpoint=cp)
    assert restored.generation == 0
    assert restored.agent_associations[0].agent_generation == 7
    assert c.store.load_agent_association(ref=c.ref, parent_node=c.parent, wait=wait).checkpoint == raw


@pytest.mark.parametrize("kind", ["config", "binding", "checkpoint", "final"])
def test_same_logical_key_rejects_changed_agent_material(state_case: AgentStateCase, kind: str) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    _, association, ref = bound_state(c)
    if kind == "config":

        def call() -> str | AgentWaitAssociation:
            return c.store.store_agent_config(
                ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config={"different": True}
            )
    elif kind == "binding":
        changed_association = association.model_copy(update={"agent_run_id": "different-agent-run"})

        def call() -> str | AgentWaitAssociation:
            return c.store.bind_agent_run(
                ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, association=changed_association
            )
    elif kind == "checkpoint":
        c.store.store_agent_wait(
            ref=c.ref,
            parent_node=c.parent,
            association_object_ref=ref,
            agent_generation=7,
            checkpoint=backend_checkpoint(c, association),
            backend_wait_event_id="1234-0",
        )
        changed_checkpoint: dict[str, JsonValue] = {
            **backend_checkpoint(c, association),
            "history": [{"changed": True}],
        }

        def call() -> str | AgentWaitAssociation:
            return c.store.store_agent_wait(
                ref=c.ref,
                parent_node=c.parent,
                association_object_ref=ref,
                agent_generation=7,
                checkpoint=changed_checkpoint,
                backend_wait_event_id="1234-0",
            )
    else:
        c.store.store_agent_final(
            ref=c.ref,
            parent_node=c.parent,
            association_object_ref=ref,
            agent_generation=8,
            terminal_result={"first": True},
            backend_terminal_event_id="1235-0",
        )

        def call() -> str | AgentWaitAssociation:
            return c.store.store_agent_final(
                ref=c.ref,
                parent_node=c.parent,
                association_object_ref=ref,
                agent_generation=8,
                terminal_result={"changed": True},
                backend_terminal_event_id="1235-0",
            )

    before = c.events.count("save")
    with pytest.raises(BuilderExecutionPolicyError, match="native_payload_conflict"):
        call()
    assert c.events.count("save") == before


def test_lost_post_commit_ack_reuses_existing_selected_checkpoint_without_storage_write(
    state_case: AgentStateCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from contextlib import contextmanager

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    _, association, ref = bound_state(c)
    locked = c.loader.locked
    lost = [True]

    @contextmanager
    def after_commit(*, ref: NativeTestContextRef) -> Generator[tuple[SQLStandIn, OwnedNativeTest, NativeTestScope]]:
        with locked(ref=ref) as selected:
            yield selected
        if lost[0]:
            lost[0] = False
            raise TimeoutError("unit-lost-postcommit-ack")

    monkeypatch.setattr(c.loader, "locked", after_commit)
    args: StoreAgentWaitArgs = {
        "ref": c.ref,
        "parent_node": c.parent,
        "association_object_ref": ref,
        "agent_generation": 7,
        "checkpoint": backend_checkpoint(c, association),
        "backend_wait_event_id": "1234-0",
    }
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.store_agent_wait(**args)
    before = c.events.count("save")
    wait = c.store.store_agent_wait(**args)
    assert c.events.count("save") == before
    assert c.store.load_agent_association(ref=c.ref, parent_node=c.parent, wait=wait).wait == wait


@pytest.mark.parametrize("drift", ["local-generation", "workspace", "input-metadata"])
def test_sql_recheck_after_private_io_refuses_drift_before_ack(state_case: AgentStateCase, drift: str) -> None:
    from models.agent import AgentWorkspace
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case

    def change() -> None:
        if drift == "local-generation":
            c.loader.state.generation += 1
        elif drift == "workspace":
            required_resource(c.loader, AgentWorkspace).owner_id = "foreign-run"
        else:
            next(row for row in c.loader.rows if row.id == c.parent.input_result_ref).value_digest = "d" * 64

    c.loader.before_lock = change
    before_rows = len(c.loader.rows)
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.store_agent_config(
            ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config={"protected": True}
        )
    assert len(c.loader.rows) == before_rows
    assert not c.loader.writing


@pytest.mark.parametrize("for_projection", [False, True])
def test_read_checkpoint_rechecks_selected_outer_metadata_after_private_io(
    state_case: AgentStateCase, for_projection: bool
) -> None:
    from datetime import UTC, datetime, timedelta

    from models.dify_builder_native_tests import NativeContinuation
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    _, wait, _ = wait_state(c)
    checkpoint_ref = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload_for(c, wait))
    if for_projection:
        c.loader.scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)

    def changed_outer() -> None:
        next(row for row in c.loader.rows if isinstance(row, NativeContinuation)).generation = 1

    c.loader.before_lock = changed_outer
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        c.store.read_checkpoint(ref=c.ref, checkpoint=checkpoint_ref, for_projection=for_projection)


def test_actual_operation_cursor_finish_is_untouched_by_agent_associations(
    state_case: AgentStateCase, mocker: pytest_mock.MockerFixture
) -> None:
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.operation_journal import NodeOperationJournal

    c = state_case
    authorization = EffectAuthorizationService(cast(OwnedNativeTestLoader, c.loader))
    before_call = mocker.spy(authorization, "before_call")
    journal = NodeOperationJournal(state=c.store, authorization=authorization)
    cursor = journal.open(ref=c.ref, occurrence_path=(EXECUTION,))
    cursor.bind_input(input_result_ref=c.parent.input_result_ref, inputs=INPUTS)
    original = cursor.snapshot()
    wait_state(c)
    cursor.finish()
    assert cursor.snapshot() == original
    assert original.cursor == 0
    assert original.operation_keys == original.result_refs == ()
    before_call.assert_not_called()


def test_actual_sql_workspace_backend_reference_cannot_drift(state_case: AgentStateCase) -> None:
    from models.agent import AgentWorkspace
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    _, wait, _ = wait_state(c)
    required_resource(c.loader, AgentWorkspace).backend_workspace_ref = "foreign-backend"
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_owner_mismatch"):
        c.store.load_agent_association(ref=c.ref, parent_node=c.parent, wait=wait)


def test_empty_agent_checkpoint_keeps_legacy_private_payload_and_repeat_identity(state_case: AgentStateCase) -> None:
    from models.dify_builder_native_tests import NativePayloadObject

    c = state_case
    payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id="workflow-run",
        generation=0,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(),
        child_refs=(),
        input_result_refs=(),
    )
    first = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload)
    row = next(row for row in c.loader.rows if isinstance(row, NativePayloadObject) and row.id == first.checkpoint_id)
    stored_payload = c.store._read_object(row)
    assert isinstance(stored_payload, dict)
    assert "agent_associations" not in stored_payload
    assert c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload) == first
    assert c.store.read_checkpoint(ref=c.ref, checkpoint=first).agent_associations == ()


def test_current_local_generation_controls_config_write_without_shared_counter_alias(
    state_case: AgentStateCase,
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    c.loader.state.generation = 2
    c.loader.owned = replace(c.loader.owned, generation=2)
    c.loader.scope.generation = 3
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        c.store.store_agent_config(
            ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config={"typed": True}
        )
    selected = c.store.store_agent_config(
        ref=c.ref, parent_node=c.parent, expected_invocation_generation=2, config={"typed": True}
    )
    assert selected


def test_missing_actual_workspace_owner_refuses_without_agent_private_write(state_case: AgentStateCase) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    c.loader.invocation.bindings = dict[str, object]()
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_unavailable"):
        c.store.store_agent_config(
            ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config={"typed": True}
        )
    assert "save" not in c.events


def test_agent_run_cannot_alias_workflow_native_run_or_inject_proof_fields() -> None:
    c = contracts()
    with pytest.raises(ValidationError):
        c.AgentNodeAssociation.model_validate({**association_data(), "agent_run_id": "workflow-run"})
    with pytest.raises(ValidationError):
        c.AgentNodeAssociation.model_validate({**association_data(), "backend_acknowledged": True})


@pytest.mark.parametrize("fault", ["allocation-extra-proof", "missing-scope-digest"])
def test_actual_allocation_owner_parser_rejects_malformed_scope_and_unknown_proof(
    state_case: AgentStateCase, fault: str
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    c = state_case
    allocation = c.loader.invocation.bindings["_agent_workspace_v1"]
    if fault == "allocation-extra-proof":
        allocation["backend_acknowledged"] = True
    else:
        allocation["native_scope"].pop("capability_digest")
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.store_agent_config(
            ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config={"private": True}
        )
    assert "save" not in c.events


def test_normal_blank_home_association_roundtrip_retains_explicit_none() -> None:
    c = contracts()
    raw = association_data()
    raw["home_snapshot_id"] = None
    raw["workspace"] = {
        **workspace_data(),
        "home_snapshot_id": None,
        "workspace_generation": 0,
        "backend_binding_ref": "ordinary-binding",
        "backend_workspace_ref": "ordinary-workspace",
    }
    selected = c.AgentNodeAssociation.model_validate(raw)
    assert selected.home_snapshot_id is None
    assert selected.workspace.home_snapshot_id is None
    assert c.AgentNodeAssociation.model_validate_json(selected.model_dump_json()) == selected


@pytest.mark.parametrize("fault", ["isolated", "missing_home", "missing_workspace_home", "mismatched_home"])
def test_blank_home_never_weakens_required_fields_or_isolated_pins(fault: str) -> None:
    c = contracts()
    raw = association_data()
    raw["home_snapshot_id"] = None
    raw["workspace"] = {**workspace_data(), "home_snapshot_id": None, "workspace_generation": 0}
    if fault == "isolated":
        raw["workspace"]["workspace_generation"] = 1
    elif fault == "missing_home":
        del raw["home_snapshot_id"]
    elif fault == "missing_workspace_home":
        del raw["workspace"]["home_snapshot_id"]
    else:
        raw["workspace"]["home_snapshot_id"] = "home"
    with pytest.raises(ValidationError):
        c.AgentNodeAssociation.model_validate(raw)


@pytest.mark.parametrize("physical_generation", [0, 1])
def test_nullable_normal_home_cannot_enter_isolated_workspace_owner(
    state_case: AgentStateCase, physical_generation: int
) -> None:
    c = state_case
    c_contracts = contracts()
    normal = c_contracts.AgentTestWorkspaceRef.model_validate(
        {
            **workspace_data(),
            "home_snapshot_id": None,
            "workspace_generation": 0,
        }
    )
    assert normal.home_snapshot_id is None
    allocation = dict(c.loader.invocation.bindings["_agent_workspace_v1"])
    allocation["home_snapshot_id"] = None
    allocation["native_scope"] = {**allocation["native_scope"], "generation": physical_generation}
    c.loader.invocation.bindings = {"_agent_workspace_v1": allocation}
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.store_agent_config(
            ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config={"inert": True}
        )
    assert "save" not in c.events
