"""Integration tests for console API key endpoints using testcontainers."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.dataset import Dataset
from models.enums import ApiTokenType, DataSourceType
from models.model import ApiToken, App, AppMode
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


@pytest.fixture
def setup_app(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> tuple[FlaskClient, dict[str, str], App]:
    """Create an authenticated client with an app for API key tests."""
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    headers = authenticate_console_client(test_client_with_containers, account)
    return test_client_with_containers, headers, app


@pytest.fixture
def setup_dataset(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> tuple[FlaskClient, dict[str, str], Dataset]:
    """Create an authenticated client with a dataset for per-dataset API key tests."""
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    dataset = Dataset(
        tenant_id=tenant.id,
        name=f"API Key Dataset {uuid4()}",
        description="Dataset for API key scoping tests",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=account.id,
        permission="only_me",
        provider="vendor",
    )
    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()
    headers = authenticate_console_client(test_client_with_containers, account)
    return test_client_with_containers, headers, dataset


@pytest.fixture(autouse=True)
def cleanup_api_tokens(db_session_with_containers: Session):
    """Remove API tokens created during each test."""
    yield
    db_session_with_containers.execute(delete(ApiToken))
    db_session_with_containers.commit()


class TestAppApiKeyListResource:
    """Tests for GET/POST /apps/<resource_id>/api-keys."""

    def test_get_empty_keys(self, setup_app: tuple[FlaskClient, dict[str, str], App]) -> None:
        client, headers, app = setup_app
        resp = client.get(f"/console/api/apps/{app.id}/api-keys", headers=headers)
        assert resp.status_code == 200
        assert resp.json is not None
        assert resp.json["data"] == []

    def test_create_api_key(self, setup_app: tuple[FlaskClient, dict[str, str], App]) -> None:
        client, headers, app = setup_app
        resp = client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)
        assert resp.status_code == 201
        data = resp.json
        assert data is not None
        assert data["token"].startswith("app-")
        assert data["id"] is not None

    def test_create_api_key_persists_authenticated_tenant(
        self,
        setup_app: tuple[FlaskClient, dict[str, str], App],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, app = setup_app
        tenant_id = app.tenant_id

        resp = client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)

        assert resp.status_code == 201
        assert resp.json is not None
        api_token = db_session_with_containers.scalar(select(ApiToken).where(ApiToken.id == resp.json["id"]))
        assert api_token is not None
        assert api_token.tenant_id == tenant_id
        assert api_token.app_id == app.id
        assert api_token.type == ApiTokenType.APP

    def test_get_keys_after_create(self, setup_app: tuple[FlaskClient, dict[str, str], App]) -> None:
        client, headers, app = setup_app
        client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)
        client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)

        resp = client.get(f"/console/api/apps/{app.id}/api-keys", headers=headers)
        assert resp.status_code == 200
        assert resp.json is not None
        assert len(resp.json["data"]) == 2

    def test_create_key_max_limit(
        self,
        setup_app: tuple[FlaskClient, dict[str, str], App],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, app = setup_app
        # Create 10 keys (the max)
        for _ in range(10):
            client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)

        # 11th should fail
        resp = client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)
        assert resp.status_code == 400

    def test_get_keys_for_nonexistent_app(
        self,
        setup_app: tuple[FlaskClient, dict[str, str], App],
    ) -> None:
        client, headers, _ = setup_app
        resp = client.get(
            "/console/api/apps/00000000-0000-0000-0000-000000000000/api-keys",
            headers=headers,
        )
        assert resp.status_code == 404

    def test_get_foreign_app_keys_not_found(
        self,
        setup_app: tuple[FlaskClient, dict[str, str], App],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, _ = setup_app
        foreign_account, foreign_tenant = create_console_account_and_tenant(db_session_with_containers)
        foreign_app = create_console_app(
            db_session_with_containers, foreign_tenant.id, foreign_account.id, AppMode.CHAT
        )

        resp = client.get(f"/console/api/apps/{foreign_app.id}/api-keys", headers=headers)

        assert resp.status_code == 404


class TestAppApiKeyResource:
    """Tests for DELETE /apps/<resource_id>/api-keys/<api_key_id>."""

    def test_delete_key_success(self, setup_app: tuple[FlaskClient, dict[str, str], App]) -> None:
        client, headers, app = setup_app
        create_resp = client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)
        assert create_resp.json is not None
        key_id = create_resp.json["id"]

        resp = client.delete(f"/console/api/apps/{app.id}/api-keys/{key_id}", headers=headers)
        assert resp.status_code == 204

    def test_delete_nonexistent_key(self, setup_app: tuple[FlaskClient, dict[str, str], App]) -> None:
        client, headers, app = setup_app
        resp = client.delete(
            f"/console/api/apps/{app.id}/api-keys/00000000-0000-0000-0000-000000000000",
            headers=headers,
        )
        assert resp.status_code == 404

    def test_delete_key_nonexistent_app(
        self,
        setup_app: tuple[FlaskClient, dict[str, str], App],
    ) -> None:
        client, headers, _ = setup_app
        resp = client.delete(
            "/console/api/apps/00000000-0000-0000-0000-000000000000/api-keys/00000000-0000-0000-0000-000000000000",
            headers=headers,
        )
        assert resp.status_code == 404

    def test_delete_forbidden_for_non_admin(
        self,
        flask_app_with_containers: Flask,
    ) -> None:
        """A non-admin member cannot delete API keys via the controller permission check."""
        from werkzeug.exceptions import Forbidden

        from controllers.console.apikey import BaseApiKeyResource

        resource = BaseApiKeyResource()
        resource.resource_type = ApiTokenType.APP
        resource.resource_model = MagicMock()
        resource.resource_id_field = "app_id"

        non_admin = Account(name="Normal User", email="normal@example.com", status=AccountStatus.ACTIVE)
        non_admin.id = "normal-user"
        non_admin.role = TenantAccountRole.NORMAL

        with (
            flask_app_with_containers.test_request_context("/"),
            patch("controllers.console.apikey._get_resource"),
        ):
            with pytest.raises(Forbidden):
                BaseApiKeyResource.delete(resource, "rid", "kid", "tenant-id", non_admin)


class TestDatasetApiKeyListResource:
    """Tests for GET/POST /datasets/<resource_id>/api-keys (dataset-bound keys)."""

    def test_create_dataset_bound_key(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, dataset = setup_dataset

        resp = client.post(f"/console/api/datasets/{dataset.id}/api-keys", headers=headers)

        assert resp.status_code == 201
        assert resp.json is not None
        assert resp.json["token"].startswith("dataset-")
        assert resp.json["dataset_id"] == dataset.id
        api_token = db_session_with_containers.scalar(select(ApiToken).where(ApiToken.id == resp.json["id"]))
        assert api_token is not None
        assert api_token.dataset_id == dataset.id
        assert api_token.tenant_id == dataset.tenant_id
        assert api_token.type == ApiTokenType.DATASET

    def test_list_includes_bound_and_workspace_scoped_keys(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, dataset = setup_dataset

        # A bound key via the per-dataset route and a workspace key via the tenant route.
        bound_resp = client.post(f"/console/api/datasets/{dataset.id}/api-keys", headers=headers)
        assert bound_resp.status_code == 201
        workspace_resp = client.post("/console/api/datasets/api-keys", headers=headers)
        assert workspace_resp.status_code == 200

        resp = client.get(f"/console/api/datasets/{dataset.id}/api-keys", headers=headers)

        assert resp.status_code == 200
        assert resp.json is not None
        scopes = {item["id"]: item["dataset_id"] for item in resp.json["data"]}
        assert bound_resp.json is not None
        assert workspace_resp.json is not None
        assert scopes[bound_resp.json["id"]] == dataset.id
        assert scopes[workspace_resp.json["id"]] is None

    def test_list_excludes_keys_bound_to_other_datasets(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, dataset = setup_dataset
        # Capture ids up front: the commit below expires these instances and the
        # subsequent request teardown detaches them, so reading dataset.id afterwards
        # would raise DetachedInstanceError.
        dataset_id = dataset.id
        other_dataset = Dataset(
            tenant_id=dataset.tenant_id,
            name=f"Other Dataset {uuid4()}",
            description="Second dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=dataset.created_by,
            permission="only_me",
            provider="vendor",
        )
        db_session_with_containers.add(other_dataset)
        db_session_with_containers.commit()
        other_dataset_id = other_dataset.id

        other_resp = client.post(f"/console/api/datasets/{other_dataset_id}/api-keys", headers=headers)
        assert other_resp.status_code == 201

        resp = client.get(f"/console/api/datasets/{dataset_id}/api-keys", headers=headers)

        assert resp.status_code == 200
        assert resp.json is not None
        assert other_resp.json is not None
        assert other_resp.json["id"] not in {item["id"] for item in resp.json["data"]}

    def test_workspace_route_creates_unbound_key(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        """The pre-existing workspace route must keep creating NULL-scoped keys."""
        client, headers, _ = setup_dataset

        resp = client.post("/console/api/datasets/api-keys", headers=headers)

        assert resp.status_code == 200
        assert resp.json is not None
        api_token = db_session_with_containers.scalar(select(ApiToken).where(ApiToken.id == resp.json["id"]))
        assert api_token is not None
        assert api_token.dataset_id is None


class TestDatasetApiKeyResource:
    """Tests for DELETE /datasets/<resource_id>/api-keys/<api_key_id>."""

    def test_delete_bound_key(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
    ) -> None:
        client, headers, dataset = setup_dataset
        create_resp = client.post(f"/console/api/datasets/{dataset.id}/api-keys", headers=headers)
        assert create_resp.json is not None

        resp = client.delete(
            f"/console/api/datasets/{dataset.id}/api-keys/{create_resp.json['id']}",
            headers=headers,
        )

        assert resp.status_code == 204
