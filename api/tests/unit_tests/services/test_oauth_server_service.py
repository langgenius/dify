from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from werkzeug.exceptions import BadRequest

from services.oauth_server import (
    OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    OAUTH_ACCESS_TOKEN_REDIS_KEY,
    OAUTH_AUTHORIZATION_CODE_REDIS_KEY,
    OAUTH_REFRESH_TOKEN_EXPIRES_IN,
    OAUTH_REFRESH_TOKEN_REDIS_KEY,
    OAuthGrantType,
    OAuthServerService,
)


@pytest.fixture
def mock_redis_client(mocker: MockerFixture) -> MagicMock:
    return mocker.patch("services.oauth_server.redis_client")


@pytest.fixture
def mock_session(mocker: MockerFixture) -> MagicMock:
    """Mock the OAuth server Session context manager."""
    mocker.patch("services.oauth_server.db", SimpleNamespace(engine=object()))
    session = MagicMock()
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    mocker.patch("services.oauth_server.Session", return_value=session_cm)
    return session


def test_get_oauth_provider_app_should_return_app_when_record_exists(mock_session: MagicMock) -> None:
    # Arrange
    mock_execute_result = MagicMock()
    expected_app = MagicMock()
    mock_execute_result.scalar_one_or_none.return_value = expected_app
    mock_session.execute.return_value = mock_execute_result

    # Act
    result = OAuthServerService.get_oauth_provider_app("client-1")

    # Assert
    assert result is expected_app
    mock_session.execute.assert_called_once()
    mock_execute_result.scalar_one_or_none.assert_called_once()


def test_sign_oauth_authorization_code_should_store_code_and_return_value(
    mocker: MockerFixture, mock_redis_client: MagicMock
) -> None:
    # Arrange
    deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000111")
    mocker.patch("services.oauth_server.uuid.uuid4", return_value=deterministic_uuid)

    # Act
    code = OAuthServerService.sign_oauth_authorization_code("client-1", "user-1")

    # Assert
    expected_code = str(deterministic_uuid)
    assert code == expected_code
    mock_redis_client.set.assert_called_once_with(
        OAUTH_AUTHORIZATION_CODE_REDIS_KEY.format(client_id="client-1", code=expected_code),
        "user-1",
        ex=600,
    )


def test_sign_oauth_access_token_should_raise_bad_request_when_authorization_code_is_invalid(
    mock_redis_client: MagicMock,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None

    # Act + Assert
    with pytest.raises(BadRequest, match="invalid code"):
        OAuthServerService.sign_oauth_access_token(
            grant_type=OAuthGrantType.AUTHORIZATION_CODE,
            code="bad-code",
            client_id="client-1",
        )


def test_sign_oauth_access_token_should_issue_access_and_refresh_token_when_authorization_code_is_valid(
    mocker: MockerFixture, mock_redis_client: MagicMock
) -> None:
    # Arrange
    token_uuids = [
        uuid.UUID("00000000-0000-0000-0000-000000000201"),
        uuid.UUID("00000000-0000-0000-0000-000000000202"),
    ]
    mocker.patch("services.oauth_server.uuid.uuid4", side_effect=token_uuids)
    mock_redis_client.get.return_value = b"user-1"
    code_key = OAUTH_AUTHORIZATION_CODE_REDIS_KEY.format(client_id="client-1", code="code-1")

    # Act
    access_token, refresh_token = OAuthServerService.sign_oauth_access_token(
        grant_type=OAuthGrantType.AUTHORIZATION_CODE,
        code="code-1",
        client_id="client-1",
    )

    # Assert
    assert access_token == str(token_uuids[0])
    assert refresh_token == str(token_uuids[1])
    mock_redis_client.delete.assert_called_once_with(code_key)
    mock_redis_client.set.assert_any_call(
        OAUTH_ACCESS_TOKEN_REDIS_KEY.format(client_id="client-1", token=access_token),
        b"user-1",
        ex=OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    )
    mock_redis_client.set.assert_any_call(
        OAUTH_REFRESH_TOKEN_REDIS_KEY.format(client_id="client-1", token=refresh_token),
        b"user-1",
        ex=OAUTH_REFRESH_TOKEN_EXPIRES_IN,
    )


def test_sign_oauth_access_token_should_raise_bad_request_when_refresh_token_is_invalid(
    mock_redis_client: MagicMock,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None

    # Act + Assert
    with pytest.raises(BadRequest, match="invalid refresh token"):
        OAuthServerService.sign_oauth_access_token(
            grant_type=OAuthGrantType.REFRESH_TOKEN,
            refresh_token="stale-token",
            client_id="client-1",
        )


def test_sign_oauth_access_token_should_issue_new_access_token_when_refresh_token_is_valid(
    mocker: MockerFixture, mock_redis_client: MagicMock
) -> None:
    # Arrange
    deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000301")
    mocker.patch("services.oauth_server.uuid.uuid4", return_value=deterministic_uuid)
    mock_redis_client.get.return_value = b"user-1"

    # Act
    access_token, returned_refresh_token = OAuthServerService.sign_oauth_access_token(
        grant_type=OAuthGrantType.REFRESH_TOKEN,
        refresh_token="refresh-1",
        client_id="client-1",
    )

    # Assert
    assert access_token == str(deterministic_uuid)
    assert returned_refresh_token == "refresh-1"
    mock_redis_client.set.assert_called_once_with(
        OAUTH_ACCESS_TOKEN_REDIS_KEY.format(client_id="client-1", token=access_token),
        b"user-1",
        ex=OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    )


def test_sign_oauth_access_token_with_unknown_grant_type_should_return_none() -> None:
    # Arrange
    grant_type = cast(OAuthGrantType, "invalid-grant-type")

    # Act
    result = OAuthServerService.sign_oauth_access_token(
        grant_type=grant_type,
        client_id="client-1",
    )

    # Assert
    assert result is None


def test_sign_oauth_refresh_token_should_store_token_with_expected_expiry(
    mocker: MockerFixture, mock_redis_client: MagicMock
) -> None:
    # Arrange
    deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000401")
    mocker.patch("services.oauth_server.uuid.uuid4", return_value=deterministic_uuid)

    # Act
    refresh_token = OAuthServerService._sign_oauth_refresh_token("client-2", "user-2")

    # Assert
    assert refresh_token == str(deterministic_uuid)
    mock_redis_client.set.assert_called_once_with(
        OAUTH_REFRESH_TOKEN_REDIS_KEY.format(client_id="client-2", token=refresh_token),
        "user-2",
        ex=OAUTH_REFRESH_TOKEN_EXPIRES_IN,
    )


def test_validate_oauth_access_token_should_return_none_when_token_not_found(
    mock_redis_client: MagicMock,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None

    # Act
    result = OAuthServerService.validate_oauth_access_token("client-1", "missing-token")

    # Assert
    assert result is None


def test_validate_oauth_access_token_should_load_user_when_token_exists(
    mocker: MockerFixture, mock_redis_client: MagicMock
) -> None:
    # Arrange
    mock_redis_client.get.return_value = b"user-88"
    expected_user = MagicMock()
    mock_load_user = mocker.patch("services.oauth_server.AccountService.load_user", return_value=expected_user)

    # Act
    result = OAuthServerService.validate_oauth_access_token("client-1", "access-token")

    # Assert
    assert result is expected_user
    mock_load_user.assert_called_once_with("user-88")
