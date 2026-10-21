"""Owner-scoped Connection storage; external I/O never runs in these transactions."""

from collections.abc import Mapping
from typing import Any, cast

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, load_only, sessionmaker

from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType
from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus
from models.end_user_connection import EndUserConnection
from models.enums import AppStatus, EndUserType
from models.model import App, AppMode, EndUser
from models.workflow import Workflow
from services.end_user_connections.api_key import ConnectionChanges, StoredConnection
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
    ConnectionWorkflowChangedError,
)


class EndUserConnectionRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

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

    def published_graph(self, context: WebConnectionContext, workflow_id: str) -> Mapping[str, Any]:
        with self._sessions() as session:
            app = self._require_context(session, context, lock=False)
            if app.workflow_id != workflow_id:
                raise ConnectionWorkflowChangedError()
            workflow = session.scalar(
                sa.select(Workflow).where(
                    Workflow.id == workflow_id,
                    Workflow.app_id == context.app_id,
                    Workflow.tenant_id == context.tenant_id,
                    Workflow.version != "draft",
                )
            )
            if workflow is None:
                raise ConnectionWorkflowChangedError()
            graph = workflow.graph_dict
            if not isinstance(graph, dict):
                raise ConnectionConfigurationError()
            return graph

    def list(self, context: WebConnectionContext, query: ListConnectionsInput, after_id: str | None) -> ConnectionPage:
        with self._sessions() as session:
            self._require_context(session, context, lock=False)
            stmt = (
                sa.select(EndUserConnection)
                .options(
                    load_only(
                        EndUserConnection.id,
                        EndUserConnection.name,
                        EndUserConnection.provider,
                        EndUserConnection.credential_type,
                        EndUserConnection.status,
                        EndUserConnection.account_label,
                        EndUserConnection.expires_at,
                        EndUserConnection.created_at,
                        EndUserConnection.updated_at,
                        EndUserConnection.last_active_at,
                    )
                )
                .where(EndUserConnection.tenant_id == context.tenant_id, *self._owner(context.owner))
            )
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
        self, context: WebConnectionContext, *, workflow_id: str, provider: str, name: str, encrypted_credentials: str
    ) -> ConnectionSummary:
        with self._sessions.begin() as session:
            app = self._require_context(session, context, lock=True)
            if app.workflow_id != workflow_id:
                raise ConnectionWorkflowChangedError()
            if (
                session.scalar(
                    sa.select(Workflow.id).where(
                        Workflow.id == workflow_id,
                        Workflow.tenant_id == context.tenant_id,
                        Workflow.app_id == context.app_id,
                        Workflow.version != "draft",
                    )
                )
                is None
            ):
                raise ConnectionWorkflowChangedError()
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
            return self._summary(row)

    def update(
        self, context: WebConnectionContext, guard: ConnectionMutationGuard, changes: ConnectionChanges
    ) -> ConnectionSummary:
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
            return self._summary(row)

    def delete(self, context: WebConnectionContext, guard: ConnectionMutationGuard) -> None:
        with self._sessions.begin() as session:
            self._require_context(session, context, lock=True)
            result = cast(
                CursorResult, session.execute(sa.delete(EndUserConnection).where(*self._guard(context, guard)))
            )
            if result.rowcount != 1:
                raise ConnectionConflictError()

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
    def _summary(row: EndUserConnection) -> ConnectionSummary:
        return ConnectionSummary(
            id=row.id,
            name=row.name,
            provider=row.provider,
            credential_type=row.credential_type,
            credential_status=row.status,
            account_label=row.account_label,
            expires_at=row.expires_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
            last_active_at=row.last_active_at,
        )

    @classmethod
    def _stored(cls, row: EndUserConnection) -> StoredConnection:
        client = None
        if row.credential_type == ConnectionCredentialType.OAUTH2:
            if row.oauth_client_source is None or row.oauth_client_configuration_id is None:
                raise ConnectionConfigurationError()
            client = ConnectionOAuthClient(
                source=row.oauth_client_source,
                configuration_id=row.oauth_client_configuration_id,
                client_id=row.oauth_client_id,
            )
        return StoredConnection(
            access=ConnectionAccessRecord(
                id=row.id,
                tenant_id=row.tenant_id,
                owner=ConnectionOwner(account_id=row.account_id, end_user_id=row.end_user_id),
                provider=row.provider,
                credential_type=row.credential_type,
                credential_status=row.status,
                oauth_client=client,
                revision=row.revision,
            ),
            summary=cls._summary(row),
            encrypted_credentials=row.encrypted_credentials,
        )
