from uuid import UUID

from flask import request

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    ForbiddenError,
    InvalidArgumentError,
    NoFileUploadedError,
    NotFoundError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_model,
)
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.dataset.error import PipelineRunError
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from controllers.service_api.schema import event_stream_response, json_or_event_stream_response, multipart_file_params
from extensions.ext_application_services import application_services
from fields.service_api.rag_pipeline import (
    DatasourceCredentialInfoResponse,
    DatasourceNodeRunPayload,
    DatasourcePluginListResponse,
    DatasourcePluginResponse,
    DatasourcePluginsQuery,
    PipelineRunJsonResponse,
    PipelineRunPayload,
    PipelineUploadFileResponse,
    PublishedPipelineRunResponse,
)
from fields.workflow_fields import WorkflowBlockingResponse
from libs import helper
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.errors.file import FileTooLargeError as FileTooLargeServiceError
from services.errors.file import UnsupportedFileTypeError as UnsupportedFileTypeServiceError
from services.knowledge.entities.pipeline_workflows import DatasourceNodeRun, PipelineFileUpload, PipelineRun
from services.knowledge.rag_pipeline.application import (
    PipelineActorNotFoundError,
    PipelineConfigurationError,
    PipelineDatasetNotFoundError,
    PipelineNotFoundError,
)

register_schema_model(service_api_ns, DatasourceNodeRunPayload)
register_schema_model(service_api_ns, DatasourcePluginsQuery)
register_schema_model(service_api_ns, PipelineRunPayload)
register_response_schema_models(
    service_api_ns,
    DatasourceCredentialInfoResponse,
    DatasourcePluginResponse,
    DatasourcePluginListResponse,
    PipelineUploadFileResponse,
    WorkflowBlockingResponse,
    PublishedPipelineRunResponse,
    PipelineRunJsonResponse,
)


