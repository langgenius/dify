"""HTTP contracts for InstalledApp management with real admission and persistence."""

import base64
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from flask import Flask, got_request_exception
from flask.testing import FlaskClient
from sqlalchemy import Connection, delete, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

import controllers.console.explore.installed_app as module
from controllers.console.app.app import AppListBaseQuery
from enums import WebAppAccessMode
from models import Account, App, InstalledApp, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.model import AppMode, AppModelConfig, IconType
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.entities.app_list_entities import AppListSortBy
from services.installed_app_access_service import InstalledAppAccessService
from services.installed_app_service import (
    InstalledAppCursor,
    InstalledAppListMode,
    InstalledAppService,
    InstalledAppSortCursor,
)
from services.webapp_access_query_service import WebAppAccessUnavailableError
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import (
    _assert_json_response,
    _Harness,
    harness,
)

__all__ = ["harness"]

_USED_AT = datetime(2024, 1, 1)


@dataclass
class _InstalledAppServices:
    management: InstalledAppService


@dataclass
class _Services:
    installed_apps: _InstalledAppServices


@dataclass
class _Management:
    harness: _Harness
    session_factory: sessionmaker[Session]
    services: _Services
    sessions: list[Session]
    denied_app_ids: set[str] = field(default_factory=set)
    visibility_calls: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)
    signed_files: list[str] = field(default_factory=list)
    visibility_error: WebAppAccessUnavailableError | None = None

    @property
    def client(self) -> FlaskClient:
        return self.harness.app.test_client()

    def url(self, installed_app_id: str | None = None) -> str:
        return f"/installed-apps/{installed_app_id or self.harness.installed_app.id}"

    def assert_sessions_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def get_access_modes(self, *, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]:
        self.assert_sessions_closed()
        if self.visibility_error is not None:
            raise self.visibility_error
        return dict.fromkeys(app_ids, WebAppAccessMode.PUBLIC)

    def get_user_permissions(self, *, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]:
        self.assert_sessions_closed()
        self.visibility_calls.append((user_id, tuple(app_ids)))
        return {app_id: app_id not in self.denied_app_ids for app_id in app_ids}


