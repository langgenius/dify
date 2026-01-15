import logging
from collections.abc import Callable
from functools import wraps
from typing import Any, NoReturn, ParamSpec, TypeVar

from flask import Response, request
from flask_restx import Resource, fields, marshal, marshal_with
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.app.error import (
    DraftWorkflowNotExist,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from controllers.web.error import InvalidArgumentError, NotFoundError
from core.file import helpers as file_helpers
from core.variables.segment_group import SegmentGroup
from core.variables.segments import ArrayFileSegment, FileSegment, Segment
from core.variables.types import SegmentType
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from extensions.ext_database import db
from factories.file_factory import build_from_mapping, build_from_mappings
from factories.variable_factory import build_segment_with_type
from libs.login import login_required
from models import App, AppMode
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import WorkflowDraftVariableList, WorkflowDraftVariableService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class WorkflowDraftVariableListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=100_000, description="Page number")
    limit: int = Field(default=20, ge=1, le=100, description="Items per page")


class WorkflowDraftVariableUpdatePayload(BaseModel):
    name: str | None = Field(default=None, description="Variable name")
    value: Any | None = Field(default=None, description="Variable value")


console_ns.schema_model(
    WorkflowDraftVariableListQuery.__name__,
    WorkflowDraftVariableListQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)
