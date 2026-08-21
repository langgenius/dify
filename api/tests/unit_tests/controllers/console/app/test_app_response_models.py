from __future__ import annotations

import builtins
import json
import sys
from datetime import datetime
from importlib import util
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from flask.views import MethodView
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.datastructures import MultiDict

from configs import dify_config
from models.account import Account
from models.enums import CustomizeTokenStrategy, TagType
from models.model import App, AppMode, AppModelConfig, IconType, Site, Tag, TagBinding
from models.workflow import Workflow, WorkflowType
from services.app_service import RecentAppListItem

# kombu references MethodView as a global when importing celery/kombu pools.
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


class _ConsoleModule(ModuleType):
    console_ns: object
    api: object | None
    bp: object | None
    app: ModuleType


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


@pytest.fixture(scope="module")
def app_module():
    module_name = "controllers.console.app.app"
    root = Path(__file__).resolve().parents[5]
    module_path = root / "controllers" / "console" / "app" / "app.py"

    class _StubNamespace:
        def __init__(self):
            self.models: dict[str, object] = {}
            self.payload = None

        def schema_model(self, name, schema):
            self.models[name] = schema
            return schema

        def model(self, name, model_dict=None, **kwargs):
            """Register a model with the namespace (flask-restx compatibility)."""
            if model_dict is not None:
                self.models[name] = model_dict
            return model_dict

        def _decorator(self, obj):
            return obj

        def doc(self, *args, **kwargs):
            return self._decorator

        def expect(self, *args, **kwargs):
            return self._decorator

        def response(self, *args, **kwargs):
            return self._decorator

        def route(self, *args, **kwargs):
            def decorator(obj):
                return obj

            return decorator

    stub_namespace = _StubNamespace()

    original_modules: dict[str, ModuleType | None] = {
        "controllers.console": sys.modules.get("controllers.console"),
        "controllers.console.app": sys.modules.get("controllers.console.app"),
        "controllers.common.schema": sys.modules.get("controllers.common.schema"),
        module_name: sys.modules.get(module_name),
    }
    stubbed_modules: list[tuple[str, ModuleType | None]] = []

    console_module = _ConsoleModule("controllers.console")
    console_module.__path__ = [str(root / "controllers" / "console")]
    console_module.console_ns = stub_namespace
    console_module.api = None
    console_module.bp = None
    sys.modules["controllers.console"] = console_module

    app_package = ModuleType("controllers.console.app")
    app_package.__path__ = [str(root / "controllers" / "console" / "app")]
    sys.modules["controllers.console.app"] = app_package
    console_module.app = app_package

    def _stub_module(name: str, attrs: dict[str, object]) -> None:
        original = sys.modules.get(name)
        module = ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        sys.modules[name] = module
        stubbed_modules.append((name, original))

    class _OpsTraceManager:
        @staticmethod
        def get_app_tracing_config(app_id: str) -> dict[str, object]:
            return {}

        @staticmethod
        def update_app_tracing_config(app_id: str, **kwargs) -> None:
            return None

    _stub_module(
        "core.ops.ops_trace_manager",
        {
            "OpsTraceManager": _OpsTraceManager,
            "TraceQueueManager": object,
            "TraceTask": object,
        },
    )

    spec = util.spec_from_file_location(module_name, module_path)
    assert spec is not None
    module = util.module_from_spec(spec)
    sys.modules[module_name] = module

    assert spec.loader is not None
    spec.loader.exec_module(module)

    try:
        yield module
    finally:
        for name, original in reversed(stubbed_modules):
            if original is not None:
                sys.modules[name] = original
            else:
                sys.modules.pop(name, None)
        for name, original in original_modules.items():
            if original is not None:
                sys.modules[name] = original
            else:
                sys.modules.pop(name, None)


@pytest.fixture(scope="module")
def app_models(app_module):
    return SimpleNamespace(
        AppDetailWithSite=app_module.AppDetailWithSite,
        AppPagination=app_module.AppPagination,
        AppPartial=app_module.AppPartial,
    )


