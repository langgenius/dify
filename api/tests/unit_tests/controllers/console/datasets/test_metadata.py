"""Console metadata routes use admission, explicit context, and response models."""

from collections.abc import Callable
from dataclasses import dataclass
from unittest.mock import Mock, create_autospec
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_restx import Api

from controllers.common.rbac import DatasetId, RBACPermission
from controllers.console import api as console_api
from controllers.console import console_ns, flask_admission
from controllers.console.datasets.metadata import (
    DatasetMetadataApi,
    DatasetMetadataBuiltInFieldActionApi,
    DatasetMetadataCreateApi,
    DocumentMetadataEditApi,
)
from enums import DeploymentEdition
from libs.login import AccountWithTenant
from models.account import Account, TenantAccountRole
from services.errors.base import NoPermissionError
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.metadata.application import MetadataService
from services.knowledge.resource_scope import DatasetRef
from tests.unit_tests.controllers.rbac_introspection import rbac_checks
from tests.unit_tests.model_factories import make_account


@dataclass(frozen=True)
class KnowledgeServicesStub:
    metadata: MetadataService


@dataclass(frozen=True)
class ApplicationServicesStub:
    knowledge: KnowledgeServicesStub


@pytest.fixture
def routes(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> tuple[FlaskClient, Mock]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False)
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
    api = Api(app)
    api.error_handlers = console_api.error_handlers.copy()
    api.add_namespace(console_ns, path="/console/api")
    account = Account(name="Owner", email="metadata@example.com")
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    identity = AccountWithTenant(account=account, tenant_id="tenant-1")
    monkeypatch.setattr("controllers.console.flask_admission.current_account_with_tenant", lambda: identity)
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: identity)
    service = create_autospec(MetadataService, instance=True, spec_set=True)
    service.require_dataset.side_effect = lambda context, dataset_id: DatasetRef(
        context.active_workspace_id, dataset_id
    )
    app.extensions["application_services"] = ApplicationServicesStub(knowledge=KnowledgeServicesStub(metadata=service))
    return app.test_client(), service


@pytest.mark.parametrize(
    ("error", "status", "code", "message"),
    [
        (DatasetAccessDeniedError(), 403, "forbidden", "You do not have permission to access this dataset"),
        (NoPermissionError("Access denied"), 400, "invalid_param", "Access denied"),
        (RuntimeError("backend detail"), 500, "unknown", "Internal Server Error"),
    ],
)
def test_metadata_permission_error_http_contract(
    routes: tuple[FlaskClient, Mock], error: Exception, status: int, code: str, message: str
) -> None:
    client, service = routes
    service.require_dataset.side_effect = error
    response = client.post(f"/console/api/datasets/{uuid4()}/metadata", json={"type": "string", "name": "author"})
    assert response.status_code == status
    assert response.json == {"code": code, "message": message, "status": status}
    service.create_metadata.assert_not_called()


def test_create_serializes_result_and_passes_actor(routes: tuple[FlaskClient, Mock]) -> None:
    client, service = routes
    dataset_id = str(uuid4())
    service.create_metadata.return_value = {"id": str(uuid4()), "name": "author", "type": "string"}
    response = client.post(f"/console/api/datasets/{dataset_id}/metadata", json={"type": "string", "name": "author"})
    assert response.status_code == 201
    assert response.get_json()["name"] == "author"
    service.create_metadata.assert_called_once()
    ref, args = service.create_metadata.call_args.args
    assert ref == DatasetRef("tenant-1", dataset_id)
    assert (args.name, args.type) == ("author", "string")
    assert service.create_metadata.call_args.kwargs == {"actor_id": "account-1"}