console_ns.schema_model(
    WorkflowDraftVariableUpdatePayload.__name__,
    WorkflowDraftVariableUpdatePayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


def _convert_values_to_json_serializable_object(value: Segment):
    if isinstance(value, FileSegment):
        return value.value.model_dump()
    elif isinstance(value, ArrayFileSegment):
        return [i.model_dump() for i in value.value]
    elif isinstance(value, SegmentGroup):
        return [_convert_values_to_json_serializable_object(i) for i in value.value]
    else:
        return value.value


def _serialize_var_value(variable: WorkflowDraftVariable):
    value = variable.get_value()
    # create a copy of the value to avoid affecting the model cache.
    value = value.model_copy(deep=True)
    # Refresh the url signature before returning it to client.
    if isinstance(value, FileSegment):
        file = value.value
        file.remote_url = file.generate_url()
    elif isinstance(value, ArrayFileSegment):
        files = value.value
        for file in files:
            file.remote_url = file.generate_url()
    return _convert_values_to_json_serializable_object(value)


def _serialize_variable_type(workflow_draft_var: WorkflowDraftVariable) -> str:
    value_type = workflow_draft_var.value_type
    return value_type.exposed_type().value


def _serialize_full_content(variable: WorkflowDraftVariable) -> dict | None:
    """Serialize full_content information for large variables."""
    if not variable.is_truncated():
        return None

    variable_file = variable.variable_file
    assert variable_file is not None

    return {
        "size_bytes": variable_file.size,
        "value_type": variable_file.value_type.exposed_type().value,
        "length": variable_file.length,
        "download_url": file_helpers.get_signed_file_url(variable_file.upload_file_id, as_attachment=True),
    }


_WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS = {
    "id": fields.String,
    "type": fields.String(attribute=lambda model: model.get_variable_type()),
    "name": fields.String,
    "description": fields.String,
    "selector": fields.List(fields.String, attribute=lambda model: model.get_selector()),
    "value_type": fields.String(attribute=_serialize_variable_type),
    "edited": fields.Boolean(attribute=lambda model: model.edited),
    "visible": fields.Boolean,
    "is_truncated": fields.Boolean(attribute=lambda model: model.file_id is not None),
}

_WORKFLOW_DRAFT_VARIABLE_FIELDS = dict(
    _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS,
    value=fields.Raw(attribute=_serialize_var_value),
    full_content=fields.Raw(attribute=_serialize_full_content),
)

_WORKFLOW_DRAFT_ENV_VARIABLE_FIELDS = {
    "id": fields.String,
    "type": fields.String(attribute=lambda _: "env"),
    "name": fields.String,
    "description": fields.String,
    "selector": fields.List(fields.String, attribute=lambda model: model.get_selector()),
    "value_type": fields.String(attribute=_serialize_variable_type),
    "edited": fields.Boolean(attribute=lambda model: model.edited),
    "visible": fields.Boolean,
}

_WORKFLOW_DRAFT_ENV_VARIABLE_LIST_FIELDS = {
    "items": fields.List(fields.Nested(_WORKFLOW_DRAFT_ENV_VARIABLE_FIELDS)),
}


def _get_items(var_list: WorkflowDraftVariableList) -> list[WorkflowDraftVariable]:
    return var_list.variables


_WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS = {
    "items": fields.List(fields.Nested(_WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS), attribute=_get_items),
    "total": fields.Raw(),
}

_WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS = {
    "items": fields.List(fields.Nested(_WORKFLOW_DRAFT_VARIABLE_FIELDS), attribute=_get_items),
}

# Register models for flask_restx to avoid dict type issues in Swagger
workflow_draft_variable_without_value_model = console_ns.model(
    "WorkflowDraftVariableWithoutValue", _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS
)

workflow_draft_variable_model = console_ns.model("WorkflowDraftVariable", _WORKFLOW_DRAFT_VARIABLE_FIELDS)

workflow_draft_env_variable_model = console_ns.model("WorkflowDraftEnvVariable", _WORKFLOW_DRAFT_ENV_VARIABLE_FIELDS)

workflow_draft_env_variable_list_fields_copy = _WORKFLOW_DRAFT_ENV_VARIABLE_LIST_FIELDS.copy()
workflow_draft_env_variable_list_fields_copy["items"] = fields.List(fields.Nested(workflow_draft_env_variable_model))
workflow_draft_env_variable_list_model = console_ns.model(
    "WorkflowDraftEnvVariableList", workflow_draft_env_variable_list_fields_copy
)

workflow_draft_variable_list_without_value_fields_copy = _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS.copy()
workflow_draft_variable_list_without_value_fields_copy["items"] = fields.List(
    fields.Nested(workflow_draft_variable_without_value_model), attribute=_get_items
)
workflow_draft_variable_list_without_value_model = console_ns.model(
    "WorkflowDraftVariableListWithoutValue", workflow_draft_variable_list_without_value_fields_copy
)

workflow_draft_variable_list_fields_copy = _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS.copy()
workflow_draft_variable_list_fields_copy["items"] = fields.List(
    fields.Nested(workflow_draft_variable_model), attribute=_get_items
)
workflow_draft_variable_list_model = console_ns.model(
    "WorkflowDraftVariableList", workflow_draft_variable_list_fields_copy
)

P = ParamSpec("P")
R = TypeVar("R")


def _api_prerequisite(f: Callable[P, R]):
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
    @edit_permission_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @wraps(f)
    def wrapper(*args: P.args, **kwargs: P.kwargs):
        return f(*args, **kwargs)

    return wrapper


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/variables")
class WorkflowVariableCollectionApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowDraftVariableListQuery.__name__])
    @console_ns.doc("get_workflow_variables")
    @console_ns.doc(description="Get draft workflow variables")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params={"page": "Page number (1-100000)", "limit": "Number of items per page (1-100)"})
    @console_ns.response(
        200, "Workflow variables retrieved successfully", workflow_draft_variable_list_without_value_model
    )
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_list_without_value_model)
    def get(self, app_model: App):
        """
        Get draft workflow
        """
        args = WorkflowDraftVariableListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        # fetch draft workflow by app_model
        workflow_service = WorkflowService()
        workflow_exist = workflow_service.is_workflow_exist(app_model=app_model)
        if not workflow_exist:
            raise DraftWorkflowNotExist()

        # fetch draft workflow by app_model
        with Session(bind=db.engine, expire_on_commit=False) as session:
            draft_var_srv = WorkflowDraftVariableService(
                session=session,
            )
            workflow_vars = draft_var_srv.list_variables_without_values(
                app_id=app_model.id,
                page=args.page,
                limit=args.limit,
            )

        return workflow_vars

    @console_ns.doc("delete_workflow_variables")
    @console_ns.doc(description="Delete all draft workflow variables")
    @console_ns.response(204, "Workflow variables deleted successfully")
    @_api_prerequisite
    def delete(self, app_model: App):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        draft_var_srv.delete_workflow_variables(app_model.id)
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


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/variables")
class NodeVariableCollectionApi(Resource):
    @console_ns.doc("get_node_variables")
    @console_ns.doc(description="Get variables for a specific node")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.response(200, "Node variables retrieved successfully", workflow_draft_variable_list_model)
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, app_model: App, node_id: str):
        validate_node_id(node_id)
        with Session(bind=db.engine, expire_on_commit=False) as session:
            draft_var_srv = WorkflowDraftVariableService(
                session=session,
            )
            node_vars = draft_var_srv.list_node_variables(app_model.id, node_id)

        return node_vars

    @console_ns.doc("delete_node_variables")
    @console_ns.doc(description="Delete all variables for a specific node")
    @console_ns.response(204, "Node variables deleted successfully")
    @_api_prerequisite
    def delete(self, app_model: App, node_id: str):
        validate_node_id(node_id)
        srv = WorkflowDraftVariableService(db.session())
        srv.delete_node_variables(app_model.id, node_id)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>")
