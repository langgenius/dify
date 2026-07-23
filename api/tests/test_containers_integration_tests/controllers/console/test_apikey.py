"""Integration tests for console API key endpoints using testcontainers."""

from __future__ import annotations

from datetime import datetime
from operator import itemgetter

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.account import TenantAccountRole
from models.enums import ApiTokenType
from models.model import ApiToken, App, AppMode
from tests.test_containers_integration_tests.controllers.console.helpers import (
    AuthenticatedConsoleClient,
    ConsoleAccountFactory,
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


@pytest.fixture
def setup_app(
    container_transaction: Session,
    container_client: FlaskClient,
) -> tuple[FlaskClient, dict[str, str], App]:
    """Create an authenticated client with an app for API key tests."""
    account, tenant = create_console_account_and_tenant(container_transaction)
    app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
    headers = authenticate_console_client(container_client, account)
    return container_client, headers, app


class TestAppApiKeyListResource:
    """Tests for GET/POST /apps/<resource_id>/api-keys."""

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
        container_state: DatabaseState,
    ) -> None:
        client, headers, app = setup_app
        tenant_id = app.tenant_id

        with container_state.expect_count_change(ApiToken, ApiToken.app_id == app.id, before=0, after=1):
            resp = client.post(f"/console/api/apps/{app.id}/api-keys", headers=headers)
            assert resp.status_code == 201

        assert resp.json is not None
        api_token = container_state.one(ApiToken, ApiToken.id == resp.json["id"])
        assert api_token.tenant_id == tenant_id
        assert api_token.app_id == app.id
        assert api_token.type == ApiTokenType.APP

    def test_get_returns_persisted_keys(
        self,
        setup_app: tuple[FlaskClient, dict[str, str], App],
        container_transaction: Session,
    ) -> None:
        client, headers, app = setup_app
        first = ApiToken(
            app_id=app.id,
            tenant_id=app.tenant_id,
            token="app-persisted-first",
            type=ApiTokenType.APP,
            last_used_at=datetime(2026, 1, 2, 3, 4, 5),
        )
        second = ApiToken(
            app_id=app.id,
            tenant_id=app.tenant_id,
            token="app-persisted-second",
            type=ApiTokenType.APP,
        )
        container_transaction.add_all([first, second])
        container_transaction.commit()
        expected: list[dict[str, object]] = [
            {
                "id": first.id,
                "type": ApiTokenType.APP.value,
                "token": first.token,
                "last_used_at": int(first.last_used_at.timestamp()),
                "created_at": int(first.created_at.timestamp()),
            },
            {
                "id": second.id,
                "type": ApiTokenType.APP.value,
                "token": second.token,
                "last_used_at": None,
                "created_at": int(second.created_at.timestamp()),
            },
        ]
        expected.sort(key=itemgetter("id"))

        resp = client.get(f"/console/api/apps/{app.id}/api-keys", headers=headers)

        assert resp.status_code == 200
        assert resp.json is not None
        assert sorted(resp.json["data"], key=itemgetter("id")) == expected

    def test_create_key_max_limit(
        self,
        setup_app: tuple[FlaskClient, dict[str, str], App],
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
        container_transaction: Session,
    ) -> None:
        client, headers, _ = setup_app
        foreign_account, foreign_tenant = create_console_account_and_tenant(container_transaction)
        foreign_app = create_console_app(container_transaction, foreign_tenant.id, foreign_account.id, AppMode.CHAT)

        resp = client.get(f"/console/api/apps/{foreign_app.id}/api-keys", headers=headers)

        assert resp.status_code == 404


class TestAppApiKeyResource:
    """Tests for DELETE /apps/<resource_id>/api-keys/<api_key_id>."""

    @pytest.mark.requires_redis
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
        console_account_factory: ConsoleAccountFactory,
        container_client: FlaskClient,
        container_transaction: Session,
        container_state: DatabaseState,
    ) -> None:
        account, tenant = console_account_factory(role=TenantAccountRole.NORMAL)
        app = create_console_app(container_transaction, tenant.id, account.id, AppMode.CHAT)
        api_token = ApiToken(
            app_id=app.id,
            tenant_id=tenant.id,
            token=ApiToken.generate_api_key("app-", 24, session=container_transaction),
            type=ApiTokenType.APP,
        )
        container_transaction.add(api_token)
        container_transaction.commit()
        api_token_id = api_token.id
        headers = authenticate_console_client(container_client, account)

        response = container_client.delete(
            f"/console/api/apps/{app.id}/api-keys/{api_token_id}",
            headers=headers,
        )

        assert response.status_code == 403
        assert container_state.one(ApiToken, ApiToken.id == api_token_id).id == api_token_id


@pytest.mark.requires_redis
def test_dataset_api_key_lifecycle_persists_through_supported_routes(
    authenticated_console_client: AuthenticatedConsoleClient,
    container_state: DatabaseState,
) -> None:
    tenant_id = authenticated_console_client.tenant.id
    url = "/console/api/datasets/api-keys"

    with container_state.expect_count_change(
        ApiToken,
        ApiToken.tenant_id == tenant_id,
        ApiToken.type == ApiTokenType.DATASET,
        before=0,
        after=1,
    ):
        create_response = authenticated_console_client.client.post(
            url,
            headers=authenticated_console_client.headers,
        )

    assert create_response.status_code == 200
    assert create_response.json is not None
    api_key_id = create_response.json["id"]
    assert create_response.json["token"].startswith("dataset-")
    persisted = container_state.one(ApiToken, ApiToken.id == api_key_id)
    assert persisted.type == ApiTokenType.DATASET
    assert persisted.tenant_id == tenant_id

    list_response = authenticated_console_client.client.get(url, headers=authenticated_console_client.headers)
    assert list_response.status_code == 200
    assert list_response.json is not None
    assert list_response.json["data"] == [
        {
            "id": api_key_id,
            "type": ApiTokenType.DATASET.value,
            "token": persisted.token,
            "last_used_at": None,
            "created_at": int(persisted.created_at.timestamp()),
        }
    ]

    delete_response = authenticated_console_client.client.delete(
        f"/console/api/datasets/api-keys/{api_key_id}",
        headers=authenticated_console_client.headers,
    )
    assert delete_response.status_code == 204
    assert container_state.count(ApiToken, ApiToken.id == api_key_id) == 0
