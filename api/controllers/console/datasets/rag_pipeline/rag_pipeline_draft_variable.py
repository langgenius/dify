import logging
from typing import NoReturn

from flask import Response
from flask_restx import Resource, fields, inputs, marshal, marshal_with, reqparse
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.app.error import (
    DraftWorkflowNotExist,
)
from controllers.console.app.workflow_draft_variable import (
    _WORKFLOW_DRAFT_VARIABLE_FIELDS,  # type: ignore[private-usage]
    _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS,  # type: ignore[private-usage]
)
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.web.error import InvalidArgumentError, NotFoundError
from core.variables.types import SegmentType
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from extensions.ext_database import db
from factories.file_factory import build_from_mapping, build_from_mappings
from factories.variable_factory import build_segment_with_type
from libs.login import current_user, login_required
from models import Account
from models.dataset import Pipeline
from models.workflow import WorkflowDraftVariable
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.workflow_draft_variable_service import WorkflowDraftVariableList, WorkflowDraftVariableService

logger = logging.getLogger(__name__)


def _create_pagination_parser():
    parser = (
        reqparse.RequestParser()
        .add_argument(
            "page",
            type=inputs.int_range(1, 100_000),
            required=False,
            default=1,
            location="args",
            help="the page of data requested",
        )
        .add_argument("limit", type=inputs.int_range(1, 100), required=False, default=20, location="args")
    )
    return parser


def _get_items(var_list: WorkflowDraftVariableList) -> list[WorkflowDraftVariable]:
    return var_list.variables


_WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS = {
    "items": fields.List(fields.Nested(_WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS), attribute=_get_items),
    "total": fields.Raw(),
}

_WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS = {
    "items": fields.List(fields.Nested(_WORKFLOW_DRAFT_VARIABLE_FIELDS), attribute=_get_items),
}


def _api_prerequisite(f):
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
    def wrapper(*args, **kwargs):
        if not isinstance(current_user, Account) or not current_user.has_edit_permission:
            raise Forbidden()
        return f(*args, **kwargs)

    return wrapper


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables")
class RagPipelineVariableCollectionApi(Resource):
    @_api_prerequisite
    @marshal_with(_WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS)
    def get(self, pipeline: Pipeline):
        """
        Get draft workflow
        """
        parser = _create_pagination_parser()
        args = parser.parse_args()

        # fetch draft workflow by app_model
        rag_pipeline_service = RagPipelineService()
        workflow_exist = rag_pipeline_service.is_workflow_exist(pipeline=pipeline)
        if not workflow_exist:
            raise DraftWorkflowNotExist()

        # fetch draft workflow by app_model
        with Session(bind=db.engine, expire_on_commit=False) as session:
            draft_var_srv = WorkflowDraftVariableService(
                session=session,
            )
        workflow_vars = draft_var_srv.list_variables_without_values(
            app_id=pipeline.id,
            page=args.page,
            limit=args.limit,
        )

        return workflow_vars

    @_api_prerequisite
    def delete(self, pipeline: Pipeline):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        draft_var_srv.delete_workflow_variables(pipeline.id)
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
    @_api_prerequisite
    @marshal_with(_WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)
    def get(self, pipeline: Pipeline, node_id: str):
        validate_node_id(node_id)
        with Session(bind=db.engine, expire_on_commit=False) as session:
            draft_var_srv = WorkflowDraftVariableService(
                session=session,
            )
            node_vars = draft_var_srv.list_node_variables(pipeline.id, node_id)

        return node_vars

    @_api_prerequisite
    def delete(self, pipeline: Pipeline, node_id: str):
        validate_node_id(node_id)
        srv = WorkflowDraftVariableService(db.session())
        srv.delete_node_variables(pipeline.id, node_id)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>")
