from collections.abc import Generator
from typing import Any
from uuid import UUID

from flask import request
from pydantic import BaseModel, Field, RootModel
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.common.errors import FilenameNotExistsError, NoFileUploadedError, TooManyFilesError
from controllers.common.fields import GeneratedAppResponse
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_model,
    register_schema_models,
)
from controllers.service_api import service_api_ns
from controllers.service_api.dataset.error import PipelineRunError
from controllers.service_api.dataset.rag_pipeline.serializers import serialize_upload_file
from controllers.service_api.wraps import DatasetApiResource
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from fields.base import ResponseModel
from libs import helper
from libs.login import current_user
from models import Account
from models.dataset import Dataset, Pipeline
from models.engine import db
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError
from services.file_service import FileService
from services.rag_pipeline.entity.pipeline_service_api_entities import (
    DatasourceNodeRunApiEntity,
    PipelineRunApiEntity,
)
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService
from services.rag_pipeline.rag_pipeline import RagPipelineService


class DatasourceNodeRunPayload(BaseModel):
    inputs: dict[str, Any]
    datasource_type: str
    credential_id: str | None = None
    is_published: bool


class DatasourcePluginsQuery(BaseModel):
    is_published: bool = True


class DatasourceCredentialInfoResponse(ResponseModel):
    id: str | None = None
    name: str | None = None
    type: str | None = None
    is_default: bool | None = None


class DatasourcePluginResponse(ResponseModel):
    node_id: str | None = None
    plugin_id: str | None = None
    provider_name: str | None = None
    datasource_type: str | None = None
    title: str | None = None
    user_input_variables: list[dict[str, Any]] = Field(default_factory=list)
    credentials: list[DatasourceCredentialInfoResponse]


class DatasourcePluginListResponse(RootModel[list[DatasourcePluginResponse]]):
    pass


class PipelineUploadFileResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None = None
    created_by: str
    created_at: str | None = None


register_schema_model(service_api_ns, DatasourceNodeRunPayload)
register_schema_model(service_api_ns, PipelineRunApiEntity)
register_schema_models(service_api_ns, DatasourcePluginsQuery)
register_response_schema_models(
    service_api_ns,
    DatasourcePluginListResponse,
    GeneratedAppResponse,
    PipelineUploadFileResponse,
)


@service_api_ns.route("/datasets/<uuid:dataset_id>/pipeline/datasource-plugins")
class DatasourcePluginsApi(DatasetApiResource):
    """Resource for datasource plugins."""

    @service_api_ns.doc(shortcut="list_rag_pipeline_datasource_plugins")
    @service_api_ns.doc(description="List all datasource plugins for a rag pipeline")
    @service_api_ns.doc(
        path={
            "dataset_id": "Dataset ID",
        }
    )
    @service_api_ns.doc(params=query_params_from_model(DatasourcePluginsQuery))
    @service_api_ns.doc(
        responses={
            200: "Datasource plugins retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Datasource plugins retrieved successfully",
        service_api_ns.models[DatasourcePluginListResponse.__name__],
    )
    def get(self, tenant_id: str, dataset_id: UUID):
        """Resource for getting datasource plugins."""
        dataset_id_str = str(dataset_id)
        # Verify dataset ownership
        stmt = select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str)
        dataset = db.session.scalar(stmt)
        if not dataset:
            raise NotFound("Dataset not found.")

        # Get query parameter to determine published or draft
        is_published: bool = request.args.get("is_published", default=True, type=bool)

        rag_pipeline_service: RagPipelineService = RagPipelineService()
        datasource_plugins: list[dict[Any, Any]] = rag_pipeline_service.get_datasource_plugins(
            tenant_id=tenant_id, dataset_id=dataset_id_str, is_published=is_published
        )
        return datasource_plugins, 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/pipeline/datasource/nodes/<string:node_id>/run")