@pytest.fixture
def management(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> _Management:
    factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)
    tenant = harness.account.current_tenant
    assert tenant is not None
    harness.account.role = TenantAccountRole.ADMIN
    with factory.begin() as session:
        session.add_all(
            [
                harness.account,
                tenant,
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=harness.account.id,
                    current=True,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        app = session.get(App, harness.target_app.id)
        assert app is not None
        app.description = "Description"
        app.icon_type = IconType.EMOJI
        app.icon = "robot"
        app.icon_background = "#FFFFFF"
        app.use_icon_as_answer_icon = False
        _publish(session, app)
    sessions: list[Session] = []

    @event.listens_for(factory, "after_begin")
    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    services = _Services(
        installed_apps=_InstalledAppServices(
            management=InstalledAppService(
                installed_apps=SQLAlchemyInstalledAppRepository(session_factory=factory),
                get_workspace_role=WorkspaceRepository(factory).get_account_role,
                get_visible_app_ids=None,
            )
        )
    )
    management = _Management(harness, factory, services, sessions)

    def sign_icon(file_id: str) -> str:
        management.assert_sessions_closed()
        management.signed_files.append(file_id)
        return f"/signed-files/{file_id}"

    monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(module.file_helpers, "get_signed_file_url", sign_icon)
    harness.api.add_resource(module.InstalledAppsListApi, "/installed-apps")
    harness.api.add_resource(module.InstalledAppApi, "/installed-apps/<uuid:installed_app_id>")
    return management


def _publish(session: Session, app: App) -> None:
    if app.mode in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            kind=WorkflowKind.STANDARD,
            version="1",
            graph='{"nodes":[],"edges":[]}',
            _features="{}",
            created_by=str(uuid4()),
            _environment_variables=[],
            _conversation_variables=[],
            _rag_pipeline_variables=[],
        )
        session.add(workflow)
        session.flush()
        app.workflow_id = workflow.id
    else:
        config = AppModelConfig(app_id=app.id)
        session.add(config)
        session.flush()
        app.app_model_config_id = config.id


def _installation(
    management: _Management,
    *,
    name: str = "Another app",
    mode: AppMode = AppMode.CHAT,
    published: bool = True,
    tenant_id: str | None = None,
    app_owner_tenant_id: str | None = None,
    installed_app_id: str | None = None,
    pinned: bool = False,
    last_used_at: datetime | None = _USED_AT,
) -> tuple[InstalledApp, App]:
    with management.session_factory.begin() as session:
        app = App(
            tenant_id=app_owner_tenant_id or str(uuid4()),
            name=name,
            description="Description",
            mode=mode,
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
            enable_site=True,
            enable_api=True,
            is_public=True,
        )
        session.add(app)
        session.flush()
        if published:
            _publish(session, app)
        installed = InstalledApp(
            app_id=app.id,
            tenant_id=tenant_id or management.harness.installed_app.tenant_id,
            app_owner_tenant_id=app.tenant_id,
            is_pinned=pinned,
            last_used_at=last_used_at,
        )
        if installed_app_id is not None:
            installed.id = installed_app_id
        session.add(installed)
    return installed, app


def _clear_installations(management: _Management) -> None:
    with management.session_factory.begin() as session:
        session.execute(delete(InstalledApp))


def _enable_visibility(management: _Management) -> None:
    def unexpected_single_permission(*, user_id: str, app_id: str) -> bool:
        pytest.fail(f"Listing should use batch permissions: {user_id=}, {app_id=}")

    repository = SQLAlchemyInstalledAppRepository(session_factory=management.session_factory)
    access = InstalledAppAccessService(
        installed_apps=repository,
        is_user_allowed=unexpected_single_permission,
        get_access_modes=management.get_access_modes,
        get_user_permissions=management.get_user_permissions,
    )
    management.services.installed_apps.management = InstalledAppService(
        installed_apps=repository,
        get_workspace_role=WorkspaceRepository(management.session_factory).get_account_role,
        get_visible_app_ids=access.get_visible_app_ids,
    )


def test_response_schema_preserves_domain_types_and_default_page_size() -> None:
    assert module.InstalledAppsListQuery().limit == 20
    assert module.InstalledAppsListQuery().mode == "all"
    app_schema = module.InstalledAppInfoResponse.model_json_schema(mode="serialization")
    assert set(app_schema["properties"]) == {
        "id",
        "name",
        "description",
        "mode",
        "icon_type",
        "icon",
        "icon_background",
        "use_icon_as_answer_icon",
        "icon_url",
    }
    assert app_schema["properties"]["mode"]["$ref"].endswith("/AppMode")
    assert any(item.get("$ref", "").endswith("/IconType") for item in app_schema["properties"]["icon_type"]["anyOf"])


def test_list_mode_schema_matches_studio_values_and_default() -> None:
    installed_mode = module.InstalledAppsListQuery.model_json_schema()["properties"]["mode"]
    studio_mode = AppListBaseQuery.model_json_schema()["properties"]["mode"]

    assert installed_mode["enum"] == studio_mode["enum"]
    assert installed_mode["default"] == studio_mode["default"] == "all"


def test_list_sort_schema_reuses_studio_options_without_changing_default_order() -> None:
    installed_sort = module.InstalledAppsListQuery.model_json_schema()["properties"]["sort_by"]
    studio_sort = AppListBaseQuery.model_json_schema()["properties"]["sort_by"]

    assert installed_sort["anyOf"] == [{"enum": studio_sort["enum"], "type": "string"}, {"type": "null"}]
    assert module.InstalledAppsListQuery().sort_by is None


def test_collection_rejects_post_and_keeps_get_available(management: _Management) -> None:
    response = management.client.post("/installed-apps", json={"app_id": management.harness.target_app.id})

    _assert_json_response(
        response,
        status=405,
        body={
            "code": "method_not_allowed",
            "message": "The method is not allowed for the requested URL.",
            "status": 405,
        },
    )
    options = management.client.options("/installed-apps")
    assert options.status_code == 200
    allowed_methods = {method.strip() for method in options.headers["Allow"].split(",")}
    assert "POST" not in allowed_methods
    assert "GET" in allowed_methods
    assert management.sessions == []

    response = management.client.get("/installed-apps")

    assert response.status_code == 200
    assert [item["id"] for item in response.get_json()["installed_apps"]] == [management.harness.installed_app.id]


@pytest.mark.parametrize("endpoint", ["list", "detail"])
@pytest.mark.parametrize("icon_type", [IconType.EMOJI, IconType.IMAGE, None])
@pytest.mark.parametrize("last_used_at", [None, _USED_AT])
def test_read_responses_preserve_exact_fields_types_headers_and_signed_icons(
    management: _Management, endpoint: str, icon_type: IconType | None, last_used_at: datetime | None
) -> None:
    harness = management.harness
    with management.session_factory.begin() as session:
        app = session.get(App, harness.target_app.id)
        assert app is not None
        app.icon_type = icon_type
        installed = session.get(InstalledApp, harness.installed_app.id)
        assert installed is not None
        installed.last_used_at = last_used_at
    expected: dict[str, object] = {
        "id": harness.installed_app.id,
        "app": {
            "id": harness.target_app.id,
            "name": "Shared app",
            "description": "Description",
            "mode": "completion",
            "icon_type": icon_type.value if icon_type is not None else None,
            "icon": "robot",
            "icon_background": "#FFFFFF",
            "use_icon_as_answer_icon": False,
            "icon_url": "/signed-files/robot" if icon_type == IconType.IMAGE else None,
        },
        "app_owner_tenant_id": harness.target_app.tenant_id,
        "is_pinned": False,
        "last_used_at": int(last_used_at.timestamp()) if last_used_at is not None else None,
        "editable": True,
    }

    response = management.client.get("/installed-apps" if endpoint == "list" else management.url())

    body: dict[str, object] = (
        {"installed_apps": [expected], "has_more": False, "next_cursor": None} if endpoint == "list" else expected
    )
    _assert_json_response(response, status=200, body=body)
    assert dict(response.headers) == {"Content-Type": "application/json", "Content-Length": str(len(response.data))}
    assert management.signed_files == (["robot"] if icon_type == IconType.IMAGE else [])
    management.assert_sessions_closed()


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.NORMAL, None])
@pytest.mark.parametrize("endpoint", ["list", "detail"])
def test_read_uses_fresh_workspace_role_without_mutating_cached_account(
    management: _Management, role: TenantAccountRole | None, endpoint: str
) -> None:
    harness = management.harness
    with management.session_factory.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id))
        assert membership is not None
        if role is None:
            session.delete(membership)
        else:
            membership.role = role

    response = management.client.get("/installed-apps" if endpoint == "list" else management.url())

    assert response.status_code == 200
    item = response.get_json()["installed_apps"][0] if endpoint == "list" else response.get_json()
    assert item["editable"] is (role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN})
    assert harness.account.role == TenantAccountRole.ADMIN


