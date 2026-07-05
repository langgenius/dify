import uuid
from typing import cast

import sqlalchemy as sa
from flask_login import current_user
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import NotFound

from models.dataset import Dataset
from models.enums import TagType
from models.model import App, Tag, TagBinding
from models.snippet import CustomizedSnippet

type _SessionLike = Session | scoped_session
type _TagTypeLike = TagType | str


class SaveTagPayload(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    type: TagType


class UpdateTagPayload(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class TagBindingCreatePayload(BaseModel):
    tag_ids: list[str]
    target_id: str
    type: TagType


class TagBindingDeletePayload(BaseModel):
    tag_ids: list[str] = Field(min_length=1)
    target_id: str
    type: TagType


class TagService:
    @staticmethod
    def get_tags(session: Session, tag_type: _TagTypeLike, current_tenant_id: str, keyword: str | None = None):
        stmt = (
            select(Tag.id, Tag.type, Tag.name, func.count(TagBinding.id).label("binding_count"))
            .outerjoin(TagBinding, Tag.id == TagBinding.tag_id)
            .where(Tag.type == tag_type, Tag.tenant_id == current_tenant_id)
        )
        if keyword:
            from libs.helper import escape_like_pattern

            escaped_keyword = escape_like_pattern(keyword)
            stmt = stmt.where(sa.and_(Tag.name.ilike(f"%{escaped_keyword}%", escape="\\")))
        stmt = stmt.group_by(Tag.id, Tag.type, Tag.name, Tag.created_at)
        results: list = list(session.execute(stmt.order_by(Tag.created_at.desc())).all())
        return results

    @staticmethod
    def get_target_ids_by_tag_ids(
        tag_type: _TagTypeLike,
        current_tenant_id: str,
        tag_ids: list[str],
        session: _SessionLike,
        *,
        match_all: bool = False,
    ):
        """
        Return target IDs bound to tags for the given tenant and resource type.

        By default this preserves the legacy "match any tag" behavior and returns one target ID per matching
        binding. When match_all is enabled, every requested tag must exist for the tenant/type and each returned
        target must be bound to all requested tags.
        """
        # Check if tag_ids is not empty to avoid WHERE false condition
        if not tag_ids or len(tag_ids) == 0:
            return []
        # Deduplicate repeated query params so match_all counts each requested tag once.
        requested_tag_ids = list(dict.fromkeys(tag_ids))
        tags = session.scalars(
            select(Tag.id).where(
                Tag.id.in_(requested_tag_ids),
                Tag.tenant_id == current_tenant_id,
                Tag.type == tag_type,
            )
        ).all()
        if not tags:
            return []
        tag_ids = list(tags)
        # Check if tag_ids is not empty to avoid WHERE false condition
        if not tag_ids or len(tag_ids) == 0:
            return []
        if match_all:
            if len(tag_ids) != len(requested_tag_ids):
                return []
            return session.scalars(
                select(TagBinding.target_id)
                .where(TagBinding.tag_id.in_(tag_ids), TagBinding.tenant_id == current_tenant_id)
                .group_by(TagBinding.target_id)
                .having(func.count(sa.distinct(TagBinding.tag_id)) == len(tag_ids))
            ).all()
        tag_bindings = session.scalars(
            select(TagBinding.target_id).where(
                TagBinding.tag_id.in_(tag_ids), TagBinding.tenant_id == current_tenant_id
            )
        ).all()
        return tag_bindings

    @staticmethod
    def get_tag_by_tag_name(tag_type: _TagTypeLike, current_tenant_id: str, tag_name: str, session: _SessionLike):
        if not tag_type or not tag_name:
            return []
        tags = list(
            session.scalars(
                select(Tag).where(Tag.name == tag_name, Tag.tenant_id == current_tenant_id, Tag.type == tag_type)
            ).all()
        )
        if not tags:
            return []
        return tags

    @staticmethod
    def get_tags_by_target_id(tag_type: _TagTypeLike, current_tenant_id: str, target_id: str, session: _SessionLike):
        tags = session.scalars(
            select(Tag)
            .join(TagBinding, Tag.id == TagBinding.tag_id)
            .where(
                TagBinding.target_id == target_id,
                TagBinding.tenant_id == current_tenant_id,
                Tag.tenant_id == current_tenant_id,
                Tag.type == tag_type,
            )
        ).all()

        return tags or []

    @staticmethod
    def save_tags(payload: SaveTagPayload, session: _SessionLike) -> Tag:
        if TagService.get_tag_by_tag_name(payload.type, current_user.current_tenant_id, payload.name, session):
            raise ValueError("Tag name already exists")
        tag = Tag(
            name=payload.name,
            type=TagType(payload.type),
            created_by=current_user.id,
            tenant_id=current_user.current_tenant_id,
        )
        tag.id = str(uuid.uuid4())
        session.add(tag)
        session.commit()
        return tag

    @staticmethod
    def update_tags(
        payload: UpdateTagPayload, tag_id: str, session: _SessionLike, *, tag_type: TagType | None = None
    ) -> Tag:
        current_tenant_id = current_user.current_tenant_id
        stmt = select(Tag).where(Tag.id == tag_id, Tag.tenant_id == current_tenant_id)
        if tag_type is not None:
            stmt = stmt.where(Tag.type == tag_type)
        tag = session.scalar(stmt.limit(1))
        if not tag:
            raise NotFound("Tag not found")
        if payload.name != tag.name:
            existing = session.scalar(
                select(Tag)
                .where(
                    Tag.name == payload.name,
                    Tag.tenant_id == current_user.current_tenant_id,
                    Tag.type == tag.type,
                    Tag.id != tag_id,
                )
                .limit(1)
            )
            if existing:
                raise ValueError("Tag name already exists")
        tag.name = payload.name
        session.commit()
        return tag

    @staticmethod
    def get_tag_binding_count(tag_id: str, session: _SessionLike, *, tag_type: TagType | None = None) -> int:
        current_tenant_id = current_user.current_tenant_id
        stmt = (
            select(func.count(TagBinding.id))
            .join(Tag, Tag.id == TagBinding.tag_id)
            .where(TagBinding.tag_id == tag_id, Tag.tenant_id == current_tenant_id)
        )
        if tag_type is not None:
            stmt = stmt.where(Tag.type == tag_type)
        count = session.scalar(stmt) or 0
        return count

    @staticmethod
    def delete_tag(tag_id: str, session: _SessionLike, *, tag_type: TagType | None = None):
        current_tenant_id = current_user.current_tenant_id
        stmt = select(Tag).where(Tag.id == tag_id, Tag.tenant_id == current_tenant_id)
        if tag_type is not None:
            stmt = stmt.where(Tag.type == tag_type)
        tag = session.scalar(stmt.limit(1))
        if not tag:
            raise NotFound("Tag not found")
        session.delete(tag)
        # delete tag binding
        tag_bindings = session.scalars(
            select(TagBinding).where(TagBinding.tag_id == tag_id, TagBinding.tenant_id == current_tenant_id)
        ).all()
        if tag_bindings:
            for tag_binding in tag_bindings:
                session.delete(tag_binding)
        session.commit()

    @staticmethod
    def save_tag_binding(payload: TagBindingCreatePayload, session: _SessionLike):
        TagService.check_target_exists(payload.type, payload.target_id, session)
        valid_tag_ids = session.scalars(
            select(Tag.id).where(
                Tag.id.in_(payload.tag_ids),
                Tag.tenant_id == current_user.current_tenant_id,
                Tag.type == payload.type,
            )
        ).all()
        for tag_id in valid_tag_ids:
            tag_binding = session.scalar(
                select(TagBinding)
                .where(TagBinding.tag_id == tag_id, TagBinding.target_id == payload.target_id)
                .limit(1)
            )
            if tag_binding:
                continue
            new_tag_binding = TagBinding(
                tag_id=tag_id,
                target_id=payload.target_id,
                tenant_id=current_user.current_tenant_id,
                created_by=current_user.id,
            )
            session.add(new_tag_binding)
        session.commit()

    @staticmethod
    def delete_tag_binding(payload: TagBindingDeletePayload, session: _SessionLike):
        TagService.check_target_exists(payload.type, payload.target_id, session)
        result = cast(
            CursorResult,
            session.execute(
                delete(TagBinding).where(
                    TagBinding.target_id == payload.target_id,
                    TagBinding.tag_id.in_(payload.tag_ids),
                    TagBinding.tenant_id == current_user.current_tenant_id,
                    TagBinding.tag_id.in_(
                        select(Tag.id).where(
                            Tag.tenant_id == current_user.current_tenant_id,
                            Tag.type == payload.type,
                        )
                    ),
                )
            ),
        )

        if result.rowcount:
            session.commit()

    @staticmethod
    def check_target_exists(type: _TagTypeLike, target_id: str, session: _SessionLike):
        if type == "knowledge":
            dataset = session.scalar(
                select(Dataset)
                .where(Dataset.tenant_id == current_user.current_tenant_id, Dataset.id == target_id)
                .limit(1)
            )
            if not dataset:
                raise NotFound("Dataset not found")
        elif type == "app":
            app = session.scalar(
                select(App).where(App.tenant_id == current_user.current_tenant_id, App.id == target_id).limit(1)
            )
            if not app:
                raise NotFound("App not found")
        elif type == "snippet":
            snippet = session.scalar(
                select(CustomizedSnippet)
                .where(CustomizedSnippet.tenant_id == current_user.current_tenant_id, CustomizedSnippet.id == target_id)
                .limit(1)
            )
            if not snippet:
                raise NotFound("Snippet not found")
        else:
            raise NotFound("Invalid binding type")
