import logging
from collections.abc import Callable
from functools import wraps
from typing import Any, Concatenate, NoReturn
from uuid import UUID

from flask import Response, request
from flask_restx import Resource, marshal, marshal_with
from pydantic import BaseModel, Field
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    DraftWorkflowNotExist,
)
from controllers.console.app.workflow_draft_variable import (
    _WORKFLOW_DRAFT_VARIABLE_FIELDS,  # type: ignore[private-usage]
    EnvironmentVariableListResponse,
    workflow_draft_variable_list_model,
    workflow_draft_variable_list_without_value_model,
    workflow_draft_variable_model,
)
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from core.app.file_access import DatabaseFileAccessController
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from extensions.ext_database import db
from factories.file_factory import build_from_mapping, build_from_mappings
from factories.variable_factory import build_segment_with_type
from graphon.variables.types import SegmentType
from libs.login import login_required
from models import Account
from models.dataset import Pipeline
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.workflow_draft_variable_service import WorkflowDraftVariableList, WorkflowDraftVariableService

logger = logging.getLogger(__name__)
_file_access_controller = DatabaseFileAccessController()


class PaginationQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=100_000)
    limit: int = Field(default=20, ge=1, le=100)


class WorkflowDraftVariablePatchPayload(BaseModel):
    name: str | None = None
    value: Any = None


register_schema_models(console_ns, PaginationQuery, WorkflowDraftVariablePatchPayload)