@pytest.mark.parametrize("endpoint", ["list", "detail"])
@pytest.mark.parametrize("different_owner", ["account", "workspace"])
def test_read_does_not_use_privileged_membership_from_another_account_or_workspace(
    management: _Management, endpoint: str, different_owner: str
) -> None:
    harness = management.harness
    account_id = harness.account.id
    tenant_id = harness.installed_app.tenant_id
    with management.session_factory.begin() as session:
        session.execute(
            delete(TenantAccountJoin).where(
                TenantAccountJoin.account_id == account_id,
                TenantAccountJoin.tenant_id == tenant_id,
            )
        )
        if different_owner == "account":
            account = Account(name="Another account", email="other@example.com")
            session.add(account)
            session.flush()
            account_id = account.id
        else:
            tenant = Tenant(name="Another workspace")
            session.add(tenant)
            session.flush()
            tenant_id = tenant.id
        session.add(TenantAccountJoin(account_id=account_id, tenant_id=tenant_id, role=TenantAccountRole.OWNER))

    response = management.client.get("/installed-apps" if endpoint == "list" else management.url())

    assert response.status_code == 200
    item = response.get_json()["installed_apps"][0] if endpoint == "list" else response.get_json()
    assert item["editable"] is False
    assert harness.account.role == TenantAccountRole.ADMIN


def test_list_filters_tenant_mode_and_actual_publication_targets(management: _Management) -> None:
    workflow, _ = _installation(management, mode=AppMode.WORKFLOW)
    advanced, _ = _installation(management, mode=AppMode.ADVANCED_CHAT)
    _installation(management, mode=AppMode.AGENT)
    _installation(management, published=False)
    _installation(management, mode=AppMode.WORKFLOW, published=False)
    _installation(management, tenant_id=str(uuid4()))
    missing_config, config_app = _installation(management)
    missing_workflow, workflow_app = _installation(management, mode=AppMode.WORKFLOW)
    with management.session_factory.begin() as session:
        session.execute(delete(AppModelConfig).where(AppModelConfig.id == config_app.app_model_config_id))
        session.execute(delete(Workflow).where(Workflow.id == workflow_app.workflow_id))
        # Existing installations remain visible even if their app is private.
        app = session.get(App, management.harness.target_app.id)
        assert app is not None
        app.is_public = False

    response = management.client.get("/installed-apps")

    assert response.status_code == 200
    ids = {item["id"] for item in response.get_json()["installed_apps"]}
    assert ids == {management.harness.installed_app.id, workflow.id, advanced.id}
    assert missing_config.id not in ids
    assert missing_workflow.id not in ids
    filtered = management.client.get("/installed-apps", query_string={"app_id": workflow.app_id})
    assert [item["id"] for item in filtered.get_json()["installed_apps"]] == [workflow.id]


