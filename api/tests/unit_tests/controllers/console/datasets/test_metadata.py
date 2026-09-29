"""Console metadata routes use admission, explicit context, and response models."""

from types import SimpleNamespace
from unittest.mock import create_autospec
from uuid import uuid4

import pytest
from flask import Flask
from flask_restx import Api

from controllers.common.rbac import DatasetId, RBACPermission
from controllers.console import console_ns
from controllers.console.datasets.metadata import DatasetMetadataCreateApi
from enums import DeploymentEdition
from libs.login import AccountWithTenant
from models.account import Account, TenantAccountRole
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.metadata.application import MetadataService
from services.knowledge.resource_scope import DatasetRef
from tests.unit_tests.controllers.rbac_introspection import rbac_checks


@pytest.fixture
def routes(monkeypatch: pytest.MonkeyPatch, config_overrides):
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False)
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
    Api(app).add_namespace(console_ns, path="/console/api")
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
    app.extensions["application_services"] = SimpleNamespace(knowledge=SimpleNamespace(metadata=service))
    return app.test_client(), service


def test_create_serializes_result_and_passes_actor(routes):
    client, service = routes
    dataset_id = str(uuid4())
    service.create_metadata.return_value = {"id": str(uuid4()), "name": "author", "type": "string"}
    response = client.post(f"/console/api/datasets/{dataset_id}/metadata", json={"type": "string", "name": "author"})
    assert response.status_code == 201
    assert response.get_json()["name"] == "author"
    assert service.create_metadata.call_args.args[0] == DatasetRef("tenant-1", dataset_id)
    assert service.create_metadata.call_args.kwargs == {"actor_id": "account-1"}


@pytest.mark.parametrize("payload", [{"name": None, "type": "string"}, {"name": "author", "type": None}])
def test_create_rejects_invalid_payload_before_application(routes, payload):
    client, service = routes
    response = client.post(f"/console/api/datasets/{uuid4()}/metadata", json=payload)
    assert response.status_code == 422
    service.create_metadata.assert_not_called()


@pytest.mark.parametrize(("error", "status"), [(DatasetNotFoundError(), 404), (DatasetAccessDeniedError(), 403)])
def test_get_maps_access_errors(routes, error, status):
    client, service = routes
    service.require_dataset.side_effect = error
    assert client.get(f"/console/api/datasets/{uuid4()}/metadata").status_code == status
    service.get_dataset_metadatas.assert_not_called()


def test_get_serializes_field_counts(routes):
    client, service = routes
    service.get_dataset_metadatas.return_value = {"doc_metadata": [], "built_in_field_enabled": False}
    response = client.get(f"/console/api/datasets/{uuid4()}/metadata")
    assert response.status_code == 200
    assert response.get_json() == {"doc_metadata": [], "built_in_field_enabled": False}


def test_rename_and_delete_use_explicit_metadata_id(routes):
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
def test_builtin_toggle_is_dispatched(routes, action):
    client, service = routes
    dataset_id = str(uuid4())
    response = client.post(f"/console/api/datasets/{dataset_id}/metadata/built-in/{action}")
    assert response.status_code == 204
    operation = service.enable_built_in_field if action == "enable" else service.disable_built_in_field
    operation.assert_called_once_with(DatasetRef("tenant-1", dataset_id))


def test_builtin_listing_uses_response_model(routes):
    client, service = routes
    service.get_built_in_fields.return_value = [{"name": "uploader", "type": "string"}]
    response = client.get("/console/api/datasets/metadata/built-in")
    assert response.status_code == 200
    assert response.get_json() == {"fields": [{"name": "uploader", "type": "string"}]}


def test_document_metadata_missing_resource_is_not_found(routes):
    client, service = routes
    service.update_documents_metadata.side_effect = MetadataResourceNotFoundError("Document not found.")
    response = client.post(f"/console/api/datasets/{uuid4()}/documents/metadata", json={"operation_data": []})
    assert response.status_code == 404


def test_get_requires_dataset_readonly_permission():
    [check] = rbac_checks(DatasetMetadataCreateApi.get)
    assert check.scene is RBACPermission.DATASET_READONLY
    assert isinstance(check.locator, DatasetId)
