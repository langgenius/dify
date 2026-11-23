"""SQLAlchemy persistence adapter for Console tag management."""

import uuid
from typing import override

import sqlalchemy as sa
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import escape_like_pattern
from models.account import Tenant
from models.agent import Agent, AgentKind, AgentScope, AgentStatus
from models.dataset import Dataset
from models.enums import TagType
from models.model import App, Tag, TagBinding
from models.skill import Skill
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

    @staticmethod
    def load_tags_for_targets(
        session: Session, *, tenant_id: str, tag_type: str, target_ids: list[str]
    ) -> dict[str, list[dict[str, str]]]:
        """Load one pool's labels in a single caller-owned, tenant-scoped read.

        Preconditions: the caller owns session and target ids are already scoped
        by its resource query. Postconditions: both sides of each binding belong
        to tenant_id and tags belong to tag_type; labels sort by name then id.
        Empty input performs no query. This method neither commits nor closes
        the caller's session and returns no ORM objects.
        """
        if not target_ids:
            return {}
        rows = session.execute(
            select(TagBinding.target_id, Tag.id, Tag.name, Tag.type)
            .join(Tag, Tag.id == TagBinding.tag_id)
            .where(
                TagBinding.tenant_id == tenant_id,
                TagBinding.target_id.in_(target_ids),
                Tag.tenant_id == tenant_id,
                Tag.type == tag_type,
            )
            .distinct()
            .order_by(Tag.name, Tag.id)
        ).all()
        tags_by_target: dict[str, list[dict[str, str]]] = {}
        for target_id, tag_id, name, kind in rows:
            if target_id is not None:
                tags_by_target.setdefault(target_id, []).append({"id": tag_id, "name": name, "type": kind.value})
        return tags_by_target

    @override
    def create_tag(self, workspace_id: str, actor_id: str, tag: CreateTagInput) -> TagSummary:
        """Create in an admitted workspace; Agent-pool locks serialize name checks and insertion.

        A duplicate name raises TagNameConflictError and leaves existing state
        intact. Success commits a detached summary and no bindings.
        """
        with self._session_factory.begin() as session:
            self._lock_agent_tag_pool(session, workspace_id, tag.type)
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
        """Rename a scoped tag without changing its id or bindings.

        Agent mutations acquire the workspace lock before loading mutable tag
        state. Missing tags and conflicting names roll back without side effects.
        Resolve immutable pool membership in a separate read so MySQL's repeatable
        read snapshot cannot retain tag state from before the workspace lock.
        """
        tag_type = self.get_tag_type(workspace_id, tag_id)
        with self._session_factory.begin() as session:
            self._lock_agent_tag_pool(session, workspace_id, tag_type)
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
        """Delete a scoped tag and all its bindings atomically, or fail unchanged if missing.

        Agent-pool writes share a workspace lock so a concurrent bind cannot
        recreate a binding after this transaction deletes the tag.
        Resolve the immutable pool in a separate read, then establish the write
        transaction's snapshot only after acquiring the workspace lock.
        """
        tag_type = self.get_tag_type(workspace_id, tag_id)
        with self._session_factory.begin() as session:
            self._lock_agent_tag_pool(session, workspace_id, tag_type)
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
        """Bind existing tags of this workspace and pool to an available target.

        Agent-pool writes lock the workspace before target/tag validation and
        commit idempotently. A missing target rolls back; foreign-pool, foreign-
        workspace and missing tags are ignored as in the existing tag contract.
        """
        with self._session_factory.begin() as session:
            self._lock_agent_tag_pool(session, workspace_id, binding.type)
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
        """Unbind only this target and pool while keeping shared tags and other targets intact.

        Agent writes use the same workspace lock as tag deletion and creation;
        an unavailable target rolls back without changing any binding.
        """
        with self._session_factory.begin() as session:
            self._lock_agent_tag_pool(session, workspace_id, binding.type)
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
    def _lock_agent_tag_pool(session: Session, workspace_id: str, tag_type: str | None) -> None:
        """Serialize Agent-pool mutations on their admitted, persisted workspace.

        Preconditions: the caller owns a write transaction and workspace_id is
        an existing workspace. Postconditions: for Agent tags the Tenant row is
        locked until commit/rollback, before reading mutable tag/binding state.
        Other pools are untouched. No transaction is committed by this helper.
        """
        if tag_type == TagType.AGENT:
            session.scalar(select(Tenant.id).where(Tenant.id == workspace_id).with_for_update())

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
        """Require a target in this workspace and pool before mutating bindings.

        Agent targets are active Dify roster identities, independent of publication
        and their backing App ids. Missing, archived and workflow-only Agents raise
        TagBindingTargetNotFoundError without changing any tags or bindings. The
        Agent row is locked through the binding write so archival can coordinate
        its cleanup before changing the same identity's lifecycle.
        """
        if binding.type == "knowledge":
            stmt = select(Dataset.id).where(Dataset.tenant_id == workspace_id, Dataset.id == binding.target_id)
        elif binding.type == "app":
            stmt = select(App.id).where(App.tenant_id == workspace_id, App.id == binding.target_id)
        elif binding.type == "agent":
            stmt = (
                select(Agent.id)
                .where(
                    Agent.tenant_id == workspace_id,
                    Agent.id == binding.target_id,
                    Agent.agent_kind == AgentKind.DIFY_AGENT,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.status == AgentStatus.ACTIVE,
                )
                .with_for_update()
            )
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
