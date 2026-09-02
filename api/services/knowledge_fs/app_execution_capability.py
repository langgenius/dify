"""Single production entry point for Agent and Workflow KnowledgeFS capabilities."""

from __future__ import annotations

import base64
import json
from typing import Literal, Protocol, cast

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

from core.app.entities.app_invoke_entities import DifyRunContext
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionService
from services.knowledge_fs.capability_broker import KnowledgeFSCapabilityBroker, KnowledgeFSIssuedProductCapability
from services.knowledge_fs.product_dto import (
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSRetrievalTestPayload,
    KnowledgeFSRetrievalTestResponse,
    KnowledgeFSWorkflowFailedRetrievalCapturePayload,
    KnowledgeFSWorkflowFailedRetrievalCaptureResponse,
)
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, is_product_operation_ready
from services.knowledge_fs.product_remote import (
    KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER,
    KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES,
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRemotePort,
    KnowledgeFSRemoteJSONRequest,
)


class KnowledgeResourceRef(BaseModel):
    """A typed app configuration reference to one Dify-owned KnowledgeFS control-space."""

    kind: Literal["knowledge_fs"]
    control_space_id: str = Field(min_length=1, max_length=1_000)

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("control_space_id")
    @classmethod
    def normalize_control_space_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("KnowledgeFS control-space reference is required")
        return normalized


class KnowledgeFSWorkflowFailedRetrievalCaptureCapability(Protocol):
    def capture_workflow_failed_retrieval(
        self,
        *,
        tenant_id: str,
        app_id: str,
        resource: KnowledgeResourceRef,
        payload: KnowledgeFSWorkflowFailedRetrievalCapturePayload,
    ) -> KnowledgeFSWorkflowFailedRetrievalCaptureResponse: ...