def test_list_name_search_trims_and_escapes_wildcards(management: _Management) -> None:
    exact, _ = _installation(management, name="Literal %_\\ app")
    _installation(management, name="Literal wildcard app")

    response = management.client.get("/installed-apps", query_string={"name": "  %_\\  "})

    assert response.status_code == 200
    assert [item["id"] for item in response.get_json()["installed_apps"]] == [exact.id]
    assert len(management.client.get("/installed-apps", query_string={"name": "   "}).get_json()["installed_apps"]) == 3


@pytest.mark.parametrize(
    "mode", ["all", "completion", "chat", "advanced-chat", "workflow", "agent-chat", "agent", "channel"]
)
def test_list_filters_exact_mode_and_name(management: _Management, mode: InstalledAppListMode) -> None:
    _clear_installations(management)
    expected: set[str] = set()
    for app_mode in AppMode:
        installed, _ = _installation(management, mode=app_mode, name="Matching app")
        _installation(management, mode=app_mode, name="Other app")
        if app_mode != AppMode.AGENT and mode in ("all", app_mode):
            expected.add(installed.id)

    response = management.client.get("/installed-apps", query_string={"mode": mode, "name": "  MATCHING  "})

    assert response.status_code == 200
    page = response.get_json()
    assert {item["id"] for item in page["installed_apps"]} == expected
    assert page["has_more"] is False
    assert page["next_cursor"] is None
    management.assert_sessions_closed()


def test_list_pages_pin_time_null_and_id_order_without_duplicates(management: _Management) -> None:
    _clear_installations(management)
    expected: list[str] = []
    for number, pinned, used_at in [
        (1, True, datetime(2024, 2, 1)),
        (2, True, _USED_AT),
        (3, True, _USED_AT),
        (4, True, None),
        (5, False, datetime(2024, 3, 1)),
        (6, False, None),
        (7, False, None),
    ]:
        installed, _ = _installation(
            management, installed_app_id=str(UUID(int=number)), pinned=pinned, last_used_at=used_at
        )
        expected.append(installed.id)
    received: list[str] = []
    cursor: str | None = None
    for _ in range(4):
        query = {"limit": "2"}
        if cursor is not None:
            query["cursor"] = cursor
        response = management.client.get("/installed-apps", query_string=query)
        assert response.status_code == 200
        page = response.get_json()
        received.extend(item["id"] for item in page["installed_apps"])
        cursor = page["next_cursor"]
        assert page["has_more"] is (cursor is not None)
    assert received == expected
    assert cursor is None


@pytest.mark.parametrize(
    ("sort_by", "expected_numbers"),
    [
        ("last_modified", [5, 2, 4, 1]),
        ("recently_created", [1, 4, 2, 5]),
        ("earliest_created", [2, 5, 4, 1]),
    ],
)
def test_sorted_pages_preserve_search_mode_and_permissions_across_equal_timestamps(
    management: _Management, sort_by: AppListSortBy, expected_numbers: list[int]
) -> None:
    _clear_installations(management)
    _enable_visibility(management)
    rows = {
        number: _installation(
            management,
            installed_app_id=str(UUID(int=number)),
            mode=AppMode.WORKFLOW,
            name="Matching app",
            pinned=number == 1,
        )
        for number in range(1, 6)
    }
    with management.session_factory.begin() as session:
        for number, created_day, updated_day in [(1, 3, 1), (2, 1, 3), (3, 2, 2), (4, 2, 2), (5, 1, 4)]:
            app = session.get(App, rows[number][1].id)
            assert app is not None
            app.created_at = _USED_AT + timedelta(days=created_day)
            app.updated_at = _USED_AT + timedelta(days=updated_day)
    management.denied_app_ids.add(rows[3][1].id)
    _installation(management, mode=AppMode.CHAT, name="Matching app")
    _installation(management, mode=AppMode.WORKFLOW, name="Other app")
    _installation(management, mode=AppMode.WORKFLOW, name="Matching app", published=False)
    _installation(management, mode=AppMode.WORKFLOW, name="Matching app", tenant_id=str(uuid4()))
    query = {"limit": "1", "sort_by": sort_by, "mode": "workflow", "name": "matching"}
    received: list[str] = []
    cursor: str | None = None

    for index in range(len(expected_numbers)):
        if cursor is not None:
            query["cursor"] = cursor
        response = management.client.get("/installed-apps", query_string=query)
        assert response.status_code == 200
        page = response.get_json()
        assert len(page["installed_apps"]) == 1
        received.extend(item["id"] for item in page["installed_apps"])
        cursor = page["next_cursor"]
        assert page["has_more"] is (index < len(expected_numbers) - 1)
        assert page["has_more"] is (cursor is not None)
        if cursor is not None:
            decoded = module._decode_installed_app_cursor(cursor, sort_by=sort_by)
            assert isinstance(decoded, InstalledAppSortCursor)
            assert decoded.sort_by == sort_by

    assert received == [rows[number][0].id for number in expected_numbers]
    assert {app_id for _, app_ids in management.visibility_calls for app_id in app_ids} == {
        app.id for _, app in rows.values()
    }
    management.assert_sessions_closed()


