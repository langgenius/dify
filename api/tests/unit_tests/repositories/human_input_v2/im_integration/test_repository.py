"""SQLite-backed historical sync persistence contracts."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from core.human_input_v2.entities import IMProvider, IMSyncResultType
from core.human_input_v2.im_integration import IMChannelRevision, IMSyncRun, SyncResultFact
from core.human_input_v2.shared import IMSyncResultId, IMSyncRunId, IntegrationId
from models.human_input_v2 import HumanInputIMSyncResult, IMEncryptedCredentials
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository

_NOW = datetime(2026, 8, 11, 8)
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000101")


def _channel() -> IMChannel:
    return IMChannel(
        id=_CHANNEL_ID,
        created_at=_NOW,
        updated_at=_NOW,
        provider=IMProvider.FEISHU,
        provider_tenant_id="provider-tenant-1",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )


def _run() -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000201"),
        channel_revision=IMChannelRevision(str(_CHANNEL_ID), 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=_NOW,
    )


def _result(result_id: str) -> SyncResultFact:
    return SyncResultFact(
        id=IMSyncResultId(result_id),
        integration_id=IntegrationId(str(_CHANNEL_ID)),
        sync_run_id=_run().id,
        operation_key=f"diagnostic:{result_id}",
        result_type=IMSyncResultType.FAILED,
        provider_user_id=None,
        display_name=None,
        email=None,
        normalized_email=None,
        contact_id=None,
        identity_id=None,
        binding_id=None,
        removal_reason=None,
        reason_code="test_diagnostic",
        reason_message="Operator-safe diagnostic",
        directory_entry_payload=None,
        contact_snapshot=None,
        identity_snapshot=None,
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_diagnostic_append_uses_the_supplied_session_transaction(sqlite_engine: Engine) -> None:
    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMControlPlaneRepository(session, _channel())
        repository.append_sync_results(
            (
                _result("00000000-0000-0000-0000-000000000301"),
                _result("00000000-0000-0000-0000-000000000302"),
            )
        )
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 2
        session.rollback()

    with Session(sqlite_engine) as session:
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 0
