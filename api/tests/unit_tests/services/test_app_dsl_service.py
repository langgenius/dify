import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import yaml
from graphon.enums import BuiltinNodeTypes

from core.trigger.constants import (
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)
from models import Account, AppMode
from models.model import IconType
from services import app_dsl_service
from services.app_dsl_service import (
    AppDslService,
    CheckDependenciesPendingData,
    ImportMode,
    ImportStatus,
    PendingData,
    _check_version_compatibility,
)


class _FakeHttpResponse:
    def __init__(self, content: bytes, *, raises: Exception | None = None):
        self.content = content
        self._raises = raises

    def raise_for_status(self) -> None:
        if self._raises is not None:
            raise self._raises


def _account_mock(*, tenant_id: str = "tenant-1", account_id: str = "account-1") -> MagicMock:
    account = MagicMock(spec=Account)
    account.current_tenant_id = tenant_id
    account.id = account_id
    return account


def _yaml_dump(data: dict) -> str:
    return yaml.safe_dump(data, allow_unicode=True)


def _workflow_yaml(*, version: str = app_dsl_service.CURRENT_DSL_VERSION) -> str:
    return _yaml_dump(
        {
            "version": version,
            "kind": "app",
            "app": {"name": "My App", "mode": AppMode.WORKFLOW.value},
            "workflow": {"graph": {"nodes": []}, "features": {}},
        }
    )


def test_check_version_compatibility_invalid_version_returns_failed():
    assert _check_version_compatibility("not-a-version") == ImportStatus.FAILED


def test_check_version_compatibility_newer_version_returns_pending():
    assert _check_version_compatibility("99.0.0") == ImportStatus.PENDING


def test_check_version_compatibility_major_older_returns_pending(monkeypatch):
    monkeypatch.setattr(app_dsl_service, "CURRENT_DSL_VERSION", "1.0.0")
    assert _check_version_compatibility("0.9.9") == ImportStatus.PENDING


def test_check_version_compatibility_minor_older_returns_completed_with_warnings():
    assert _check_version_compatibility("0.5.0") == ImportStatus.COMPLETED_WITH_WARNINGS


def test_check_version_compatibility_equal_returns_completed():
    assert _check_version_compatibility(app_dsl_service.CURRENT_DSL_VERSION) == ImportStatus.COMPLETED


def test_import_app_invalid_import_mode_raises_value_error():
    service = AppDslService(MagicMock())
    with pytest.raises(ValueError, match="Invalid import_mode"):
        service.import_app(account=_account_mock(), import_mode="invalid-mode", yaml_content="version: '0.1.0'")


def test_import_app_yaml_url_requires_url():
    service = AppDslService(MagicMock())
    result = service.import_app(account=_account_mock(), import_mode=ImportMode.YAML_URL, yaml_url=None)
    assert result.status == ImportStatus.FAILED
    assert "yaml_url is required" in result.error


def test_import_app_yaml_content_requires_content():
    service = AppDslService(MagicMock())
    result = service.import_app(account=_account_mock(), import_mode=ImportMode.YAML_CONTENT, yaml_content=None)
    assert result.status == ImportStatus.FAILED
    assert "yaml_content is required" in result.error


def test_import_app_yaml_url_fetch_error_returns_failed(monkeypatch):
    def fake_get(_url: str, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", fake_get)

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(), import_mode=ImportMode.YAML_URL, yaml_url="https://example.com/a.yml"
    )
    assert result.status == ImportStatus.FAILED
    assert "Error fetching YAML from URL: boom" in result.error


def test_import_app_yaml_url_empty_content_returns_failed(monkeypatch):
    def fake_get(_url: str, **_kwargs):
        return _FakeHttpResponse(b"")

    monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", fake_get)

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(), import_mode=ImportMode.YAML_URL, yaml_url="https://example.com/a.yml"
    )
    assert result.status == ImportStatus.FAILED
    assert "Empty content" in result.error


def test_import_app_yaml_url_file_too_large_returns_failed(monkeypatch):
    def fake_get(_url: str, **_kwargs):
        return _FakeHttpResponse(b"x" * (app_dsl_service.DSL_MAX_SIZE + 1))

    monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", fake_get)

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(), import_mode=ImportMode.YAML_URL, yaml_url="https://example.com/a.yml"
    )
    assert result.status == ImportStatus.FAILED
    assert "File size exceeds" in result.error


