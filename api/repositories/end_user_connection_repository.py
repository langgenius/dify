"""Owner-scoped Connection storage; external I/O never runs in these transactions."""

from collections.abc import Mapping
from datetime import datetime
from hashlib import sha256
from typing import Any, cast

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only, sessionmaker

from constants.end_user_connections import (
    ConnectionCredentialStatus,
    ConnectionCredentialType,
    OAuthClientSource,
)
from context.connection_execution import ConnectionExecutionContext
from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus
from models.end_user_connection import (
    AppConnection,
    EndUserConnection,
    EndUserConnectionRevision,
    EndUserConnectionRevisionAcceptance,
    SessionConnection,
)
from models.enums import AppStatus, ConversationFromSource, ConversationStatus, EndUserType, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser
from models.provider_ids import ToolProviderID
from models.tools import ToolOAuthSystemClient, ToolOAuthTenantClient
from models.workflow import Workflow
from services.end_user_connections.contracts import ConnectionPage, ConnectionSummary, ListConnectionsInput
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionMutationGuard,
    ConnectionOAuthClient,
    ConnectionOwner,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionIdentityError,
    ConnectionReauthorizationRequiredError,
    ConnectionRevisionChangedError,
)
from services.end_user_connections.management import ConnectionChanges, StoredConnection
from services.end_user_connections.oauth import (
    ConnectionOAuthAttempt,
    ConnectionOAuthGrant,
    StoredOAuthClientConfiguration,
)
from services.end_user_connections.revision import (
    AuthorizationRequirementSnapshot,
    ConnectionContractSnapshot,
    ConnectionRevisionAcceptance,
    OAuthClientContractSnapshot,
)
from services.end_user_connections.selections import SavedConnectionSelection
from services.errors.conversation import ConversationNotExistsError
from services.workflow.tool_credentials import get_tool_authorization_requirements


class EndUserConnectionRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def save_revision(self, snapshot: ConnectionContractSnapshot) -> str:
        canonical = snapshot.canonical_json()
        fingerprint = sha256(canonical.encode()).hexdigest()
        scope = (
            EndUserConnectionRevision.tenant_id == snapshot.tenant_id,
            EndUserConnectionRevision.app_id == snapshot.app_id,
            EndUserConnectionRevision.fingerprint == fingerprint,
        )
        with self._sessions.begin() as session:
            existing = session.scalar(sa.select(EndUserConnectionRevision.id).where(*scope))
            if existing is not None:
                return existing
            row = EndUserConnectionRevision(
                fingerprint=fingerprint,
                tenant_id=snapshot.tenant_id,
                app_id=snapshot.app_id,
                snapshot=canonical,
            )
            try:
                with session.begin_nested():
                    session.add(row)
                    session.flush()
            except IntegrityError:
                # Concurrent discovery must reuse the winner's ID, not the losing UUID.
                existing = session.scalar(sa.select(EndUserConnectionRevision.id).where(*scope).with_for_update())
                if existing is None:
                    raise
                return existing
            return row.id

    def get_revision(self, tenant_id: str, app_id: str, revision: str) -> ConnectionContractSnapshot | None:
        with self._sessions() as session:
            payload = session.scalar(
                sa.select(EndUserConnectionRevision.snapshot).where(
                    EndUserConnectionRevision.id == revision,
                    EndUserConnectionRevision.tenant_id == tenant_id,
                    EndUserConnectionRevision.app_id == app_id,
                )
            )
        return ConnectionContractSnapshot.model_validate_json(payload) if payload is not None else None

    def record_revision_acceptance(
        self, context: WebConnectionContext, acceptance: ConnectionRevisionAcceptance
    ) -> None:
        """Continue a validated execution's consent without consulting a newer publication."""
        with self._sessions.begin() as session:
            self._require_context(session, context, lock=True)
            self._record_revision_acceptance(session, context, acceptance)

    @staticmethod
    def _record_revision_acceptance(
        session: Session, context: WebConnectionContext, acceptance: ConnectionRevisionAcceptance
    ) -> None:
        """Write under the caller's EndUser lock and transaction, preserving first provenance."""
        existing = session.scalar(
            sa.select(EndUserConnectionRevisionAcceptance.id).where(
                EndUserConnectionRevisionAcceptance.tenant_id == context.tenant_id,
                EndUserConnectionRevisionAcceptance.app_id == context.app_id,
                EndUserConnectionRevisionAcceptance.end_user_id == context.end_user_id,
                EndUserConnectionRevisionAcceptance.revision_id == acceptance.revision_id,
            )
        )
        if existing is not None:
            return
        revisions = {acceptance.revision_id}
        if acceptance.source_revision_id is not None:
            revisions.add(acceptance.source_revision_id)
        scoped = set(
            session.scalars(
                sa.select(EndUserConnectionRevision.id).where(
                    EndUserConnectionRevision.id.in_(revisions),
                    EndUserConnectionRevision.tenant_id == context.tenant_id,
                    EndUserConnectionRevision.app_id == context.app_id,
                )
            )
        )
        if scoped != revisions:
            raise ConnectionRevisionChangedError()
        session.add(
            EndUserConnectionRevisionAcceptance(
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                end_user_id=context.end_user_id,
                revision_id=acceptance.revision_id,
                reason=acceptance.reason,
                source_revision_id=acceptance.source_revision_id,
            )
        )
        session.flush()

    @staticmethod
    def disconnect_oauth_client_connections(
        session: Session,
        *,
        tenant_id: str | None,
        provider: str,
        source: OAuthClientSource,
        configuration_id: str,
    ) -> int:
        """Invalidate grants in the Client owner's transaction without external I/O."""
        if source == OAuthClientSource.WORKSPACE and tenant_id is None:
            raise ValueError("Workspace OAuth Client invalidation requires a tenant.")
        scope = [
            EndUserConnection.provider == provider,
            EndUserConnection.credential_type == ConnectionCredentialType.OAUTH2,
            EndUserConnection.oauth_client_source == source,
            EndUserConnection.oauth_client_configuration_id == configuration_id,
        ]
        if tenant_id is not None:
            scope.append(EndUserConnection.tenant_id == tenant_id)
        changed = cast(
            CursorResult,
            session.execute(
                sa.update(EndUserConnection)
                .where(*scope)
                .values(
                    {
                        "status": ConnectionCredentialStatus.RECONNECT_REQUIRED,
                        "encrypted_credentials": "",
                        "expires_at": None,
                        "revision": EndUserConnection.revision + 1,
                        "updated_at": naive_utc_now(),
                    }
                )
                .execution_options(synchronize_session=False)
            ),
        ).rowcount
        # Lock grants before live choices, matching Run acceptance. Correlated
        # deletes also avoid loading every grant or expanding large ID lists.
        if changed:
            for selection in (AppConnection, SessionConnection):
                session.execute(
                    sa.delete(selection)
                    .where(
                        sa.exists(
                            sa.select(EndUserConnection.id).where(
                                *scope,
                                EndUserConnection.id == selection.connection_id,
                                EndUserConnection.tenant_id == selection.tenant_id,
                            )
                        )
                    )
                    .execution_options(synchronize_session=False)
                )
        return changed

    @staticmethod
    def _owner(owner: ConnectionOwner) -> tuple[sa.ColumnElement[bool], ...]:
        return (
            EndUserConnection.account_id == owner.account_id
            if owner.account_id is not None
            else EndUserConnection.account_id.is_(None),
            EndUserConnection.end_user_id == owner.end_user_id
            if owner.end_user_id is not None
            else EndUserConnection.end_user_id.is_(None),
        )

    @staticmethod
    def _require_context(session: Session, context: WebConnectionContext, *, lock: bool) -> App:
        stmt = (
            sa.select(App)
            .join(EndUser, sa.and_(EndUser.app_id == App.id, EndUser.tenant_id == App.tenant_id))
            .where(
                App.id == context.app_id,
                App.tenant_id == context.tenant_id,
                App.status == AppStatus.NORMAL,
                App.enable_site.is_(True),
                App.mode.in_((AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)),
                EndUser.id == context.end_user_id,
                EndUser.type == EndUserType.BROWSER,
                EndUser.account_id == context.account_id
                if context.account_id is not None
                else EndUser.account_id.is_(None),
            )
        )
        if lock:
            stmt = stmt.with_for_update()
        app = session.scalar(stmt)
        if app is None:
            raise ConnectionIdentityError()
        if context.account_id is not None:
            account = sa.select(Account.id).where(
                Account.id == context.account_id,
                Account.status.in_((AccountStatus.ACTIVE, AccountStatus.UNINITIALIZED)),
            )
            if lock:
                account = account.with_for_update()
            if session.scalar(account) is None:
                raise ConnectionIdentityError()
        return app

    def published_graph(self, context: WebConnectionContext) -> tuple[str, Mapping[str, Any]]:
        return self.preflight_graph(context, None, None)

    @staticmethod
    def _require_workflow_scope(
        session: Session,
        context: WebConnectionContext,
        app: App,
        workflow_id: str,
        conversation_id: str | None,
    ) -> Workflow:
        def workflow(reference: str | None) -> Workflow | None:
            return session.scalar(
                sa.select(Workflow).where(
                    Workflow.id == reference,
                    Workflow.app_id == context.app_id,
                    Workflow.tenant_id == context.tenant_id,
                    Workflow.version != "draft",
                )
            )

        selected = workflow(workflow_id)
        if selected is None:
            raise ConnectionRevisionChangedError()
        if selected.id != app.workflow_id:
            current = workflow(app.workflow_id)
            if current is None or get_tool_authorization_requirements(
                selected.graph_dict
            ) != get_tool_authorization_requirements(current.graph_dict):
                raise ConnectionRevisionChangedError()
        if conversation_id is not None:
            EndUserConnectionRepository._require_conversation(session, context, app, conversation_id, lock=False)
        return selected

    @staticmethod
    def _require_conversation(
        session: Session, context: WebConnectionContext, app: App, conversation_id: str, *, lock: bool
    ) -> None:
        if app.mode != AppMode.ADVANCED_CHAT:
            raise ConnectionConfigurationError()
        query = sa.select(Conversation.id).where(
            Conversation.id == conversation_id,
            Conversation.app_id == context.app_id,
            Conversation.mode == AppMode.ADVANCED_CHAT,
            Conversation.from_source == ConversationFromSource.API,
            Conversation.from_end_user_id == context.end_user_id,
            Conversation.from_account_id.is_(None),
            Conversation.is_deleted.is_(False),
            Conversation.status == ConversationStatus.NORMAL,
            sa.or_(Conversation.invoke_from.is_(None), Conversation.invoke_from == InvokeFrom.WEB_APP),
        )
        if lock:
            query = query.with_for_update()
        if session.scalar(query) is None:
            raise ConversationNotExistsError()

    def preflight_graph(
        self, context: WebConnectionContext, workflow_id: str | None, conversation_id: str | None
    ) -> tuple[str, Mapping[str, Any]]:
        with self._sessions() as session:
            app = self._require_context(session, context, lock=False)
            if workflow_id is None:
                workflow_id = app.workflow_id
            if workflow_id is None:
                raise ConnectionRevisionChangedError()
            workflow = self._require_workflow_scope(session, context, app, workflow_id, conversation_id)
            graph = workflow.graph_dict
            if not isinstance(graph, dict):
                raise ConnectionConfigurationError()
            return workflow_id, graph

    def workflow_requirements(
        self, context: WebConnectionContext, workflow_id: str
    ) -> tuple[AuthorizationRequirementSnapshot, ...]:
        _, graph = self.preflight_graph(context, workflow_id, None)
        return get_tool_authorization_requirements(graph)

    def complete_preflight(
        self,
        context: WebConnectionContext,
        workflow_id: str,
        conversation_id: str | None,
        *,
        revision_acceptance: ConnectionRevisionAcceptance | None,
    ) -> None:
        """Revalidate final identity and persist validated-contract acceptance atomically."""
        with self._sessions.begin() as session:
            app = self._require_context(session, context, lock=revision_acceptance is not None)
            self._require_workflow_scope(session, context, app, workflow_id, conversation_id)
            if revision_acceptance is not None:
                self._record_revision_acceptance(session, context, revision_acceptance)

    def validate_execution_identity(self, context: WebConnectionContext, conversation_id: str | None) -> None:
        with self._sessions() as session:
            app = self._require_context(session, context, lock=False)
            if conversation_id is not None:
                self._require_conversation(session, context, app, conversation_id, lock=False)

    def access_records(
        self, context: WebConnectionContext, connection_ids: frozenset[str]
    ) -> Mapping[str, ConnectionAccessRecord]:
        with self._sessions() as session:
            self._require_context(session, context, lock=False)
            return self._access_records(session, context, connection_ids, lock=False)

    @classmethod
    def _access_records(
        cls, session: Session, context: WebConnectionContext, connection_ids: frozenset[str], *, lock: bool
    ) -> Mapping[str, ConnectionAccessRecord]:
        if not connection_ids:
            return {}
        query = (
            sa.select(EndUserConnection)
            .options(
                load_only(
                    EndUserConnection.id,
                    EndUserConnection.tenant_id,
                    EndUserConnection.account_id,
                    EndUserConnection.end_user_id,
                    EndUserConnection.provider,
                    EndUserConnection.credential_type,
                    EndUserConnection.status,
                    EndUserConnection.oauth_client_source,
                    EndUserConnection.oauth_client_configuration_id,
                    EndUserConnection.oauth_client_id,
                    EndUserConnection.oauth_client_fingerprint,
                    EndUserConnection.oauth_plugin_unique_identifier,
                    EndUserConnection.revision,
                )
            )
            .where(
                EndUserConnection.tenant_id == context.tenant_id,
                *cls._owner(context.owner),
                EndUserConnection.id.in_(connection_ids),
            )
        )
        if lock:
            query = query.with_for_update()
        rows = session.scalars(query).all()
        return {row.id: cls._access(row) for row in rows}

    @staticmethod
    def _conversation_selection_scope(
        context: WebConnectionContext, conversation_id: str
    ) -> tuple[sa.ColumnElement[bool], ...]:
        return (
            SessionConnection.tenant_id == context.tenant_id,
            SessionConnection.app_id == context.app_id,
            SessionConnection.session_id == conversation_id,
        )

    def conversation_selections(
        self, context: WebConnectionContext, conversation_id: str
    ) -> tuple[SavedConnectionSelection, ...]:
        with self._sessions() as session:
            app = self._require_context(session, context, lock=False)
            self._require_conversation(session, context, app, conversation_id, lock=False)
            rows = session.scalars(
                sa.select(SessionConnection)
                .where(*self._conversation_selection_scope(context, conversation_id))
                .order_by(SessionConnection.node_id)
            )
            return tuple(
                SavedConnectionSelection(row.workflow_id, row.node_id, row.provider, row.connection_id) for row in rows
            )

    def app_selections(self, context: WebConnectionContext) -> tuple[SavedConnectionSelection, ...]:
        with self._sessions() as session:
            self._require_context(session, context, lock=False)
            rows = session.scalars(
                sa.select(AppConnection).where(*self._app_selection_scope(context)).order_by(AppConnection.node_id)
            )
            return tuple(
                SavedConnectionSelection(row.workflow_id, row.node_id, row.provider, row.connection_id) for row in rows
            )

    @staticmethod
    def _app_selection_scope(context: WebConnectionContext) -> tuple[sa.ColumnElement[bool], ...]:
        return (
            AppConnection.tenant_id == context.tenant_id,
            AppConnection.app_id == context.app_id,
            AppConnection.end_user_id == context.end_user_id,
        )

    def save_run_selections(
        self,
        execution: ConnectionExecutionContext,
        workflow_run_id: str,
        conversation_id: str | None,
        *,
        update_conversation: bool,
    ) -> None:
        with self._sessions.begin() as session:
            # Acceptance order is serialized under the stable App/EndUser lock.
            # Workers and resume paths never update App defaults again.
            context, app, selections = self._execution_selections(session, execution)
            self._require_workflow_scope(session, context, app, execution.workflow_id, None)
            if conversation_id is not None:
                self._require_conversation(session, context, app, conversation_id, lock=True)
            session.execute(sa.delete(AppConnection).where(*self._app_selection_scope(context)))
            session.add_all(
                AppConnection(
                    tenant_id=context.tenant_id,
                    app_id=context.app_id,
                    end_user_id=context.end_user_id,
                    workflow_id=item.workflow_id,
                    node_id=item.node_id,
                    provider=item.provider,
                    connection_id=item.connection_id,
                    source_run_id=workflow_run_id,
                )
                for item in selections
            )
            if update_conversation and conversation_id is not None:
                session.execute(
                    sa.delete(SessionConnection).where(*self._conversation_selection_scope(context, conversation_id))
                )
                self._insert_conversation_selections(session, context, conversation_id, selections)

    @classmethod
    def initialize_conversation_selections(
        cls, session: Session, execution: ConnectionExecutionContext, conversation: Conversation
    ) -> None:
        """Persist choices with the just-created row, using the accepted Workflow."""
        if (
            conversation.app_id != execution.app_id
            or conversation.from_end_user_id != execution.end_user_id
            or conversation.from_account_id is not None
            or conversation.from_source != ConversationFromSource.API
            or conversation.mode != AppMode.ADVANCED_CHAT
        ):
            raise ConnectionIdentityError()
        context, _, selections = cls._execution_selections(session, execution)
        cls._insert_conversation_selections(session, context, conversation.id, selections)

    @classmethod
    def _execution_selections(
        cls, session: Session, execution: ConnectionExecutionContext
    ) -> tuple[WebConnectionContext, App, tuple[SavedConnectionSelection, ...]]:
        context = WebConnectionContext(
            execution.tenant_id, execution.app_id, execution.end_user_id, execution.account_id
        )
        app = cls._require_context(session, context, lock=True)
        records = cls._access_records(
            session,
            context,
            frozenset(item.connection_id for item in execution.selections if item.connection_id is not None),
            lock=True,
        )
        selections = []
        for item in execution.selections:
            record = records.get(item.connection_id) if item.connection_id is not None else None
            if (
                record is None
                or record.provider != item.provider
                or record.credential_status != ConnectionCredentialStatus.CONNECTED
            ):
                raise ConnectionConflictError()
            selections.append(SavedConnectionSelection(execution.workflow_id, item.node_id, record.provider, record.id))
        return context, app, tuple(selections)

    @staticmethod
    def _insert_conversation_selections(
        session: Session,
        context: WebConnectionContext,
        conversation_id: str,
        selections: tuple[SavedConnectionSelection, ...],
    ) -> None:
        session.add_all(
            SessionConnection(
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                session_id=conversation_id,
                workflow_id=item.workflow_id,
                node_id=item.node_id,
                provider=item.provider,
                connection_id=item.connection_id,
            )
            for item in selections
        )

    @classmethod
    def _summary_query(cls, context: WebConnectionContext) -> sa.Select[tuple[EndUserConnection]]:
        return (
            sa.select(EndUserConnection)
            .options(
                load_only(
                    EndUserConnection.id,
                    EndUserConnection.name,
                    EndUserConnection.provider,
                    EndUserConnection.credential_type,
                    EndUserConnection.status,
                    EndUserConnection.oauth_client_fingerprint,
                    EndUserConnection.oauth_plugin_unique_identifier,
                    EndUserConnection.account_label,
                    EndUserConnection.expires_at,
                    EndUserConnection.created_at,
                    EndUserConnection.updated_at,
                    EndUserConnection.last_active_at,
                    raiseload=True,
                )
            )
            .where(EndUserConnection.tenant_id == context.tenant_id, *cls._owner(context.owner))
        )

    def connection_summaries(
        self, context: WebConnectionContext, connection_ids: frozenset[str]
    ) -> Mapping[str, ConnectionSummary]:
        with self._sessions() as session:
            self._require_context(session, context, lock=False)
            if not connection_ids:
                return {}
            rows = session.scalars(self._summary_query(context).where(EndUserConnection.id.in_(connection_ids)))
            return {row.id: self._summary(row) for row in rows}

    def list(self, context: WebConnectionContext, query: ListConnectionsInput, after_id: str | None) -> ConnectionPage:
        with self._sessions() as session:
            self._require_context(session, context, lock=False)
            stmt = self._summary_query(context)
            if query.provider is not None:
                stmt = stmt.where(EndUserConnection.provider == query.provider)
            if after_id is not None:
                stmt = stmt.where(EndUserConnection.id > after_id)
            rows = session.scalars(stmt.order_by(EndUserConnection.id).limit(query.limit + 1)).all()
            data = tuple(self._summary(row) for row in rows[: query.limit])
            return ConnectionPage(data=data, next_cursor=data[-1].id if len(rows) > query.limit else None)

    def find(self, context: WebConnectionContext, connection_id: str) -> StoredConnection | None:
        with self._sessions() as session:
            self._require_context(session, context, lock=False)
            row = session.scalar(
                sa.select(EndUserConnection).where(
                    EndUserConnection.id == connection_id,
                    EndUserConnection.tenant_id == context.tenant_id,
                    *self._owner(context.owner),
                )
            )
            return self._stored(row) if row is not None else None

    def create_api_key(
        self,
        context: WebConnectionContext,
        *,
        workflow_id: str,
        provider: str,
        name: str,
        encrypted_credentials: str,
        revision_acceptance: ConnectionRevisionAcceptance,
    ) -> ConnectionSummary:
        with self._sessions.begin() as session:
            app = self._require_context(session, context, lock=True)
            self._require_workflow_scope(session, context, app, workflow_id, None)
            owner = context.owner
            row = EndUserConnection(
                tenant_id=context.tenant_id,
                account_id=owner.account_id,
                end_user_id=owner.end_user_id,
                provider=provider,
                credential_type=ConnectionCredentialType.API_KEY,
                name=name,
                encrypted_credentials=encrypted_credentials,
                status=ConnectionCredentialStatus.CONNECTED,
                oauth_client_source=None,
                oauth_client_configuration_id=None,
                oauth_client_id=None,
                expires_at=None,
            )
            session.add(row)
            session.flush()
            self._record_revision_acceptance(session, context, revision_acceptance)
            return self._summary(row)

    def update(
        self, context: WebConnectionContext, guard: ConnectionMutationGuard, changes: ConnectionChanges
    ) -> StoredConnection:
        with self._sessions.begin() as session:
            self._require_context(session, context, lock=True)
            predicates = self._guard(context, guard)
            values: dict[str, Any] = {}
            if changes.name is not None:
                values["name"] = changes.name
            if changes.encrypted_credentials is not None:
                values["encrypted_credentials"] = changes.encrypted_credentials
            if changes.credential_status is not None:
                values["status"] = changes.credential_status
            if changes.touch_activity:
                values["last_active_at"] = naive_utc_now()
            if values:
                values.update(revision=EndUserConnection.revision + 1, updated_at=naive_utc_now())
                result = cast(
                    CursorResult, session.execute(sa.update(EndUserConnection).where(*predicates).values(**values))
                )
                if result.rowcount != 1:
                    raise ConnectionConflictError()
                row = session.scalar(
                    sa.select(EndUserConnection).where(
                        EndUserConnection.id == guard.connection_id,
                        EndUserConnection.tenant_id == context.tenant_id,
                        *self._owner(context.owner),
                    )
                )
            else:
                row = session.scalar(sa.select(EndUserConnection).where(*predicates).with_for_update())
            if row is None:
                raise ConnectionConflictError()
            if changes.revision_acceptance is not None:
                self._record_revision_acceptance(session, context, changes.revision_acceptance)
            return self._stored(row)

    def delete(self, context: WebConnectionContext, guard: ConnectionMutationGuard) -> None:
        with self._sessions.begin() as session:
            self._require_context(session, context, lock=True)
            result = cast(
                CursorResult, session.execute(sa.delete(EndUserConnection).where(*self._guard(context, guard)))
            )
            if result.rowcount != 1:
                raise ConnectionConflictError()

    def oauth_client_configuration(
        self, tenant_id: str, provider: str, source: OAuthClientSource
    ) -> StoredOAuthClientConfiguration:
        with self._sessions() as session:
            return self._oauth_client_configuration(session, tenant_id, provider, source, lock=False)

    def oauth_client_snapshot(
        self, tenant_id: str, provider: str, source: OAuthClientSource
    ) -> OAuthClientContractSnapshot:
        try:
            client = self.oauth_client_configuration(tenant_id, provider, source)
        except ConnectionReauthorizationRequiredError:
            return OAuthClientContractSnapshot(source=source, configuration_id=None, fingerprint=None)
        return OAuthClientContractSnapshot(
            source=source, configuration_id=client.configuration_id, fingerprint=client.fingerprint
        )

    def oauth_grant_client_configuration(
        self, tenant_id: str, provider: str, reference: ConnectionOAuthClient
    ) -> StoredOAuthClientConfiguration:
        identity = ToolProviderID(provider)
        with self._sessions() as session:
            if reference.source == OAuthClientSource.WORKSPACE:
                row = session.scalar(
                    sa.select(ToolOAuthTenantClient).where(
                        ToolOAuthTenantClient.id == reference.configuration_id,
                        ToolOAuthTenantClient.tenant_id == tenant_id,
                        ToolOAuthTenantClient.plugin_id == identity.plugin_id,
                        ToolOAuthTenantClient.provider == identity.provider_name,
                    )
                )
            else:
                row = session.scalar(
                    sa.select(ToolOAuthSystemClient).where(
                        ToolOAuthSystemClient.id == reference.configuration_id,
                        ToolOAuthSystemClient.plugin_id == identity.plugin_id,
                        ToolOAuthSystemClient.provider == identity.provider_name,
                    )
                )
            if row is None:
                raise ConnectionReauthorizationRequiredError()
            return StoredOAuthClientConfiguration(
                source=reference.source,
                configuration_id=row.id,
                encrypted_parameters=row.encrypted_oauth_params,
            )

    def update_oauth_check(
        self,
        context: WebConnectionContext,
        guard: ConnectionMutationGuard,
        *,
        client: ConnectionOAuthClient,
        status: ConnectionCredentialStatus,
        refreshed: ConnectionOAuthGrant | None,
        ciphertext: str | None,
    ) -> StoredConnection:
        with self._sessions.begin() as session:
            self._require_context(session, context, lock=True)
            provider = session.scalar(
                sa.select(EndUserConnection.provider).where(
                    *self._guard(context, guard),
                    EndUserConnection.credential_type == ConnectionCredentialType.OAUTH2,
                )
            )
            if provider is None:
                raise ConnectionConflictError()
            # Client writers lock their configuration before invalidating grants.
            # Keep that order here so refresh and rotation cannot deadlock.
            current_client = self._oauth_client_configuration(
                session, context.tenant_id, provider, client.source, lock=True
            )
            if (
                current_client.source != client.source
                or current_client.configuration_id != client.configuration_id
                or current_client.fingerprint != client.fingerprint
            ):
                raise ConnectionReauthorizationRequiredError()
            row = session.scalar(
                sa.select(EndUserConnection)
                .where(
                    *self._guard(context, guard),
                    EndUserConnection.credential_type == ConnectionCredentialType.OAUTH2,
                )
                .with_for_update()
            )
            if row is None:
                raise ConnectionConflictError()
            changed = row.status != status or refreshed is not None
            row.status = status
            if refreshed is not None:
                if ciphertext is None:
                    raise ConnectionConfigurationError()
                row.encrypted_credentials = ciphertext
                row.expires_at = refreshed.expires_at
                if refreshed.account_label is not None:
                    row.account_label = refreshed.account_label
            if changed:
                row.revision += 1
                row.updated_at = naive_utc_now()
            session.flush()
            return self._stored(row)

    def validate_oauth_context(self, attempt: ConnectionOAuthAttempt) -> None:
        with self._sessions() as session:
            self._require_context(session, attempt.context, lock=False)

    @staticmethod
    def _oauth_client_configuration(
        session: Session, tenant_id: str, provider: str, source: OAuthClientSource, *, lock: bool
    ) -> StoredOAuthClientConfiguration:
        identity = ToolProviderID(provider)
        if source == OAuthClientSource.WORKSPACE:
            stmt = sa.select(ToolOAuthTenantClient).where(
                ToolOAuthTenantClient.tenant_id == tenant_id,
                ToolOAuthTenantClient.plugin_id == identity.plugin_id,
                ToolOAuthTenantClient.provider == identity.provider_name,
                ToolOAuthTenantClient.enabled.is_(True),
            )
        else:
            stmt = sa.select(ToolOAuthSystemClient).where(
                ToolOAuthSystemClient.plugin_id == identity.plugin_id,
                ToolOAuthSystemClient.provider == identity.provider_name,
            )
        if lock:
            stmt = stmt.with_for_update()
        client = session.scalar(stmt)
        if client is None:
            raise ConnectionReauthorizationRequiredError()
        return StoredOAuthClientConfiguration(
            source=source,
            configuration_id=client.id,
            encrypted_parameters=client.encrypted_oauth_params,
        )

    def save_oauth(
        self,
        attempt: ConnectionOAuthAttempt,
        *,
        encrypted_credentials: str,
        expires_at: datetime | None,
        account_label: str | None,
        revision_acceptance: ConnectionRevisionAcceptance,
    ) -> ConnectionSummary:
        context = attempt.context
        with self._sessions.begin() as session:
            app = self._require_context(session, context, lock=True)
            client = attempt.client
            current = self._oauth_client_configuration(
                session, context.tenant_id, attempt.provider, client.source, lock=True
            )
            if (
                current.source != client.source
                or current.configuration_id != client.configuration_id
                or current.fingerprint != attempt.client.fingerprint
            ):
                raise ConnectionReauthorizationRequiredError()
            if attempt.guard is None:
                if attempt.target is None or attempt.name is None:
                    raise ConnectionConfigurationError()
                if attempt.target_workflow_id is None:
                    raise ConnectionConfigurationError()
                self._require_workflow_scope(session, context, app, attempt.target_workflow_id, None)
                row = EndUserConnection(
                    tenant_id=context.tenant_id,
                    account_id=context.owner.account_id,
                    end_user_id=context.owner.end_user_id,
                    provider=attempt.provider,
                    credential_type=ConnectionCredentialType.OAUTH2,
                    name=attempt.name,
                    encrypted_credentials=encrypted_credentials,
                    status=ConnectionCredentialStatus.CONNECTED,
                    oauth_client_source=client.source,
                    oauth_client_configuration_id=client.configuration_id,
                    oauth_client_id=client.client_id,
                    oauth_client_fingerprint=attempt.client.fingerprint,
                    oauth_plugin_unique_identifier=client.plugin_unique_identifier,
                    expires_at=expires_at,
                    account_label=account_label,
                )
                session.add(row)
                session.flush()
            else:
                result = cast(
                    CursorResult,
                    session.execute(
                        sa.update(EndUserConnection)
                        .where(
                            *self._guard(context, attempt.guard),
                            EndUserConnection.provider == attempt.provider,
                            EndUserConnection.credential_type == ConnectionCredentialType.OAUTH2,
                        )
                        .values(
                            {
                                "encrypted_credentials": encrypted_credentials,
                                "status": ConnectionCredentialStatus.CONNECTED,
                                "oauth_client_source": client.source,
                                "oauth_client_configuration_id": client.configuration_id,
                                "oauth_client_id": client.client_id,
                                "oauth_client_fingerprint": attempt.client.fingerprint,
                                "oauth_plugin_unique_identifier": client.plugin_unique_identifier,
                                "expires_at": expires_at,
                                "account_label": account_label,
                                "revision": EndUserConnection.revision + 1,
                                "updated_at": naive_utc_now(),
                                "last_active_at": naive_utc_now(),
                            }
                        )
                    ),
                )
                if result.rowcount != 1:
                    raise ConnectionConflictError()
                row = session.scalar(
                    sa.select(EndUserConnection).where(
                        EndUserConnection.id == attempt.guard.connection_id,
                        EndUserConnection.tenant_id == context.tenant_id,
                        *self._owner(context.owner),
                    )
                )
                if row is None:
                    raise ConnectionConflictError()
            self._record_revision_acceptance(session, context, revision_acceptance)
            return self._summary(row)

    def _guard(
        self, context: WebConnectionContext, guard: ConnectionMutationGuard
    ) -> tuple[sa.ColumnElement[bool], ...]:
        if guard.tenant_id != context.tenant_id or guard.owner != context.owner:
            raise ConnectionConflictError()
        return (
            EndUserConnection.id == guard.connection_id,
            EndUserConnection.tenant_id == context.tenant_id,
            EndUserConnection.revision == guard.revision,
            *self._owner(guard.owner),
        )

    @staticmethod
    def _credential_status(row: EndUserConnection) -> ConnectionCredentialStatus:
        if row.credential_type == ConnectionCredentialType.OAUTH2 and (
            row.oauth_client_fingerprint is None or row.oauth_plugin_unique_identifier is None
        ):
            return ConnectionCredentialStatus.RECONNECT_REQUIRED
        return row.status

    @classmethod
    def _summary(cls, row: EndUserConnection) -> ConnectionSummary:
        return ConnectionSummary(
            id=row.id,
            name=row.name,
            provider=row.provider,
            credential_type=row.credential_type,
            credential_status=cls._credential_status(row),
            account_label=row.account_label,
            expires_at=row.expires_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
            last_active_at=row.last_active_at,
        )

    @classmethod
    def _access(cls, row: EndUserConnection) -> ConnectionAccessRecord:
        client = None
        if row.credential_type == ConnectionCredentialType.OAUTH2:
            if row.oauth_client_source is None or row.oauth_client_configuration_id is None:
                raise ConnectionConfigurationError()
            client = ConnectionOAuthClient(
                source=row.oauth_client_source,
                configuration_id=row.oauth_client_configuration_id,
                client_id=row.oauth_client_id,
                fingerprint=row.oauth_client_fingerprint,
                plugin_unique_identifier=row.oauth_plugin_unique_identifier,
            )
        return ConnectionAccessRecord(
            id=row.id,
            tenant_id=row.tenant_id,
            owner=ConnectionOwner(account_id=row.account_id, end_user_id=row.end_user_id),
            provider=row.provider,
            credential_type=row.credential_type,
            credential_status=cls._credential_status(row),
            oauth_client=client,
            revision=row.revision,
        )

    @classmethod
    def _stored(cls, row: EndUserConnection) -> StoredConnection:
        return StoredConnection(
            access=cls._access(row),
            summary=cls._summary(row),
            encrypted_credentials=row.encrypted_credentials,
        )
