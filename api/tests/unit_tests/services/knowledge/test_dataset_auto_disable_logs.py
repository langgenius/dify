from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

import services.knowledge.datasets.adapters as dataset_adapters
from enums import CloudPlan, DeploymentEdition
from models import Dataset
from models.dataset import DatasetAutoDisableLog
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.app.query_service import RelatedApps
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.resource_scope import DatasetRef
from services.rbac.members import MemberService
from services.tag_application_service import TagTargetQuery


class _UnusedDependency:
    """Constructor dependency that the auto-disable-log use case does not consume."""


@dataclass(frozen=True)
class _Subscription:
    plan: CloudPlan


@dataclass(frozen=True)
class _Billing:
    subscription: _Subscription


@dataclass(frozen=True)
class _Features:
    billing: _Billing


class _FixedDateTime(datetime):
    current = datetime(2026, 10, 19, 12, 0, 0)

    @classmethod
    def now(cls, tz=None):  # type: ignore[no-untyped-def]
        return cls.current if tz is None else tz.fromutc(cls.current.replace(tzinfo=tz))


class _FixedDatetimeModule:
    datetime = _FixedDateTime
    timedelta = timedelta


def _paid_features(_tenant_id: str, *, exclude_vector_space: bool) -> _Features:
    del exclude_vector_space
    return _Features(_Billing(_Subscription(CloudPlan.PROFESSIONAL)))


def _dataset(*, dataset_id: str, tenant_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=dataset_id,
        created_by="actor",
        maintainer="actor",
        indexing_technique="economy",
        permission="all_team_members",
    )


def _log(*, tenant_id: str, dataset_id: str, document_id: str, created_at: datetime) -> DatasetAutoDisableLog:
    log = DatasetAutoDisableLog(tenant_id=tenant_id, dataset_id=dataset_id, document_id=document_id)
    log.created_at = created_at
    return log


def _operations(session_factory: sessionmaker[Session]) -> SQLAlchemyDatasetOperations:
    unused = _UnusedDependency()
    return SQLAlchemyDatasetOperations(
        session_factory=session_factory,
        tags=cast(TagTargetQuery, unused),
        app_queries=cast(RelatedApps, unused),
        members=cast(MemberService, unused),
        datasets=cast(SQLAlchemyDatasetRepository, unused),
    )


def test_auto_disable_logs_enforce_owner_chain_and_thirty_day_window(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(dataset_adapters, "datetime", _FixedDatetimeModule)
    monkeypatch.setattr(
        dataset_adapters.FeatureService,
        "get_features",
        _paid_features,
    )
    now = _FixedDateTime.current
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(dataset_id="dataset", tenant_id="tenant"),
                _dataset(dataset_id="sibling", tenant_id="tenant"),
                _dataset(dataset_id="foreign", tenant_id="other"),
                _log(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    document_id="recent",
                    created_at=now - timedelta(days=1),
                ),
                _log(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    document_id="boundary",
                    created_at=now - timedelta(days=30),
                ),
                _log(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    document_id="expired",
                    created_at=now - timedelta(days=30, seconds=1),
                ),
                _log(
                    tenant_id="tenant",
                    dataset_id="sibling",
                    document_id="sibling-document",
                    created_at=now - timedelta(days=1),
                ),
                _log(
                    tenant_id="other",
                    dataset_id="dataset",
                    document_id="foreign-tenant-document",
                    created_at=now - timedelta(days=1),
                ),
            ]
        )

    result = _operations(sqlite_session_factory).auto_disable_logs(DatasetRef("tenant", "dataset"))

    assert result == {"document_ids": ["recent", "boundary"], "count": 2}
