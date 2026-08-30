"""SQLite-backed read and diagnostic contracts for the IM Control Plane adapter."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider, IMSyncResultType
from core.human_input_v2.im_integration import (
    IMSyncRun,
    IntegrationRevisionToken,
    SyncResultFact,
)
from core.human_input_v2.shared import (
    AccountId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
)
from models.human_input_v2 import (
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.im_integration.mappers import (
    sync_result_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository

_NOW = datetime(2026, 8, 11, 8)
_INTEGRATION_ID = IntegrationId("integration-1")


@pytest.fixture
def repository_context(
    sqlite_engine: Engine,
) -> tuple[SQLAlchemyIMControlPlaneRepository, sessionmaker[Session]]:
    HumanInputIMSyncRun.metadata.create_all(
        sqlite_engine,
        tables=[
            HumanInputIMSyncRun.__table__,
            HumanInputIMSyncResult.__table__,
        ],
    )
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    def fail_if_write_unit_of_work_is_requested(_scope: object) -> None:
        raise AssertionError("read-only repository operation requested a write unit of work")

    return SQLAlchemyIMControlPlaneRepository(sessions, fail_if_write_unit_of_work_is_requested), sessions


def _run() -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=IntegrationRevisionToken(_INTEGRATION_ID, 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=_NOW,
    )


def _result(result_id: str = "result-1") -> SyncResultFact:
    return SyncResultFact(
        id=IMSyncResultId(result_id),
        integration_id=_INTEGRATION_ID,
        sync_run_id=IMSyncRunId("run-1"),
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


def test_explicit_diagnostic_append_uses_its_own_transaction(repository_context) -> None:
    repository, sessions = repository_context
    with sessions.begin() as session:
        session.add(sync_run_to_record(_run()))

    repository.append_sync_results((_result(), _result("result-2")))

    with sessions() as session:
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 2
