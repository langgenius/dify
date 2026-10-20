"""Resource access token persistence with repository-owned transactions and value results."""

from typing import override
from uuid import uuid4

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from constants.resource_access_token import TOKEN_PREFIX, ResourceAccessTokenResourceType
from libs.datetime_utils import naive_utc_now
from models.account import Tenant, TenantStatus
from models.dataset import Dataset
from models.model import App
from models.resource_access_token import ResourceAccessToken, ResourceAccessTokenRelation
from services.auth.resource_access_token_contracts import (
    BoundResource,
    ResourceAccessTokenAccess,
    ResourceAccessTokenCreateResult,
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInvalidError,
    ResourceAccessTokenNotFoundError,
    ResourceAccessTokenResource,
    ResourceAccessTokenRow,
    mask_token,
)
from services.resource_access_token_service import ResourceAccessTokenCleanupStore, ResourceAccessTokenStore


class ResourceAccessTokenRepository(ResourceAccessTokenStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def create(
        self, tenant_id: str, created_by: str, name: str, resources: tuple[ResourceAccessTokenResource, ...]
    ) -> ResourceAccessTokenCreateResult:
        with self._session_factory.begin() as session:
            token = ResourceAccessToken(
                tenant_id=tenant_id,
                name=name,
                created_by=created_by,
                token=self._generate_token(session),
                track_id=self._generate_track_id(session),
            )
            session.add(token)
            session.flush()
            for resource in resources:
                self._ensure_resource_available(session, tenant_id, resource)
                session.add(self._relation(token.id, resource))
            session.flush()
            return ResourceAccessTokenCreateResult(
                token_id=token.id,
                token=token.token,
                rows=self._rows(session, tenant_id, (token.id,), include_token=True),
            )

    @override
    def list_rows(
        self, tenant_id: str, page: int, limit: int, keyword: str | None = None
    ) -> tuple[ResourceAccessTokenRow, ...]:
        with self._session_factory() as session:
            token_query = (
                select(ResourceAccessToken.id, ResourceAccessToken.created_at)
                .outerjoin(
                    ResourceAccessTokenRelation,
                    ResourceAccessTokenRelation.token_id == ResourceAccessToken.id,
                )
                .outerjoin(
                    App,
                    (App.id == ResourceAccessTokenRelation.app_id) & (App.tenant_id == tenant_id),
                )
                .outerjoin(
                    Dataset,
                    (Dataset.id == ResourceAccessTokenRelation.dataset_id) & (Dataset.tenant_id == tenant_id),
                )
                .where(ResourceAccessToken.tenant_id == tenant_id)
            )
            if keyword:
                token_query = token_query.where(self._keyword_filter(keyword))
            token_ids = tuple(
                row.id
                for row in session.execute(
                    token_query.distinct()
                    .order_by(ResourceAccessToken.created_at.desc())
                    .offset(max(page - 1, 0) * limit)
                    .limit(limit)
                )
            )
            return self._rows(session, tenant_id, token_ids, include_token=False)

    @override
    def count_tokens(self, tenant_id: str, keyword: str | None = None) -> int:
        with self._session_factory() as session:
            count_query = (
                select(func.count(func.distinct(ResourceAccessToken.id)))
                .outerjoin(
                    ResourceAccessTokenRelation,
                    ResourceAccessTokenRelation.token_id == ResourceAccessToken.id,
                )
                .outerjoin(
                    App,
                    (App.id == ResourceAccessTokenRelation.app_id) & (App.tenant_id == tenant_id),
                )
                .outerjoin(
                    Dataset,
                    (Dataset.id == ResourceAccessTokenRelation.dataset_id) & (Dataset.tenant_id == tenant_id),
                )
                .where(ResourceAccessToken.tenant_id == tenant_id)
            )
            if keyword:
                count_query = count_query.where(self._keyword_filter(keyword))
            return session.scalar(count_query) or 0

    @staticmethod
    def _keyword_filter(keyword: str) -> ColumnElement[bool]:
        from libs.helper import escape_like_pattern

        pattern = f"%{escape_like_pattern(keyword[:100])}%"
        return or_(
            ResourceAccessToken.name.ilike(pattern, escape="\\"),
            ResourceAccessToken.track_id.ilike(pattern, escape="\\"),
            ResourceAccessToken.token.ilike(pattern, escape="\\"),
            App.name.ilike(pattern, escape="\\"),
            Dataset.name.ilike(pattern, escape="\\"),
        )

    @override
    def update(
        self, tenant_id: str, token_id: str, name: str, resources: tuple[ResourceAccessTokenResource, ...] | None
    ) -> tuple[ResourceAccessTokenRow, ...]:
        with self._session_factory.begin() as session:
            token = self._get_token(session, tenant_id, token_id)
            token.name = name
            if resources is not None:
                for resource in resources:
                    self._ensure_resource_available(session, tenant_id, resource)
                existing = session.scalars(
                    select(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token.id)
                ).all()
                by_key = {self._relation_key(relation): relation for relation in existing}
                desired_keys = {(resource.type, resource.id) for resource in resources}
                for key, relation in by_key.items():
                    if key not in desired_keys:
                        session.delete(relation)
                for resource in resources:
                    if (resource.type, resource.id) not in by_key:
                        session.add(self._relation(token.id, resource))
            session.flush()
            return self._rows(session, tenant_id, (token.id,), include_token=False)

    @override
    def delete(self, tenant_id: str, token_id: str, relation_id: str) -> None:
        with self._session_factory.begin() as session:
            token = self._get_token(session, tenant_id, token_id)
            relation = session.scalar(
                select(ResourceAccessTokenRelation.id).where(
                    ResourceAccessTokenRelation.id == relation_id,
                    ResourceAccessTokenRelation.token_id == token.id,
                )
            )
            if relation is None:
                raise ResourceAccessTokenNotFoundError("Resource access token relation not found.")
            session.execute(delete(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token.id))
            session.delete(token)

    @override
    def access_by_secret(self, token: str) -> ResourceAccessTokenAccess:
        with self._session_factory() as session:
            row = session.scalar(select(ResourceAccessToken).where(ResourceAccessToken.token == token))
            return self._access(session, row)

    @override
    def access_by_id(self, token_id: str) -> ResourceAccessTokenAccess:
        with self._session_factory() as session:
            return self._access(session, session.get(ResourceAccessToken, token_id))

    @override
    def record_usage(self, tenant_id: str, token_id: str) -> None:
        with self._session_factory.begin() as session:
            token = session.scalar(
                select(ResourceAccessToken)
                .where(ResourceAccessToken.id == token_id, ResourceAccessToken.tenant_id == tenant_id)
                .with_for_update()
            )
            if token is None:
                raise ResourceAccessTokenInvalidError("Resource access token is invalid.")
            token.last_used_at = naive_utc_now()

    @staticmethod
    def _get_token(session: Session, tenant_id: str, token_id: str) -> ResourceAccessToken:
        token = session.scalar(
            select(ResourceAccessToken)
            .where(ResourceAccessToken.id == token_id, ResourceAccessToken.tenant_id == tenant_id)
            .with_for_update()
        )
        if token is None:
            raise ResourceAccessTokenNotFoundError("Resource access token not found.")
        return token

    @staticmethod
    def _relation(token_id: str, resource: ResourceAccessTokenResource) -> ResourceAccessTokenRelation:
        return ResourceAccessTokenRelation(
            token_id=token_id,
            resource_type=resource.type,
            app_id=resource.id if resource.type == ResourceAccessTokenResourceType.APP else None,
            dataset_id=resource.id if resource.type == ResourceAccessTokenResourceType.KNOWLEDGE else None,
        )

    @staticmethod
    def _relation_key(relation: ResourceAccessTokenRelation) -> tuple[ResourceAccessTokenResourceType, str]:
        resource_id = (
            relation.app_id if relation.resource_type == ResourceAccessTokenResourceType.APP else relation.dataset_id
        )
        assert resource_id is not None
        return relation.resource_type, resource_id

    @staticmethod
    def _ensure_resource_available(session: Session, tenant_id: str, resource: ResourceAccessTokenResource) -> None:
        if resource.type == ResourceAccessTokenResourceType.APP:
            app = session.scalar(select(App).where(App.id == resource.id, App.tenant_id == tenant_id))
            if app is None:
                raise ResourceAccessTokenNotFoundError("App not found.")
            if app.status != "normal" or not app.enable_api:
                raise ResourceAccessTokenForbiddenError("App API access is not enabled.")
        else:
            dataset = session.scalar(select(Dataset).where(Dataset.id == resource.id, Dataset.tenant_id == tenant_id))
            if dataset is None:
                raise ResourceAccessTokenNotFoundError("Knowledge base not found.")
            if not dataset.enable_api:
                raise ResourceAccessTokenForbiddenError("Knowledge base API access is not enabled.")

    @staticmethod
    def _generate_token(session: Session) -> str:
        while True:
            value = f"{TOKEN_PREFIX}{uuid4()}"
            if not session.scalar(select(ResourceAccessToken.id).where(ResourceAccessToken.token == value)):
                return value

    @staticmethod
    def _generate_track_id(session: Session) -> str:
        while True:
            value = uuid4().hex
            if not session.scalar(select(ResourceAccessToken.id).where(ResourceAccessToken.track_id == value)):
                return value

    @classmethod
    def _rows(
        cls, session: Session, tenant_id: str, token_ids: tuple[str, ...], *, include_token: bool
    ) -> tuple[ResourceAccessTokenRow, ...]:
        rows = session.execute(
            select(ResourceAccessToken, ResourceAccessTokenRelation, App.name, Dataset.name)
            .join(ResourceAccessTokenRelation, ResourceAccessTokenRelation.token_id == ResourceAccessToken.id)
            .outerjoin(App, (App.id == ResourceAccessTokenRelation.app_id) & (App.tenant_id == tenant_id))
            .outerjoin(
                Dataset, (Dataset.id == ResourceAccessTokenRelation.dataset_id) & (Dataset.tenant_id == tenant_id)
            )
            .where(ResourceAccessToken.tenant_id == tenant_id, ResourceAccessToken.id.in_(token_ids))
            .order_by(ResourceAccessToken.created_at.desc(), ResourceAccessTokenRelation.created_at.desc())
        )
        return tuple(
            ResourceAccessTokenRow(
                token_id=token.id,
                relation_id=relation.id,
                name=token.name,
                track_id=token.track_id,
                token=token.token if include_token else None,
                masked_token=mask_token(token.token),
                resource_type=relation.resource_type,
                resource_id=cls._relation_key(relation)[1],
                resource_name=app_name or dataset_name or "",
                created_at=token.created_at,
                last_used_at=token.last_used_at,
            )
            for token, relation, app_name, dataset_name in rows
        )

    @classmethod
    def _access(cls, session: Session, token: ResourceAccessToken | None) -> ResourceAccessTokenAccess:
        if token is None:
            raise ResourceAccessTokenInvalidError("Resource access token is invalid.")
        tenant = session.get(Tenant, token.tenant_id)
        rows = session.execute(
            select(ResourceAccessTokenRelation, App.id, App.status, App.enable_api, Dataset.id, Dataset.enable_api)
            .outerjoin(App, (App.id == ResourceAccessTokenRelation.app_id) & (App.tenant_id == token.tenant_id))
            .outerjoin(
                Dataset, (Dataset.id == ResourceAccessTokenRelation.dataset_id) & (Dataset.tenant_id == token.tenant_id)
            )
            .where(ResourceAccessTokenRelation.token_id == token.id)
        )
        resources = tuple(
            BoundResource(
                type=relation.resource_type,
                id=cls._relation_key(relation)[1],
                exists=app_id is not None
                if relation.resource_type == ResourceAccessTokenResourceType.APP
                else dataset_id is not None,
                enabled=bool(app_enabled and app_status == "normal")
                if relation.resource_type == ResourceAccessTokenResourceType.APP
                else bool(dataset_enabled),
            )
            for relation, app_id, app_status, app_enabled, dataset_id, dataset_enabled in rows
        )
        return ResourceAccessTokenAccess(
            token.id, token.tenant_id, tenant is not None and tenant.status == TenantStatus.NORMAL, resources
        )


class ResourceAccessTokenCleanupRepository(ResourceAccessTokenCleanupStore):
    def __init__(self, *, session: Session) -> None:
        self._session = session

    @override
    def delete_resource_relations(
        self, *, tenant_id: str, resource_type: ResourceAccessTokenResourceType, resource_id: str
    ) -> None:
        """Join an existing resource-deletion transaction; never commit the caller's work."""
        session = self._session
        field = (
            ResourceAccessTokenRelation.app_id
            if resource_type == ResourceAccessTokenResourceType.APP
            else ResourceAccessTokenRelation.dataset_id
        )
        token_ids = tuple(
            session.scalars(
                select(ResourceAccessToken.id)
                .join(ResourceAccessTokenRelation, ResourceAccessTokenRelation.token_id == ResourceAccessToken.id)
                .where(
                    ResourceAccessToken.tenant_id == tenant_id,
                    ResourceAccessTokenRelation.resource_type == resource_type,
                    field == resource_id,
                )
            )
        )
        if not token_ids:
            return
        session.execute(
            delete(ResourceAccessTokenRelation).where(
                ResourceAccessTokenRelation.token_id.in_(token_ids),
                ResourceAccessTokenRelation.resource_type == resource_type,
                field == resource_id,
            )
        )
        session.execute(
            delete(ResourceAccessToken).where(
                ResourceAccessToken.tenant_id == tenant_id,
                ResourceAccessToken.id.in_(token_ids),
                ~select(ResourceAccessTokenRelation.id)
                .where(ResourceAccessTokenRelation.token_id == ResourceAccessToken.id)
                .exists(),
            )
        )