def test_import_app_yaml_not_mapping_returns_failed():
    service = AppDslService(MagicMock())
    result = service.import_app(account=_account_mock(), import_mode=ImportMode.YAML_CONTENT, yaml_content="[]")
    assert result.status == ImportStatus.FAILED
    assert "content must be a mapping" in result.error


def test_import_app_version_not_str_returns_failed():
    service = AppDslService(MagicMock())
    yaml_content = _yaml_dump({"version": 1, "kind": "app", "app": {"name": "x", "mode": "workflow"}})
    result = service.import_app(account=_account_mock(), import_mode=ImportMode.YAML_CONTENT, yaml_content=yaml_content)
    assert result.status == ImportStatus.FAILED
    assert "Invalid version type" in result.error


def test_import_app_missing_app_data_returns_failed():
    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(),
        import_mode=ImportMode.YAML_CONTENT,
        yaml_content=_yaml_dump({"version": "0.6.0", "kind": "app"}),
    )
    assert result.status == ImportStatus.FAILED
    assert "Missing app data" in result.error


def test_import_app_app_id_not_found_returns_failed(monkeypatch):
    def fake_select(_model):
        stmt = MagicMock()
        stmt.where.return_value = stmt
        return stmt

    monkeypatch.setattr(app_dsl_service, "select", fake_select)

    session = MagicMock()
    session.scalar.return_value = None
    service = AppDslService(session)
    result = service.import_app(
        account=_account_mock(),
        import_mode=ImportMode.YAML_CONTENT,
        yaml_content=_workflow_yaml(),
        app_id="missing-app",
    )
    assert result.status == ImportStatus.FAILED
    assert result.error == "App not found"


def test_import_app_overwrite_only_allows_workflow_and_advanced_chat(monkeypatch):
    def fake_select(_model):
        stmt = MagicMock()
        stmt.where.return_value = stmt
        return stmt

    monkeypatch.setattr(app_dsl_service, "select", fake_select)

    existing_app = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT.value)

    session = MagicMock()
    session.scalar.return_value = existing_app
    service = AppDslService(session)
    result = service.import_app(
        account=_account_mock(),
        import_mode=ImportMode.YAML_CONTENT,
        yaml_content=_workflow_yaml(),
        app_id="app-1",
    )
    assert result.status == ImportStatus.FAILED
    assert "Only workflow or advanced chat apps" in result.error


def test_import_app_pending_stores_import_info_in_redis():
    service = AppDslService(MagicMock())
    app_dsl_service.redis_client.setex.reset_mock()
    result = service.import_app(
        account=_account_mock(),
        import_mode=ImportMode.YAML_CONTENT,
        yaml_content=_workflow_yaml(version="99.0.0"),
        name="n",
        description="d",
        icon_type="emoji",
        icon="i",
        icon_background="#000000",
    )
    assert result.status == ImportStatus.PENDING
    assert result.imported_dsl_version == "99.0.0"

    app_dsl_service.redis_client.setex.assert_called_once()
    call = app_dsl_service.redis_client.setex.call_args
    redis_key = call.args[0]
    assert redis_key.startswith(app_dsl_service.IMPORT_INFO_REDIS_KEY_PREFIX)


def test_import_app_completed_uses_declared_dependencies(monkeypatch):
    dependencies_payload = [{"id": "langgenius/google", "version": "1.0.0"}]

    plugin_deps = [SimpleNamespace(model_dump=lambda: dependencies_payload[0])]
    monkeypatch.setattr(
        app_dsl_service.PluginDependency,
        "model_validate",
        lambda d: plugin_deps[0],
    )

    created_app = SimpleNamespace(id="app-new", mode=AppMode.WORKFLOW.value, tenant_id="tenant-1")
    monkeypatch.setattr(AppDslService, "_create_or_update_app", lambda *_args, **_kwargs: created_app)

    draft_var_service = MagicMock()
    monkeypatch.setattr(app_dsl_service, "WorkflowDraftVariableService", lambda *args, **kwargs: draft_var_service)

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(),
        import_mode=ImportMode.YAML_CONTENT,
        yaml_content=_yaml_dump(
            {
                "version": app_dsl_service.CURRENT_DSL_VERSION,
                "kind": "app",
                "app": {"name": "My App", "mode": AppMode.WORKFLOW.value},
                "workflow": {"graph": {"nodes": []}, "features": {}},
                "dependencies": dependencies_payload,
            }
        ),
    )

    assert result.status == ImportStatus.COMPLETED
    assert result.app_id == "app-new"
    draft_var_service.delete_app_workflow_variables.assert_called_once_with(app_id="app-new")


