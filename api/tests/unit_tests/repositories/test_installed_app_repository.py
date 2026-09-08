from dataclasses import replace
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, AppMode, AppModelConfig, IconType, InstalledApp, RecommendedApp
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_service import (
    InstalledAppInfo,
    InstalledAppOwnedByWorkspaceError,
    InstalledAppRecord,
)

_USED_AT = datetime(2026, 9, 6, 12, 30, 45)
_VIEWER_TENANT_ID = "11111111-1111-4111-8111-111111111111"
_OWNER_TENANT_ID = "22222222-2222-4222-8222-222222222222"


def _installation(*, app_id: str) -> InstalledApp:
    return InstalledApp(
        app_id=app_id,
        tenant_id=_VIEWER_TENANT_ID,
        app_owner_tenant_id=_OWNER_TENANT_ID,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )


def test_resolve_returns_pure_reference_to_cross_workspace_app(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        # Admission must not add public, published, or app-mode constraints.
        app = App(
            tenant_id=_OWNER_TENANT_ID,
            name="Installed app",
            mode=AppMode.AGENT,
            is_public=False,
            enable_site=True,
            enable_api=True,
        )
        session.add(app)
        session.flush()
        installed_app = _installation(app_id=app.id)
        session.add(installed_app)
        session.flush()
        installed_app_id = installed_app.id
        app_id = app.id

    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)
    result = repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID)

    assert result == InstalledAppRef(id=installed_app_id, app_id=app_id, tenant_id=_VIEWER_TENANT_ID)
    assert inspect(result, raiseerr=False) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is not None


def test_missing_installation_returns_none(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=str(uuid4()), tenant_id=_VIEWER_TENANT_ID) is None


@pytest.mark.parametrize("orphaned", [False, True])
def test_other_workspace_cannot_resolve_or_clean_up_installation(
    sqlite_session_factory: sessionmaker[Session],
    orphaned: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        app_id = str(uuid4())
        if not orphaned:
            app = App(
                id=app_id,
                tenant_id=_OWNER_TENANT_ID,
                name="Installed app",
                mode=AppMode.COMPLETION,
                enable_site=True,
                enable_api=True,
            )
            session.add(app)
        installed_app = _installation(app_id=app_id)
        session.add(installed_app)
        session.flush()
        installed_app_id = installed_app.id

    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_OWNER_TENANT_ID) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is not None


def test_orphan_cleanup_is_committed_and_idempotent(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        installed_app = _installation(app_id=str(uuid4()))
        session.add(installed_app)
        session.flush()
        installed_app_id = installed_app.id

    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is None
    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID) is None


@pytest.fixture
def installed_app(sqlite_session_factory: sessionmaker[Session]) -> InstalledApp:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Shared app", mode=AppMode.COMPLETION, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        installation = InstalledApp(
            tenant_id=str(uuid4()),
            app_id=app.id,
            app_owner_tenant_id=app.tenant_id,
            position=7,
            is_pinned=True,
        )
        session.add(installation)
    return installation


def _reference(installation: InstalledApp) -> InstalledAppRef:
    return InstalledAppRef(id=installation.id, app_id=installation.app_id, tenant_id=installation.tenant_id)


def test_record_commits_usage_for_cross_workspace_app_without_changing_installation_settings(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp
) -> None:
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at == _USED_AT
        assert stored.tenant_id != stored.app_owner_tenant_id
        assert stored.app_owner_tenant_id == installed_app.app_owner_tenant_id
        assert stored.position == 7
        assert stored.is_pinned is True


@pytest.mark.parametrize("field", ["id", "tenant_id", "app_id"])
def test_record_requires_every_part_of_admitted_installation_scope(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp, field: str
) -> None:
    reference = replace(_reference(installed_app), **{field: str(uuid4())})
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    with pytest.raises(InstalledAppNotFoundError, match=reference.id):
        repository.record(installed_app=reference, used_at=_USED_AT)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at is None


def test_record_is_repeatable_and_committed_usage_survives_a_later_rollback(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp
) -> None:
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)
    repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)
    repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        stored.last_used_at = None
        session.flush()
        session.rollback()

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at == _USED_AT


def test_record_rolls_back_and_preserves_commit_error(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp
) -> None:
    failure = RuntimeError("usage commit unavailable")
    repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    @event.listens_for(repository_factory, "before_commit")
    def fail_commit(_session: Session) -> None:
        raise failure

    repository = SQLAlchemyInstalledAppRepository(session_factory=repository_factory)
    with pytest.raises(RuntimeError) as raised:
        repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)

    assert raised.value is failure
    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at is None


