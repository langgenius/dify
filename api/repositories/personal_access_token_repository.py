"""Repository-owned PAT transactions and account-scoped value projections."""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime

from sqlalchemy import Select, String, cast, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.dataset import Dataset
from models.model import App
from models.personal_access_token import PersonalAccessToken, PersonalAccessTokenResource, PersonalAccessTokenWorkspace
from services.entities.app_entities import SUPPORTED_APP_TYPES
from services.personal_access_token_service import (
    PersonalAccessTokenAccessDeniedError,
    PersonalAccessTokenCreateConflictError,
    PersonalAccessTokenDetails,
    PersonalAccessTokenExpiredError,
    PersonalAccessTokenNotFoundError,
    PersonalAccessTokenRecord,
    PersonalAccessTokenResourceRef,
    PersonalAccessTokenResourceView,
    PersonalAccessTokenScopes,
    PersonalAccessTokenSummary,
    PersonalAccessTokenUpdateConflictError,
    PersonalAccessTokenWorkspaceView,
)


class PersonalAccessTokenRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def create(self, record: PersonalAccessTokenRecord) -> PersonalAccessTokenSummary:
        try:
            return self._create(record)
        except IntegrityError:
            # A concurrent identical request can win the unique creation key.
            # Re-read in a new transaction after the failed insert rolls back.
            if record.creation_key is not None:
                with self._session_factory() as session:
                    existing = self._find_creation(
                        session,
                        account_id=record.account_id,
                        key=record.creation_key,
                        fingerprint=record.creation_fingerprint,
                    )
                    if existing is not None:
                        return existing
            raise

    def _create(self, record: PersonalAccessTokenRecord) -> PersonalAccessTokenSummary:
        summary = record.summary
        with self._session_factory.begin() as session:
            existing = self._find_creation(
                session, account_id=record.account_id, key=record.creation_key, fingerprint=record.creation_fingerprint
            )
            if existing is not None:
                return existing
            token = PersonalAccessToken(
                account_id=record.account_id,
                name=summary.name,
                secret_digest=record.secret_digest,
                secret_ciphertext=record.secret_ciphertext,
                secret_last_four=summary.secret_last_four,
                expires_at=summary.expires_at,
                creation_key=record.creation_key,
                creation_fingerprint=record.creation_fingerprint,
                resource_scope_mode=summary.resource_scope_mode,
                workspace_scope_mode=summary.workspace_scope_mode,
            )
            token.id = summary.id
            token.created_at = summary.created_at
            session.add(token)
            session.flush()
            self._apply_scopes(session, token, record.scopes, record.validated_resources)
            session.flush()
            return self._details(session, token).token

    def find_creation(self, account_id: str, key: str, fingerprint: str) -> PersonalAccessTokenSummary | None:
        with self._session_factory() as session:
            return self._find_creation(session, account_id=account_id, key=key, fingerprint=fingerprint)

    def _find_creation(
        self,
        session: Session,
        *,
        account_id: str,
        key: str | None,
        fingerprint: str | None,
    ) -> PersonalAccessTokenSummary | None:
        if key is None:
            return None
        existing = session.scalar(
            select(PersonalAccessToken).where(
                PersonalAccessToken.account_id == account_id,
                PersonalAccessToken.creation_key == key,
            )
        )
        if existing is None:
            return None
        if existing.creation_fingerprint != fingerprint or existing.revoked_at is not None:
            raise PersonalAccessTokenCreateConflictError()
        return self._details(session, existing).token

    def list_details(self, account_id: str, *, page: int, limit: int) -> tuple[PersonalAccessTokenDetails, ...]:
        with self._session_factory() as session:
            rows = session.scalars(
                select(PersonalAccessToken)
                .where(PersonalAccessToken.account_id == account_id, PersonalAccessToken.revoked_at.is_(None))
                .order_by(PersonalAccessToken.created_at.desc(), PersonalAccessToken.id.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
            return self._details_many(session, tuple(rows))

    def count_tokens(self, account_id: str) -> int:
        with self._session_factory() as session:
            return (
                session.scalar(
                    select(func.count())
                    .select_from(PersonalAccessToken)
                    .where(PersonalAccessToken.account_id == account_id, PersonalAccessToken.revoked_at.is_(None))
                )
                or 0
            )

    def get(self, account_id: str, token_id: str) -> PersonalAccessTokenRecord:
        with self._session_factory() as session:
            token = session.scalar(
                select(PersonalAccessToken).where(
                    PersonalAccessToken.id == token_id,
                    PersonalAccessToken.account_id == account_id,
                    PersonalAccessToken.revoked_at.is_(None),
                )
            )
            if token is None:
                raise PersonalAccessTokenNotFoundError()
            return self._record(session, token)

    def find_by_digest(self, digest: str, *, now: datetime) -> PersonalAccessTokenRecord | None:
        with self._session_factory.begin() as session:
            token = session.scalar(
                select(PersonalAccessToken)
                .join(
                    Account,
                    Account.id == PersonalAccessToken.account_id,
                )
                .where(
                    PersonalAccessToken.secret_digest == digest,
                    PersonalAccessToken.revoked_at.is_(None),
                    Account.status == AccountStatus.ACTIVE,
                    or_(PersonalAccessToken.expires_at.is_(None), PersonalAccessToken.expires_at > now),
                )
            )
            if token is None:
                return None
            # Usage metadata only: do not overwrite scope/version/revocation or
            # move the timestamp backwards when concurrent requests finish.
            session.execute(
                update(PersonalAccessToken)
                .where(
                    PersonalAccessToken.id == token.id,
                    PersonalAccessToken.revoked_at.is_(None),
                    or_(PersonalAccessToken.last_used_at.is_(None), PersonalAccessToken.last_used_at < now),
                )
                .values(last_used_at=now)
            )
            return self._record(session, token)

    def _record(self, session: Session, token: PersonalAccessToken) -> PersonalAccessTokenRecord:
        from typing import Literal
        from typing import cast as type_cast

        resources = tuple(
            PersonalAccessTokenResourceRef(
                type_cast(Literal["app", "dataset", "app_runner"], row.resource_type),
                row.resource_id,
            )
            for row in session.scalars(
                select(PersonalAccessTokenResource).where(
                    PersonalAccessTokenResource.token_id == token.id,
                )
            )
        )
        workspace_ids = tuple(
            session.scalars(
                select(PersonalAccessTokenWorkspace.workspace_id).where(
                    PersonalAccessTokenWorkspace.token_id == token.id,
                )
            )
        )
        return PersonalAccessTokenRecord(
            summary=self._summary(token),
            account_id=token.account_id,
            secret_digest=token.secret_digest,
            secret_ciphertext=token.secret_ciphertext,
            creation_key=token.creation_key,
            creation_fingerprint=token.creation_fingerprint,
            scopes=PersonalAccessTokenScopes(
                resource_mode=type_cast(Literal["all", "selected", "none"], token.resource_scope_mode),
                resources=resources,
                workspace_mode=type_cast(Literal["all", "selected", "none"], token.workspace_scope_mode),
                workspace_ids=workspace_ids,
            ),
        )

    def revoke(self, account_id: str, token_id: str) -> None:
        with self._session_factory.begin() as session:
            token = session.scalar(
                select(PersonalAccessToken)
                .where(
                    PersonalAccessToken.id == token_id,
                    PersonalAccessToken.account_id == account_id,
                )
                .with_for_update()
            )
            if token is None:
                raise PersonalAccessTokenNotFoundError()
            if token.revoked_at is None:
                token.revoked_at = naive_utc_now()
                token.secret_ciphertext = b""

    def details(self, account_id: str, token_id: str) -> PersonalAccessTokenDetails:
        with self._session_factory() as session:
            token = session.scalar(
                select(PersonalAccessToken).where(
                    PersonalAccessToken.id == token_id,
                    PersonalAccessToken.account_id == account_id,
                    PersonalAccessToken.revoked_at.is_(None),
                )
            )
            if token is None:
                raise PersonalAccessTokenNotFoundError()
            return self._details(session, token)

    def update(
        self,
        account_id: str,
        token_id: str,
        *,
        name: str,
        version: int,
        scopes: PersonalAccessTokenScopes | None,
        now: datetime,
        validated_resources: tuple[PersonalAccessTokenResourceView, ...],
    ) -> PersonalAccessTokenDetails:
        with self._session_factory.begin() as session:
            token = session.scalar(
                select(PersonalAccessToken)
                .where(
                    PersonalAccessToken.id == token_id,
                    PersonalAccessToken.account_id == account_id,
                    PersonalAccessToken.revoked_at.is_(None),
                )
                .with_for_update()
            )
            if token is None:
                raise PersonalAccessTokenNotFoundError()
            if token.expires_at is not None and token.expires_at <= now:
                raise PersonalAccessTokenExpiredError()
            if token.version != version:
                raise PersonalAccessTokenUpdateConflictError()
            token.name = name
            if scopes is not None:
                self._apply_scopes(session, token, scopes, validated_resources)
            token.version += 1
            token.updated_at = now
            session.flush()
            return self._details(session, token)

    def _apply_scopes(
        self,
        session: Session,
        token: PersonalAccessToken,
        scopes: PersonalAccessTokenScopes,
        validated_resources: tuple[PersonalAccessTokenResourceView, ...],
    ) -> None:
        account_id = token.account_id
        if account_id is None:
            raise PersonalAccessTokenAccessDeniedError("Token owner is unavailable.")
        validated = {(r.resource_type, r.resource_id): r for r in validated_resources}
        resources = {
            (row.resource_type, row.resource_id): row
            for row in session.scalars(
                select(PersonalAccessTokenResource).where(PersonalAccessTokenResource.token_id == token.id)
            )
        }
        wanted_resources: set[tuple[str, str]] = set()
        for resource in scopes.resources:
            resource_ref: PersonalAccessTokenResourceRef = resource
            wanted_resources.add((resource_ref.resource_type, resource_ref.resource_id))
        for key, row in resources.items():
            if key not in wanted_resources:
                session.delete(row)
        added_resources = wanted_resources - resources.keys()
        app_ids = {resource_id for resource_type, resource_id in added_resources if resource_type == "app"}
        dataset_ids = {resource_id for resource_type, resource_id in added_resources if resource_type == "dataset"}
        apps = (
            {app.id: app for app in session.scalars(self._available_apps(account_id).where(App.id.in_(app_ids)))}
            if app_ids
            else {}
        )
        datasets = (
            {
                dataset.id: dataset
                for dataset in session.scalars(self._available_datasets(account_id).where(Dataset.id.in_(dataset_ids)))
            }
            if dataset_ids
            else {}
        )
        if app_ids - apps.keys() or dataset_ids - datasets.keys():
            raise PersonalAccessTokenAccessDeniedError("Selected resource is unavailable.")
        for resource_type, resource_id in added_resources:
            if resource_type == "app_runner":
                resource = validated.get((resource_type, resource_id))
                parent = (
                    self._available_app(session, account_id, resource.parent_app_id)
                    if resource and resource.parent_app_id
                    else None
                )
                current = session.scalar(
                    select(TenantAccountJoin.tenant_id).where(
                        TenantAccountJoin.account_id == account_id, TenantAccountJoin.current.is_(True)
                    )
                )
                if (
                    resource is None
                    or parent is None
                    or parent.tenant_id != resource.workspace_id
                    or current != resource.workspace_id
                ):
                    raise PersonalAccessTokenAccessDeniedError("Selected deployment is unavailable.")
                session.add(
                    PersonalAccessTokenResource(
                        token_id=token.id,
                        resource_type=resource_type,
                        resource_id=resource_id,
                        workspace_id=resource.workspace_id,
                        display_name_snapshot=resource.display_name,
                        workspace_name_snapshot=resource.workspace_name,
                    )
                )
                continue
            resource = apps[resource_id] if resource_type == "app" else datasets[resource_id]
            session.add(
                PersonalAccessTokenResource(
                    token_id=token.id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    workspace_id=resource.tenant_id,
                    display_name_snapshot=resource.name,
                    workspace_name_snapshot="",
                )
            )
        workspaces = {
            row.workspace_id: row
            for row in session.scalars(
                select(PersonalAccessTokenWorkspace).where(PersonalAccessTokenWorkspace.token_id == token.id)
            )
        }
        wanted_workspaces = set(scopes.workspace_ids)
        for workspace_id, row in workspaces.items():
            if workspace_id not in wanted_workspaces:
                session.delete(row)
        added_workspaces = wanted_workspaces - workspaces.keys()
        available_workspaces = (
            {
                workspace.id: workspace
                for workspace in session.scalars(
                    select(Tenant)
                    .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                    .where(
                        Tenant.id.in_(added_workspaces),
                        TenantAccountJoin.account_id == account_id,
                        Tenant.status == TenantStatus.NORMAL,
                    )
                )
            }
            if added_workspaces
            else {}
        )
        if added_workspaces - available_workspaces.keys():
            raise PersonalAccessTokenAccessDeniedError("Selected workspace is unavailable.")
        for workspace_id in added_workspaces:
            workspace = available_workspaces[workspace_id]
            session.add(
                PersonalAccessTokenWorkspace(
                    token_id=token.id,
                    workspace_id=workspace_id,
                    display_name_snapshot=workspace.name,
                )
            )
        token.resource_scope_mode = scopes.resource_mode
        token.workspace_scope_mode = scopes.workspace_mode

    @staticmethod
    def _available_apps(account_id: str) -> Select[tuple[App, str]]:
        """Shared membership and app eligibility query; invocation ACL stays in the service."""
        return (
            select(App, Tenant.name)
            .join(Tenant, Tenant.id == App.tenant_id)
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                TenantAccountJoin.account_id == account_id,
                Tenant.status == TenantStatus.NORMAL,
                App.status == "normal",
                App.mode.in_(SUPPORTED_APP_TYPES),
            )
        )

    @staticmethod
    def _available_datasets(account_id: str) -> Select[tuple[Dataset, str]]:
        # KnowledgeFS (NEW RAG) has a separate owner; these are legacy knowledge bases.
        return (
            select(Dataset, Tenant.name)
            .join(Tenant, Tenant.id == Dataset.tenant_id)
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(TenantAccountJoin.account_id == account_id, Tenant.status == TenantStatus.NORMAL)
        )

    @classmethod
    def _available_app(cls, session: Session, account_id: str, app_id: str) -> App | None:
        return session.scalar(cls._available_apps(account_id).where(App.id == app_id))

    def _details(self, session: Session, token: PersonalAccessToken) -> PersonalAccessTokenDetails:
        return self._details_many(session, (token,))[0]

    def _details_many(
        self,
        session: Session,
        tokens: Sequence[PersonalAccessToken],
    ) -> tuple[PersonalAccessTokenDetails, ...]:
        if not tokens:
            return ()
        token_ids = [token.id for token in tokens]
        resource_rows = tuple(
            session.scalars(
                select(PersonalAccessTokenResource)
                .where(
                    PersonalAccessTokenResource.token_id.in_(token_ids),
                )
                .order_by(PersonalAccessTokenResource.created_at, PersonalAccessTokenResource.id)
            )
        )
        workspace_rows = tuple(
            session.scalars(
                select(PersonalAccessTokenWorkspace)
                .where(
                    PersonalAccessTokenWorkspace.token_id.in_(token_ids),
                )
                .order_by(PersonalAccessTokenWorkspace.created_at, PersonalAccessTokenWorkspace.id)
            )
        )
        app_ids = {row.resource_id for row in resource_rows if row.resource_type == "app"}
        dataset_ids = {row.resource_id for row in resource_rows if row.resource_type == "dataset"}
        workspace_ids = {row.workspace_id for row in (*resource_rows, *workspace_rows)}
        account_id = tokens[0].account_id
        apps = (
            {app.id: app for app in session.scalars(self._available_apps(account_id).where(App.id.in_(app_ids)))}
            if app_ids
            else {}
        )
        datasets = (
            {
                dataset.id: dataset
                for dataset in session.scalars(self._available_datasets(account_id).where(Dataset.id.in_(dataset_ids)))
            }
            if dataset_ids
            else {}
        )
        workspaces = (
            {
                workspace.id: (workspace, role)
                for workspace, role in session.execute(
                    select(Tenant, TenantAccountJoin.role)
                    .join(
                        TenantAccountJoin,
                        TenantAccountJoin.tenant_id == Tenant.id,
                    )
                    .where(
                        Tenant.id.in_(workspace_ids),
                        TenantAccountJoin.account_id == account_id,
                        Tenant.status == TenantStatus.NORMAL,
                    )
                )
            }
            if workspace_ids
            else {}
        )
        workspace_names = (
            dict(session.execute(select(Tenant.id, Tenant.name).where(Tenant.id.in_(workspace_ids))).all())
            if workspace_ids
            else {}
        )
        resources_by_token: dict[str, list[PersonalAccessTokenResourceView]] = defaultdict(list)
        workspaces_by_token: dict[str, list[PersonalAccessTokenWorkspaceView]] = defaultdict(list)
        for row in resource_rows:
            app = (
                apps.get(row.resource_id)
                if row.resource_type == "app"
                else datasets.get(row.resource_id)
                if row.resource_type == "dataset"
                else None
            )
            workspace_entry = workspaces.get(row.workspace_id)
            workspace = workspace_entry[0] if workspace_entry else None
            available = workspace is not None and (
                row.resource_type == "app_runner" or (app is not None and app.tenant_id == row.workspace_id)
            )
            resources_by_token[row.token_id].append(
                PersonalAccessTokenResourceView(
                    resource_type=row.resource_type,
                    resource_id=row.resource_id,
                    workspace_id=row.workspace_id,
                    display_name=app.name if available and app else row.display_name_snapshot,
                    # Resource access or workspace membership can be removed while the workspace
                    # itself still exists. Keep showing its live name in authorization details.
                    workspace_name=workspace_names.get(row.workspace_id, row.workspace_name_snapshot),
                    available=available,
                    reason=None if available else "access_removed",
                    maintainer=app.maintainer if app else None,
                    display_name_snapshot=row.display_name_snapshot,
                    workspace_name_snapshot=row.workspace_name_snapshot,
                )
            )
        for row in workspace_rows:
            workspace_entry = workspaces.get(row.workspace_id)
            workspace = workspace_entry[0] if workspace_entry else None
            workspaces_by_token[row.token_id].append(
                PersonalAccessTokenWorkspaceView(
                    workspace_id=row.workspace_id,
                    display_name=workspace.name if workspace else row.display_name_snapshot,
                    available=workspace is not None,
                    reason=None if workspace else "not_a_member",
                    role=workspace_entry[1] if workspace_entry else None,
                )
            )
        details = []
        for token in tokens:
            resources = tuple(resources_by_token[token.id])
            selected_workspaces = tuple(workspaces_by_token[token.id])
            summary = replace(
                self._summary(token),
                has_access_issue=any(not item.available for item in (*resources, *selected_workspaces)),
                resource_count=len(resources),
                workspace_count=len(selected_workspaces),
                unavailable_count=sum(not item.available for item in (*resources, *selected_workspaces)),
            )
            details.append(PersonalAccessTokenDetails(summary, resources, selected_workspaces))
        return tuple(details)

    def current_workspace(self, account_id: str) -> PersonalAccessTokenWorkspaceView | None:
        with self._session_factory() as session:
            row = session.execute(
                select(Tenant, TenantAccountJoin.role)
                .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                .where(
                    TenantAccountJoin.account_id == account_id,
                    TenantAccountJoin.current.is_(True),
                    Tenant.status == TenantStatus.NORMAL,
                )
            ).first()
            if row is None:
                return None
            workspace, role = row
            return PersonalAccessTokenWorkspaceView(
                workspace_id=workspace.id,
                display_name=workspace.name,
                available=True,
                reason=None,
                role=role,
            )

    def deployment_context(self, account_id: str) -> tuple[str | None, tuple[PersonalAccessTokenResourceView, ...]]:
        """Close the read session before the deployment catalog performs remote I/O."""
        workspace = self.current_workspace(account_id)
        if workspace is None:
            return None, ()
        current = workspace.workspace_id
        with self._session_factory() as session:
            return current, tuple(
                PersonalAccessTokenResourceView(
                    resource_type="app",
                    resource_id=app.id,
                    workspace_id=app.tenant_id,
                    display_name=app.name,
                    workspace_name=workspace_name,
                    available=True,
                    reason=None,
                    maintainer=app.maintainer,
                    api_enabled=app.enable_api,
                    display_name_snapshot=app.name,
                    workspace_name_snapshot=workspace_name,
                )
                for app, workspace_name in session.execute(
                    self._available_apps(account_id).where(App.tenant_id == current)
                )
            )

    def workspace_candidates(
        self,
        account_id: str,
        *,
        keyword: str | None,
        offset: int = 0,
        limit: int | None = None,
    ) -> tuple[PersonalAccessTokenWorkspaceView, ...]:
        with self._session_factory() as session:
            query = (
                select(Tenant, TenantAccountJoin.role)
                .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                .where(
                    TenantAccountJoin.account_id == account_id,
                    Tenant.status == TenantStatus.NORMAL,
                )
            )
            if keyword:
                pattern = f"%{escape_like_pattern(keyword)}%"
                query = query.where(
                    or_(Tenant.name.ilike(pattern, escape="\\"), cast(Tenant.id, String).ilike(pattern, escape="\\"))
                )
            query = query.order_by(Tenant.name, Tenant.id).offset(offset)
            if limit is not None:
                query = query.limit(limit)
            return tuple(
                PersonalAccessTokenWorkspaceView(
                    workspace_id=workspace.id,
                    display_name=workspace.name,
                    available=True,
                    reason=None,
                    role=role,
                )
                for workspace, role in session.execute(query)
            )

    @staticmethod
    def _summary(token: PersonalAccessToken) -> PersonalAccessTokenSummary:
        return PersonalAccessTokenSummary(
            id=token.id,
            name=token.name,
            secret_last_four=token.secret_last_four,
            created_at=token.created_at,
            expires_at=token.expires_at,
            resource_scope_mode=token.resource_scope_mode,
            workspace_scope_mode=token.workspace_scope_mode,
            version=token.version,
            last_used_at=token.last_used_at,
        )