@pytest.mark.parametrize("has_workflow", [True, False])
def test_import_app_legacy_versions_extract_dependencies(monkeypatch, has_workflow: bool):
    monkeypatch.setattr(
        AppDslService,
        "_extract_dependencies_from_workflow_graph",
        lambda *_args, **_kwargs: ["from-workflow"],
    )
    monkeypatch.setattr(
        AppDslService,
        "_extract_dependencies_from_model_config",
        lambda *_args, **_kwargs: ["from-model-config"],
    )
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        lambda deps: [SimpleNamespace(model_dump=lambda: {"dep": deps[0]})],
    )

    created_app = SimpleNamespace(id="app-legacy", mode=AppMode.WORKFLOW.value, tenant_id="tenant-1")
    monkeypatch.setattr(AppDslService, "_create_or_update_app", lambda *_args, **_kwargs: created_app)

    draft_var_service = MagicMock()
    monkeypatch.setattr(app_dsl_service, "WorkflowDraftVariableService", lambda *args, **kwargs: draft_var_service)

    data: dict = {
        "version": "0.1.5",
        "kind": "app",
        "app": {"name": "Legacy", "mode": AppMode.WORKFLOW.value},
    }
    if has_workflow:
        data["workflow"] = {"graph": {"nodes": []}, "features": {}}
    else:
        data["model_config"] = {"model": {"provider": "openai"}}

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(), import_mode=ImportMode.YAML_CONTENT, yaml_content=_yaml_dump(data)
    )
    assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS
    draft_var_service.delete_app_workflow_variables.assert_called_once_with(app_id="app-legacy")


def test_import_app_yaml_error_returns_failed(monkeypatch):
    def bad_safe_load(_content: str):
        raise yaml.YAMLError("bad")

    monkeypatch.setattr(app_dsl_service.yaml, "safe_load", bad_safe_load)

    service = AppDslService(MagicMock())
    result = service.import_app(account=_account_mock(), import_mode=ImportMode.YAML_CONTENT, yaml_content="x: y")
    assert result.status == ImportStatus.FAILED
    assert result.error.startswith("Invalid YAML format:")


def test_import_app_unexpected_error_returns_failed(monkeypatch):
    monkeypatch.setattr(
        AppDslService, "_create_or_update_app", lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("oops"))
    )

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(), import_mode=ImportMode.YAML_CONTENT, yaml_content=_workflow_yaml()
    )
    assert result.status == ImportStatus.FAILED
    assert result.error == "oops"


def test_confirm_import_expired_returns_failed():
    service = AppDslService(MagicMock())
    result = service.confirm_import(import_id="import-1", account=_account_mock())
    assert result.status == ImportStatus.FAILED
    assert "expired" in result.error


def test_confirm_import_invalid_pending_data_type_returns_failed():
    app_dsl_service.redis_client.get.return_value = 123
    service = AppDslService(MagicMock())
    result = service.confirm_import(import_id="import-1", account=_account_mock())
    assert result.status == ImportStatus.FAILED
    assert "Invalid import information" in result.error


def test_confirm_import_success_deletes_redis_key(monkeypatch):
    def fake_select(_model):
        stmt = MagicMock()
        stmt.where.return_value = stmt
        return stmt

    monkeypatch.setattr(app_dsl_service, "select", fake_select)

    session = MagicMock()
    session.scalar.return_value = None
    service = AppDslService(session)

    pending = PendingData(
        import_mode=ImportMode.YAML_CONTENT,
        yaml_content=_workflow_yaml(),
        name="name",
        description="desc",
        icon_type="emoji",
        icon="🤖",
        icon_background="#fff",
        app_id=None,
    )
    app_dsl_service.redis_client.get.return_value = pending.model_dump_json()

    created_app = SimpleNamespace(id="confirmed-app", mode=AppMode.WORKFLOW.value, tenant_id="tenant-1")
    monkeypatch.setattr(AppDslService, "_create_or_update_app", lambda *_args, **_kwargs: created_app)

    app_dsl_service.redis_client.delete.reset_mock()
    result = service.confirm_import(import_id="import-1", account=_account_mock())
    assert result.status == ImportStatus.COMPLETED
    assert result.app_id == "confirmed-app"
    app_dsl_service.redis_client.delete.assert_called_once_with(
        f"{app_dsl_service.IMPORT_INFO_REDIS_KEY_PREFIX}import-1"
    )


