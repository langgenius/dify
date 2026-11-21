from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.enums import AppTriggerStatus, AppTriggerType
from models.trigger import AppTrigger, WorkflowPluginTrigger
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.subscription_binding_service import TriggerSubscriber, TriggerSubscriptionBinding


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> TriggerSubscriptionRepository:
    return TriggerSubscriptionRepository(session_factory=sqlite_session_factory)


def _binding(node_id: str) -> TriggerSubscriptionBinding:
    return TriggerSubscriptionBinding(
        node_id=node_id,
        provider_id="langgenius/github/github",
        event_name="push",
        subscription_id=str(uuid4()),
    )


def _row(*, tenant_id: str, app_id: str, binding: TriggerSubscriptionBinding) -> WorkflowPluginTrigger:
    return WorkflowPluginTrigger(
        tenant_id=tenant_id,
        app_id=app_id,
        node_id=binding.node_id,
        provider_id=binding.provider_id,
        event_name=binding.event_name,
        subscription_id=binding.subscription_id,
    )


def _trigger(*, tenant_id: str, app_id: str, node_id: str, status: AppTriggerStatus) -> AppTrigger:
    return AppTrigger(
        tenant_id=tenant_id,
        app_id=app_id,
        node_id=node_id,
        trigger_type=AppTriggerType.TRIGGER_PLUGIN,
        title="GitHub event",
        status=status,
    )