@pytest.mark.parametrize("filtered", [False, True])
def test_visible_page_scans_denied_batches_and_cursor_tracks_last_consumed_candidate(
    management: _Management, filtered: bool
) -> None:
    _clear_installations(management)
    _enable_visibility(management)
    rows = [
        _installation(management, installed_app_id=str(UUID(int=index + 1)), mode=AppMode.WORKFLOW, name="Matching app")
        for index in range(5)
    ]
    management.denied_app_ids.update(app.id for _, app in rows[1:4])
    query = {"limit": "1"}
    if filtered:
        query.update({"mode": "workflow", "name": "matching"})
        _installation(management, mode=AppMode.CHAT, name="Matching app", pinned=True)
        _installation(management, mode=AppMode.WORKFLOW, name="Other app", pinned=True)
        _installation(management, mode=AppMode.WORKFLOW, name="Matching app", published=False)
        _installation(management, mode=AppMode.WORKFLOW, name="Matching app", tenant_id=str(uuid4()))

    response = management.client.get("/installed-apps", query_string=query)

    assert response.status_code == 200
    page = response.get_json()
    assert [item["id"] for item in page["installed_apps"]] == [rows[0][0].id]
    assert page["has_more"] is True
    cursor = module._decode_installed_app_cursor(page["next_cursor"])
    assert isinstance(cursor, InstalledAppCursor)
    assert cursor.installed_app_id == rows[3][0].id
    assert management.visibility_calls == [
        (management.harness.account.id, tuple(app.id for _, app in rows[start : start + 2])) for start in (0, 2, 4)
    ]
    query["cursor"] = page["next_cursor"]
    response = management.client.get("/installed-apps", query_string=query)
    assert [item["id"] for item in response.get_json()["installed_apps"]] == [rows[4][0].id]
    assert response.get_json()["has_more"] is False
    assert response.get_json()["next_cursor"] is None


@pytest.mark.parametrize("mode", ["unknown", "rag-pipeline", "", "CHAT"])
def test_list_rejects_invalid_mode_before_opening_sessions(management: _Management, mode: str) -> None:
    response = management.client.get("/installed-apps", query_string={"mode": mode})

    assert response.status_code == 422
    payload = response.get_json()
    assert payload["code"] == "unprocessable_entity"
    errors = json.loads(payload["message"])
    assert len(errors) == 1
    assert errors[0]["loc"] == ["mode"]
    assert errors[0]["type"] == "literal_error"
    assert management.sessions == []


@pytest.mark.parametrize("sort_by", ["unknown", "", "recently_used", "LAST_MODIFIED"])
def test_list_rejects_invalid_sort_before_opening_sessions(management: _Management, sort_by: str) -> None:
    response = management.client.get("/installed-apps", query_string={"sort_by": sort_by})

    assert response.status_code == 422
    payload = response.get_json()
    assert payload["code"] == "unprocessable_entity"
    errors = json.loads(payload["message"])
    assert len(errors) == 1
    assert errors[0]["loc"] == ["sort_by"]
    assert errors[0]["type"] == "literal_error"
    assert management.sessions == []


