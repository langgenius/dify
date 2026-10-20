import dataclasses
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import NamedTuple
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, event, insert, select
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import Forbidden

from core.dify_builder.contract import RunStatus
from core.dify_builder.errors import BusyError, ConflictError, ModelUnavailableError, NotFoundError
from core.dify_builder.models import Action, Actor
from core.rbac import RBACPermission, RBACResourceScope
from extensions.application_services.rbac import build_rbac_resource_queries
from models import TenantAccountRole
from models.account import TenantAccountJoin
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.base import Base, TypeBase
from models.model import App, AppMode
from services.dify_builder import wiring
from services.dify_builder.service import AppAccess, SessionView
from services.enterprise.rbac_service import RBACService
from services.rbac.resource_queries import ResourceQueryService


def _rbac_queries(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    queries = MagicMock(spec=ResourceQueryService)
    queries.get_app_agent_binding.return_value = None
    queries.get_app_maintainer.return_value = None
    monkeypatch.setattr(wiring, "application_services", lambda: SimpleNamespace(rbac=SimpleNamespace(queries=queries)))
    return queries


def test_session_view_to_dict_projects_only_browser_fields() -> None:
    view = SessionView(
        session_id="s1",
        app_id="a1",
        version=3,
        state="fix.await_verify",
        canvas_read_only=False,
        run_status=RunStatus.WAITING_INPUT,
        interrupted=False,
        conversation_last_seq=7,
    )
    d = wiring.session_view_to_dict(view)
    assert d == {
        "session_id": "s1",
        "version": 3,
        "reply_language": "",
        "canvas_read_only": False,
        "run_status": "waiting_input",
        "interrupted": False,
        "conversation_last_seq": 7,
        "last_command_id": "",
        "phase": "understand",
        "actions": [],
    }


def test_public_session_projection_exposes_decision_and_strips_internal_revision_fields() -> None:
    decision = {
        "title": "What should Builder do next?",
        "description": "Choose one option to continue.",
        "options": [
            {
                "id": "approve_plan",
                "label": "Approve plan",
                "kind": "primary",
                "is_default": True,
            }
        ],
        "submit": {"id": "confirm", "label": "Submit", "kind": "primary"},
        "default_option_id": "approve_plan",
    }
    projected = wiring._public_session_view(
        {
            "session_id": "s1",
            "app_id": "a1",
            "version": 4,
            "reply_language": "ja",
            "state": "build.goal_analysis",
            "entry_mode": "build",
            "canvas_read_only": False,
            "run_status": "waiting_input",
            "interrupted": False,
            "conversation_last_seq": 8,
            "phase": "clarify",
            "actions": [
                {
                    "id": "submit_requirements",
                    "label": "Submit",
                    "kind": "primary",
                    "next_state": "build.resources",
                    "canvas_event": "apply_edit_plan",
                }
            ],
            "active_interaction": {
                "action_id": "submit_requirements",
                "card": {"seq": 8, "kind": "form", "payload": {}},
                "valid_at_version": 4,
            },
            "app_revision": {"observed": "old", "current": "new", "conflicted": True},
            "decision": decision,
            "checkpoint": {"id": "checkpoint-1"},
        },
        include_last_command_id=False,
    )

    assert projected == {
        "session_id": "s1",
        "version": 4,
        "reply_language": "ja",
        "canvas_read_only": False,
        "run_status": "waiting_input",
        "interrupted": False,
        "conversation_last_seq": 8,
        "phase": "clarify",
        "actions": [{"id": "submit_requirements", "label": "Submit", "kind": "primary"}],
        "active_interaction": {
            "action_id": "submit_requirements",
            "card_seq": 8,
            "valid_at_version": 4,
        },
        "app_revision": {"current": "new", "conflicted": True},
        "decision": decision,
    }


def test_settled_command_finished_sse_exposes_reply_language() -> None:
    view: dict[str, object] = {
        "session_id": "s1",
        "version": 3,
        "reply_language": "zh-Hans",
        "run_status": "waiting_input",
        "phase": "clarify",
        "actions": [],
    }

    frames = list(
        wiring.stream_advance_frames(
            view,
            None,
            False,
            emit_command_started=False,
            emit_command_finished_when_settled=True,
            command_id="command-1",
        )
    )

    event = json.loads(frames[0].split("data: ", 1)[1])
    assert event["event"] == "command_finished"
    assert event["data"]["reply_language"] == "zh-Hans"
    assert event["data"]["command_id"] == "command-1"


def test_error_map() -> None:
    assert wiring.dify_builder_error_response(ModelUnavailableError("private provider detail")) == (
        {"code": "model_unavailable", "message": "Builder model is unavailable", "recoverable": True},
        400,
    )
    not_found = wiring.dify_builder_error_response(NotFoundError("x"))
    assert not_found is not None
    assert not_found[1] == 404
    assert not_found[0]["code"] == "not_found"
    assert wiring.dify_builder_error_response(ConflictError("x")) == ({"code": "conflict"}, 409)
    assert wiring.dify_builder_error_response(BusyError("x")) == ({"code": "session_busy"}, 409)
    assert wiring.dify_builder_error_response(ValueError("x")) is None  # unknown → caller re-raises


def test_build_service_enqueue_calls_delay_with_dicts() -> None:
    with patch("services.dify_builder.wiring.advance_session") as task, patch("services.dify_builder.wiring.db"):
        svc = wiring.build_service()
        action = Action(kind="run_verify", base_version=2)
        actor = Actor(account_id="acc", tenant_id="ten")
        assert svc._authorize_app_fn is wiring._authorize_app
        svc._enqueue_fn("sid-1", action, actor, "tok-9")  # the injected enqueue
    task.delay.assert_called_once_with("sid-1", dataclasses.asdict(action), dataclasses.asdict(actor), "tok-9")


class _AuthorizerDb(NamedTuple):
    registry: scoped_session[Session]
    factory: sessionmaker[Session]
    open_transactions: Callable[[], int]


@pytest.fixture
def authorizer_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[_AuthorizerDb]:
    """Real App/membership rows; ``wiring.db`` is a real request-scoped session over SQLite."""
    engine = create_engine(f"sqlite:///{tmp_path / 'authorizer.sqlite3'}")
    Base.metadata.create_all(engine)
    TypeBase.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    registry = scoped_session(factory)
    database = SimpleNamespace(session=registry, engine=engine)
    monkeypatch.setattr(wiring, "db", database)
    queries = build_rbac_resource_queries(database_client=factory)
    monkeypatch.setattr(wiring, "application_services", lambda: SimpleNamespace(rbac=SimpleNamespace(queries=queries)))
    opened: list[int] = [0]

    def begin(_conn: object) -> None:
        opened[0] += 1

    def end(_conn: object) -> None:
        opened[0] = max(0, opened[0] - 1)

    event.listen(engine, "begin", begin)
    event.listen(engine, "commit", end)
    event.listen(engine, "rollback", end)
    try:
        yield _AuthorizerDb(registry, factory, lambda: opened[0])
    finally:
        registry.remove()
        engine.dispose()


def _seed_app(db: _AuthorizerDb, *, role: TenantAccountRole | None, app_tenant: str = "ten-1") -> None:
    with db.factory.begin() as session:
        session.add(
            App(
                id="app-1",
                tenant_id=app_tenant,
                mode="workflow",
                name="Builder app",
                tracing=None,
                enable_site=False,
                enable_api=False,
            )
        )
        if role is not None:
            session.add(TenantAccountJoin(tenant_id="ten-1", account_id="acc-1", role=role))


def test_authorize_app_legacy_requires_tenant_editor_role(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb
) -> None:
    _seed_app(authorizer_db, role=TenantAccountRole.EDITOR)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", False)
    check = MagicMock()
    monkeypatch.setattr(wiring, "check_app_permissions", check)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)

    check.assert_not_called()


