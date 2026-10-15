from datetime import datetime

import pytest

from controllers.openapi._app_response import _EMPTY_PARAMETERS, build_app_describe_response
from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA
from models.model import AppMode
from services.app.query_service import AppDescription
from services.app_definition_query_service import AppParameterConfig
from services.entities.app_entities import AppSummary


def description(config: AppParameterConfig | None) -> AppDescription:
    return AppDescription(
        AppSummary("app-id", "tenant-id", "Demo", "d", AppMode.CHAT, "normal", datetime(2026, 1, 1), "maintainer"),
        True,
        config,
    )


def test_full_description_projects_materialized_data_without_request_or_session() -> None:
    form = [{"text-input": {"variable": "industry", "label": "Industry", "required": True}}]
    response = build_app_describe_response(description(AppParameterConfig({}, form)), None)
    assert response.info is not None
    assert response.info.model_dump() == {
        "id": "app-id",
        "name": "Demo",
        "description": "d",
        "mode": "chat",
        "updated_at": "2026-01-01T00:00:00",
        "service_api_enabled": True,
        "is_agent": False,
    }
    assert response.parameters is not None
    assert response.parameters["user_input_form"] == form
    assert response.input_schema is not None
    assert response.input_schema["properties"]["inputs"]["required"] == ["industry"]


@pytest.mark.parametrize("fields", [{"info"}, {"parameters"}, {"input_schema"}, set()])
def test_projection_honors_requested_fields_and_missing_config_fallbacks(fields: set[str]) -> None:
    response = build_app_describe_response(description(None), fields)
    assert (response.info is not None) == ("info" in fields)
    assert response.parameters == (_EMPTY_PARAMETERS if "parameters" in fields else None)
    assert response.input_schema == (EMPTY_INPUT_SCHEMA if "input_schema" in fields else None)


def test_empty_parameters_preserve_public_response_contract() -> None:
    assert _EMPTY_PARAMETERS == {
        "opening_statement": None,
        "suggested_questions": [],
        "user_input_form": [],
        "file_upload": None,
        "system_parameters": {},
    }
