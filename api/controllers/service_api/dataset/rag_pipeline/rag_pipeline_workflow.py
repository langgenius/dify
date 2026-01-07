import string
import uuid
from collections.abc import Generator
from typing import Any

from flask import request
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

import services
from controllers.common.errors import FilenameNotExistsError, NoFileUploadedError, TooManyFilesError
from controllers.common.schema import register_schema_model
from controllers.service_api import service_api_ns
from controllers.service_api.dataset.error import PipelineRunError
from controllers.service_api.wraps import DatasetApiResource
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from libs import helper
from libs.login import current_user
from models import Account
from models.dataset import Pipeline
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


register_schema_model(service_api_ns, DatasourceNodeRunPayload)
register_schema_model(service_api_ns, PipelineRunApiEntity)


@service_api_ns.route(f"/datasets/{uuid:dataset_id}/pipeline/datasource-plugins")
class DatasourcePluginsApi(DatasetApiResource):
    """Resource for datasource plugins."""

    @service_api_ns.doc(shortcut="list_rag_pipeline_datasource_plugins")
    @service_api_ns.doc(description="List all datasource plugins for a rag pipeline")
    @service_api_ns.doc(
        path={
            "dataset_id": "Dataset ID",
        }
    )
    @service_api_ns.doc(
        params={
            "is_published": "Whether to get published or draft datasource plugins "
            "(true for published, false for draft, default: true)"
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Datasource plugins retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    def get(self, tenant_id: str, dataset_id: str):
        """Resource for getting datasource plugins."""
        # Get query parameter to determine published or draft
        is_published: bool = request.args.get("is_published", default=True, type=bool)

        rag_pipeline_service: RagPipelineService = RagPipelineService()
        datasource_plugins: list[dict[Any, Any]] = rag_pipeline_service.get_datasource_plugins(
            tenant_id=tenant_id, dataset_id=dataset_id, is_published=is_published
        )
        return datasource_plugins, 200


@service_api_ns.route(f"/datasets/{uuid:dataset_id}/pipeline/datasource/nodes/{string:node_id}/run")
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
        body={
            "inputs": "User input variables",
            "datasource_type": "Datasource type, e.g. online_document",
            "credential_id": "Credential ID",
            "is_published": "Whether to get published or draft datasource plugins "
            "(true for published, false for draft, default: true)",
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Datasource node run successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.expect(service_api_ns.models[DatasourceNodeRunPayload.__name__])
    def post(self, tenant_id: str, dataset_id: str, node_id: str):
        """Resource for getting datasource plugins."""
        payload = DatasourceNodeRunPayload.model_validate(service_api_ns.payload or {})
        assert isinstance(current_user, Account)
        rag_pipeline_service: RagPipelineService = RagPipelineService()
        pipeline: Pipeline = rag_pipeline_service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset_id)
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


@service_api_ns.route(f"/datasets/{uuid:dataset_id}/pipeline/run")
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
        body={
            "inputs": "User input variables",
            "datasource_type": "Datasource type, e.g. online_document",
            "datasource_info_list": "Datasource info list",
            "start_node_id": "Start node ID",
            "is_published": "Whether to get published or draft datasource plugins "
            "(true for published, false for draft, default: true)",
            "streaming": "Whether to stream the response(streaming or blocking), default: streaming",
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Pipeline run successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.expect(service_api_ns.models[PipelineRunApiEntity.__name__])
    def post(self, tenant_id: str, dataset_id: str):
        """Resource for running a rag pipeline."""
        payload = PipelineRunApiEntity.model_validate(service_api_ns.payload or {})

        if not isinstance(current_user, Account):
            raise Forbidden()

        rag_pipeline_service: RagPipelineService = RagPipelineService()
        pipeline: Pipeline = rag_pipeline_service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset_id)
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
                content=file.read(),
                mimetype=file.mimetype,
                user=current_user,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return {
            "id": upload_file.id,
            "name": upload_file.name,
            "size": upload_file.size,
            "extension": upload_file.extension,
            "mime_type": upload_file.mime_type,
            "created_by": upload_file.created_by,
            "created_at": upload_file.created_at,
        }, 201
