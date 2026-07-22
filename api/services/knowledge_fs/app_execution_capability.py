"""Single production entry point for Agent and Workflow KnowledgeFS capabilities."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

from core.app.entities.app_invoke_entities import DifyRunContext
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionService
from services.knowledge_fs.capability_broker import KnowledgeFSCapabilityBroker, KnowledgeFSIssuedProductCapability
from services.knowledge_fs.operation_admission import KnowledgeFSOperationAdmissionService
from services.knowledge_fs.product_dto import (
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskResponse,
)
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, is_product_operation_ready
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
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


class KnowledgeFSAppExecutionCapabilityService:
    def __init__(
        self,
        *,
        admission: KnowledgeFSAppAdmissionService,
        broker: KnowledgeFSCapabilityBroker,
        operation_admission: KnowledgeFSOperationAdmissionService,
        remote: KnowledgeFSProductRemotePort,
    ) -> None:
        self._admission = admission
        self._broker = broker
        self._operation_admission = operation_admission
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
        with self._admitted(tenant_id=run_context.tenant_id, operation_id=operation_id):
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
            response = KnowledgeFSResearchTaskResponse.model_validate(raw)
        return response

    @contextmanager
    def _admitted(self, *, tenant_id: str, operation_id: str) -> Generator[None, None, None]:
        charge = self._operation_admission.reserve(tenant_id=tenant_id, operation_id=operation_id)
        try:
            yield
        except BaseException:
            charge.refund()
            raise
        else:
            charge.commit()


__all__ = ["KnowledgeFSAppExecutionCapabilityService", "KnowledgeResourceRef"]
