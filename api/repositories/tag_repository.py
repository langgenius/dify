"""SQLAlchemy persistence adapter for Console tag management."""

import uuid
from collections.abc import Sequence
from typing import override

import sqlalchemy as sa
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import escape_like_pattern
from models.enums import TagType
from models.model import App, Tag, TagBinding
from models.skill import Skill
from models.snippet import CustomizedSnippet
from repositories.knowledge.dataset_read_repository import lock_dataset_row_for_child_write
from services.tag_application_service import (
    CreateTagInput,
    InvalidTagBindingTypeError,
    SkillTagMutations,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagKind,
    TagNameConflictError,
    TagNotFoundError,
    TagStore,
    TagSummary,
    UpdateTagInput,
    normalize_tag_name,
)


def _tag_identity_conditions(*, workspace_id: str, tag_type: TagType, name: str) -> tuple[sa.ColumnElement[bool], ...]:
    normalized_name = normalize_tag_name(tag_type.value, name)
    name_condition = Tag.normalized_name == normalized_name if tag_type == TagType.SKILL else Tag.name == name
    return (Tag.tenant_id == workspace_id, Tag.type == tag_type, name_condition)


def _find_tag(
    session: Session,
    *,
    conditions: tuple[sa.ColumnElement[bool], ...],
    current: bool = False,
) -> Tag | None:
    statement = select(Tag).where(*conditions).limit(1)
    if current:
        statement = statement.with_for_update()
    return session.scalar(statement)


def _get_or_create_tag(
    session: Session,
    *,
    workspace_id: str,
    actor_id: str,
    tag_type: TagType,
    name: str,
) -> tuple[Tag, bool]:
    """Return a tenant-owned tag, inserting it without aborting the caller transaction on a race."""
    conditions = _tag_identity_conditions(workspace_id=workspace_id, tag_type=tag_type, name=name)
    existing = _find_tag(session, conditions=conditions)
    if existing is not None:
        return existing, False

    model = Tag(
        name=name,
        normalized_name=normalize_tag_name(tag_type.value, name) if tag_type == TagType.SKILL else None,
        type=tag_type,
        created_by=actor_id,
        tenant_id=workspace_id,
    )
    model.id = str(uuid.uuid4())
    try:
        with session.begin_nested():
            session.add(model)
            session.flush()
    except IntegrityError:
        # A locking read is a MySQL current read. Unlike a normal consistent
        # read under REPEATABLE READ, it can see the transaction that won the
        # unique-key race after this savepoint was rolled back.
        existing = _find_tag(session, conditions=conditions, current=True)
        if existing is None:
            raise
        return existing, False
    return model, True


def _create_tag_binding_if_absent(
    session: Session,
    *,
    workspace_id: str,
    actor_id: str,
    tag_id: str,
    target_id: str,
) -> bool:
    """Insert one fully scoped tag binding, treating a concurrent identical insert as success."""
    conditions = (
        TagBinding.tenant_id == workspace_id,
        TagBinding.tag_id == tag_id,
        TagBinding.target_id == target_id,
    )
    if session.scalar(select(TagBinding.id).where(*conditions).limit(1)) is not None:
        return False

    try:
        with session.begin_nested():
            session.add(
                TagBinding(
                    tag_id=tag_id,
                    target_id=target_id,
                    tenant_id=workspace_id,
                    created_by=actor_id,
                )
            )
            session.flush()
    except IntegrityError:
        # See _get_or_create_tag: the locking read avoids reusing the old
        # consistent snapshot on MySQL REPEATABLE READ.
        existing = session.scalar(select(TagBinding.id).where(*conditions).limit(1).with_for_update())
        if existing is None:
            raise
        return False
    return True


