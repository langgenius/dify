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
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRequestRejectedError,
)
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

    def list_spaces(
        self,
        *,
        tenant_id: str,
        account_id: str,
        page: int,
        limit: int,
        creator_ids: list[str] | None = None,
        tag_ids: list[str] | None = None,
        query: str | None = None,
    ) -> KnowledgeFSSpaceListResponse:
        return self._product.list_spaces(
            tenant_id=tenant_id,
            account_id=account_id,
            page=page,
            limit=limit,
            creator_ids=creator_ids,
            tag_ids=tag_ids,
            query=query,
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
                model_intent=_model_intent(payload.embedding) if payload.embedding is not None else None,
                profile_intent=(
                    _retrieval_profile_intent(payload.retrieval) if payload.retrieval is not None else None
                ),
            )
        )
        if payload.visibility is not KnowledgeFSControlSpaceVisibility.ONLY_ME:
            self._control_plane.update_visibility(
                tenant_id=tenant_id,
                actor_account_id=account_id,
                control_space_id=result.control_space.id,
                visibility=payload.visibility,
            )
        if payload.initial_source is not None:
            from tasks.knowledge_fs_initial_source_tasks import import_initial_source

            import_initial_source.delay(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=result.control_space.id,
                operation_id=operation_id,
                payload=payload.initial_source.model_dump(mode="json", exclude_none=True),
            )
        return KnowledgeFSSpaceCreateResponse(
            control_space_id=result.control_space.id,
            state=result.control_space.state,
            operation_id=operation_id,
            model_setup_required=result.model_setup_required,
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
        authorized = self._product.authorize_control_space(
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
        metadata = payload.model_copy(update={"icon_background": None, "visibility": None})
        if any(value is not None for value in (metadata.name, metadata.icon, metadata.description)):
            knowledge_space_id = authorized.control_space.knowledge_space_id
            if knowledge_space_id is None:
                raise KnowledgeFSOperationUnavailableError("KnowledgeFS Space registration is not ready")
            try:
                remote_space = self._facade.update_space(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    control_space_id=control_space_id,
                    payload=metadata,
                )
            except KnowledgeFSProductRequestRejectedError as error:
                if error.status_code != 409:
                    raise
                latest = self.get_space(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    control_space_id=control_space_id,
                )
                summary = latest.technical_summary
                if summary is None or summary.knowledge_space_id != knowledge_space_id or summary.revision < 1:
                    raise error
                self._control_plane.advance_knowledge_space_revision(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    knowledge_space_id=knowledge_space_id,
                    revision=summary.revision,
                )
                remote_space = self._facade.update_space(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    control_space_id=control_space_id,
                    payload=metadata,
                )
            revision = _updated_space_revision(remote_space, knowledge_space_id=knowledge_space_id)
            self._control_plane.advance_knowledge_space_revision(
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                knowledge_space_id=knowledge_space_id,
                revision=revision,
            )
        if payload.icon_background is not None:
            self._control_plane.update_icon_background(
                tenant_id=tenant_id,
                actor_account_id=account_id,
                control_space_id=control_space_id,
                icon_background=payload.icon_background,
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


def _updated_space_revision(remote_space: object, *, knowledge_space_id: str) -> int:
    if not isinstance(remote_space, dict):
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS returned an invalid Space update response")
    remote_id = remote_space.get("id")
    revision = remote_space.get("revision")
    if remote_id != knowledge_space_id or not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS returned an invalid Space update response")
    return revision


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