def test_confirm_import_exception_returns_failed(monkeypatch):
    app_dsl_service.redis_client.get.return_value = "not-json"
    monkeypatch.setattr(
        PendingData, "model_validate_json", lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad"))
    )

    service = AppDslService(MagicMock())
    result = service.confirm_import(import_id="import-1", account=_account_mock())
    assert result.status == ImportStatus.FAILED
    assert result.error == "bad"


def test_check_dependencies_returns_empty_when_no_redis_data():
    service = AppDslService(MagicMock())
    result = service.check_dependencies(app_model=SimpleNamespace(id="app-1", tenant_id="tenant-1"))
    assert result.leaked_dependencies == []


def test_check_dependencies_calls_analysis_service(monkeypatch):
    pending = CheckDependenciesPendingData(dependencies=[], app_id="app-1").model_dump_json()
    app_dsl_service.redis_client.get.return_value = pending
    dep = app_dsl_service.PluginDependency.model_validate(
        {"type": "package", "value": {"plugin_unique_identifier": "acme/foo", "version": "1.0.0"}}
    )
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "get_leaked_dependencies",
        lambda *, tenant_id, dependencies: [dep],
    )

    service = AppDslService(MagicMock())
    result = service.check_dependencies(app_model=SimpleNamespace(id="app-1", tenant_id="tenant-1"))
    assert len(result.leaked_dependencies) == 1


def test_create_or_update_app_missing_mode_raises():
    service = AppDslService(MagicMock())
    with pytest.raises(ValueError, match="loss app mode"):
        service._create_or_update_app(app=None, data={"app": {}}, account=_account_mock())


def test_create_or_update_app_existing_app_updates_fields(monkeypatch):
    fixed_now = object()
    monkeypatch.setattr(app_dsl_service, "naive_utc_now", lambda: fixed_now)

    workflow_service = MagicMock()
    workflow_service.get_draft_workflow.return_value = None
    monkeypatch.setattr(app_dsl_service, "WorkflowService", lambda: workflow_service)
    monkeypatch.setattr(
        app_dsl_service.variable_factory,
        "build_environment_variable_from_mapping",
        lambda _m: SimpleNamespace(kind="env"),
    )
    monkeypatch.setattr(
        app_dsl_service.variable_factory,
        "build_conversation_variable_from_mapping",
        lambda _m: SimpleNamespace(kind="conv"),
    )

    app = SimpleNamespace(
        id="app-1",
        tenant_id="tenant-1",
        mode=AppMode.WORKFLOW.value,
        name="old",
        description="old-desc",
        icon_type=IconType.EMOJI,
        icon="old-icon",
        icon_background="#111111",
        updated_by=None,
        updated_at=None,
        app_model_config=None,
    )
    service = AppDslService(MagicMock())
    updated = service._create_or_update_app(
        app=app,
        data={
            "app": {"mode": AppMode.WORKFLOW.value, "name": "yaml-name", "icon_type": IconType.IMAGE, "icon": "X"},
            "workflow": {"graph": {"nodes": []}, "features": {}},
        },
        account=_account_mock(),
        name="override-name",
        description=None,
        icon_background="#222222",
    )
    assert updated is app
    assert app.name == "override-name"
    assert app.icon_type == IconType.IMAGE
    assert app.icon == "X"
    assert app.icon_background == "#222222"
    assert app.updated_at is fixed_now


def test_create_or_update_app_new_app_requires_tenant():
    account = _account_mock()
    account.current_tenant_id = None
    service = AppDslService(MagicMock())
    with pytest.raises(ValueError, match="Current tenant is not set"):
        service._create_or_update_app(
            app=None,
            data={"app": {"mode": AppMode.WORKFLOW.value, "name": "n"}},
            account=account,
        )


