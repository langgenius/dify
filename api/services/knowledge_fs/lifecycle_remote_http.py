"""Capability-v2-only HTTP adapter for the KnowledgeFS lifecycle data plane."""

from __future__ import annotations

from datetime import UTC, datetime
from http import HTTPStatus
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, ValidationError

from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeAck,
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSDeletionPhase,
    KnowledgeFSDeletionProgress,
    KnowledgeFSDifyIntegrationActivationAck,
    KnowledgeFSDifyIntegrationActivationRequest,
    KnowledgeFSDifyIntegrationFreezeAck,
    KnowledgeFSDifyIntegrationFreezeRequest,
    KnowledgeFSIntegratedDeletionRequest,
    KnowledgeFSIntegratedProvisionRequest,
    KnowledgeFSLifecycleRemoteError,
    KnowledgeFSRemoteSpace,
)
from services.knowledge_fs_capability import (
    CapabilityAuthzRevision,
    CapabilityIssueRequest,
    CapabilityResource,
    KnowledgeFSCapabilityIssuer,
)

_JSON_ADAPTER: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
_MAX_RESPONSE_BYTES = 1024 * 1024
_MAX_RECONCILIATION_SPACES = 10_000
_PAGE_SIZE = 100
_WORKER_PRINCIPAL = "knowledge-fs-lifecycle"


