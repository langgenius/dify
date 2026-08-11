"""Authenticated HTTP-to-worker live Slack reconciliation verification."""

from __future__ import annotations

import os
from datetime import datetime

import pytest
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.helper import encrypter
from core.human_input_v2.entities import IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMIntegration,
    ProviderTenantIdentity,
)
from core.human_input_v2.shared import AccountId, IMSyncRunId, IntegrationId, WorkspaceId, WorkspaceScope
from libs.datetime_utils import naive_utc_now
from libs.rsa import generate_key_pair
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputIMIdentity, HumanInputIMSyncResult
from repositories.human_input_v2.im_integration.mappers import integration_to_record
from services.human_input_v2.im_contact_sync.composition import build_im_contact_sync_worker
from tasks.im_contact_sync_tasks import reconcile_im_contacts_task
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)

_SYNC_RUNS_PATH = "/console/api/workspaces/current/human-input/im-sync-runs"
_REQUIRED_SLACK_ENVIRONMENT = (
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
    "SLACK_BOT_TOKEN",
    "SLACK_APP_SOCKET_TOKEN",
)


def test_authenticated_http_sync_reaches_live_provider_worker_and_persisted_queries(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credentials = _live_slack_credentials()
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant.encrypt_public_key = generate_key_pair(tenant.id)
    db_session_with_containers.commit()
    integration = _persist_live_slack_integration(
        db_session_with_containers,
        workspace_id=WorkspaceId(tenant.id),
        actor_id=AccountId(account.id),
        credentials=credentials,
        now=naive_utc_now(),
    )
    headers = authenticate_console_client(test_client_with_containers, account)
    dispatched: list[tuple[tuple[str, str, str | None], str]] = []

    def capture_dispatch(*, args: tuple[str, str, str | None], queue: str) -> None:
        dispatched.append((args, queue))

    monkeypatch.setattr(reconcile_im_contacts_task, "apply_async", capture_dispatch)

    create_response = test_client_with_containers.post(_SYNC_RUNS_PATH, headers=headers)

    assert create_response.status_code == 200
    create_payload = create_response.get_json()
    assert create_payload is not None
    run_payload = create_payload["run"]
    assert run_payload["status"] == IMSyncRunStatus.QUEUED.value
    sync_run_id = IMSyncRunId(run_payload["id"])
    assert dispatched == [
        (
            (str(sync_run_id), "workspace", tenant.id),
            "human_input_contact_sync",
        )
    ]

    terminal_run = build_im_contact_sync_worker().execute(
        sync_run_id,
        WorkspaceScope(WorkspaceId(tenant.id)),
    )

    assert terminal_run.status is IMSyncRunStatus.SUCCEEDED
    latest_response = test_client_with_containers.get(f"{_SYNC_RUNS_PATH}/latest", headers=headers)
    assert latest_response.status_code == 200
    latest_payload = latest_response.get_json()
    assert latest_payload is not None
    assert latest_payload["run"]["id"] == str(sync_run_id)
    assert latest_payload["run"]["status"] == IMSyncRunStatus.SUCCEEDED.value
    result_counts: dict[str, int] = latest_payload["run"]["result_counts"]
    assert sum(result_counts.values()) > 0

    result_bucket, expected_total = next((bucket, count) for bucket, count in result_counts.items() if count > 0)
    first_page_response = test_client_with_containers.get(
        f"{_SYNC_RUNS_PATH}/latest/results",
        query_string={"result": result_bucket, "page": 1, "limit": 1},
        headers=headers,
    )
    assert first_page_response.status_code == 200
    first_page = first_page_response.get_json()
    assert first_page is not None
    assert (first_page["page"], first_page["limit"], first_page["total"]) == (1, 1, expected_total)
    assert len(first_page["data"]) == 1

    if expected_total > 1:
        second_page_response = test_client_with_containers.get(
            f"{_SYNC_RUNS_PATH}/latest/results",
            query_string={"result": result_bucket, "page": 2, "limit": 1},
            headers=headers,
        )
        assert second_page_response.status_code == 200
        second_page = second_page_response.get_json()
        assert second_page is not None
        assert (second_page["page"], second_page["limit"], second_page["total"]) == (2, 1, expected_total)
        assert len(second_page["data"]) == 1

    db_session_with_containers.expire_all()
    persisted_result_count = db_session_with_containers.scalar(
        select(func.count(HumanInputIMSyncResult.id)).where(HumanInputIMSyncResult.sync_run_id == str(sync_run_id))
    )
    persisted_identity_count = db_session_with_containers.scalar(
        select(func.count(HumanInputIMIdentity.id)).where(HumanInputIMIdentity.integration_id == str(integration.id))
    )
    assert persisted_result_count == sum(result_counts.values())
    assert persisted_identity_count == persisted_result_count


def _live_slack_credentials() -> dict[str, str]:
    missing_names = tuple(name for name in _REQUIRED_SLACK_ENVIRONMENT if not os.getenv(name))
    if missing_names:
        pytest.skip("live Slack credentials are not configured")
    return {name: os.environ[name] for name in _REQUIRED_SLACK_ENVIRONMENT}


def _persist_live_slack_integration(
    session: Session,
    *,
    workspace_id: WorkspaceId,
    actor_id: AccountId,
    credentials: dict[str, str],
    now: datetime,
) -> IMIntegration:
    integration = IMIntegration.create(
        integration_id=IntegrationId(str(uuidv7())),
        workspace_id=workspace_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "live-slack-workspace"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": credentials["SLACK_CLIENT_ID"],
                "encrypted_client_secret": encrypter.encrypt_token(
                    str(workspace_id), credentials["SLACK_CLIENT_SECRET"]
                ),
                "encrypted_signing_secret": encrypter.encrypt_token(
                    str(workspace_id), credentials["SLACK_SIGNING_SECRET"]
                ),
                "encrypted_bot_token": encrypter.encrypt_token(str(workspace_id), credentials["SLACK_BOT_TOKEN"]),
                "encrypted_app_token": encrypter.encrypt_token(
                    str(workspace_id), credentials["SLACK_APP_SOCKET_TOKEN"]
                ),
            }
        ),
        configured_by_account_id=actor_id,
        callback_url=None,
        now=now,
    )
    session.add(integration_to_record(integration))
    session.commit()
    return integration
