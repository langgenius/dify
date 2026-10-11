"""Regression coverage for the ``@property``→session-parameter refactor on
``RecommendedApp`` and ``AccountTrialAppRecord``.

The legacy ``@property`` accessors reached for the global ``db.session`` internally and have
been converted to plain methods taking an explicit ``session: Session`` (per the pattern
established in #40370/#41394/#41830/#42000, tracked in #40372).
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.account import Account
from models.model import AccountTrialAppRecord, App, AppMode, RecommendedApp


def _persist_app(session: Session) -> App:
    app = App(
        tenant_id=str(uuid4()),
        name="Test App",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=False,
        created_by=str(uuid4()),
        description="App description",
    )
    session.add(app)
    session.flush()
    return app


def _persist_recommended_app(session: Session, *, app_id: str) -> RecommendedApp:
    recommended_app = RecommendedApp(
        app_id=app_id,
        description={"en_US": "A recommended app"},
        copyright="Dify",
        privacy_policy="https://dify.ai/privacy",
        category="Assistant",
    )
    session.add(recommended_app)
    session.flush()
    return recommended_app


def _persist_account(session: Session) -> Account:
    account = Account(name="Test User", email=f"user-{uuid4()}@example.com")
    session.add(account)
    session.flush()
    return account


def _persist_trial_record(session: Session, *, account_id: str, app_id: str) -> AccountTrialAppRecord:
    record = AccountTrialAppRecord(account_id=account_id, app_id=app_id, count=1)
    session.add(record)
    session.flush()
    return record


class TestRecommendedAppApp:
    def test_returns_the_matching_app(self, sqlite_session: Session) -> None:
        app = _persist_app(sqlite_session)
        recommended_app = _persist_recommended_app(sqlite_session, app_id=app.id)

        result = recommended_app.app(session=sqlite_session)

        assert result is not None
        assert result.id == app.id

    def test_returns_none_when_app_missing(self, sqlite_session: Session) -> None:
        recommended_app = _persist_recommended_app(sqlite_session, app_id=str(uuid4()))

        assert recommended_app.app(session=sqlite_session) is None


class TestAccountTrialAppRecordAccessors:
    def test_app_returns_the_matching_app(self, sqlite_session: Session) -> None:
        app = _persist_app(sqlite_session)
        record = _persist_trial_record(sqlite_session, account_id=str(uuid4()), app_id=app.id)

        result = record.app(session=sqlite_session)

        assert result is not None
        assert result.id == app.id

    def test_app_returns_none_when_app_missing(self, sqlite_session: Session) -> None:
        record = _persist_trial_record(sqlite_session, account_id=str(uuid4()), app_id=str(uuid4()))

        assert record.app(session=sqlite_session) is None

    def test_user_returns_the_matching_account(self, sqlite_session: Session) -> None:
        account = _persist_account(sqlite_session)
        record = _persist_trial_record(sqlite_session, account_id=account.id, app_id=str(uuid4()))

        result = record.user(session=sqlite_session)

        assert result is not None
        assert result.id == account.id

    def test_user_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
        record = _persist_trial_record(sqlite_session, account_id=str(uuid4()), app_id=str(uuid4()))

        assert record.user(session=sqlite_session) is None