class RagPipelineVariableApi(Resource):
    _PATCH_NAME_FIELD = "name"
    _PATCH_VALUE_FIELD = "value"

    @_api_prerequisite
    @marshal_with(_WORKFLOW_DRAFT_VARIABLE_FIELDS)
    def get(self, pipeline: Pipeline, variable_id: str):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        return variable

    @_api_prerequisite
    @marshal_with(_WORKFLOW_DRAFT_VARIABLE_FIELDS)
    def patch(self, pipeline: Pipeline, variable_id: str):
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

        parser = (
            reqparse.RequestParser()
            .add_argument(self._PATCH_NAME_FIELD, type=str, required=False, nullable=True, location="json")
            .add_argument(self._PATCH_VALUE_FIELD, type=lambda x: x, required=False, nullable=True, location="json")
        )

        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        args = parser.parse_args(strict=True)

        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")

        new_name = args.get(self._PATCH_NAME_FIELD, None)
        raw_value = args.get(self._PATCH_VALUE_FIELD, None)
        if new_name is None and raw_value is None:
            return variable

        new_value = None
        if raw_value is not None:
            if variable.value_type == SegmentType.FILE:
                if not isinstance(raw_value, dict):
                    raise InvalidArgumentError(description=f"expected dict for file, got {type(raw_value)}")
                raw_value = build_from_mapping(mapping=raw_value, tenant_id=pipeline.tenant_id)
            elif variable.value_type == SegmentType.ARRAY_FILE:
                if not isinstance(raw_value, list):
                    raise InvalidArgumentError(description=f"expected list for files, got {type(raw_value)}")
                if len(raw_value) > 0 and not isinstance(raw_value[0], dict):
                    raise InvalidArgumentError(description=f"expected dict for files[0], got {type(raw_value)}")
                raw_value = build_from_mappings(mappings=raw_value, tenant_id=pipeline.tenant_id)
            new_value = build_segment_with_type(variable.value_type, raw_value)
        draft_var_srv.update_variable(variable, name=new_name, value=new_value)
        db.session.commit()
        return variable

    @_api_prerequisite
    def delete(self, pipeline: Pipeline, variable_id: str):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        draft_var_srv.delete_variable(variable)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class RagPipelineVariableResetApi(Resource):
    @_api_prerequisite
    def put(self, pipeline: Pipeline, variable_id: str):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )

        rag_pipeline_service = RagPipelineService()
        draft_workflow = rag_pipeline_service.get_draft_workflow(pipeline=pipeline)
        if draft_workflow is None:
            raise NotFoundError(
                f"Draft workflow not found, pipeline_id={pipeline.id}",
            )
        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != pipeline.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")

        resetted = draft_var_srv.reset_variable(draft_workflow, variable)
        db.session.commit()
        if resetted is None:
            return Response("", 204)
        else:
            return marshal(resetted, _WORKFLOW_DRAFT_VARIABLE_FIELDS)


def _get_variable_list(pipeline: Pipeline, node_id) -> WorkflowDraftVariableList:
    with Session(bind=db.engine, expire_on_commit=False) as session:
        draft_var_srv = WorkflowDraftVariableService(
            session=session,
        )
        if node_id == CONVERSATION_VARIABLE_NODE_ID:
            draft_vars = draft_var_srv.list_conversation_variables(pipeline.id)
        elif node_id == SYSTEM_VARIABLE_NODE_ID:
            draft_vars = draft_var_srv.list_system_variables(pipeline.id)
        else:
            draft_vars = draft_var_srv.list_node_variables(app_id=pipeline.id, node_id=node_id)
    return draft_vars


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/system-variables")
class RagPipelineSystemVariableCollectionApi(Resource):
    @_api_prerequisite
    @marshal_with(_WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)
    def get(self, pipeline: Pipeline):
        return _get_variable_list(pipeline, SYSTEM_VARIABLE_NODE_ID)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/environment-variables")
class RagPipelineEnvironmentVariableCollectionApi(Resource):
    @_api_prerequisite
    def get(self, pipeline: Pipeline):
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
