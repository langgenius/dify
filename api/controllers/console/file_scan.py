"""Console routes for file malware scanning.

Providers are workspace-wide and managed by owners and admins. A policy belongs to one product
resource, so each resource type has its own route guarded by that resource's own permissions;
they all delegate to ``FileScanPolicyService``.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound

from configs import dify_config
from controllers.common.rbac import DatasetId, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.flask_admission import console_account_admission
from core.db.session_factory import session_factory
from fields.base import ResponseModel
from libs.helper import to_timestamp
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.file_scan import FileScanFallbackAction
from services.file_scan import (
    FileScanPolicyService,
    FileScanProviderInUseError,
    FileScanProviderNotFoundError,
    FileScanProviderService,
    FileScanValidationError,
    ScanPolicy,
    ScanScope,
)
from services.file_scan.entities import SCOPE_KNOWLEDGE_FS_SPACE
from services.file_scan.provider_service import FileScanProviderView
from services.knowledge_fs.feature_service import get_knowledge_fs_features
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_service import KnowledgeFSProductNotFoundError
from services.knowledge_fs.runtime import get_knowledge_fs_runtime

from . import console_ns
from .wraps import RBACPermission, model_validate

_PROVIDER_ADMIN_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})
_DATASET_EDIT_ROLES = frozenset(
    {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR, TenantAccountRole.DATASET_OPERATOR}
)


class FileScanProviderCreatePayload(BaseModel):
    name: str = Field(description="Display name")
    provider_type: str = Field(description="clamav, cloudmersive, scanii, metadefender or api")
    config: dict[str, Any] = Field(default_factory=dict, description="Non-secret settings")
    credentials: dict[str, str] = Field(default_factory=dict, description="Secret settings; write-only")


class FileScanProviderUpdatePayload(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    credentials: dict[str, str] | None = Field(
        default=None, description="Secret settings to replace; omitted or empty fields keep their value"
    )


class FileScanPolicyPayload(BaseModel):
    enabled: bool
    provider_id: str | None = None
    on_unavailable: FileScanFallbackAction = FileScanFallbackAction.BLOCK
    on_unscannable: FileScanFallbackAction = FileScanFallbackAction.BLOCK


class FileScanProviderTypeResponse(ResponseModel):
    provider_type: str
    available: bool
    credential_fields: list[str]


class FileScanProviderTypeListResponse(ResponseModel):
    data: list[FileScanProviderTypeResponse]


class FileScanProviderResponse(ResponseModel):
    id: str
    name: str
    provider_type: str
    config: dict[str, Any]
    credentials_set: dict[str, bool]
    status: str
    last_error: str | None = None
    last_tested_at: int | None = None
    created_at: int | None = None
    policy_count: int

    @field_validator("last_tested_at", "created_at", mode="before")
    @classmethod
    def _timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class FileScanProviderListResponse(ResponseModel):
    data: list[FileScanProviderResponse]


class FileScanPolicyResponse(ResponseModel):
    enabled: bool
    provider_id: str | None = None
    on_unavailable: str
    on_unscannable: str


register_schema_models(
    console_ns,
    FileScanProviderCreatePayload,
    FileScanProviderUpdatePayload,
    FileScanPolicyPayload,
)
register_response_schema_models(
    console_ns,
    FileScanProviderTypeListResponse,
    FileScanProviderResponse,
    FileScanProviderListResponse,
    FileScanPolicyResponse,
)


def _require_enabled() -> None:
    if not dify_config.FILE_SCAN_ENABLED:
        raise NotFound()


def _provider_response(view: FileScanProviderView) -> dict[str, Any]:
    return FileScanProviderResponse.model_validate(view).model_dump(mode="json")


def _policy_response(policy: ScanPolicy) -> dict[str, Any]:
    return FileScanPolicyResponse(
        enabled=policy.enabled,
        provider_id=policy.provider_id,
        on_unavailable=policy.on_unavailable.value,
        on_unscannable=policy.on_unscannable.value,
    ).model_dump(mode="json")


def _set_policy(request_context: RequestContext, scope: ScanScope, payload: FileScanPolicyPayload) -> dict[str, Any]:
    try:
        policy = FileScanPolicyService().set(
            tenant_id=request_context.active_workspace_id,
            scope=scope,
            policy=ScanPolicy(
                enabled=payload.enabled,
                provider_id=payload.provider_id,
                on_unavailable=payload.on_unavailable,
                on_unscannable=payload.on_unscannable,
            ),
            account_id=request_context.account_id,
        )
    except FileScanValidationError as error:
        raise BadRequest(str(error)) from error
    return _policy_response(policy)


@console_ns.route("/file-scan/provider-types")
class FileScanProviderTypesApi(Resource):
    @console_ns.doc(description="List the malware scanners this deployment offers")
    @console_ns.response(200, "Success", console_ns.models[FileScanProviderTypeListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        _require_enabled()
        return FileScanProviderTypeListResponse(
            data=[
                FileScanProviderTypeResponse(
                    provider_type=item.provider_type,
                    available=item.available,
                    credential_fields=list(item.credential_fields),
                )
                for item in FileScanProviderService.provider_types()
            ]
        ).model_dump(mode="json")


@console_ns.route("/file-scan/providers")
class FileScanProvidersApi(Resource):
    @console_ns.doc(description="List the workspace's malware scanners. Secrets are never returned.")
    @console_ns.response(200, "Success", console_ns.models[FileScanProviderListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        _require_enabled()
        views = FileScanProviderService().list(tenant_id=request_context.active_workspace_id)
        return {"data": [_provider_response(view) for view in views]}

    @console_ns.doc(description="Add a malware scanner. It is verified with a live check before it is saved.")
    @console_ns.expect(console_ns.models[FileScanProviderCreatePayload.__name__])
    @console_ns.response(201, "Scanner added", console_ns.models[FileScanProviderResponse.__name__])
    @console_account_admission(allowed_roles=_PROVIDER_ADMIN_ROLES)
    @model_validate(FileScanProviderCreatePayload)
    def post(self, payload: FileScanProviderCreatePayload, request_context: RequestContext):
        _require_enabled()
        try:
            view = FileScanProviderService().create(
                tenant_id=request_context.active_workspace_id,
                account_id=request_context.account_id,
                name=payload.name,
                provider_type=payload.provider_type,
                config=payload.config,
                credentials=payload.credentials,
            )
        except FileScanValidationError as error:
            raise BadRequest(str(error)) from error
        return _provider_response(view), 201


@console_ns.route("/file-scan/providers/<uuid:provider_id>")
class FileScanProviderApi(Resource):
    @console_ns.doc(description="Update a malware scanner. It is verified with a live check before it is saved.")
    @console_ns.expect(console_ns.models[FileScanProviderUpdatePayload.__name__])
    @console_ns.response(200, "Scanner updated", console_ns.models[FileScanProviderResponse.__name__])
    @console_account_admission(allowed_roles=_PROVIDER_ADMIN_ROLES)
    @model_validate(FileScanProviderUpdatePayload)
    def patch(self, payload: FileScanProviderUpdatePayload, request_context: RequestContext, provider_id: UUID):
        _require_enabled()
        try:
            view = FileScanProviderService().update(
                tenant_id=request_context.active_workspace_id,
                provider_id=str(provider_id),
                name=payload.name,
                config=payload.config,
                credentials=payload.credentials,
            )
        except FileScanProviderNotFoundError as error:
            raise NotFound() from error
        except FileScanValidationError as error:
            raise BadRequest(str(error)) from error
        return _provider_response(view)

    @console_ns.doc(description="Delete a malware scanner that no policy selects")
    @console_ns.response(204, "Scanner deleted")
    @console_account_admission(allowed_roles=_PROVIDER_ADMIN_ROLES)
    def delete(self, request_context: RequestContext, provider_id: UUID):
        _require_enabled()
        try:
            FileScanProviderService().delete(
                tenant_id=request_context.active_workspace_id, provider_id=str(provider_id)
            )
        except FileScanProviderNotFoundError as error:
            raise NotFound() from error
        except FileScanProviderInUseError as error:
            raise Conflict(str(error)) from error
        return "", 204


@console_ns.route("/file-scan/providers/<uuid:provider_id>/test")
class FileScanProviderTestApi(Resource):
    @console_ns.doc(description="Run the scanner's connectivity check again and store the result")
    @console_ns.response(200, "Check finished", console_ns.models[FileScanProviderResponse.__name__])
    @console_account_admission(allowed_roles=_PROVIDER_ADMIN_ROLES)
    def post(self, request_context: RequestContext, provider_id: UUID):
        _require_enabled()
        try:
            view = FileScanProviderService().test(
                tenant_id=request_context.active_workspace_id, provider_id=str(provider_id)
            )
        except FileScanProviderNotFoundError as error:
            raise NotFound() from error
        return _provider_response(view)


def _dataset_scope(request_context: RequestContext, dataset_id: UUID) -> ScanScope:
    scope = FileScanPolicyService().dataset_scope(
        tenant_id=request_context.active_workspace_id, dataset_id=str(dataset_id)
    )
    if scope is None:
        raise NotFound()
    return scope


@console_ns.route("/datasets/<uuid:dataset_id>/file-scan-policy")
class DatasetFileScanPolicyApi(Resource):
    @console_ns.doc(description="Get the malware scan policy of a Classic Knowledge Base")
    @console_ns.response(200, "Success", console_ns.models[FileScanPolicyResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        _require_enabled()
        scope = _dataset_scope(request_context, dataset_id)
        return _policy_response(FileScanPolicyService().get(tenant_id=request_context.active_workspace_id, scope=scope))

    @console_ns.doc(description="Set the malware scan policy of a Classic Knowledge Base")
    @console_ns.expect(console_ns.models[FileScanPolicyPayload.__name__])
    @console_ns.response(200, "Policy saved", console_ns.models[FileScanPolicyResponse.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @model_validate(FileScanPolicyPayload)
    def put(self, payload: FileScanPolicyPayload, request_context: RequestContext, dataset_id: UUID):
        _require_enabled()
        return _set_policy(request_context, _dataset_scope(request_context, dataset_id), payload)


def _knowledge_fs_scope(
    request_context: RequestContext, control_space_id: str, permission: KnowledgeFSProductPermission
) -> ScanScope:
    if not get_knowledge_fs_features().enabled:
        raise NotFound()
    runtime = get_knowledge_fs_runtime(session_factory.get_session_maker())
    try:
        runtime.control_plane.authorize_space(
            tenant_id=request_context.active_workspace_id,
            account_id=request_context.account_id,
            control_space_id=control_space_id,
            permission=permission,
        )
    except KnowledgeFSProductNotFoundError as error:
        raise NotFound() from error
    except PermissionError as error:
        raise Forbidden() from error
    return ScanScope(SCOPE_KNOWLEDGE_FS_SPACE, control_space_id)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/file-scan-policy")
class KnowledgeFSFileScanPolicyApi(Resource):
    @console_ns.doc(description="Get the malware scan policy of an Agent Knowledge Base")
    @console_ns.response(200, "Success", console_ns.models[FileScanPolicyResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext, control_space_id: str):
        _require_enabled()
        scope = _knowledge_fs_scope(request_context, control_space_id, KnowledgeFSProductPermission.READ)
        return _policy_response(FileScanPolicyService().get(tenant_id=request_context.active_workspace_id, scope=scope))

    @console_ns.doc(description="Set the malware scan policy of an Agent Knowledge Base")
    @console_ns.expect(console_ns.models[FileScanPolicyPayload.__name__])
    @console_ns.response(200, "Policy saved", console_ns.models[FileScanPolicyResponse.__name__])
    @console_account_admission()
    @model_validate(FileScanPolicyPayload)
    def put(self, payload: FileScanPolicyPayload, request_context: RequestContext, control_space_id: str):
        _require_enabled()
        scope = _knowledge_fs_scope(request_context, control_space_id, KnowledgeFSProductPermission.EDIT)
        return _set_policy(request_context, scope, payload)
