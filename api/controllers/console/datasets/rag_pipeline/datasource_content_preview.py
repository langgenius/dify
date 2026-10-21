from typing import Any
from uuid import UUID

from flask_restx import (  # type: ignore
    Resource,  # type: ignore
)
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

from controllers.common.errors import InvalidArgumentError
from controllers.common.rbac import DatasetByPipeline, RBACCheck
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.error import PipelineNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from core.rbac import RBACPermission
from extensions.ext_application_services import application_services
from libs.external_api import error_responses
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.entities.pipeline_workflows import DatasourceNodeRun
from services.knowledge.rag_pipeline.application import (
    PipelineActorNotFoundError,
    PipelineConfigurationError,
    PipelineDatasetNotFoundError,
)
from services.knowledge.rag_pipeline.application import (
    PipelineNotFoundError as PipelineApplicationNotFoundError,
)


class DatasourceContentPreviewPayload(BaseModel):
    inputs: dict[str, Any]
    datasource_type: str
    credential_id: str | None = None


register_schema_models(console_ns, DatasourceContentPreviewPayload)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/datasource/nodes/<string:node_id>/preview")
class DataSourceContentPreviewApi(Resource):
    @error_responses(PipelineNotFoundError)
    @console_ns.expect(console_ns.models[DatasourceContentPreviewPayload.__name__])
    @console_ns.response(200, "Success")
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetByPipeline()),),
    )
    @model_validate(DatasourceContentPreviewPayload)
    def post(
        self,
        req_data: DatasourceContentPreviewPayload,
        request_context: RequestContext,
        pipeline_id: UUID,
        node_id: str,
    ):
        """
        Run datasource content preview
        """

        try:
            preview_content = application_services().knowledge.pipeline_workflows.preview_console_datasource_node(
                request_context,
                pipeline_id=str(pipeline_id),
                node_id=node_id,
                command=DatasourceNodeRun(
                    inputs=req_data.inputs,
                    datasource_type=req_data.datasource_type,
                    is_published=True,
                    credential_id=req_data.credential_id,
                ),
            )
        except (
            DatasetNotFoundError,
            PipelineDatasetNotFoundError,
            PipelineApplicationNotFoundError,
        ) as error:
            raise PipelineNotFoundError() from error
        except (DatasetAccessDeniedError, PipelineActorNotFoundError) as error:
            raise Forbidden(str(error)) from error
        except PipelineConfigurationError as error:
            raise InvalidArgumentError(str(error)) from error
        return preview_content, 200
