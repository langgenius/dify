"""Usage writes follow accepted interactive execution requests, not worker completion."""

from dataclasses import replace
from typing import Never

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions import ext_application_services
from extensions.ext_application_services import ApplicationServices
from models.account import Account
from models.account_webapp import AccountWebApp
from models.model import App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from services.consumer_service import ConsumerAppsQuery
from tests.helpers.consumer import make_consumer_harness


@pytest.mark.parametrize("mode", list(AppMode))
@pytest.mark.parametrize("source", list(InvokeFrom))
@pytest.mark.parametrize("actor", ["browser", "guest", "account"])
def test_only_accepted_account_browser_webapp_executions_record_usage(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    source: InvokeFrom,
    actor: str,
    application_service_graph: ApplicationServices,
) -> None:
    harness = make_consumer_harness(sqlite_session_factory, monkeypatch)
    base = harness.oauth.base
    accepted = object()
    monkeypatch.setattr(AppGenerateService, "_run_with_guardrails", lambda *_args, **_kwargs: accepted)
    services = replace(application_service_graph, consumer=harness.service)
    monkeypatch.setattr(ext_application_services, "application_services", lambda: services)
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=mode))
    with base.sessions() as session:
        app = session.get(App, base.context.app_id)
        assert app is not None
        if actor == "account":
            user = session.get(Account, harness.identity.account_id)
        else:
            user = session.get(EndUser, base.context.end_user_id)
            if actor == "guest":
                assert user is not None
                user.account_id = None
        assert user is not None
        assert AppGenerateService.generate(app, user, {}, source, session=session) is accepted
    with base.sessions() as session:
        count = session.scalar(sa.select(sa.func.count()).select_from(AccountWebApp))
        assert count == int(
            actor == "browser" and source == InvokeFrom.WEB_APP and mode not in (AppMode.CHANNEL, AppMode.RAG_PIPELINE)
        )
        assert session.get_one(Account, harness.identity.account_id).be_end_user_at is None


def test_rejected_executions_do_not_record_usage(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    application_service_graph: ApplicationServices,
) -> None:
    harness = make_consumer_harness(sqlite_session_factory, monkeypatch)
    base = harness.oauth.base

    def reject(*_args: object, **_kwargs: object) -> Never:
        raise ValueError("Rejected execution")

    monkeypatch.setattr(AppGenerateService, "_run_with_guardrails", reject)
    services = replace(application_service_graph, consumer=harness.service)
    monkeypatch.setattr(ext_application_services, "application_services", lambda: services)
    with base.sessions() as session:
        app = session.get(App, base.context.app_id)
        user = session.get(EndUser, base.context.end_user_id)
        assert app is not None
        assert user is not None
        with pytest.raises(ValueError, match="Rejected"):
            AppGenerateService.generate(app, user, {}, InvokeFrom.WEB_APP, session=session)
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data


def test_preference_write_failure_does_not_fail_an_accepted_execution(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    application_service_graph: ApplicationServices,
) -> None:
    harness = make_consumer_harness(sqlite_session_factory, monkeypatch)
    base = harness.oauth.base
    accepted = object()
    monkeypatch.setattr(AppGenerateService, "_run_with_guardrails", lambda *_args, **_kwargs: accepted)
    services = replace(application_service_graph, consumer=harness.service)
    monkeypatch.setattr(ext_application_services, "application_services", lambda: services)

    def fail_to_record(*_args: object, **_kwargs: object) -> Never:
        raise RuntimeError("Storage unavailable")

    monkeypatch.setattr(harness.service, "record_usage", fail_to_record)
    with base.sessions() as session:
        app = session.get(App, base.context.app_id)
        user = session.get(EndUser, base.context.end_user_id)
        assert app is not None
        assert user is not None
        assert AppGenerateService.generate(app, user, {}, InvokeFrom.WEB_APP, session=session) is accepted
    assert "Failed to record personal WebApp usage" in caplog.text
    assert "Storage unavailable" not in caplog.text
