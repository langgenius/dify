import uuid
from typing import cast

import sqlalchemy as sa
from flask_login import current_user
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from werkzeug.exceptions import NotFound

from extensions.ext_database import db
from models.dataset import Dataset
from models.enums import TagType
from models.model import App, Tag, TagBinding


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
    def get_tags(tag_type: str, current_tenant_id: str, keyword: str | None = None):
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
        results: list = list(db.session.execute(stmt.order_by(Tag.created_at.desc())).all())
        return results

    @staticmethod
    def get_target_ids_by_tag_ids(tag_type: str, current_tenant_id: str, tag_ids: list):
        # Check if tag_ids is not empty to avoid WHERE false condition
        if not tag_ids or len(tag_ids) == 0:
            return []
        tags = db.session.scalars(
            select(Tag).where(Tag.id.in_(tag_ids), Tag.tenant_id == current_tenant_id, Tag.type == tag_type)
        ).all()
        if not tags:
            return []
        tag_ids = [tag.id for tag in tags]
        # Check if tag_ids is not empty to avoid WHERE false condition
        if not tag_ids or len(tag_ids) == 0:
            return []
        tag_bindings = db.session.scalars(
            select(TagBinding.target_id).where(
                TagBinding.tag_id.in_(tag_ids), TagBinding.tenant_id == current_tenant_id
            )
        ).all()
        return tag_bindings

    @staticmethod
    def get_tag_by_tag_name(tag_type: str, current_tenant_id: str, tag_name: str):
        if not tag_type or not tag_name:
            return []
        tags = list(
            db.session.scalars(
                select(Tag).where(Tag.name == tag_name, Tag.tenant_id == current_tenant_id, Tag.type == tag_type)
            ).all()
        )
        if not tags:
            return []
        return tags

    @staticmethod
    def get_tags_by_target_id(tag_type: str, current_tenant_id: str, target_id: str):
        tags = db.session.scalars(
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
    def save_tags(payload: SaveTagPayload) -> Tag:
        if TagService.get_tag_by_tag_name(payload.type, current_user.current_tenant_id, payload.name):
            raise ValueError("Tag name already exists")
        tag = Tag(
            name=payload.name,
            type=TagType(payload.type),
            created_by=current_user.id,
            tenant_id=current_user.current_tenant_id,
        )
        tag.id = str(uuid.uuid4())
        db.session.add(tag)
        db.session.commit()
        return tag

    @staticmethod
    def update_tags(payload: UpdateTagPayload, tag_id: str) -> Tag:
        tag = db.session.scalar(select(Tag).where(Tag.id == tag_id).limit(1))
        if not tag:
            raise NotFound("Tag not found")
        if payload.name != tag.name:
            existing = db.session.scalar(
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
        db.session.commit()
        return tag

    @staticmethod
    def get_tag_binding_count(tag_id: str) -> int:
        count = db.session.scalar(select(func.count(TagBinding.id)).where(TagBinding.tag_id == tag_id)) or 0
        return count

    @staticmethod
    def delete_tag(tag_id: str):
        tag = db.session.scalar(select(Tag).where(Tag.id == tag_id).limit(1))
        if not tag:
            raise NotFound("Tag not found")
        db.session.delete(tag)
        # delete tag binding
        tag_bindings = db.session.scalars(select(TagBinding).where(TagBinding.tag_id == tag_id)).all()
        if tag_bindings:
            for tag_binding in tag_bindings:
                db.session.delete(tag_binding)
        db.session.commit()

    @staticmethod
    def save_tag_binding(payload: TagBindingCreatePayload):
        TagService.check_target_exists(payload.type, payload.target_id)
        for tag_id in payload.tag_ids:
            tag_binding = db.session.scalar(
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
            db.session.add(new_tag_binding)
        db.session.commit()

    @staticmethod
    def delete_tag_binding(payload: TagBindingDeletePayload):
        TagService.check_target_exists(payload.type, payload.target_id)
        result = cast(
            CursorResult,
            db.session.execute(
                delete(TagBinding).where(
                    TagBinding.target_id == payload.target_id,
                    TagBinding.tag_id.in_(payload.tag_ids),
                    TagBinding.tenant_id == current_user.current_tenant_id,
                )
            ),
        )

        if result.rowcount:
            db.session.commit()

    @staticmethod
    def check_target_exists(type: str, target_id: str):
        if type == "knowledge":
            dataset = db.session.scalar(
                select(Dataset)
                .where(Dataset.tenant_id == current_user.current_tenant_id, Dataset.id == target_id)
                .limit(1)
            )
            if not dataset:
                raise NotFound("Dataset not found")
        elif type == "app":
            app = db.session.scalar(
                select(App).where(App.tenant_id == current_user.current_tenant_id, App.id == target_id).limit(1)
            )
            if not app:
                raise NotFound("App not found")
        else:
            raise NotFound("Invalid binding type")
