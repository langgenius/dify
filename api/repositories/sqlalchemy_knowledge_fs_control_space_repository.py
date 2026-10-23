"""SQLAlchemy implementation of the KnowledgeFS control-space repository."""

from __future__ import annotations

from datetime import datetime
from typing import cast, override

from sqlalchemy import case, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from repositories.knowledge_fs_control_space_repository import (
    KnowledgeFSControlSpaceCASUpdate,
    KnowledgeFSControlSpaceRepository,
)


class SQLAlchemyKnowledgeFSControlSpaceRepository(KnowledgeFSControlSpaceRepository):
    """Caller-transaction-owned repository with tenant and CAS guards."""

    def __init__(self, session: Session):
        self._session = session

    @override
    def add(self, control_space: KnowledgeFSControlSpace) -> KnowledgeFSControlSpace:
        self._session.add(control_space)
        self._session.flush()
        return control_space

    @override
    def get(self, *, tenant_id: str, control_space_id: str) -> KnowledgeFSControlSpace | None:
        statement = (
            select(KnowledgeFSControlSpace)
            .where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.id == control_space_id,
            )
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def find_by_provisioning_key(self, *, provisioning_key: str) -> KnowledgeFSControlSpace | None:
        statement = (
            select(KnowledgeFSControlSpace)
            .where(KnowledgeFSControlSpace.provisioning_key == provisioning_key)
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def find_by_knowledge_space_id(self, *, tenant_id: str, knowledge_space_id: str) -> KnowledgeFSControlSpace | None:
        statement = (
            select(KnowledgeFSControlSpace)
            .where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.knowledge_space_id == knowledge_space_id,
            )
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def list_for_tenant(self, *, tenant_id: str) -> tuple[KnowledgeFSControlSpace, ...]:
        statement = (
            select(KnowledgeFSControlSpace)
            .where(KnowledgeFSControlSpace.tenant_id == tenant_id)
            .order_by(KnowledgeFSControlSpace.created_at, KnowledgeFSControlSpace.id)
            .execution_options(populate_existing=True)
        )
        return tuple(self._session.scalars(statement).all())

    @override
    def list_for_reconciliation(self, *, limit: int) -> tuple[KnowledgeFSControlSpace, ...]:
        if limit <= 0:
            return ()
        statement = (
            select(KnowledgeFSControlSpace)
            .where(KnowledgeFSControlSpace.state != KnowledgeFSControlSpaceState.DELETED)
            .order_by(
                case(
                    (
                        KnowledgeFSControlSpace.state.in_(
                            (
                                KnowledgeFSControlSpaceState.PROVISIONING,
                                KnowledgeFSControlSpaceState.DELETING,
                                KnowledgeFSControlSpaceState.ERROR,
                            )
                        ),
                        0,
                    ),
                    else_=1,
                ),
                KnowledgeFSControlSpace.updated_at,
                KnowledgeFSControlSpace.id,
            )
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        return tuple(self._session.scalars(statement).all())

    @override
    def compare_and_set_lifecycle(self, update_values: KnowledgeFSControlSpaceCASUpdate) -> bool:
        values: dict[str, object] = {
            "state": update_values.new_state,
            "resource_version": KnowledgeFSControlSpace.resource_version + 1,
            "lifecycle_operation_id": update_values.lifecycle_operation_id,
            "last_error_code": update_values.last_error_code,
            "last_error_message": update_values.last_error_message,
        }
        if update_values.knowledge_space_id is not None:
            values["knowledge_space_id"] = update_values.knowledge_space_id
        if update_values.knowledge_space_revision is not None:
            values["knowledge_space_revision"] = update_values.knowledge_space_revision
        if update_values.attempted_at is not None:
            values["attempt_count"] = KnowledgeFSControlSpace.attempt_count + 1
            values["last_attempt_at"] = update_values.attempted_at

        statement = (
            update(KnowledgeFSControlSpace)
            .where(
                KnowledgeFSControlSpace.tenant_id == update_values.tenant_id,
                KnowledgeFSControlSpace.id == update_values.control_space_id,
                KnowledgeFSControlSpace.resource_version == update_values.expected_resource_version,
                KnowledgeFSControlSpace.state == update_values.expected_state,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        if update_values.knowledge_space_id is not None:
            statement = statement.where(
                (KnowledgeFSControlSpace.knowledge_space_id.is_(None))
                | (KnowledgeFSControlSpace.knowledge_space_id == update_values.knowledge_space_id)
            )
        if update_values.knowledge_space_revision is not None:
            statement = statement.where(
                KnowledgeFSControlSpace.knowledge_space_revision <= update_values.knowledge_space_revision
            )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1

    @override
    def mark_deletion_irreversible(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        lifecycle_operation_id: str,
        irreversible_at: datetime,
    ) -> bool:
        statement = (
            update(KnowledgeFSControlSpace)
            .where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.id == control_space_id,
                KnowledgeFSControlSpace.lifecycle_operation_id == lifecycle_operation_id,
                KnowledgeFSControlSpace.state.in_(
                    (
                        KnowledgeFSControlSpaceState.DELETING,
                        KnowledgeFSControlSpaceState.ERROR,
                        KnowledgeFSControlSpaceState.DELETED,
                    )
                ),
                (KnowledgeFSControlSpace.deletion_irreversible_at.is_(None))
                | (KnowledgeFSControlSpace.deletion_irreversible_at == irreversible_at),
            )
            .values(deletion_irreversible_at=irreversible_at)
            .execution_options(synchronize_session=False)
        )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1

    @override
    def list_workspace_deletion_blockers(self, *, tenant_id: str) -> tuple[str, ...]:
        statement = (
            select(KnowledgeFSControlSpace.id)
            .where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.state != KnowledgeFSControlSpaceState.DELETED,
            )
            .order_by(KnowledgeFSControlSpace.created_at, KnowledgeFSControlSpace.id)
        )
        return tuple(self._session.scalars(statement).all())


__all__ = ["SQLAlchemyKnowledgeFSControlSpaceRepository"]
