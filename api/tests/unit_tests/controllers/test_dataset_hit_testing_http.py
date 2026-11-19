"""The three retrieval routes share attachment validation and production error mapping."""

from collections.abc import Callable
from functools import wraps
from uuid import UUID

import pytest
from flask import Blueprint, Flask
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from controllers.console import api as console_api
from controllers.console import console_ns
from controllers.console.datasets.hit_testing_base import DatasetsHitTestingBase
from controllers.service_api import api as service_api
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DatasetApiResource
from enums import DeploymentEdition
from libs.external_api import ExternalApi
from models.account import Account, Tenant
from models.dataset import Dataset, DatasetQuery
from models.enums import ApiTokenType
from models.model import ApiToken

DATASET_ID = "38cb8b13-ea36-4834-a320-14cb4f656de1"
FILE_ID = "9c603550-52be-46d6-8078-f5047c6b631c"
ROUTES = [
    f"/console/api/datasets/{DATASET_ID}/hit-testing",
    f"/v1/datasets/{DATASET_ID}/retrieve",
    f"/v1/datasets/{DATASET_ID}/hit-testing",
]


@pytest.fixture(scope="module")
def http_app() -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False, LOGIN_DISABLED=True)
    console = ExternalApi(app)
    console.error_handlers = console_api.error_handlers.copy()
    console.add_namespace(console_ns, path="/console/api")
    # Separate API instances retain each surface's own production error handlers.

    bp = Blueprint("retrieval_service_test", __name__)
    service = ExternalApi(bp, register_default_root=False)
    service.error_handlers = service_api.error_handlers.copy()
    service.add_namespace(service_api_ns, path="/v1")
    app.register_blueprint(bp)
    return app


@pytest.fixture
def retrieval_calls(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], sqlite_session: Session
) -> list[dict[str, object]]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, RBAC_ENABLED=False, LOGIN_DISABLED=True)
    account = Account(name="Test", email="retrieval@example.com")
    tenant = Tenant(name="Test")
    tenant.id = "tenant-1"
    account._current_tenant = tenant
    dataset = Dataset(id=DATASET_ID, tenant_id=tenant.id, name="Test", created_by="actor")
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: (account, tenant.id))
    monkeypatch.setattr("controllers.console.wraps.check_knowledge_rate_limit", lambda: None)
    monkeypatch.setattr("controllers.common.session.session_factory.create_session", lambda: sqlite_session)
    token = ApiToken(type=ApiTokenType.DATASET, tenant_id=tenant.id, token="test-token")
    monkeypatch.setattr("controllers.service_api.wraps.validate_and_get_api_token", lambda _kind: token)
    monkeypatch.setattr("controllers.service_api.wraps.check_knowledge_rate_limit", lambda _token: None)

    def admit_dataset(view: Callable[..., object]) -> Callable[..., object]:
        @wraps(view)
        def admitted(*args: object, **kwargs: object) -> object:
            return view(*args, tenant_id=tenant.id, **kwargs)

        return admitted

    monkeypatch.setattr(DatasetApiResource, "method_decorators", [admit_dataset])
    monkeypatch.setattr(DatasetsHitTestingBase, "get_and_validate_dataset", staticmethod(lambda *_args: dataset))
    calls: list[dict[str, object]] = []

    def retrieve(
        _session: Session, _dataset: Dataset, args: dict[str, object], *_identity: object
    ) -> dict[str, object]:
        calls.append(args)
        return {"query": {"content": args["query"]}, "records": []}

    monkeypatch.setattr(DatasetsHitTestingBase, "perform_hit_testing", staticmethod(retrieve))
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
