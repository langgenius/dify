"""CI-only PostgreSQL allocation races and settlement; A7 kernel tests prove physical isolation.

The backend is an observable no-network stand-in. SQL owners, root locking,
protected context storage, and materialized binding/workspace rows are real.
"""

from __future__ import annotations

from collections.abc import Callable, Generator
from typing import TYPE_CHECKING, cast

from dify_agent.protocol.execution_binding import CreateExecutionBindingRequest, DestroyExecutionBindingRequest
from flask import Flask
from shellctl.shared.schemas import NativeScopeSpec
from werkzeug.local import LocalProxy

from services.dify_builder.native_testing.agent_workspace import AgentWorkspaceAllocation

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection
    from sqlalchemy.orm import Session, SessionTransaction

    from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext


from typing import TYPE_CHECKING

from runtime_contracts.builder.native.agent_contracts import AgentTestWorkspaceRef
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.orm import Session, sessionmaker

    from core.dify_builder.models import Actor
    from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
    from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
        AgentWorkspaceCase,
    )

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import test_builder_restricted_native as _fixture_types_0

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import test_builder_restricted_native as _fixture_types_0


import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event, get_ident
from uuid import uuid4

import pytest
from shellctl.shared.schemas import NativeScopeLimits
from sqlalchemy import event, func, select
from sqlalchemy.orm.session import Session, sessionmaker

from models.agent import (
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import NativeTestInvocation, NativeTestScope
from models.model import App
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.agent.workspace_service import AgentWorkspaceService
from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
    AgentWorkspaceCase,
    require_present,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import no_live as no_live  # noqa: PLC0414 - shared pytest fixture
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    raw_ledger_case,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as _base_native_owner_fixture,
)

base_native_owner = _base_native_owner_fixture


@pytest.fixture
def native_owner(
    base_native_owner: _fixture_types_0.NativeOwner,
) -> tuple[sessionmaker[Session], Actor, App, Workflow, str, str]:
    from extensions.ext_database import db

    factory, actor, app, workflow, sid, tid = base_native_owner
    snapshot_id, home_id, agent_id = str(uuid4()), str(uuid4()), str(uuid4())
    graph = json.loads(workflow.graph)
    graph["nodes"].append(
        {"id": "a4-agent", "data": {"agent_binding": {"agent_id": agent_id, "current_snapshot_id": snapshot_id}}}
    )
    workflow.graph = json.dumps(graph)
    db.session.add(
        AgentHomeSnapshot(
            id=home_id,
            tenant_id=actor.tenant_id,
            agent_id=agent_id,
            snapshot_ref="home-" + home_id,
            status=AgentWorkingResourceStatus.ACTIVE,
        )
    )
    db.session.add(
        AgentConfigSnapshot(
            id=snapshot_id,
            tenant_id=actor.tenant_id,
            agent_id=agent_id,
            home_snapshot_id=home_id,
            version=1,
            config_snapshot=AgentSoulConfig(),
        )
    )
    db.session.commit()
    return base_native_owner