def test_authorize_app_legacy_rejects_non_editor(monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb) -> None:
    _seed_app(authorizer_db, role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", False)

    with pytest.raises(Forbidden):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)


@pytest.mark.parametrize(
    ("access", "scenes"),
    [
        (AppAccess.EDIT, [RBACPermission.APP_EDIT]),
        (AppAccess.TEST_AND_RUN, [RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN]),
        (AppAccess.RELEASE, [RBACPermission.APP_EDIT, RBACPermission.APP_RELEASE_AND_VERSION]),
    ],
)
def test_authorize_app_rbac_enforces_base_and_operation_permission(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb, access: AppAccess, scenes: list[RBACPermission]
) -> None:
    _seed_app(authorizer_db, role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)
    queries = _rbac_queries(monkeypatch)
    check = MagicMock(return_value=True)
    monkeypatch.setattr(RBACService.CheckAccess, "check", check)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", access)

    queries.get_app_agent_binding.assert_called_once_with("ten-1", "app-1")
    queries.get_app_maintainer.assert_called_once_with("ten-1", "app-1")
    assert [item.kwargs["scene"] for item in check.call_args_list] == scenes
    assert all(
        item.args == ("ten-1", "acc-1")
        and item.kwargs["resource_type"] == RBACResourceScope.APP
        and item.kwargs["resource_id"] == "app-1"
        for item in check.call_args_list
    )


