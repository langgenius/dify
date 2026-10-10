"""DSL preflight reads end before key I/O and recheck ownership when importing."""

import json

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from models import App
from repositories.app.dsl_repository import AppDslOverwriteRepository
from services.errors.base import NoPermissionError
from tests.unit_tests.model_factories import make_app, make_workflow


@pytest.mark.parametrize(
    ("tenant_id", "maintainer", "rbac_allowed", "outcome"),
    [
        ("tenant-1", "other", True, "allowed"),
        ("tenant-1", "account-1", False, "allowed"),
        ("tenant-1", "other", False, "denied"),
        ("other", "account-1", True, "missing"),
    ],
)
def test_snapshot_authorizes_owner_and_returns_ciphertext_after_closing_session(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    maintainer: str,
    rbac_allowed: bool,
    outcome: str,
) -> None:
    ciphertext = json.dumps({"KEY": {"id": "key", "name": "KEY", "value_type": "secret", "value": "wrapped"}})
    with sqlite_session_factory.begin() as session:
        app = make_app(tenant_id=tenant_id)
        app.maintainer = maintainer
        draft = make_workflow(tenant_id=tenant_id)
        draft._environment_variables = ciphertext
        session.add_all([app, draft])
    sessions: list[Session] = []

    def opened(session: Session, *_args: object) -> None:
        sessions.append(session)

    def decrypt(**_kwargs: object) -> str:
        pytest.fail("The overwrite repository must return ciphertext")

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", decrypt)
    event.listen(sqlite_session_factory, "after_begin", opened)
    try:
        with sqlite_session_factory() as import_session:
            repository = AppDslOverwriteRepository(sessions=sqlite_session_factory, import_session=import_session)
            if outcome == "denied":
                with pytest.raises(NoPermissionError):
                    repository.snapshot(
                        tenant_id="tenant-1", account_id="account-1", app_id="app-1", rbac_allowed=rbac_allowed
                    )
            else:
                target = repository.snapshot(
                    tenant_id="tenant-1", account_id="account-1", app_id="app-1", rbac_allowed=rbac_allowed
                )
                if outcome == "missing":
                    assert target is None
                else:
                    assert target is not None
                    assert target.workflow is not None
                    assert target.workflow.environment_variables == ciphertext
            assert not import_session.in_transaction()
            assert sessions
            assert all(not session.in_transaction() for session in sessions)
    finally:
        event.remove(sqlite_session_factory, "after_begin", opened)


def test_import_rechecks_the_maintainer_after_preflight(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        app = make_app()
        app.maintainer = "account-1"
        session.add(app)
    with sqlite_session_factory() as import_session:
        repository = AppDslOverwriteRepository(sessions=sqlite_session_factory, import_session=import_session)
        assert (
            repository.snapshot(tenant_id="tenant-1", account_id="account-1", app_id="app-1", rbac_allowed=False)
            is not None
        )
        app = import_session.get(App, "app-1")
        assert app is not None
        import_session.commit()
        with sqlite_session_factory.begin() as session:
            current = session.get(App, "app-1")
            assert current is not None
            current.maintainer = "other"
        with pytest.raises(NoPermissionError):
            repository.load(tenant_id="tenant-1", account_id="account-1", app_id="app-1", rbac_allowed=False)