@pytest.fixture(autouse=True)
def patch_signed_url(monkeypatch: pytest.MonkeyPatch, app_module: ModuleType) -> None:
    """Ensure icon URL generation uses a deterministic helper for tests."""

    def _fake_build_icon_url(_icon_type, key: str | None) -> str | None:
        if key is None:
            return None
        icon_type = str(_icon_type).lower()
        if icon_type != "image":
            return None
        return f"signed:{key}"

    monkeypatch.setattr(app_module, "build_icon_url", _fake_build_icon_url)


def _ts(hour: int = 12) -> datetime:
    return datetime(2024, 1, 1, hour, 0, 0)


TENANT_ID = "00000000-0000-0000-0000-000000000001"
APP_ID = "00000000-0000-0000-0000-000000000101"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000201"
CONFIG_ID = "00000000-0000-0000-0000-000000000301"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000401"
SITE_ID = "00000000-0000-0000-0000-000000000501"
TAG_ID = "00000000-0000-0000-0000-000000000601"


def _account(*, account_id: str = ACCOUNT_ID) -> Account:
    account = Account(name="Creator", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _app(
    *,
    app_id: str = APP_ID,
    tenant_id: str = TENANT_ID,
    name: str = "My App",
    description: str = "Summary",
    mode: AppMode = AppMode.CHAT,
    icon_type: IconType | None = IconType.IMAGE,
    icon: str | None = "icon-key",
    created_at: datetime | None = None,
) -> App:
    timestamp = created_at or _ts()
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        mode=mode,
        icon_type=icon_type,
        icon=icon,
        icon_background="#fff",
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
        created_at=timestamp,
        updated_at=timestamp,
    )


def _workflow(*, app_id: str = APP_ID, tenant_id: str = TENANT_ID) -> Workflow:
    return Workflow(
        id=WORKFLOW_ID,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [], "edges": []}),
        features=json.dumps({}),
        created_by=ACCOUNT_ID,
        created_at=_ts(8),
        updated_by=ACCOUNT_ID,
        updated_at=_ts(9),
        environment_variables=[],
        conversation_variables=[],
    )


def _persist_response_graph(session: Session) -> App:
    app = _app(description="Description")
    app.created_by = ACCOUNT_ID
    app.app_model_config_id = CONFIG_ID
    app.workflow_id = WORKFLOW_ID
    app.access_mode = "private"
    app.create_user_name = "Creator"
    app.has_draft_trigger = True
    app.permission_keys = ["app.acl.view_layout"]

    model_config = AppModelConfig(
        app_id=APP_ID,
        model=json.dumps({"provider": "openai", "name": "gpt-4o"}),
        pre_prompt="hello",
        created_by=ACCOUNT_ID,
        updated_by=ACCOUNT_ID,
    )
    model_config.id = CONFIG_ID
    model_config.created_at = _ts(9)
    model_config.updated_at = _ts(10)

    site = Site(
        id=SITE_ID,
        app_id=APP_ID,
        code="site-code",
        title="Public Site",
        icon_type=IconType.IMAGE,
        icon="site-icon",
        icon_background="#fff",
        description="Site description",
        default_language="en-US",
        input_placeholder="Ask anything",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        created_at=_ts(14),
        updated_at=_ts(14),
    )
    tag = Tag(tenant_id=TENANT_ID, type=TagType.APP, name="Utilities", created_by=ACCOUNT_ID)
    tag.id = TAG_ID
    binding = TagBinding(tenant_id=TENANT_ID, tag_id=TAG_ID, target_id=APP_ID, created_by=ACCOUNT_ID)

    session.add_all([_account(), app, model_config, _workflow(), site, tag, binding])
    session.commit()
    return app


