import json
import logging
from typing import cast

from flask import abort, request
from flask_restx import Resource, inputs, marshal_with, reqparse  # type: ignore  # type: ignore
from flask_restx.inputs import int_range  # type: ignore
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.console import console_ns
from controllers.console.app.error import (
    ConversationCompletedError,
    DraftWorkflowNotExist,
    DraftWorkflowNotSync,
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
from fields.workflow_fields import workflow_fields, workflow_pagination_fields
from fields.workflow_run_fields import (
    workflow_run_detail_fields,
    workflow_run_node_execution_fields,
    workflow_run_node_execution_list_fields,
    workflow_run_pagination_fields,
)
from libs import helper
from libs.helper import TimestampField, uuid_value
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


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft")
class DraftRagPipelineApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    @marshal_with(workflow_fields)
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
            parser = (
                reqparse.RequestParser()
                .add_argument("graph", type=dict, required=True, nullable=False, location="json")
                .add_argument("hash", type=str, required=False, location="json")
                .add_argument("environment_variables", type=list, required=False, location="json")
                .add_argument("conversation_variables", type=list, required=False, location="json")
                .add_argument("rag_pipeline_variables", type=list, required=False, location="json")
            )
            args = parser.parse_args()
        elif "text/plain" in content_type:
            try:
                data = json.loads(request.data.decode("utf-8"))
                if "graph" not in data or "features" not in data:
                    raise ValueError("graph or features not found in data")

                if not isinstance(data.get("graph"), dict):
                    raise ValueError("graph is not a dict")

                args = {
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

        try:
            environment_variables_list = args.get("environment_variables") or []
            environment_variables = [
                variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
            ]
            conversation_variables_list = args.get("conversation_variables") or []
            conversation_variables = [
                variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
            ]
            rag_pipeline_service = RagPipelineService()
            workflow = rag_pipeline_service.sync_draft_workflow(
                pipeline=pipeline,
                graph=args["graph"],
                unique_hash=args.get("hash"),
                account=current_user,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
                rag_pipeline_variables=args.get("rag_pipeline_variables") or [],
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

        parser = reqparse.RequestParser().add_argument("inputs", type=dict, location="json")
        args = parser.parse_args()

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
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run draft workflow loop node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = reqparse.RequestParser().add_argument("inputs", type=dict, location="json")
        args = parser.parse_args()

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
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline):
        """
        Run draft workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
            .add_argument("datasource_type", type=str, required=True, location="json")
            .add_argument("datasource_info_list", type=list, required=True, location="json")
            .add_argument("start_node_id", type=str, required=True, location="json")
        )
        args = parser.parse_args()

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
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline):
        """
        Run published workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
            .add_argument("datasource_type", type=str, required=True, location="json")
            .add_argument("datasource_info_list", type=list, required=True, location="json")
            .add_argument("start_node_id", type=str, required=True, location="json")
            .add_argument("is_preview", type=bool, required=True, location="json", default=False)
            .add_argument("response_mode", type=str, required=True, location="json", default="streaming")
            .add_argument("original_document_id", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"

        try:
            response = PipelineGenerateService.generate(
                pipeline=pipeline,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER if args.get("is_preview") else InvokeFrom.PUBLISHED,
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
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run rag pipeline datasource
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
            .add_argument("datasource_type", type=str, required=True, location="json")
            .add_argument("credential_id", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        inputs = args.get("inputs")
        if inputs is None:
            raise ValueError("missing inputs")
        datasource_type = args.get("datasource_type")
        if datasource_type is None:
            raise ValueError("missing datasource_type")

        rag_pipeline_service = RagPipelineService()
        return helper.compact_generate_response(
            PipelineGenerator.convert_to_event_stream(
                rag_pipeline_service.run_datasource_workflow_node(
                    pipeline=pipeline,
                    node_id=node_id,
                    user_inputs=inputs,
                    account=current_user,
                    datasource_type=datasource_type,
                    is_published=False,
                    credential_id=args.get("credential_id"),
                )
            )
        )


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/datasource/nodes/<string:node_id>/run")
class RagPipelineDraftDatasourceNodeRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run rag pipeline datasource
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
            .add_argument("datasource_type", type=str, required=True, location="json")
            .add_argument("credential_id", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        inputs = args.get("inputs")
        if inputs is None:
            raise ValueError("missing inputs")
        datasource_type = args.get("datasource_type")
        if datasource_type is None:
            raise ValueError("missing datasource_type")

        rag_pipeline_service = RagPipelineService()
        return helper.compact_generate_response(
            PipelineGenerator.convert_to_event_stream(
                rag_pipeline_service.run_datasource_workflow_node(
                    pipeline=pipeline,
                    node_id=node_id,
                    user_inputs=inputs,
                    account=current_user,
                    datasource_type=datasource_type,
                    is_published=False,
                    credential_id=args.get("credential_id"),
                )
            )
        )


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/nodes/<string:node_id>/run")
class RagPipelineDraftNodeRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_run_node_execution_fields)
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run draft workflow node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = reqparse.RequestParser().add_argument(
            "inputs", type=dict, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()

        inputs = args.get("inputs")
        if inputs == None:
            raise ValueError("missing inputs")

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
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, task_id: str):
        """
        Stop workflow task
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.DEBUGGER, current_user.id)

        return {"result": "success"}


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/publish")
class PublishedRagPipelineApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_fields)
    def get(self, pipeline: Pipeline):
        """
        Get published pipeline
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()
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
    @get_rag_pipeline
    def post(self, pipeline: Pipeline):
        """
        Publish workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

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
    @get_rag_pipeline
    def get(self, pipeline: Pipeline):
        """
        Get default block config
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        # Get default block configs
        rag_pipeline_service = RagPipelineService()
        return rag_pipeline_service.get_default_block_configs()


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/default-workflow-block-configs/<string:block_type>")
class DefaultRagPipelineBlockConfigApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def get(self, pipeline: Pipeline, block_type: str):
        """
        Get default block config
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = reqparse.RequestParser().add_argument("q", type=str, location="args")
        args = parser.parse_args()

        q = args.get("q")

        filters = None
        if q:
            try:
                filters = json.loads(args.get("q", ""))
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
    @get_rag_pipeline
    @marshal_with(workflow_pagination_fields)
    def get(self, pipeline: Pipeline):
        """
        Get published workflows
        """
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("page", type=inputs.int_range(1, 99999), required=False, default=1, location="args")
            .add_argument("limit", type=inputs.int_range(1, 100), required=False, default=20, location="args")
            .add_argument("user_id", type=str, required=False, location="args")
            .add_argument("named_only", type=inputs.boolean, required=False, default=False, location="args")
        )
        args = parser.parse_args()
        page = int(args.get("page", 1))
        limit = int(args.get("limit", 10))
        user_id = args.get("user_id")
        named_only = args.get("named_only", False)

        if user_id:
            if user_id != current_user.id:
                raise Forbidden()
            user_id = cast(str, user_id)

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
    @get_rag_pipeline
    @marshal_with(workflow_fields)
    def patch(self, pipeline: Pipeline, workflow_id: str):
        """
        Update workflow attributes
        """
        # Check permission
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("marked_name", type=str, required=False, location="json")
            .add_argument("marked_comment", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        # Validate name and comment length
        if args.marked_name and len(args.marked_name) > 20:
            raise ValueError("Marked name cannot exceed 20 characters")
        if args.marked_comment and len(args.marked_comment) > 100:
            raise ValueError("Marked comment cannot exceed 100 characters")
        args = parser.parse_args()

        # Prepare update data
        update_data = {}
        if args.get("marked_name") is not None:
            update_data["marked_name"] = args["marked_name"]
        if args.get("marked_comment") is not None:
            update_data["marked_comment"] = args["marked_comment"]

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
        parser = reqparse.RequestParser().add_argument("node_id", type=str, required=True, location="args")
        args = parser.parse_args()
        node_id = args.get("node_id")
        if not node_id:
            raise ValueError("Node ID is required")
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
        parser = reqparse.RequestParser().add_argument("node_id", type=str, required=True, location="args")
        args = parser.parse_args()
        node_id = args.get("node_id")
        if not node_id:
            raise ValueError("Node ID is required")
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
        parser = reqparse.RequestParser().add_argument("node_id", type=str, required=True, location="args")
        args = parser.parse_args()
        node_id = args.get("node_id")
        if not node_id:
            raise ValueError("Node ID is required")
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
        parser = reqparse.RequestParser().add_argument("node_id", type=str, required=True, location="args")
        args = parser.parse_args()
        node_id = args.get("node_id")
        if not node_id:
            raise ValueError("Node ID is required")

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
    @marshal_with(workflow_run_pagination_fields)
    def get(self, pipeline: Pipeline):
        """
        Get workflow run list
        """
        parser = (
            reqparse.RequestParser()
            .add_argument("last_id", type=uuid_value, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        )
        args = parser.parse_args()

        rag_pipeline_service = RagPipelineService()
        result = rag_pipeline_service.get_rag_pipeline_paginate_workflow_runs(pipeline=pipeline, args=args)

        return result


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflow-runs/<uuid:run_id>")
class RagPipelineWorkflowRunDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @marshal_with(workflow_run_detail_fields)
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
    @marshal_with(workflow_run_node_execution_list_fields)
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
    @marshal_with(workflow_run_node_execution_fields)
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
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @edit_permission_required
    @marshal_with(workflow_run_node_execution_fields)
    def post(self, pipeline: Pipeline):
        """
        Set datasource variables
        """
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("datasource_type", type=str, required=True, location="json")
            .add_argument("datasource_info", type=dict, required=True, location="json")
            .add_argument("start_node_id", type=str, required=True, location="json")
            .add_argument("start_node_title", type=str, required=True, location="json")
        )
        args = parser.parse_args()

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
        rag_pipeline_service = RagPipelineService()
        recommended_plugins = rag_pipeline_service.get_recommended_plugins()
        return recommended_plugins
