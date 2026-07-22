"""Product-level lifecycle and metadata use cases for KnowledgeFS control-spaces."""

from __future__ import annotations

import uuid

from models.knowledge_fs import (
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSModelSelectionIntentPayload,
    KnowledgeFSRerankIntentPayload,
    KnowledgeFSRetrievalProfileIntentPayload,
    KnowledgeFSScoreThresholdIntentPayload,
)
from services.knowledge_fs.control_plane_service import KnowledgeFSControlPlaneService
from services.knowledge_fs.control_space_commands import (
    KnowledgeFSControlSpaceCommandService,
    KnowledgeFSProvisionIntent,
)
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_authorization import KnowledgeFSProductRBACPort
from services.knowledge_fs.product_dto import (
    KnowledgeFSModelIntent,
    KnowledgeFSRetrievalProfileIntent,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSSpaceCreateResponse,
    KnowledgeFSSpaceDetailResponse,
    KnowledgeFSSpaceListResponse,
    KnowledgeFSSpaceUpdatePayload,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_service import KnowledgeFSProductService


class KnowledgeFSProductApplicationService:
    def __init__(
        self,
        *,
        product: KnowledgeFSProductService,
        control_plane: KnowledgeFSControlPlaneService,
        commands: KnowledgeFSControlSpaceCommandService,
        facade: KnowledgeFSDataFacade,
        rbac: KnowledgeFSProductRBACPort,
    ) -> None:
        self._product = product
        self._control_plane = control_plane
        self._commands = commands
        self._facade = facade
        self._rbac = rbac

    def list_spaces(self, *, tenant_id: str, account_id: str, page: int, limit: int) -> KnowledgeFSSpaceListResponse:
        return self._product.list_spaces(
            tenant_id=tenant_id,
            account_id=account_id,
            page=page,
            limit=limit,
        )

    def create_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        payload: KnowledgeFSSpaceCreatePayload,
    ) -> KnowledgeFSSpaceCreateResponse:
        self._product.require_product_routes(tenant_id=tenant_id)
        if not self._rbac.workspace_permission_allowed(
            tenant_id=tenant_id,
            account_id=account_id,
            permission=KnowledgeFSProductPermission.CREATE,
        ):
            raise PermissionError("KnowledgeFS space creation is not allowed")
        idempotency_key = payload.idempotency_key or str(uuid.uuid4())
        operation_id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"dify-kfs-provision:{tenant_id}:{account_id}:{idempotency_key}")
        )
        result = self._commands.create_provision_intent(
            KnowledgeFSProvisionIntent(
                tenant_id=tenant_id,
                owner_account_id=account_id,
                provisioning_key=f"dify:{tenant_id}:{payload.slug}",
                operation_id=operation_id,
                idempotency_key=idempotency_key,
                name=payload.name,
                slug=payload.slug,
                icon=payload.icon,
                description=payload.description,
                model_intent=_model_intent(payload.embedding),
                profile_intent=_retrieval_profile_intent(payload.retrieval),
            )
        )
        if payload.visibility is not KnowledgeFSControlSpaceVisibility.ONLY_ME:
            self._control_plane.update_visibility(
                tenant_id=tenant_id,
                actor_account_id=account_id,
                control_space_id=result.control_space.id,
                visibility=payload.visibility,
            )
        return KnowledgeFSSpaceCreateResponse(
            control_space_id=result.control_space.id,
            state=result.control_space.state,
            operation_id=operation_id,
        )

    def get_space(self, *, tenant_id: str, account_id: str, control_space_id: str) -> KnowledgeFSSpaceDetailResponse:
        return self._product.get_space(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
        )

    def update_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSSpaceUpdatePayload,
    ) -> KnowledgeFSSpaceDetailResponse:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.EDIT,
        )
        if payload.visibility is not None:
            self._control_plane.update_visibility(
                tenant_id=tenant_id,
                actor_account_id=account_id,
                control_space_id=control_space_id,
                visibility=payload.visibility,
            )
        metadata = payload.model_copy(update={"visibility": None})
        if any(value is not None for value in (metadata.name, metadata.icon, metadata.description)):
            self._facade.update_space(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                payload=metadata,
            )
        return self.get_space(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
        )

    def delete_space(self, *, tenant_id: str, account_id: str, control_space_id: str) -> None:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.DELETE,
        )
        operation_id = str(uuid.uuid4())
        self._commands.request_deletion(
            tenant_id=tenant_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            idempotency_key=f"delete:{operation_id}",
        )


def _model_intent(model: KnowledgeFSModelIntent) -> KnowledgeFSModelSelectionIntentPayload:
    return {
        "pluginId": model.plugin_id,
        "provider": model.provider,
        "model": model.model,
    }


def _retrieval_profile_intent(
    profile: KnowledgeFSRetrievalProfileIntent,
) -> KnowledgeFSRetrievalProfileIntentPayload:
    rerank: KnowledgeFSRerankIntentPayload = {"enabled": profile.rerank.enabled}
    if profile.rerank.model is not None:
        rerank["model"] = _model_intent(profile.rerank.model)
    score_threshold: KnowledgeFSScoreThresholdIntentPayload = {
        "enabled": profile.score_threshold.enabled,
        "stage": profile.score_threshold.stage,
    }
    if profile.score_threshold.value is not None:
        score_threshold["value"] = profile.score_threshold.value
    return {
        "defaultMode": profile.default_mode,
        "reasoningModel": _model_intent(profile.reasoning_model),
        "rerank": rerank,
        "scoreThreshold": score_threshold,
        "topK": profile.top_k,
    }


__all__ = ["KnowledgeFSProductApplicationService"]
