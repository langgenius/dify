"""Bounded persistence for Installed App member choices and non-secret credential metadata."""

import json
from collections.abc import Mapping
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.dml import Insert

from constants.end_user_connections import ConnectionCredentialType
from context.connection_execution import ConnectionExecutionContext, WorkspaceConnectionScope
from core.app.entities.app_invoke_entities import InvokeFrom
from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.credential_permission import CredentialType
from models.enums import ConversationFromSource
from models.installed_app_connection import InstalledAppConnectionConfiguration
from models.model import App, AppMode, Conversation, InstalledApp
from models.tools import BuiltinToolProvider
from models.workflow import Workflow
from repositories.credentials.query_repository import apply_credential_visibility_filter_for_actor
from services.end_user_connections.contracts import ConnectionSummary
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionRevisionChangedError,
)
from services.errors.conversation import ConversationNotExistsError
from services.installed_app_access_service import InstalledAppRef
from services.installed_app_connections import InstalledConnectionConfiguration, InstalledConnectionGraph


class SQLAlchemyInstalledConnectionRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    @classmethod
    def _graph(
        cls,
        session: Session,
        scope: WorkspaceConnectionScope,
        *,
        workflow_id: str | None = None,
        conversation_id: str | None = None,
    ) -> InstalledConnectionGraph:
        """Read the current owner chain and publication without acquiring row locks.

        Accept an admitted member scope and optional expected publication/session.
        Return a detached graph or raise the existing identity, revision, or
        conversation error without writing any state.
        """
        statement = (
            select(InstalledApp, App, Workflow)
            .join(App, App.id == InstalledApp.app_id)
            .join(
                Workflow,
                (Workflow.id == App.workflow_id) & (Workflow.tenant_id == App.tenant_id) & (Workflow.app_id == App.id),
            )
            .join(
                TenantAccountJoin,
                (TenantAccountJoin.tenant_id == InstalledApp.tenant_id)
                & (TenantAccountJoin.account_id == scope.account_id),
            )
            .join(Account, Account.id == TenantAccountJoin.account_id)
            .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
            .where(
                InstalledApp.id == scope.installed_app_id,
                InstalledApp.tenant_id == scope.tenant_id,
                App.tenant_id == scope.tenant_id,
                App.mode.in_((AppMode.ADVANCED_CHAT, AppMode.WORKFLOW)),
                Workflow.version != Workflow.VERSION_DRAFT,
                Account.status == AccountStatus.ACTIVE,
                Tenant.status == TenantStatus.NORMAL,
            )
        )
        row = session.execute(statement).one_or_none()
        if row is None:
            raise ConnectionIdentityError()
        installation, app, workflow = row
        if workflow_id is not None and workflow.id != workflow_id:
            raise ConnectionRevisionChangedError()
        if conversation_id is not None:
            if (
                app.mode != AppMode.ADVANCED_CHAT
                or session.scalar(cls._conversation_statement(scope, app.id, conversation_id)) is None
            ):
                raise ConversationNotExistsError()
        return InstalledConnectionGraph(
            InstalledAppRef(
                id=installation.id,
                app_id=app.id,
                tenant_id=installation.tenant_id,
                app_owner_tenant_id=app.tenant_id,
                app_mode=app.mode,
            ),
            workflow.id,
            workflow.graph_dict,
        )

    @staticmethod
    def _conversation_statement(scope: WorkspaceConnectionScope, app_id: str, conversation_id: str):
        """Select only a live Explore conversation owned by the admitted member."""
        return select(Conversation.id).where(
            Conversation.id == conversation_id,
            Conversation.app_id == app_id,
            Conversation.mode == AppMode.ADVANCED_CHAT,
            Conversation.from_account_id == scope.account_id,
            Conversation.from_end_user_id.is_(None),
            Conversation.from_source == ConversationFromSource.CONSOLE,
            Conversation.invoke_from == InvokeFrom.EXPLORE,
            Conversation.is_deleted.is_(False),
            Conversation.status == "normal",
        )

    @classmethod
    def _protect_graph(
        cls,
        session: Session,
        scope: WorkspaceConnectionScope,
        graph: InstalledConnectionGraph,
        conversation_id: str | None,
    ) -> None:
        """Protect a previously read owner chain and graph until the caller commits.

        Require an active write transaction. Acquire single-table shared locks in
        tenant/account/member/installation/app/workflow/conversation order, so
        independent configuration writers remain compatible. Locking projections
        read current values even with an existing ORM identity or MySQL snapshot.
        Raise an identity, revision, or conversation error before any write if the
        owner chain or publication changed. The caller owns rollback on failure.
        """
        installation = graph.installation
        if (
            installation.id != scope.installed_app_id
            or installation.tenant_id != scope.tenant_id
            or installation.app_owner_tenant_id != scope.tenant_id
        ):
            raise ConnectionIdentityError()
        identity_statements = (
            select(Tenant.id).where(Tenant.id == scope.tenant_id, Tenant.status == TenantStatus.NORMAL),
            select(Account.id).where(Account.id == scope.account_id, Account.status == AccountStatus.ACTIVE),
            select(TenantAccountJoin.id).where(
                TenantAccountJoin.tenant_id == scope.tenant_id,
                TenantAccountJoin.account_id == scope.account_id,
            ),
            select(InstalledApp.id).where(
                InstalledApp.id == scope.installed_app_id,
                InstalledApp.tenant_id == scope.tenant_id,
                InstalledApp.app_id == installation.app_id,
            ),
        )
        for statement in identity_statements:
            if session.scalar(statement.with_for_update(read=True)) is None:
                raise ConnectionIdentityError()
        app = session.execute(
            select(App.mode, App.workflow_id)
            .where(
                App.id == installation.app_id,
                App.tenant_id == scope.tenant_id,
                App.mode.in_((AppMode.ADVANCED_CHAT, AppMode.WORKFLOW)),
            )
            .with_for_update(read=True)
        ).one_or_none()
        if app is None:
            raise ConnectionIdentityError()
        if app.workflow_id != graph.workflow_id or app.mode != installation.app_mode:
            raise ConnectionRevisionChangedError()
        workflow_graph = session.scalar(
            select(Workflow.graph)
            .where(
                Workflow.id == graph.workflow_id,
                Workflow.tenant_id == scope.tenant_id,
                Workflow.app_id == installation.app_id,
                Workflow.version != Workflow.VERSION_DRAFT,
            )
            .with_for_update(read=True)
        )
        if workflow_graph is None:
            raise ConnectionIdentityError()
        if json.loads(workflow_graph) != graph.graph:
            raise ConnectionRevisionChangedError()
        if conversation_id is not None and (
            app.mode != AppMode.ADVANCED_CHAT
            or session.scalar(
                cls._conversation_statement(scope, installation.app_id, conversation_id).with_for_update(read=True)
            )
            is None
        ):
            raise ConversationNotExistsError()

    def graph(
        self, scope: WorkspaceConnectionScope, *, workflow_id: str | None = None, conversation_id: str | None = None
    ) -> InstalledConnectionGraph:
        with self._sessions() as session:
            return self._graph(session, scope, workflow_id=workflow_id, conversation_id=conversation_id)

    @staticmethod
    def _connections(
        session: Session,
        scope: WorkspaceConnectionScope,
        providers: tuple[str, ...],
        *,
        connection_ids: frozenset[str] | None,
    ) -> tuple[ConnectionSummary, ...]:
        """Read visible credential metadata without secrets or row locks.

        None selects all credentials for the providers; a set restricts the read
        to explicit selections, including an empty set for an empty configuration.
        """
        statement = select(
            BuiltinToolProvider.id,
            BuiltinToolProvider.name,
            BuiltinToolProvider.provider,
            BuiltinToolProvider.credential_type,
            BuiltinToolProvider.created_at,
            BuiltinToolProvider.updated_at,
            BuiltinToolProvider.expires_at,
        ).where(BuiltinToolProvider.tenant_id == scope.tenant_id, BuiltinToolProvider.provider.in_(providers))
        if connection_ids is not None:
            statement = statement.where(BuiltinToolProvider.id.in_(connection_ids))
        statement = apply_credential_visibility_filter_for_actor(
            statement,
            tenant_id=scope.tenant_id,
            model_id_column=BuiltinToolProvider.id,
            model_user_id_column=BuiltinToolProvider.user_id,
            model_visibility_column=BuiltinToolProvider.visibility,
            credential_type=CredentialType.BUILTIN_TOOL_PROVIDER,
            actor_id=scope.account_id,
        )
        return tuple(
            ConnectionSummary(
                id=row.id,
                name=row.name,
                provider=row.provider,
                credential_type=ConnectionCredentialType(row.credential_type),
                credential_status=None,
                account_label=None,
                created_at=row.created_at,
                updated_at=row.updated_at,
                last_active_at=None,
                expires_at=datetime.fromtimestamp(row.expires_at, UTC).replace(tzinfo=None)
                if row.expires_at > 0
                else None,
            )
            for row in session.execute(statement)
        )

    def connections(self, scope: WorkspaceConnectionScope, providers: tuple[str, ...]) -> tuple[ConnectionSummary, ...]:
        with self._sessions() as session:
            self._graph(session, scope)
            return self._connections(session, scope, providers, connection_ids=None)

    @staticmethod
    def _configuration_statement(scope: WorkspaceConnectionScope, conversation_id: str | None):
        return select(InstalledAppConnectionConfiguration).where(
            InstalledAppConnectionConfiguration.tenant_id == scope.tenant_id,
            InstalledAppConnectionConfiguration.installed_app_id == scope.installed_app_id,
            InstalledAppConnectionConfiguration.account_id == scope.account_id,
            InstalledAppConnectionConfiguration.scope_id == (conversation_id or ""),
        )

    def configuration(
        self, scope: WorkspaceConnectionScope, conversation_id: str | None
    ) -> InstalledConnectionConfiguration | None:
        with self._sessions() as session:
            graph = self._graph(session, scope, conversation_id=conversation_id)
            saved = session.scalar(self._configuration_statement(scope, conversation_id))
            if saved is None or saved.app_id != graph.installation.app_id:
                return None
            return InstalledConnectionConfiguration(saved.connection_revision, json.loads(saved.connections))

    @classmethod
    def _save(
        cls,
        session: Session,
        scope: WorkspaceConnectionScope,
        graph: InstalledConnectionGraph,
        configuration: InstalledConnectionConfiguration,
        conversation_id: str | None,
    ) -> None:
        """Stage one complete member configuration in the caller's transaction.

        Require a previously read graph. Parse before locking, then protect its
        owner chain/publication and recheck selected credential visibility. Only
        the configuration's unique member/session scope is exclusively written.
        Failure leaves commit/rollback to the caller and never grants access.
        """
        from services.workflow.tool_credentials import get_tool_connection_requirements

        requirements = get_tool_connection_requirements(graph.graph)
        if configuration.connections.keys() - {item.node_id for item in requirements}:
            raise ConnectionConfigurationError()
        saved = InstalledAppConnectionConfiguration(
            tenant_id=scope.tenant_id,
            installed_app_id=scope.installed_app_id,
            app_id=graph.installation.app_id,
            account_id=scope.account_id,
            scope_id=conversation_id or "",
            connection_revision=configuration.connection_revision,
            connections=json.dumps(dict(configuration.connections)),
        )
        cls._protect_graph(session, scope, graph, conversation_id)
        records = {
            item.id: item
            for item in cls._connections(
                session,
                scope,
                tuple(item.provider for item in requirements),
                connection_ids=frozenset(value for value in configuration.connections.values() if value is not None),
            )
        }
        for requirement in requirements:
            connection_id = configuration.connections.get(requirement.node_id)
            if connection_id is not None:
                record = records.get(connection_id)
                if (
                    record is None
                    or record.provider != requirement.provider
                    or record.credential_type not in requirement.allowed_credential_types
                ):
                    raise ConnectionConfigurationError()
        session.execute(cls._configuration_insert_statement(session.get_bind().dialect.name, asdict(saved)))
        result = session.execute(
            update(InstalledAppConnectionConfiguration)
            .where(
                InstalledAppConnectionConfiguration.tenant_id == scope.tenant_id,
                InstalledAppConnectionConfiguration.installed_app_id == scope.installed_app_id,
                InstalledAppConnectionConfiguration.app_id == graph.installation.app_id,
                InstalledAppConnectionConfiguration.account_id == scope.account_id,
                InstalledAppConnectionConfiguration.scope_id == (conversation_id or ""),
            )
            .values(
                connection_revision=saved.connection_revision,
                connections=saved.connections,
                updated_at=naive_utc_now(),
            )
        )
        assert isinstance(result, CursorResult)
        if result.rowcount != 1:
            raise ConnectionIdentityError()

    @staticmethod
    def _configuration_insert_statement(dialect_name: str, values: Mapping[str, Any]) -> Insert:
        """Ensure a configuration exists without overwriting conflicting ownership.

        Accept complete model values and a supported database dialect. The owner
        unique key arbitrates concurrent first saves; the caller must follow with
        a fully scoped update in the same transaction. Unsupported dialects fail
        explicitly, and existing rows are left unchanged.
        """
        owner_key = ["installed_app_id", "account_id", "scope_id"]
        if dialect_name == "postgresql":
            return (
                postgresql_insert(InstalledAppConnectionConfiguration)
                .values(**values)
                .on_conflict_do_nothing(index_elements=owner_key)
            )
        if dialect_name == "mysql":
            return (
                mysql_insert(InstalledAppConnectionConfiguration)
                .values(**values)
                .on_duplicate_key_update(id=InstalledAppConnectionConfiguration.id)
            )
        if dialect_name == "sqlite":
            return (
                sqlite_insert(InstalledAppConnectionConfiguration)
                .values(**values)
                .on_conflict_do_nothing(index_elements=owner_key)
            )
        raise ValueError(f"Unsupported configuration database dialect: {dialect_name}")

    def save(
        self,
        scope: WorkspaceConnectionScope,
        graph: InstalledConnectionGraph,
        configuration: InstalledConnectionConfiguration,
        conversation_id: str | None,
    ) -> None:
        """Commit a validated complete configuration, rolling back on any failure.

        Require a graph obtained for this member scope. Shared identity/publication
        locks and the configuration owner unique key serialize only conflicting
        operations; concurrent saves of one scope retain last-writer-wins semantics.
        """
        with self._sessions.begin() as session:
            self._save(session, scope, graph, configuration, conversation_id)

    @classmethod
    def initialize_conversation(
        cls, session: Session, execution: ConnectionExecutionContext, conversation: Conversation
    ) -> None:
        """Stage initial selections with a new, flushed member-owned conversation.

        Validate the execution publication and owner chain once under shared locks.
        Never commit the supplied session: the conversation, message, and choices
        remain atomic, and the caller rolls all of them back on failure.
        """
        scope = execution.workspace
        if scope is None or conversation.from_account_id != scope.account_id or conversation.app_id != execution.app_id:
            raise ConnectionIdentityError()
        graph = cls._graph(session, scope, workflow_id=execution.workflow_id, conversation_id=conversation.id)
        cls._save(
            session,
            scope,
            graph,
            InstalledConnectionConfiguration(
                execution.connection_revision, {item.node_id: item.connection_id for item in execution.selections}
            ),
            conversation.id,
        )
