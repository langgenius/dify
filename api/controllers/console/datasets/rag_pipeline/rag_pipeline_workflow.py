import json
import logging
from typing import Any, Literal, cast
from uuid import UUID

from flask import abort, request
from flask_restx import Resource, marshal_with, reqparse  # type: ignore
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    ConversationCompletedError,
    DraftWorkflowNotExist,
    DraftWorkflowNotSync,
)
from controllers.console.app.workflow import workflow_model, workflow_pagination_model
from controllers.console.app.workflow_run import (
    workflow_run_detail_model,
    workflow_run_node_execution_list_model,
    workflow_run_node_execution_model,
    workflow_run_pagination_model,
)
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.model_runtime.utils.encoders import jsonable_encoder
from extensions.ext_database import db
from factories import variable_factory
from libs import helper
from libs.helper import TimestampField
from libs.login import current_account_with_tenant, current_user, login_required
from models import Account
from models.dataset import Pipeline
from models.model import EndUser
from services.errors.app import WorkflowHashNotEqualError
from services.errors.llm import InvokeRateLimitError
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.rag_pipeline.rag_pipeline_manage_service import RagPipelineManageService
from services.rag_pipeline.rag_pipeline_transform_service import RagPipelineTransformService

logger = logging.getLogger(__name__)


class DraftWorkflowSyncPayload(BaseModel):
    graph: dict[str, Any]
    hash: str | None = None
    environment_variables: list[dict[str, Any]] | None = None
    conversation_variables: list[dict[str, Any]] | None = None
    rag_pipeline_variables: list[dict[str, Any]] | None = None
    features: dict[str, Any] | None = None


class NodeRunPayload(BaseModel):
    inputs: dict[str, Any] | None = None


class NodeRunRequiredPayload(BaseModel):
    inputs: dict[str, Any]


class DatasourceNodeRunPayload(BaseModel):
    inputs: dict[str, Any]
    datasource_type: str
    credential_id: str | None = None


class DraftWorkflowRunPayload(BaseModel):
    inputs: dict[str, Any]
    datasource_type: str
    datasource_info_list: list[dict[str, Any]]
    start_node_id: str


class PublishedWorkflowRunPayload(DraftWorkflowRunPayload):
    is_preview: bool = False
    response_mode: Literal["streaming", "blocking"] = "streaming"
    original_document_id: str | None = None


class DefaultBlockConfigQuery(BaseModel):
    q: str | None = None


class WorkflowListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=10, ge=1, le=100)
    user_id: str | None = None
    named_only: bool = False


class WorkflowUpdatePayload(BaseModel):
    marked_name: str | None = Field(default=None, max_length=20)
    marked_comment: str | None = Field(default=None, max_length=100)


class NodeIdQuery(BaseModel):
    node_id: str


class WorkflowRunQuery(BaseModel):
    last_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)


class DatasourceVariablesPayload(BaseModel):
    datasource_type: str
    datasource_info: dict[str, Any]
    start_node_id: str
    start_node_title: str


