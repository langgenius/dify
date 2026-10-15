"""Normal CI: actual signed Console wrappers plus PostgreSQL native owners.

These exercise the API boundary, not a qualified Graphon execution.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models.account import Account
from models.model import DifySetup
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,  # noqa: PLC0414
    ledger_case as ledger_case,  # noqa: PLC0414
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
    native_owner as native_owner,  # noqa: PLC0414
    no_live as no_live,  # noqa: PLC0414
)


@pytest.fixture
def console_case(flask_app_with_containers, continuation_case, monkeypatch):
    from controllers.console import dify_builder as controller
    from controllers.console import wraps
    from extensions.ext_database import db

    case = continuation_case
    with case.factory.begin() as session:
        session.get(Account, case.ledger.actor.account_id).status = "active"
        if session.scalar(select(DifySetup).limit(1)) is None:
            session.add(DifySetup(version="native-console-ci"))
    # Only feature entitlement is synthetic; login/CSRF/owner/RBAC stay real.
    from types import SimpleNamespace
    monkeypatch.setattr(controller.FeatureService, "get_features", lambda _tenant: SimpleNamespace(dify_builder_enabled=True))
    wraps._is_setup_completed.reset_success()
    db.session.close()
    client = flask_app_with_containers.test_client()
    token = PassportService().issue({"user_id": case.ledger.actor.account_id, "exp": int(datetime.now(UTC).timestamp()) + 600})
    csrf = generate_csrf_token(case.ledger.actor.account_id)
    client.set_cookie(_real_cookie_name(COOKIE_NAME_CSRF_TOKEN), csrf)
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    client.environ_base[f"HTTP_{HEADER_NAME_CSRF_TOKEN.upper().replace('-', '_')}"] = csrf
    with case.factory() as session:
        from models.dify_builder import DifyBuilderExecutionRequest
        session_id = session.get(DifyBuilderExecutionRequest, case.ref.request_id).session_id
    case.client = client
    case.url = f"/console/api/dify-builder/sessions/{session_id}/native-tests"
    yield case
    wraps._is_setup_completed.reset_success()


def test_native_console_unauthenticated_is_rejected(console_case):
    c = console_case
    response = c.client.post(c.url, json={}, headers={"Authorization": ""})
    assert response.status_code == 401
    assert c.ledger.dispatched_attempt_count() == 0


def test_native_console_invalid_csrf_is_rejected(console_case):
    c = console_case
    response = c.client.post(c.url, json={}, headers={HEADER_NAME_CSRF_TOKEN: "invalid"})
    assert response.status_code == 401
    assert c.ledger.dispatched_attempt_count() == 0


def test_decision_cannot_replace_effect_parameters(console_case):
    c = console_case
    waiting = c.pause()
    response = c.client.post(c.url + f"/{c.ref.request_id}/decisions", json={
        "schema_version": "builder-native-test-v1", "pending_operation_id": waiting.pending_operation_ids[0],
        "decision": "confirm", "scope_digest": "a" * 64, "expected_version": 1,
        "idempotency_key": "decision-1", "parameters": {"recipient": "changed@example.invalid"},
    })
    assert response.status_code == 400
    assert "changed@example.invalid" not in response.get_data(as_text=True)
    assert c.ledger.dispatched_attempt_count() == 0