class DatasourceNodeRunApi(DatasetApiResource):
    """Resource for datasource node run."""

    @service_api_ns.doc(shortcut="pipeline_datasource_node_run")
    @service_api_ns.doc(description="Run a datasource node for a rag pipeline")
    @service_api_ns.doc(
        path={
            "dataset_id": "Dataset ID",
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Datasource node run successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.expect(service_api_ns.models[DatasourceNodeRunPayload.__name__])
    @service_api_ns.response(
        200,
        "Datasource node run successfully",
        service_api_ns.models[GeneratedAppResponse.__name__],
    )
    def post(self, tenant_id: str, dataset_id: UUID, node_id: str):
        """Resource for getting datasource plugins."""
        dataset_id_str = str(dataset_id)
        # Verify dataset ownership
        stmt = select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str)
        dataset = db.session.scalar(stmt)
        if not dataset:
            raise NotFound("Dataset not found.")

        payload = DatasourceNodeRunPayload.model_validate(service_api_ns.payload or {})
        assert isinstance(current_user, Account)
        rag_pipeline_service: RagPipelineService = RagPipelineService()
        pipeline: Pipeline = rag_pipeline_service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset_id_str)
        datasource_node_run_api_entity = DatasourceNodeRunApiEntity.model_validate(
            {
                **payload.model_dump(exclude_none=True),
                "pipeline_id": str(pipeline.id),
                "node_id": node_id,
            }
        )
        return helper.compact_generate_response(
            PipelineGenerator.convert_to_event_stream(
                rag_pipeline_service.run_datasource_workflow_node(
                    pipeline=pipeline,
                    node_id=node_id,
                    user_inputs=datasource_node_run_api_entity.inputs,
                    account=current_user,
                    datasource_type=datasource_node_run_api_entity.datasource_type,
                    is_published=datasource_node_run_api_entity.is_published,
                    credential_id=datasource_node_run_api_entity.credential_id,
                )
            )
        )


@service_api_ns.route("/datasets/<uuid:dataset_id>/pipeline/run")
class PipelineRunApi(DatasetApiResource):
    """Resource for datasource node run."""

    @service_api_ns.doc(shortcut="pipeline_datasource_node_run")
    @service_api_ns.doc(description="Run a datasource node for a rag pipeline")
    @service_api_ns.doc(
        path={
            "dataset_id": "Dataset ID",
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Pipeline run successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.expect(service_api_ns.models[PipelineRunApiEntity.__name__])
    @service_api_ns.response(
        200,
        "Pipeline run successfully",
        service_api_ns.models[GeneratedAppResponse.__name__],
    )
    def post(self, tenant_id: str, dataset_id: UUID):
        """Resource for running a rag pipeline."""
        dataset_id_str = str(dataset_id)
        # Verify dataset ownership
        stmt = select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str)
        dataset = db.session.scalar(stmt)
        if not dataset:
            raise NotFound("Dataset not found.")

        payload = PipelineRunApiEntity.model_validate(service_api_ns.payload or {})

        if not isinstance(current_user, Account):
            raise Forbidden()

        rag_pipeline_service: RagPipelineService = RagPipelineService()
        pipeline: Pipeline = rag_pipeline_service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset_id_str)
        try:
            response: dict[Any, Any] | Generator[str, Any, None] = PipelineGenerateService.generate(
                pipeline=pipeline,
                user=current_user,
                args=payload.model_dump(),
                invoke_from=InvokeFrom.PUBLISHED_PIPELINE if payload.is_published else InvokeFrom.DEBUGGER,
                streaming=payload.response_mode == "streaming",
            )

            return helper.compact_generate_response(response)
        except Exception as ex:
            raise PipelineRunError(description=str(ex))


@service_api_ns.route("/datasets/pipeline/file-upload")
class KnowledgebasePipelineFileUploadApi(DatasetApiResource):
    """Resource for uploading a file to a knowledgebase pipeline."""

    @service_api_ns.doc(shortcut="knowledgebase_pipeline_file_upload")
    @service_api_ns.doc(description="Upload a file to a knowledgebase pipeline")
    @service_api_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: "Bad request - no file or invalid file",
            401: "Unauthorized - invalid API token",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @service_api_ns.response(
        201,
        "File uploaded successfully",
        service_api_ns.models[PipelineUploadFileResponse.__name__],
    )
    def post(self, tenant_id: str):
        """Upload a file for use in conversations.

        Accepts a single file upload via multipart/form-data.
        """
        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        file = request.files["file"]
        if not file.mimetype:
            raise UnsupportedFileTypeError()

        if not file.filename:
            raise FilenameNotExistsError

        if not current_user:
            raise ValueError("Invalid user account")

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=file.stream.read(),
                mimetype=file.mimetype,
                user=current_user,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return serialize_upload_file(upload_file), 201