register_schema_models(
    console_ns,
    DraftWorkflowSyncPayload,
    NodeRunPayload,
    NodeRunRequiredPayload,
    DatasourceNodeRunPayload,
    DraftWorkflowRunPayload,
    PublishedWorkflowRunPayload,
    DefaultBlockConfigQuery,
    WorkflowListQuery,
    WorkflowUpdatePayload,
    NodeIdQuery,
    WorkflowRunQuery,
    DatasourceVariablesPayload,
)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft")
class DraftRagPipelineApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    @marshal_with(workflow_model)
    def get(self, pipeline: Pipeline):
        """
        Get draft rag pipeline's workflow
        """
        # fetch draft workflow by app_model
        rag_pipeline_service = RagPipelineService()
        workflow = rag_pipeline_service.get_draft_workflow(pipeline=pipeline)

        if not workflow:
            raise DraftWorkflowNotExist()

        # return workflow, if not found, return None (initiate graph by frontend)
        return workflow

    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    def post(self, pipeline: Pipeline):
        """
        Sync draft workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        content_type = request.headers.get("Content-Type", "")

        if "application/json" in content_type:
            payload_dict = console_ns.payload or {}
        elif "text/plain" in content_type:
            try:
                data = json.loads(request.data.decode("utf-8"))
                if "graph" not in data or "features" not in data:
                    raise ValueError("graph or features not found in data")

                if not isinstance(data.get("graph"), dict):
                    raise ValueError("graph is not a dict")

                payload_dict = {
                    "graph": data.get("graph"),
                    "features": data.get("features"),
                    "hash": data.get("hash"),
                    "environment_variables": data.get("environment_variables"),
                    "conversation_variables": data.get("conversation_variables"),
                    "rag_pipeline_variables": data.get("rag_pipeline_variables"),
                }
            except json.JSONDecodeError:
                return {"message": "Invalid JSON data"}, 400
        else:
            abort(415)

        payload = DraftWorkflowSyncPayload.model_validate(payload_dict)

        try:
            environment_variables_list = payload.environment_variables or []
            environment_variables = [
                variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
            ]
            conversation_variables_list = payload.conversation_variables or []
            conversation_variables = [
                variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
            ]
            rag_pipeline_service = RagPipelineService()
            workflow = rag_pipeline_service.sync_draft_workflow(
                pipeline=pipeline,
                graph=payload.graph,
                unique_hash=payload.hash,
                account=current_user,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
                rag_pipeline_variables=payload.rag_pipeline_variables or [],
            )
        except WorkflowHashNotEqualError:
            raise DraftWorkflowNotSync()

        return {
            "result": "success",
            "hash": workflow.unique_hash,
            "updated_at": TimestampField().format(workflow.updated_at or workflow.created_at),
        }


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/iteration/nodes/<string:node_id>/run")
class RagPipelineDraftRunIterationNodeApi(Resource):
    @console_ns.expect(console_ns.models[NodeRunPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run draft workflow iteration node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        payload = NodeRunPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        try:
            response = PipelineGenerateService.generate_single_iteration(
                pipeline=pipeline, user=current_user, node_id=node_id, args=args, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except ValueError as e:
            raise e
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/loop/nodes/<string:node_id>/run")
class RagPipelineDraftRunLoopNodeApi(Resource):
    @console_ns.expect(console_ns.models[NodeRunPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run draft workflow loop node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        payload = NodeRunPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        try:
            response = PipelineGenerateService.generate_single_loop(
                pipeline=pipeline, user=current_user, node_id=node_id, args=args, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except ValueError as e:
            raise e
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/run")
class DraftRagPipelineRunApi(Resource):
    @console_ns.expect(console_ns.models[DraftWorkflowRunPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline):
        """
        Run draft workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        payload = DraftWorkflowRunPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump()

        try:
            response = PipelineGenerateService.generate(
                pipeline=pipeline,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=True,
            )

            return helper.compact_generate_response(response)
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/run")
class PublishedRagPipelineRunApi(Resource):
    @console_ns.expect(console_ns.models[PublishedWorkflowRunPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline):
        """
        Run published workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        payload = PublishedWorkflowRunPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)
        streaming = payload.response_mode == "streaming"

        try:
            response = PipelineGenerateService.generate(
                pipeline=pipeline,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER if payload.is_preview else InvokeFrom.PUBLISHED_PIPELINE,
                streaming=streaming,
            )

            return helper.compact_generate_response(response)
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)


# class RagPipelinePublishedDatasourceNodeRunStatusApi(Resource):
#     @setup_required
#     @login_required
#     @account_initialization_required
#     @get_rag_pipeline
#     def post(self, pipeline: Pipeline, node_id: str):
#         """
#         Run rag pipeline datasource
#         """
#         # The role of the current user in the ta table must be admin, owner, or editor
#         if not current_user.has_edit_permission:
#             raise Forbidden()
#
#         if not isinstance(current_user, Account):
#             raise Forbidden()
#
#         parser = (reqparse.RequestParser()
#             .add_argument("job_id", type=str, required=True, nullable=False, location="json")
#             .add_argument("datasource_type", type=str, required=True, location="json")
#         )
#         args = parser.parse_args()
#
#         job_id = args.get("job_id")
#         if job_id == None:
#             raise ValueError("missing job_id")
#         datasource_type = args.get("datasource_type")
#         if datasource_type == None:
#             raise ValueError("missing datasource_type")
#
#         rag_pipeline_service = RagPipelineService()
#         result = rag_pipeline_service.run_datasource_workflow_node_status(
#             pipeline=pipeline,
#             node_id=node_id,
#             job_id=job_id,
#             account=current_user,
#             datasource_type=datasource_type,
#             is_published=True
#         )
#
#         return result


# class RagPipelineDraftDatasourceNodeRunStatusApi(Resource):
#     @setup_required
#     @login_required
#     @account_initialization_required
#     @get_rag_pipeline
#     def post(self, pipeline: Pipeline, node_id: str):
#         """
#         Run rag pipeline datasource
#         """
#         # The role of the current user in the ta table must be admin, owner, or editor
#         if not current_user.has_edit_permission:
#             raise Forbidden()
#
#         if not isinstance(current_user, Account):
#             raise Forbidden()
#
#         parser = (reqparse.RequestParser()
#             .add_argument("job_id", type=str, required=True, nullable=False, location="json")
#             .add_argument("datasource_type", type=str, required=True, location="json")
#         )
#         args = parser.parse_args()
#
#         job_id = args.get("job_id")
#         if job_id == None:
#             raise ValueError("missing job_id")
#         datasource_type = args.get("datasource_type")
#         if datasource_type == None:
#             raise ValueError("missing datasource_type")
#
#         rag_pipeline_service = RagPipelineService()
#         result = rag_pipeline_service.run_datasource_workflow_node_status(
#             pipeline=pipeline,
#             node_id=node_id,
#             job_id=job_id,
#             account=current_user,
#             datasource_type=datasource_type,
#             is_published=False
#         )
#
#         return result
#
@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/datasource/nodes/<string:node_id>/run")
class RagPipelinePublishedDatasourceNodeRunApi(Resource):
    @console_ns.expect(console_ns.models[DatasourceNodeRunPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run rag pipeline datasource
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        payload = DatasourceNodeRunPayload.model_validate(console_ns.payload or {})

        rag_pipeline_service = RagPipelineService()
        return helper.compact_generate_response(
            PipelineGenerator.convert_to_event_stream(
                rag_pipeline_service.run_datasource_workflow_node(
                    pipeline=pipeline,
                    node_id=node_id,
                    user_inputs=payload.inputs,
                    account=current_user,
                    datasource_type=payload.datasource_type,
                    is_published=False,
                    credential_id=payload.credential_id,
                )
            )
        )


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/datasource/nodes/<string:node_id>/run")
class RagPipelineDraftDatasourceNodeRunApi(Resource):
    @console_ns.expect(console_ns.models[DatasourceNodeRunPayload.__name__])
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run rag pipeline datasource
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        payload = DatasourceNodeRunPayload.model_validate(console_ns.payload or {})

        rag_pipeline_service = RagPipelineService()
        return helper.compact_generate_response(
            PipelineGenerator.convert_to_event_stream(
                rag_pipeline_service.run_datasource_workflow_node(
                    pipeline=pipeline,
                    node_id=node_id,
                    user_inputs=payload.inputs,
                    account=current_user,
                    datasource_type=payload.datasource_type,
                    is_published=False,
                    credential_id=payload.credential_id,
                )
            )
        )


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/nodes/<string:node_id>/run")
class RagPipelineDraftNodeRunApi(Resource):
    @console_ns.expect(console_ns.models[NodeRunRequiredPayload.__name__])
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_run_node_execution_model)
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run draft workflow node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        payload = NodeRunRequiredPayload.model_validate(console_ns.payload or {})
        inputs = payload.inputs

        rag_pipeline_service = RagPipelineService()
        workflow_node_execution = rag_pipeline_service.run_draft_workflow_node(
            pipeline=pipeline, node_id=node_id, user_inputs=inputs, account=current_user
        )

        if workflow_node_execution is None:
            raise ValueError("Workflow node execution not found")

        return workflow_node_execution


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflow-runs/tasks/<string:task_id>/stop")
class RagPipelineTaskStopApi(Resource):
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, task_id: str):
        """
        Stop workflow task
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.DEBUGGER, current_user.id)

        return {"result": "success"}


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/publish")
class PublishedRagPipelineApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    @marshal_with(workflow_model)
    def get(self, pipeline: Pipeline):
        """
        Get published pipeline
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not pipeline.is_published:
            return None
        # fetch published workflow by pipeline
        rag_pipeline_service = RagPipelineService()
        workflow = rag_pipeline_service.get_published_workflow(pipeline=pipeline)

        # return workflow, if not found, return None
        return workflow

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline):
        """
        Publish workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        rag_pipeline_service = RagPipelineService()
        with Session(db.engine) as session:
            pipeline = session.merge(pipeline)
            workflow = rag_pipeline_service.publish_workflow(
                session=session,
                pipeline=pipeline,
                account=current_user,
            )
            pipeline.is_published = True
            pipeline.workflow_id = workflow.id
            session.add(pipeline)
            workflow_created_at = TimestampField().format(workflow.created_at)

            session.commit()

        return {
            "result": "success",
            "created_at": workflow_created_at,
        }


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/default-workflow-block-configs")
class DefaultRagPipelineBlockConfigsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def get(self, pipeline: Pipeline):
        """
        Get default block config
        """
        # Get default block configs
        rag_pipeline_service = RagPipelineService()
        return rag_pipeline_service.get_default_block_configs()


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/default-workflow-block-configs/<string:block_type>")
class DefaultRagPipelineBlockConfigApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def get(self, pipeline: Pipeline, block_type: str):
        """
        Get default block config
        """
        query = DefaultBlockConfigQuery.model_validate(request.args.to_dict())

        filters = None
        if query.q:
            try:
                filters = json.loads(query.q)
            except json.JSONDecodeError:
                raise ValueError("Invalid filters")

        # Get default block configs
        rag_pipeline_service = RagPipelineService()
        return rag_pipeline_service.get_default_block_config(node_type=block_type, filters=filters)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows")
class PublishedAllRagPipelineApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    @marshal_with(workflow_pagination_model)
    def get(self, pipeline: Pipeline):
        """
        Get published workflows
        """
        current_user, _ = current_account_with_tenant()

        query = WorkflowListQuery.model_validate(request.args.to_dict())

        page = query.page
        limit = query.limit
        user_id = query.user_id
        named_only = query.named_only

        if user_id:
            if user_id != current_user.id:
                raise Forbidden()

        rag_pipeline_service = RagPipelineService()
        with Session(db.engine) as session:
            workflows, has_more = rag_pipeline_service.get_all_published_workflow(
                session=session,
                pipeline=pipeline,
                page=page,
                limit=limit,
                user_id=user_id,
                named_only=named_only,
            )

            return {
                "items": workflows,
                "page": page,
                "limit": limit,
                "has_more": has_more,
            }


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/<string:workflow_id>")
class RagPipelineByIdApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    @marshal_with(workflow_model)
    def patch(self, pipeline: Pipeline, workflow_id: str):
        """
        Update workflow attributes
        """
        # Check permission
        current_user, _ = current_account_with_tenant()

        payload = WorkflowUpdatePayload.model_validate(console_ns.payload or {})
        update_data = payload.model_dump(exclude_unset=True)

        if not update_data:
            return {"message": "No valid fields to update"}, 400

        rag_pipeline_service = RagPipelineService()

        # Create a session and manage the transaction
        with Session(db.engine, expire_on_commit=False) as session:
            workflow = rag_pipeline_service.update_workflow(
                session=session,
                workflow_id=workflow_id,
                tenant_id=pipeline.tenant_id,
                account_id=current_user.id,
                data=update_data,
            )

            if not workflow:
                raise NotFound("Workflow not found")

            # Commit the transaction in the controller
            session.commit()

        return workflow


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/processing/parameters")
class PublishedRagPipelineSecondStepApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    def get(self, pipeline: Pipeline):
        """
        Get second step parameters of rag pipeline
        """
        query = NodeIdQuery.model_validate(request.args.to_dict())
        node_id = query.node_id
        rag_pipeline_service = RagPipelineService()
        variables = rag_pipeline_service.get_second_step_parameters(pipeline=pipeline, node_id=node_id, is_draft=False)
        return {
            "variables": variables,
        }


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/pre-processing/parameters")
class PublishedRagPipelineFirstStepApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    def get(self, pipeline: Pipeline):
        """
        Get first step parameters of rag pipeline
        """
        query = NodeIdQuery.model_validate(request.args.to_dict())
        node_id = query.node_id
        rag_pipeline_service = RagPipelineService()
        variables = rag_pipeline_service.get_first_step_parameters(pipeline=pipeline, node_id=node_id, is_draft=False)
        return {
            "variables": variables,
        }


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/pre-processing/parameters")
class DraftRagPipelineFirstStepApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    def get(self, pipeline: Pipeline):
        """
        Get first step parameters of rag pipeline
        """
        query = NodeIdQuery.model_validate(request.args.to_dict())
        node_id = query.node_id
        rag_pipeline_service = RagPipelineService()
        variables = rag_pipeline_service.get_first_step_parameters(pipeline=pipeline, node_id=node_id, is_draft=True)
        return {
            "variables": variables,
        }


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/processing/parameters")
class DraftRagPipelineSecondStepApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    def get(self, pipeline: Pipeline):
        """
        Get second step parameters of rag pipeline
        """
        query = NodeIdQuery.model_validate(request.args.to_dict())
        node_id = query.node_id

        rag_pipeline_service = RagPipelineService()
        variables = rag_pipeline_service.get_second_step_parameters(pipeline=pipeline, node_id=node_id, is_draft=True)
        return {
            "variables": variables,
        }


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflow-runs")
class RagPipelineWorkflowRunListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_run_pagination_model)
    def get(self, pipeline: Pipeline):
        """
        Get workflow run list
        """
        query = WorkflowRunQuery.model_validate(
            {
                "last_id": request.args.get("last_id"),
                "limit": request.args.get("limit", type=int, default=20),
            }
        )
        args = {
            "last_id": str(query.last_id) if query.last_id else None,
            "limit": query.limit,
        }

        rag_pipeline_service = RagPipelineService()
        result = rag_pipeline_service.get_rag_pipeline_paginate_workflow_runs(pipeline=pipeline, args=args)

        return result


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflow-runs/<uuid:run_id>")
class RagPipelineWorkflowRunDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_run_detail_model)
    def get(self, pipeline: Pipeline, run_id):
        """
        Get workflow run detail
        """
        run_id = str(run_id)

        rag_pipeline_service = RagPipelineService()
        workflow_run = rag_pipeline_service.get_rag_pipeline_workflow_run(pipeline=pipeline, run_id=run_id)

        return workflow_run


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflow-runs/<uuid:run_id>/node-executions")
class RagPipelineWorkflowRunNodeExecutionListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_run_node_execution_list_model)
    def get(self, pipeline: Pipeline, run_id: str):
        """
        Get workflow run node execution list
        """
        run_id = str(run_id)

        rag_pipeline_service = RagPipelineService()
        user = cast("Account | EndUser", current_user)
        node_executions = rag_pipeline_service.get_rag_pipeline_workflow_run_node_executions(
            pipeline=pipeline,
            run_id=run_id,
            user=user,
        )

        return {"data": node_executions}


@console_ns.route("/rag/pipelines/datasource-plugins")
class DatasourceListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        return jsonable_encoder(RagPipelineManageService.list_rag_pipeline_datasources(current_tenant_id))


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/nodes/<string:node_id>/last-run")
class RagPipelineWorkflowLastRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_run_node_execution_model)
    def get(self, pipeline: Pipeline, node_id: str):
        rag_pipeline_service = RagPipelineService()
        workflow = rag_pipeline_service.get_draft_workflow(pipeline=pipeline)
        if not workflow:
            raise NotFound("Workflow not found")
        node_exec = rag_pipeline_service.get_node_last_run(
            pipeline=pipeline,
            workflow=workflow,
            node_id=node_id,
        )
        if node_exec is None:
            raise NotFound("last run not found")
        return node_exec


@console_ns.route("/rag/pipelines/transform/datasets/<uuid:dataset_id>")
class RagPipelineTransformApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id: str):
        current_user, _ = current_account_with_tenant()

        if not (current_user.has_edit_permission or current_user.is_dataset_operator):
            raise Forbidden()

        dataset_id = str(dataset_id)
        rag_pipeline_transform_service = RagPipelineTransformService()
        result = rag_pipeline_transform_service.transform_dataset(dataset_id)
        return result


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/datasource/variables-inspect")
class RagPipelineDatasourceVariableApi(Resource):
    @console_ns.expect(console_ns.models[DatasourceVariablesPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    @marshal_with(workflow_run_node_execution_model)
    def post(self, pipeline: Pipeline):
        """
        Set datasource variables
        """
        current_user, _ = current_account_with_tenant()
        args = DatasourceVariablesPayload.model_validate(console_ns.payload or {}).model_dump()

        rag_pipeline_service = RagPipelineService()
        workflow_node_execution = rag_pipeline_service.set_datasource_variables(
            pipeline=pipeline,
            args=args,
            current_user=current_user,
        )
        return workflow_node_execution


@console_ns.route("/rag/pipelines/recommended-plugins")
class RagPipelineRecommendedPluginApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("type", type=str, location="args", required=False, default="all")
        args = parser.parse_args()
        type = args["type"]

        rag_pipeline_service = RagPipelineService()
        recommended_plugins = rag_pipeline_service.get_recommended_plugins(type)
        return recommended_plugins
