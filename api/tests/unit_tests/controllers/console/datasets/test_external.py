from dataclasses import dataclass
from inspect import unwrap
from typing import cast
from unittest.mock import Mock, create_autospec
from uuid import UUID

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_restx import Resource
from flask_restx.swagger import Swagger

from constants import HIDDEN_VALUE
from controllers.common.errors import ConflictError, InternalServerError, NotFoundError
from controllers.common.rbac import RBACPermission
from controllers.console import flask_admission, wraps
from controllers.console.datasets import external as controller
from controllers.console.datasets.error import DatasetAccessDeniedRequestError, DatasetNameDuplicateError
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from libs.external_api import ExternalApi
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account
from services.enterprise.rbac_service import RBACService
from services.errors.dataset import DatasetNameDuplicateError as DuplicateName
from services.errors.knowledge_retrieval import (
    ExternalTemplateConcurrentUpdateError,
    ExternalTemplateNotFoundError,
)
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.external.application import (
    ExternalHitTestingError,
    ExternalKnowledgeApplicationService,
)

CONTEXT = RequestContext("request-1", None, "actor-1", "tenant-1")
ID = UUID(int=1)
REAL_API_KEY = "real-provider-secret"


@dataclass
class AdmittedAccount:
    id: str
    role: TenantAccountRole
    status: str = "active"


@dataclass(frozen=True)
class TemplateRoutes:
    client: FlaskClient
    account: AdmittedAccount
    external: Mock
    api: ExternalApi


def _template_result(api_key: str = REAL_API_KEY) -> dict[str, object]:
    return {
        "id": str(ID),
        "name": "API",
        "tenant_id": "tenant-1",
        "settings": {"endpoint": "https://example", "api_key": api_key},
        "description": "",
        "created_by": "actor-1",
        "created_at": "2024-01-01T00:00:00",
        "dataset_bindings": [],
    }


@dataclass(frozen=True)
class _KnowledgeServices:
    external: ExternalKnowledgeApplicationService


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


@pytest.fixture
def external(monkeypatch):
    service = create_autospec(ExternalKnowledgeApplicationService, instance=True, spec_set=True)
    monkeypatch.setattr(controller, "application_services", lambda: _ApplicationServices(_KnowledgeServices(service)))
    return service


@pytest.fixture
def template_routes(monkeypatch, config_overrides, external) -> TemplateRoutes:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=True,
        RBAC_ENABLED=False,
    )
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
    api = ExternalApi(app)
    api.models.update(controller.console_ns.models)
    api.add_resource(controller.ExternalApiTemplateListApi, "/templates")
    api.add_resource(controller.ExternalApiTemplateApi, "/templates/<uuid:external_knowledge_api_id>")
    api.add_resource(controller.ExternalKnowledgeHitTestingApi, "/datasets/<uuid:dataset_id>/external-hit-testing")

    account = AdmittedAccount(id="actor-1", role=TenantAccountRole.OWNER)
    identity = AccountWithTenant(account=cast("Account", account), tenant_id="tenant-1")
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
    return TemplateRoutes(app.test_client(), account, external, api)


def test_templates_preserve_pagination(external):
    page = {"data": [], "total": 0, "has_more": False, "page": 1, "limit": 100}
    external.list_templates.return_value = page
    result = unwrap(controller.ExternalApiTemplateListApi.get)(
        controller.ExternalApiTemplateListApi(),
        controller.ExternalApiTemplateListQuery(page=0, limit=1000, keyword="test"),
        CONTEXT,
    )
    assert result == (page, 200)
    external.list_templates.assert_called_once_with(CONTEXT, page=0, limit=1000, keyword="test")


@pytest.mark.parametrize(
    ("resource", "verb", "operation", "payload"),
    [
        (
            controller.ExternalApiTemplateListApi,
            controller.ExternalApiTemplateListApi.post,
            lambda service: service.create_template,
            True,
        ),
        (
            controller.ExternalApiTemplateApi,
            controller.ExternalApiTemplateApi.get,
            lambda service: service.get_template,
            False,
        ),
        (
            controller.ExternalApiTemplateApi,
            controller.ExternalApiTemplateApi.patch,
            lambda service: service.update_template,
            True,
        ),
        (
            controller.ExternalApiTemplateApi,
            controller.ExternalApiTemplateApi.delete,
            lambda service: service.delete_template,
            False,
        ),
    ],
)
def test_template_missing_is_mapped_and_context_forwarded(external, resource, verb, operation, payload):
    method = operation(external)
    method.side_effect = ExternalTemplateNotFoundError("API template not found.")
    args = (
        [
            controller.ExternalKnowledgeApiPayload(
                name="API", settings={"endpoint": "https://example", "api_key": "secret"}
            )
        ]
        if payload
        else []
    )
    args.append(CONTEXT)
    if resource is controller.ExternalApiTemplateApi:
        args.append(ID)
    with pytest.raises(NotFoundError):
        unwrap(verb)(resource(), *args)
    assert method.call_args.args == (CONTEXT,)
    if resource is controller.ExternalApiTemplateApi:
        assert method.call_args.kwargs["template_id"] == str(ID)


