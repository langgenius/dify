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
from models.model import ApiToken, App, AppMode, DatasetApiTokenBinding
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
    """Tests for GET/POST /datasets/api-keys with per-knowledge-base scope.

    Scope is expressed by DatasetApiTokenBinding rows: absent/empty ``dataset_ids``
    on create makes an unrestricted key; a non-empty list binds the key to exactly
    those knowledge bases.
    """

    def _bound_dataset_ids(self, session: Session, api_token_id: str) -> set[str]:
        return {
            str(dataset_id)
            for dataset_id in session.scalars(
                select(DatasetApiTokenBinding.dataset_id).where(DatasetApiTokenBinding.api_token_id == api_token_id)
            ).all()
        }

    def test_create_unbound_key(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, dataset = setup_dataset
        tenant_id = dataset.tenant_id

        resp = client.post("/console/api/datasets/api-keys", headers=headers)

        assert resp.status_code == 200
        assert resp.json is not None
        assert resp.json["token"].startswith("dataset-")
        assert resp.json["dataset_ids"] == []
        api_token = db_session_with_containers.scalar(select(ApiToken).where(ApiToken.id == resp.json["id"]))
        assert api_token is not None
        assert api_token.tenant_id == tenant_id
        assert api_token.type == ApiTokenType.DATASET
        # No bindings -> unrestricted key.
        assert self._bound_dataset_ids(db_session_with_containers, resp.json["id"]) == set()

    def test_create_scoped_key_persists_bindings(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, dataset = setup_dataset
        dataset_id = dataset.id

        resp = client.post(
            "/console/api/datasets/api-keys",
            headers=headers,
            json={"dataset_ids": [dataset_id]},
        )

        assert resp.status_code == 200
        assert resp.json is not None
        assert resp.json["dataset_ids"] == [dataset_id]
        assert self._bound_dataset_ids(db_session_with_containers, resp.json["id"]) == {dataset_id}

    def test_create_rejects_dataset_outside_tenant(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
    ) -> None:
        """A dataset id that does not belong to the tenant is rejected with 400."""
        client, headers, _ = setup_dataset

        resp = client.post(
            "/console/api/datasets/api-keys",
            headers=headers,
            json={"dataset_ids": [str(uuid4())]},
        )

        assert resp.status_code == 400

    def test_list_reports_scope_for_each_key(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, dataset = setup_dataset
        dataset_id = dataset.id

        scoped_resp = client.post(
            "/console/api/datasets/api-keys",
            headers=headers,
            json={"dataset_ids": [dataset_id]},
        )
        assert scoped_resp.status_code == 200
        unbound_resp = client.post("/console/api/datasets/api-keys", headers=headers)
        assert unbound_resp.status_code == 200

        resp = client.get("/console/api/datasets/api-keys", headers=headers)

        assert resp.status_code == 200
        assert resp.json is not None
        assert scoped_resp.json is not None
        assert unbound_resp.json is not None
        scopes = {item["id"]: item["dataset_ids"] for item in resp.json["data"]}
        assert scopes[scoped_resp.json["id"]] == [dataset_id]
        assert scopes[unbound_resp.json["id"]] == []
        # reveal-once: the list returns masked tokens, never the full secret.
        listed = {item["id"]: item["token"] for item in resp.json["data"]}
        assert listed[scoped_resp.json["id"]] != scoped_resp.json["token"]


class TestDatasetApiKeyResource:
    """Tests for DELETE /datasets/api-keys/<api_key_id>."""

    def test_delete_key_removes_bindings(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        client, headers, dataset = setup_dataset
        dataset_id = dataset.id
        create_resp = client.post(
            "/console/api/datasets/api-keys",
            headers=headers,
            json={"dataset_ids": [dataset_id]},
        )
        assert create_resp.json is not None
        api_key_id = create_resp.json["id"]

        resp = client.delete(f"/console/api/datasets/api-keys/{api_key_id}", headers=headers)

        assert resp.status_code == 204
        assert db_session_with_containers.scalar(select(ApiToken).where(ApiToken.id == api_key_id)) is None
        # The binding rows cascade away with the deleted key.
        remaining = db_session_with_containers.scalars(
            select(DatasetApiTokenBinding).where(DatasetApiTokenBinding.api_token_id == api_key_id)
        ).all()
        assert remaining == []


class TestDatasetDeleteCascadesToScopedKeys:
    """Deleting a knowledge base must not let a scoped key degrade to access-all."""

    def _create_other_dataset(self, session: Session, tenant_id: str, created_by: str) -> Dataset:
        other = Dataset(
            tenant_id=tenant_id,
            name=f"Other Dataset {uuid4()}",
            description="Second dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by,
            permission="only_me",
            provider="vendor",
        )
        session.add(other)
        session.commit()
        return other

    def test_deleting_last_bound_dataset_deletes_the_scoped_key(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        """A key bound only to the deleted dataset is removed, never left unrestricted."""
        client, headers, dataset = setup_dataset
        dataset_id = dataset.id
        create_resp = client.post(
            "/console/api/datasets/api-keys",
            headers=headers,
            json={"dataset_ids": [dataset_id]},
        )
        assert create_resp.json is not None
        api_key_id = create_resp.json["id"]

        resp = client.delete(f"/console/api/datasets/{dataset_id}", headers=headers)

        assert resp.status_code == 204
        assert db_session_with_containers.scalar(select(ApiToken).where(ApiToken.id == api_key_id)) is None

    def test_deleting_one_bound_dataset_keeps_a_multi_scoped_key(
        self,
        setup_dataset: tuple[FlaskClient, dict[str, str], Dataset],
        db_session_with_containers: Session,
    ) -> None:
        """A key bound to several datasets survives and just drops the deleted one."""
        client, headers, dataset = setup_dataset
        dataset_id = dataset.id
        other = self._create_other_dataset(db_session_with_containers, dataset.tenant_id, dataset.created_by)
        other_id = other.id
        create_resp = client.post(
            "/console/api/datasets/api-keys",
            headers=headers,
            json={"dataset_ids": [dataset_id, other_id]},
        )
        assert create_resp.json is not None
        api_key_id = create_resp.json["id"]

        resp = client.delete(f"/console/api/datasets/{dataset_id}", headers=headers)

        assert resp.status_code == 204
        # The key survives, still scoped to the remaining dataset only.
        assert db_session_with_containers.scalar(select(ApiToken).where(ApiToken.id == api_key_id)) is not None
        remaining = {
            str(ds_id)
            for ds_id in db_session_with_containers.scalars(
                select(DatasetApiTokenBinding.dataset_id).where(DatasetApiTokenBinding.api_token_id == api_key_id)
            ).all()
        }
        assert remaining == {other_id}