@service_api_ns.route("/datasets/<uuid:dataset_id>/pipeline/datasource-plugins")
class DatasourcePluginsApi(DatasetApiResource):
    """Resource for datasource plugins."""

    @service_api_ns.doc(
        summary="List Datasource Plugins",
        description=(
            "List the datasource nodes configured in the knowledge pipeline. Each node includes the plugin it uses "
            "plus the metadata needed to run it."
        ),
        tags=["Knowledge Pipeline"],
        responses={
            200: "List of datasource nodes configured in the pipeline.",
            404: "`not_found` : Dataset not found.",
        },
    )
    @service_api_ns.doc(shortcut="list_rag_pipeline_datasource_plugins")
    @service_api_ns.doc(description="List all datasource plugins for a rag pipeline")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(params=query_params_from_model(DatasourcePluginsQuery))
    @service_api_ns.doc(
        responses={
            200: "Datasource plugins retrieved successfully",
            400: "Bad request - pipeline is not configured",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Datasource plugins retrieved successfully",
        service_api_ns.models[DatasourcePluginListResponse.__name__],
    )
    @dataset_admission()
    def get(self, request_context: RequestContext, dataset_id: UUID):
        """Resource for getting datasource plugins."""
        query = query_params_from_request(DatasourcePluginsQuery)
        try:
            datasource_plugins = application_services().knowledge.pipeline_workflows.list_datasource_plugins(
                request_context,
                dataset_id=str(dataset_id),
                is_published=query.is_published,
            )
        except (PipelineDatasetNotFoundError, PipelineNotFoundError) as error:
            raise NotFoundError(str(error)) from error
        except PipelineConfigurationError as error:
            raise InvalidArgumentError(str(error)) from error
        return dump_response(DatasourcePluginListResponse, datasource_plugins), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/pipeline/datasource/nodes/<string:node_id>/run")
class DatasourceNodeRunApi(DatasetApiResource):
    """Resource for datasource node run."""

    @service_api_ns.doc(
        summary="Run Datasource Node",
        description=(
            "Execute a single datasource node within the knowledge pipeline. Returns a streaming response with the "
            "node execution results."
        ),
        tags=["Knowledge Pipeline"],
        responses={
            200: "Streaming response with node execution events.",
            404: "`not_found` : Dataset not found.",
        },
    )
    @event_stream_response(service_api_ns)
    @service_api_ns.doc(shortcut="run_datasource_node")
    @service_api_ns.doc(description="Run a datasource node for a rag pipeline")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "node_id": "ID of the datasource node to execute."})
    @service_api_ns.doc(
        responses={
            200: "Datasource node run successfully",
            400: "Bad request - invalid payload or pipeline is not configured",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.expect(service_api_ns.models[DatasourceNodeRunPayload.__name__])
    @dataset_admission()
    @model_validate(DatasourceNodeRunPayload)
    def post(self, payload: DatasourceNodeRunPayload, request_context: RequestContext, dataset_id: UUID, node_id: str):
        """Resource for getting datasource plugins."""
        try:
            events = application_services().knowledge.pipeline_workflows.run_datasource_node(
                request_context,
                dataset_id=str(dataset_id),
                node_id=node_id,
                command=DatasourceNodeRun(
                    inputs=payload.inputs,
                    datasource_type=payload.datasource_type.value,
                    is_published=payload.is_published,
                    credential_id=payload.credential_id,
                ),
            )
        except (PipelineDatasetNotFoundError, PipelineNotFoundError) as error:
            raise NotFoundError(str(error)) from error
        except PipelineActorNotFoundError as error:
            raise ForbiddenError(str(error)) from error
        except PipelineConfigurationError as error:
            raise InvalidArgumentError(str(error)) from error
        # response-contract:ignore compact_generate_response
        return helper.compact_generate_response(events)


@service_api_ns.route("/datasets/<uuid:dataset_id>/pipeline/run")
class PipelineRunApi(DatasetApiResource):
    """Resource for datasource node run."""

    @error_responses(PipelineRunError)
    @service_api_ns.doc(
        summary="Run Pipeline",
        description=(
            "Execute the full knowledge pipeline for a knowledge base. Published runs are queued and return batch "
            "metadata as JSON. Draft runs support blocking JSON and streaming Server-Sent Events."
        ),
        tags=["Knowledge Pipeline"],
        responses={
            200: (
                "Pipeline execution result. Published runs return a JSON object containing `batch`, `dataset`, and "
                "`documents`. Draft runs return `text/event-stream` for streaming mode or a workflow result JSON "
                "object for blocking mode."
            ),
            403: "`forbidden` : Forbidden.",
            404: "`not_found` : Dataset not found.",
            500: "`pipeline_run_error` : Pipeline execution failed.",
        },
    )
    @json_or_event_stream_response(service_api_ns)
    @service_api_ns.doc(shortcut="run_pipeline")
    @service_api_ns.doc(description="Run a datasource node for a rag pipeline")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Pipeline run successfully",
            400: "Bad request - invalid payload or pipeline is not configured",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.expect(service_api_ns.models[PipelineRunPayload.__name__])
    @service_api_ns.response(
        200,
        "Pipeline run successfully",
        service_api_ns.models[PipelineRunJsonResponse.__name__],
    )
    @dataset_admission()
    def post(self, request_context: RequestContext, dataset_id: UUID):
        """Resource for running a rag pipeline."""
        try:
            payload = PipelineRunPayload.model_validate(service_api_ns.payload or {})
        except ValueError as error:
            raise InvalidArgumentError(str(error)) from error
        try:
            response = application_services().knowledge.pipeline_workflows.run_pipeline(
                request_context,
                dataset_id=str(dataset_id),
                command=PipelineRun(
                    values=payload.model_dump(mode="json"),
                    is_published=payload.is_published,
                    streaming=payload.response_mode == "streaming",
                ),
            )
        except (PipelineDatasetNotFoundError, PipelineNotFoundError) as error:
            raise NotFoundError(str(error)) from error
        except PipelineActorNotFoundError as error:
            raise ForbiddenError(str(error)) from error
        except PipelineConfigurationError as error:
            raise InvalidArgumentError(str(error)) from error
        except Exception as ex:
            raise PipelineRunError(description=str(ex)) from ex
        # response-contract:ignore compact_generate_response
        return helper.compact_generate_response(response)


@service_api_ns.route("/datasets/pipeline/file-upload")
@service_api_ns.route("/datasets/<uuid:dataset_id>/pipeline/file-upload")
class KnowledgebasePipelineFileUploadApi(DatasetApiResource):
    """Resource for uploading a file to a knowledgebase pipeline."""

    @error_responses(
        FilenameNotExistsError, FileTooLargeError, NoFileUploadedError, TooManyFilesError, UnsupportedFileTypeError
    )
    @service_api_ns.doc(
        summary="Upload Pipeline File",
        description=(
            "Upload a file for use in a knowledge pipeline. Resource access tokens must use the dataset-scoped "
            "path; workspace API keys may also use the unscoped compatibility path. Accepts a single file via "
            "`multipart/form-data`."
        ),
        tags=["Knowledge Pipeline"],
        responses={
            201: "File uploaded successfully.",
            400: (
                "- `no_file_uploaded` : Please upload your file.\n"
                "- `filename_not_exists_error` : The specified filename does not exist.\n"
                "- `too_many_files` : Only one file is allowed."
            ),
            413: "`file_too_large` : File size exceeded.",
            415: "`unsupported_file_type` : File type not allowed.",
        },
    )
    @service_api_ns.doc(shortcut="knowledgebase_pipeline_file_upload")
    @service_api_ns.doc(description="Upload a file to a knowledgebase pipeline")
    @service_api_ns.doc(consumes=["multipart/form-data"], params=multipart_file_params(include_user=False))
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
    @dataset_admission()
    def post(self, request_context: RequestContext, dataset_id: UUID | None = None):
        """Upload a file for use in conversations.

        Accepts a single file upload via multipart/form-data.
        """
        del dataset_id  # The admission adapter consumes the route scope before invoking this transport handler.
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

        try:
            upload_file = application_services().knowledge.pipeline_workflows.upload_file(
                request_context,
                upload=PipelineFileUpload(
                    filename=file.filename,
                    content=file.stream.read(),
                    mimetype=file.mimetype,
                ),
            )
        except FileTooLargeServiceError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description) from file_too_large_error
        except UnsupportedFileTypeServiceError as caught_error:
            raise UnsupportedFileTypeError() from caught_error

        return dump_response(PipelineUploadFileResponse, upload_file), 201