class VariableApi(Resource):
    _PATCH_NAME_FIELD = "name"
    _PATCH_VALUE_FIELD = "value"

    @console_ns.doc("get_variable")
    @console_ns.doc(description="Get a specific workflow variable")
    @console_ns.doc(params={"app_id": "Application ID", "variable_id": "Variable ID"})
    @console_ns.response(200, "Variable retrieved successfully", workflow_draft_variable_model)
    @console_ns.response(404, "Variable not found")
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_model)
    def get(self, app_model: App, variable_id: str):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != app_model.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        return variable

    @console_ns.doc("update_variable")
    @console_ns.doc(description="Update a workflow variable")
    @console_ns.expect(console_ns.models[WorkflowDraftVariableUpdatePayload.__name__])
    @console_ns.response(200, "Variable updated successfully", workflow_draft_variable_model)
    @console_ns.response(404, "Variable not found")
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_model)
    def patch(self, app_model: App, variable_id: str):
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
        args_model = WorkflowDraftVariableUpdatePayload.model_validate(console_ns.payload or {})

        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != app_model.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")

        new_name = args_model.name
        raw_value = args_model.value
        if new_name is None and raw_value is None:
            return variable

        new_value = None
        if raw_value is not None:
            if variable.value_type == SegmentType.FILE:
                if not isinstance(raw_value, dict):
                    raise InvalidArgumentError(description=f"expected dict for file, got {type(raw_value)}")
                raw_value = build_from_mapping(mapping=raw_value, tenant_id=app_model.tenant_id)
            elif variable.value_type == SegmentType.ARRAY_FILE:
                if not isinstance(raw_value, list):
                    raise InvalidArgumentError(description=f"expected list for files, got {type(raw_value)}")
                if len(raw_value) > 0 and not isinstance(raw_value[0], dict):
                    raise InvalidArgumentError(description=f"expected dict for files[0], got {type(raw_value)}")
                raw_value = build_from_mappings(mappings=raw_value, tenant_id=app_model.tenant_id)
            new_value = build_segment_with_type(variable.value_type, raw_value)
        draft_var_srv.update_variable(variable, name=new_name, value=new_value)
        db.session.commit()
        return variable

    @console_ns.doc("delete_variable")
    @console_ns.doc(description="Delete a workflow variable")
    @console_ns.response(204, "Variable deleted successfully")
    @console_ns.response(404, "Variable not found")
    @_api_prerequisite
    def delete(self, app_model: App, variable_id: str):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )
        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != app_model.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        draft_var_srv.delete_variable(variable)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class VariableResetApi(Resource):
    @console_ns.doc("reset_variable")
    @console_ns.doc(description="Reset a workflow variable to its default value")
    @console_ns.doc(params={"app_id": "Application ID", "variable_id": "Variable ID"})
    @console_ns.response(200, "Variable reset successfully", workflow_draft_variable_model)
    @console_ns.response(204, "Variable reset (no content)")
    @console_ns.response(404, "Variable not found")
    @_api_prerequisite
    def put(self, app_model: App, variable_id: str):
        draft_var_srv = WorkflowDraftVariableService(
            session=db.session(),
        )

        workflow_srv = WorkflowService()
        draft_workflow = workflow_srv.get_draft_workflow(app_model)
        if draft_workflow is None:
            raise NotFoundError(
                f"Draft workflow not found, app_id={app_model.id}",
            )
        variable = draft_var_srv.get_variable(variable_id=variable_id)
        if variable is None:
            raise NotFoundError(description=f"variable not found, id={variable_id}")
        if variable.app_id != app_model.id:
            raise NotFoundError(description=f"variable not found, id={variable_id}")

        resetted = draft_var_srv.reset_variable(draft_workflow, variable)
        db.session.commit()
        if resetted is None:
            return Response("", 204)
        else:
            return marshal(resetted, workflow_draft_variable_model)