@pytest.mark.parametrize("payload", [{"name": None, "type": "string"}, {"name": "author", "type": None}])
def test_create_rejects_invalid_payload_before_application(
    routes: tuple[FlaskClient, Mock], payload: dict[str, object]
) -> None:
    client, service = routes
    response = client.post(f"/console/api/datasets/{uuid4()}/metadata", json=payload)
    assert response.status_code == 422
    service.create_metadata.assert_not_called()


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("POST", "/datasets/{dataset_id}/metadata", {"type": "string", "name": "author"}),
        ("PATCH", "/datasets/{dataset_id}/metadata/{metadata_id}", {"name": "writer"}),
        ("DELETE", "/datasets/{dataset_id}/metadata/{metadata_id}", None),
        ("POST", "/datasets/{dataset_id}/metadata/built-in/enable", None),
        ("POST", "/datasets/{dataset_id}/documents/metadata", {"operation_data": []}),
    ],
)
def test_readonly_member_cannot_write_metadata_when_rbac_is_disabled(
    routes: tuple[FlaskClient, Mock],
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    payload: dict[str, object] | None,
) -> None:
    client, service = routes
    account = make_account(account_id="readonly-account", role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(
        flask_admission,
        "current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="tenant-1"),
    )
    url = "/console/api" + path.format(dataset_id=uuid4(), metadata_id=uuid4())

    response = client.open(url, method=method, json=payload)

    assert response.status_code == 403
    assert service.mock_calls == []


@pytest.mark.parametrize(("error", "status"), [(DatasetNotFoundError(), 404), (DatasetAccessDeniedError(), 403)])
def test_get_maps_access_errors(routes: tuple[FlaskClient, Mock], error: Exception, status: int) -> None:
    client, service = routes
    service.require_dataset.side_effect = error
    assert client.get(f"/console/api/datasets/{uuid4()}/metadata").status_code == status
    service.get_dataset_metadatas.assert_not_called()


def test_get_serializes_field_counts(routes: tuple[FlaskClient, Mock]) -> None:
    client, service = routes
    metadata_list: dict[str, object] = {"doc_metadata": [], "built_in_field_enabled": False}
    service.get_dataset_metadatas.return_value = metadata_list
    response = client.get(f"/console/api/datasets/{uuid4()}/metadata")
    assert response.status_code == 200
    assert response.get_json() == {"doc_metadata": [], "built_in_field_enabled": False}


def test_rename_and_delete_use_explicit_metadata_id(routes: tuple[FlaskClient, Mock]) -> None:
    client, service = routes
    dataset_id, metadata_id = str(uuid4()), str(uuid4())
    path = f"/console/api/datasets/{dataset_id}/metadata/{metadata_id}"
    service.update_metadata_name.return_value = {"id": metadata_id, "name": "writer", "type": "string"}
    assert client.patch(path, json={"name": "writer"}).status_code == 200
    service.update_metadata_name.assert_called_once_with(
        DatasetRef("tenant-1", dataset_id), metadata_id, "writer", actor_id="account-1"
    )
    response = client.delete(path)
    assert response.status_code == 204
    assert response.data == b""
    service.delete_metadata.assert_called_once_with(DatasetRef("tenant-1", dataset_id), metadata_id)


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_builtin_toggle_is_dispatched(routes: tuple[FlaskClient, Mock], action: str) -> None:
    client, service = routes
    dataset_id = str(uuid4())
    response = client.post(f"/console/api/datasets/{dataset_id}/metadata/built-in/{action}")
    assert response.status_code == 204
    operation = service.enable_built_in_field if action == "enable" else service.disable_built_in_field
    operation.assert_called_once_with(DatasetRef("tenant-1", dataset_id))


def test_builtin_listing_uses_response_model(routes: tuple[FlaskClient, Mock]) -> None:
    client, service = routes
    service.get_built_in_fields.return_value = [{"name": "uploader", "type": "string"}]
    response = client.get("/console/api/datasets/metadata/built-in")
    assert response.status_code == 200
    assert response.get_json() == {"fields": [{"name": "uploader", "type": "string"}]}


def test_document_metadata_missing_resource_is_not_found(routes: tuple[FlaskClient, Mock]) -> None:
    client, service = routes
    service.update_documents_metadata.side_effect = MetadataResourceNotFoundError("Document not found.")
    response = client.post(f"/console/api/datasets/{uuid4()}/documents/metadata", json={"operation_data": []})
    assert response.status_code == 404


def test_get_requires_dataset_readonly_permission() -> None:
    [check] = rbac_checks(DatasetMetadataCreateApi.get)
    assert check.scene is RBACPermission.DATASET_READONLY
    assert isinstance(check.locator, DatasetId)


@pytest.mark.parametrize(
    "method",
    [
        DatasetMetadataCreateApi.post,
        DatasetMetadataApi.patch,
        DatasetMetadataApi.delete,
        DatasetMetadataBuiltInFieldActionApi.post,
        DocumentMetadataEditApi.post,
    ],
)
def test_metadata_writes_require_dataset_edit_permission(method: Callable[..., object]) -> None:
    [check] = rbac_checks(method)
    assert check.scene is RBACPermission.DATASET_EDIT
    assert isinstance(check.locator, DatasetId)