@pytest.mark.parametrize(
    ("cursor_sort", "query_sort"),
    [
        (None, "last_modified"),
        ("last_modified", None),
        ("recently_created", "earliest_created"),
        ("earliest_created", "recently_created"),
        ("last_modified", "recently_created"),
        ("recently_created", "last_modified"),
    ],
)
def test_list_rejects_cursor_for_another_sort_before_opening_sessions(
    management: _Management, cursor_sort: AppListSortBy | None, query_sort: AppListSortBy | None
) -> None:
    cursor = (
        InstalledAppCursor(is_pinned=False, last_used_at=None, installed_app_id=management.harness.installed_app.id)
        if cursor_sort is None
        else InstalledAppSortCursor(
            sort_by=cursor_sort, timestamp=_USED_AT, installed_app_id=management.harness.installed_app.id
        )
    )
    query = {"cursor": module._encode_installed_app_cursor(cursor)}
    if query_sort is not None:
        query["sort_by"] = query_sort

    response = management.client.get("/installed-apps", query_string=query)

    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_cursor"
    assert management.sessions == []


@pytest.mark.parametrize(
    "payload",
    [
        {"sort_by": "last_modified", "installed_app_id": "installation"},
        {"sort_by": "last_modified", "timestamp": None, "installed_app_id": "installation"},
        {"sort_by": "last_modified", "timestamp": "invalid", "installed_app_id": "installation"},
        {"sort_by": "unknown", "timestamp": "2024-01-01T00:00:00", "installed_app_id": "installation"},
        {
            "sort_by": "last_modified",
            "timestamp": "2024-01-01T00:00:00",
            "installed_app_id": "installation",
            "is_pinned": False,
            "last_used_at": None,
        },
    ],
)
def test_list_rejects_malformed_sorted_cursors_before_opening_sessions(
    management: _Management, payload: dict[str, object]
) -> None:
    cursor = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()

    response = management.client.get("/installed-apps", query_string={"sort_by": "last_modified", "cursor": cursor})

    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_cursor"
    assert management.sessions == []


@pytest.mark.parametrize("empty", ["database", "visibility"])
def test_list_empty_result_has_no_cursor(management: _Management, empty: str) -> None:
    if empty == "database":
        _clear_installations(management)
    else:
        _enable_visibility(management)
        management.denied_app_ids.add(management.harness.target_app.id)
    response = management.client.get("/installed-apps")
    _assert_json_response(response, status=200, body={"installed_apps": [], "has_more": False, "next_cursor": None})


@pytest.mark.parametrize("cursor", ["not-a-cursor", "!!!", "e30", ""])
def test_list_invalid_cursor_returns_specific_error(management: _Management, cursor: str) -> None:
    response = management.client.get("/installed-apps", query_string={"cursor": cursor})
    _assert_json_response(
        response,
        status=400,
        body={
            "code": "invalid_cursor",
            "message": "The app list cursor is invalid. Refresh the list and try again.",
            "status": 400,
            "details": {"request_id": "request-1"},
        },
    )
    assert management.sessions == []


@pytest.mark.parametrize(
    ("query", "error"),
    [
        (
            {"limit": "private-input"},
            {
                "type": "int_parsing",
                "loc": ["limit"],
                "msg": "Input should be a valid integer, unable to parse string as an integer",
            },
        ),
        (
            {"limit": "0"},
            {"type": "greater_than_equal", "loc": ["limit"], "msg": "Input should be greater than or equal to 1"},
        ),
        (
            {"limit": "101"},
            {"type": "less_than_equal", "loc": ["limit"], "msg": "Input should be less than or equal to 100"},
        ),
        (
            {"name": "private-input" * 10},
            {"type": "string_too_long", "loc": ["name"], "msg": "String should have at most 100 characters"},
        ),
    ],
)
def test_list_validation_identifies_query_field_without_echoing_input(
    management: _Management, query: dict[str, str], error: dict[str, object]
) -> None:
    response = management.client.get("/installed-apps", query_string=query)

    _assert_json_response(
        response,
        status=422,
        body={"code": "unprocessable_entity", "message": json.dumps([error]), "status": 422},
    )
    assert "private-input" not in response.get_data(as_text=True)
    assert management.sessions == []


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        (
            {"is_pinned": "private-input"},
            {
                "type": "bool_parsing",
                "loc": ["is_pinned"],
                "msg": "Input should be a valid boolean, unable to interpret input",
            },
        ),
        (
            ["private-input"],
            {
                "type": "model_type",
                "loc": [],
                "msg": "Input should be a valid dictionary or instance of InstalledAppUpdatePayload",
            },
        ),
    ],
)
def test_patch_validation_identifies_body_field_without_echoing_input(
    management: _Management, payload: object, error: dict[str, object]
) -> None:
    response = management.client.patch(management.url(), data=json.dumps(payload), content_type="application/json")

    _assert_json_response(
        response,
        status=422,
        body={"code": "unprocessable_entity", "message": json.dumps([error]), "status": 422},
    )
    assert "private-input" not in response.get_data(as_text=True)
    assert management.sessions == []
    with management.session_factory() as session:
        installed = session.get(InstalledApp, management.harness.installed_app.id)
        assert installed is not None
        assert installed.is_pinned is False


