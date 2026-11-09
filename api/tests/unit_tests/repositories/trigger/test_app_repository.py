"""Exercise app trigger ownership and transaction boundaries with real SQLite."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App, AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from repositories.trigger.app_repository import SQLAlchemyAppTriggerRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.trigger.app_trigger_store import AppTriggerNotFoundError, WebhookTriggerNotFoundError

_CREATED_AT = datetime(2026, 10, 20, 8, 0)


@dataclass(frozen=True)
class TriggerScope:
    context: RequestContext
    app_id: str
    trigger_id: str
    webhook_id: str
    node_id: str


@pytest.fixture
def scope(sqlite_session_factory: sessionmaker[Session]) -> TriggerScope:
    context = RequestContext("request", None, str(uuid4()), str(uuid4()))
    with sqlite_session_factory.begin() as session:
        app = App(
            tenant_id=context.active_workspace_id,
            name="Workflow",
            mode=AppMode.WORKFLOW,
            enable_site=True,
            enable_api=True,
        )
        session.add(app)
        session.flush()
        trigger = AppTrigger(
            tenant_id=context.active_workspace_id,
            app_id=app.id,
            node_id="webhook-node",
            trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
            title="Webhook",
            provider_name=None,
            status=AppTriggerStatus.ENABLED,
        )
        webhook = WorkflowWebhookTrigger(
            tenant_id=context.active_workspace_id,
            app_id=app.id,
            node_id=trigger.node_id or "",
            webhook_id="webhook-endpoint",
            created_by=context.account_id,
        )
        trigger.created_at = _CREATED_AT
        webhook.created_at = _CREATED_AT
        session.add_all([trigger, webhook])
        session.flush()
        # The insert default replaces None with ""; existing rows may still be NULL.
        trigger.provider_name = None
        session.flush()
        return TriggerScope(context, app.id, trigger.id, webhook.id, webhook.node_id)


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyAppTriggerRepository:
    return SQLAlchemyAppTriggerRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def open_connections(sqlite_engine: Engine) -> Iterator[set[object]]:
    connections: set[object] = set()

    def checkout(connection: object, *_args: object) -> None:
        connections.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        connections.remove(connection)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield connections
        assert not connections
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_reads_return_detached_records_and_release_connections(
    repository: SQLAlchemyAppTriggerRepository,
    scope: TriggerScope,
    open_connections: set[object],
) -> None:
    triggers = repository.list_triggers(scope.context, scope.app_id)
    assert not open_connections
    webhook = repository.get_webhook(scope.context, scope.app_id, scope.node_id)
    assert not open_connections

    assert len(triggers) == 1
    trigger = triggers[0]
    assert trigger.id == scope.trigger_id
    assert trigger.trigger_type == AppTriggerType.TRIGGER_WEBHOOK
    assert trigger.title == "Webhook"
    assert trigger.node_id == scope.node_id
    assert trigger.provider_name is None
    assert trigger.status == AppTriggerStatus.ENABLED
    assert trigger.created_at == _CREATED_AT
    assert webhook.id == scope.webhook_id
    assert webhook.webhook_id == "webhook-endpoint"
    assert webhook.node_id == scope.node_id
    assert webhook.created_at == _CREATED_AT

    repository.set_enabled(scope.context, scope.app_id, scope.trigger_id, enabled=False)
    # Existing query results remain snapshots even after the database changes.
    assert trigger.status == AppTriggerStatus.ENABLED
    assert not open_connections


@pytest.mark.parametrize("operation", ["get_webhook", "list_triggers", "set_enabled"])
@pytest.mark.parametrize("visibility", ["missing", "other_workspace", "disabled", "wrong_mode", "hidden_agent"])
def test_operations_require_visible_workflow_in_current_workspace(
    repository: SQLAlchemyAppTriggerRepository,
    sqlite_session_factory: sessionmaker[Session],
    scope: TriggerScope,
    operation: str,
    visibility: str,
    open_connections: set[object],
) -> None:
    context = scope.context
    app_id = scope.app_id
    with sqlite_session_factory.begin() as session:
        if visibility == "missing":
            app_id = str(uuid4())
        elif visibility == "other_workspace":
            context = context._replace(active_workspace_id=str(uuid4()))
        elif visibility == "disabled":
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})
        elif visibility == "wrong_mode":
            session.get_one(App, app_id).mode = AppMode.CHAT
        else:
            session.get_one(App, app_id).mode = AppMode.AGENT
            session.add(
                Agent(
                    tenant_id=context.active_workspace_id,
                    name="Workflow-only",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                    backing_app_id=app_id,
                )
            )

    if operation == "get_webhook":
        run = partial(repository.get_webhook, context, app_id, scope.node_id)
    elif operation == "list_triggers":
        run = partial(repository.list_triggers, context, app_id)
    else:
        run = partial(repository.set_enabled, context, app_id, scope.trigger_id, enabled=False)
    with pytest.raises(ConsoleAppNotFoundError) as raised:
        run()
    assert not open_connections
    if visibility == "wrong_mode":
        assert str(raised.value) == "App mode is not in the supported list: {'workflow'}"
    else:
        assert str(raised.value) == "App not found"
    with sqlite_session_factory() as session:
        assert session.get_one(AppTrigger, scope.trigger_id).status == AppTriggerStatus.ENABLED


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "node_id"])
def test_webhook_lookup_requires_complete_owner_chain_and_node(
    repository: SQLAlchemyAppTriggerRepository,
    sqlite_session_factory: sessionmaker[Session],
    scope: TriggerScope,
    field: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        webhook = session.get_one(WorkflowWebhookTrigger, scope.webhook_id)
        if field == "tenant_id":
            webhook.tenant_id = str(uuid4())
        elif field == "app_id":
            webhook.app_id = str(uuid4())
        else:
            webhook.node_id = "other-node"

    with pytest.raises(WebhookTriggerNotFoundError, match="Webhook trigger not found for this node"):
        repository.get_webhook(scope.context, scope.app_id, scope.node_id)


def test_list_preserves_stable_order_and_excludes_foreign_records(
    repository: SQLAlchemyAppTriggerRepository,
    sqlite_session_factory: sessionmaker[Session],
    scope: TriggerScope,
) -> None:
    with sqlite_session_factory.begin() as session:
        older = session.get_one(AppTrigger, scope.trigger_id)
        records = [
            AppTrigger(
                tenant_id=scope.context.active_workspace_id,
                app_id=scope.app_id,
                node_id=f"node-{index}",
                trigger_type=trigger_type,
                title=f"Trigger {index}",
                provider_name="provider" if trigger_type == AppTriggerType.TRIGGER_PLUGIN else "",
            )
            for index, trigger_type in enumerate(
                [AppTriggerType.TRIGGER_PLUGIN, AppTriggerType.TRIGGER_SCHEDULE, AppTriggerType.UNKNOWN]
            )
        ]
        for record in records:
            record.created_at = _CREATED_AT + timedelta(days=1)
        foreign_workspace = AppTrigger(
            tenant_id=str(uuid4()),
            app_id=scope.app_id,
            node_id="foreign-workspace",
            trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
            title="Foreign workspace",
        )
        foreign_app = AppTrigger(
            tenant_id=scope.context.active_workspace_id,
            app_id=str(uuid4()),
            node_id="foreign-app",
            trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
            title="Foreign app",
        )
        session.add_all([*records, foreign_workspace, foreign_app])
        session.flush()
        expected_ids = sorted([record.id for record in records], reverse=True) + [older.id]

    result = repository.list_triggers(scope.context, scope.app_id)

    assert [record.id for record in result] == expected_ids
    assert {record.trigger_type for record in result} == set(AppTriggerType)


def test_empty_app_has_no_triggers(
    repository: SQLAlchemyAppTriggerRepository, sqlite_session_factory: sessionmaker[Session], scope: TriggerScope
) -> None:
    with sqlite_session_factory.begin() as session:
        session.delete(session.get_one(AppTrigger, scope.trigger_id))

    assert repository.list_triggers(scope.context, scope.app_id) == ()


@pytest.mark.parametrize("enabled", [True, False])
@pytest.mark.parametrize("initial_status", list(AppTriggerStatus))
def test_enable_disable_commits_only_status_and_returns_persisted_timestamps(
    repository: SQLAlchemyAppTriggerRepository,
    sqlite_session_factory: sessionmaker[Session],
    scope: TriggerScope,
    enabled: bool,
    initial_status: AppTriggerStatus,
    open_connections: set[object],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(AppTrigger, scope.trigger_id).status = initial_status

    result = repository.set_enabled(scope.context, scope.app_id, scope.trigger_id, enabled=enabled)
    assert not open_connections

    with sqlite_session_factory() as session:
        stored = session.get_one(AppTrigger, scope.trigger_id)
        assert stored.status == (AppTriggerStatus.ENABLED if enabled else AppTriggerStatus.DISABLED)
        assert result.status == stored.status
        assert result.created_at == stored.created_at == _CREATED_AT
        assert result.updated_at == stored.updated_at
        assert stored.tenant_id == scope.context.active_workspace_id
        assert stored.app_id == scope.app_id
        assert stored.title == "Webhook"
        assert stored.node_id == scope.node_id
        assert stored.provider_name is None
        assert session.scalar(select(WorkflowWebhookTrigger.id)) == scope.webhook_id


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "id"])
def test_status_update_requires_complete_owner_chain_and_trigger(
    repository: SQLAlchemyAppTriggerRepository,
    sqlite_session_factory: sessionmaker[Session],
    scope: TriggerScope,
    field: str,
) -> None:
    trigger_id = scope.trigger_id
    with sqlite_session_factory.begin() as session:
        trigger = session.get_one(AppTrigger, trigger_id)
        if field == "tenant_id":
            trigger.tenant_id = str(uuid4())
        elif field == "app_id":
            trigger.app_id = str(uuid4())
        else:
            trigger_id = str(uuid4())

    with pytest.raises(AppTriggerNotFoundError, match="Trigger not found"):
        repository.set_enabled(scope.context, scope.app_id, trigger_id, enabled=False)

    with sqlite_session_factory() as session:
        assert session.get_one(AppTrigger, scope.trigger_id).status == AppTriggerStatus.ENABLED


def test_failed_status_write_rolls_back_and_releases_connection(
    repository: SQLAlchemyAppTriggerRepository,
    sqlite_session_factory: sessionmaker[Session],
    scope: TriggerScope,
    open_connections: set[object],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(
            text(
                "CREATE TRIGGER reject_trigger_update BEFORE UPDATE ON app_triggers "
                "BEGIN SELECT RAISE(ABORT, 'trigger update rejected'); END"
            )
        )

    with pytest.raises(IntegrityError, match="trigger update rejected"):
        repository.set_enabled(scope.context, scope.app_id, scope.trigger_id, enabled=False)
    assert not open_connections
    with sqlite_session_factory() as session:
        assert session.get_one(AppTrigger, scope.trigger_id).status == AppTriggerStatus.ENABLED
