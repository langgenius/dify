from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound, Unauthorized

from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset
from models.model import App
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)

TOKEN_PREFIX = "sk-"
MASK_PREFIX_LENGTH = 8
MASK_SUFFIX_LENGTH = 4


@dataclass(frozen=True)
class ResourceAccessTokenResource:
    type: ResourceAccessTokenResourceType
    id: str


@dataclass(frozen=True)
class ResourceAccessTokenRow:
    token_id: str
    relation_id: str
    name: str
    track_id: str
    token: str | None
    masked_token: str
    resource_type: ResourceAccessTokenResourceType
    resource_id: str
    resource_name: str
    created_at: datetime
    last_used_at: datetime | None


@dataclass(frozen=True)
class ResourceAccessTokenCreateResult:
    token_id: str
    token: str
    rows: list[ResourceAccessTokenRow]


class ResourceAccessTokenService:
    @classmethod
    def create(
        cls,
        *,
        tenant_id: str,
        created_by: str,
        name: str,
        resources: list[ResourceAccessTokenResource],
        session: Session,
    ) -> ResourceAccessTokenCreateResult:
        name = cls._normalize_name(name)
        if not resources:
            raise BadRequest("At least one resource is required.")

        token = ResourceAccessToken(
            tenant_id=tenant_id,
            name=name,
            track_id=cls._generate_track_id(session),
            token=cls._generate_token(session),
            created_by=created_by,
        )
        session.add(token)
        session.flush()

        seen: set[tuple[ResourceAccessTokenResourceType, str]] = set()
        for resource in resources:
            key = (resource.type, resource.id)
            if key in seen:
                continue
            seen.add(key)
            cls._ensure_resource_available(tenant_id=tenant_id, resource=resource, session=session)
            relation = ResourceAccessTokenRelation(
                token_id=token.id,
                resource_type=resource.type,
                app_id=resource.id if resource.type == ResourceAccessTokenResourceType.APP else None,
                dataset_id=resource.id if resource.type == ResourceAccessTokenResourceType.KNOWLEDGE else None,
            )
            session.add(relation)

        session.commit()
        rows = cls.list_rows(tenant_id=tenant_id, token_id=token.id, include_token=True, session=session)
        return ResourceAccessTokenCreateResult(token_id=token.id, token=token.token, rows=rows)

    @classmethod
    def list_rows(
        cls,
        *,
        tenant_id: str,
        session: Session,
        page: int = 1,
        limit: int = 20,
        token_id: str | None = None,
        include_token: bool = False,
    ) -> list[ResourceAccessTokenRow]:
        stmt = (
            select(ResourceAccessToken, ResourceAccessTokenRelation, App.name, Dataset.name)
            .join(ResourceAccessTokenRelation, ResourceAccessTokenRelation.token_id == ResourceAccessToken.id)
            .outerjoin(App, App.id == ResourceAccessTokenRelation.app_id)
            .outerjoin(Dataset, Dataset.id == ResourceAccessTokenRelation.dataset_id)
            .where(ResourceAccessToken.tenant_id == tenant_id)
            .order_by(ResourceAccessToken.created_at.desc(), ResourceAccessTokenRelation.created_at.desc())
        )
        if token_id:
            stmt = stmt.where(ResourceAccessToken.id == token_id)
        else:
            token_ids = (
                select(ResourceAccessToken.id)
                .where(ResourceAccessToken.tenant_id == tenant_id)
                .order_by(ResourceAccessToken.created_at.desc())
                .offset(max(page - 1, 0) * limit)
                .limit(limit)
            )
            stmt = stmt.where(ResourceAccessToken.id.in_(token_ids))

        return [
            cls._row_from_models(token, relation, app_name, dataset_name, include_token=include_token)
            for token, relation, app_name, dataset_name in session.execute(stmt).all()
        ]

    @classmethod
    def count_rows(cls, *, tenant_id: str, session: Session) -> int:
        return (
            session.scalar(select(func.count(ResourceAccessToken.id)).where(ResourceAccessToken.tenant_id == tenant_id))
            or 0
        )

    @classmethod
    def update(
        cls,
        *,
        tenant_id: str,
        token_id: str,
        name: str,
        resources: list[ResourceAccessTokenResource] | None = None,
        session: Session,
    ) -> list[ResourceAccessTokenRow]:
        token = cls._get_token(tenant_id=tenant_id, token_id=token_id, session=session)
        token.name = cls._normalize_name(name)
        if resources is not None:
            if not resources:
                raise BadRequest("At least one resource is required.")

            seen: set[tuple[ResourceAccessTokenResourceType, str]] = set()
            desired_resources: list[ResourceAccessTokenResource] = []
            for resource in resources:
                key = (resource.type, resource.id)
                if key in seen:
                    continue
                seen.add(key)
                cls._ensure_resource_available(tenant_id=tenant_id, resource=resource, session=session)
                desired_resources.append(resource)

            existing_relations = session.scalars(
                select(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token.id)
            ).all()
            existing_by_key = {cls._relation_key(relation): relation for relation in existing_relations}
            desired_keys = {(resource.type, resource.id) for resource in desired_resources}

            for key, relation in existing_by_key.items():
                if key not in desired_keys:
                    session.delete(relation)

            for resource in desired_resources:
                key = (resource.type, resource.id)
                if key in existing_by_key:
                    continue
                session.add(
                    ResourceAccessTokenRelation(
                        token_id=token.id,
                        resource_type=resource.type,
                        app_id=resource.id if resource.type == ResourceAccessTokenResourceType.APP else None,
                        dataset_id=resource.id if resource.type == ResourceAccessTokenResourceType.KNOWLEDGE else None,
                    )
                )

        session.commit()
        return cls.list_rows(tenant_id=tenant_id, token_id=token_id, session=session)

    @classmethod
    def delete_relation(cls, *, tenant_id: str, token_id: str, relation_id: str, session: Session) -> None:
        token = cls._get_token(tenant_id=tenant_id, token_id=token_id, session=session)
        relation = session.scalar(
            select(ResourceAccessTokenRelation).where(
                ResourceAccessTokenRelation.id == relation_id,
                ResourceAccessTokenRelation.token_id == token.id,
            )
        )
        if relation is None:
            raise NotFound("Resource access token relation not found.")

        session.execute(delete(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token.id))
        session.delete(token)
        session.commit()

    @classmethod
    def delete_relations_for_app(cls, *, app_id: str, session: Session) -> None:
        token_ids = cls._delete_relations(
            resource_type=ResourceAccessTokenResourceType.APP,
            resource_id_field=ResourceAccessTokenRelation.app_id,
            resource_id=app_id,
            session=session,
        )
        cls._delete_orphan_tokens(token_ids=token_ids, session=session)

    @classmethod
    def delete_relations_for_dataset(cls, *, dataset_id: str, session: Session) -> None:
        token_ids = cls._delete_relations(
            resource_type=ResourceAccessTokenResourceType.KNOWLEDGE,
            resource_id_field=ResourceAccessTokenRelation.dataset_id,
            resource_id=dataset_id,
            session=session,
        )
        cls._delete_orphan_tokens(token_ids=token_ids, session=session)

    @classmethod
    def validate_app_access(cls, *, token: str, app: App, session: Session) -> ResourceAccessToken:
        access_token = cls._get_by_token(token=token, session=session)
        relation = session.scalar(
            select(ResourceAccessTokenRelation).where(
                ResourceAccessTokenRelation.token_id == access_token.id,
                ResourceAccessTokenRelation.resource_type == ResourceAccessTokenResourceType.APP,
                ResourceAccessTokenRelation.app_id == app.id,
            )
        )
        if relation is None:
            raise Forbidden("Resource access token is not allowed to access this app.")
        access_token.last_used_at = naive_utc_now()
        session.commit()
        return access_token

    @classmethod
    def resolve_app_for_service_api(
        cls,
        *,
        token: str,
        requested_app_id: str | None,
        session: Session,
    ) -> App:
        access_token = cls._get_by_token(token=token, session=session)
        stmt = select(ResourceAccessTokenRelation).where(
            ResourceAccessTokenRelation.token_id == access_token.id,
            ResourceAccessTokenRelation.resource_type == ResourceAccessTokenResourceType.APP,
        )
        if requested_app_id:
            stmt = stmt.where(ResourceAccessTokenRelation.app_id == requested_app_id)

        relations = session.scalars(stmt).all()
        if not relations:
            raise Forbidden("Resource access token is not allowed to access this app.")
        if len(relations) > 1:
            raise BadRequest("App ID is required when a resource access token is bound to multiple apps.")

        app_id = relations[0].app_id
        if app_id is None:
            raise Forbidden("Resource access token is not allowed to access this app.")
        app = session.get(App, app_id)
        if app is None:
            raise Forbidden("The app no longer exists.")
        access_token.last_used_at = naive_utc_now()
        session.commit()
        return app

    @classmethod
    def validate_dataset_access(cls, *, token: str, dataset_id: str, session: Session) -> ResourceAccessToken:
        access_token = cls._get_by_token(token=token, session=session)
        relation = session.scalar(
            select(ResourceAccessTokenRelation).where(
                ResourceAccessTokenRelation.token_id == access_token.id,
                ResourceAccessTokenRelation.resource_type == ResourceAccessTokenResourceType.KNOWLEDGE,
                ResourceAccessTokenRelation.dataset_id == dataset_id,
            )
        )
        if relation is None:
            raise Forbidden("Resource access token is not allowed to access this knowledge base.")
        access_token.last_used_at = naive_utc_now()
        session.commit()
        return access_token

    @classmethod
    def resolve_tenant_for_dataset_service_api(
        cls,
        *,
        token: str,
        dataset_id: str | None,
        session: Session,
    ) -> str:
        access_token = cls._get_by_token(token=token, session=session)
        stmt = select(ResourceAccessTokenRelation).where(
            ResourceAccessTokenRelation.token_id == access_token.id,
            ResourceAccessTokenRelation.resource_type == ResourceAccessTokenResourceType.KNOWLEDGE,
        )
        if dataset_id:
            stmt = stmt.where(ResourceAccessTokenRelation.dataset_id == dataset_id)

        relation = session.scalar(stmt.limit(1))
        if relation is None:
            raise Forbidden("Resource access token is not allowed to access this knowledge base.")
        access_token.last_used_at = naive_utc_now()
        session.commit()
        return access_token.tenant_id

    @staticmethod
    def is_resource_access_token(token: str) -> bool:
        return token.startswith(TOKEN_PREFIX)

    @staticmethod
    def mask_token(token: str) -> str:
        if len(token) <= MASK_PREFIX_LENGTH + MASK_SUFFIX_LENGTH:
            return token
        return f"{token[:MASK_PREFIX_LENGTH]}...{token[-MASK_SUFFIX_LENGTH:]}"

    @classmethod
    def _get_by_token(cls, *, token: str, session: Session) -> ResourceAccessToken:
        access_token = session.scalar(select(ResourceAccessToken).where(ResourceAccessToken.token == token))
        if access_token is None:
            raise Unauthorized("Resource access token is invalid.")
        return access_token

    @classmethod
    def _get_token(cls, *, tenant_id: str, token_id: str, session: Session) -> ResourceAccessToken:
        token = session.scalar(
            select(ResourceAccessToken).where(
                ResourceAccessToken.id == token_id,
                ResourceAccessToken.tenant_id == tenant_id,
            )
        )
        if token is None:
            raise NotFound("Resource access token not found.")
        return token

    @staticmethod
    def _normalize_name(name: str) -> str:
        normalized = name.strip()
        if not normalized:
            raise BadRequest("Name is required.")
        return normalized

    @classmethod
    def _generate_token(cls, session: Session) -> str:
        while True:
            value = f"{TOKEN_PREFIX}{uuid4()}"
            if not session.scalar(select(ResourceAccessToken.id).where(ResourceAccessToken.token == value)):
                return value

    @classmethod
    def _generate_track_id(cls, session: Session) -> str:
        while True:
            value = uuid4().hex
            if not session.scalar(select(ResourceAccessToken.id).where(ResourceAccessToken.track_id == value)):
                return value

    @staticmethod
    def _ensure_resource_available(
        *,
        tenant_id: str,
        resource: ResourceAccessTokenResource,
        session: Session,
    ) -> None:
        if resource.type == ResourceAccessTokenResourceType.APP:
            app = session.scalar(select(App).where(App.id == resource.id, App.tenant_id == tenant_id))
            if app is None:
                raise NotFound("App not found.")
            if app.status != "normal" or not app.enable_api:
                raise Forbidden("App API access is not enabled.")
            return

        dataset = session.scalar(select(Dataset).where(Dataset.id == resource.id, Dataset.tenant_id == tenant_id))
        if dataset is None:
            raise NotFound("Knowledge base not found.")
        if not dataset.enable_api:
            raise Forbidden("Knowledge base API access is not enabled.")

    @staticmethod
    def _delete_relations(
        *,
        resource_type: ResourceAccessTokenResourceType,
        resource_id_field,
        resource_id: str,
        session: Session,
    ) -> list[str]:
        token_ids = session.scalars(
            select(ResourceAccessTokenRelation.token_id).where(
                ResourceAccessTokenRelation.resource_type == resource_type,
                resource_id_field == resource_id,
            )
        ).all()
        if token_ids:
            session.execute(
                delete(ResourceAccessTokenRelation).where(
                    ResourceAccessTokenRelation.resource_type == resource_type,
                    resource_id_field == resource_id,
                )
            )
        return list(token_ids)

    @staticmethod
    def _delete_orphan_tokens(*, token_ids: list[str], session: Session) -> None:
        for token_id in set(token_ids):
            remaining_count = (
                session.scalar(
                    select(func.count(ResourceAccessTokenRelation.id)).where(
                        ResourceAccessTokenRelation.token_id == token_id,
                    )
                )
                or 0
            )
            if remaining_count == 0:
                session.execute(delete(ResourceAccessToken).where(ResourceAccessToken.id == token_id))

    @staticmethod
    def _relation_key(
        relation: ResourceAccessTokenRelation,
    ) -> tuple[ResourceAccessTokenResourceType, str]:
        resource_id = (
            relation.app_id if relation.resource_type == ResourceAccessTokenResourceType.APP else relation.dataset_id
        )
        assert resource_id is not None
        return relation.resource_type, resource_id

    @classmethod
    def _row_from_models(
        cls,
        token: ResourceAccessToken,
        relation: ResourceAccessTokenRelation,
        app_name: str | None,
        dataset_name: str | None,
        *,
        include_token: bool,
    ) -> ResourceAccessTokenRow:
        resource_id = (
            relation.app_id if relation.resource_type == ResourceAccessTokenResourceType.APP else relation.dataset_id
        )
        assert resource_id is not None
        return ResourceAccessTokenRow(
            token_id=token.id,
            relation_id=relation.id,
            name=token.name,
            track_id=token.track_id,
            token=token.token if include_token else None,
            masked_token=cls.mask_token(token.token),
            resource_type=relation.resource_type,
            resource_id=resource_id,
            resource_name=app_name or dataset_name or "",
            created_at=token.created_at,
            last_used_at=token.last_used_at,
        )
