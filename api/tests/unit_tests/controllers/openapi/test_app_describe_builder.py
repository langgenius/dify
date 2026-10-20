from collections.abc import Callable
from datetime import datetime
from typing import Protocol, cast

import pytest
from flask import Flask

from controllers.openapi._app_response import _EMPTY_PARAMETERS, build_app_describe_response
from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA
from controllers.openapi._models import AppDescribeQuery, AppDescribeResponse
from controllers.openapi.apps import AppDescribeApi, settings_hints
from controllers.openapi.auth.requirements import CheckWebAppAuthEnterprise
from machinery.context import AppRequestContext
from models.model import AppMode
from services.app.query_service import AppDescription
from services.app_definition_query_service import AppParameterConfig
from services.entities.app_entities import AppSummary
from tests.unit_tests.controllers.conftest import ControllerTestServices


class Endpoint[T](Protocol):
    __handler__: Callable[..., T]


def description(config: AppParameterConfig | None, mode: str = AppMode.CHAT) -> AppDescription:
    return AppDescription(
        AppSummary(
            "app-id", "tenant-id", "Demo", "d", cast(AppMode, mode), "normal", datetime(2026, 1, 1), "maintainer"
        ),
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


def test_settings_hints_name_the_mode_ops(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(CheckWebAppAuthEnterprise, "available", staticmethod(lambda: True))
    ops = [hint.op for hint in settings_hints("app-1", AppMode.WORKFLOW)]
    assert ops == [
        "describe.app_info.workflow",
        "describe.webapp.workflow",
        "describe.service_api",
        "describe.webapp_access",
    ]
    agent_ops = [hint.op for hint in settings_hints("app-1", AppMode.AGENT)]
    assert agent_ops == [
        "describe.app_info.agent",
        "describe.webapp.agent",
        "describe.service_api.agent",
        "describe.webapp_access.agent",
    ]
    assert all(hint.input == {"app_id": "app-1"} for hint in settings_hints("app-1", AppMode.CHAT))


def test_settings_hints_skip_web_app_access_without_web_app_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(CheckWebAppAuthEnterprise, "available", staticmethod(lambda: False))
    ops = [hint.op for hint in settings_hints("app-1", AppMode.WORKFLOW)]
    assert "describe.webapp_access" not in ops
    assert ops


def test_shared_builder_adds_no_hints() -> None:
    """The builder also serves describe.console_app.external, whose callers can't use account-only settings ops."""
    assert build_app_describe_response(description(None), None).hints == []


def _describe(
    app: Flask, services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch, mode: str
) -> AppDescribeResponse:
    monkeypatch.setattr(services.apps.discovery, "describe", lambda *_args: description(None, mode))
    api = AppDescribeApi()
    with app.test_request_context():
        return cast(Endpoint[AppDescribeResponse], api.get).__handler__(
            api, AppRequestContext(tenant_id="tenant-id", app_id="app-id"), "app-id", query=AppDescribeQuery()
        )


def test_account_describe_adds_settings_hints(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    resp = _describe(app, app_query_services, monkeypatch, AppMode.CHAT)
    assert [hint.op for hint in resp.hints] == [hint.op for hint in settings_hints("app-id", AppMode.CHAT)]
    assert resp.hints


def test_account_describe_unknown_mode_has_no_hints(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    resp = _describe(app, app_query_services, monkeypatch, "mode-from-a-newer-version")
    assert resp.hints == []
    assert resp.info is not None
