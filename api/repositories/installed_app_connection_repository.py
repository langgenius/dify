"""Bounded persistence for Installed App member choices and non-secret credential metadata."""

import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialType
from context.connection_execution import ConnectionExecutionContext, WorkspaceConnectionScope
from core.app.entities.app_invoke_entities import InvokeFrom
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

    @staticmethod
    def _graph(
        session: Session,
        scope: WorkspaceConnectionScope,
        *,
        workflow_id: str | None = None,
        conversation_id: str | None = None,
        lock: bool = False,
    ) -> InstalledConnectionGraph:
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
        if lock:
            statement = statement.with_for_update()
        row = session.execute(statement).one_or_none()
        if row is None:
            raise ConnectionIdentityError()
        installation, app, workflow = row
        if workflow_id is not None and workflow.id != workflow_id:
            raise ConnectionRevisionChangedError()
        if conversation_id is not None:
            if (
                app.mode != AppMode.ADVANCED_CHAT
                or session.scalar(
                    select(Conversation.id).where(
                        Conversation.id == conversation_id,
                        Conversation.app_id == app.id,
                        Conversation.mode == AppMode.ADVANCED_CHAT,
                        Conversation.from_account_id == scope.account_id,
                        Conversation.from_end_user_id.is_(None),
                        Conversation.from_source == ConversationFromSource.CONSOLE,
                        Conversation.invoke_from == InvokeFrom.EXPLORE,
                        Conversation.is_deleted.is_(False),
                        Conversation.status == "normal",
                    )
                )
                is None
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

    def graph(
        self, scope: WorkspaceConnectionScope, *, workflow_id: str | None = None, conversation_id: str | None = None
    ) -> InstalledConnectionGraph:
        with self._sessions() as session:
            return self._graph(session, scope, workflow_id=workflow_id, conversation_id=conversation_id)

    @staticmethod
    def _connections(
        session: Session, scope: WorkspaceConnectionScope, providers: tuple[str, ...]
    ) -> tuple[ConnectionSummary, ...]:
        statement = select(
            BuiltinToolProvider.id,
            BuiltinToolProvider.name,
            BuiltinToolProvider.provider,
            BuiltinToolProvider.credential_type,
            BuiltinToolProvider.created_at,
            BuiltinToolProvider.updated_at,
            BuiltinToolProvider.expires_at,
        ).where(BuiltinToolProvider.tenant_id == scope.tenant_id, BuiltinToolProvider.provider.in_(providers))
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
            return self._connections(session, scope, providers)

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
        current = cls._graph(session, scope, workflow_id=graph.workflow_id, conversation_id=conversation_id, lock=True)
        if current != graph:
            raise ConnectionRevisionChangedError()
        from services.workflow.tool_credentials import get_tool_connection_requirements

        requirements = get_tool_connection_requirements(graph.graph)
        if configuration.connections.keys() - {item.node_id for item in requirements}:
            raise ConnectionConfigurationError()
        records = {
            item.id: item for item in cls._connections(session, scope, tuple(item.provider for item in requirements))
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
        saved = session.scalar(cls._configuration_statement(scope, conversation_id))
        if saved is None:
            saved = InstalledAppConnectionConfiguration(
                tenant_id=scope.tenant_id,
                installed_app_id=scope.installed_app_id,
                app_id=graph.installation.app_id,
                account_id=scope.account_id,
                scope_id=conversation_id or "",
                connection_revision=configuration.connection_revision,
                connections="{}",
            )
            session.add(saved)
        saved.connection_revision = configuration.connection_revision
        saved.connections = json.dumps(dict(configuration.connections))

    def save(
        self,
        scope: WorkspaceConnectionScope,
        graph: InstalledConnectionGraph,
        configuration: InstalledConnectionConfiguration,
        conversation_id: str | None,
    ) -> None:
        with self._sessions.begin() as session:
            self._save(session, scope, graph, configuration, conversation_id)

    @classmethod
    def initialize_conversation(
        cls, session: Session, execution: ConnectionExecutionContext, conversation: Conversation
    ) -> None:
        scope = execution.workspace
        if scope is None or conversation.from_account_id != scope.account_id or conversation.app_id != execution.app_id:
            raise ConnectionIdentityError()
        graph = cls._graph(
            session, scope, workflow_id=execution.workflow_id, conversation_id=conversation.id, lock=True
        )
        cls._save(
            session,
            scope,
            graph,
            InstalledConnectionConfiguration(
                execution.connection_revision, {item.node_id: item.connection_id for item in execution.selections}
            ),
            conversation.id,
        )