@pytest.mark.parametrize("edit_allowed", [False, True])
def test_authorize_app_rbac_requires_both_edit_and_run(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb, edit_allowed: bool
) -> None:
    _seed_app(authorizer_db, role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)
    _rbac_queries(monkeypatch)
    check = MagicMock(side_effect=[edit_allowed, False])
    monkeypatch.setattr(RBACService.CheckAccess, "check", check)

    with pytest.raises(Forbidden):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.TEST_AND_RUN)

    assert check.call_count == (2 if edit_allowed else 1)


def test_authorize_app_rbac_recognizes_the_app_maintainer(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb
) -> None:
    _seed_app(authorizer_db, role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)
    queries = _rbac_queries(monkeypatch)
    queries.get_app_maintainer.return_value = "acc-1"
    check = MagicMock()
    monkeypatch.setattr(RBACService.CheckAccess, "check", check)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.RELEASE)

    check.assert_not_called()


def test_authorize_app_rbac_refuses_agent_backed_apps(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb
) -> None:
    _seed_app(authorizer_db, role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)
    queries = _rbac_queries(monkeypatch)
    queries.get_app_agent_binding.return_value = MagicMock()
    check = MagicMock()
    monkeypatch.setattr(RBACService.CheckAccess, "check", check)

    with pytest.raises(NotFoundError):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)

    queries.get_app_maintainer.assert_not_called()
    check.assert_not_called()


@pytest.mark.parametrize("app_tenant", ["ten-1", "other-tenant"], ids=["missing", "foreign"])
def test_authorize_app_rejects_missing_or_foreign_app(authorizer_db: _AuthorizerDb, app_tenant: str) -> None:
    if app_tenant != "ten-1":
        _seed_app(authorizer_db, role=TenantAccountRole.EDITOR, app_tenant=app_tenant)

    with pytest.raises(NotFoundError, match="app not found"):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)
    assert authorizer_db.open_transactions() == 0


def test_authorize_app_rejects_account_outside_tenant(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb
) -> None:
    _seed_app(authorizer_db, role=None)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)

    with pytest.raises(Forbidden):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)
    assert authorizer_db.open_transactions() == 0


@pytest.mark.parametrize("rbac", [False, True], ids=["legacy", "rbac"])
def test_authorize_app_leaves_no_sql_open_for_the_callers_external_work(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb, rbac: bool
) -> None:
    """The production locator and evaluator leave no SQL for the caller's next phase."""
    _seed_app(authorizer_db, role=TenantAccountRole.EDITOR)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", rbac)
    monkeypatch.setattr(RBACService.CheckAccess, "check", lambda *_args, **_kwargs: True)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.TEST_AND_RUN)

    assert not authorizer_db.registry().in_transaction()
    assert authorizer_db.open_transactions() == 0


@pytest.mark.parametrize("write", ["orm_flushed", "core_dml", "orm_pending"])
def test_authorize_app_never_ends_a_callers_transaction(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb, write: str
) -> None:
    """A transaction the caller already holds (with its own flushed/Core write) is left exactly as it was."""
    _seed_app(authorizer_db, role=TenantAccountRole.EDITOR)
    scoped = authorizer_db.registry()
    if write == "orm_flushed":
        scoped.add(TenantAccountJoin(tenant_id="ten-2", account_id="acc-1", role=TenantAccountRole.EDITOR))
        scoped.flush()
    elif write == "core_dml":
        scoped.execute(
            insert(TenantAccountJoin).values(
                id="join-2", tenant_id="ten-2", account_id="acc-1", role=TenantAccountRole.EDITOR
            )
        )
    else:
        scoped.add(TenantAccountJoin(tenant_id="ten-2", account_id="acc-1", role=TenantAccountRole.EDITOR))
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", False)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)

    assert scoped.in_transaction()
    staged = select(TenantAccountJoin.id).where(TenantAccountJoin.tenant_id == "ten-2")
    assert scoped.scalar(staged) is not None
    with authorizer_db.factory() as other:
        assert other.scalar(staged) is None
    scoped.rollback()


