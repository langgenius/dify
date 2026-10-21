"""Tag queries used by application-listing paths."""

import sqlalchemy as sa
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.enums import TagType
from models.model import Tag, TagBinding

type _TagTypeLike = TagType | str


class TagService:
    @staticmethod
    def get_target_ids_by_tag_ids(
        tag_type: _TagTypeLike,
        current_tenant_id: str,
        tag_ids: list[str],
        session: Session,
        *,
        match_all: bool = False,
    ):
        """Return tenant-owned targets matching any or all requested tags."""
        if not tag_ids:
            return []

        requested_tag_ids = list(dict.fromkeys(tag_ids))
        matching_tag_ids = list(
            session.scalars(
                select(Tag.id).where(
                    Tag.id.in_(requested_tag_ids),
                    Tag.tenant_id == current_tenant_id,
                    Tag.type == tag_type,
                )
            ).all()
        )
        if not matching_tag_ids:
            return []

        if match_all:
            if len(matching_tag_ids) != len(requested_tag_ids):
                return []
            return session.scalars(
                select(TagBinding.target_id)
                .where(TagBinding.tag_id.in_(matching_tag_ids), TagBinding.tenant_id == current_tenant_id)
                .group_by(TagBinding.target_id)
                .having(func.count(sa.distinct(TagBinding.tag_id)) == len(matching_tag_ids))
            ).all()

        return session.scalars(
            select(TagBinding.target_id).where(
                TagBinding.tag_id.in_(matching_tag_ids),
                TagBinding.tenant_id == current_tenant_id,
            )
        ).all()