def test_app_list_query_reads_repeated_tag_ids(app_module):
    first_tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
    second_tag_id = "3c39395b-6d1f-4030-8b17-eaa7cc85221c"
    query_args = MultiDict(
        [
            ("page", "1"),
            ("limit", "30"),
            ("tag_ids", first_tag_id),
            ("tag_ids", second_tag_id),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.tag_ids == [first_tag_id, second_tag_id]


def test_app_list_query_reads_repeated_creator_ids(app_module):
    first_creator_id = "9e8959cf-a67b-4d34-9906-1d687517b248"
    second_creator_id = "1886f96a-5bf0-42bf-961d-8d2129049076"
    query_args = MultiDict(
        [
            ("page", "1"),
            ("limit", "30"),
            ("creator_ids", first_creator_id),
            ("creator_ids", second_creator_id),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.creator_ids == [first_creator_id, second_creator_id]


def test_app_list_query_preserves_regular_query_params(app_module):
    query_args = MultiDict(
        [
            ("page", "2"),
            ("limit", "50"),
            ("mode", "chat"),
            ("name", "Sales Copilot"),
            ("is_created_by_me", "true"),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.page == 2
    assert query.limit == 50
    assert query.mode == "chat"
    assert query.name == "Sales Copilot"
    assert query.is_created_by_me is True
    assert query.tag_ids is None


def test_app_list_query_normalizes_empty_repeated_tag_ids_to_none(app_module):
    query_args = MultiDict(
        [
            ("tag_ids", ""),
            ("tag_ids", "   "),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.tag_ids is None


def test_app_list_query_rejects_invalid_repeated_tag_id(app_module):
    with pytest.raises(ValidationError):
        app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=MultiDict([("tag_ids", "not-a-uuid")]),
        )


def test_app_list_query_rejects_invalid_repeated_creator_id(app_module):
    with pytest.raises(ValidationError):
        app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=MultiDict([("creator_ids", "not-a-uuid")]),
        )


def test_app_list_query_ignores_indexed_tag_ids(app_module):
    tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
    query_args = MultiDict(
        [
            ("tag_ids[0]", tag_id),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.tag_ids is None


def test_app_list_query_accepts_single_repeated_tag_id(app_module):
    tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=MultiDict([("tag_ids", tag_id)]),
    )

    assert query.tag_ids == [tag_id]


def test_create_app_endpoint_rejects_agent_mode(app_module):
    with pytest.raises(ValidationError):
        app_module.CreateAppPayload.model_validate({"name": "Iris", "mode": "agent", "description": "Agent app"})


def test_app_partial_serialization_uses_aliases(app_models, sqlite_session: Session):
    AppPartial = app_models.AppPartial
    app_obj = _persist_response_graph(sqlite_session)
    app_obj.description = "Prompt snippet"

    serialized = AppPartial.model_validate(
        app_obj,
        from_attributes=True,
        context={"session": sqlite_session},
    ).model_dump(mode="json")

    assert serialized["description"] == "Prompt snippet"
    assert serialized["mode"] == "chat"
    assert serialized["icon_url"] == "signed:icon-key"
    assert serialized["created_at"] == int(app_obj.created_at.timestamp())
    assert serialized["updated_at"] == int(app_obj.updated_at.timestamp())
    assert serialized["model_config"]["model"] == {"provider": "openai", "name": "gpt-4o"}
    assert serialized["workflow"]["id"] == WORKFLOW_ID
    assert serialized["tags"][0]["name"] == "Utilities"
    assert serialized["permission_keys"] == ["app.acl.view_layout"]
    assert "role" not in serialized


def test_app_detail_with_site_includes_nested_serialization(
    app: Flask,
    app_models,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    AppDetailWithSite = app_models.AppDetailWithSite
    app_obj = _persist_response_graph(sqlite_session)
    app_obj.name = "Detailed App"
    app_obj.description = "Desc"
    app_obj.mode = AppMode.ADVANCED_CHAT
    app_obj.icon = "detail-icon"
    app_obj.icon_background = "#123456"
    app_obj.use_icon_as_answer_icon = True
    app_obj.max_active_requests = 5
    app_obj.access_mode = "public"
    app_obj.permission_keys = ["app.acl.view_layout", "app.acl.edit"]
    model_config = sqlite_session.get(AppModelConfig, CONFIG_ID)
    assert model_config is not None
    model_config.opening_statement = "hi"
    model_config.retriever_resource = json.dumps({"enabled": True})
    monkeypatch.setattr("services.app_service.load_annotation_reply_config", lambda _session, _app_id: {})

    with app.test_request_context("/"):
        serialized = AppDetailWithSite.model_validate(
            app_obj,
            from_attributes=True,
            context={"session": sqlite_session},
        ).model_dump(mode="json")

    assert serialized["icon_url"] == "signed:detail-icon"
    assert serialized["model_config"]["retriever_resource"] == {"enabled": True}
    assert serialized["deleted_tools"] == []
    assert serialized["site"]["icon_url"] == "signed:site-icon"
    assert serialized["site"]["input_placeholder"] == "Ask anything"
    assert serialized["site"]["created_at"] == int(_ts(14).timestamp())
    assert serialized["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]
    assert serialized["bound_agent_id"] is None
    assert "role" not in serialized


def test_app_response_view_uses_the_caller_session_for_query_backed_fields(
    app_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    app_obj = _persist_response_graph(sqlite_session)
    decoy_tenant_id = "00000000-0000-0000-0000-000000000002"
    decoy_tag = Tag(tenant_id=decoy_tenant_id, type=TagType.APP, name="Decoy", created_by=ACCOUNT_ID)
    decoy_tag.id = "00000000-0000-0000-0000-000000000602"
    sqlite_session.add_all(
        [
            decoy_tag,
            TagBinding(
                tenant_id=decoy_tenant_id,
                tag_id=decoy_tag.id,
                target_id=APP_ID,
                created_by=ACCOUNT_ID,
            ),
        ]
    )
    sqlite_session.commit()
    load_annotation_reply = MagicMock(return_value={"enabled": False})
    monkeypatch.setattr("services.app_service.load_annotation_reply_config", load_annotation_reply)

    view = app_module.AppResponseView(app_obj, session=sqlite_session)
    site = view.site
    workflow = view.workflow
    model_config = view.app_model_config

    assert view.desc_or_prompt == "Description"
    assert site is not None
    assert site.id == SITE_ID
    assert workflow is not None
    assert workflow.id == WORKFLOW_ID
    assert view.bound_agent_id is None
    assert view.mode_compatible_with_agent == "chat"
    assert view.deleted_tools == []
    assert [tag.name for tag in view.tags] == ["Utilities"]
    assert view.author_name == "Creator"
    assert model_config is not None
    assert model_config.annotation_reply_dict == {"enabled": False}
    load_annotation_reply.assert_called_once_with(sqlite_session, APP_ID)


def test_app_pagination_aliases_per_page_and_has_next(app_models, sqlite_session: Session):
    AppPagination = app_models.AppPagination
    item_one = _app(
        app_id="00000000-0000-0000-0000-000000000110",
        name="Paginated One",
        icon="first-icon",
        created_at=_ts(15),
    )
    item_one.permission_keys = ["app.acl.edit"]
    item_two = _app(
        app_id="00000000-0000-0000-0000-000000000111",
        name="Paginated Two",
        mode=AppMode.AGENT_CHAT,
        icon_type=IconType.EMOJI,
        icon="🙂",
        created_at=_ts(16),
    )
    pagination = SimpleNamespace(
        page=2,
        per_page=10,
        total=50,
        has_next=True,
        items=[item_one, item_two],
    )

    serialized = AppPagination.model_validate(
        pagination,
        from_attributes=True,
        context={"session": sqlite_session},
    ).model_dump(mode="json")

    assert serialized["page"] == 2
    assert serialized["limit"] == 10
    assert serialized["has_more"] is True
    assert len(serialized["data"]) == 2
    assert serialized["data"][0]["icon_url"] == "signed:first-icon"
    assert serialized["data"][1]["icon_url"] is None


def test_app_list_uses_injected_session_for_draft_workflows(
    app: Flask,
    app_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    api = app_module.AppListApi()
    method = _unwrap(api.get)
    app_item = _app(
        app_id="app-1",
        tenant_id="tenant-1",
        name="Workflow App",
        mode=AppMode.WORKFLOW,
    )
    app_pagination = SimpleNamespace(page=1, per_page=20, total=1, has_next=False, items=[app_item])
    workflow = Workflow(
        id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [{"id": "trigger-1", "data": {"type": "trigger-webhook"}}], "edges": []}),
        features=json.dumps({}),
        created_by="user-1",
        environment_variables=[],
        conversation_variables=[],
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()

    monkeypatch.setattr(
        app_module,
        "AppService",
        lambda: SimpleNamespace(get_paginate_apps=lambda *_args, **_kwargs: app_pagination),
    )
    monkeypatch.setattr(
        app_module,
        "FeatureService",
        SimpleNamespace(get_system_features=lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))),
    )
    get_permissions = MagicMock(
        return_value=app_module.enterprise_rbac_service.MyPermissionsResponse(
            app=app_module.enterprise_rbac_service.ResourcePermissionSnapshot(
                overrides=[
                    app_module.enterprise_rbac_service.ResourcePermissionKeys(
                        resource_id="app-1",
                        permission_keys=["app.acl.edit"],
                    )
                ]
            )
        )
    )
    monkeypatch.setattr(
        app_module.enterprise_rbac_service.RBACService.MyPermissions,
        "get",
        get_permissions,
    )
    with app.test_request_context("/console/api/apps?page=1&limit=20", method="GET"):
        response, status = method("tenant-1", "user-1", sqlite_session)

    assert status == 200
    assert response["data"][0]["has_draft_trigger"] is True
    get_permissions.assert_called_once_with("tenant-1", "user-1", session=sqlite_session)
    assert response["data"][0]["permission_keys"] == ["app.acl.edit"]


def test_app_create_api_attaches_permission_keys(app, app_module, sqlite_session: Session):
    method = app_module.AppListApi.post
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    app_obj = _app(
        app_id="app-new",
        tenant_id="tenant-1",
        name="Created App",
        description="Summary",
        mode=AppMode.ADVANCED_CHAT,
    )

    with app.test_request_context("/apps", method="POST", json={}):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(app_module.dify_config, "RBAC_ENABLED", True)
            app_module.console_ns.payload = {
                "name": "Created App",
                "description": "Summary",
                "mode": "advanced-chat",
            }
            monkeypatch.setattr(
                app_module,
                "AppService",
                lambda: SimpleNamespace(create_app=lambda tenant_id, params, user, session: app_obj),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppPermissions,
                "batch_get",
                lambda tenant_id, account_id, app_ids, session: {"app-new": ["app.acl.view_layout", "app.acl.edit"]},
            )
            initialize_rbac_task = MagicMock()
            monkeypatch.setattr(
                app_module,
                "initialize_created_app_rbac_access_task",
                initialize_rbac_task,
            )
            replace_whitelist = MagicMock()
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppAccess,
                "replace_whitelist",
                replace_whitelist,
            )

            resp, status = method(
                app_module.AppListApi(),
                app_module.CreateAppPayload(
                    name="Created App",
                    description="Summary",
                    mode="advanced-chat",
                ),
                sqlite_session,
                "tenant-1",
                _account(account_id="acct-1"),
            )

    assert status == 201
    assert resp["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]
    assert replace_whitelist.call_args.kwargs["payload"].scope is app_module.RBACResourceWhitelistScope.ALL
    initialize_rbac_task.delay.assert_called_once_with("tenant-1", "acct-1", app_id="app-new")


def test_app_list_api_attaches_permission_keys(app, app_module, sqlite_session: Session):
    method = app_module.AppListApi.get
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    app_obj = _app(
        app_id="app-1",
        tenant_id="tenant-1",
        name="List App",
        created_at=_ts(15),
    )
    pagination = SimpleNamespace(page=1, per_page=20, total=1, has_next=False, items=[app_obj])
    get_paginate_apps = MagicMock(return_value=pagination)

    with app.test_request_context("/apps"):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
            monkeypatch.setattr(
                app_module.AppService,
                "get_paginate_apps",
                get_paginate_apps,
            )
            monkeypatch.setattr(
                app_module.FeatureService,
                "get_system_features",
                lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.MyPermissions,
                "get",
                lambda tenant_id, account_id, session: app_module.enterprise_rbac_service.MyPermissionsResponse(
                    app=app_module.enterprise_rbac_service.ResourcePermissionSnapshot(
                        default_permission_keys=["app.preview", "app.acl.view_layout"],
                        overrides=[
                            app_module.enterprise_rbac_service.ResourcePermissionKeys(
                                resource_id="app-1",
                                permission_keys=["app.acl.view_layout", "app.acl.edit"],
                            )
                        ],
                    )
                ),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppAccess,
                "whitelist_resources",
                lambda tenant_id, account_id: SimpleNamespace(unrestricted=True, resource_ids=[]),
            )

            resp, status = method(app_module.AppListApi(), "tenant-1", "acct-1", sqlite_session)

    assert status == 200
    params = get_paginate_apps.call_args.args[2]
    assert params.accessible_app_ids is None
    assert params.is_created_by_me is None
    assert resp["data"][0]["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]


def test_recent_app_list_api_returns_only_home_card_fields(app, app_module, unbound_session: Session):
    method = app_module.RecentAppListApi.get
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    recent_app = RecentAppListItem(
        id="app-1",
        name="Recent App",
        icon_type=IconType.EMOJI,
        icon="🚀",
        icon_background="#FFFFFF",
        mode="chat",
        author_name="Recent Author",
        updated_at=_ts(15),
        maintainer="acct-1",
    )
    get_recent_apps = MagicMock(return_value=[recent_app])

    with app.test_request_context("/apps/recent?limit=8"):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
            monkeypatch.setattr(app_module.AppService, "get_recent_apps", get_recent_apps)
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.MyPermissions,
                "get",
                lambda tenant_id, account_id, session: app_module.enterprise_rbac_service.MyPermissionsResponse(
                    app=app_module.enterprise_rbac_service.ResourcePermissionSnapshot(
                        overrides=[
                            app_module.enterprise_rbac_service.ResourcePermissionKeys(
                                resource_id="app-1",
                                permission_keys=["app.acl.monitor"],
                            )
                        ]
                    )
                ),
            )

            resp, status = method(app_module.RecentAppListApi(), "tenant-1", "acct-1", unbound_session)

    assert status == 200
    assert resp == {
        "data": [
            {
                "id": "app-1",
                "name": "Recent App",
                "icon_type": "emoji",
                "icon": "🚀",
                "icon_background": "#FFFFFF",
                "mode": "chat",
                "author_name": "Recent Author",
                "updated_at": int(_ts(15).timestamp()),
                "permission_keys": ["app.acl.monitor"],
                "maintainer": "acct-1",
                "icon_url": None,
            }
        ]
    }
    params = get_recent_apps.call_args.args[2]
    assert params.limit == 8
    assert "total" not in resp
    assert "description" not in resp["data"][0]
    assert "tags" not in resp["data"][0]
    assert "workflow" not in resp["data"][0]


@pytest.mark.parametrize("mode", ["channel", "rag-pipeline", "agent"])
def test_recent_app_response_rejects_non_home_app_modes(app_module, mode: str) -> None:
    with pytest.raises(ValidationError):
        app_module.RecentAppResponse.model_validate(
            {
                "id": "app-1",
                "name": "Recent App",
                "mode": mode,
                "updated_at": _ts(),
            }
        )


def test_recent_app_list_api_applies_rbac_visibility_filter(app, app_module, unbound_session: Session):
    method = app_module.RecentAppListApi.get
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    get_recent_apps = MagicMock(return_value=[])
    with app.test_request_context("/apps/recent"):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
            monkeypatch.setattr(app_module.AppService, "get_recent_apps", get_recent_apps)
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.MyPermissions,
                "get",
                lambda tenant_id, account_id, session: app_module.enterprise_rbac_service.MyPermissionsResponse(
                    workspace=app_module.enterprise_rbac_service.WorkspacePermissionSnapshot(
                        permission_keys=["app.create_and_management"]
                    )
                ),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppAccess,
                "whitelist_resources",
                lambda tenant_id, account_id: SimpleNamespace(
                    unrestricted=False,
                    resource_ids=["app-shared"],
                ),
            )

            resp, status = method(app_module.RecentAppListApi(), "tenant-1", "acct-1", unbound_session)

    assert status == 200
    assert resp == {"data": []}
    params = get_recent_apps.call_args.args[2]
    assert params.accessible_app_ids == ["app-shared"]
    assert params.include_own_apps is True


def test_app_list_api_limits_to_apps_created_by_current_user_without_view_permission(
    app, app_module, unbound_session: Session
):
    method = app_module.AppListApi.get
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    pagination = SimpleNamespace(page=1, per_page=20, total=0, has_next=False, items=[])
    get_paginate_apps = MagicMock(return_value=pagination)

    with app.test_request_context("/apps"):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(app_module.AppService, "get_paginate_apps", get_paginate_apps)
            monkeypatch.setattr(app_module.dify_config, "RBAC_ENABLED", True)
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.MyPermissions,
                "get",
                lambda tenant_id, account_id, session: app_module.enterprise_rbac_service.MyPermissionsResponse(
                    workspace=app_module.enterprise_rbac_service.WorkspacePermissionSnapshot(
                        permission_keys=["app.create_and_management"]
                    )
                ),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppAccess,
                "whitelist_resources",
                lambda tenant_id, account_id: SimpleNamespace(resource_ids=["app-shared", "app-not-permitted"]),
            )
            monkeypatch.setattr(
                app_module.FeatureService,
                "get_system_features",
                lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            )

            resp, status = method(app_module.AppListApi(), "tenant-1", "acct-1", unbound_session)

    assert status == 200
    assert resp["data"] == []
    params = get_paginate_apps.call_args.args[2]
    assert params.accessible_app_ids == ["app-not-permitted", "app-shared"]
    assert params.include_own_apps is True
    assert params.is_created_by_me is None


def test_app_list_api_limits_to_preview_overrides_without_manage_own_permission(
    app, app_module, unbound_session: Session
):
    method = app_module.AppListApi.get
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    pagination = SimpleNamespace(page=1, per_page=20, total=0, has_next=False, items=[])
    get_paginate_apps = MagicMock(return_value=pagination)

    with app.test_request_context("/apps"):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(app_module.AppService, "get_paginate_apps", get_paginate_apps)
            monkeypatch.setattr(app_module.dify_config, "RBAC_ENABLED", True)
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.MyPermissions,
                "get",
                lambda tenant_id, account_id, session: app_module.enterprise_rbac_service.MyPermissionsResponse(
                    app=app_module.enterprise_rbac_service.ResourcePermissionSnapshot(
                        overrides=[
                            app_module.enterprise_rbac_service.ResourcePermissionKeys(
                                resource_id="app-acl-shared",
                                permission_keys=["app.acl.preview"],
                            ),
                            app_module.enterprise_rbac_service.ResourcePermissionKeys(
                                resource_id="app-full",
                                permission_keys=["app.full_access"],
                            ),
                            app_module.enterprise_rbac_service.ResourcePermissionKeys(
                                resource_id="app-shared",
                                permission_keys=["app.preview"],
                            ),
                        ]
                    )
                ),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppAccess,
                "whitelist_resources",
                lambda tenant_id, account_id: SimpleNamespace(
                    resource_ids=["app-shared", "app-acl-shared", "app-full", "app-whitelist-only"]
                ),
            )
            monkeypatch.setattr(
                app_module.FeatureService,
                "get_system_features",
                lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            )

            method(app_module.AppListApi(), "tenant-1", "acct-1", unbound_session)

    params = get_paginate_apps.call_args.args[2]
    assert params.accessible_app_ids == ["app-acl-shared", "app-full", "app-shared", "app-whitelist-only"]
    assert params.include_own_apps is False
    assert params.is_created_by_me is None


def test_app_list_api_returns_no_apps_without_workspace_or_resource_view_permission(
    app, app_module, unbound_session: Session
):
    method = app_module.AppListApi.get
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    pagination = SimpleNamespace(page=1, per_page=20, total=0, has_next=False, items=[])
    get_paginate_apps = MagicMock(return_value=pagination)

    with app.test_request_context("/apps"):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(app_module.AppService, "get_paginate_apps", get_paginate_apps)
            monkeypatch.setattr(app_module.dify_config, "RBAC_ENABLED", True)
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.MyPermissions,
                "get",
                lambda tenant_id, account_id, session: app_module.enterprise_rbac_service.MyPermissionsResponse(),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppAccess,
                "whitelist_resources",
                lambda tenant_id, account_id: SimpleNamespace(resource_ids=["app-not-permitted"]),
            )
            monkeypatch.setattr(
                app_module.FeatureService,
                "get_system_features",
                lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            )

            method(app_module.AppListApi(), "tenant-1", "acct-1", unbound_session)

    params = get_paginate_apps.call_args.args[2]
    assert params.accessible_app_ids == ["app-not-permitted"]
    assert params.include_own_apps is False
    assert params.is_created_by_me is None


def test_app_detail_api_attaches_current_user_permission_keys(app, app_module, sqlite_session: Session):
    method = app_module.AppApi.get
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    app_obj = _app(
        app_id="app-1",
        tenant_id="tenant-1",
        name="Detail App",
        description="Summary",
    )

    with app.test_request_context("/apps/app-1"):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
            get_app = MagicMock(return_value=app_obj)
            monkeypatch.setattr(app_module, "AppService", lambda: SimpleNamespace(get_app=get_app))
            monkeypatch.setattr(
                app_module.FeatureService,
                "get_system_features",
                lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            )
            get_permissions = MagicMock(
                return_value=app_module.enterprise_rbac_service.MyPermissionsResponse(
                    app=app_module.enterprise_rbac_service.ResourcePermissionSnapshot(
                        overrides=[
                            app_module.enterprise_rbac_service.ResourcePermissionKeys(
                                resource_id="app-1",
                                permission_keys=[
                                    "app.acl.view_layout",
                                    "app.acl.edit",
                                    "app.acl.deploy",
                                    "app.acl.monitor",
                                ],
                            )
                        ]
                    )
                )
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.MyPermissions,
                "get",
                get_permissions,
            )

            resp = method(
                app_module.AppApi(),
                sqlite_session,
                "tenant-1",
                _account(account_id="acct-1"),
                app_model=app_obj,
            )

    get_app.assert_called_once_with(app_obj, session=sqlite_session)
    get_permissions.assert_called_once_with("tenant-1", "acct-1", app_id="app-1", session=sqlite_session)
    assert resp["permission_keys"] == [
        "app.acl.view_layout",
        "app.acl.edit",
        "app.acl.deploy",
        "app.acl.monitor",
    ]


def test_app_copy_api_attaches_permission_keys(app, app_module, sqlite_session: Session):
    method = app_module.AppCopyApi.post
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    app_obj = App(
        id="00000000-0000-0000-0000-000000000101",
        tenant_id="00000000-0000-0000-0000-000000000102",
        name="Copied App",
        description="Summary",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="copy",
        icon_background="#ffffff",
        enable_site=True,
        enable_api=True,
    )
    sqlite_session.add(app_obj)
    sqlite_session.commit()

    import_result = SimpleNamespace(status=app_module.ImportStatus.COMPLETED, app_id=app_obj.id)

    with app.test_request_context("/apps/app-original/copy", method="POST", json={}):
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
            monkeypatch.setattr(
                app_module,
                "AppDslService",
                lambda *_args, **_kwargs: SimpleNamespace(
                    export_dsl=lambda **_kwargs: "dsl",
                    import_app=lambda **_kwargs: import_result,
                ),
            )
            monkeypatch.setattr(
                app_module.FeatureService,
                "get_system_features",
                lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            )
            monkeypatch.setattr(
                app_module.enterprise_rbac_service.RBACService.AppPermissions,
                "batch_get",
                lambda tenant_id, account_id, app_ids, session: {app_obj.id: ["app.acl.view_layout", "app.acl.edit"]},
            )

            resp, status = method(
                app_module.AppCopyApi(),
                app_module.CopyAppPayload(),
                sqlite_session,
                "tenant-1",
                _account(account_id="acct-1"),
                app_model=_app(app_id="app-original", tenant_id="tenant-1"),
            )

    assert status == 201
    assert sqlite_session.get(App, app_obj.id) is not None
    assert resp["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]
