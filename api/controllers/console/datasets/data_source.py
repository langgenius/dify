from datetime import datetime
from typing import Literal, Never
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_serializer

from configs import dify_config
from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.common.fields import SimpleResultResponse, TextContentResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import (
    DatasetAccessDeniedRequestError,
    IndexingEstimateError,
    InvalidActionError,
)
from controllers.console.datasets.indexing_estimate_payloads import NotionEstimateWorkspacePayload
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from core.entities.knowledge_entities import IndexingEstimate
from core.rag.extractor.entity.datasource_type import NotionPageType
from core.rbac import RBACPermission, RBACResourceScope
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.data_source.binding_application_service import (
    DataSourceBindingNotFoundError,
    DataSourceBindingStateError,
)
from services.data_source.notion_import_application_service import (
    DatasetIsNotNotionSourceError,
    NotionImportCredentialUnavailableError,
)
from services.entities.knowledge_entities.indexing_estimate import NewSourcesEstimateCommand, NotionEstimateSource
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.document_sync import SyncDocumentNotFoundError, SyncDocumentSourceError
from services.knowledge.indexing.estimate import (
    EstimateSourceNotFoundError,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
)

_ADMIN_OR_OWNER_ROLES = frozenset({TenantAccountRole.ADMIN, TenantAccountRole.OWNER})
_DATA_SOURCE_OAUTH_BASE_PATH = "/console/api/oauth/data-source"


class NotionEstimatePayload(BaseModel):
    notion_info_list: list[NotionEstimateWorkspacePayload] = Field(min_length=1)
    process_rule: dict[str, object]
    doc_form: str = Field(default="text_model")
    doc_language: str = Field(default="English")


class DataSourceNotionListQuery(BaseModel):
    dataset_id: str | None = Field(default=None, description="Dataset ID")
    credential_id: str = Field(..., description="Credential ID", min_length=1)


class DataSourceNotionPreviewQuery(BaseModel):
    credential_id: str = Field(..., description="Credential ID", min_length=1)


class DataSourceIntegrateIconResponse(ResponseModel):
    type: str | None = None
    url: str | None = None
    emoji: str | None = None


class DataSourceIntegratePageResponse(ResponseModel):
    page_name: str
    page_id: str
    page_icon: DataSourceIntegrateIconResponse | None
    parent_id: str | None
    type: NotionPageType


class DataSourceIntegrateWorkspaceResponse(ResponseModel):
    workspace_name: str | None
    workspace_id: str | None
    workspace_icon: str | None
    pages: list[DataSourceIntegratePageResponse]
    total: int


class DataSourceIntegrateResponse(ResponseModel):
    id: str | None
    provider: str
    created_at: datetime | int | None
    is_bound: bool
    disabled: bool | None
    link: str
    source_info: DataSourceIntegrateWorkspaceResponse | None

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class DataSourceIntegrateListResponse(ResponseModel):
    data: list[DataSourceIntegrateResponse]


class NotionIntegratePageResponse(ResponseModel):
    page_name: str
    page_id: str
    page_icon: DataSourceIntegrateIconResponse | None
    parent_id: str | None
    page_type: NotionPageType = Field(alias="type")
    is_bound: bool


class NotionIntegrateWorkspaceResponse(ResponseModel):
    workspace_name: str | None
    workspace_id: str | None
    workspace_icon: str | None
    pages: list[NotionIntegratePageResponse]


class NotionIntegrateInfoListResponse(ResponseModel):
    notion_info: list[NotionIntegrateWorkspaceResponse]


register_schema_models(console_ns, NotionEstimatePayload)
register_response_schema_models(
    console_ns,
    DataSourceIntegrateListResponse,
    IndexingEstimate,
    NotionIntegrateInfoListResponse,
    SimpleResultResponse,
    TextContentResponse,
)


def _validate_integration_action(action: str) -> Literal["enable", "disable"]:
    match action:
        case "enable":
            return "enable"
        case "disable":
            return "disable"
        case _:
            raise InvalidActionError()


def _validate_notion_page_type(page_type: str) -> NotionPageType:
    try:
        return NotionPageType(page_type)
    except ValueError as error:
        raise InvalidArgumentError(description="Invalid Notion page type.") from error


def _raise_dataset_access_error(error: DatasetNotFoundError | DatasetAccessDeniedError) -> Never:
    if isinstance(error, DatasetNotFoundError):
        raise NotFoundError(description="Dataset not found.") from None
    raise DatasetAccessDeniedRequestError(description=str(error)) from None


@console_ns.route("/data-source/integrates")
class DataSourceIntegrationListApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[DataSourceIntegrateListResponse.__name__])
    @console_account_admission(
        allowed_roles=_ADMIN_OR_OWNER_ROLES,
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.CREDENTIAL_MANAGE,
        rbac_resource_required=False,
    )
    def get(self, request_context: RequestContext) -> tuple[dict[str, object], int]:
        bindings = application_services().data_sources.bindings.list_integrations(request_context)
        base_url = dify_config.CONSOLE_API_URL.rstrip("/")
        data = [
            {
                "id": binding.id,
                "provider": binding.provider,
                "created_at": binding.created_at,
                "is_bound": True,
                "disabled": binding.disabled,
                "source_info": binding.source_info,
                "link": f"{base_url}{_DATA_SOURCE_OAUTH_BASE_PATH}/{binding.provider}",
            }
            for binding in bindings
        ]
        return dump_response(DataSourceIntegrateListResponse, {"data": data}), 200


