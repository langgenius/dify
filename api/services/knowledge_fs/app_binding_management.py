"""Authorized lifecycle management for Agent and Workflow KnowledgeFS bindings."""

from __future__ import annotations

from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.enums import AppStatus
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
)
from models.model import App, AppMode
from services.knowledge_fs.product_dto import (
    KnowledgeFSAppBindingListResponse,
    KnowledgeFSAppBindingPayload,
    KnowledgeFSAppBindingResponse,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandPort


class KnowledgeFSAppBindingManagementError(RuntimeError):
    """An app binding cannot be created or changed safely."""


class KnowledgeFSAppBindingAuthorizationPort(Protocol):
    def authorize_control_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
    ) -> object: ...


class KnowledgeFSAppCatalogPort(Protocol):
    def supports_binding(
        self,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
    ) -> bool: ...


class SQLKnowledgeFSAppCatalog:
    _MODES_BY_CALLER = {
        KnowledgeFSAppSpaceJoinType.AGENT: (AppMode.AGENT, AppMode.AGENT_CHAT),
        KnowledgeFSAppSpaceJoinType.WORKFLOW: (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW),
    }

    def supports_binding(
        self,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
    ) -> bool:
        return (
            session.scalar(
                sa.select(App.id)
                .where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    App.status == AppStatus.NORMAL,
                    App.mode.in_(self._MODES_BY_CALLER[caller_kind]),
                )
                .limit(1)
            )
            is not None
        )


class KnowledgeFSAppBindingManagementService:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        product: KnowledgeFSAppBindingAuthorizationPort,
        apps: KnowledgeFSAppCatalogPort,
        revocations: KnowledgeFSRevocationCommandPort,
    ) -> None:
        self._session_maker = session_maker
        self._product = product
        self._apps = apps
        self._revocations = revocations

    def list(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
    ) -> KnowledgeFSAppBindingListResponse:
        self._authorize(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
        )
        with self._session_maker() as session:
            bindings = tuple(
                session.scalars(
                    sa.select(AppKnowledgeFSSpaceJoin)
                    .where(
                        AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                        AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    )
                    .order_by(AppKnowledgeFSSpaceJoin.app_id, AppKnowledgeFSSpaceJoin.join_type)
                )
            )
        return KnowledgeFSAppBindingListResponse(data=[_response(binding) for binding in bindings])

    def upsert(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        payload: KnowledgeFSAppBindingPayload,
    ) -> KnowledgeFSAppBindingResponse:
        self._authorize(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
        )
        with self._session_maker.begin() as session:
            if not self._apps.supports_binding(
                session=session,
                tenant_id=tenant_id,
                app_id=payload.app_id,
                caller_kind=payload.caller_kind,
            ):
                raise KnowledgeFSAppBindingManagementError("App is not eligible for this KnowledgeFS caller channel")
            authorization_revision = _authorization_revision(
                session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
            )
            binding = session.scalar(
                sa.select(AppKnowledgeFSSpaceJoin)
                .where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    AppKnowledgeFSSpaceJoin.app_id == payload.app_id,
                    AppKnowledgeFSSpaceJoin.join_type == payload.caller_kind,
                )
                .with_for_update()
            )
            if binding is None:
                binding = AppKnowledgeFSSpaceJoin(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    app_id=payload.app_id,
                    join_type=payload.caller_kind,
                    created_by_account_id=actor_account_id,
                )
                session.add(binding)
                session.flush()
                authorization_revision.external_access_epoch += 1
            elif binding.status is KnowledgeFSAppSpaceJoinStatus.REVOKED:
                binding.status = KnowledgeFSAppSpaceJoinStatus.ACTIVE
                binding.revision += 1
                binding.revoked_at = None
                binding.revoked_by_account_id = None
                authorization_revision.external_access_epoch += 1
            return _response(binding)

    def revoke(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        app_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
    ) -> None:
        self._authorize(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
        )
        with self._session_maker.begin() as session:
            authorization_revision = _authorization_revision(
                session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
            )
            binding = session.scalar(
                sa.select(AppKnowledgeFSSpaceJoin)
                .where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    AppKnowledgeFSSpaceJoin.app_id == app_id,
                    AppKnowledgeFSSpaceJoin.join_type == caller_kind,
                )
                .with_for_update()
            )
            if binding is None:
                raise KnowledgeFSAppBindingManagementError("KnowledgeFS app binding was not found")
            if binding.status is KnowledgeFSAppSpaceJoinStatus.REVOKED:
                return
            binding.status = KnowledgeFSAppSpaceJoinStatus.REVOKED
            binding.revision += 1
            binding.revoked_at = naive_utc_now()
            binding.revoked_by_account_id = actor_account_id
            authorization_revision.external_access_epoch += 1
            self._revocations.enqueue_principal_grants(
                session=session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                subject=f"dify-app:{app_id}",
                reason_code="app_binding_revoked",
                caller_kinds=(caller_kind.value,),
            )

    def _authorize(self, *, tenant_id: str, actor_account_id: str, control_space_id: str) -> None:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.ACCESS_CONFIG,
        )


def _authorization_revision(
    session: Session,
    *,
    tenant_id: str,
    control_space_id: str,
) -> KnowledgeFSAuthorizationRevision:
    revision = session.scalar(
        sa.select(KnowledgeFSAuthorizationRevision)
        .where(
            KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
            KnowledgeFSAuthorizationRevision.control_space_id == control_space_id,
        )
        .with_for_update()
    )
    if revision is None:
        raise KnowledgeFSAppBindingManagementError("KnowledgeFS authorization revision is missing")
    return revision


def _response(binding: AppKnowledgeFSSpaceJoin) -> KnowledgeFSAppBindingResponse:
    return KnowledgeFSAppBindingResponse(
        id=binding.id,
        app_id=binding.app_id,
        caller_kind=binding.join_type,
        status=binding.status,
        revision=binding.revision,
    )


__all__ = [
    "KnowledgeFSAppBindingManagementError",
    "KnowledgeFSAppBindingManagementService",
    "SQLKnowledgeFSAppCatalog",
]