class _KnowledgeSpaceResponse(BaseModel):
    id: str
    revision: int = Field(ge=1)
    slug: str = Field(min_length=1, max_length=160)
    tenant_id: str = Field(min_length=1, max_length=255, alias="tenantId")

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class _KnowledgeSpaceListResponse(BaseModel):
    items: list[_KnowledgeSpaceResponse]
    next_cursor: str | None = Field(default=None, alias="nextCursor")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class _DeletionProgressResponse(BaseModel):
    phase: Literal["accepted", "irreversible", "completed"]
    revision: int = Field(ge=1)
    irreversible_at: datetime | None = Field(default=None, alias="irreversibleAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class _CapabilityGrantRevokeResponse(BaseModel):
    applied: bool
    highest_revoke_sequence: int = Field(ge=0, alias="highestRevokeSequence")
    state: Literal["active", "revoked"]

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class _DifyIntegrationActivationBody(BaseModel):
    activation_id: str = Field(alias="activationId")
    activation_revision: int = Field(ge=1, le=9_007_199_254_740_991, alias="activationRevision")
    source_revision_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$", alias="sourceRevisionDigest")

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class _DifyIntegrationActivationResponse(_DifyIntegrationActivationBody):
    namespace_id: str = Field(min_length=1, max_length=255, alias="namespaceId")
    activated_at: datetime = Field(alias="activatedAt")
    updated_at: datetime = Field(alias="updatedAt")
    active: Literal[True]
    applied: bool
    replayed: bool


class _DifyIntegrationFreezeBody(BaseModel):
    freeze_id: str = Field(alias="freezeId")
    freeze_revision: int = Field(ge=1, le=9_007_199_254_740_991, alias="freezeRevision")
    source_revision_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$", alias="sourceRevisionDigest")
    source_task_watermark: int = Field(ge=0, le=9_007_199_254_740_991, alias="sourceTaskWatermark")

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class _DifyIntegrationFreezeResponse(_DifyIntegrationFreezeBody):
    namespace_id: str = Field(min_length=1, max_length=255, alias="namespaceId")
    frozen_at: datetime = Field(alias="frozenAt")
    updated_at: datetime = Field(alias="updatedAt")
    frozen: Literal[True]
    applied: bool
    replayed: bool


class HTTPKnowledgeFSLifecycleRemoteClient:
    """Deliver durable lifecycle commands with freshly issued internal-worker capabilities."""

    def __init__(
        self,
        *,
        base_url: str,
        issuer: KnowledgeFSCapabilityIssuer,
        timeout_seconds: float,
        max_response_bytes: int = _MAX_RESPONSE_BYTES,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._issuer = issuer
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes

    def provision_integrated_space(self, request: KnowledgeFSIntegratedProvisionRequest) -> KnowledgeFSRemoteSpace:
        token = self._issue_capability(
            namespace_id=request.namespace_id,
            control_space_id=request.control_space_id,
            operation_id="provisionIntegratedKnowledgeSpace",
            operation_identity=request.operation_id,
            resource=CapabilityResource(type="namespace", id=request.namespace_id),
        )
        payload: dict[str, JsonValue] = {
            "embeddingProfile": _json_object(request.model_intent, "embedding profile"),
            "idempotencyKey": request.provisioning_key,
            "name": request.name,
            "retrievalProfile": _json_object(request.profile_intent, "retrieval profile"),
            "slug": request.slug,
        }
        if request.icon is not None:
            payload["iconRef"] = request.icon
        if request.description is not None:
            payload["description"] = request.description
        response = self._request_json(
            method="POST",
            path="/internal/knowledge-spaces/provision",
            token=token,
            trace_id=request.operation_id,
            payload=payload,
            expected_statuses=(HTTPStatus.CREATED,),
        )
        try:
            space = _KnowledgeSpaceResponse.model_validate(response)
        except ValidationError as exc:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_RESPONSE_INVALID", "KnowledgeFS returned an invalid provision response"
            ) from exc
        if space.tenant_id != request.namespace_id:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_SCOPE_MISMATCH", "KnowledgeFS provision response crossed its namespace"
            )
        return _remote_space(space, provisioning_key=request.provisioning_key)

    def request_integrated_deletion(self, request: KnowledgeFSIntegratedDeletionRequest) -> KnowledgeFSDeletionProgress:
        knowledge_space_id = request.knowledge_space_id
        expected_revision = request.expected_revision
        if knowledge_space_id is None:
            recovered = self.find_by_provisioning_key(
                provisioning_key=request.provisioning_key,
                control_space_id=request.control_space_id,
            )
            if recovered is None:
                raise KnowledgeFSLifecycleRemoteError(
                    "KNOWLEDGE_FS_SPACE_NOT_FOUND",
                    "KnowledgeFS deletion identity could not be recovered",
                )
            knowledge_space_id = recovered.knowledge_space_id
            expected_revision = recovered.revision
        token = self._issue_capability(
            namespace_id=request.namespace_id,
            control_space_id=request.control_space_id,
            operation_id="deleteIntegratedKnowledgeSpace",
            operation_identity=request.operation_id,
            resource=CapabilityResource(type="knowledge_space", id=knowledge_space_id),
        )
        response = self._request_json(
            method="POST",
            path=f"/internal/knowledge-spaces/{knowledge_space_id}/delete",
            token=token,
            trace_id=request.operation_id,
            payload={
                "controlSpaceId": request.control_space_id,
                "expectedRevision": expected_revision,
                "idempotencyKey": request.idempotency_key,
                "operationId": request.operation_id,
                "provisioningKey": request.provisioning_key,
            },
            expected_statuses=(HTTPStatus.OK, HTTPStatus.ACCEPTED),
        )
        try:
            progress = _DeletionProgressResponse.model_validate(response)
        except ValidationError as exc:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_RESPONSE_INVALID", "KnowledgeFS returned an invalid deletion response"
            ) from exc
        irreversible_at = progress.irreversible_at
        if irreversible_at is not None:
            if irreversible_at.tzinfo is None or irreversible_at.utcoffset() is None:
                raise KnowledgeFSLifecycleRemoteError(
                    "KNOWLEDGE_FS_RESPONSE_INVALID",
                    "KnowledgeFS deletion timestamp must include a timezone",
                )
            irreversible_at = irreversible_at.astimezone(UTC).replace(tzinfo=None)
        return KnowledgeFSDeletionProgress(
            phase=KnowledgeFSDeletionPhase(progress.phase),
            revision=progress.revision,
            irreversible_at=irreversible_at,
        )

    def revoke_capability_grant(
        self, request: KnowledgeFSCapabilityGrantRevokeRequest
    ) -> KnowledgeFSCapabilityGrantRevokeAck:
        token = self._issue_capability(
            namespace_id=request.namespace_id,
            control_space_id=request.control_space_id,
            operation_id="revokeCapabilityGrant",
            operation_identity=request.operation_id,
            resource=CapabilityResource(type="knowledge_space", id=request.knowledge_space_id),
        )
        response = self._request_json(
            method="POST",
            path=f"/internal/capability-grants/{request.grant_id}/revoke",
            token=token,
            trace_id=request.operation_id,
            payload={
                "eventId": request.event_id,
                "knowledgeSpaceId": request.knowledge_space_id,
                "reasonCode": request.reason_code,
                "revokeSequence": request.revoke_sequence,
            },
            expected_statuses=(HTTPStatus.OK,),
        )
        try:
            ack = _CapabilityGrantRevokeResponse.model_validate(response)
        except ValidationError as exc:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_RESPONSE_INVALID", "KnowledgeFS returned an invalid capability revoke response"
            ) from exc
        return KnowledgeFSCapabilityGrantRevokeAck(
            applied=ack.applied,
            highest_revoke_sequence=ack.highest_revoke_sequence,
            state=ack.state,
        )

    def activate_dify_workspace_integration(
        self, request: KnowledgeFSDifyIntegrationActivationRequest
    ) -> KnowledgeFSDifyIntegrationActivationAck:
        """Persist one monotonic namespace activation using a stable grant and trace identity."""

        token = self._issue_capability(
            namespace_id=request.namespace_id,
            control_space_id=request.control_space_id,
            operation_id="activateDifyWorkspaceIntegration",
            operation_identity=request.activation_id,
            resource=CapabilityResource(type="namespace", id=request.namespace_id),
        )
        body = _DifyIntegrationActivationBody(
            activationId=request.activation_id,
            activationRevision=request.activation_revision,
            sourceRevisionDigest=request.source_revision_digest,
        )
        response = self._request_json(
            method="POST",
            path="/internal/dify-integration/activate",
            token=token,
            trace_id=request.activation_id,
            payload=_JSON_ADAPTER.validate_python(body.model_dump(mode="json", by_alias=True)),
            expected_statuses=(HTTPStatus.OK,),
        )
        try:
            parsed = _DifyIntegrationActivationResponse.model_validate(response)
            ack = KnowledgeFSDifyIntegrationActivationAck(
                namespace_id=parsed.namespace_id,
                activation_id=parsed.activation_id,
                activation_revision=parsed.activation_revision,
                source_revision_digest=parsed.source_revision_digest,
                activated_at=parsed.activated_at,
                updated_at=parsed.updated_at,
                active=parsed.active,
                applied=parsed.applied,
                replayed=parsed.replayed,
            )
        except ValidationError as exc:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_RESPONSE_INVALID",
                "KnowledgeFS returned an invalid integration activation acknowledgement",
            ) from exc
        if (
            ack.namespace_id != request.namespace_id
            or ack.activation_id != request.activation_id
            or ack.activation_revision != request.activation_revision
            or ack.source_revision_digest != request.source_revision_digest
        ):
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_ACTIVATION_ACK_MISMATCH",
                "KnowledgeFS integration activation acknowledgement did not match the request",
            )
        return ack

    def freeze_dify_workspace_integration(
        self, request: KnowledgeFSDifyIntegrationFreezeRequest
    ) -> KnowledgeFSDifyIntegrationFreezeAck:
        """Persist the remote maintenance freeze before Dify captures the final delta."""

        token = self._issue_capability(
            namespace_id=request.namespace_id,
            control_space_id=request.control_space_id,
            operation_id="freezeDifyWorkspaceIntegration",
            operation_identity=request.freeze_id,
            resource=CapabilityResource(type="namespace", id=request.namespace_id),
        )
        body = _DifyIntegrationFreezeBody(
            freezeId=request.freeze_id,
            freezeRevision=request.freeze_revision,
            sourceRevisionDigest=request.source_revision_digest,
            sourceTaskWatermark=request.source_task_watermark,
        )
        response = self._request_json(
            method="POST",
            path="/internal/dify-integration/freeze",
            token=token,
            trace_id=request.freeze_id,
            payload=_JSON_ADAPTER.validate_python(body.model_dump(mode="json", by_alias=True)),
            expected_statuses=(HTTPStatus.OK,),
        )
        try:
            parsed = _DifyIntegrationFreezeResponse.model_validate(response)
            ack = KnowledgeFSDifyIntegrationFreezeAck(
                namespace_id=parsed.namespace_id,
                freeze_id=parsed.freeze_id,
                freeze_revision=parsed.freeze_revision,
                source_revision_digest=parsed.source_revision_digest,
                source_task_watermark=parsed.source_task_watermark,
                frozen_at=parsed.frozen_at,
                updated_at=parsed.updated_at,
                frozen=parsed.frozen,
                applied=parsed.applied,
                replayed=parsed.replayed,
            )
        except ValidationError as exc:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_RESPONSE_INVALID",
                "KnowledgeFS returned an invalid integration freeze acknowledgement",
            ) from exc
        if (
            ack.namespace_id != request.namespace_id
            or ack.freeze_id != request.freeze_id
            or ack.freeze_revision != request.freeze_revision
            or ack.source_revision_digest != request.source_revision_digest
            or ack.source_task_watermark != request.source_task_watermark
        ):
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_FREEZE_ACK_MISMATCH",
                "KnowledgeFS integration freeze acknowledgement did not match the request",
            )
        return ack

    def find_by_provisioning_key(
        self,
        *,
        provisioning_key: str,
        control_space_id: str,
    ) -> KnowledgeFSRemoteSpace | None:
        namespace_id = _namespace_from_provisioning_key(provisioning_key)
        return next(
            (
                space
                for space in self.list_spaces(
                    namespace_id=namespace_id,
                    control_space_id=control_space_id,
                )
                if space.provisioning_key == provisioning_key
            ),
            None,
        )

    def list_spaces(
        self,
        *,
        namespace_id: str | None = None,
        control_space_id: str | None = None,
    ) -> tuple[KnowledgeFSRemoteSpace, ...]:
        if namespace_id is None or not namespace_id.strip():
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_NAMESPACE_REQUIRED",
                "KnowledgeFS reconciliation requires an explicit namespace",
            )
        if control_space_id is None or not control_space_id.strip():
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_CONTROL_SPACE_REQUIRED",
                "KnowledgeFS reconciliation requires an auditable control-space",
            )
        namespace_id = namespace_id.strip()
        token = self._issue_capability(
            namespace_id=namespace_id,
            control_space_id=control_space_id.strip(),
            operation_id="listKnowledgeSpaces",
            operation_identity=f"reconcile:{namespace_id}",
            resource=CapabilityResource(type="namespace", id=namespace_id),
        )
        spaces: list[KnowledgeFSRemoteSpace] = []
        cursor: str | None = None
        consumed_cursors: set[str] = set()
        while True:
            query = (
                (("limit", str(_PAGE_SIZE)),) if cursor is None else (("limit", str(_PAGE_SIZE)), ("cursor", cursor))
            )
            response = self._request_json(
                method="GET",
                path="/knowledge-spaces",
                token=token,
                trace_id=f"reconcile:{namespace_id}",
                query=query,
                payload=None,
                expected_statuses=(HTTPStatus.OK,),
            )
            try:
                page = _KnowledgeSpaceListResponse.model_validate(response)
            except ValidationError as exc:
                raise KnowledgeFSLifecycleRemoteError(
                    "KNOWLEDGE_FS_RESPONSE_INVALID", "KnowledgeFS returned an invalid Space list"
                ) from exc
            for item in page.items:
                if item.tenant_id != namespace_id:
                    raise KnowledgeFSLifecycleRemoteError(
                        "KNOWLEDGE_FS_SCOPE_MISMATCH", "KnowledgeFS list response crossed its namespace"
                    )
                spaces.append(_remote_space(item, provisioning_key=f"dify:{namespace_id}:{item.slug}"))
                if len(spaces) > _MAX_RECONCILIATION_SPACES:
                    raise KnowledgeFSLifecycleRemoteError(
                        "KNOWLEDGE_FS_RECONCILIATION_LIMIT",
                        "KnowledgeFS reconciliation exceeded its bounded Space limit",
                    )
            cursor = page.next_cursor
            if cursor is None:
                break
            if cursor in consumed_cursors:
                raise KnowledgeFSLifecycleRemoteError(
                    "KNOWLEDGE_FS_CURSOR_LOOP", "KnowledgeFS repeated a reconciliation cursor"
                )
            consumed_cursors.add(cursor)
        return tuple(spaces)

    def _issue_capability(
        self,
        *,
        namespace_id: str,
        control_space_id: str,
        operation_id: str,
        operation_identity: str,
        resource: CapabilityResource,
    ) -> str:
        issued = self._issuer.issue(
            CapabilityIssueRequest(
                actor=f"dify-worker:{_WORKER_PRINCIPAL}",
                authz_revision=CapabilityAuthzRevision(
                    credential_revision=None,
                    external_access_epoch=0,
                    membership_epoch=0,
                    space_acl_epoch=0,
                ),
                caller_kind="internal_worker",
                content_policy_revision=0,
                control_space_id=control_space_id,
                grant_id=operation_identity,
                namespace_id=namespace_id,
                operation_id=operation_id,
                principal_id=_WORKER_PRINCIPAL,
                resource=resource,
                trace_id=operation_identity,
            )
        )
        return issued.token

    def _request_json(
        self,
        *,
        method: Literal["GET", "POST"],
        path: str,
        token: str,
        trace_id: str,
        payload: JsonValue | None,
        expected_statuses: tuple[HTTPStatus, ...],
        query: tuple[tuple[str, str], ...] = (),
    ) -> JsonValue:
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {token}",
            "X-Trace-Id": trace_id,
        }
        request_kwargs: dict[str, object] = {
            "follow_redirects": False,
            "headers": headers,
            "params": query,
            "timeout": self._timeout_seconds,
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
            request_kwargs["json"] = payload
        try:
            upstream_url = httpx.URL(f"{self._base_url}/").join(path.lstrip("/"))
            response = ssrf_proxy.make_request(
                method=method,
                url=str(upstream_url),
                max_retries=0,
                stream_response=True,
                **request_kwargs,
            )
            response = ssrf_proxy.buffer_response(response, max_response_bytes=self._max_response_bytes)
        except (ssrf_proxy.ResponseLimitError, httpx.RequestError, ToolSSRFError) as exc:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_REQUEST_FAILED", "KnowledgeFS lifecycle request failed"
            ) from exc
        try:
            content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise KnowledgeFSLifecycleRemoteError(
                    "KNOWLEDGE_FS_MEDIA_TYPE_INVALID",
                    "KnowledgeFS returned an unsupported lifecycle media type",
                )
            if response.status_code not in {int(status) for status in expected_statuses}:
                raise KnowledgeFSLifecycleRemoteError(
                    f"KNOWLEDGE_FS_HTTP_{response.status_code}",
                    f"KnowledgeFS lifecycle request returned HTTP {response.status_code}",
                )
            try:
                return _JSON_ADAPTER.validate_python(response.json())
            except (ValueError, ValidationError) as exc:
                raise KnowledgeFSLifecycleRemoteError(
                    "KNOWLEDGE_FS_RESPONSE_INVALID", "KnowledgeFS returned invalid lifecycle JSON"
                ) from exc
        finally:
            response.close()


