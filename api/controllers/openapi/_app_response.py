"""Pure response projections for app discovery; no ORM access."""

from typing import Any

from controllers.common.fields import Parameters
from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA, build_input_schema
from controllers.openapi._models import AppDescribeInfo, AppDescribeResponse, AppListRow
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from libs.helper import dump_response
from models.model import AppMode
from services.app.query_service import AppDescription, AppDiscoveryEntry
from services.app_definition_query_service import AppParameterConfig

_EMPTY_PARAMETERS: dict[str, Any] = {
    "opening_statement": None,
    "suggested_questions": [],
    "user_input_form": [],
    "file_upload": None,
    "system_parameters": {},
}


def parameters_payload(config: AppParameterConfig) -> dict:
    """Mirrors service_api/app/app.py::AppParameterApi response body."""
    parameters = get_parameters_from_feature_dict(
        features_dict=config.features_dict, user_input_form=config.user_input_form
    )
    return dump_response(Parameters, parameters)


def build_app_describe_response(description: AppDescription, fields: set[str] | None) -> AppDescribeResponse:
    """Public projection of an app (name / params / input schema) — never internal config."""
    app = description.app
    want_info = fields is None or "info" in fields
    want_params = fields is None or "parameters" in fields
    want_schema = fields is None or "input_schema" in fields

    info = (
        AppDescribeInfo(
            id=str(app.id),
            name=app.name,
            mode=app.mode,
            description=app.description,
            updated_at=app.updated_at.isoformat() if app.updated_at else None,
            service_api_enabled=description.service_api_enabled,
            is_agent=app.mode in (AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT),
        )
        if want_info
        else None
    )

    parameters: dict[str, Any] | None = None
    input_schema: dict[str, Any] | None = None
    if want_params:
        parameters = (
            parameters_payload(description.config) if description.config is not None else dict(_EMPTY_PARAMETERS)
        )
    if want_schema:
        input_schema = (
            build_input_schema(app.mode, description.config.user_input_form)
            if description.config is not None
            else dict(EMPTY_INPUT_SCHEMA)
        )

    return AppDescribeResponse(info=info, parameters=parameters, input_schema=input_schema)


def app_list_row(entry: AppDiscoveryEntry) -> AppListRow:
    app = entry.app
    return AppListRow(
        id=app.id,
        name=app.name,
        description=app.description,
        mode=app.mode,
        updated_at=app.updated_at.isoformat() if app.updated_at else None,
        workspace_id=app.tenant_id,
        workspace_name=entry.workspace_name,
    )