@pytest.fixture
def workspace_case(
    native_owner: tuple[sessionmaker[Session], Actor, App, Workflow, str, str],
    no_live: None,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[AgentWorkspaceCase]:
    from dify_agent.protocol.execution_binding import CreateExecutionBindingResponse

    from extensions.ext_database import db
    from libs.key_providers import generate_key_pair
    from models.account import Tenant

    # This specialized fixture owns its key and custom C03 context initialization.
    c = raw_ledger_case(native_owner, no_live)
    _, _, app, workflow, _, _ = native_owner
    assert app.id
    assert workflow.id
    db.session.expunge(app)
    db.session.expunge(workflow)
    db.session.close()
    public_key = generate_key_pair(c.actor.tenant_id)
    with c.factory.begin() as session:
        require_instance(session.get(Tenant, c.actor.tenant_id), Tenant).encrypt_public_key = public_key
        request = session.get(DifyBuilderExecutionRequest, c.ref.request_id)
        app_id, workflow_id = (
            require_instance(request, DifyBuilderExecutionRequest).app_id,
            require_instance(request, DifyBuilderExecutionRequest).workflow_id,
        )
        graph = json.loads(require_instance(session.get(Workflow, workflow_id), Workflow).graph)
        snapshot_id = graph["nodes"][-1]["data"]["agent_binding"]["current_snapshot_id"]
        inputs = require_instance(
            session.get(DifyBuilderTestInput, require_present(request).test_input_id), DifyBuilderTestInput
        ).inputs
        revision = require_instance(request, DifyBuilderExecutionRequest).context["execution_revision"]
    loader = OwnedNativeTestLoader(c.factory, actor=c.actor, resolver=c.metadata)
    store = NativeExecutionStateStore(loader)
    context = ResolvedNativeTestContext(
        ref=c.ref,
        tenant_id=c.actor.tenant_id,
        actor_id=c.actor.account_id,
        app_id=app_id,
        workflow_id=workflow_id,
        graph=graph,
        inputs=inputs,
        graph_revision=revision,
        input_revision=canonical_digest(inputs),
        resource_manifest=(),
        generation=0,
        root_native_run_id=str(uuid4()),
        native_run_id=str(uuid4()),
        parent_invocation_id=None,
        call_depth=0,
        budget_ref=c.ref.request_id,
        cancellation_ref=c.ref.request_id,
        execution_mode="native",
    )
    store.initialize_context(context=context)
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
    service = AgentTestWorkspaceService(loader, state_store=store, limits=limits)
    requests: list[CreateExecutionBindingRequest] = []
    scripts: list[str] = []
    scopes: dict[str, NativeScopeSpec] = {}
    cleanups: list[DestroyExecutionBindingRequest] = []
    active_transactions = {}

    def began(session: Session, transaction: SessionTransaction, connection: Connection) -> None:
        del transaction, connection
        active_transactions.setdefault(get_ident(), set()).add(id(session))

    def ended(session: Session, transaction: SessionTransaction) -> None:
        if transaction.parent is None:
            active_transactions.setdefault(get_ident(), set()).discard(id(session))

    event.listen(c.factory.class_, "after_begin", began)
    event.listen(c.factory.class_, "after_transaction_end", ended)

    class Backend:
        lose_ack = False
        fail_before_create = False
        cleanup_failure = False
        after_create: Callable[[], None] | None = None

        def create_execution_binding_sync(
            self, request: CreateExecutionBindingRequest
        ) -> CreateExecutionBindingResponse:
            assert not active_transactions.get(get_ident()), "physical allocation inside SQL transaction"
            # A fresh connection can take the root lock NOWAIT: allocation holds
            # neither its SQL transaction nor the invocation root lock.
            with c.factory.begin() as session:
                session.execute(
                    select(DifyBuilderExecutionRequest)
                    .where(DifyBuilderExecutionRequest.id == c.ref.request_id)
                    .with_for_update(nowait=True)
                )
            requests.append(request)
            if self.fail_before_create:
                raise TimeoutError("allocation request outcome unknown")
            if request.native_scope_reconcile:
                if request.binding_id not in scopes:
                    raise BuilderExecutionPolicyError("native_scope_unavailable")
            else:
                assert request.binding_id not in scopes
                scripts.append(request.binding_id)
                assert request.native_test_scope is not None
                scopes[request.binding_id] = request.native_test_scope
                if self.after_create:
                    self.after_create()
            if self.lose_ack:
                raise TimeoutError("physical allocation ack lost")
            ref = f"native:{request.binding_id}:1"
            return CreateExecutionBindingResponse(binding_ref=ref, workspace_ref=ref)

        def destroy_execution_binding_sync(self, request: DestroyExecutionBindingRequest) -> None:
            assert not active_transactions.get(get_ident()), "physical cleanup inside SQL transaction"
            with c.factory.begin() as session:
                session.execute(
                    select(DifyBuilderExecutionRequest)
                    .where(DifyBuilderExecutionRequest.id == c.ref.request_id)
                    .with_for_update(nowait=True)
                )
            cleanups.append(request)
            if self.cleanup_failure:
                raise RuntimeError("cleanup quarantined")

    backend = Backend()

    @contextmanager
    def client() -> Generator[Backend]:
        yield backend

    monkeypatch.setattr(AgentWorkspaceService, "_client", client)
    yield AgentWorkspaceCase(
        ledger=c,
        service=service,
        ref=c.ref,
        snapshot_id=snapshot_id,
        backend=backend,
        requests=requests,
        scripts=scripts,
        scopes=scopes,
        cleanups=cleanups,
        context=context,
    )
    event.remove(c.factory.class_, "after_begin", began)
    event.remove(c.factory.class_, "after_transaction_end", ended)


def prepare(c: AgentWorkspaceCase) -> AgentTestWorkspaceRef:
    return c.service.prepare(ref=c.ref, pinned_snapshot_id=c.snapshot_id, input_file_refs=())


def allocation(c: AgentWorkspaceCase) -> AgentWorkspaceAllocation:
    with c.ledger.factory() as session:
        row = require_instance(
            session.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == c.ref.request_id)),
            NativeTestInvocation,
        )
        return AgentWorkspaceAllocation.model_validate(row.bindings["_agent_workspace_v1"])