def test_sync_applies_delta_and_keeps_existing_binding_ids(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id, app_id = str(uuid4()), str(uuid4())
    original, unchanged, removed = (_binding(node) for node in ("changed", "unchanged", "removed"))
    rows = [_row(tenant_id=tenant_id, app_id=app_id, binding=binding) for binding in (original, unchanged, removed)]
    with sqlite_session_factory.begin() as session:
        session.add_all(rows)
    changed = replace(
        original,
        provider_id="langgenius/gitlab/gitlab",
        event_name="issue",
        subscription_id=str(uuid4()),
    )
    added = _binding("added")
    desired = (changed, unchanged, added)

    with sqlite_session_factory.begin() as session:
        repository.sync_workflow_bindings(session=session, tenant_id=tenant_id, app_id=app_id, bindings=desired)

    with sqlite_session_factory() as session:
        stored = {row.node_id: row for row in session.scalars(select(WorkflowPluginTrigger))}
        assert set(stored) == {binding.node_id for binding in desired}
        assert stored["changed"].id == rows[0].id
        assert stored["unchanged"].id == rows[1].id
        for binding in desired:
            assert stored[binding.node_id].provider_id == binding.provider_id
            assert stored[binding.node_id].event_name == binding.event_name
            assert stored[binding.node_id].subscription_id == binding.subscription_id
        ids = {node_id: row.id for node_id, row in stored.items()}

    with sqlite_session_factory.begin() as session:
        repository.sync_workflow_bindings(session=session, tenant_id=tenant_id, app_id=app_id, bindings=desired)
    with sqlite_session_factory() as session:
        assert {row.node_id: row.id for row in session.scalars(select(WorkflowPluginTrigger))} == ids


@pytest.mark.parametrize("clear", [False, True])
def test_sync_scopes_updates_and_deletes_to_tenant_and_app(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    clear: bool,
) -> None:
    tenant_id, app_id = str(uuid4()), str(uuid4())
    original = _binding("target")
    target = _row(tenant_id=tenant_id, app_id=app_id, binding=original)
    decoys = [
        _row(tenant_id=str(uuid4()), app_id=app_id, binding=_binding("other-tenant")),
        _row(tenant_id=tenant_id, app_id=str(uuid4()), binding=original),
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([target, *decoys])
    replacement = replace(original, event_name="issue", subscription_id=str(uuid4()))

    with sqlite_session_factory.begin() as session:
        repository.sync_workflow_bindings(
            session=session,
            tenant_id=tenant_id,
            app_id=app_id,
            bindings=() if clear else (replacement,),
        )

    with sqlite_session_factory() as session:
        rows = {row.id: row for row in session.scalars(select(WorkflowPluginTrigger))}
        assert set(rows) == {row.id for row in decoys} | (set() if clear else {target.id})
        for decoy in decoys:
            assert rows[decoy.id].subscription_id == decoy.subscription_id
            assert rows[decoy.id].event_name == decoy.event_name
        if not clear:
            assert rows[target.id].subscription_id == replacement.subscription_id
            assert rows[target.id].event_name == replacement.event_name


def test_sync_borrows_callers_transaction_and_does_not_commit(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id, app_id = str(uuid4()), str(uuid4())
    original, removed = _binding("changed"), _binding("removed")
    rows = [_row(tenant_id=tenant_id, app_id=app_id, binding=binding) for binding in (original, removed)]
    with sqlite_session_factory.begin() as session:
        session.add_all(rows)
    caller_write = _trigger(tenant_id=tenant_id, app_id=app_id, node_id="caller-write", status=AppTriggerStatus.ENABLED)

    with sqlite_session_factory() as session:
        session.add(caller_write)
        repository.sync_workflow_bindings(
            session=session,
            tenant_id=tenant_id,
            app_id=app_id,
            bindings=(replace(original, event_name="issue"), _binding("added")),
        )
        session.flush()
        assert session.in_transaction()
        assert {row.node_id for row in session.scalars(select(WorkflowPluginTrigger))} == {"changed", "added"}
        session.rollback()

    with sqlite_session_factory() as session:
        stored = {row.id: row for row in session.scalars(select(WorkflowPluginTrigger))}
        assert set(stored) == {row.id for row in rows}
        assert stored[rows[0].id].event_name == original.event_name
        assert stored[rows[1].id].subscription_id == removed.subscription_id
        assert session.get(AppTrigger, caller_write.id) is None


@pytest.mark.parametrize(
    "mismatch",
    [
        "binding_tenant",
        "subscription",
        "event",
        "trigger_tenant",
        "trigger_app",
        "trigger_node",
        "missing_trigger",
        "disabled",
        "unauthorized",
        "rate_limited",
    ],
)
def test_subscriber_query_requires_complete_binding_scope_and_enabled_trigger(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    mismatch: str,
) -> None:
    tenant_id, app_id = str(uuid4()), str(uuid4())
    target_binding = _binding("target")
    target = _row(tenant_id=tenant_id, app_id=app_id, binding=target_binding)
    enabled = _trigger(
        tenant_id=tenant_id, app_id=app_id, node_id=target_binding.node_id, status=AppTriggerStatus.ENABLED
    )
    decoy = _row(tenant_id=tenant_id, app_id=app_id, binding=replace(target_binding, node_id="decoy"))
    decoy_trigger = _trigger(tenant_id=tenant_id, app_id=app_id, node_id=decoy.node_id, status=AppTriggerStatus.ENABLED)
    if mismatch == "binding_tenant":
        decoy.tenant_id = str(uuid4())
        decoy_trigger.tenant_id = decoy.tenant_id
    elif mismatch == "subscription":
        decoy.subscription_id = str(uuid4())
    elif mismatch == "event":
        decoy.event_name = "issue"
    elif mismatch == "trigger_tenant":
        decoy_trigger.tenant_id = str(uuid4())
    elif mismatch == "trigger_app":
        decoy_trigger.app_id = str(uuid4())
    elif mismatch == "trigger_node":
        decoy_trigger.node_id = "not-the-bound-node"
    elif mismatch in {"disabled", "unauthorized", "rate_limited"}:
        decoy_trigger.status = AppTriggerStatus(mismatch)
    with sqlite_session_factory.begin() as session:
        session.add_all([target, enabled, decoy])
        if mismatch != "missing_trigger":
            session.add(decoy_trigger)

    assert repository.get_subscriber_triggers(
        tenant_id=tenant_id, subscription_id=target_binding.subscription_id, event_name=target_binding.event_name
    ) == (TriggerSubscriber(id=target.id, tenant_id=tenant_id, app_id=app_id, node_id=target_binding.node_id),)


def test_subscribers_are_detached_immutable_values_and_release_connection(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    tenant_id = str(uuid4())
    binding = _binding("event")
    rows = [_row(tenant_id=tenant_id, app_id=str(uuid4()), binding=binding) for _ in range(2)]
    with sqlite_session_factory.begin() as session:
        session.add_all(rows)
        session.add_all(
            _trigger(tenant_id=tenant_id, app_id=row.app_id, node_id=row.node_id, status=AppTriggerStatus.ENABLED)
            for row in rows
        )

    subscribers = repository.get_subscriber_triggers(
        tenant_id=tenant_id, subscription_id=binding.subscription_id, event_name=binding.event_name
    )

    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    assert pool.checkedout() == 0
    assert isinstance(subscribers, tuple)
    assert set(subscribers) == {
        TriggerSubscriber(id=row.id, tenant_id=tenant_id, app_id=row.app_id, node_id=row.node_id) for row in rows
    }
    with sqlite_session_factory.begin() as session:
        session.execute(delete(WorkflowPluginTrigger))
    assert {subscriber.id for subscriber in subscribers} == {row.id for row in rows}
    assert (
        repository.get_subscriber_triggers(
            tenant_id=tenant_id, subscription_id=binding.subscription_id, event_name=binding.event_name
        )
        == ()
    )
    assert pool.checkedout() == 0