def test_create_or_update_app_creates_workflow_app_and_saves_dependencies(monkeypatch):
    class DummyApp(SimpleNamespace):
        pass

    monkeypatch.setattr(app_dsl_service, "App", DummyApp)

    sent: list[tuple[str, object]] = []
    monkeypatch.setattr(app_dsl_service.app_was_created, "send", lambda app, account: sent.append((app.id, account.id)))

    workflow_service = MagicMock()
    workflow_service.get_draft_workflow.return_value = SimpleNamespace(unique_hash="uh")
    monkeypatch.setattr(app_dsl_service, "WorkflowService", lambda: workflow_service)

    monkeypatch.setattr(
        app_dsl_service.variable_factory,
        "build_environment_variable_from_mapping",
        lambda _m: SimpleNamespace(kind="env"),
    )
    monkeypatch.setattr(
        app_dsl_service.variable_factory,
        "build_conversation_variable_from_mapping",
        lambda _m: SimpleNamespace(kind="conv"),
    )

    monkeypatch.setattr(
        AppDslService, "decrypt_dataset_id", lambda *_args, **_kwargs: "00000000-0000-0000-0000-000000000000"
    )

    session = MagicMock()
    service = AppDslService(session)
    deps = [
        app_dsl_service.PluginDependency.model_validate(
            {"type": "package", "value": {"plugin_unique_identifier": "acme/foo", "version": "1.0.0"}}
        )
    ]
    data = {
        "app": {"mode": AppMode.WORKFLOW.value, "name": "n"},
        "workflow": {
            "environment_variables": [{"x": 1}],
            "conversation_variables": [{"y": 2}],
            "graph": {
                "nodes": [
                    {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "dataset_ids": ["enc-1", "enc-2"]}},
                ]
            },
            "features": {},
        },
    }

    app = service._create_or_update_app(app=None, data=data, account=_account_mock(), dependencies=deps)

    assert app.tenant_id == "tenant-1"
    assert sent == [(app.id, "account-1")]
    app_dsl_service.redis_client.setex.assert_called()
    workflow_service.sync_draft_workflow.assert_called_once()

    passed_graph = workflow_service.sync_draft_workflow.call_args.kwargs["graph"]
    dataset_ids = passed_graph["nodes"][0]["data"]["dataset_ids"]
    assert dataset_ids == ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"]


def test_create_or_update_app_workflow_missing_workflow_data_raises():
    service = AppDslService(MagicMock())
    with pytest.raises(ValueError, match="Missing workflow data"):
        service._create_or_update_app(
            app=SimpleNamespace(
                id="a",
                tenant_id="t",
                mode=AppMode.WORKFLOW.value,
                name="n",
                description="d",
                icon_background="#fff",
                app_model_config=None,
            ),
            data={"app": {"mode": AppMode.WORKFLOW.value}},
            account=_account_mock(),
        )


def test_create_or_update_app_chat_requires_model_config():
    service = AppDslService(MagicMock())
    with pytest.raises(ValueError, match="Missing model_config"):
        service._create_or_update_app(
            app=SimpleNamespace(
                id="a",
                tenant_id="t",
                mode=AppMode.CHAT.value,
                name="n",
                description="d",
                icon_background="#fff",
                app_model_config=None,
            ),
            data={"app": {"mode": AppMode.CHAT.value}},
            account=_account_mock(),
        )


def test_create_or_update_app_chat_creates_model_config_and_sends_event(monkeypatch):
    class DummyModelConfig(SimpleNamespace):
        def from_model_config_dict(self, _cfg: dict):
            return self

    monkeypatch.setattr(app_dsl_service, "AppModelConfig", DummyModelConfig)

    sent: list[str] = []
    monkeypatch.setattr(
        app_dsl_service.app_model_config_was_updated, "send", lambda app, app_model_config: sent.append(app.id)
    )

    session = MagicMock()
    service = AppDslService(session)

    app = SimpleNamespace(
        id="app-1",
        tenant_id="tenant-1",
        mode=AppMode.CHAT.value,
        name="n",
        description="d",
        icon_background="#fff",
        app_model_config=None,
    )
    service._create_or_update_app(
        app=app,
        data={"app": {"mode": AppMode.CHAT.value}, "model_config": {"model": {"provider": "openai"}}},
        account=_account_mock(),
    )

    assert app.app_model_config_id is not None
    assert sent == ["app-1"]
    session.add.assert_called()


def test_create_or_update_app_invalid_mode_raises():
    service = AppDslService(MagicMock())
    with pytest.raises(ValueError, match="Invalid app mode"):
        service._create_or_update_app(
            app=SimpleNamespace(
                id="a",
                tenant_id="t",
                mode=AppMode.RAG_PIPELINE.value,
                name="n",
                description="d",
                icon_background="#fff",
                app_model_config=None,
            ),
            data={"app": {"mode": AppMode.RAG_PIPELINE.value}},
            account=_account_mock(),
        )


