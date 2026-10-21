"""NORMAL CI ONLY. Real PostgreSQL/encryption/root-lock S1 tests.

Never import/collect/run locally. Backend allocation remains the existing explicit
fixture double; this suite proves no physical READY/Redis/Agent execution.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NotRequired, Unpack, cast

from dify_agent.protocol.native_testing import ReadAgentRuntimeIdentity
from flask import Flask
from pydantic import JsonValue
from typing_extensions import TypedDict
from werkzeug.local import LocalProxy

from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader

if TYPE_CHECKING:
    import services.dify_builder.native_testing.repository as _forward_types_1
    import services.dify_builder.native_testing.state_store as _forward_types_0


from typing import TYPE_CHECKING

from runtime_contracts.builder.native.agent_contracts import AgentCreateExisting, AgentCreateInserted
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance

if TYPE_CHECKING:
    from services.dify_builder.native_testing.repository import OwnedNativeTest
    from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
        AgentAssociationCase,
    )

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import (
        test_builder_native_agent_associations as _fixture_types_0,
    )


from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from dify_agent.protocol.native_testing import (
    AgentPrepareRunPayload,
    AgentRuntimeIdentity,
)
from flask import current_app
from sqlalchemy import select

from models.agent import AgentConfigSnapshot, AgentWorkingResourceStatus, AgentWorkspace
from models.dify_builder_native_tests import NativePayloadObject
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.agent_contracts import AgentDefinitionReceipt
from services.dify_builder.native_testing.agent_preparation import (
    AgentPreparationService,
)
from services.dify_builder.native_testing.agent_runtime_config import (
    NativeAgentRuntimeConfigBuilder,
)
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest
from services.dify_builder.native_testing.state_store import ObjectReceipt
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
    AgentAssociationCase,
    require_present,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_agent_associations import (
    association_case as association_case,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_agent_associations import (
    base_native_owner as base_native_owner,  # noqa: PLC0414 - fixture dependency
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_agent_associations import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414 - fixture dependency
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_agent_associations import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414 - fixture dependency
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_agent_associations import (
    native_owner as native_owner,  # noqa: PLC0414 - fixture dependency
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_agent_associations import (
    no_live as no_live,  # noqa: PLC0414 - fixture dependency
)

CONFIG: dict[str, JsonValue] = {"composition": {"schema_version": 2, "layers": []}, "session_snapshot": None}


def definition_receipt(c: AgentAssociationCase) -> AgentDefinitionReceipt:
    nodes = c.context.graph["nodes"]
    assert isinstance(nodes, list)
    node = nodes[-1]
    assert isinstance(node, dict)
    node_id = node["id"]
    assert isinstance(node_id, str)
    definition = NativeAgentRuntimeConfigBuilder(loader=c.loader).load_definition(context=c.context, node_id=node_id)
    return AgentDefinitionReceipt(node_id, definition.stamp)


def claim(
    c: AgentAssociationCase, receipt: AgentDefinitionReceipt | None = None
) -> AgentCreateExisting | AgentCreateInserted:
    return c.store.claim_agent_create(
        ref=c.ref,
        parent_node=c.parent,
        expected_invocation_generation=0,
        config=CONFIG,
        definition_receipt=receipt if receipt is not None else definition_receipt(c),
    )


def test_real_pg_encrypted_claim_lost_ack_is_discovery_never_second_authority(
    association_case: _fixture_types_0.AgentAssociationCase,
) -> None:
    c = association_case
    first = claim(c)
    assert first.kind == "inserted"
    # Original ACK intentionally discarded. Same logical call has no POST authority.
    repeated = claim(c)
    assert repeated.kind == "existing"
    assert repeated.config_ref == first.config_ref
    assert c.store.discover_agent_run(ref=c.ref, parent_node=c.parent) is None
    owned = c.store.load_prepared_config(ref=c.ref, parent_node=c.parent, config_ref=first.config_ref)
    assert owned.config == CONFIG
    assert owned.workspace == c.workspace
    with c.factory() as session:
        rows = session.scalars(
            select(NativePayloadObject).where(NativePayloadObject.logical_key.like("agent-config:%"))
        ).all()
        assert len(rows) == 1
    assert c.allocation_calls == [c.workspace.binding_id]


def test_real_pg_concurrent_initial_reservation_has_one_local_post_owner(
    association_case: _fixture_types_0.AgentAssociationCase,
) -> None:
    c = association_case
    app = cast("LocalProxy[Flask]", current_app)._get_current_object()

    def attempt(_index) -> AgentCreateExisting | AgentCreateInserted:
        with app.app_context():
            return claim(c)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    assert sorted(item.kind for item in results) == ["existing", "inserted"]
    assert len({item.config_ref for item in results}) == 1
    assert len(c.allocation_calls) == 1


@pytest.mark.parametrize("mutation", ["workspace", "snapshot", "generation", "parent-input"])
def test_real_pg_mutation_during_crypto_storage_prevents_config_ack(
    association_case: _fixture_types_0.AgentAssociationCase, monkeypatch: pytest.MonkeyPatch, mutation: str
) -> None:
    c = association_case
    original = c.store.prepare_object

    def mutate(**kwargs: Unpack[_ForwardArguments142]) -> ObjectReceipt:
        receipt = original(**kwargs)
        with c.factory.begin() as session:
            if mutation == "workspace":
                require_instance(
                    session.get(AgentWorkspace, c.workspace.workspace_id), AgentWorkspace
                ).status = AgentWorkingResourceStatus.RETIRED
            elif mutation == "snapshot":
                row = session.get(AgentConfigSnapshot, c.workspace.pinned_snapshot_id)
                require_instance(row, AgentConfigSnapshot).config_snapshot = {
                    **require_instance(row, AgentConfigSnapshot).config_snapshot_dict,
                    "config_note": "changed during IO",
                }
            elif mutation == "generation":
                from models.dify_builder_native_tests import NativeInvocationState

                row = session.scalar(
                    select(NativeInvocationState).where(NativeInvocationState.invocation_id == c.ref.invocation_id)
                )
                require_instance(row, NativeInvocationState).generation += 1
            else:
                row = session.get(NativePayloadObject, c.parent.input_result_ref)
                require_instance(row, NativePayloadObject).storage_key = "foreign-object"
        return receipt

    monkeypatch.setattr(c.store, "prepare_object", mutate)
    with pytest.raises(BuilderExecutionPolicyError):
        claim(c)
    with c.factory() as session:
        assert (
            session.scalar(select(NativePayloadObject).where(NativePayloadObject.logical_key.like("agent-config:%")))
            is None
        )


def test_real_pg_callback_same_run_idempotent_foreign_run_conflicts_after_readback(
    association_case: _fixture_types_0.AgentAssociationCase,
) -> None:
    c = association_case
    reserved = claim(c)
    calls = []

    class Backend:
        def read_run_identity_sync(self, run_id: str, selection: ReadAgentRuntimeIdentity) -> AgentRuntimeIdentity:
            # SQL writer is not open while authenticated backend read is in flight.
            calls.append(run_id)
            return AgentRuntimeIdentity(
                run_id=run_id,
                execution_mode="builder_test",
                parent_node=selection.parent_node,
                request_digest=selection.request_digest,
                agent_generation=0,
            )

    service = AgentPreparationService(c.store, Backend(), None, None)
    payload = AgentPrepareRunPayload(
        parent_node=c.parent.model_dump(mode="json"),
        agent_run_id=str(uuid4()),
        request_digest=reserved.config_digest,
    )
    first = service.bind_created_run(payload=payload)
    assert service.bind_created_run(payload=payload) == first
    assert (
        require_present(c.store.discover_agent_run(ref=c.ref, parent_node=c.parent)).agent_run_id
        == payload.agent_run_id
    )
    with pytest.raises(BuilderExecutionPolicyError):
        service.bind_created_run(payload=payload.model_copy(update={"agent_run_id": str(uuid4())}))
    assert len(calls) == 3


@pytest.mark.parametrize("resource", ["snapshot", "node-job"])
@pytest.mark.parametrize("boundary", ["loader", "private-read"])
def test_real_pg_initial_claim_io_cannot_restamp_older_composed_definition(
    association_case: _fixture_types_0.AgentAssociationCase,
    monkeypatch: pytest.MonkeyPatch,
    resource: str,
    boundary: str,
) -> None:
    """CI-only SQL mutation before claim's first resource capture; no local collection."""
    from models.agent import WorkflowAgentNodeBinding
    from services.dify_builder.native_testing import state_store as state

    c = association_case
    receipt = definition_receipt(c)
    changed: list[bool] = []

    def mutate() -> None:
        if changed:
            return
        changed.append(True)
        with c.factory.begin() as session:
            if resource == "snapshot":
                row = session.get(AgentConfigSnapshot, c.workspace.pinned_snapshot_id)
                require_instance(row, AgentConfigSnapshot).config_snapshot = {
                    **require_instance(row, AgentConfigSnapshot).config_snapshot_dict,
                    "config_note": "changed before initial stamp",
                }
            else:
                row = session.scalar(
                    select(WorkflowAgentNodeBinding).where(
                        WorkflowAgentNodeBinding.workflow_id == c.context.workflow_id,
                        WorkflowAgentNodeBinding.node_id == receipt.node_id,
                    )
                )
                require_instance(row, WorkflowAgentNodeBinding).node_job_config = {
                    **require_instance(row, WorkflowAgentNodeBinding).node_job_config_dict,
                    "workflow_prompt": "Changed before initial stamp",
                }

    if boundary == "loader":
        original_load = c.loader.load

        def load(**kwargs: Unpack[_ForwardArguments255]) -> OwnedNativeTest | PrivateReadOwner:
            mutate()
            return original_load(**kwargs)

        monkeypatch.setattr(c.loader, "load", load)
    else:
        original_read = state.validate_private_read

        def read(loader: OwnedNativeTestLoader, ref: NativeTestContextRef) -> PrivateReadOwner:
            mutate()
            return original_read(loader, ref)

        monkeypatch.setattr(state, "validate_private_read", read)
    with pytest.raises(BuilderExecutionPolicyError):
        claim(c, receipt)
    assert changed == [True]
    with c.factory() as session:
        assert (
            session.scalar(select(NativePayloadObject).where(NativePayloadObject.logical_key.like("agent-config:%")))
            is None
        )


class _ForwardArguments142(TypedDict, closed=True):
    ref: _forward_types_0.NativeTestContextRef
    tenant_id: str
    kind: _forward_types_0.PayloadKind
    logical_key: str
    payload: _forward_types_0.JsonValue
    max_bytes: NotRequired[int | None]


class _ForwardArguments255(TypedDict, closed=True):
    ref: _forward_types_1.NativeTestContextRef
