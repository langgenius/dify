"""Shared helpers for FastAPI/API v2 tests."""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response

from configs import dify_config
from libs.passport import PassportService
from libs.token import generate_csrf_token


def apptest_get(app: FastAPI, path: str) -> Response:
    return TestClient(app).get(path)


def console_auth_headers(account_id: str, *, csrf: bool = False) -> dict[str, str]:
    """Build console auth headers for FastAPI v2 TestClient requests."""

    exp = int((datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp())
    token = PassportService().issue(
        {
            "user_id": account_id,
            "exp": exp,
            "iss": dify_config.EDITION,
            "sub": "Console API Passport",
        }
    )
    headers = {"Authorization": f"Bearer {token}"}
    if csrf:
        headers["X-CSRF-Token"] = generate_csrf_token(account_id)
    return headers