def test_export_dsl_delegates_by_mode(monkeypatch):
    workflow_calls: list[bool] = []
    model_calls: list[bool] = []
    monkeypatch.setattr(AppDslService, "_append_workflow_export_data", lambda **_kwargs: workflow_calls.append(True))
    monkeypatch.setattr(
        AppDslService, "_append_model_config_export_data", lambda *_args, **_kwargs: model_calls.append(True)
    )

    workflow_app = SimpleNamespace(
        mode=AppMode.WORKFLOW.value,
        tenant_id="tenant-1",
        name="n",
        icon="i",
        icon_type="emoji",
        icon_background="#fff",
        description="d",
        use_icon_as_answer_icon=False,
        app_model_config=None,
    )
    AppDslService.export_dsl(workflow_app)
    assert workflow_calls == [True]

    chat_app = SimpleNamespace(
        mode=AppMode.CHAT.value,
        tenant_id="tenant-1",
        name="n",
        icon="i",
        icon_type="emoji",
        icon_background="#fff",
        description="d",
        use_icon_as_answer_icon=False,
        app_model_config=SimpleNamespace(to_dict=lambda: {"agent_mode": {"tools": []}}),
    )
    AppDslService.export_dsl(chat_app)
    assert model_calls == [True]


def test_export_dsl_preserves_icon_and_icon_type(monkeypatch):
    monkeypatch.setattr(AppDslService, "_append_workflow_export_data", lambda **_kwargs: None)

    emoji_app = SimpleNamespace(
        mode=AppMode.WORKFLOW.value,
        tenant_id="tenant-1",
        name="Emoji App",
        icon="🎨",
        icon_type=IconType.EMOJI,
        icon_background="#FF5733",
        description="App with emoji icon",
        use_icon_as_answer_icon=True,
        app_model_config=None,
    )
    yaml_output = AppDslService.export_dsl(emoji_app)
    data = yaml.safe_load(yaml_output)
    assert data["app"]["icon"] == "🎨"
    assert data["app"]["icon_type"] == "emoji"
    assert data["app"]["icon_background"] == "#FF5733"

    image_app = SimpleNamespace(
        mode=AppMode.WORKFLOW.value,
        tenant_id="tenant-1",
        name="Image App",
        icon="https://example.com/icon.png",
        icon_type=IconType.IMAGE,
        icon_background="#FFEAD5",
        description="App with image icon",
        use_icon_as_answer_icon=False,
        app_model_config=None,
    )
    yaml_output = AppDslService.export_dsl(image_app)
    data = yaml.safe_load(yaml_output)
    assert data["app"]["icon"] == "https://example.com/icon.png"
    assert data["app"]["icon_type"] == "image"
    assert data["app"]["icon_background"] == "#FFEAD5"


def test_append_workflow_export_data_filters_and_overrides(monkeypatch):
    workflow_dict = {
        "graph": {
            "nodes": [
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "dataset_ids": ["d1", "d2"]}},
                {"data": {"type": BuiltinNodeTypes.TOOL, "credential_id": "secret"}},
                {
                    "data": {
                        "type": BuiltinNodeTypes.AGENT,
                        "agent_parameters": {"tools": {"value": [{"credential_id": "secret"}]}},
                    }
                },
                {"data": {"type": TRIGGER_SCHEDULE_NODE_TYPE, "config": {"x": 1}}},
                {"data": {"type": TRIGGER_WEBHOOK_NODE_TYPE, "webhook_url": "x", "webhook_debug_url": "y"}},
                {"data": {"type": TRIGGER_PLUGIN_NODE_TYPE, "subscription_id": "s"}},
            ]
        }
    }

    workflow = SimpleNamespace(to_dict=lambda *, include_secret: workflow_dict)
    workflow_service = MagicMock()
    workflow_service.get_draft_workflow.return_value = workflow
    monkeypatch.setattr(app_dsl_service, "WorkflowService", lambda: workflow_service)

    monkeypatch.setattr(
        AppDslService, "encrypt_dataset_id", lambda *, dataset_id, tenant_id: f"enc:{tenant_id}:{dataset_id}"
    )
    monkeypatch.setattr(
        TriggerScheduleNode := app_dsl_service.TriggerScheduleNode,
        "get_default_config",
        lambda: {"config": {"default": True}},
    )
    monkeypatch.setattr(AppDslService, "_extract_dependencies_from_workflow", lambda *_args, **_kwargs: ["dep-1"])
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "generate_dependencies",
        lambda *, tenant_id, dependencies: [
            SimpleNamespace(model_dump=lambda: {"tenant": tenant_id, "dep": dependencies[0]})
        ],
    )
    monkeypatch.setattr(app_dsl_service, "jsonable_encoder", lambda x: x)

    export_data: dict = {}
    AppDslService._append_workflow_export_data(
        export_data=export_data,
        app_model=SimpleNamespace(tenant_id="tenant-1"),
        include_secret=False,
        workflow_id=None,
    )

    nodes = export_data["workflow"]["graph"]["nodes"]
    assert nodes[0]["data"]["dataset_ids"] == ["enc:tenant-1:d1", "enc:tenant-1:d2"]
    assert "credential_id" not in nodes[1]["data"]
    assert "credential_id" not in nodes[2]["data"]["agent_parameters"]["tools"]["value"][0]
    assert nodes[3]["data"]["config"] == {"default": True}
    assert nodes[4]["data"]["webhook_url"] == ""
    assert nodes[4]["data"]["webhook_debug_url"] == ""
    assert nodes[5]["data"]["subscription_id"] == ""
    assert export_data["dependencies"] == [{"tenant": "tenant-1", "dep": "dep-1"}]