def test_postgres_concurrent_prepare_reserves_one_identity(workspace_case: AgentWorkspaceCase) -> None:
    from flask import current_app

    c = workspace_case
    app = cast("LocalProxy[Flask]", current_app)._get_current_object()

    def run_prepare() -> AgentTestWorkspaceRef:
        with app.app_context():
            return prepare(c)

    entered, release = Event(), Event()

    def blocked() -> None:
        entered.set()
        assert release.wait(15)

    c.backend.after_create = blocked
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run_prepare)
        assert entered.wait(10)
        second = pool.submit(run_prepare)
        try:
            result = second.result(timeout=10)
        finally:
            release.set()
        assert first.result(timeout=10) == result
    assert len(c.scripts) == 1
    assert len({r.binding_id for r in c.requests}) == 1
    with c.ledger.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AgentWorkspaceBinding)
                .where(AgentWorkspaceBinding.id == result.binding_id)
            )
            == 1
        )
        workspace = session.get(AgentWorkspace, result.workspace_id)
        assert require_instance(workspace, AgentWorkspace).owner_id == c.context.native_run_id
        assert require_instance(workspace, AgentWorkspace).owner_scope_key == "native:" + c.ref.invocation_id


@pytest.mark.parametrize("physical_exists", [False, True])
def test_postgres_ambiguous_allocation_only_inspects_same_scope(
    workspace_case: AgentWorkspaceCase, physical_exists: bool
) -> None:
    c = workspace_case
    c.backend.lose_ack = True
    c.backend.fail_before_create = not physical_exists
    with pytest.raises(TimeoutError):
        prepare(c)
    first = allocation(c)
    c.backend.lose_ack = False
    c.backend.fail_before_create = False
    if physical_exists:
        result = prepare(c)
        assert result.binding_id == first.binding_id
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="native_scope_unavailable"):
            prepare(c)
    assert len(c.scripts) == (1 if physical_exists else 0)
    assert c.requests[-1].native_scope_reconcile
    assert all(
        require_instance(r.native_test_scope, NativeScopeSpec).model_dump(mode="json")
        == first.native_scope.model_dump(mode="json")
        for r in c.requests
    )


@pytest.mark.parametrize("mutation", ["cancel", "drift"])
def test_postgres_cancel_or_drift_after_allocation_never_activates(
    workspace_case: AgentWorkspaceCase, mutation: str
) -> None:
    c = workspace_case

    def revoke() -> None:
        with c.ledger.factory.begin() as session:
            if mutation == "cancel":
                assert session is not None
                require_instance(session.get(NativeTestScope, c.ref.request_id), NativeTestScope).cancelled = True
            else:
                workflow = session.get(Workflow, c.context.workflow_id)
                require_instance(workflow, Workflow).graph = json.dumps({"nodes": [], "edges": []})

    c.backend.after_create = revoke
    with pytest.raises(BuilderExecutionPolicyError):
        prepare(c)
    assert len(c.scripts) == 1
    assert len(c.cleanups) == 1
    assert allocation(c).phase == "retired"
    with c.ledger.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AgentWorkspaceBinding)
                .where(AgentWorkspaceBinding.id == allocation(c).binding_id)
            )
            == 0
        )


def test_postgres_cross_tenant_and_snapshot_reject_before_physical_io(workspace_case: AgentWorkspaceCase) -> None:
    c = workspace_case
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.prepare(ref=c.ref, pinned_snapshot_id=str(uuid4()), input_file_refs=())
    from core.dify_builder.models import Actor

    foreign_loader = OwnedNativeTestLoader(
        c.ledger.factory,
        actor=Actor(tenant_id=str(uuid4()), account_id=c.ledger.actor.account_id),
        resolver=c.ledger.metadata,
    )
    foreign = AgentTestWorkspaceService(
        foreign_loader, state_store=NativeExecutionStateStore(foreign_loader), limits=c.service.limits
    )
    with pytest.raises(BuilderExecutionPolicyError):
        foreign.prepare(ref=c.ref, pinned_snapshot_id=c.snapshot_id, input_file_refs=())
    assert not c.requests


def test_postgres_terminal_retirement_settles_and_quarantines_cleanup(workspace_case: AgentWorkspaceCase) -> None:
    c = workspace_case
    result = prepare(c)
    with c.ledger.factory.begin() as session:
        # Requests seal on terminal outcomes; completed is an invocation state.
        assert session is not None
        require_instance(
            session.get(DifyBuilderExecutionRequest, c.ref.request_id), DifyBuilderExecutionRequest
        ).state = "sealed"
        assert session is not None
        require_instance(session.get(NativeTestScope, c.ref.request_id), NativeTestScope).cancelled = True
    c.backend.cleanup_failure = True
    with pytest.raises(RuntimeError, match="quarantined"):
        c.service.retire(ref=c.ref, workspace_ref=result)
    assert allocation(c).phase == "quarantined"
    c.backend.cleanup_failure = False
    c.service.retire(ref=c.ref, workspace_ref=result)
    assert allocation(c).phase == "retired"
    assert len(c.scripts) == 1
    assert all(call.binding_ref == result.backend_binding_ref for call in c.cleanups)
