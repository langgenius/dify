"""SQLite-backed read-query contracts for IM synchronization state."""

from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timedelta

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.human_input_v2.entities import IMIdentityBindingStatus, IMProvider, IMSyncResultType
from core.human_input_v2.im_integration import IMChannelRevision, IMSyncRun, SyncResultFact
from core.human_input_v2.shared import ContactId, IMIdentityId, IMSyncResultId, IMSyncRunId, IntegrationId
from models.human_input_v2 import IMEncryptedCredentials
from repositories.human_input_v2.im_binding_repository import IMBindingAssignment
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.im_integration.mappers import sync_result_to_record, sync_run_to_record
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository

_NOW = datetime(2026, 8, 11, 8)
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000101")
_OTHER_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000102")
_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000201")
_LATEST_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000202")
_IDENTITY_ALPHA = IMIdentityId("00000000-0000-0000-0000-000000000301")
_IDENTITY_EMAIL = IMIdentityId("00000000-0000-0000-0000-000000000302")
_IDENTITY_PROVIDER = IMIdentityId("00000000-0000-0000-0000-000000000303")
_SyncQueryContext = tuple[
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyIMIdentityRepository,
    SQLAlchemyIMBindingRepository,
]


def _channel(channel_id: IMChannelId = _CHANNEL_ID) -> IMChannel:
    return IMChannel(
        id=channel_id,
        created_at=_NOW,
        updated_at=_NOW,
        provider=IMProvider.FEISHU,
        provider_tenant_id=f"provider-{channel_id}",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )


def _run(run_id: IMSyncRunId, created_at: datetime) -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=run_id,
        channel_revision=IMChannelRevision(str(_CHANNEL_ID), 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=created_at,
    )


def _result(
    result_id: str,
    result_type: IMSyncResultType,
    created_at: datetime,
) -> SyncResultFact:
    return SyncResultFact(
        id=IMSyncResultId(result_id),
        integration_id=IntegrationId(str(_CHANNEL_ID)),
        sync_run_id=_LATEST_RUN_ID,
        operation_key=f"result:{result_id}",
        result_type=result_type,
        provider_user_id=None,
        display_name=None,
        email=None,
        normalized_email=None,
        contact_id=None,
        identity_id=None,
        binding_id=None,
        removal_reason=None,
        reason_code=None,
        reason_message=None,
        directory_entry_payload=None,
        contact_snapshot=None,
        identity_snapshot=None,
        created_at=created_at,
        updated_at=created_at,
    )


def _observation(provider_user_id: str, display_name: str | None, email: str | None) -> IMIdentityObservation:
    return IMIdentityObservation(
        provider_user_id=provider_user_id,
        display_name=display_name,
        email=email,
        raw_payload=OpaqueProviderPayload({}),
        sync_run_id=_RUN_ID,
        observed_at=_NOW,
    )


@pytest.fixture
def sync_query_context(
    sqlite_engine: Engine,
) -> Generator[_SyncQueryContext, None, None]:
    with Session(sqlite_engine, expire_on_commit=False) as session:
        identities = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID)
        bindings = SQLAlchemyIMBindingRepository(session, _CHANNEL_ID)
        identities.create(_IDENTITY_ALPHA, _observation("provider-alpha", "Alpha Reviewer", "alpha@example.com"))
        identities.create(_IDENTITY_EMAIL, _observation("provider-email", "Beta Reviewer", "owner@needle.test"))
        identities.create(_IDENTITY_PROVIDER, _observation("needle-provider-user", None, None))
        SQLAlchemyIMIdentityRepository(session, _OTHER_CHANNEL_ID).create(
            IMIdentityId("00000000-0000-0000-0000-000000000399"),
            _observation("needle-other-channel", "Needle Other", "needle@other.test"),
        )
        bindings.create(
            IMBindingAssignment(
                ContactId("00000000-0000-0000-0000-000000000401"),
                _IDENTITY_ALPHA,
                _NOW,
            ),
            bound_by_account_id=None,
        )
        session.add_all(
            [
                sync_run_to_record(_run(_RUN_ID, _NOW)),
                sync_run_to_record(_run(_LATEST_RUN_ID, _NOW + timedelta(hours=1))),
                sync_result_to_record(
                    _result(
                        "00000000-0000-0000-0000-000000000501",
                        IMSyncResultType.ADDED,
                        _NOW + timedelta(minutes=2),
                    )
                ),
                sync_result_to_record(
                    _result(
                        "00000000-0000-0000-0000-000000000502",
                        IMSyncResultType.ADDED,
                        _NOW + timedelta(minutes=1),
                    )
                ),
                sync_result_to_record(_result("00000000-0000-0000-0000-000000000503", IMSyncResultType.SKIPPED, _NOW)),
            ]
        )
        session.commit()
        yield SQLAlchemyIMControlPlaneRepository(session, _channel()), identities, bindings