@console_ns.route("/data-source/integrates/<uuid:binding_id>/<string:action>")
class DataSourceIntegrationApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(
        allowed_roles=_ADMIN_OR_OWNER_ROLES,
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.CREDENTIAL_MANAGE,
        rbac_resource_required=False,
    )
    def patch(
        self,
        request_context: RequestContext,
        binding_id: UUID,
        action: str,
    ) -> tuple[dict[str, str], int]:
        validated_action = _validate_integration_action(action)
        try:
            application_services().data_sources.bindings.change_state(
                request_context,
                str(binding_id),
                validated_action,
            )
        except DataSourceBindingNotFoundError as error:
            raise NotFoundError(description="Data source binding not found.") from error
        except DataSourceBindingStateError as error:
            raise InvalidArgumentError(description=str(error)) from error
        return {"result": "success"}, 200


@console_ns.route("/notion/pre-import/pages")
class DataSourceNotionListApi(Resource):
    @console_ns.doc(params=query_params_from_model(DataSourceNotionListQuery))
    @console_ns.response(200, "Success", console_ns.models[NotionIntegrateInfoListResponse.__name__])
    @console_account_admission()
    @model_validate(DataSourceNotionListQuery)
    def get(
        self,
        req_data: DataSourceNotionListQuery,
        request_context: RequestContext,
    ) -> tuple[dict[str, object], int]:
        try:
            result = application_services().data_sources.notion_imports.list_pages(
                request_context,
                credential_id=req_data.credential_id,
                dataset_id=req_data.dataset_id,
            )
        except NotionImportCredentialUnavailableError as error:
            raise NotFoundError(description="Credential not found.") from error
        except (DatasetNotFoundError, DatasetAccessDeniedError) as error:
            _raise_dataset_access_error(error)
        except DatasetIsNotNotionSourceError as error:
            raise InvalidArgumentError(description="Dataset is not notion type.") from error
        return dump_response(NotionIntegrateInfoListResponse, {"notion_info": result.workspaces}), 200


@console_ns.route("/notion/pages/<uuid:page_id>/<string:page_type>/preview")
class DataSourceNotionPreviewApi(Resource):
    """Preview one authorized Notion page through the datasource credential."""

    @console_ns.doc(params=query_params_from_model(DataSourceNotionPreviewQuery))
    @console_ns.response(200, "Success", console_ns.models[TextContentResponse.__name__])
    @console_account_admission()
    @model_validate(DataSourceNotionPreviewQuery)
    def get(
        self,
        req_data: DataSourceNotionPreviewQuery,
        request_context: RequestContext,
        page_id: UUID,
        page_type: str,
    ) -> tuple[dict[str, str], int]:
        validated_page_type = _validate_notion_page_type(page_type)
        try:
            content = application_services().data_sources.notion_imports.preview_page(
                request_context,
                credential_id=req_data.credential_id,
                page_id=str(page_id),
                page_type=validated_page_type,
            )
        except NotionImportCredentialUnavailableError as error:
            raise NotFoundError(description="Credential not found.") from error
        return {"content": content}, 200


@console_ns.route("/datasets/notion-indexing-estimate")
class DataSourceNotionIndexingEstimateApi(Resource):
    """Estimate indexing work for selected Notion pages."""

    @console_ns.expect(console_ns.models[NotionEstimatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[IndexingEstimate.__name__])
    @console_account_admission()
    @model_validate(NotionEstimatePayload)
    def post(
        self,
        req_data: NotionEstimatePayload,
        request_context: RequestContext,
    ) -> tuple[dict[str, object], int]:
        command = NewSourcesEstimateCommand(
            sources=tuple(
                NotionEstimateSource(
                    workspace_id=workspace.workspace_id,
                    page_id=page.page_id,
                    page_type=page.page_type,
                    credential_id=workspace.credential_id,
                )
                for workspace in req_data.notion_info_list
                for page in workspace.pages
            ),
            process_rule=req_data.process_rule,
            doc_form=req_data.doc_form,
            doc_language=req_data.doc_language,
        )
        try:
            response = application_services().knowledge.indexing_estimates.estimate_new_sources(
                request_context,
                command,
            )
        except IndexingEstimateCredentialUnavailableError as error:
            raise NotFoundError(description="Credential not found.") from error
        except EstimateSourceNotFoundError as error:
            raise NotFoundError(description=str(error)) from error
        except IndexingEstimateProviderUnavailableError as error:
            raise ProviderNotInitializeError(str(error)) from error
        except IndexingEstimateExecutionError as error:
            raise IndexingEstimateError(str(error)) from error
        return dump_response(IndexingEstimate, response), 200


@console_ns.route("/datasets/<uuid:dataset_id>/notion/sync")
class DataSourceNotionDatasetSyncApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
    )
    def get(self, request_context: RequestContext, dataset_id: UUID) -> tuple[dict[str, str], int]:
        try:
            application_services().knowledge.document_sync.sync_dataset(request_context, str(dataset_id))
        except (DatasetNotFoundError, DatasetAccessDeniedError) as error:
            _raise_dataset_access_error(error)
        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/notion/sync")
class DataSourceNotionDocumentSyncApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
    )
    def get(
        self,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
    ) -> tuple[dict[str, str], int]:
        try:
            application_services().knowledge.document_sync.sync_document(
                request_context,
                str(dataset_id),
                str(document_id),
            )
        except (DatasetNotFoundError, DatasetAccessDeniedError) as error:
            _raise_dataset_access_error(error)
        except SyncDocumentNotFoundError as error:
            raise NotFoundError(description="Document not found.") from error
        except SyncDocumentSourceError as error:
            raise InvalidArgumentError(description=str(error)) from error
        return {"result": "success"}, 200