def _api_prerequisite[T, **P, R](
    f: Callable[Concatenate[T, Account, P], R],
) -> Callable[Concatenate[T, P], R | Response]:
    """Common prerequisites for all draft workflow variable APIs.

    It ensures the following conditions are satisfied:

    - Dify has been property setup.
    - The request user has logged in and initialized.
    - The requested app is a workflow or a chat flow.
    - The request user has the edit permission for the app.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @with_current_user
    @wraps(f)
    def wrapper(self: T, current_user: Account, *args: P.args, **kwargs: P.kwargs) -> R | Response:
        if not current_user.has_edit_permission:
            raise Forbidden()
        return f(self, current_user, *args, **kwargs)

    return wrapper


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables")
class RagPipelineVariableCollectionApi(Resource):
    @console_ns.doc(params=query_params_from_model(PaginationQuery))
    @console_ns.response(
        200,
        "Workflow variables retrieved successfully",
        workflow_draft_variable_list_without_value_model,
    )
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_list_without_value_model)
    def get(self, current_user: Account, pipeline: Pipeline):
        """
        Get draft workflow
        """
        query = PaginationQuery.model_validate(request.args.to_dict())

        # fetch draft workflow by app_model
        rag_pipeline_service = RagPipelineService()
        workflow_exist = rag_pipeline_service.is_workflow_exist(pipeline=pipeline)
        if not workflow_exist:
            raise DraftWorkflowNotExist()

        # fetch draft workflow by app_model
        with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
            draft_var_srv = WorkflowDraftVariableService(
                session=session,
            )
        workflow_vars = draft_var_srv.list_variables_without_values(
            app_id=pipeline.id,
            page=query.page,
            limit=query.limit,
            user_id=current_user.id,
        )

        return workflow_vars

    @console_ns.response(204, "Workflow variables deleted successfully")
    @_api_prerequisite
    def delete(self, current_user: Account, pipeline: Pipeline):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        draft_var_srv.delete_user_workflow_variables(pipeline.id, user_id=current_user.id)
        db.session.commit()
        return Response("", 204)


def validate_node_id(node_id: str) -> NoReturn | None:
    if node_id in [
        CONVERSATION_VARIABLE_NODE_ID,
        SYSTEM_VARIABLE_NODE_ID,
    ]:
        # NOTE(QuantumGhost): While we store the system and conversation variables as node variables
        # with specific `node_id` in database, we still want to make the API separated. By disallowing
        # accessing system and conversation variables in `WorkflowDraftNodeVariableListApi`,
        # we mitigate the risk that user of the API depending on the implementation detail of the API.
        #
        # ref: [Hyrum's Law](https://www.hyrumslaw.com/)

        raise InvalidArgumentError(
            f"invalid node_id, please use correspond api for conversation and system variables, node_id={node_id}",
        )
    return None


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/nodes/<string:node_id>/variables")
class RagPipelineNodeVariableCollectionApi(Resource):
    @console_ns.response(200, "Node variables retrieved successfully", workflow_draft_variable_list_model)
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, current_user: Account, pipeline: Pipeline, node_id: str):
        validate_node_id(node_id)
        with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
            draft_var_srv = WorkflowDraftVariableService(
                session=session,
            )
            node_vars = draft_var_srv.list_node_variables(pipeline.id, node_id, user_id=current_user.id)

        return node_vars

    @console_ns.response(204, "Node variables deleted successfully")
    @_api_prerequisite
    def delete(self, current_user: Account, pipeline: Pipeline, node_id: str):
        validate_node_id(node_id)
        srv = WorkflowDraftVariableService(db.session())
        srv.delete_node_variables(pipeline.id, node_id, user_id=current_user.id)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>")
class RagPipelineVariableApi(Resource):
    _PATCH_NAME_FIELD = "name"
    _PATCH_VALUE_FIELD = "value"

    @console_ns.response(200, "Variable retrieved successfully", workflow_draft_variable_model)
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_model)
    def get(self, _current_user: Account, pipeline: Pipeline, variable_id: UUID):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        variable_id_str = str(variable_id)
        variable = draft_var_srv.get_variable(variable_id=variable_id_str)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")
        return variable

    @console_ns.response(200, "Variable updated successfully", workflow_draft_variable_model)
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_model)
    @console_ns.expect(console_ns.models[WorkflowDraftVariablePatchPayload.__name__])
    def patch(self, _current_user: Account, pipeline: Pipeline, variable_id: UUID):
        # Request payload for file types:
        #
        # Local File:
        #
        #     {
        #         "type": "image",
        #         "transfer_method": "local_file",
        #         "url": "",
        #         "upload_file_id": "daded54f-72c7-4f8e-9d18-9b0abdd9f190"
        #     }
        #
        # Remote File:
        #
        #
        #     {
        #         "type": "image",
        #         "transfer_method": "remote_url",
        #         "url": "http://127.0.0.1:5001/files/1602650a-4fe4-423c-85a2-af76c083e3c4/file-preview?timestamp=1750041099&nonce=...&sign=...=",
        #         "upload_file_id": "1602650a-4fe4-423c-85a2-af76c083e3c4"
        #     }

        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        payload = WorkflowDraftVariablePatchPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        variable_id_str = str(variable_id)
        variable = draft_var_srv.get_variable(variable_id=variable_id_str)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")

        new_name = args.get(self._PATCH_NAME_FIELD, None)
        raw_value = args.get(self._PATCH_VALUE_FIELD, None)
        if new_name is None and raw_value is None:
            return variable

        new_value = None
        if raw_value is not None:
            match variable.value_type:
                case SegmentType.FILE:
                    if not isinstance(raw_value, dict):
                        raise InvalidArgumentError(description=f"expected dict for file, got {type(raw_value)}")
                    raw_value = build_from_mapping(
                        mapping=raw_value,
                        tenant_id=pipeline.tenant_id,
                        access_controller=_file_access_controller,
                    )
                case SegmentType.ARRAY_FILE:
                    if not isinstance(raw_value, list):
                        raise InvalidArgumentError(description=f"expected list for files, got {type(raw_value)}")
                    if len(raw_value) > 0 and not isinstance(raw_value[0], dict):
                        raise InvalidArgumentError(description=f"expected dict for files[0], got {type(raw_value)}")
                    raw_value = build_from_mappings(
                        mappings=raw_value,
                        tenant_id=pipeline.tenant_id,
                        access_controller=_file_access_controller,
                    )
                case _:
                    pass
            new_value = build_segment_with_type(variable.value_type, raw_value)
        draft_var_srv.update_variable(variable, name=new_name, value=new_value)
        db.session.commit()
        return variable

    @console_ns.response(204, "Variable deleted successfully")
    @_api_prerequisite
    def delete(self, _current_user: Account, pipeline: Pipeline, variable_id: UUID):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        variable_id_str = str(variable_id)
        variable = draft_var_srv.get_variable(variable_id=variable_id_str)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")
        draft_var_srv.delete_variable(variable)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class RagPipelineVariableResetApi(Resource):
    @console_ns.response(200, "Variable reset successfully", workflow_draft_variable_model)
    @console_ns.response(204, "Variable reset (no content)")
    @_api_prerequisite
    def put(self, _current_user: Account, pipeline: Pipeline, variable_id: UUID):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )

        rag_pipeline_service = RagPipelineService()
        draft_workflow = rag_pipeline_service.get_draft_workflow(pipeline=pipeline)
        if draft_workflow is None:
            raise NotFoundError(
                f"Draft workflow not found, pipeline_id={pipeline.id}",
            )
        variable_id_str = str(variable_id)
        variable = draft_var_srv.get_variable(variable_id=variable_id_str)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")

        resetted = draft_var_srv.reset_variable(draft_workflow, variable)
        db.session.commit()
        if resetted is None:
            return Response("", 204)
        else:
            return marshal(resetted, _WORKFLOW_DRAFT_VARIABLE_FIELDS)


def _get_variable_list(pipeline: Pipeline, node_id: str, current_user_id: str) -> WorkflowDraftVariableList:
    with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
        draft_var_srv = WorkflowDraftVariableService(
            session=session,
        )
        if node_id == CONVERSATION_VARIABLE_NODE_ID:
            draft_vars = draft_var_srv.list_conversation_variables(pipeline.id, user_id=current_user_id)
        elif node_id == SYSTEM_VARIABLE_NODE_ID:
            draft_vars = draft_var_srv.list_system_variables(pipeline.id, user_id=current_user_id)
        else:
            draft_vars = draft_var_srv.list_node_variables(app_id=pipeline.id, node_id=node_id, user_id=current_user_id)
    return draft_vars


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/system-variables")
class RagPipelineSystemVariableCollectionApi(Resource):
    @console_ns.response(200, "System variables retrieved successfully", workflow_draft_variable_list_model)
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, current_user: Account, pipeline: Pipeline):
        return _get_variable_list(pipeline, SYSTEM_VARIABLE_NODE_ID, current_user.id)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/environment-variables")
class RagPipelineEnvironmentVariableCollectionApi(Resource):
    @console_ns.response(
        200,
        "Environment variables retrieved successfully",
        console_ns.models[EnvironmentVariableListResponse.__name__],
    )
    @_api_prerequisite
    def get(self, _current_user: Account, pipeline: Pipeline):
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        rag_pipeline_service = RagPipelineService()
        workflow = rag_pipeline_service.get_draft_workflow(pipeline=pipeline)
        if workflow is None:
            raise DraftWorkflowNotExist()

        env_vars = workflow.environment_variables
        env_vars_list = []
        for v in env_vars:
            env_vars_list.append(
                {
                    "id": v.id,
                    "type": "env",
                    "name": v.name,
                    "description": v.description,
                    "selector": v.selector,
                    "value_type": v.value_type.value,
                    "value": v.value,
                    # Do not track edited for env vars.
                    "edited": False,
                    "visible": True,
                    "editable": True,
                }
            )

        return {"items": env_vars_list}