def test_run_and_latest_run_queries_are_channel_bound_and_deterministic(
    sync_query_context: _SyncQueryContext,
) -> None:
    repository, _, _ = sync_query_context

    assert repository.load_sync_run(IMSyncRunId("00000000-0000-0000-0000-000000000999")) is None
    assert repository.load_sync_run(_RUN_ID) == _run(_RUN_ID, _NOW)
    assert repository.load_latest_sync_run() == _run(_LATEST_RUN_ID, _NOW + timedelta(hours=1))


def test_result_query_pages_one_required_bucket_in_stable_order(sync_query_context: _SyncQueryContext) -> None:
    repository, _, _ = sync_query_context

    first_page = repository.page_sync_results(_LATEST_RUN_ID, IMSyncResultType.ADDED, page=1, limit=1)
    second_page = repository.page_sync_results(_LATEST_RUN_ID, IMSyncResultType.ADDED, page=2, limit=1)

    assert first_page.total == 2
    assert [item.id for item in first_page.items] == [IMSyncResultId("00000000-0000-0000-0000-000000000502")]
    assert [item.id for item in second_page.items] == [IMSyncResultId("00000000-0000-0000-0000-000000000501")]


@pytest.mark.parametrize(("page", "limit"), [(0, 1), (1, 0), (1, 101)])
def test_result_query_rejects_invalid_page_boundaries(
    sync_query_context: _SyncQueryContext,
    page: int,
    limit: int,
) -> None:
    repository, _, _ = sync_query_context

    with pytest.raises(ValueError):
        repository.page_sync_results(_LATEST_RUN_ID, IMSyncResultType.ADDED, page=page, limit=limit)


@pytest.mark.parametrize(
    ("keyword", "expected_identity_id"),
    [
        ("alpha reviewer", _IDENTITY_ALPHA),
        ("NEEDLE.TEST", _IDENTITY_EMAIL),
        ("needle-provider", _IDENTITY_PROVIDER),
    ],
)
def test_identity_search_matches_supported_fields_and_reports_default_binding_status(
    sync_query_context: _SyncQueryContext,
    keyword: str,
    expected_identity_id: IMIdentityId,
) -> None:
    repository, identities, bindings = sync_query_context

    page = repository.search_identities(identities, bindings, keyword=keyword, page=1, limit=20)

    assert page.total == 1
    assert [item.id for item in page.items] == [expected_identity_id]
    expected_status = (
        IMIdentityBindingStatus.BOUND if expected_identity_id == _IDENTITY_ALPHA else IMIdentityBindingStatus.UNBOUND
    )
    assert page.items[0].binding_status is expected_status
    assert not hasattr(page.items[0], "raw_payload")


def test_identity_search_pages_without_cross_channel_leak(sync_query_context: _SyncQueryContext) -> None:
    repository, identities, bindings = sync_query_context

    first_page = repository.search_identities(identities, bindings, keyword=None, page=1, limit=2)
    second_page = repository.search_identities(identities, bindings, keyword=" ", page=2, limit=2)

    assert first_page.total == 3
    assert [item.id for item in first_page.items] == [_IDENTITY_ALPHA, _IDENTITY_EMAIL]
    assert [item.id for item in second_page.items] == [_IDENTITY_PROVIDER]
