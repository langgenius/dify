"""Tests for the Bearer file-grant decorator."""

import time
from collections.abc import Callable

import jwt
import pytest
from flask import Flask

from controllers.files.wraps import FileGrantInvalidError, FileGrantScopeDeniedError, file_grant_required
from libs.file_grant import FILE_GRANT_AUDIENCE, FileGrantClaims, FileGrantScope, issue_file_grant
from libs.passport import PassportService

SECRET_KEY = "file-grant-test-secret-long-enough-for-hs256"
TENANT_ID = "11111111-1111-4111-8111-111111111111"
APP_ID = "22222222-2222-4222-8222-222222222222"
END_USER_ID = "55555555-5555-4555-8555-555555555555"


@pytest.fixture(autouse=True)
def granted_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(SECRET_KEY=SECRET_KEY)


@file_grant_required(FileGrantScope.UPLOAD)
def _view(grant: FileGrantClaims) -> FileGrantClaims:
    return grant


def _call(app: Flask, authorization: str | None) -> FileGrantClaims:
    headers = {"Authorization": authorization} if authorization is not None else {}
    with app.test_request_context("/", method="POST", headers=headers):
        return _view()


def _grant(*scopes: FileGrantScope, ttl_seconds: int = 600) -> str:
    token, _ = issue_file_grant(
        end_user_id=END_USER_ID,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        scopes=scopes,
        ttl_seconds=ttl_seconds,
    )
    return token


def test_valid_grant_is_injected_into_the_view(app: Flask) -> None:
    claims = _call(app, f"Bearer {_grant(FileGrantScope.UPLOAD, FileGrantScope.RESOLVE)}")

    assert claims.sub == END_USER_ID
    assert claims.tenant_id == TENANT_ID
    assert claims.app_id == APP_ID
    assert claims.scopes == [FileGrantScope.UPLOAD, FileGrantScope.RESOLVE]


def test_missing_authorization_is_rejected(app: Flask) -> None:
    with pytest.raises(FileGrantInvalidError):
        _call(app, None)


def test_non_bearer_authorization_is_rejected(app: Flask) -> None:
    with pytest.raises(FileGrantInvalidError):
        _call(app, f"Basic {_grant(FileGrantScope.UPLOAD)}")


def test_webapp_passport_cannot_be_replayed_as_a_grant(app: Flask) -> None:
    """The passport is signed with the same key, so only ``aud`` separates them."""

    passport = PassportService().issue(
        {
            "iss": "SELF_HOSTED",
            "sub": "Web API Passport",
            "app_id": APP_ID,
            "end_user_id": END_USER_ID,
            "exp": int(time.time()) + 600,
        }
    )

    with pytest.raises(FileGrantInvalidError):
        _call(app, f"Bearer {passport}")


def test_content_token_audience_is_not_accepted_as_a_grant(app: Flask) -> None:
    content_token = jwt.encode(
        {
            "aud": "dify-files-content",
            "kind": "upload",
            "file_id": "66666666-6666-4666-8666-666666666666",
            "exp": int(time.time()) + 600,
        },
        SECRET_KEY,
        algorithm="HS256",
    )

    with pytest.raises(FileGrantInvalidError):
        _call(app, f"Bearer {content_token}")


def test_expired_grant_is_rejected(app: Flask) -> None:
    expired = jwt.encode(
        {
            "aud": FILE_GRANT_AUDIENCE,
            "sub": END_USER_ID,
            "tenant_id": TENANT_ID,
            "app_id": APP_ID,
            "scopes": ["upload"],
            "exp": int(time.time()) - 1,
        },
        SECRET_KEY,
        algorithm="HS256",
    )

    with pytest.raises(FileGrantInvalidError):
        _call(app, f"Bearer {expired}")


def test_grant_signed_with_another_key_is_rejected(app: Flask) -> None:
    forged = jwt.encode(
        {
            "aud": FILE_GRANT_AUDIENCE,
            "sub": END_USER_ID,
            "tenant_id": TENANT_ID,
            "app_id": APP_ID,
            "scopes": ["upload"],
            "exp": int(time.time()) + 600,
        },
        "some-other-secret-long-enough-for-hs256-signing",
        algorithm="HS256",
    )

    with pytest.raises(FileGrantInvalidError):
        _call(app, f"Bearer {forged}")


def test_grant_without_the_required_scope_is_denied(app: Flask) -> None:
    with pytest.raises(FileGrantScopeDeniedError):
        _call(app, f"Bearer {_grant(FileGrantScope.RESOLVE, FileGrantScope.PRODUCE)}")
