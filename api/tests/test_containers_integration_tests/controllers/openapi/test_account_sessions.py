from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from extensions.ext_redis import redis_client
from models import Account, OAuthAccessToken
from services.oauth_device_flow import PREFIX_OAUTH_ACCOUNT, MintResult, mint_oauth_token
from tests.test_containers_integration_tests.controllers.openapi.conftest import BearerFactory
from tests.test_containers_integration_tests.helpers import DatabaseState

pytestmark = pytest.mark.requires_redis


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat().replace("+00:00", "Z")


def _mint_account_token(
    db_session: Session,
    account: Account,
    *,
    client_id: str = "integration-cli",
    device_label: str = "Test Device",
) -> MintResult:
    return mint_oauth_token(
        redis_client,
        subject_email=account.email,
        subject_issuer=None,
        account_id=account.id,
        client_id=client_id,
        device_label=device_label,
        prefix=PREFIX_OAUTH_ACCOUNT,
        ttl_days=14,
        session=db_session,
    )


def _session_contract(token: OAuthAccessToken) -> dict[str, object]:
    return {
        "id": token.id,
        "prefix": token.prefix,
        "client_id": token.client_id,
        "device_label": token.device_label,
        "created_at": _iso(token.created_at),
        "last_used_at": _iso(token.last_used_at),
        "expires_at": _iso(token.expires_at),
    }


class TestSessionList:
    def test_lists_active_session(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        container_state: DatabaseState,
    ) -> None:
        account = make_transactional_account()
        mint = _mint_account_token(container_transaction, account, device_label="Laptop")

        response = container_client.get(
            "/openapi/v1/account/sessions", headers={"Authorization": f"Bearer {mint.token}"}
        )

        assert response.status_code == 200
        result = response.get_json()
        assert result["page"] == 1
        assert result["limit"] == 100
        assert result["total"] == 1
        assert result["has_more"] is False
        persisted = container_state.one(OAuthAccessToken, OAuthAccessToken.id == mint.token_id)
        assert result["data"] == [_session_contract(persisted)]

    def test_excludes_other_accounts_sessions(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        container_state: DatabaseState,
    ) -> None:
        account = make_transactional_account()
        other = make_transactional_account()
        mine = _mint_account_token(container_transaction, account)
        _mint_account_token(container_transaction, other)

        response = container_client.get(
            "/openapi/v1/account/sessions", headers={"Authorization": f"Bearer {mine.token}"}
        )

        assert response.status_code == 200
        result = response.get_json()
        persisted = container_state.one(OAuthAccessToken, OAuthAccessToken.id == mine.token_id)
        assert result == {
            "page": 1,
            "limit": 100,
            "total": 1,
            "has_more": False,
            "data": [_session_contract(persisted)],
        }


class TestSessionRevoke:
    def test_revoke_self_persists(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        container_state: DatabaseState,
    ) -> None:
        account = make_transactional_account()
        mint = _mint_account_token(container_transaction, account)

        response = container_client.delete(
            "/openapi/v1/account/sessions/self", headers={"Authorization": f"Bearer {mint.token}"}
        )

        assert response.status_code == 200
        assert response.get_json() == {"status": "revoked"}
        persisted = container_state.one(OAuthAccessToken, OAuthAccessToken.id == mint.token_id)
        assert persisted.revoked_at is not None

    def test_revoke_by_id_for_own_session(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
        container_state: DatabaseState,
    ) -> None:
        account = make_transactional_account()
        caller_headers, _caller = account_bearer_factory(account)
        target = _mint_account_token(container_transaction, account, client_id="target-client")

        response = container_client.delete(f"/openapi/v1/account/sessions/{target.token_id}", headers=caller_headers)

        assert response.status_code == 200
        assert response.get_json() == {"status": "revoked"}
        persisted = container_state.one(OAuthAccessToken, OAuthAccessToken.id == target.token_id)
        assert persisted.revoked_at is not None

    def test_revoke_foreign_session_is_404(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
        container_state: DatabaseState,
    ) -> None:
        owner = make_transactional_account()
        outsider = make_transactional_account()
        foreign = _mint_account_token(container_transaction, owner)
        outsider_headers, _outsider = account_bearer_factory(outsider)

        response = container_client.delete(f"/openapi/v1/account/sessions/{foreign.token_id}", headers=outsider_headers)

        assert response.status_code == 404
        assert response.get_json()["message"] == "session not found"
        persisted = container_state.one(OAuthAccessToken, OAuthAccessToken.id == foreign.token_id)
        assert persisted.revoked_at is None