def test_template_http_responses_mask_api_key(external):
    template = _template_result()
    external.list_templates.return_value = {
        "data": [template],
        "total": 1,
        "has_more": False,
        "page": 1,
        "limit": 20,
    }
    external.get_template.return_value = template
    external.create_template.return_value = template
    external.update_template.return_value = template

    app = Flask(__name__)
    api = ExternalApi(app)

    class TemplateListResource(Resource):
        def get(self):
            return unwrap(controller.ExternalApiTemplateListApi.get)(
                controller.ExternalApiTemplateListApi(),
                controller.ExternalApiTemplateListQuery(),
                CONTEXT,
            )

        def post(self):
            return unwrap(controller.ExternalApiTemplateListApi.post)(
                controller.ExternalApiTemplateListApi(),
                controller.ExternalKnowledgeApiPayload(
                    name="API", settings={"endpoint": "https://example", "api_key": REAL_API_KEY}
                ),
                CONTEXT,
            )

    class TemplateResource(Resource):
        def get(self):
            return unwrap(controller.ExternalApiTemplateApi.get)(controller.ExternalApiTemplateApi(), CONTEXT, ID)

        def patch(self):
            return unwrap(controller.ExternalApiTemplateApi.patch)(
                controller.ExternalApiTemplateApi(),
                controller.ExternalKnowledgeApiPayload(
                    name="API", settings={"endpoint": "https://example", "api_key": HIDDEN_VALUE}
                ),
                CONTEXT,
                ID,
            )

    api.add_resource(TemplateListResource, "/templates")
    api.add_resource(TemplateResource, "/templates/template")
    client = app.test_client()

    responses = [
        (client.get("/templates"), True),
        (client.post("/templates"), False),
        (client.get("/templates/template"), False),
        (client.patch("/templates/template"), False),
    ]
    for response, is_list in responses:
        payload = response.get_json()
        assert response.status_code in {200, 201}
        assert payload is not None
        serialized_template = payload["data"][0] if is_list else payload
        assert serialized_template["settings"]["api_key"] == HIDDEN_VALUE
        assert REAL_API_KEY not in response.get_data(as_text=True)

    assert template["settings"] == {"endpoint": "https://example", "api_key": REAL_API_KEY}


def test_template_concurrent_update_is_mapped_to_conflict(external) -> None:
    external.update_template.side_effect = ExternalTemplateConcurrentUpdateError("Please retry.")

    with pytest.raises(ConflictError):
        unwrap(controller.ExternalApiTemplateApi.patch)(
            controller.ExternalApiTemplateApi(),
            controller.ExternalKnowledgeApiPayload(
                name="API", settings={"endpoint": "https://example", "api_key": HIDDEN_VALUE}
            ),
            CONTEXT,
            ID,
        )


def test_template_concurrent_update_uses_standard_conflict_response(template_routes: TemplateRoutes) -> None:
    template_routes.external.update_template.side_effect = ExternalTemplateConcurrentUpdateError("Please retry.")

    response = template_routes.client.patch(
        f"/templates/{ID}",
        json={"name": "API", "settings": {"endpoint": "https://example", "api_key": HIDDEN_VALUE}},
    )

    assert response.status_code == 409
    assert response.get_json() == {"code": "conflict", "message": "Please retry.", "status": 409}


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/templates"),
        ("PATCH", f"/templates/{ID}"),
        ("DELETE", f"/templates/{ID}"),
    ],
)
def test_template_mutations_reject_roles_without_external_connect_permission(
    template_routes: TemplateRoutes,
    method: str,
    path: str,
) -> None:
    template_routes.account.role = TenantAccountRole.NORMAL

    response = template_routes.client.open(
        path,
        method=method,
        json={"name": "API", "settings": {"endpoint": "https://example", "api_key": REAL_API_KEY}},
    )

    assert response.status_code == 403
    assert template_routes.external.mock_calls == []


