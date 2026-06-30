import logging
from collections.abc import Callable
from functools import wraps
from typing import Any, Concatenate
from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    DraftWorkflowNotExist,
)
from controllers.console.app.workflow_draft_variable import (
    WorkflowDraftVariableListResponse,
    WorkflowDraftVariableListWithoutValueResponse,
    WorkflowDraftVariableResponse,
    WorkflowDraftVariableUpdatePayload,
    validate_node_id,
)
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from core.app.file_access import DatabaseFileAccessController
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from extensions.ext_database import db
from factories.file_factory import build_from_mapping, build_from_mappings
from factories.variable_factory import build_segment_with_type
from fields.base import ResponseModel
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


class WorkflowDraftVariablePatchPayload(WorkflowDraftVariableUpdatePayload):
    value: Any = None


class RagPipelineEnvironmentVariableResponse(ResponseModel):
    id: str
    type: str
    name: str
    description: str
    selector: list[str]
    value_type: str
    value: Any
    edited: bool
    visible: bool
    editable: bool


class RagPipelineEnvironmentVariableListResponse(ResponseModel):
    items: list[RagPipelineEnvironmentVariableResponse]


register_schema_models(console_ns, PaginationQuery, WorkflowDraftVariablePatchPayload)
register_response_schema_models(
    console_ns,
    WorkflowDraftVariableResponse,
    WorkflowDraftVariableListResponse,
    WorkflowDraftVariableListWithoutValueResponse,
    RagPipelineEnvironmentVariableResponse,
    RagPipelineEnvironmentVariableListResponse,
)


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
    @console_ns.doc(params={"pipeline_id": "Pipeline ID", **query_params_from_model(PaginationQuery)})
    @console_ns.response(
        200,
        "Variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListWithoutValueResponse.__name__],
    )
    @_api_prerequisite
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

        return WorkflowDraftVariableListWithoutValueResponse.from_workflow_draft_variable_list(
            workflow_vars
        ).model_dump(mode="json")

    @console_ns.response(204, "Variables deleted successfully")
    @_api_prerequisite
    def delete(self, current_user: Account, pipeline: Pipeline):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        draft_var_srv.delete_user_workflow_variables(pipeline.id, user_id=current_user.id)
        db.session.commit()
        return "", 204


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/nodes/<string:node_id>/variables")
class RagPipelineNodeVariableCollectionApi(Resource):
    @console_ns.response(
        200,
        "Node variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @_api_prerequisite
    def get(self, current_user: Account, pipeline: Pipeline, node_id: str):
        validate_node_id(node_id)
        with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
            draft_var_srv = WorkflowDraftVariableService(
                session=session,
            )
            node_vars = draft_var_srv.list_node_variables(pipeline.id, node_id, user_id=current_user.id)

        return WorkflowDraftVariableListResponse.from_workflow_draft_variable_list(node_vars).model_dump(mode="json")

    @console_ns.response(204, "Node variables deleted successfully")
    @_api_prerequisite
    def delete(self, current_user: Account, pipeline: Pipeline, node_id: str):
        validate_node_id(node_id)
        srv = WorkflowDraftVariableService(db.session())
        srv.delete_node_variables(pipeline.id, node_id, user_id=current_user.id)
        db.session.commit()
        return "", 204


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>")
class RagPipelineVariableApi(Resource):
    @console_ns.response(
        200,
        "Variable retrieved successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @_api_prerequisite
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
        return WorkflowDraftVariableResponse.from_workflow_draft_variable(variable).model_dump(mode="json")

    @console_ns.response(
        200,
        "Variable updated successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @_api_prerequisite
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

        variable_id_str = str(variable_id)
        variable = draft_var_srv.get_variable(variable_id=variable_id_str)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id_str}")

        new_name = payload.name
        raw_value = payload.value
        if new_name is None and raw_value is None:
            return WorkflowDraftVariableResponse.from_workflow_draft_variable(variable).model_dump(mode="json")

        # TODO: duplication w/ controllers/console/app/workflow_draft_variable.py(L462)
        # extract if proper (need to find a better location to prevent accident
        # behavioral change)
        new_value = None
        if raw_value is not None:
            new_value_input: Any
            match variable.value_type:
                case SegmentType.FILE:
                    if not isinstance(raw_value, dict):
                        raise InvalidArgumentError(description=f"expected dict for file, got {type(raw_value)}")
                    new_value_input = build_from_mapping(
                        mapping=raw_value,
                        tenant_id=pipeline.tenant_id,
                        access_controller=_file_access_controller,
                    )
                case SegmentType.ARRAY_FILE:
                    if not isinstance(raw_value, list):
                        raise InvalidArgumentError(description=f"expected list for files, got {type(raw_value)}")
                    for index, item in enumerate(raw_value):
                        if not isinstance(item, dict):
                            raise InvalidArgumentError(
                                description=f"expected dict for files[{index}], got {type(item)}"
                            )
                    new_value_input = build_from_mappings(
                        mappings=raw_value,
                        tenant_id=pipeline.tenant_id,
                        access_controller=_file_access_controller,
                    )
                case _:
                    new_value_input = raw_value
            new_value = build_segment_with_type(variable.value_type, new_value_input)
        draft_var_srv.update_variable(variable, name=new_name, value=new_value)
        db.session.commit()
        return WorkflowDraftVariableResponse.from_workflow_draft_variable(variable).model_dump(mode="json")

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
        return "", 204


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class RagPipelineVariableResetApi(Resource):
    @console_ns.response(
        200,
        "Variable reset successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(204, "Variable reset to empty state")
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
            return "", 204
        return WorkflowDraftVariableResponse.from_workflow_draft_variable(resetted).model_dump(mode="json")


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
    @console_ns.response(
        200,
        "System variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @_api_prerequisite
    def get(self, current_user: Account, pipeline: Pipeline):
        return WorkflowDraftVariableListResponse.from_workflow_draft_variable_list(
            _get_variable_list(pipeline, SYSTEM_VARIABLE_NODE_ID, current_user.id)
        ).model_dump(mode="json")


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/environment-variables")
class RagPipelineEnvironmentVariableCollectionApi(Resource):
    @console_ns.response(
        200,
        "Environment variables retrieved successfully",
        console_ns.models[RagPipelineEnvironmentVariableListResponse.__name__],
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
        env_vars_list: list[RagPipelineEnvironmentVariableResponse] = []
        for v in env_vars:
            env_vars_list.append(
                RagPipelineEnvironmentVariableResponse(
                    id=v.id,
                    type="env",
                    name=v.name,
                    description=v.description,
                    selector=list(v.selector),
                    value_type=v.value_type.value,
                    value=v.value,
                    # Do not track edited for env vars.
                    edited=False,
                    visible=True,
                    editable=True,
                )
            )

        return RagPipelineEnvironmentVariableListResponse(items=env_vars_list).model_dump(mode="json")