class TagRepository(TagStore, SkillTagMutations[Session]):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_tags(
        self,
        workspace_id: str,
        tag_type: str,
        keyword: str | None,
        *,
        target_ids: frozenset[str] | None = None,
    ) -> tuple[TagSummary, ...]:
        if target_ids is not None and not target_ids:
            return ()

        binding_join = sa.and_(TagBinding.tag_id == Tag.id, TagBinding.tenant_id == workspace_id)
        if target_ids is not None:
            binding_join = sa.and_(binding_join, TagBinding.target_id.in_(target_ids))
        stmt = (
            select(Tag.id, Tag.name, Tag.type, func.count(TagBinding.id))
            .outerjoin(TagBinding, binding_join)
            .where(Tag.type == tag_type, Tag.tenant_id == workspace_id)
        )
        if target_ids is not None:
            stmt = stmt.where(TagBinding.id.is_not(None))
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
    def list_tags_by_target(self, workspace_id: str, target_id: str, tag_type: str) -> tuple[TagSummary, ...]:
        stmt = (
            select(Tag.id, Tag.name, Tag.type, func.count(TagBinding.id))
            .join(
                TagBinding,
                sa.and_(
                    TagBinding.tag_id == Tag.id,
                    TagBinding.tenant_id == workspace_id,
                    TagBinding.target_id == target_id,
                ),
            )
            .where(Tag.tenant_id == workspace_id, Tag.type == tag_type)
            .group_by(Tag.id, Tag.name, Tag.type, Tag.created_at)
            .order_by(Tag.created_at.desc())
        )
        with self._session_factory() as session:
            return tuple(
                TagSummary(id=tag_id, name=name, type=tag_kind.value, binding_count=binding_count)
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
            model, created = _get_or_create_tag(
                session,
                workspace_id=workspace_id,
                actor_id=actor_id,
                tag_type=TagType(tag.type),
                name=tag.name,
            )
            if not created:
                raise TagNameConflictError
            return self._summary(model, binding_count=0)

    @override
    def update_tag(
        self,
        workspace_id: str,
        tag_id: str,
        tag: UpdateTagInput,
        *,
        expected_type: TagKind | None = None,
    ) -> TagSummary:
        try:
            with self._session_factory.begin() as session:
                conditions = [Tag.id == tag_id, Tag.tenant_id == workspace_id]
                if expected_type is not None:
                    conditions.append(Tag.type == expected_type)
                model = session.scalar(select(Tag).where(*conditions).limit(1))
                if model is None:
                    raise TagNotFoundError

                if tag.name != model.name:
                    model.name = tag.name
                    model.normalized_name = (
                        normalize_tag_name(model.type.value, tag.name) if model.type == TagType.SKILL else None
                    )
                    session.flush()

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
        except IntegrityError as error:
            raise TagNameConflictError from error

    @override
    def delete_tag(self, workspace_id: str, tag_id: str, *, expected_type: TagKind | None = None) -> None:
        with self._session_factory.begin() as session:
            conditions = [Tag.id == tag_id, Tag.tenant_id == workspace_id]
            if expected_type is not None:
                conditions.append(Tag.type == expected_type)
            model = session.scalar(select(Tag).where(*conditions).limit(1))
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

            for tag_id in sorted(valid_tag_ids):
                _create_tag_binding_if_absent(
                    session,
                    workspace_id=workspace_id,
                    actor_id=actor_id,
                    tag_id=tag_id,
                    target_id=binding.target_id,
                )

    @override
    def replace_skill_bindings(
        self,
        session: Session,
        *,
        workspace_id: str,
        actor_id: str,
        skill_id: str,
        names: Sequence[str],
    ) -> None:
        """Replace one Skill's tags in a stable database lock order."""
        names_by_key = {normalize_tag_name("skill", name): name for name in names}
        tags_by_key: dict[str, Tag] = {}
        for normalized_name, name in sorted(names_by_key.items()):
            tag, _ = _get_or_create_tag(
                session,
                workspace_id=workspace_id,
                actor_id=actor_id,
                tag_type=TagType.SKILL,
                name=name,
            )
            tags_by_key[normalized_name] = tag

        session.execute(
            delete(TagBinding).where(
                TagBinding.tenant_id == workspace_id,
                TagBinding.target_id == skill_id,
                TagBinding.tag_id.in_(select(Tag.id).where(Tag.tenant_id == workspace_id, Tag.type == TagType.SKILL)),
            )
        )
        for tag in sorted(tags_by_key.values(), key=lambda item: item.id):
            _create_tag_binding_if_absent(
                session,
                workspace_id=workspace_id,
                actor_id=actor_id,
                tag_id=tag.id,
                target_id=skill_id,
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
            if (
                lock_dataset_row_for_child_write(
                    session,
                    tenant_id=workspace_id,
                    dataset_id=binding.target_id,
                )
                is None
            ):
                raise TagBindingTargetNotFoundError(binding.type)
            return
        elif binding.type == "app":
            stmt = select(App.id).where(App.tenant_id == workspace_id, App.id == binding.target_id)
        elif binding.type == "snippet":
            stmt = select(CustomizedSnippet.id).where(
                CustomizedSnippet.tenant_id == workspace_id,
                CustomizedSnippet.id == binding.target_id,
            )
        elif binding.type == "skill":
            stmt = select(Skill.id).where(Skill.tenant_id == workspace_id, Skill.id == binding.target_id)
        else:
            raise InvalidTagBindingTypeError

        if session.scalar(stmt.limit(1)) is None:
            raise TagBindingTargetNotFoundError(binding.type)

    @override
    def find_target_ids(
        self, *, tenant_id: str, tag_type: str, tag_ids: list[str], match_all: bool = False
    ) -> list[str]:
        with self._session_factory() as session:
            return [
                target_id
                for target_id in self.get_target_ids_by_tag_ids(
                    tag_type, tenant_id, tag_ids, session, match_all=match_all
                )
                if target_id is not None
            ]

    @staticmethod
    def get_target_ids_by_tag_ids(
        tag_type: str | TagType,
        current_tenant_id: str,
        tag_ids: list[str],
        session: Session,
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
        if not tag_ids:
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
        if not tag_ids:
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
