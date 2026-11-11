"""Real PostgreSQL contention tests for member-scoped Installed App choices."""

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, select, text, update
from sqlalchemy.engine import Connection
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import ORMExecuteState, Session, SessionTransaction, sessionmaker

from extensions.ext_database import db
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.installed_app_connection import InstalledAppConnectionConfiguration
from models.model import App, Conversation, InstalledApp
from models.tools import BuiltinToolProvider
from models.workflow import Workflow
from repositories.installed_app_connection_repository import SQLAlchemyInstalledConnectionRepository
from services.end_user_connections.errors import ConnectionIdentityError, ConnectionRevisionChangedError
from services.installed_app_connections import InstalledConnectionConfiguration
from tests.helpers.installed_app_connections import (
    InstalledConnectionData,
    member_conversation,
    seed_installed_connections,
)


@pytest.fixture
def cases(
    flask_req_ctx: object,
) -> Iterator[tuple[sessionmaker[Session], InstalledConnectionData, InstalledConnectionData]]:
    """Seed isolated real records and bound every transaction's lock wait."""
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)

    def bound_lock_wait(_session: Session, _transaction: SessionTransaction, connection: Connection) -> None:
        connection.execute(text("SET LOCAL lock_timeout = '2s'"))
        connection.execute(text("SET LOCAL statement_timeout = '5s'"))

    event.listen(sessions, "after_begin", bound_lock_wait)
    first = seed_installed_connections(sessions)
    second = seed_installed_connections(sessions, tenant=first.tenant, account=first.account)
    try:
        yield sessions, first, second
    finally:
        with sessions.begin() as session:
            tenant_id = first.tenant.id
            account_ids = [first.account.id, first.other.id, second.other.id]
            session.execute(
                delete(InstalledAppConnectionConfiguration).where(
                    InstalledAppConnectionConfiguration.tenant_id == tenant_id
                )
            )
            session.execute(delete(Conversation).where(Conversation.app_id.in_([first.app.id, second.app.id])))
            session.execute(delete(BuiltinToolProvider).where(BuiltinToolProvider.tenant_id == tenant_id))
            session.execute(delete(Workflow).where(Workflow.tenant_id == tenant_id))
            session.execute(delete(InstalledApp).where(InstalledApp.tenant_id == tenant_id))
            session.execute(delete(App).where(App.tenant_id == tenant_id))
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == tenant_id))
            session.execute(delete(Account).where(Account.id.in_(account_ids)))
            session.execute(delete(Tenant).where(Tenant.id == tenant_id))
        event.remove(sessions, "after_begin", bound_lock_wait)


@pytest.mark.parametrize("independent_scope", ["app", "member", "conversation", "defaults_and_conversation"])
def test_independent_scope_commits_while_first_save_remains_open(cases, independent_scope):
    sessions, first, second = cases
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sessions)
    first_scope, second_scope = first.scope, first.scope
    first_graph = repository.graph(first_scope)
    second_graph = first_graph
    first_conversation_id, second_conversation_id = None, None
    configuration = first.configuration
    if independent_scope == "app":
        second_scope = second.scope
        second_graph = repository.graph(second_scope)
        configuration = second.configuration
    elif independent_scope == "member":
        second_scope = first.scope.model_copy(update={"account_id": first.other.id})
    else:
        with sessions.begin() as session:
            conversations = [member_conversation(first), member_conversation(first)]
            session.add_all(conversations)
        first_conversation_id = conversations[0].id if independent_scope == "conversation" else None
        second_conversation_id = conversations[1].id
    with ThreadPoolExecutor(max_workers=1) as executor:
        with sessions.begin() as session:
            repository._save(session, first_scope, first_graph, first.configuration, first_conversation_id)
            future = executor.submit(repository.save, second_scope, second_graph, configuration, second_conversation_id)
            future.result(timeout=8)
            assert repository.configuration(second_scope, second_conversation_id) == configuration