@pytest.mark.parametrize(
    ("access", "scenes"),
    [
        (AppAccess.EDIT, [RBACPermission.APP_EDIT]),
        (AppAccess.TEST_AND_RUN, [RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN]),
        (AppAccess.RELEASE, [RBACPermission.APP_EDIT, RBACPermission.APP_RELEASE_AND_VERSION]),
    ],
)
def test_actual_enabled_rbac_checks_run_after_all_locator_sql_ends(
    monkeypatch: pytest.MonkeyPatch, authorizer_db: _AuthorizerDb, access: AppAccess, scenes: list[RBACPermission]
) -> None:
    """Closing SQL after enforcement is too late: witness the actual external permission call."""
    _seed_app(authorizer_db, role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)
    checked: list[tuple[str, str, RBACPermission, object, str | None, bool, int]] = []

    def check(
        tenant_id: str, account_id: str, *, scene: RBACPermission, resource_type: object, resource_id: str | None
    ) -> bool:
        checked.append(
            (
                tenant_id,
                account_id,
                scene,
                resource_type,
                resource_id,
                authorizer_db.registry().in_transaction(),
                authorizer_db.open_transactions(),
            )
        )
        return True

    monkeypatch.setattr(RBACService.CheckAccess, "check", check)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", access)

    assert [(tenant, account, scene, str(scope), app) for tenant, account, scene, scope, app, _, _ in checked] == [
        ("ten-1", "acc-1", scene, "app", "app-1") for scene in scenes
    ]
    assert [(scene, scoped, connections) for _, _, scene, _, _, scoped, connections in checked] == [
        (scene, False, 0) for scene in scenes
    ]
    assert not authorizer_db.registry().in_transaction()
    assert authorizer_db.open_transactions() == 0


@pytest.mark.parametrize(
    ("scope", "status", "eligible"),
    [
        (None, AgentStatus.ACTIVE, True),
        (AgentScope.ROSTER, AgentStatus.ACTIVE, False),
        (AgentScope.ROSTER, AgentStatus.ARCHIVED, False),
        (AgentScope.WORKFLOW_ONLY, AgentStatus.ACTIVE, False),
        (AgentScope.WORKFLOW_ONLY, AgentStatus.ARCHIVED, False),
    ],
    ids=["unbound-agent-mode", "roster", "archived-roster", "workflow-only", "archived-workflow-only"],
)
def test_actual_enabled_rbac_preserves_plain_app_agent_distinction(
    monkeypatch: pytest.MonkeyPatch,
    authorizer_db: _AuthorizerDb,
    scope: AgentScope | None,
    status: AgentStatus,
    eligible: bool,
) -> None:
    _seed_app(authorizer_db, role=TenantAccountRole.NORMAL)
    with authorizer_db.factory.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.mode = AppMode.AGENT
        if scope is not None:
            # Owning an Agent's backing App must not turn its PlainApp check into an owner bypass.
            app.maintainer = "acc-1"
            session.add(
                Agent(
                    tenant_id="ten-1",
                    name="bound agent",
                    scope=scope,
                    status=status,
                    source=AgentSource.AGENT_APP if scope is AgentScope.ROSTER else AgentSource.WORKFLOW,
                    app_id="app-1" if scope is AgentScope.ROSTER else None,
                    backing_app_id="app-1" if scope is AgentScope.WORKFLOW_ONLY else None,
                )
            )
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)
    checked: list[RBACPermission] = []

    def check(*_args: object, scene: RBACPermission, **_kwargs: object) -> bool:
        checked.append(scene)
        return True

    monkeypatch.setattr(RBACService.CheckAccess, "check", check)
    if eligible:
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)
        assert checked == [RBACPermission.APP_EDIT]
    else:
        with pytest.raises(NotFoundError, match="app not found"):
            wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)
        assert checked == []
    assert not authorizer_db.registry().in_transaction()
    assert authorizer_db.open_transactions() == 0
