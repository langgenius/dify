"""Unit tests for the remaining recommended app command/runtime service."""

import uuid
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from enums import DeploymentEdition
from models.model import AccountTrialAppRecord, App, AppMode
from services import recommended_app_service as service_module
from services.recommended_app_service import RecommendedAppService


@pytest.fixture(autouse=True)
def _recommended_app_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(HOSTED_FETCH_APP_TEMPLATES_MODE="remote")


@pytest.mark.parametrize(
    ("edition", "feature_enabled", "expected"),
    [
        (DeploymentEdition.CLOUD, True, True),
        (DeploymentEdition.CLOUD, False, False),
        (DeploymentEdition.COMMUNITY, True, False),
        (DeploymentEdition.ENTERPRISE, True, False),
    ],
)
def test_trial_app_policy_is_cloud_only(
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    feature_enabled: bool,
    expected: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition, ENABLE_TRIAL_APP=feature_enabled)

    assert RecommendedAppService.is_trial_app_enabled() is expected


def _persist_app(session: Session, *, name: str) -> App:
    app = App(
        tenant_id=str(uuid.uuid4()),
        name=name,
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )
    app.id = str(uuid.uuid4())
    session.add(app)
    session.commit()
    return app


def _configure_recommended_detail(
    monkeypatch: pytest.MonkeyPatch,
    *,
    result: dict[str, str] | None,
) -> MagicMock:
    retrieval = MagicMock()
    retrieval.get_recommend_app_detail.return_value = result
    retrieval_type = MagicMock(return_value=retrieval)
    monkeypatch.setattr(
        service_module.RecommendAppRetrievalFactory,
        "get_recommend_app_factory",
        MagicMock(return_value=retrieval_type),
    )
    return retrieval


def test_get_app_returns_normal_recommended_app(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    app = _persist_app(sqlite_session, name="Recommended App")
    retrieval = _configure_recommended_detail(monkeypatch, result={"id": app.id})

    result = RecommendedAppService.get_app(app.id, session=sqlite_session)

    assert result is app
    retrieval.get_recommend_app_detail.assert_called_once_with(app.id, session=sqlite_session)


def test_get_app_returns_none_when_app_is_not_recommended(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    app = _persist_app(sqlite_session, name="Private App")
    retrieval = _configure_recommended_detail(monkeypatch, result=None)

    result = RecommendedAppService.get_app(app.id, session=sqlite_session)

    assert result is None
    retrieval.get_recommend_app_detail.assert_called_once_with(app.id, session=sqlite_session)


def test_add_trial_app_record_increments_existing(sqlite_session: Session) -> None:
    app_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    sqlite_session.add(AccountTrialAppRecord(app_id=app_id, account_id=account_id, count=3))
    sqlite_session.commit()

    RecommendedAppService.add_trial_app_record(app_id, account_id, session=sqlite_session)

    sqlite_session.expire_all()
    record = sqlite_session.scalar(
        select(AccountTrialAppRecord).where(
            AccountTrialAppRecord.app_id == app_id,
            AccountTrialAppRecord.account_id == account_id,
        )
    )
    assert record is not None
    assert record.count == 4


def test_add_trial_app_record_creates_new_record(sqlite_session: Session) -> None:
    app_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())

    RecommendedAppService.add_trial_app_record(app_id, account_id, session=sqlite_session)

    sqlite_session.expire_all()
    record = sqlite_session.scalar(
        select(AccountTrialAppRecord).where(
            AccountTrialAppRecord.app_id == app_id,
            AccountTrialAppRecord.account_id == account_id,
        )
    )
    assert record is not None
    assert record.app_id == app_id
    assert record.account_id == account_id
    assert record.count == 1
