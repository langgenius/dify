"""SQLite-backed read-query contracts for IM synchronization state."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.entities import (
    IMBindingScope,
    IMIdentityBindingStatus,
    IMProvider,
    IMSyncResultType,
)
from core.human_input_v2.im_integration import (
    IMBinding,
    IMIdentity,
    IMSyncRun,
    IntegrationRevisionToken,
    SyncResultFact,
)
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
)
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.im_integration.mappers import (
    binding_to_record,
    identity_to_record,
    sync_result_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository

_NOW = datetime(2026, 8, 11, 8)
_INTEGRATION_ID = IntegrationId("integration-1")


def _run(run_id: str, created_at: datetime) -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId(run_id),
        integration_revision=IntegrationRevisionToken(_INTEGRATION_ID, 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=created_at,
    )


def _result(result_id: str, run_id: str, result_type: IMSyncResultType, created_at: datetime) -> SyncResultFact:
    return SyncResultFact(
        id=IMSyncResultId(result_id),
        integration_id=_INTEGRATION_ID,
        sync_run_id=IMSyncRunId(run_id),
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


@pytest.fixture
def sync_query_repository(sqlite_engine: Engine) -> SQLAlchemyIMControlPlaneRepository:
    HumanInputIMSyncRun.metadata.create_all(
        sqlite_engine,
        tables=[
            HumanInputIMIdentity.__table__,
            HumanInputIMBinding.__table__,
            HumanInputIMSyncRun.__table__,
            HumanInputIMSyncResult.__table__,
        ],
    )
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    def fail_if_write_lock_is_requested(_scope: object):
        raise AssertionError("read-only IM sync query requested a write unit of work")

    with sessions.begin() as session:
        alpha = IMIdentity.create(
            identity_id=IMIdentityId("identity-alpha"),
            integration_id=_INTEGRATION_ID,
            provider=IMProvider.FEISHU,
            provider_user_id="provider-alpha",
            display_name="Alpha Reviewer",
            email="alpha@example.com",
            raw_payload={},
            last_seen_sync_run_id=None,
            last_seen_at=_NOW,
            now=_NOW,
        )
        email_match = IMIdentity.create(
            identity_id=IMIdentityId("identity-email"),
            integration_id=_INTEGRATION_ID,
            provider=IMProvider.FEISHU,
            provider_user_id="provider-email",
            display_name="Beta Reviewer",
            email="owner@needle.test",
            raw_payload={},
            last_seen_sync_run_id=None,
            last_seen_at=_NOW,
            now=_NOW,
        )
        provider_match = IMIdentity.create(
            identity_id=IMIdentityId("identity-provider"),
            integration_id=_INTEGRATION_ID,
            provider=IMProvider.FEISHU,
            provider_user_id="needle-provider-user",
            display_name=None,
            email=None,
            raw_payload={},
            last_seen_sync_run_id=None,
            last_seen_at=_NOW,
            now=_NOW,
        )
        other_integration = IMIdentity.create(
            identity_id=IMIdentityId("identity-other-integration"),
            integration_id=IntegrationId("integration-other"),
            provider=IMProvider.FEISHU,
            provider_user_id="needle-other-integration",
            display_name="Needle Other",
            email="needle@other.test",
            raw_payload={},
            last_seen_sync_run_id=None,
            last_seen_at=_NOW,
            now=_NOW,
        )
        alpha_binding = IMBinding.create(
            binding_id=IMBindingId("binding-alpha"),
            integration_id=_INTEGRATION_ID,
            scope=IMBindingScope.ORGANIZATION,
            scope_id=str(_INTEGRATION_ID),
            contact_id=ContactId("contact-alpha"),
            identity_id=alpha.id,
            provider=IMProvider.FEISHU,
            bound_by_account_id=None,
            now=_NOW,
        )
        session.add_all(
            [
                identity_to_record(alpha),
                identity_to_record(email_match),
                identity_to_record(provider_match),
                identity_to_record(other_integration),
                binding_to_record(alpha_binding),
                sync_run_to_record(_run("run-old", _NOW)),
                sync_run_to_record(_run("run-latest", _NOW + timedelta(hours=1))),
                sync_result_to_record(
                    _result("result-2", "run-latest", IMSyncResultType.ADDED, _NOW + timedelta(minutes=2))
                ),
                sync_result_to_record(
                    _result("result-1", "run-latest", IMSyncResultType.ADDED, _NOW + timedelta(minutes=1))
                ),
                sync_result_to_record(_result("result-other", "run-latest", IMSyncResultType.SKIPPED, _NOW)),
            ]
        )
    return SQLAlchemyIMControlPlaneRepository(sessions, fail_if_write_lock_is_requested)


def test_run_and_latest_run_queries_are_deterministic_and_lock_free(sync_query_repository) -> None:
    assert sync_query_repository.load_sync_run(IMSyncRunId("missing")) is None
    assert sync_query_repository.load_sync_run(IMSyncRunId("run-old")) == _run("run-old", _NOW)
    assert sync_query_repository.load_latest_sync_run(_INTEGRATION_ID) == _run("run-latest", _NOW + timedelta(hours=1))


def test_result_query_pages_one_required_bucket_in_stable_order(sync_query_repository) -> None:
    first_page = sync_query_repository.page_sync_results(
        IMSyncRunId("run-latest"),
        IMSyncResultType.ADDED,
        page=1,
        limit=1,
    )
    second_page = sync_query_repository.page_sync_results(
        IMSyncRunId("run-latest"),
        IMSyncResultType.ADDED,
        page=2,
        limit=1,
    )

    assert first_page.page == 1
    assert first_page.limit == 1
    assert first_page.total == 2
    assert [item.id for item in first_page.items] == [IMSyncResultId("result-1")]
    assert [item.id for item in second_page.items] == [IMSyncResultId("result-2")]


def test_result_query_rejects_an_unfiltered_all_bucket(sync_query_repository) -> None:
    with pytest.raises(ValueError, match="result type"):
        sync_query_repository.page_sync_results(
            IMSyncRunId("run-latest"),
            "all",
            page=1,
            limit=20,
        )


@pytest.mark.parametrize(
    ("keyword", "expected_identity_id"),
    [
        ("alpha reviewer", IMIdentityId("identity-alpha")),
        ("NEEDLE.TEST", IMIdentityId("identity-email")),
        ("needle-provider", IMIdentityId("identity-provider")),
    ],
)
def test_identity_search_matches_all_supported_fields_and_reports_binding_status(
    sync_query_repository,
    keyword: str,
    expected_identity_id: IMIdentityId,
) -> None:
    page = sync_query_repository.search_identities(
        _INTEGRATION_ID,
        IMProvider.FEISHU,
        keyword=keyword,
        page=1,
        limit=20,
    )

    assert page.total == 1
    assert [item.id for item in page.items] == [expected_identity_id]
    expected_status = (
        IMIdentityBindingStatus.BOUND
        if expected_identity_id == IMIdentityId("identity-alpha")
        else IMIdentityBindingStatus.UNBOUND
    )
    assert page.items[0].binding_status is expected_status
    assert not hasattr(page.items[0], "raw_payload")


def test_identity_search_pages_unbound_identities_without_cross_integration_leak(sync_query_repository) -> None:
    first_page = sync_query_repository.search_identities(
        _INTEGRATION_ID,
        IMProvider.FEISHU,
        keyword=None,
        page=1,
        limit=2,
    )
    second_page = sync_query_repository.search_identities(
        _INTEGRATION_ID,
        IMProvider.FEISHU,
        keyword=" ",
        page=2,
        limit=2,
    )

    assert first_page.total == 3
    assert [item.id for item in first_page.items] == [
        IMIdentityId("identity-alpha"),
        IMIdentityId("identity-email"),
    ]
    assert [item.id for item in second_page.items] == [IMIdentityId("identity-provider")]
