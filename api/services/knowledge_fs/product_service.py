"""KnowledgeFS product aggregation after Dify authorization and pagination."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from time import perf_counter
from typing import Literal, NamedTuple

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from services.knowledge_fs.batch_capability import (
    KnowledgeFSBatchCapabilityIssuerPort,
    KnowledgeFSBatchSpaceBinding,
)
from services.knowledge_fs.cutover_runtime_gate import KnowledgeFSWorkspaceRuntimeGatePort
from services.knowledge_fs.observability import (
    KnowledgeFSBatchStatusMetric,
    KnowledgeFSOperationalMetricsPort,
    get_knowledge_fs_operational_metrics,
)
from services.knowledge_fs.product_authorization import (
    KnowledgeFSProductNotFoundError,
    KnowledgeFSProductRBACPort,
    effective_product_permissions,
    local_role_allows,
    resolve_local_role,
    resolve_local_roles,
    visible_control_space_statement,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSSpaceDetailResponse,
    KnowledgeFSSpaceListItemResponse,
    KnowledgeFSSpaceListResponse,
    KnowledgeFSTechnicalSummary,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_remote import KnowledgeFSProductRemotePort

logger = logging.getLogger(__name__)


class AuthorizedKnowledgeFSControlSpace(NamedTuple):
    control_space: KnowledgeFSControlSpace
    permission: KnowledgeFSProductPermission
    permission_keys: tuple[KnowledgeFSProductPermission, ...]


class KnowledgeFSProductService:
    """Expose only Dify-authorized control-spaces and batch-fetch KFS summaries."""

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        batch_capabilities: KnowledgeFSBatchCapabilityIssuerPort,
        cutover_gate: KnowledgeFSWorkspaceRuntimeGatePort,
        remote: KnowledgeFSProductRemotePort,
        rbac: KnowledgeFSProductRBACPort,
        metrics: KnowledgeFSOperationalMetricsPort | None = None,
        clock: Callable[[], float] = perf_counter,
    ) -> None:
        self._session_maker = session_maker
        self._batch_capabilities = batch_capabilities
        self._cutover_gate = cutover_gate
        self._remote = remote
        self._rbac = rbac
        self._metrics = metrics or get_knowledge_fs_operational_metrics()
        self._clock = clock

    def list_spaces(
        self,
        *,
        tenant_id: str,
        account_id: str,
        page: int,
        limit: int,
    ) -> KnowledgeFSSpaceListResponse:
        self.require_product_routes(tenant_id=tenant_id)
        with self._session_maker() as session:
            statement = visible_control_space_statement(tenant_id=tenant_id, account_id=account_id).order_by(
                KnowledgeFSControlSpace.created_at.desc(), KnowledgeFSControlSpace.id.desc()
            )
            candidates = tuple(session.scalars(statement))
            rbac_permissions = self._rbac.permission_keys_by_control_space(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_ids=[space.id for space in candidates],
            )
            local_roles = resolve_local_roles(session, control_spaces=candidates, account_id=account_id)
            effective_permissions = {
                space.id: effective_product_permissions(
                    local_roles.get(space.id),
                    rbac_permissions.get(space.id, frozenset()),
                )
                for space in candidates
            }
            authorized_candidates = tuple(
                space for space in candidates if KnowledgeFSProductPermission.READ in effective_permissions[space.id]
            )
            offset = (page - 1) * limit
            page_candidates = authorized_candidates[offset : offset + limit + 1]
            authorized = page_candidates[:limit]
            session.expunge_all()

        active_bindings = tuple(
            KnowledgeFSBatchSpaceBinding(space.id, space.knowledge_space_id)
            for space in authorized
            if space.state is KnowledgeFSControlSpaceState.ACTIVE and space.knowledge_space_id is not None
        )
        summaries = self._fetch_summaries(
            tenant_id=tenant_id,
            account_id=account_id,
            bindings=active_bindings,
            trace_id=str(uuid.uuid4()),
        )
        return KnowledgeFSSpaceListResponse(
            data=[
                _list_item(space, summaries=summaries, permission_keys=effective_permissions[space.id])
                for space in authorized
            ],
            page=page,
            limit=limit,
            has_more=len(page_candidates) > limit,
        )

    def authorize_control_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> AuthorizedKnowledgeFSControlSpace:
        self.require_product_routes(tenant_id=tenant_id)
        with self._session_maker() as session:
            authorized = self.authorize_control_space_in_session(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                permission=permission,
                require_active=require_active,
            )
            session.expunge(authorized.control_space)
            return authorized

    def authorize_control_space_in_session(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> AuthorizedKnowledgeFSControlSpace:
        """Authorize against the caller's transaction for issuance fencing."""

        control_space = session.scalar(
            sa.select(KnowledgeFSControlSpace).where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.id == control_space_id,
            )
        )
        if control_space is None:
            raise KnowledgeFSProductNotFoundError("KnowledgeFS space was not found")
        role = resolve_local_role(session, control_space=control_space, account_id=account_id)
        rbac_permissions = self._rbac.permission_keys_by_control_space(
            session=session,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_ids=(control_space.id,),
        )
        permission_keys = effective_product_permissions(
            role,
            rbac_permissions.get(control_space.id, frozenset()),
        )
        if not local_role_allows(role, permission) or permission not in permission_keys:
            raise KnowledgeFSProductNotFoundError("KnowledgeFS space was not found")
        if require_active and (
            control_space.state is not KnowledgeFSControlSpaceState.ACTIVE or control_space.knowledge_space_id is None
        ):
            raise KnowledgeFSProductNotFoundError("KnowledgeFS space was not found")
        return AuthorizedKnowledgeFSControlSpace(control_space, permission, permission_keys)

    def get_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
    ) -> KnowledgeFSSpaceDetailResponse:
        authorized = self.authorize_control_space(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.READ,
        )
        space = authorized.control_space
        summaries = self._fetch_summaries(
            tenant_id=tenant_id,
            account_id=account_id,
            bindings=(KnowledgeFSBatchSpaceBinding(space.id, space.knowledge_space_id),)
            if space.knowledge_space_id
            else (),
            trace_id=str(uuid.uuid4()),
        )
        item = _list_item(space, summaries=summaries, permission_keys=authorized.permission_keys)
        return KnowledgeFSSpaceDetailResponse(
            **item.model_dump(),
            created_at=space.created_at,
            updated_at=space.updated_at,
        )

    def require_product_routes(self, *, tenant_id: str) -> None:
        self._cutover_gate.require_product_routes(tenant_id=tenant_id)

    def _fetch_summaries(
        self,
        *,
        tenant_id: str,
        account_id: str,
        bindings: tuple[KnowledgeFSBatchSpaceBinding, ...],
        trace_id: str,
    ) -> dict[str, KnowledgeFSTechnicalSummary]:
        if not bindings:
            return {}
        started_at = self._clock()
        requested_spaces = len(bindings)
        try:
            capability = self._batch_capabilities.issue_interactive(
                tenant_id=tenant_id,
                account_id=account_id,
                bindings=bindings,
                trace_id=trace_id,
            )
            knowledge_space_ids = tuple(binding.knowledge_space_id for binding in bindings)
            summaries = self._remote.batch_space_summaries(
                namespace_id=tenant_id,
                knowledge_space_ids=knowledge_space_ids,
                capability_token=capability.token,
                trace_id=trace_id,
            )
        except Exception:
            self._record_batch_metric(
                started_at=started_at,
                missing_spaces=requested_spaces,
                outcome="failed",
                requested_spaces=requested_spaces,
                returned_spaces=0,
            )
            return {}
        requested_ids = frozenset(knowledge_space_ids)
        filtered = {space_id: summary for space_id, summary in summaries.items() if space_id in requested_ids}
        missing_spaces = requested_spaces - len(filtered)
        self._record_batch_metric(
            started_at=started_at,
            missing_spaces=missing_spaces,
            outcome="degraded" if missing_spaces else "success",
            requested_spaces=requested_spaces,
            returned_spaces=len(filtered),
        )
        return filtered

    def _record_batch_metric(
        self,
        *,
        started_at: float,
        missing_spaces: int,
        outcome: Literal["degraded", "failed", "success"],
        requested_spaces: int,
        returned_spaces: int,
    ) -> None:
        try:
            duration_seconds = max(0.0, self._clock() - started_at)
            self._metrics.record_batch_status(
                KnowledgeFSBatchStatusMetric(
                    duration_seconds,
                    missing_spaces,
                    outcome,
                    requested_spaces,
                    returned_spaces,
                )
            )
        except Exception:
            logger.warning("KnowledgeFS batch status metric export failed", exc_info=True)


def _list_item(
    space: KnowledgeFSControlSpace,
    *,
    summaries: dict[str, KnowledgeFSTechnicalSummary],
    permission_keys: tuple[KnowledgeFSProductPermission, ...],
) -> KnowledgeFSSpaceListItemResponse:
    summary = summaries.get(space.knowledge_space_id or "")
    technical_status: Literal["available", "not_ready", "unavailable"]
    if space.state is not KnowledgeFSControlSpaceState.ACTIVE or space.knowledge_space_id is None:
        technical_status = "not_ready"
    elif summary is None:
        technical_status = "unavailable"
    else:
        technical_status = "available"
    return KnowledgeFSSpaceListItemResponse(
        control_space_id=space.id,
        state=space.state,
        visibility=space.visibility,
        owner_account_id=space.owner_account_id,
        knowledge_space_id=space.knowledge_space_id,
        resource_version=space.resource_version,
        permission_keys=list(permission_keys),
        technical_status=technical_status,
        technical_summary=summary,
    )


__all__ = ["AuthorizedKnowledgeFSControlSpace", "KnowledgeFSProductService"]