@pytest.mark.parametrize(
    ("body", "content_type"),
    [
        pytest.param('{"is_pinned": private-input}', "application/json", id="malformed-json"),
        pytest.param("null", "application/json", id="null"),
        pytest.param("false", "application/json", id="false"),
        pytest.param("[]", "application/json", id="empty-list"),
        pytest.param("", "application/json", id="empty-body"),
        pytest.param('{"is_pinned": false}', "text/plain", id="non-json-media"),
    ],
)
def test_patch_shared_parser_normalizes_empty_or_unreadable_body_to_noop(
    management: _Management, body: str, content_type: str
) -> None:
    installed, _ = _installation(management, pinned=True)
    management.sessions.clear()

    response = management.client.patch(management.url(installed.id), data=body, content_type=content_type)

    _assert_json_response(
        response,
        status=200,
        body={"result": "success", "message": "App info updated successfully"},
    )
    assert management.sessions == []
    with management.session_factory() as session:
        persisted = session.get(InstalledApp, installed.id)
        assert persisted is not None
        assert persisted.is_pinned is True
        assert persisted.last_used_at == _USED_AT


@pytest.mark.parametrize(
    ("mode", "published"), [(AppMode.CHAT, False), (AppMode.WORKFLOW, False), (AppMode.AGENT, True)]
)
def test_unavailable_installation_rejects_detail_but_can_be_pinned(
    management: _Management, mode: AppMode, published: bool
) -> None:
    installed, _ = _installation(management, mode=mode, published=published)
    url = management.url(installed.id)
    _assert_json_response(
        management.client.get(url),
        status=404,
        body={
            "code": "installed_app_unavailable",
            "message": "The app is not available in this app library.",
            "status": 404,
            "details": {"request_id": "request-1"},
        },
    )
    _assert_json_response(
        management.client.patch(url, json={"is_pinned": True}),
        status=200,
        body={"result": "success", "message": "App info updated successfully"},
    )
    with management.session_factory() as session:
        persisted = session.get(InstalledApp, installed.id)
        assert persisted is not None
        assert persisted.is_pinned is True


@pytest.mark.parametrize("owned", [False, True])
def test_item_rejects_delete_and_keeps_get_and_patch_available(management: _Management, owned: bool) -> None:
    owner_id = management.harness.installed_app.tenant_id if owned else str(uuid4())
    installed, _ = _installation(management, app_owner_tenant_id=owner_id)
    management.sessions.clear()
    url = management.url(installed.id)

    _assert_json_response(
        management.client.delete(url),
        status=405,
        body={
            "code": "method_not_allowed",
            "message": "The method is not allowed for the requested URL.",
            "status": 405,
        },
    )
    options = management.client.options(url)
    assert options.status_code == 200
    allowed_methods = {method.strip() for method in options.headers["Allow"].split(",")}
    assert "DELETE" not in allowed_methods
    assert {"GET", "PATCH"} <= allowed_methods
    assert management.sessions == []
    assert management.harness.state.permission_calls == []

    response = management.client.get(url)
    assert response.status_code == 200
    assert response.get_json()["id"] == installed.id
    assert "uninstallable" not in response.get_json()
    _assert_json_response(
        management.client.patch(url, json={"is_pinned": True}),
        status=200,
        body={"result": "success", "message": "App info updated successfully"},
    )
    with management.session_factory() as session:
        persisted = session.get(InstalledApp, installed.id)
        assert persisted is not None
        assert persisted.is_pinned is True