def _json_object(value: object, label: str) -> dict[str, JsonValue]:
    try:
        parsed = _JSON_ADAPTER.validate_python(value)
    except ValidationError as exc:
        raise KnowledgeFSLifecycleRemoteError(
            "KNOWLEDGE_FS_REQUEST_INVALID", f"KnowledgeFS {label} is not JSON-compatible"
        ) from exc
    if not isinstance(parsed, dict):
        raise KnowledgeFSLifecycleRemoteError("KNOWLEDGE_FS_REQUEST_INVALID", f"KnowledgeFS {label} must be an object")
    return parsed


def _namespace_from_provisioning_key(provisioning_key: str) -> str:
    parts = provisioning_key.split(":", 2)
    if len(parts) != 3 or parts[0] != "dify" or not parts[1] or not parts[2]:
        raise KnowledgeFSLifecycleRemoteError(
            "KNOWLEDGE_FS_PROVISIONING_KEY_INVALID",
            "KnowledgeFS provisioning key does not identify a namespace",
        )
    return parts[1]


def _remote_space(space: _KnowledgeSpaceResponse, *, provisioning_key: str) -> KnowledgeFSRemoteSpace:
    return KnowledgeFSRemoteSpace(
        namespace_id=space.tenant_id,
        knowledge_space_id=space.id,
        provisioning_key=provisioning_key,
        revision=space.revision,
    )


__all__ = ["HTTPKnowledgeFSLifecycleRemoteClient"]
