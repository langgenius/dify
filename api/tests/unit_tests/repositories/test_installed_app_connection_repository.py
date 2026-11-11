"""Owner-chain protection and scope-local configuration replacement contracts."""

from dataclasses import asdict
from uuid import uuid4

import pytest
from sqlalchemy import Table, delete, event, select, update
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql import Select

from core.plugin.entities.plugin_daemon import CredentialType
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.enums import ConversationFromSource, PermissionEnum
from models.installed_app_connection import InstalledAppConnectionConfiguration
from models.model import App, AppMode, Conversation, InstalledApp, Message
from models.tools import BuiltinToolProvider
from models.workflow import Workflow
from repositories.installed_app_connection_repository import SQLAlchemyInstalledConnectionRepository
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionRevisionChangedError,
)
from services.errors.conversation import ConversationNotExistsError
from services.installed_app_connections import InstalledConnectionConfiguration
from tests.helpers.installed_app_connections import (
    InstalledConnectionData,
    member_conversation,
    seed_installed_connections,
)


@pytest.fixture
def data(sqlite_session_factory: sessionmaker[Session]) -> InstalledConnectionData:
    return seed_installed_connections(sqlite_session_factory)


def test_replacements_preserve_row_identity_and_member_session_scope(sqlite_session_factory, data):
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    graph = repository.graph(data.scope)
    with sqlite_session_factory.begin() as session:
        conversation = member_conversation(data)
        session.add(conversation)
    other_scope = data.scope.model_copy(update={"account_id": data.other.id})
    repository.save(data.scope, graph, data.configuration, None)
    repository.save(other_scope, graph, data.configuration, None)
    repository.save(data.scope, graph, data.configuration, conversation.id)
    with sqlite_session_factory() as session:
        original = session.scalar(repository._configuration_statement(data.scope, None))
        assert original is not None
        original_id = original.id
    replacement = InstalledConnectionConfiguration(str(uuid4()), {})
    repository.save(data.scope, graph, replacement, None)
    repository.save(data.scope, graph, replacement, None)
    assert repository.configuration(data.scope, None) == replacement
    assert repository.configuration(other_scope, None) == data.configuration
    assert repository.configuration(data.scope, conversation.id) == data.configuration
    with sqlite_session_factory() as session:
        saved = session.scalar(repository._configuration_statement(data.scope, None))
        assert saved is not None
        assert saved.id == original_id
        assert "token" not in saved.connections
        assert len(session.scalars(select(InstalledAppConnectionConfiguration)).all()) == 3


@pytest.mark.parametrize("owner_field", ["tenant_id", "app_id"])
def test_conflicting_owner_is_not_overwritten(sqlite_session_factory, data, owner_field):
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    graph = repository.graph(data.scope)
    saved = InstalledAppConnectionConfiguration(
        tenant_id=data.tenant.id,
        installed_app_id=data.installation.id,
        app_id=data.app.id,
        account_id=data.account.id,
        scope_id="",
        connection_revision=data.revision,
        connections="{}",
    )
    foreign_owner = str(uuid4())
    setattr(saved, owner_field, foreign_owner)
    with sqlite_session_factory.begin() as session:
        session.add(saved)
    with pytest.raises(ConnectionIdentityError):
        repository.save(data.scope, graph, data.configuration, None)
    with sqlite_session_factory() as session:
        unchanged = session.get(InstalledAppConnectionConfiguration, saved.id)
        assert unchanged is not None
        assert getattr(unchanged, owner_field) == foreign_owner
        assert unchanged.connections == "{}"


@pytest.mark.parametrize(
    "change", ["tenant", "account", "member", "installation", "app_owner", "mode", "workflow_owner", "draft"]
)
def test_save_rechecks_identity_after_graph_read(sqlite_session_factory, data, change):
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    graph = repository.graph(data.scope)
    statements = {
        "tenant": update(Tenant).where(Tenant.id == data.tenant.id).values(status=TenantStatus.ARCHIVE),
        "account": update(Account).where(Account.id == data.account.id).values(status=AccountStatus.BANNED),
        "member": delete(TenantAccountJoin).where(TenantAccountJoin.account_id == data.account.id),
        "installation": delete(InstalledApp).where(InstalledApp.id == data.installation.id),
        "app_owner": update(App).where(App.id == data.app.id).values(tenant_id=str(uuid4())),
        "mode": update(App).where(App.id == data.app.id).values(mode=AppMode.CHAT),
        "workflow_owner": update(Workflow).where(Workflow.id == data.workflow.id).values(app_id=str(uuid4())),
        "draft": update(Workflow).where(Workflow.id == data.workflow.id).values(version=Workflow.VERSION_DRAFT),
    }
    with sqlite_session_factory.begin() as session:
        session.execute(statements[change])
    with pytest.raises(ConnectionIdentityError):
        repository.save(data.scope, graph, data.configuration, None)
    with sqlite_session_factory() as session:
        assert session.scalar(select(InstalledAppConnectionConfiguration.id)) is None


@pytest.mark.parametrize("change", ["publication", "graph"])
def test_protection_uses_current_projection_not_stale_orm_identity(sqlite_session_factory, data, change):
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    graph = repository.graph(data.scope)
    with sqlite_session_factory.begin() as session:
        app = session.get(App, data.app.id)
        workflow = session.get(Workflow, data.workflow.id)
        assert app is not None
        assert workflow is not None
        statement = (
            update(App).where(App.id == app.id).values(workflow_id=str(uuid4()))
            if change == "publication"
            else update(Workflow).where(Workflow.id == workflow.id).values(graph='{"nodes":[],"edges":[]}')
        )
        session.execute(statement.execution_options(synchronize_session=False))
        assert app.workflow_id == graph.workflow_id
        assert workflow.graph_dict == graph.graph
        with pytest.raises(ConnectionRevisionChangedError):
            repository._save(session, data.scope, graph, data.configuration, None)
        assert session.scalar(select(InstalledAppConnectionConfiguration.id)) is None