@pytest.mark.parametrize("payload", [{}, {"is_pinned": None}, {"is_pinned": False}, {"is_pinned": True}])
def test_patch_preserves_pin_values_and_noop_payloads(management: _Management, payload: dict[str, object]) -> None:
    installed, _ = _installation(management, pinned=True)
    management.sessions.clear()
    response = management.client.patch(management.url(installed.id), json=payload)
    _assert_json_response(response, status=200, body={"result": "success", "message": "App info updated successfully"})
    if payload.get("is_pinned") is None:
        assert management.sessions == []
    with management.session_factory() as session:
        persisted = session.get(InstalledApp, installed.id)
        assert persisted is not None
        assert persisted.is_pinned is (payload["is_pinned"] if payload.get("is_pinned") is not None else True)
        assert persisted.last_used_at == _USED_AT


@pytest.mark.parametrize("method", ["GET", "PATCH"])
@pytest.mark.parametrize("failure", ["tenant", "missing", "orphan", "permission"])
def test_item_admission_precedes_management_actions_and_preserves_errors(
    management: _Management, method: str, failure: str
) -> None:
    harness = management.harness
    url = management.url()
    if failure == "permission":
        harness.state.allowed = False
    elif failure == "missing":
        url = management.url(str(uuid4()))
    else:
        with management.session_factory.begin() as session:
            if failure == "tenant":
                installed = session.get(InstalledApp, harness.installed_app.id)
                assert installed is not None
                installed.tenant_id = str(uuid4())
            else:
                app = session.get(App, harness.target_app.id)
                assert app is not None
                session.delete(app)
    management.sessions.clear()
    response = management.client.open(url, method=method, json={"is_pinned": "invalid"})
    if failure == "permission":
        _assert_json_response(
            response, status=403, body={"code": "access_denied", "message": "App access denied.", "status": 403}
        )
    else:
        _assert_json_response(
            response,
            status=404,
            body={
                "code": "installed_app_not_found",
                "message": "The app was not found in this workspace.",
                "status": 404,
                "details": {"request_id": "request-1"},
            },
        )
    assert management.sessions == []
    with management.session_factory() as session:
        installed = session.get(InstalledApp, harness.installed_app.id)
        assert (installed is None) is (failure == "orphan")
        if installed is not None:
            assert installed.is_pinned is False


@pytest.mark.parametrize(("method", "item"), [("GET", False), ("GET", True), ("PATCH", True)])
def test_management_dependency_failure_preserves_cause_and_request_context(
    management: _Management,
    caplog: pytest.LogCaptureFixture,
    method: str,
    item: bool,
) -> None:
    failure = WebAppAccessUnavailableError("private upstream response containing credentials")
    if item:
        management.harness.state.permission_error = failure
    else:
        _enable_visibility(management)
        management.visibility_error = failure
    exceptions: list[Exception] = []

    def capture_exception(_sender: Flask, exception: Exception) -> None:
        exceptions.append(exception)

    with got_request_exception.connected_to(capture_exception):
        response = management.client.open(
            management.url() if item else "/installed-apps", method=method, json={"is_pinned": True}
        )

    _assert_json_response(
        response,
        status=503,
        body={
            "code": "web_app_access_unavailable",
            "message": "The app access service is unavailable. Try again later.",
            "status": 503,
            "details": {"request_id": "request-1"},
        },
    )
    assert "WWW-Authenticate" not in response.headers
    assert "private upstream" not in response.get_data(as_text=True)
    assert len(exceptions) == 1
    assert exceptions[0].__cause__ is failure
    management.assert_sessions_closed()
    records = [record for record in caplog.records if record.name.startswith("controllers.console.explore.")]
    assert len(records) == 1
    assert records[0].exc_info is not None
    assert records[0].exc_info[1] is failure
    assert management.harness.installed_app.tenant_id in records[0].getMessage()
    assert management.harness.account.id in records[0].getMessage()
    assert "request-1" in records[0].getMessage()
    with management.session_factory() as session:
        installed = session.get(InstalledApp, management.harness.installed_app.id)
        assert installed is not None
        assert installed.is_pinned is False


@pytest.mark.parametrize(("method", "item"), [("GET", False), ("GET", True), ("PATCH", True)])
def test_all_management_handlers_apply_setup_before_business_operations(
    management: _Management, method: str, item: bool
) -> None:
    management.harness.state.setup_completed = False
    response = management.client.open(management.url() if item else "/installed-apps", method=method, json={})
    _assert_json_response(
        response,
        status=401,
        body={
            "code": "not_setup",
            "message": "Dify has not been initialized and installed yet. "
            "Please proceed with the initialization and installation process first.",
            "status": 401,
        },
    )
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert management.sessions == []
    assert management.harness.state.permission_calls == []