def test_new_conversation_initializations_do_not_serialize_on_workspace(cases):
    sessions, first, _second = cases
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sessions)

    def initialize() -> str:
        with sessions.begin() as session:
            conversation = member_conversation(first)
            session.add(conversation)
            session.flush()
            repository.initialize_conversation(session, first.execution, conversation)
            return conversation.id

    with ThreadPoolExecutor(max_workers=1) as executor:
        with sessions.begin() as session:
            conversation = member_conversation(first)
            session.add(conversation)
            session.flush()
            repository.initialize_conversation(session, first.execution, conversation)
            second_id = executor.submit(initialize).result(timeout=8)
            assert repository.configuration(first.scope, second_id) == first.configuration


@pytest.mark.parametrize("existing", [False, True])
def test_concurrent_first_or_existing_saves_commit_one_complete_configuration(cases, existing):
    sessions, first, _second = cases
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sessions)
    graph = repository.graph(first.scope)
    if existing:
        repository.save(first.scope, graph, first.configuration, None)
    configurations = (
        InstalledConnectionConfiguration(str(uuid4()), {"root": None}),
        InstalledConnectionConfiguration(str(uuid4()), {}),
    )
    barrier = Barrier(2, timeout=8)

    def synchronize_insert(state: ORMExecuteState) -> None:
        if state.is_insert:
            barrier.wait()

    event.listen(sessions, "do_orm_execute", synchronize_insert)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(repository.save, first.scope, graph, config, None) for config in configurations]
            for future in futures:
                future.result(timeout=10)
    finally:
        event.remove(sessions, "do_orm_execute", synchronize_insert)
    assert repository.configuration(first.scope, None) in configurations
    with sessions() as session:
        assert len(session.scalars(select(InstalledAppConnectionConfiguration)).all()) == 1


def test_same_scope_waits_for_its_configuration_writer(cases):
    sessions, first, _second = cases
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sessions)
    graph = repository.graph(first.scope)
    with ThreadPoolExecutor(max_workers=1) as executor:
        with sessions.begin() as session:
            repository._save(session, first.scope, graph, first.configuration, None)
            future = executor.submit(repository.save, first.scope, graph, first.configuration, None)
            with pytest.raises(OperationalError, match="lock timeout"):
                future.result(timeout=8)
    assert repository.configuration(first.scope, None) == first.configuration


@pytest.mark.parametrize("change", ["tenant", "account", "member", "installation", "publication", "workflow"])
def test_invalidation_waits_for_configuration_commit(cases, change):
    sessions, first, _second = cases
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sessions)
    graph = repository.graph(first.scope)
    statements = {
        "tenant": update(Tenant).where(Tenant.id == first.tenant.id).values(status=TenantStatus.ARCHIVE),
        "account": update(Account).where(Account.id == first.account.id).values(status=AccountStatus.BANNED),
        "member": delete(TenantAccountJoin).where(TenantAccountJoin.account_id == first.account.id),
        "installation": delete(InstalledApp).where(InstalledApp.id == first.installation.id),
        "publication": update(App).where(App.id == first.app.id).values(workflow_id=None),
        "workflow": update(Workflow).where(Workflow.id == first.workflow.id).values(graph='{"nodes":[],"edges":[]}'),
    }

    def invalidate() -> None:
        with sessions.begin() as session:
            session.execute(statements[change])

    with ThreadPoolExecutor(max_workers=1) as executor:
        with sessions.begin() as session:
            repository._save(session, first.scope, graph, first.configuration, None)
            with pytest.raises(OperationalError, match="lock timeout"):
                executor.submit(invalidate).result(timeout=8)
    assert repository.configuration(first.scope, None) == first.configuration
    invalidate()
    with pytest.raises((ConnectionIdentityError, ConnectionRevisionChangedError)):
        repository.save(first.scope, graph, first.configuration, None)


def test_publication_committed_after_transaction_snapshot_is_detected(cases):
    sessions, first, _second = cases
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sessions)
    graph = repository.graph(first.scope)
    with sessions.begin() as session:
        session.get(App, first.app.id)
        with sessions.begin() as publisher:
            publisher.execute(update(App).where(App.id == first.app.id).values(workflow_id=None))
        with pytest.raises(ConnectionRevisionChangedError):
            repository._save(session, first.scope, graph, first.configuration, None)
        assert session.scalar(select(InstalledAppConnectionConfiguration.id)) is None