def test_append_workflow_export_data_missing_workflow_raises(monkeypatch):
    workflow_service = MagicMock()
    workflow_service.get_draft_workflow.return_value = None
    monkeypatch.setattr(app_dsl_service, "WorkflowService", lambda: workflow_service)

    with pytest.raises(ValueError, match="Missing draft workflow configuration"):
        AppDslService._append_workflow_export_data(
            export_data={},
            app_model=SimpleNamespace(tenant_id="tenant-1"),
            include_secret=False,
            workflow_id=None,
        )


def test_append_model_config_export_data_filters_credential_id(monkeypatch):
    monkeypatch.setattr(AppDslService, "_extract_dependencies_from_model_config", lambda *_args, **_kwargs: ["dep-1"])
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "generate_dependencies",
        lambda *, tenant_id, dependencies: [
            SimpleNamespace(model_dump=lambda: {"tenant": tenant_id, "dep": dependencies[0]})
        ],
    )
    monkeypatch.setattr(app_dsl_service, "jsonable_encoder", lambda x: x)

    app_model_config = SimpleNamespace(to_dict=lambda: {"agent_mode": {"tools": [{"credential_id": "secret"}]}})
    app_model = SimpleNamespace(tenant_id="tenant-1", app_model_config=app_model_config)
    export_data: dict = {}

    AppDslService._append_model_config_export_data(export_data, app_model)
    assert export_data["model_config"]["agent_mode"]["tools"] == [{}]
    assert export_data["dependencies"] == [{"tenant": "tenant-1", "dep": "dep-1"}]


def test_append_model_config_export_data_requires_app_config():
    with pytest.raises(ValueError, match="Missing app configuration"):
        AppDslService._append_model_config_export_data({}, SimpleNamespace(app_model_config=None))


def test_extract_dependencies_from_workflow_graph_covers_all_node_types(monkeypatch):
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "analyze_tool_dependency",
        lambda provider_id: f"tool:{provider_id}",
    )
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "analyze_model_provider_dependency",
        lambda provider: f"model:{provider}",
    )

    monkeypatch.setattr(app_dsl_service.ToolNodeData, "model_validate", lambda _d: SimpleNamespace(provider_id="p1"))
    monkeypatch.setattr(
        app_dsl_service.LLMNodeData, "model_validate", lambda _d: SimpleNamespace(model=SimpleNamespace(provider="m1"))
    )
    monkeypatch.setattr(
        app_dsl_service.QuestionClassifierNodeData,
        "model_validate",
        lambda _d: SimpleNamespace(model=SimpleNamespace(provider="m2")),
    )
    monkeypatch.setattr(
        app_dsl_service.ParameterExtractorNodeData,
        "model_validate",
        lambda _d: SimpleNamespace(model=SimpleNamespace(provider="m3")),
    )

    def kr_validate(_d):
        return SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="weighted_score",
                weights=SimpleNamespace(vector_setting=SimpleNamespace(embedding_provider_name="m4")),
                reranking_model=None,
            ),
            single_retrieval_config=None,
        )

    monkeypatch.setattr(app_dsl_service.KnowledgeRetrievalNodeData, "model_validate", kr_validate)

    graph = {
        "nodes": [
            {"data": {"type": BuiltinNodeTypes.TOOL}},
            {"data": {"type": BuiltinNodeTypes.LLM}},
            {"data": {"type": BuiltinNodeTypes.QUESTION_CLASSIFIER}},
            {"data": {"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR}},
            {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}},
            {"data": {"type": "unknown"}},
        ]
    }

    deps = AppDslService._extract_dependencies_from_workflow_graph(graph)
    assert deps == ["tool:p1", "model:m1", "model:m2", "model:m3", "model:m4"]


def test_extract_dependencies_from_workflow_graph_handles_exceptions(monkeypatch):
    monkeypatch.setattr(
        app_dsl_service.ToolNodeData, "model_validate", lambda _d: (_ for _ in ()).throw(ValueError("bad"))
    )
    deps = AppDslService._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.TOOL}}]}
    )
    assert deps == []