class KnowledgeFSAppExecutionCapabilityService:
    def __init__(
        self,
        *,
        admission: KnowledgeFSAppAdmissionService,
        broker: KnowledgeFSCapabilityBroker,
        remote: KnowledgeFSProductRemotePort,
    ) -> None:
        self._admission = admission
        self._broker = broker
        self._remote = remote

    def issue(
        self,
        *,
        tenant_id: str,
        app_id: str,
        control_space_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        profile = self._admission.admit(
            tenant_id=tenant_id,
            app_id=app_id,
            control_space_id=control_space_id,
            caller_kind=caller_kind,
            operation_id=operation_id,
        )
        return self._broker.issue_app(
            profile=profile,
            operation_id=operation_id,
            resource_id=resource_id,
            trace_id=trace_id,
        )

    def create_research_task(
        self,
        *,
        run_context: DifyRunContext,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        resource: KnowledgeResourceRef,
        payload: KnowledgeFSResearchTaskCreatePayload,
    ) -> KnowledgeFSResearchTaskResponse:
        """Create one Research task through app admission and a bounded product operation."""

        operation_id = "createResearchTask"
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        if (
            not is_product_operation_ready(operation_id)
            or operation.transport != "json"
            or operation.kfs_path is None
            or "{" in operation.kfs_path
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS app Research task creation is unavailable")
        issued = self.issue(
            tenant_id=run_context.tenant_id,
            app_id=run_context.app_id,
            control_space_id=resource.control_space_id,
            caller_kind=caller_kind,
            operation_id=operation_id,
            trace_id=run_context.trace_session_id,
        )
        remote_payload = cast(
            dict[str, JsonValue],
            payload.model_dump(mode="json", exclude_none=True, by_alias=True),
        )
        remote_payload["knowledgeSpaceId"] = issued.knowledge_space_id
        raw = self._remote.execute_json(
            KnowledgeFSRemoteJSONRequest(
                operation_id=operation_id,
                method=operation.method,
                path=operation.kfs_path,
                namespace_id=run_context.tenant_id,
                knowledge_space_id=issued.knowledge_space_id,
                capability_token=issued.token,
                trace_id=issued.trace_id,
                payload=remote_payload,
            )
        )
        return KnowledgeFSResearchTaskResponse.model_validate(raw)

    def run_retrieval(
        self,
        *,
        run_context: DifyRunContext,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        resource: KnowledgeResourceRef,
        payload: KnowledgeFSRetrievalTestPayload,
    ) -> KnowledgeFSRetrievalTestResponse:
        """Retrieve bounded evidence without invoking KnowledgeFS answer generation."""

        operation_id = "retrieveEvidence"
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        if (
            not is_product_operation_ready(operation_id)
            or operation.transport != "json"
            or operation.kfs_path != "/knowledge-spaces/{id}/retrieval-tests"
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS app evidence retrieval is unavailable")
        issued = self.issue(
            tenant_id=run_context.tenant_id,
            app_id=run_context.app_id,
            control_space_id=resource.control_space_id,
            caller_kind=caller_kind,
            operation_id=operation_id,
            trace_id=run_context.trace_session_id,
        )
        remote_payload = cast(
            dict[str, JsonValue],
            payload.model_dump(mode="json", exclude_none=True, by_alias=True),
        )
        query_image_headers = _move_query_image_grants_to_internal_header(remote_payload)
        raw = self._remote.execute_json(
            KnowledgeFSRemoteJSONRequest(
                operation_id=operation_id,
                method=operation.method,
                path=operation.kfs_path.replace("{id}", issued.knowledge_space_id),
                namespace_id=run_context.tenant_id,
                knowledge_space_id=issued.knowledge_space_id,
                capability_token=issued.token,
                trace_id=issued.trace_id,
                payload=remote_payload,
                headers=query_image_headers,
            )
        )
        return KnowledgeFSRetrievalTestResponse.model_validate(raw)

    def capture_workflow_failed_retrieval(
        self,
        *,
        tenant_id: str,
        app_id: str,
        resource: KnowledgeResourceRef,
        payload: KnowledgeFSWorkflowFailedRetrievalCapturePayload,
    ) -> KnowledgeFSWorkflowFailedRetrievalCaptureResponse:
        """Capture and classify one empty Workflow retrieval outside the node hot path."""

        operation_id = "captureWorkflowFailedRetrieval"
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        expected_path = "/knowledge-spaces/{id}/failed-queries/workflow-retrieval-misses"
        if (
            not is_product_operation_ready(operation_id)
            or operation.transport != "json"
            or operation.kfs_path != expected_path
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Workflow failed-retrieval capture is unavailable")
        # Use a fresh transport trace for each task attempt. ``event_id`` remains the durable,
        # retry-safe business idempotency key owned by KnowledgeFS.
        issued = self.issue(
            tenant_id=tenant_id,
            app_id=app_id,
            control_space_id=resource.control_space_id,
            caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
            operation_id=operation_id,
        )
        remote_payload = cast(
            dict[str, JsonValue],
            payload.model_dump(mode="json", exclude_none=True, by_alias=True),
        )
        raw = self._remote.execute_json(
            KnowledgeFSRemoteJSONRequest(
                operation_id=operation_id,
                method=operation.method,
                path=expected_path.replace("{id}", issued.knowledge_space_id),
                namespace_id=tenant_id,
                knowledge_space_id=issued.knowledge_space_id,
                capability_token=issued.token,
                trace_id=issued.trace_id,
                payload=remote_payload,
            )
        )
        return KnowledgeFSWorkflowFailedRetrievalCaptureResponse.model_validate(raw)


def _move_query_image_grants_to_internal_header(
    payload: dict[str, JsonValue],
) -> tuple[tuple[str, str], ...]:
    raw_images = payload.get("queryImages")
    if not isinstance(raw_images, list) or not raw_images:
        return ()

    clean_images: list[JsonValue] = []
    grants: list[str | None] = []
    for raw_image in raw_images:
        if not isinstance(raw_image, dict):  # Payload validation should make this unreachable.
            raise KnowledgeFSProductRemoteError("KnowledgeFS query image transport is invalid")
        clean_image = dict(raw_image)
        raw_grant = clean_image.pop("accessGrant", None)
        if raw_grant is not None and not isinstance(raw_grant, str):
            raise KnowledgeFSProductRemoteError("KnowledgeFS query image transport is invalid")
        clean_images.append(cast(JsonValue, clean_image))
        grants.append(raw_grant)

    payload["queryImages"] = clean_images
    if not any(grant is not None for grant in grants):
        return ()

    envelope = json.dumps({"g": grants, "v": 1}, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    encoded = base64.urlsafe_b64encode(envelope).decode("ascii").rstrip("=")
    if len(encoded.encode("ascii")) > KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES:
        raise KnowledgeFSProductRemoteError("KnowledgeFS query image grant header is too large")
    return ((KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER, encoded),)


__all__ = [
    "KnowledgeFSAppExecutionCapabilityService",
    "KnowledgeFSWorkflowFailedRetrievalCaptureCapability",
    "KnowledgeResourceRef",
]
