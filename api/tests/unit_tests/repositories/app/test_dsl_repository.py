"""DSL overwrite reads expose immutable records and preserve their transaction owner."""

import json
from collections.abc import Callable

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from models import App, AppMode, Workflow
from repositories.app.dsl_repository import AppDslOverwriteRepository
from services.entities.dsl_entities import AppDslOverwriteTarget
from services.errors.base import NoPermissionError
from tests.helpers.unit.model_factories import make_app, make_workflow

_CIPHERTEXT = json.dumps({"KEY": {"id": "key", "name": "KEY", "value_type": "secret", "value": "wrapped-ciphertext"}})


def _invoke(
    repository: AppDslOverwriteRepository,
    operation: str,
    *,
    tenant_id: str = "tenant-1",
    account_id: str = "account-1",
    app_id: str = "app-1",
    rbac_allowed: bool,
) -> AppDslOverwriteTarget | None:
    loader: Callable[..., AppDslOverwriteTarget | None] = getattr(repository, operation)
    return loader(
        tenant_id=tenant_id,
        account_id=account_id,
        app_id=app_id,
        rbac_allowed=rbac_allowed,
    )


@pytest.mark.parametrize("operation", ["snapshot", "load"])
@pytest.mark.parametrize(
    ("maintainer", "rbac_allowed", "outcome"),
    [
        ("other", True, "allowed"),
        ("account-1", False, "allowed"),
        ("other", False, "denied"),
    ],
)
def test_overwrite_reads_authorize_and_return_persistence_neutral_ciphertext(
    sqlite_session_factory: sessionmaker[Session],
    operation: str,
    maintainer: str,
    rbac_allowed: bool,
    outcome: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        app = make_app(mode=AppMode.WORKFLOW, maintainer=maintainer)
        draft = make_workflow(workflow_id="workflow-1")
        draft._environment_variables = _CIPHERTEXT
        session.add_all([app, draft])

    target: AppDslOverwriteTarget | None = None
    with sqlite_session_factory() as import_session:
        repository = AppDslOverwriteRepository(sessions=sqlite_session_factory, import_session=import_session)
        if outcome == "denied":
            with pytest.raises(NoPermissionError, match="permission to overwrite"):
                _invoke(repository, operation, rbac_allowed=rbac_allowed)
        else:
            target = _invoke(repository, operation, rbac_allowed=rbac_allowed)
            assert isinstance(target, AppDslOverwriteTarget)
        assert import_session.in_transaction() is (operation == "load")

    if target is not None:
        assert target.mode == AppMode.WORKFLOW
        assert target.workflow is not None
        assert target.workflow.environment_variables == _CIPHERTEXT


@pytest.mark.parametrize("operation", ["snapshot", "load"])
def test_overwrite_read_returns_target_without_draft(
    sqlite_session_factory: sessionmaker[Session], operation: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_app(mode=AppMode.ADVANCED_CHAT, maintainer="account-1"))

    with sqlite_session_factory() as import_session:
        repository = AppDslOverwriteRepository(sessions=sqlite_session_factory, import_session=import_session)
        target = _invoke(repository, operation, rbac_allowed=False)

    assert target == AppDslOverwriteTarget(mode=AppMode.ADVANCED_CHAT, workflow=None)


def test_import_load_rechecks_maintainer_after_preflight(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_app(mode=AppMode.WORKFLOW, maintainer="account-1"))

    with sqlite_session_factory() as import_session:
        repository = AppDslOverwriteRepository(sessions=sqlite_session_factory, import_session=import_session)
        assert (
            repository.snapshot(tenant_id="tenant-1", account_id="account-1", app_id="app-1", rbac_allowed=False)
            is not None
        )
        # Keep an older identity-map entry so load must refresh its authorization facts.
        stale_app = import_session.get(App, "app-1")
        assert stale_app is not None
        import_session.commit()
        with sqlite_session_factory.begin() as session:
            current = session.get(App, "app-1")
            assert current is not None
            current.maintainer = "other"
        with pytest.raises(NoPermissionError, match="permission to overwrite"):
            repository.load(tenant_id="tenant-1", account_id="account-1", app_id="app-1", rbac_allowed=False)


@pytest.mark.parametrize("operation", ["snapshot", "load"])
@pytest.mark.parametrize("invisible_reason", ["missing", "other-tenant", "non-normal"])
def test_overwrite_read_hides_missing_out_of_scope_and_non_normal_apps(
    sqlite_session_factory: sessionmaker[Session], operation: str, invisible_reason: str
) -> None:
    with sqlite_session_factory.begin() as session:
        if invisible_reason != "missing":
            app = make_app(
                tenant_id="other-tenant" if invisible_reason == "other-tenant" else "tenant-1",
                mode=AppMode.WORKFLOW,
                maintainer="account-1",
            )
            if invisible_reason == "non-normal":
                session.add(app)
                session.flush()
                session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": app.id})
            else:
                session.add(app)

    with sqlite_session_factory() as import_session:
        repository = AppDslOverwriteRepository(sessions=sqlite_session_factory, import_session=import_session)
        target = _invoke(repository, operation, rbac_allowed=True)

    assert target is None


@pytest.mark.parametrize("finish", ["commit", "rollback"])
def test_import_load_leaves_app_and_workflow_transaction_to_its_owner(
    sqlite_session_factory: sessionmaker[Session], finish: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = make_app(mode=AppMode.WORKFLOW, maintainer="account-1")
        draft = make_workflow(workflow_id="workflow-1")
        draft._environment_variables = _CIPHERTEXT
        session.add_all([app, draft])

    replacement_ciphertext = _CIPHERTEXT.replace("wrapped-ciphertext", "replacement-ciphertext")
    with sqlite_session_factory() as import_session:
        app = import_session.get(App, "app-1")
        draft = import_session.get(Workflow, "workflow-1")
        assert app is not None
        assert draft is not None
        app.mode = AppMode.ADVANCED_CHAT
        draft._environment_variables = replacement_ciphertext

        repository = AppDslOverwriteRepository(sessions=sqlite_session_factory, import_session=import_session)
        target = repository.load(tenant_id="tenant-1", account_id="account-1", app_id="app-1", rbac_allowed=False)

        assert target is not None
        assert target.mode == AppMode.ADVANCED_CHAT
        assert target.workflow is not None
        assert target.workflow.environment_variables == replacement_ciphertext
        assert import_session.in_transaction()
        if finish == "commit":
            import_session.commit()
        else:
            import_session.rollback()

    with sqlite_session_factory() as verification_session:
        persisted_app = verification_session.get(App, "app-1")
        persisted_draft = verification_session.get(Workflow, "workflow-1")
        assert persisted_app is not None
        assert persisted_draft is not None
        if finish == "commit":
            assert persisted_app.mode == AppMode.ADVANCED_CHAT
            assert persisted_draft._environment_variables == replacement_ciphertext
        else:
            assert persisted_app.mode == AppMode.WORKFLOW
            assert persisted_draft._environment_variables == _CIPHERTEXT
