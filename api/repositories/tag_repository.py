"""SQLAlchemy persistence adapter for Console tag management."""

import uuid
from typing import override

import sqlalchemy as sa
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import escape_like_pattern
from models.dataset import Dataset
from models.enums import TagType
from models.model import App, Tag, TagBinding
from models.snippet import CustomizedSnippet
from services.tag_application_service import (
    CreateTagInput,
    InvalidTagBindingTypeError,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagNameConflictError,
    TagNotFoundError,
    TagStore,
    TagSummary,
    UpdateTagInput,
)


class TagRepository(TagStore):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_tags(self, workspace_id: str, tag_type: str, keyword: str | None) -> tuple[TagSummary, ...]:
        stmt = (
            select(Tag.id, Tag.name, Tag.type, func.count(TagBinding.id))
            .outerjoin(
                TagBinding,
                sa.and_(TagBinding.tag_id == Tag.id, TagBinding.tenant_id == workspace_id),
            )
            .where(Tag.type == tag_type, Tag.tenant_id == workspace_id)
        )
        if keyword:
            escaped_keyword = escape_like_pattern(keyword)
            stmt = stmt.where(Tag.name.ilike(f"%{escaped_keyword}%", escape="\\"))
        stmt = stmt.group_by(Tag.id, Tag.name, Tag.type, Tag.created_at).order_by(Tag.created_at.desc())

        with self._session_factory() as session:
            return tuple(
                TagSummary(
                    id=tag_id,
                    name=name,
                    type=tag_kind.value,
                    binding_count=binding_count,
                )
                for tag_id, name, tag_kind, binding_count in session.execute(stmt).all()
            )

    @override
    def get_tag_type(self, workspace_id: str, tag_id: str) -> str | None:
        with self._session_factory() as session:
            tag_type = session.scalar(select(Tag.type).where(Tag.id == tag_id, Tag.tenant_id == workspace_id).limit(1))
            return tag_type.value if tag_type is not None else None

    @override
    def create_tag(self, workspace_id: str, actor_id: str, tag: CreateTagInput) -> TagSummary:
        with self._session_factory.begin() as session:
            existing = session.scalar(
                select(Tag.id).where(Tag.name == tag.name, Tag.tenant_id == workspace_id, Tag.type == tag.type).limit(1)
            )
            if existing is not None:
                raise TagNameConflictError

            model = Tag(
                name=tag.name,
                type=TagType(tag.type),
                created_by=actor_id,
                tenant_id=workspace_id,
            )
            model.id = str(uuid.uuid4())
            session.add(model)
            session.flush()
            return self._summary(model, binding_count=0)

    @override
    def update_tag(self, workspace_id: str, tag_id: str, tag: UpdateTagInput) -> TagSummary:
        with self._session_factory.begin() as session:
            model = session.scalar(select(Tag).where(Tag.id == tag_id, Tag.tenant_id == workspace_id).limit(1))
            if model is None:
                raise TagNotFoundError

            if tag.name != model.name:
                existing = session.scalar(
                    select(Tag.id)
                    .where(
                        Tag.name == tag.name,
                        Tag.tenant_id == workspace_id,
                        Tag.type == model.type,
                        Tag.id != tag_id,
                    )
                    .limit(1)
                )
                if existing is not None:
                    raise TagNameConflictError
                model.name = tag.name

            binding_count = (
                session.scalar(
                    select(func.count(TagBinding.id)).where(
                        TagBinding.tag_id == tag_id,
                        TagBinding.tenant_id == workspace_id,
                    )
                )
                or 0
            )
            return self._summary(model, binding_count=binding_count)

    @override
    def delete_tag(self, workspace_id: str, tag_id: str) -> None:
        with self._session_factory.begin() as session:
            model = session.scalar(select(Tag).where(Tag.id == tag_id, Tag.tenant_id == workspace_id).limit(1))
            if model is None:
                raise TagNotFoundError

            session.execute(
                delete(TagBinding).where(
                    TagBinding.tag_id == tag_id,
                    TagBinding.tenant_id == workspace_id,
                )
            )
            session.delete(model)

    @override
    def create_bindings(self, workspace_id: str, actor_id: str, binding: TagBindingInput) -> None:
        with self._session_factory.begin() as session:
            self._ensure_target_exists(session, workspace_id, binding)
            requested_tag_ids = tuple(dict.fromkeys(binding.tag_ids))
            if not requested_tag_ids:
                return

            valid_tag_ids = tuple(
                session.scalars(
                    select(Tag.id).where(
                        Tag.id.in_(requested_tag_ids),
                        Tag.tenant_id == workspace_id,
                        Tag.type == binding.type,
                    )
                ).all()
            )
            if not valid_tag_ids:
                return

            existing_tag_ids = set(
                session.scalars(
                    select(TagBinding.tag_id).where(
                        TagBinding.tag_id.in_(valid_tag_ids),
                        TagBinding.target_id == binding.target_id,
                        TagBinding.tenant_id == workspace_id,
                    )
                ).all()
            )
            session.add_all(
                TagBinding(
                    tag_id=tag_id,
                    target_id=binding.target_id,
                    tenant_id=workspace_id,
                    created_by=actor_id,
                )
                for tag_id in valid_tag_ids
                if tag_id not in existing_tag_ids
            )

    @override
    def delete_bindings(self, workspace_id: str, binding: TagBindingInput) -> None:
        with self._session_factory.begin() as session:
            self._ensure_target_exists(session, workspace_id, binding)
            session.execute(
                delete(TagBinding).where(
                    TagBinding.target_id == binding.target_id,
                    TagBinding.tag_id.in_(binding.tag_ids),
                    TagBinding.tenant_id == workspace_id,
                    TagBinding.tag_id.in_(
                        select(Tag.id).where(
                            Tag.tenant_id == workspace_id,
                            Tag.type == binding.type,
                        )
                    ),
                )
            )

    @staticmethod
    def _summary(tag: Tag, *, binding_count: int) -> TagSummary:
        return TagSummary(
            id=tag.id,
            name=tag.name,
            type=tag.type.value,
            binding_count=binding_count,
        )

    @staticmethod
    def _ensure_target_exists(session: Session, workspace_id: str, binding: TagBindingInput) -> None:
        if binding.type == "knowledge":
            stmt = select(Dataset.id).where(Dataset.tenant_id == workspace_id, Dataset.id == binding.target_id)
        elif binding.type == "app":
            stmt = select(App.id).where(App.tenant_id == workspace_id, App.id == binding.target_id)
        elif binding.type == "snippet":
            stmt = select(CustomizedSnippet.id).where(
                CustomizedSnippet.tenant_id == workspace_id,
                CustomizedSnippet.id == binding.target_id,
            )
        else:
            raise InvalidTagBindingTypeError

        if session.scalar(stmt.limit(1)) is None:
            raise TagBindingTargetNotFoundError(binding.type)