def _app_with_publication(
    session: Session,
    *,
    name: str = "Shared app",
    mode: AppMode = AppMode.COMPLETION,
    published: bool = True,
) -> App:
    app = App(
        tenant_id=_OWNER_TENANT_ID,
        name=name,
        description="",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background=None,
        use_icon_as_answer_icon=False,
        is_public=False,
        enable_site=False,
        enable_api=False,
    )
    session.add(app)
    session.flush()
    if published and mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
        # Preserve the existing reference-existence check, including draft versions.
        workflow = Workflow(
            id=str(uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            kind=WorkflowKind.STANDARD,
            version="draft",
            graph='{"nodes":[],"edges":[]}',
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        session.add(workflow)
        app.workflow_id = workflow.id
    elif published:
        configuration = AppModelConfig(app_id=app.id)
        session.add(configuration)
        session.flush()
        app.app_model_config_id = configuration.id
    return app


def _recommend(session: Session, app_id: str) -> RecommendedApp:
    recommended = RecommendedApp(
        app_id=app_id,
        description={"en-US": "recommended"},
        copyright="copyright",
        privacy_policy="",
        category="productivity",
        install_count=4,
    )
    session.add(recommended)
    session.flush()
    return recommended


@pytest.mark.parametrize("mode", list(AppMode))
@pytest.mark.parametrize("publication", ["present", "missing", "dangling"])
def test_candidate_and_detail_publication_filters_preserve_mode_and_reference_rules(
    sqlite_session_factory: sessionmaker[Session], mode: AppMode, publication: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = _app_with_publication(session, mode=mode, published=publication == "present")
        if publication == "dangling":
            if mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
                app.workflow_id = str(uuid4())
            else:
                app.app_model_config_id = str(uuid4())
        installation = _installation(app_id=app.id)
        session.add(installation)
        session.flush()
        reference = _reference(installation)
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    candidates = repository.get_candidates(tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=10, app_id=None, name=None)
    detail = repository.get_published(installed_app=reference)

    if publication == "present" and mode != AppMode.AGENT:
        assert len(candidates) == 1
        assert candidates[0] == detail
        assert candidates[0].app.mode == mode
    else:
        assert candidates == ()
        assert detail is None


def test_candidates_return_detached_nested_data_and_stored_installation_owner(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    stored_owner_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        app = _app_with_publication(session)
        installation = _installation(app_id=app.id)
        installation.app_owner_tenant_id = stored_owner_id
        installation.last_used_at = _USED_AT
        session.add(installation)
        session.flush()
        installation_id, app_id = installation.id, app.id
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    result = repository.get_candidates(tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=10, app_id=None, name=None)

    assert result == (
        InstalledAppRecord(
            id=installation_id,
            app=InstalledAppInfo(
                id=app_id,
                name="Shared app",
                description="",
                mode="completion",
                icon_type="emoji",
                icon="robot",
                icon_background=None,
                use_icon_as_answer_icon=False,
            ),
            app_owner_tenant_id=stored_owner_id,
            is_pinned=False,
            last_used_at=_USED_AT,
        ),
    )
    assert inspect(result[0], raiseerr=False) is None
    assert inspect(result[0].app, raiseerr=False) is None


def test_candidates_order_and_cursor_cover_pin_groups_ties_and_null_dates(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ordered: list[str] = []
    rows = [
        (True, _USED_AT),
        (True, _USED_AT),
        (True, _USED_AT - timedelta(days=1)),
        (True, None),
        (True, None),
        (False, _USED_AT + timedelta(days=1)),
        (False, _USED_AT),
        (False, _USED_AT),
        (False, None),
        (False, None),
    ]
    with sqlite_session_factory.begin() as session:
        for number, (is_pinned, last_used_at) in enumerate(rows, start=1):
            app = _app_with_publication(session)
            installation = _installation(app_id=app.id)
            installation.id = f"00000000-0000-4000-8000-{number:012d}"
            installation.is_pinned = is_pinned
            installation.last_used_at = last_used_at
            session.add(installation)
            ordered.append(installation.id)
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    all_rows = repository.get_candidates(tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=20, app_id=None, name=None)

    assert [row.id for row in all_rows] == ordered
    for index, row in enumerate(all_rows):
        after = repository.get_candidates(
            tenant_id=_VIEWER_TENANT_ID, cursor=row.cursor(), limit=20, app_id=None, name=None
        )
        assert [candidate.id for candidate in after] == ordered[index + 1 :]
    assert repository.get_candidates(tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=0, app_id=None, name=None) == ()
    assert (
        repository.get_candidates(tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=2, app_id=None, name=None)
        == all_rows[:2]
    )


@pytest.mark.parametrize("search", ["  50%_\\  ", "50%_\\", "literal"])
def test_candidates_filter_literal_case_insensitive_name_and_app_with_workspace_scope(
    sqlite_session_factory: sessionmaker[Session], search: str
) -> None:
    with sqlite_session_factory.begin() as session:
        matching = _app_with_publication(session, name="LITERAL 50%_\\ suffix")
        another = _app_with_publication(session, name="Literal 5000 suffix")
        foreign = _app_with_publication(session, name=matching.name)
        session.add_all([_installation(app_id=matching.id), _installation(app_id=another.id)])
        foreign_installation = _installation(app_id=foreign.id)
        foreign_installation.tenant_id = _OWNER_TENANT_ID
        session.add(foreign_installation)
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    candidates = repository.get_candidates(
        tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=10, app_id=matching.id, name=search
    )

    assert [row.app.id for row in candidates] == [matching.id]
    if search != "literal":
        by_name = repository.get_candidates(
            tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=10, app_id=None, name=search
        )
        assert [row.app.id for row in by_name] == [matching.id]
    assert len(repository.get_candidates(tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=10, app_id="", name="  ")) == 2
    assert (
        repository.get_candidates(tenant_id=_VIEWER_TENANT_ID, cursor=None, limit=10, app_id=foreign.id, name=None)
        == ()
    )


@pytest.mark.parametrize("field", ["id", "tenant_id", "app_id"])
@pytest.mark.parametrize("operation", ["get_published", "uninstall", "set_pinned"])
def test_management_operations_require_all_admitted_reference_fields(
    sqlite_session_factory: sessionmaker[Session], field: str, operation: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = _app_with_publication(session)
        installation = _installation(app_id=app.id)
        session.add(installation)
        session.flush()
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)
    reference = replace(_reference(installation), **{field: str(uuid4())})

    if operation == "get_published":
        assert repository.get_published(installed_app=reference) is None
    elif operation == "uninstall":
        with pytest.raises(InstalledAppNotFoundError, match=reference.id):
            repository.uninstall(installed_app=reference)
    else:
        with pytest.raises(InstalledAppNotFoundError, match=reference.id):
            repository.set_pinned(installed_app=reference, is_pinned=True)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installation.id)
        assert stored is not None
        assert stored.is_pinned is False


def test_uninstall_removes_only_foreign_installation_even_when_app_is_unpublished(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        app = _app_with_publication(session, published=False)
        recommended = _recommend(session, app.id)
        installation = _installation(app_id=app.id)
        session.add(installation)
        session.flush()
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    repository.uninstall(installed_app=_reference(installation))

    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installation.id) is None
        assert session.get(App, app.id) is not None
        stored = session.get(RecommendedApp, recommended.id)
        assert stored is not None
        assert stored.install_count == 4


def test_uninstall_respects_stored_installation_ownership(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        app = _app_with_publication(session)
        installation = _installation(app_id=app.id)
        # The installation's stored owner is the existing policy source.
        installation.app_owner_tenant_id = _VIEWER_TENANT_ID
        session.add(installation)
        session.flush()
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    with pytest.raises(InstalledAppOwnedByWorkspaceError, match=installation.id):
        repository.uninstall(installed_app=_reference(installation))

    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installation.id) is not None


@pytest.mark.parametrize("is_pinned", [True, False])
def test_pin_updates_only_pin_state_including_unpublished_apps(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp, is_pinned: bool
) -> None:
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    repository.set_pinned(installed_app=_reference(installed_app), is_pinned=is_pinned)
    repository.set_pinned(installed_app=_reference(installed_app), is_pinned=is_pinned)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.is_pinned is is_pinned
        assert stored.last_used_at is None
        assert stored.position == 7
        assert stored.app_owner_tenant_id == installed_app.app_owner_tenant_id


@pytest.mark.parametrize("operation", ["uninstall", "set_pinned"])
def test_management_mutations_roll_back_and_preserve_database_failure(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp, operation: str
) -> None:
    failure = RuntimeError("installation commit unavailable")
    repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    @event.listens_for(repository_factory, "before_commit")
    def fail_commit(session: Session) -> None:
        session.flush()
        raise failure

    repository = SQLAlchemyInstalledAppRepository(session_factory=repository_factory)
    if operation == "uninstall":
        with pytest.raises(RuntimeError, match="installation commit unavailable") as caught:
            repository.uninstall(installed_app=_reference(installed_app))
    else:
        with pytest.raises(RuntimeError, match="installation commit unavailable") as caught:
            repository.set_pinned(installed_app=_reference(installed_app), is_pinned=False)

    assert caught.value is failure
    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.is_pinned is True