@pytest.mark.parametrize(
    ("method", "path", "expected_status"),
    [
        ("POST", "/templates", 201),
        ("PATCH", f"/templates/{ID}", 200),
        ("DELETE", f"/templates/{ID}", 204),
    ],
)
def test_template_mutations_allow_dataset_operator_without_rbac(
    template_routes: TemplateRoutes,
    method: str,
    path: str,
    expected_status: int,
) -> None:
    template_routes.account.role = TenantAccountRole.DATASET_OPERATOR
    template_routes.external.create_template.return_value = _template_result()
    template_routes.external.update_template.return_value = _template_result()

    response = template_routes.client.open(
        path,
        method=method,
        json={"name": "API", "settings": {"endpoint": "https://example", "api_key": REAL_API_KEY}},
    )

    assert response.status_code == expected_status


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/templates"),
        ("PATCH", f"/templates/{ID}"),
        ("DELETE", f"/templates/{ID}"),
    ],
)
def test_template_mutations_enforce_external_connect_rbac(
    template_routes: TemplateRoutes,
    config_overrides,
    monkeypatch,
    method: str,
    path: str,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    check_access = create_autospec(RBACService.CheckAccess.check, return_value=False)
    monkeypatch.setattr(RBACService.CheckAccess, "check", check_access)

    response = template_routes.client.open(
        path,
        method=method,
        json={"name": "API", "settings": {"endpoint": "https://example", "api_key": REAL_API_KEY}},
    )

    assert response.status_code == 403
    check_access.assert_called_once_with(
        "tenant-1",
        "actor-1",
        scene=RBACPermission.DATASET_EXTERNAL_CONNECT,
        resource_type=None,
        resource_id=None,
    )
    assert template_routes.external.mock_calls == []


def test_delete_and_usage_response_contracts(external):
    assert unwrap(controller.ExternalApiTemplateApi.delete)(controller.ExternalApiTemplateApi(), CONTEXT, ID) == (
        "",
        204,
    )
    external.template_usage.return_value = (True, 3)
    assert unwrap(controller.ExternalApiUseCheckApi.get)(controller.ExternalApiUseCheckApi(), CONTEXT, ID) == (
        {"is_using": True, "count": 3},
        200,
    )


def test_external_dataset_duplicate_name_maps_to_409(external):
    payload = controller.ExternalDatasetCreatePayload(
        name="Dataset", external_knowledge_api_id="api", external_knowledge_id="knowledge"
    )
    external.create_dataset.side_effect = DuplicateName()
    with pytest.raises(DatasetNameDuplicateError):
        unwrap(controller.ExternalDatasetCreateApi.post)(controller.ExternalDatasetCreateApi(), payload, CONTEXT)
    external.create_dataset.assert_called_once_with(CONTEXT, payload=payload)


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (DatasetNotFoundError(), NotFoundError),
        (DatasetAccessDeniedError(), DatasetAccessDeniedRequestError),
        (ExternalHitTestingError("failed"), InternalServerError),
    ],
)
def test_retrieval_maps_application_errors(external, error, http_error):
    external.hit_testing.side_effect = error
    with pytest.raises(http_error):
        unwrap(controller.ExternalKnowledgeHitTestingApi.post)(
            controller.ExternalKnowledgeHitTestingApi(),
            controller.ExternalHitTestingPayload(query="query"),
            CONTEXT,
            ID,
        )
    external.hit_testing.assert_called_once_with(
        CONTEXT, dataset_id=str(ID), query="query", retrieval_model=None, metadata_filters=None
    )


def test_retrieval_response_is_serialized(external):
    external.hit_testing.return_value = {
        "query": {"content": "query"},
        "records": [{"content": "answer", "title": "title", "score": 0.8, "metadata": {"source": "doc"}}],
    }
    result = unwrap(controller.ExternalKnowledgeHitTestingApi.post)(
        controller.ExternalKnowledgeHitTestingApi(), controller.ExternalHitTestingPayload(query="query"), CONTEXT, ID
    )
    assert result == external.hit_testing.return_value


def test_hit_testing_access_denial_matches_the_actual_route_contract(template_routes: TemplateRoutes) -> None:
    template_routes.external.hit_testing.side_effect = DatasetAccessDeniedError()

    response = template_routes.client.post(f"/datasets/{ID}/external-hit-testing", json={"query": "query"})

    assert response.status_code == 403
    assert response.get_json()["code"] == "dataset_access_denied"
    with template_routes.client.application.test_request_context():
        document = Swagger(template_routes.api).as_dict()
    responses = document["paths"]["/datasets/{dataset_id}/external-hit-testing"]["post"]["responses"]
    assert "409" not in responses
    schema = responses["403"]["content"]["application/json"]["schema"]
    assert {"$ref": "#/components/schemas/DatasetAccessDeniedError"} in schema["anyOf"]


def test_template_serializes_settings_and_timestamp(external):
    external.get_template.return_value = {
        "id": str(ID),
        "name": "API",
        "tenant_id": "tenant-1",
        "settings": {"endpoint": "https://example", "api_key": "[__HIDDEN__]"},
        "description": "",
        "created_by": "actor-1",
        "created_at": "2024-01-01T00:00:00",
        "dataset_bindings": [],
    }
    result, status = unwrap(controller.ExternalApiTemplateApi.get)(controller.ExternalApiTemplateApi(), CONTEXT, ID)
    assert status == 200
    assert result == external.get_template.return_value
