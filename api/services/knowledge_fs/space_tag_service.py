"""Dify-owned tag bindings for KnowledgeFS control-spaces."""

from __future__ import annotations

from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.enums import TagType
from models.knowledge_fs import KnowledgeFSSpaceTagBinding
from models.model import Tag
from services.knowledge_fs.product_dto import KnowledgeFSSpaceTagResponse
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission


class KnowledgeFSSpaceTagAuthorizationPort(Protocol):
    def authorize_control_space_in_session(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> object: ...


class KnowledgeFSSpaceTagValidationError(ValueError):
    """The requested tag set is invalid for the tenant or resource type."""


class KnowledgeFSSpaceTagService:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        product: KnowledgeFSSpaceTagAuthorizationPort,
    ) -> None:
        self._session_maker = session_maker
        self._product = product

    def list_tags(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
    ) -> list[KnowledgeFSSpaceTagResponse]:
        with self._session_maker() as session:
            self._product.authorize_control_space_in_session(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                permission=KnowledgeFSProductPermission.READ,
            )
            tags = session.execute(
                sa.select(Tag.id, Tag.name)
                .join(KnowledgeFSSpaceTagBinding, KnowledgeFSSpaceTagBinding.tag_id == Tag.id)
                .where(
                    KnowledgeFSSpaceTagBinding.tenant_id == tenant_id,
                    KnowledgeFSSpaceTagBinding.control_space_id == control_space_id,
                    Tag.tenant_id == tenant_id,
                    Tag.type == TagType.KNOWLEDGE,
                )
                .order_by(Tag.created_at.desc(), Tag.id)
            ).all()
            return [KnowledgeFSSpaceTagResponse(id=tag_id, name=name) for tag_id, name in tags]

    def replace_tags(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        tag_ids: list[str],
    ) -> list[KnowledgeFSSpaceTagResponse]:
        requested_tag_ids = tuple(dict.fromkeys(tag_ids))
        with self._session_maker.begin() as session:
            self._product.authorize_control_space_in_session(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                permission=KnowledgeFSProductPermission.EDIT,
            )
            tags = tuple(
                session.scalars(
                    sa.select(Tag).where(
                        Tag.id.in_(requested_tag_ids),
                        Tag.tenant_id == tenant_id,
                        Tag.type == TagType.KNOWLEDGE,
                    )
                )
            )
            if len(tags) != len(requested_tag_ids):
                raise KnowledgeFSSpaceTagValidationError(
                    "Every tag must exist in the current workspace and have type knowledge"
                )

            existing_tag_ids = set(
                session.scalars(
                    sa.select(KnowledgeFSSpaceTagBinding.tag_id).where(
                        KnowledgeFSSpaceTagBinding.tenant_id == tenant_id,
                        KnowledgeFSSpaceTagBinding.control_space_id == control_space_id,
                    )
                )
            )
            requested_tag_id_set = set(requested_tag_ids)
            removed_tag_ids = existing_tag_ids - requested_tag_id_set
            if removed_tag_ids:
                session.execute(
                    sa.delete(KnowledgeFSSpaceTagBinding).where(
                        KnowledgeFSSpaceTagBinding.tenant_id == tenant_id,
                        KnowledgeFSSpaceTagBinding.control_space_id == control_space_id,
                        KnowledgeFSSpaceTagBinding.tag_id.in_(removed_tag_ids),
                    )
                )
            for tag_id in requested_tag_id_set - existing_tag_ids:
                session.add(
                    KnowledgeFSSpaceTagBinding(
                        tenant_id=tenant_id,
                        control_space_id=control_space_id,
                        tag_id=tag_id,
                        created_by=account_id,
                    )
                )

            tags_by_id = {tag.id: tag for tag in tags}
            return [
                KnowledgeFSSpaceTagResponse(id=tag_id, name=tags_by_id[tag_id].name) for tag_id in requested_tag_ids
            ]


def load_space_tags(
    session: Session,
    *,
    tenant_id: str,
    control_space_ids: tuple[str, ...],
) -> dict[str, list[KnowledgeFSSpaceTagResponse]]:
    """Load one page of control-space tags in one query."""
    result: dict[str, list[KnowledgeFSSpaceTagResponse]] = {
        control_space_id: [] for control_space_id in control_space_ids
    }
    if not control_space_ids:
        return result
    rows = session.execute(
        sa.select(KnowledgeFSSpaceTagBinding.control_space_id, Tag.id, Tag.name)
        .join(Tag, Tag.id == KnowledgeFSSpaceTagBinding.tag_id)
        .where(
            KnowledgeFSSpaceTagBinding.tenant_id == tenant_id,
            KnowledgeFSSpaceTagBinding.control_space_id.in_(control_space_ids),
            Tag.tenant_id == tenant_id,
            Tag.type == TagType.KNOWLEDGE,
        )
        .order_by(Tag.created_at.desc(), Tag.id)
    )
    for control_space_id, tag_id, name in rows:
        result[control_space_id].append(KnowledgeFSSpaceTagResponse(id=tag_id, name=name))
    return result


__all__ = [
    "KnowledgeFSSpaceTagService",
    "KnowledgeFSSpaceTagValidationError",
    "load_space_tags",
]
