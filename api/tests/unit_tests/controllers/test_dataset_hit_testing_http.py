"""Retrieval transports share attachment validation and production error mapping."""

from collections.abc import Callable
from functools import wraps
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import create_autospec
from uuid import UUID

import pytest
from flask import Flask
from flask_restx import Resource
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from controllers.common.hit_testing import validate_hit_testing_payload
from controllers.console import api as console_api
from controllers.console.datasets import hit_testing as console_controller
from controllers.service_api.dataset import hit_testing as service_controller
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from models.dataset import DatasetQuery
from services.knowledge.hit_testing.application import HitTestingApplicationService
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse

DATASET_ID = "38cb8b13-ea36-4834-a320-14cb4f656de1"
FILE_ID = "9c603550-52be-46d6-8078-f5047c6b631c"
ROUTES = [
    f"/console/api/datasets/{DATASET_ID}/hit-testing",
    f"/v1/datasets/{DATASET_ID}/retrieve",
    f"/v1/datasets/{DATASET_ID}/hit-testing",
]


def _admitted(view: Callable[..., object]) -> Callable[..., object]:
    """Supply admitted identity while retaining the production payload validator and handler."""
    validated = validate_hit_testing_payload(unwrap(view))

    @wraps(view)
    def admitted(*args: object, **kwargs: object) -> object:
        return validated(*args, request_context=RequestContext("request", None, "account-1", "tenant-1"), **kwargs)

    return admitted


@pytest.fixture(scope="module")
def http_app() -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
    api = ExternalApi(app)
    api.error_handlers = console_api.error_handlers.copy()

    class ConsoleEndpoint(Resource):
        post = _admitted(console_controller.HitTestingApi.post)

    class ServiceEndpoint(Resource):
        post = _admitted(service_controller.HitTestingApi.post)

    api.add_resource(ConsoleEndpoint, "/console/api/datasets/<uuid:dataset_id>/hit-testing")
    api.add_resource(
        ServiceEndpoint, "/v1/datasets/<uuid:dataset_id>/retrieve", "/v1/datasets/<uuid:dataset_id>/hit-testing"
    )
    return app


@pytest.fixture
def retrieval_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    service = create_autospec(HitTestingApplicationService, instance=True, spec_set=True)
    services = SimpleNamespace(knowledge=SimpleNamespace(hit_testing=service))
    monkeypatch.setattr(console_controller, "application_services", lambda: services)
    monkeypatch.setattr(service_controller, "application_services", lambda: services)
    calls: list[dict[str, object]] = []

    def retrieve(context: RequestContext, *, dataset_id: str, request: HitTestingRequest) -> HitTestingResponse:
        assert context.active_workspace_id == "tenant-1"
        assert dataset_id == DATASET_ID
        calls.append({"query": request.query, "attachment_ids": request.attachment_ids})
        return {"query": {"content": request.query}, "records": []}

    service.retrieve.side_effect = retrieve
    return calls


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("attachments", [[""], [" "], ["not-a-uuid"], [FILE_ID, ""]])
def test_invalid_attachment_rejected_before_retrieval(
    http_app: Flask,
    retrieval_calls: list[dict[str, object]],
    sqlite_session: Session,
    route: str,
    attachments: list[str],
) -> None:
    before = sqlite_session.scalar(select(func.count()).select_from(DatasetQuery))
    response = http_app.test_client().post(route, json={"query": "", "attachment_ids": attachments})
    assert response.status_code == 400, response.get_json()
    assert response.get_json()["code"] == "invalid_param"
    assert "attachment_ids" in response.get_json()["message"]
    assert retrieval_calls == []
    assert sqlite_session.scalar(select(func.count()).select_from(DatasetQuery)) == before


@pytest.mark.parametrize("route", ROUTES)
def test_valid_attachment_only_request_reaches_retrieval(
    http_app: Flask, retrieval_calls: list[dict[str, object]], route: str
) -> None:
    response = http_app.test_client().post(route, json={"query": "", "attachment_ids": [FILE_ID.upper()]})
    assert response.status_code == 200, response.get_json()
    assert retrieval_calls[0]["attachment_ids"] == [str(UUID(FILE_ID))]
    assert retrieval_calls[0]["query"] == ""


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize(
    "payload",
    [
        {"query": "example"},
        {"query": "example", "attachment_ids": None},
        {"query": "example", "attachment_ids": []},
        {"query": "example", "attachment_ids": [FILE_ID]},
    ],
)
def test_text_query_attachment_compatibility(
    http_app: Flask, retrieval_calls: list[dict[str, object]], route: str, payload: dict[str, object]
) -> None:
    response = http_app.test_client().post(route, json=payload)
    assert response.status_code == 200, response.get_json()
    assert retrieval_calls[0]["query"] == "example"
    assert retrieval_calls[0].get("attachment_ids") == payload.get("attachment_ids")