def _get_variable_list(app_model: App, node_id) -> WorkflowDraftVariableList:
    with Session(bind=db.engine, expire_on_commit=False) as session:
        draft_var_srv = WorkflowDraftVariableService(
            session=session,
        )
        if node_id == CONVERSATION_VARIABLE_NODE_ID:
            draft_vars = draft_var_srv.list_conversation_variables(app_model.id)
        elif node_id == SYSTEM_VARIABLE_NODE_ID:
            draft_vars = draft_var_srv.list_system_variables(app_model.id)
        else:
            draft_vars = draft_var_srv.list_node_variables(app_id=app_model.id, node_id=node_id)
    return draft_vars


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/conversation-variables")
class ConversationVariableCollectionApi(Resource):
    @console_ns.doc("get_conversation_variables")
    @console_ns.doc(description="Get conversation variables for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Conversation variables retrieved successfully", workflow_draft_variable_list_model)
    @console_ns.response(404, "Draft workflow not found")
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, app_model: App):
        # NOTE(QuantumGhost): Prefill conversation variables into the draft variables table
        # so their IDs can be returned to the caller.
        workflow_srv = WorkflowService()
        draft_workflow = workflow_srv.get_draft_workflow(app_model)
        if draft_workflow is None:
            raise NotFoundError(description=f"draft workflow not found, id={app_model.id}")
        draft_var_srv = WorkflowDraftVariableService(db.session())
        draft_var_srv.prefill_conversation_variable_default_values(draft_workflow)
        db.session.commit()
        return _get_variable_list(app_model, CONVERSATION_VARIABLE_NODE_ID)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/system-variables")
class SystemVariableCollectionApi(Resource):
    @console_ns.doc("get_system_variables")
    @console_ns.doc(description="Get system variables for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "System variables retrieved successfully", workflow_draft_variable_list_model)
    @_api_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, app_model: App):
        return _get_variable_list(app_model, SYSTEM_VARIABLE_NODE_ID)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/environment-variables")
class EnvironmentVariableCollectionApi(Resource):
    @console_ns.doc("get_environment_variables")
    @console_ns.doc(description="Get environment variables for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Environment variables retrieved successfully")
    @console_ns.response(404, "Draft workflow not found")
    @_api_prerequisite
    def get(self, app_model: App):
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model=app_model)
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
                    "value_type": v.value_type.exposed_type().value,
                    "value": v.value,
                    # Do not track edited for env vars.
                    "edited": False,
                    "visible": True,
                    "editable": True,
                }
            )

        return {"items": env_vars_list}
