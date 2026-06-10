"""Testcontainers integration tests for OAuthServerService."""

from __future__ import annotations

import uuid
from typing import cast
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from models.model import OAuthProviderApp
from services.oauth_server import (
    OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    OAUTH_ACCESS_TOKEN_REDIS_KEY,
    OAUTH_AUTHORIZATION_CODE_REDIS_KEY,
    OAUTH_REFRESH_TOKEN_EXPIRES_IN,
    OAUTH_REFRESH_TOKEN_REDIS_KEY,
    OAuthGrantType,
    OAuthServerService,
)


class TestOAuthServerServiceGetProviderApp:
    """DB-backed tests for get_oauth_provider_app."""

    def _create_oauth_provider_app(self, db_session_with_containers: Session, *, client_id: str) -> OAuthProviderApp:
        app = OAuthProviderApp(
            app_icon="icon.png",
            client_id=client_id,
            client_secret=str(uuid4()),
            app_label={"en-US": "Test OAuth App"},
            redirect_uris=["https://example.com/callback"],
            scope="read",
        )
        db_session_with_containers.add(app)
        db_session_with_containers.commit()
        return app

    def test_get_oauth_provider_app_returns_app_when_exists(self, db_session_with_containers: Session):
        client_id = f"client-{uuid4()}"
        created = self._create_oauth_provider_app(db_session_with_containers, client_id=client_id)

        result = OAuthServerService.get_oauth_provider_app(client_id)

        assert result is not None
        assert result.client_id == client_id
        assert result.id == created.id

    def test_get_oauth_provider_app_returns_none_when_not_exists(self, db_session_with_containers: Session):
        result = OAuthServerService.get_oauth_provider_app(f"nonexistent-{uuid4()}")

        assert result is None


class TestOAuthServerServiceTokenOperations:
    """Redis-backed tests for token sign/validate operations."""

    @pytest.fixture
    def mock_redis(self):
        with patch("services.oauth_server.redis_client") as mock:
            yield mock

    def test_sign_authorization_code_stores_and_returns_code(self, mock_redis):
        deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000111")
        with patch("services.oauth_server.uuid.uuid4", return_value=deterministic_uuid):
            code = OAuthServerService.sign_oauth_authorization_code("client-1", "user-1")

        assert code == str(deterministic_uuid)
        mock_redis.set.assert_called_once_with(
            OAUTH_AUTHORIZATION_CODE_REDIS_KEY.format(client_id="client-1", code=code),
            "user-1",
            ex=600,
        )

    def test_sign_access_token_raises_bad_request_for_invalid_code(self, mock_redis):
        mock_redis.get.return_value = None

        with pytest.raises(BadRequest, match="invalid code"):
            OAuthServerService.sign_oauth_access_token(
                grant_type=OAuthGrantType.AUTHORIZATION_CODE,
                code="bad-code",
                client_id="client-1",
            )

    def test_sign_access_token_issues_tokens_for_valid_code(self, mock_redis):
        token_uuids = [
            uuid.UUID("00000000-0000-0000-0000-000000000201"),
            uuid.UUID("00000000-0000-0000-0000-000000000202"),
        ]
        with patch("services.oauth_server.uuid.uuid4", side_effect=token_uuids):
            mock_redis.get.return_value = b"user-1"

            access_token, refresh_token = OAuthServerService.sign_oauth_access_token(
                grant_type=OAuthGrantType.AUTHORIZATION_CODE,
                code="code-1",
                client_id="client-1",
            )

        assert access_token == str(token_uuids[0])
        assert refresh_token == str(token_uuids[1])
        code_key = OAUTH_AUTHORIZATION_CODE_REDIS_KEY.format(client_id="client-1", code="code-1")
        mock_redis.delete.assert_called_once_with(code_key)
        mock_redis.set.assert_any_call(
            OAUTH_ACCESS_TOKEN_REDIS_KEY.format(client_id="client-1", token=access_token),
            b"user-1",
            ex=OAUTH_ACCESS_TOKEN_EXPIRES_IN,
        )
        mock_redis.set.assert_any_call(
            OAUTH_REFRESH_TOKEN_REDIS_KEY.format(client_id="client-1", token=refresh_token),
            b"user-1",
            ex=OAUTH_REFRESH_TOKEN_EXPIRES_IN,
        )

    def test_sign_access_token_raises_bad_request_for_invalid_refresh_token(self, mock_redis):
        mock_redis.get.return_value = None

        with pytest.raises(BadRequest, match="invalid refresh token"):
            OAuthServerService.sign_oauth_access_token(
                grant_type=OAuthGrantType.REFRESH_TOKEN,
                refresh_token="stale-token",
                client_id="client-1",
            )

    def test_sign_access_token_issues_new_token_for_valid_refresh(self, mock_redis):
        deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000301")
        with patch("services.oauth_server.uuid.uuid4", return_value=deterministic_uuid):
            mock_redis.get.return_value = b"user-1"

            access_token, returned_refresh = OAuthServerService.sign_oauth_access_token(
                grant_type=OAuthGrantType.REFRESH_TOKEN,
                refresh_token="refresh-1",
                client_id="client-1",
            )

        assert access_token == str(deterministic_uuid)
        assert returned_refresh == "refresh-1"

    def test_sign_access_token_returns_none_for_unknown_grant_type(self, mock_redis):
        grant_type = cast(OAuthGrantType, "invalid-grant-type")

        result = OAuthServerService.sign_oauth_access_token(grant_type=grant_type, client_id="client-1")

        assert result is None

    def test_sign_refresh_token_stores_with_expected_expiry(self, mock_redis):
        deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000401")
        with patch("services.oauth_server.uuid.uuid4", return_value=deterministic_uuid):
            refresh_token = OAuthServerService._sign_oauth_refresh_token("client-2", "user-2")

        assert refresh_token == str(deterministic_uuid)
        mock_redis.set.assert_called_once_with(
            OAUTH_REFRESH_TOKEN_REDIS_KEY.format(client_id="client-2", token=refresh_token),
            "user-2",
            ex=OAUTH_REFRESH_TOKEN_EXPIRES_IN,
        )

    def test_validate_access_token_returns_none_when_not_found(self, mock_redis):
        mock_redis.get.return_value = None

        result = OAuthServerService.validate_oauth_access_token("client-1", "missing-token")

        assert result is None

    def test_validate_access_token_loads_user_when_exists(self, mock_redis):
        mock_redis.get.return_value = b"user-88"
        expected_user = MagicMock()

        with patch("services.oauth_server.AccountService.load_user", return_value=expected_user) as mock_load:
            result = OAuthServerService.validate_oauth_access_token("client-1", "access-token")

        assert result is expected_user
        mock_load.assert_called_once_with("user-88")
