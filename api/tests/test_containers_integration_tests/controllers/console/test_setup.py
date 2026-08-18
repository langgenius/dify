from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import AbstractContextManager
from threading import Event, Lock
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.account import Account, Tenant, TenantAccountJoin
from models.model import DifySetup
from services.account_service import RegisterService
from services.setup_adapters import RedisSetupLock
from tests.test_containers_integration_tests.helpers import generate_valid_password


@pytest.fixture
def setup_dependencies() -> Iterator[MagicMock]:
    with (
        patch("services.account_service.FeatureService") as feature_service,
        patch("services.account_service.BillingService") as billing_service,
        patch("services.account_service.CommunityTelemetryService.report_install") as report_install,
    ):
        feature_service.get_system_features.return_value.is_allow_register = True
        feature_service.get_license.return_value.seats.is_available.return_value = True
        feature_service.get_license.return_value.workspaces.is_available.return_value = True
        feature_service.is_workspace_creation_allowed.return_value = True
        billing_service.is_email_in_freeze.return_value = False
        yield report_install


def _setup_payload(*, email: str, password: str) -> dict[str, str]:
    return {
        "email": email,
        "name": "Admin",
        "password": password,
        "language": "en-US",
    }


def test_setup_endpoint_persists_bootstrap_state_and_rejects_repeat(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
    setup_dependencies: MagicMock,
) -> None:
    monkeypatch.delenv("INIT_PASSWORD", raising=False)
    password = generate_valid_password(Faker())

    response = test_client_with_containers.post(
        "/console/api/setup",
        json=_setup_payload(email="admin@example.com", password=password),
        headers={"CF-Connecting-IP": "203.0.113.7"},
    )

    assert response.status_code == 201
    assert response.get_json() == {"result": "success"}
    setup_dependencies.assert_called_once()

    repeated_response = test_client_with_containers.post(
        "/console/api/setup",
        json=_setup_payload(email="other@example.com", password=password),
    )

    assert repeated_response.status_code == 403

    db_session_with_containers.expire_all()
    assert db_session_with_containers.scalar(select(func.count()).select_from(DifySetup)) == 1
    assert db_session_with_containers.scalar(select(func.count()).select_from(Account)) == 1
    assert db_session_with_containers.scalar(select(func.count()).select_from(Tenant)) == 1
    assert db_session_with_containers.scalar(select(func.count()).select_from(TenantAccountJoin)) == 1

    account = db_session_with_containers.scalar(select(Account))
    assert account is not None
    assert account.email == "admin@example.com"
    assert account.last_login_ip == "203.0.113.7"


def test_concurrent_setup_requests_create_only_one_bootstrap_identity(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
    setup_dependencies: MagicMock,
) -> None:
    monkeypatch.delenv("INIT_PASSWORD", raising=False)
    password = generate_valid_password(Faker())
    provision_started = Event()
    allow_provision_to_finish = Event()
    second_lock_attempted = Event()
    attempt_guard = Lock()
    lock_attempts = 0
    original_setup = RegisterService.setup
    original_acquire = RedisSetupLock.acquire

    def blocking_setup(
        email: str,
        name: str,
        password: str,
        ip_address: str,
        language: str | None,
        *,
        session: Session,
    ) -> None:
        if not provision_started.is_set():
            provision_started.set()
            assert allow_provision_to_finish.wait(timeout=10)
        original_setup(
            email=email,
            name=name,
            password=password,
            ip_address=ip_address,
            language=language,
            session=session,
        )

    def tracked_acquire(self: RedisSetupLock) -> AbstractContextManager[None]:
        nonlocal lock_attempts
        with attempt_guard:
            lock_attempts += 1
            if lock_attempts == 2:
                second_lock_attempted.set()
        return original_acquire(self)

    def post_setup(email: str) -> int:
        with flask_app_with_containers.test_client() as client:
            response = client.post(
                "/console/api/setup",
                json=_setup_payload(email=email, password=password),
            )
            return response.status_code

    with (
        patch.object(RegisterService, "setup", side_effect=blocking_setup),
        patch.object(RedisSetupLock, "acquire", tracked_acquire),
        ThreadPoolExecutor(max_workers=2) as executor,
    ):
        first_request = executor.submit(post_setup, "admin-1@example.com")
        try:
            assert provision_started.wait(timeout=10)
            second_request = executor.submit(post_setup, "admin-2@example.com")
            assert second_lock_attempted.wait(timeout=10)
            assert not second_request.done()
        finally:
            allow_provision_to_finish.set()

        results = [first_request.result(timeout=30), second_request.result(timeout=30)]

    assert sorted(results) == [201, 403]
    setup_dependencies.assert_called_once()

    db_session_with_containers.expire_all()
    assert db_session_with_containers.scalar(select(func.count()).select_from(DifySetup)) == 1
    assert db_session_with_containers.scalar(select(func.count()).select_from(Account)) == 1
    assert db_session_with_containers.scalar(select(func.count()).select_from(Tenant)) == 1
    assert db_session_with_containers.scalar(select(func.count()).select_from(TenantAccountJoin)) == 1