@pytest.mark.parametrize("change", ["owner", "deleted", "source"])
def test_conversation_ownership_is_rechecked(sqlite_session_factory, data, change):
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    graph = repository.graph(data.scope)
    with sqlite_session_factory.begin() as session:
        conversation = member_conversation(data)
        if change == "owner":
            conversation.from_account_id = data.other.id
        elif change == "deleted":
            conversation.is_deleted = True
        else:
            conversation.from_source = ConversationFromSource.API
        session.add(conversation)
    with pytest.raises(ConversationNotExistsError):
        repository.save(data.scope, graph, data.configuration, conversation.id)


@pytest.mark.parametrize("change", ["visibility", "provider", "type", "missing", "unknown_node"])
def test_save_revalidates_only_explicit_credential_selections(sqlite_session_factory, data, change):
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    graph = repository.graph(data.scope)
    with sqlite_session_factory.begin() as session:
        credential = session.get(BuiltinToolProvider, data.credential.id)
        assert credential is not None
        if change == "visibility":
            credential.user_id = data.other.id
            credential.visibility = PermissionEnum.ONLY_ME
        elif change == "provider":
            credential.provider = "vendor/other/other"
        elif change == "type":
            credential.credential_type = CredentialType.API_KEY
        elif change == "missing":
            session.delete(credential)
    configuration = (
        InstalledConnectionConfiguration(data.revision, {"unknown": data.credential.id})
        if change == "unknown_node"
        else data.configuration
    )
    with pytest.raises(ConnectionConfigurationError):
        repository.save(data.scope, graph, configuration, None)


@pytest.mark.parametrize("initialize", [False, True])
def test_write_paths_use_one_shared_single_table_protection_pass(sqlite_session_factory, data, initialize):
    repository = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    statements: list[Select] = []

    def observe(state: ORMExecuteState) -> None:
        if isinstance(state.statement, Select):
            statements.append(state.statement)

    event.listen(sqlite_session_factory, "do_orm_execute", observe)
    try:
        if initialize:
            with sqlite_session_factory.begin() as session:
                conversation = member_conversation(data)
                session.add(conversation)
                session.flush()
                repository.initialize_conversation(session, data.execution, conversation)
        else:
            repository.save(data.scope, repository.graph(data.scope), data.configuration, None)
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", observe)
    for dialect, shared_clause in [(postgresql.dialect(), "FOR SHARE"), (mysql.dialect(), "LOCK IN SHARE MODE")]:
        protected_tables = []
        for statement in statements:
            sql = str(statement.compile(dialect=dialect))
            assert "FOR UPDATE" not in sql
            if shared_clause in sql:
                tables = statement.get_final_froms()
                assert len(tables) == 1
                assert isinstance(tables[0], Table)
                protected_tables.append(tables[0].name)
        expected = ["tenants", "accounts", "tenant_account_joins", "installed_apps", "apps", "workflows"]
        assert protected_tables == expected + (["conversations"] if initialize else [])
    credential_reads = [statement for statement in statements if "tool_builtin_providers" in str(statement)]
    assert len(credential_reads) == 1
    credential_sql = str(credential_reads[0].compile(compile_kwargs={"literal_binds": True}))
    assert f"tool_builtin_providers.id IN ('{data.credential.id}')" in credential_sql
    assert "encrypted_credentials" not in credential_sql


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect(), sqlite.dialect()])
def test_first_save_insert_preserves_conflicting_row(dialect, data):
    row = InstalledAppConnectionConfiguration(
        tenant_id=data.tenant.id,
        installed_app_id=data.installation.id,
        app_id=data.app.id,
        account_id=data.account.id,
        scope_id="",
        connection_revision=data.revision,
        connections="{}",
    )
    statement = SQLAlchemyInstalledConnectionRepository._configuration_insert_statement(dialect.name, asdict(row))
    sql = str(statement.compile(dialect=dialect))
    if dialect.name == "mysql":
        assert "ON DUPLICATE KEY UPDATE id = installed_app_connection_configurations.id" in sql
    else:
        assert "ON CONFLICT (installed_app_id, account_id, scope_id) DO NOTHING" in sql


@pytest.mark.parametrize("failure", ["configuration", "outer_transaction"])
def test_initialization_does_not_commit_conversation_or_message(sqlite_session_factory, data, failure):
    execution = data.execution
    if failure == "configuration":
        execution = execution.model_copy(
            update={"selections": (execution.selections[0].model_copy(update={"connection_id": str(uuid4())}),)}
        )
    error = ConnectionConfigurationError if failure == "configuration" else RuntimeError
    conversation = member_conversation(data)
    message = Message(
        app_id=data.app.id,
        conversation_id=conversation.id,
        from_account_id=data.account.id,
        from_source=conversation.from_source,
        query="Hello",
        answer="",
        message="",
        _inputs={},
    )

    def initialize_and_abort() -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all([conversation, message])
            session.flush()
            SQLAlchemyInstalledConnectionRepository.initialize_conversation(session, execution, conversation)
            assert session.scalar(select(InstalledAppConnectionConfiguration.id)) is not None
            raise RuntimeError("Abort the caller's transaction")

    with pytest.raises(error):
        initialize_and_abort()
    with sqlite_session_factory() as session:
        assert session.get(Conversation, conversation.id) is None
        assert session.get(Message, message.id) is None
        assert session.scalar(select(InstalledAppConnectionConfiguration.id)) is None
