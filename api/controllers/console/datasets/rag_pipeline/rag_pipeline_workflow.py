import json
import logging
from typing import Any, Literal, cast

from flask import abort, request
from flask_restx import Resource, marshal_with  # type: ignore
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import BadRequest, Forbidden, InternalServerError, NotFound

import services
from controllers.common.controller_schemas import DefaultBlockConfigQuery, WorkflowListQuery, WorkflowUpdatePayload
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    ConversationCompletedError,
    DraftWorkflowNotExist,
    DraftWorkflowNotSync,
)
from controllers.console.app.workflow import (
    RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE,
    workflow_model,
    workflow_pagination_model,
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
from extensions.ext_database import db
from factories import variable_factory
from fields.workflow_run_fields import (
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionListResponse,
    WorkflowRunNodeExecutionResponse,
    WorkflowRunPaginationResponse,
)
from graphon.model_runtime.utils.encoders import jsonable_encoder
from libs import helper
from libs.helper import TimestampField, UUIDStrOrEmpty
from libs.login import current_account_with_tenant, current_user, login_required
from models import Account
from models.dataset import Pipeline
from models.model import EndUser
from models.workflow import Workflow
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.rag_pipeline.rag_pipeline_manage_service import RagPipelineManageService
from services.rag_pipeline.rag_pipeline_transform_service import RagPipelineTransformService
from services.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError, WorkflowService

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


class NodeIdQuery(BaseModel):
    node_id: str


class WorkflowRunQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class DatasourceVariablesPayload(BaseModel):
    datasource_type: str
    datasource_info: dict[str, Any]
    start_node_id: str
    start_node_title: str


class RagPipelineRecommendedPluginQuery(BaseModel):
    type: str = "all"


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
    RagPipelineRecommendedPluginQuery,
)
register_response_schema_models(
    console_ns,
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionListResponse,
    WorkflowRunNodeExecutionResponse,
    WorkflowRunPaginationResponse,
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
            payload = DraftWorkflowSyncPayload.model_validate(payload_dict)
        elif "text/plain" in content_type:
            try:
                payload = DraftWorkflowSyncPayload.model_validate_json(request.data)
            except (ValueError, ValidationError):
                return {"message": "Invalid JSON data"}, 400
        else:
            abort(415)
        rag_pipeline_service = RagPipelineService()

        try:
            environment_variables_list = Workflow.normalize_environment_variable_mappings(
                payload.environment_variables or [],
            )
            environment_variables = [
                variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
            ]
            conversation_variables_list = payload.conversation_variables or []
            conversation_variables = [
                variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
            ]
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
    @console_ns.response(
        200,
        "Node run started successfully",
        console_ns.models[WorkflowRunNodeExecutionResponse.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    @get_rag_pipeline
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

        return WorkflowRunNodeExecutionResponse.model_validate(
            workflow_node_execution, from_attributes=True
        ).model_dump(mode="json")


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
        workflow = rag_pipeline_service.publish_workflow(
            session=db.session,  # type: ignore[reportArgumentType,arg-type]
            pipeline=pipeline,
            account=current_user,
        )
        pipeline.is_published = True
        pipeline.workflow_id = workflow.id
        db.session.commit()
        workflow_created_at = TimestampField().format(workflow.created_at)

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
        with sessionmaker(db.engine).begin() as session:
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


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/<string:workflow_id>/restore")
class RagPipelineDraftWorkflowRestoreApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, workflow_id: str):
        current_user, _ = current_account_with_tenant()
        rag_pipeline_service = RagPipelineService()

        try:
            workflow = rag_pipeline_service.restore_published_workflow_to_draft(
                pipeline=pipeline,
                workflow_id=workflow_id,
                account=current_user,
            )
        except IsDraftWorkflowError as exc:
            # Use a stable, predefined message to keep the 400 response consistent
            raise BadRequest(RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE) from exc
        except WorkflowNotFoundError as exc:
            raise NotFound(str(exc)) from exc

        return {
            "result": "success",
            "hash": workflow.unique_hash,
            "updated_at": TimestampField().format(workflow.updated_at or workflow.created_at),
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
        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            workflow = rag_pipeline_service.update_workflow(
                session=session,
                workflow_id=workflow_id,
                tenant_id=pipeline.tenant_id,
                account_id=current_user.id,
                data=update_data,
            )

            if not workflow:
                raise NotFound("Workflow not found")

            return workflow

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_rag_pipeline
    def delete(self, pipeline: Pipeline, workflow_id: str):
        """
        Delete a published workflow version that is not currently active on the pipeline.
        """
        if pipeline.workflow_id == workflow_id:
            abort(400, description=f"Cannot delete workflow that is currently in use by pipeline '{pipeline.id}'")

        workflow_service = WorkflowService()

        with sessionmaker(db.engine).begin() as session:
            try:
                workflow_service.delete_workflow(
                    session=session,
                    workflow_id=workflow_id,
                    tenant_id=pipeline.tenant_id,
                )
            except WorkflowInUseError as e:
                abort(400, description=str(e))
            except DraftWorkflowDeletionError as e:
                abort(400, description=str(e))
            except ValueError as e:
                raise NotFound(str(e))

        return None, 204


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
    @console_ns.response(
        200,
        "Workflow runs retrieved successfully",
        console_ns.models[WorkflowRunPaginationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
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

        return WorkflowRunPaginationResponse.model_validate(result, from_attributes=True).model_dump(mode="json")


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflow-runs/<uuid:run_id>")
class RagPipelineWorkflowRunDetailApi(Resource):
    @console_ns.response(
        200,
        "Workflow run detail retrieved successfully",
        console_ns.models[WorkflowRunDetailResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def get(self, pipeline: Pipeline, run_id):
        """
        Get workflow run detail
        """
        run_id = str(run_id)

        rag_pipeline_service = RagPipelineService()
        workflow_run = rag_pipeline_service.get_rag_pipeline_workflow_run(pipeline=pipeline, run_id=run_id)
        if workflow_run is None:
            raise NotFound("Workflow run not found")

        return WorkflowRunDetailResponse.model_validate(workflow_run, from_attributes=True).model_dump(mode="json")


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflow-runs/<uuid:run_id>/node-executions")
class RagPipelineWorkflowRunNodeExecutionListApi(Resource):
    @console_ns.response(
        200,
        "Node executions retrieved successfully",
        console_ns.models[WorkflowRunNodeExecutionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
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

        return WorkflowRunNodeExecutionListResponse.model_validate(
            {"data": node_executions}, from_attributes=True
        ).model_dump(mode="json")


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
    @console_ns.response(
        200,
        "Node last run retrieved successfully",
        console_ns.models[WorkflowRunNodeExecutionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
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
        return WorkflowRunNodeExecutionResponse.model_validate(node_exec, from_attributes=True).model_dump(mode="json")


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
    @console_ns.response(
        200,
        "Datasource variables set successfully",
        console_ns.models[WorkflowRunNodeExecutionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
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
        return WorkflowRunNodeExecutionResponse.model_validate(
            workflow_node_execution, from_attributes=True
        ).model_dump(mode="json")


@console_ns.route("/rag/pipelines/recommended-plugins")
class RagPipelineRecommendedPluginApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        query = RagPipelineRecommendedPluginQuery.model_validate(request.args.to_dict())

        rag_pipeline_service = RagPipelineService()
        recommended_plugins = rag_pipeline_service.get_recommended_plugins(query.type)
        return recommended_plugins