def test_extract_dependencies_from_model_config_parses_providers(monkeypatch):
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "analyze_model_provider_dependency",
        lambda provider: f"model:{provider}",
    )
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "analyze_tool_dependency",
        lambda provider_id: f"tool:{provider_id}",
    )

    deps = AppDslService._extract_dependencies_from_model_config(
        {
            "model": {"provider": "p1"},
            "dataset_configs": {
                "datasets": {"datasets": [{"reranking_model": {"reranking_provider_name": {"provider": "p2"}}}]}
            },
            "agent_mode": {"tools": [{"provider_id": "t1"}]},
        }
    )
    assert deps == ["model:p1", "model:p2", "tool:t1"]


def test_extract_dependencies_from_model_config_handles_exceptions(monkeypatch):
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "analyze_model_provider_dependency",
        lambda _p: (_ for _ in ()).throw(ValueError("bad")),
    )
    deps = AppDslService._extract_dependencies_from_model_config({"model": {"provider": "p1"}})
    assert deps == []


def test_get_leaked_dependencies_empty_returns_empty():
    assert AppDslService.get_leaked_dependencies("tenant-1", []) == []


def test_get_leaked_dependencies_delegates(monkeypatch):
    monkeypatch.setattr(
        app_dsl_service.DependenciesAnalysisService,
        "get_leaked_dependencies",
        lambda *, tenant_id, dependencies: [SimpleNamespace(tenant_id=tenant_id, deps=dependencies)],
    )
    res = AppDslService.get_leaked_dependencies("tenant-1", [SimpleNamespace(id="x")])
    assert len(res) == 1


def test_encrypt_decrypt_dataset_id_respects_config(monkeypatch):
    tenant_id = "tenant-1"
    dataset_uuid = "00000000-0000-0000-0000-000000000000"

    monkeypatch.setattr(app_dsl_service.dify_config, "DSL_EXPORT_ENCRYPT_DATASET_ID", False)
    assert AppDslService.encrypt_dataset_id(dataset_id=dataset_uuid, tenant_id=tenant_id) == dataset_uuid

    monkeypatch.setattr(app_dsl_service.dify_config, "DSL_EXPORT_ENCRYPT_DATASET_ID", True)
    encrypted = AppDslService.encrypt_dataset_id(dataset_id=dataset_uuid, tenant_id=tenant_id)
    assert encrypted != dataset_uuid
    assert base64.b64decode(encrypted.encode())
    assert AppDslService.decrypt_dataset_id(encrypted_data=encrypted, tenant_id=tenant_id) == dataset_uuid


def test_decrypt_dataset_id_returns_plain_uuid_unchanged():
    value = "00000000-0000-0000-0000-000000000000"
    assert AppDslService.decrypt_dataset_id(encrypted_data=value, tenant_id="tenant-1") == value


def test_decrypt_dataset_id_returns_none_on_invalid_data(monkeypatch):
    monkeypatch.setattr(app_dsl_service.dify_config, "DSL_EXPORT_ENCRYPT_DATASET_ID", True)
    assert AppDslService.decrypt_dataset_id(encrypted_data="not-base64", tenant_id="tenant-1") is None


def test_decrypt_dataset_id_returns_none_when_decrypted_is_not_uuid(monkeypatch):
    monkeypatch.setattr(app_dsl_service.dify_config, "DSL_EXPORT_ENCRYPT_DATASET_ID", True)
    encrypted = AppDslService.encrypt_dataset_id(dataset_id="not-a-uuid", tenant_id="tenant-1")
    assert AppDslService.decrypt_dataset_id(encrypted_data=encrypted, tenant_id="tenant-1") is None


def test_is_valid_uuid_handles_bad_inputs():
    assert AppDslService._is_valid_uuid("00000000-0000-0000-0000-000000000000") is True
    assert AppDslService._is_valid_uuid("nope") is False
