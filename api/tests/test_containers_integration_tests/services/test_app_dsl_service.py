from __future__ import annotations

import base64
import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
import yaml
from faker import Faker
from flask import Flask
from sqlalchemy.orm import Session

from core.trigger.constants import (
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)
from extensions.ext_redis import redis_client
from graphon.enums import BuiltinNodeTypes
from models import Account, App, AppMode
from models.model import AppModelConfig, IconType
from services import app_dsl_service
from services.account_service import AccountService, TenantService
from services.app_dsl_service import (
    CHECK_DEPENDENCIES_REDIS_KEY_PREFIX,
    CURRENT_DSL_VERSION,
    DSL_MAX_SIZE,
    IMPORT_INFO_REDIS_EXPIRY,
    IMPORT_INFO_REDIS_KEY_PREFIX,
    AppDslService,
    CheckDependenciesPendingData,
    ImportMode,
    ImportStatus,
    PendingData,
    _check_version_compatibility,
)
from services.app_service import AppService, CreateAppParams
from tests.test_containers_integration_tests.helpers import generate_valid_password

_DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_DEFAULT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000002"


def _account_mock(*, tenant_id: str = _DEFAULT_TENANT_ID, account_id: str = _DEFAULT_ACCOUNT_ID) -> MagicMock:
    account = MagicMock(spec=Account)
    account.current_tenant_id = tenant_id
    account.id = account_id
    return account


def _yaml_dump(data: dict) -> str:
    return yaml.safe_dump(data, allow_unicode=True)


def _workflow_yaml(*, version: str = CURRENT_DSL_VERSION) -> str:
    return _yaml_dump(
        {
            "version": version,
            "kind": "app",
            "app": {"name": "My App", "mode": AppMode.WORKFLOW.value},
            "workflow": {"graph": {"nodes": []}, "features": {}},
        }
    )


def _pending_yaml_content(version: str = "99.0.0") -> bytes:
    return (f'version: "{version}"\nkind: app\napp:\n  name: Loop Test\n  mode: workflow\n').encode()


def _app_stub(**overrides: Any) -> App:
    """Create a stub App object for testing without hitting the database."""
    defaults = {
        "id": str(uuid4()),
        "tenant_id": _DEFAULT_TENANT_ID,
        "mode": AppMode.WORKFLOW.value,
        "name": "n",
        "description": "d",
        "icon_type": IconType.EMOJI,
        "icon": "i",
        "icon_background": "#fff",
        "use_icon_as_answer_icon": False,
        "app_model_config": None,
    }
    app = MagicMock(spec=App)
    for key, value in (defaults | overrides).items():
        object.__setattr__(app, key, value)
    return app


class TestAppDslService:
    """Integration tests for AppDslService using testcontainers."""

    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.app_dsl_service.WorkflowService") as mock_workflow_service,
            patch("services.app_dsl_service.DependenciesAnalysisService") as mock_dependencies_service,
            patch("services.app_dsl_service.app_was_created") as mock_app_was_created,
            patch("services.app_service.ModelManager.for_tenant") as mock_model_manager,
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
        ):
            mock_workflow_service.return_value.get_draft_workflow.return_value = None
            mock_workflow_service.return_value.sync_draft_workflow.return_value = MagicMock()
            mock_dependencies_service.generate_latest_dependencies.return_value = []
            mock_dependencies_service.get_leaked_dependencies.return_value = []
            mock_dependencies_service.generate_dependencies.return_value = []
            mock_app_was_created.send.return_value = None

            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = (
                "openai",
                "gpt-3.5-turbo",
            )

            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None

            yield {
                "workflow_service": mock_workflow_service,
                "dependencies_service": mock_dependencies_service,
                "app_was_created": mock_app_was_created,
                "model_manager": mock_model_manager,
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
            }

    def _create_test_app_and_account(self, db_session_with_containers: Session, mock_external_service_dependencies):
        fake = Faker()
        with patch("services.account_service.FeatureService") as mock_account_feature_service:
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True
            account = AccountService.create_account(
                email=fake.email(),
                name=fake.name(),
                interface_language="en-US",
                password=generate_valid_password(fake),
            )
            TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
            tenant = account.current_tenant
            app_args = CreateAppParams(
                name=fake.company(),
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🤖",
                icon_background="#FF6B6B",
                api_rph=100,
                api_rpm=10,
            )
            app_service = AppService()
            app = app_service.create_app(tenant.id, app_args, account)
            return app, account

    def _create_simple_yaml_content(self, app_name: str = "Test App", app_mode: str = "chat") -> str:
        yaml_data = {
            "version": "0.3.0",
            "kind": "app",
            "app": {
                "name": app_name,
                "mode": app_mode,
                "icon": "🤖",
                "icon_background": "#FFEAD5",
                "description": "Test app description",
                "use_icon_as_answer_icon": False,
            },
            "model_config": {
                "model": {
                    "provider": "openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {
                        "max_tokens": 1000,
                        "temperature": 0.7,
                        "top_p": 1.0,
                    },
                },
                "pre_prompt": "You are a helpful assistant.",
                "prompt_type": "simple",
            },
        }
        return yaml.dump(yaml_data, allow_unicode=True)

    # ── Version Compatibility ─────────────────────────────────────────

    def test_check_version_compatibility_invalid_version_returns_failed(self):
        assert _check_version_compatibility("not-a-version") == ImportStatus.FAILED

    def test_check_version_compatibility_newer_version_returns_pending(self):
        assert _check_version_compatibility("99.0.0") == ImportStatus.PENDING

    def test_check_version_compatibility_major_older_returns_pending(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(app_dsl_service, "CURRENT_DSL_VERSION", "1.0.0")
        assert _check_version_compatibility("0.9.9") == ImportStatus.PENDING

    def test_check_version_compatibility_minor_older_returns_completed_with_warnings(
        self,
    ):
        assert _check_version_compatibility("0.5.0") == ImportStatus.COMPLETED_WITH_WARNINGS

    def test_check_version_compatibility_equal_returns_completed(self):
        assert _check_version_compatibility(CURRENT_DSL_VERSION) == ImportStatus.COMPLETED

    # ── Import: Validation ────────────────────────────────────────────

    def test_import_app_invalid_import_mode_raises_value_error(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        with pytest.raises(ValueError, match="Invalid import_mode"):
            service.import_app(
                account=_account_mock(),
                import_mode="invalid-mode",
                yaml_content="version: '0.1.0'",
            )

    def test_import_app_missing_yaml_content(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=None,
        )
        assert result.status == ImportStatus.FAILED
        assert "yaml_content is required" in result.error

    def test_import_app_missing_yaml_url(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_URL,
            yaml_url=None,
        )
        assert result.status == ImportStatus.FAILED
        assert "yaml_url is required" in result.error

    def test_import_app_yaml_not_mapping_returns_failed(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content="[]",
        )
        assert result.status == ImportStatus.FAILED
        assert "content must be a mapping" in result.error

    def test_import_app_version_not_str_returns_failed(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        yaml_content = _yaml_dump({"version": 1, "kind": "app", "app": {"name": "x", "mode": "workflow"}})
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
        )
        assert result.status == ImportStatus.FAILED
        assert "Invalid version type" in result.error

    def test_import_app_missing_app_data_returns_failed(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_yaml_dump({"version": "0.6.0", "kind": "app"}),
        )
        assert result.status == ImportStatus.FAILED
        assert "Missing app data" in result.error

    def test_import_app_yaml_error_returns_failed(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        def bad_safe_load(_content: str):
            raise yaml.YAMLError("bad")

        monkeypatch.setattr(app_dsl_service.yaml, "safe_load", bad_safe_load)

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content="x: y",
        )
        assert result.status == ImportStatus.FAILED
        assert result.error.startswith("Invalid YAML format:")

    def test_import_app_unexpected_error_returns_failed(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setattr(
            AppDslService,
            "_create_or_update_app",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("oops")),
        )

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_workflow_yaml(),
        )
        assert result.status == ImportStatus.FAILED
        assert result.error == "oops"

    # ── Import: YAML URL ──────────────────────────────────────────────

    def test_import_app_yaml_url_fetch_error_returns_failed(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setattr(
            app_dsl_service.ssrf_proxy,
            "get",
            lambda _url, **_kw: (_ for _ in ()).throw(RuntimeError("boom")),
        )

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_URL,
            yaml_url="https://example.com/a.yml",
        )
        assert result.status == ImportStatus.FAILED
        assert "Error fetching YAML from URL: boom" in result.error

    def test_import_app_yaml_url_empty_content_returns_failed(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        response = MagicMock()
        response.content = b""
        response.raise_for_status.return_value = None
        monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", lambda _url, **_kw: response)

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_URL,
            yaml_url="https://example.com/a.yml",
        )
        assert result.status == ImportStatus.FAILED
        assert "Empty content" in result.error

    def test_import_app_yaml_url_file_too_large_returns_failed(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        response = MagicMock()
        response.content = b"x" * (DSL_MAX_SIZE + 1)
        response.raise_for_status.return_value = None
        monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", lambda _url, **_kw: response)

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_URL,
            yaml_url="https://example.com/a.yml",
        )
        assert result.status == ImportStatus.FAILED
        assert "File size exceeds" in result.error

    def test_import_app_yaml_url_user_attachments_keeps_original_url(
        self, db_session_with_containers: Session, monkeypatch
    ):
        yaml_url = "https://github.com/user-attachments/files/24290802/loop-test.yml"
        yaml_bytes = _pending_yaml_content()

        requested_urls: list[str] = []

        def fake_get(url: str, **kwargs):
            requested_urls.append(url)
            response = MagicMock()
            response.content = yaml_bytes
            response.raise_for_status.return_value = None
            return response

        monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", fake_get)

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_URL,
            yaml_url=yaml_url,
        )

        assert result.status == ImportStatus.PENDING
        assert result.imported_dsl_version == "99.0.0"
        assert requested_urls == [yaml_url]

    def test_import_app_yaml_url_github_blob_rewrites_to_raw(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        yaml_url = "https://github.com/acme/repo/blob/main/app.yml"
        raw_url = "https://raw.githubusercontent.com/acme/repo/main/app.yml"
        yaml_bytes = _pending_yaml_content()

        requested_urls: list[str] = []

        def fake_get(url: str, **kwargs):
            requested_urls.append(url)
            assert url == raw_url
            response = MagicMock()
            response.content = yaml_bytes
            response.raise_for_status.return_value = None
            return response

        monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", fake_get)

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_URL,
            yaml_url=yaml_url,
        )

        assert result.status == ImportStatus.PENDING
        assert requested_urls == [raw_url]

    # ── Import: App ID checks ────────────────────────────────────────

    def test_import_app_app_id_not_found_returns_failed(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_workflow_yaml(),
            app_id=str(uuid4()),
        )
        assert result.status == ImportStatus.FAILED
        assert result.error == "App not found"

    def test_import_app_overwrite_only_allows_workflow_and_advanced_chat(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        assert app.mode == "chat"

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_workflow_yaml(),
            app_id=app.id,
        )
        assert result.status == ImportStatus.FAILED
        assert "Only workflow or advanced chat apps" in result.error

    # ── Import: Flow ──────────────────────────────────────────────────

    def test_import_app_pending_stores_import_info_in_redis(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
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

        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{result.id}"
        stored = redis_client.get(redis_key)
        assert stored is not None

    def test_import_app_completed_uses_declared_dependencies(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        _, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        dependencies_payload = [
            {
                "type": "package",
                "value": {
                    "plugin_unique_identifier": "langgenius/google",
                    "version": "1.0.0",
                },
            }
        ]

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_yaml_dump(
                {
                    "version": CURRENT_DSL_VERSION,
                    "kind": "app",
                    "app": {"name": "My App", "mode": AppMode.WORKFLOW.value},
                    "workflow": {"graph": {"nodes": []}, "features": {}},
                    "dependencies": dependencies_payload,
                }
            ),
        )

        assert result.status == ImportStatus.COMPLETED
        assert result.app_id is not None

    @pytest.mark.parametrize("has_workflow", [True, False])
    def test_import_app_legacy_versions_extract_dependencies(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch, has_workflow: bool
    ):
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

        created_app = SimpleNamespace(
            id=str(uuid4()),
            mode=AppMode.WORKFLOW.value,
            tenant_id=_DEFAULT_TENANT_ID,
        )
        monkeypatch.setattr(
            AppDslService,
            "_create_or_update_app",
            lambda *_args, **_kwargs: created_app,
        )

        draft_var_service = MagicMock()
        monkeypatch.setattr(
            app_dsl_service,
            "WorkflowDraftVariableService",
            lambda *args, **kwargs: draft_var_service,
        )

        data: dict = {
            "version": "0.1.5",
            "kind": "app",
            "app": {"name": "Legacy", "mode": AppMode.WORKFLOW.value},
        }
        if has_workflow:
            data["workflow"] = {"graph": {"nodes": []}, "features": {}}
        else:
            data["model_config"] = {"model": {"provider": "openai"}}

        service = AppDslService(db_session_with_containers)
        result = service.import_app(
            account=_account_mock(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_yaml_dump(data),
        )
        assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS
        draft_var_service.delete_app_workflow_variables.assert_called_once_with(app_id=created_app.id)

    # ── Confirm Import ────────────────────────────────────────────────

    def test_confirm_import_expired_returns_failed(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        result = service.confirm_import(import_id=str(uuid4()), account=_account_mock())
        assert result.status == ImportStatus.FAILED
        assert "expired" in result.error

    def test_confirm_import_success_deletes_redis_key(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        import_id = str(uuid4())
        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}"

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
        redis_client.setex(redis_key, IMPORT_INFO_REDIS_EXPIRY, pending.model_dump_json())

        created_app = SimpleNamespace(
            id=str(uuid4()),
            mode=AppMode.WORKFLOW.value,
            tenant_id=_DEFAULT_TENANT_ID,
        )
        monkeypatch.setattr(
            AppDslService,
            "_create_or_update_app",
            lambda *_args, **_kwargs: created_app,
        )

        service = AppDslService(db_session_with_containers)
        result = service.confirm_import(import_id=import_id, account=_account_mock())
        assert result.status == ImportStatus.COMPLETED
        assert result.app_id == created_app.id
        assert redis_client.get(redis_key) is None

    def test_confirm_import_invalid_pending_data_type_returns_failed(self, db_session_with_containers: Session):
        import_id = str(uuid4())
        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}"
        redis_client.setex(redis_key, IMPORT_INFO_REDIS_EXPIRY, "123")

        service = AppDslService(db_session_with_containers)
        result = service.confirm_import(import_id=import_id, account=_account_mock())
        assert result.status == ImportStatus.FAILED
        assert "validation error" in result.error

    def test_confirm_import_exception_returns_failed(self, db_session_with_containers: Session):
        import_id = str(uuid4())
        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}"
        redis_client.setex(redis_key, IMPORT_INFO_REDIS_EXPIRY, "not-valid-json")

        service = AppDslService(db_session_with_containers)
        result = service.confirm_import(import_id=import_id, account=_account_mock())
        assert result.status == ImportStatus.FAILED

    # ── Check Dependencies ────────────────────────────────────────────

    def test_check_dependencies_returns_empty_when_no_redis_data(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        app_model = _app_stub()
        result = service.check_dependencies(app_model=app_model)
        assert result.leaked_dependencies == []

    def test_check_dependencies_calls_analysis_service(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        app_id = str(uuid4())
        pending = CheckDependenciesPendingData(dependencies=[], app_id=app_id)
        redis_client.setex(
            f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{app_id}",
            IMPORT_INFO_REDIS_EXPIRY,
            pending.model_dump_json(),
        )

        dep = app_dsl_service.PluginDependency.model_validate(
            {
                "type": "package",
                "value": {
                    "plugin_unique_identifier": "acme/foo",
                    "version": "1.0.0",
                },
            }
        )
        monkeypatch.setattr(
            app_dsl_service.DependenciesAnalysisService,
            "get_leaked_dependencies",
            lambda *, tenant_id, dependencies: [dep],
        )

        service = AppDslService(db_session_with_containers)
        result = service.check_dependencies(app_model=_app_stub(id=app_id))
        assert len(result.leaked_dependencies) == 1

    def test_check_dependencies_with_real_app(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        mock_dependencies_json = '{"app_id": "' + app.id + '", "dependencies": []}'
        redis_client.setex(
            f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{app.id}",
            IMPORT_INFO_REDIS_EXPIRY,
            mock_dependencies_json,
        )

        dsl_service = AppDslService(db_session_with_containers)
        result = dsl_service.check_dependencies(app_model=app)
        assert result.leaked_dependencies == []

    # ── Create/Update App ─────────────────────────────────────────────

    def test_create_or_update_app_missing_mode_raises(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        with pytest.raises(ValueError, match="loss app mode"):
            service._create_or_update_app(app=None, data={"app": {}}, account=_account_mock())

    def test_create_or_update_app_existing_app_updates_fields(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
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

        app = _app_stub(
            mode=AppMode.WORKFLOW.value,
            name="old",
            description="old-desc",
            icon_type=IconType.EMOJI,
            icon="old-icon",
            icon_background="#111111",
            updated_by=None,
            updated_at=None,
        )
        service = AppDslService(db_session_with_containers)
        updated = service._create_or_update_app(
            app=app,
            data={
                "app": {
                    "mode": AppMode.WORKFLOW.value,
                    "name": "yaml-name",
                    "icon_type": IconType.IMAGE,
                    "icon": "X",
                },
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

    def test_create_or_update_app_new_app_requires_tenant(self, db_session_with_containers: Session):
        account = _account_mock()
        account.current_tenant_id = None
        service = AppDslService(db_session_with_containers)
        with pytest.raises(ValueError, match="Current tenant is not set"):
            service._create_or_update_app(
                app=None,
                data={"app": {"mode": AppMode.WORKFLOW.value, "name": "n"}},
                account=account,
            )

    def test_create_or_update_app_creates_workflow_app_and_saves_dependencies(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        _, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        mock_wf_svc = mock_external_service_dependencies["workflow_service"]
        mock_wf_svc.return_value.get_draft_workflow.return_value = MagicMock(unique_hash="uh")

        service = AppDslService(db_session_with_containers)
        deps = [
            app_dsl_service.PluginDependency.model_validate(
                {
                    "type": "package",
                    "value": {
                        "plugin_unique_identifier": "acme/foo",
                        "version": "1.0.0",
                    },
                }
            )
        ]
        data = {
            "app": {"mode": AppMode.WORKFLOW.value, "name": "n"},
            "workflow": {
                "graph": {"nodes": []},
                "features": {},
            },
        }

        app = service._create_or_update_app(app=None, data=data, account=account, dependencies=deps)

        assert app.tenant_id == account.current_tenant_id
        mock_external_service_dependencies["app_was_created"].send.assert_called_once()
        mock_wf_svc.return_value.sync_draft_workflow.assert_called_once()

        stored = redis_client.get(f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{app.id}")
        assert stored is not None

    def test_create_or_update_app_workflow_missing_workflow_data_raises(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        with pytest.raises(ValueError, match="Missing workflow data"):
            service._create_or_update_app(
                app=_app_stub(mode=AppMode.WORKFLOW.value),
                data={"app": {"mode": AppMode.WORKFLOW.value}},
                account=_account_mock(),
            )

    def test_create_or_update_app_chat_requires_model_config(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        with pytest.raises(ValueError, match="Missing model_config"):
            service._create_or_update_app(
                app=_app_stub(mode=AppMode.CHAT),
                data={"app": {"mode": AppMode.CHAT}},
                account=_account_mock(),
            )

    def test_create_or_update_app_chat_creates_model_config_and_sends_event(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        app.app_model_config_id = None
        db_session_with_containers.commit()

        service = AppDslService(db_session_with_containers)
        service._create_or_update_app(
            app=app,
            data={
                "app": {"mode": AppMode.CHAT},
                "model_config": {"model": {"provider": "openai"}},
            },
            account=account,
        )

        db_session_with_containers.expire_all()
        assert app.app_model_config_id is not None

    def test_create_or_update_app_invalid_mode_raises(self, db_session_with_containers: Session):
        service = AppDslService(db_session_with_containers)
        with pytest.raises(ValueError, match="Invalid app mode"):
            service._create_or_update_app(
                app=_app_stub(mode=AppMode.RAG_PIPELINE),
                data={"app": {"mode": AppMode.RAG_PIPELINE}},
                account=_account_mock(),
            )

    # ── Export ─────────────────────────────────────────────────────────

    def test_export_dsl_delegates_by_mode(self, monkeypatch: pytest.MonkeyPatch):
        workflow_calls: list[bool] = []
        model_calls: list[bool] = []
        monkeypatch.setattr(
            AppDslService,
            "_append_workflow_export_data",
            lambda **_kwargs: workflow_calls.append(True),
        )
        monkeypatch.setattr(
            AppDslService,
            "_append_model_config_export_data",
            lambda *_args, **_kwargs: model_calls.append(True),
        )

        workflow_app = _app_stub(
            mode=AppMode.WORKFLOW.value,
            icon_type="emoji",
        )
        AppDslService.export_dsl(workflow_app)
        assert workflow_calls == [True]

        chat_app = _app_stub(
            mode=AppMode.CHAT,
            icon_type="emoji",
            app_model_config=SimpleNamespace(to_dict=lambda: {"agent_mode": {"tools": []}}),
        )
        AppDslService.export_dsl(chat_app)
        assert model_calls == [True]

    def test_export_dsl_preserves_icon_and_icon_type(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            AppDslService,
            "_append_workflow_export_data",
            lambda **_kwargs: None,
        )

        emoji_app = _app_stub(
            mode=AppMode.WORKFLOW.value,
            name="Emoji App",
            icon="🎨",
            icon_type=IconType.EMOJI,
            icon_background="#FF5733",
            description="App with emoji icon",
            use_icon_as_answer_icon=True,
        )
        yaml_output = AppDslService.export_dsl(emoji_app)
        data = yaml.safe_load(yaml_output)
        assert data["app"]["icon"] == "🎨"
        assert data["app"]["icon_type"] == "emoji"
        assert data["app"]["icon_background"] == "#FF5733"

        image_app = _app_stub(
            mode=AppMode.WORKFLOW.value,
            name="Image App",
            icon="https://example.com/icon.png",
            icon_type=IconType.IMAGE,
            icon_background="#FFEAD5",
            description="App with image icon",
            use_icon_as_answer_icon=False,
        )
        yaml_output = AppDslService.export_dsl(image_app)
        data = yaml.safe_load(yaml_output)
        assert data["app"]["icon"] == "https://example.com/icon.png"
        assert data["app"]["icon_type"] == "image"
        assert data["app"]["icon_background"] == "#FFEAD5"

    def test_export_dsl_chat_app_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        model_config = AppModelConfig(
            app_id=app.id,
            provider="openai",
            model_id="gpt-3.5-turbo",
            model=json.dumps(
                {
                    "provider": "openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {
                        "max_tokens": 1000,
                        "temperature": 0.7,
                    },
                }
            ),
            pre_prompt="You are a helpful assistant.",
            prompt_type="simple",
            created_by=account.id,
            updated_by=account.id,
        )
        model_config.id = str(uuid4())
        app.app_model_config_id = model_config.id

        db_session_with_containers.add(model_config)
        db_session_with_containers.commit()

        exported_dsl = AppDslService.export_dsl(app, include_secret=False)
        exported_data = yaml.safe_load(exported_dsl)

        assert exported_data["kind"] == "app"
        assert exported_data["app"]["name"] == app.name
        assert exported_data["app"]["mode"] == app.mode
        assert "model_config" in exported_data
        assert "dependencies" in exported_data

    def test_export_dsl_workflow_app_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        app.mode = "workflow"
        db_session_with_containers.commit()

        mock_workflow = MagicMock()
        mock_workflow.to_dict.return_value = {
            "graph": {
                "nodes": [
                    {
                        "id": "start",
                        "type": "start",
                        "data": {"type": "start"},
                    }
                ],
                "edges": [],
            },
            "features": {},
            "environment_variables": [],
            "conversation_variables": [],
        }
        mock_external_service_dependencies[
            "workflow_service"
        ].return_value.get_draft_workflow.return_value = mock_workflow

        exported_dsl = AppDslService.export_dsl(app, include_secret=False)
        exported_data = yaml.safe_load(exported_dsl)

        assert exported_data["kind"] == "app"
        assert exported_data["app"]["mode"] == "workflow"
        assert "workflow" in exported_data
        assert "dependencies" in exported_data

    def test_export_dsl_with_workflow_id_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        app.mode = "workflow"
        db_session_with_containers.commit()

        mock_workflow = MagicMock()
        mock_workflow.to_dict.return_value = {
            "graph": {
                "nodes": [
                    {
                        "id": "start",
                        "type": "start",
                        "data": {"type": "start"},
                    }
                ],
                "edges": [],
            },
            "features": {},
            "environment_variables": [],
            "conversation_variables": [],
        }

        workflow_id = str(uuid4())

        def mock_get_draft_workflow(app_model, wf_id=None):
            if wf_id == workflow_id:
                return mock_workflow
            return None

        mock_external_service_dependencies[
            "workflow_service"
        ].return_value.get_draft_workflow.side_effect = mock_get_draft_workflow

        exported_dsl = AppDslService.export_dsl(app, include_secret=False, workflow_id=workflow_id)
        exported_data = yaml.safe_load(exported_dsl)

        assert exported_data["kind"] == "app"
        assert "workflow" in exported_data

    def test_export_dsl_with_invalid_workflow_id_raises_error(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        app.mode = "workflow"
        db_session_with_containers.commit()

        mock_external_service_dependencies["workflow_service"].return_value.get_draft_workflow.return_value = None

        with pytest.raises(
            ValueError,
            match="Missing draft workflow configuration, please check.",
        ):
            AppDslService.export_dsl(app, include_secret=False, workflow_id=str(uuid4()))

    # ── Workflow Export Data ───────────────────────────────────────────

    def test_append_workflow_export_data_filters_and_overrides(self, monkeypatch: pytest.MonkeyPatch):
        workflow_dict = {
            "graph": {
                "nodes": [
                    {
                        "data": {
                            "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                            "dataset_ids": ["d1", "d2"],
                        }
                    },
                    {
                        "data": {
                            "type": BuiltinNodeTypes.TOOL,
                            "credential_id": "secret",
                        }
                    },
                    {
                        "data": {
                            "type": BuiltinNodeTypes.AGENT,
                            "agent_parameters": {"tools": {"value": [{"credential_id": "secret"}]}},
                        }
                    },
                    {
                        "data": {
                            "type": TRIGGER_SCHEDULE_NODE_TYPE,
                            "config": {"x": 1},
                        }
                    },
                    {
                        "data": {
                            "type": TRIGGER_WEBHOOK_NODE_TYPE,
                            "webhook_url": "x",
                            "webhook_debug_url": "y",
                        }
                    },
                    {
                        "data": {
                            "type": TRIGGER_PLUGIN_NODE_TYPE,
                            "subscription_id": "s",
                        }
                    },
                ]
            }
        }

        workflow = SimpleNamespace(to_dict=lambda *, include_secret: workflow_dict)
        workflow_service = MagicMock()
        workflow_service.get_draft_workflow.return_value = workflow
        monkeypatch.setattr(app_dsl_service, "WorkflowService", lambda: workflow_service)

        monkeypatch.setattr(
            AppDslService,
            "encrypt_dataset_id",
            lambda *, dataset_id, tenant_id: f"enc:{tenant_id}:{dataset_id}",
        )
        monkeypatch.setattr(
            app_dsl_service.TriggerScheduleNode,
            "get_default_config",
            lambda: {"config": {"default": True}},
        )
        monkeypatch.setattr(
            AppDslService,
            "_extract_dependencies_from_workflow",
            lambda *_args, **_kwargs: ["dep-1"],
        )
        monkeypatch.setattr(
            app_dsl_service.DependenciesAnalysisService,
            "generate_dependencies",
            lambda *, tenant_id, dependencies: [
                SimpleNamespace(
                    model_dump=lambda: {
                        "tenant": tenant_id,
                        "dep": dependencies[0],
                    }
                )
            ],
        )
        monkeypatch.setattr(app_dsl_service, "jsonable_encoder", lambda x: x)

        export_data: dict = {}
        AppDslService._append_workflow_export_data(
            export_data=export_data,
            app_model=_app_stub(),
            include_secret=False,
            workflow_id=None,
        )

        nodes = export_data["workflow"]["graph"]["nodes"]
        assert nodes[0]["data"]["dataset_ids"] == [
            f"enc:{_DEFAULT_TENANT_ID}:d1",
            f"enc:{_DEFAULT_TENANT_ID}:d2",
        ]
        assert "credential_id" not in nodes[1]["data"]
        assert "credential_id" not in nodes[2]["data"]["agent_parameters"]["tools"]["value"][0]
        assert nodes[3]["data"]["config"] == {"default": True}
        assert nodes[4]["data"]["webhook_url"] == ""
        assert nodes[4]["data"]["webhook_debug_url"] == ""
        assert nodes[5]["data"]["subscription_id"] == ""
        assert export_data["dependencies"] == [{"tenant": _DEFAULT_TENANT_ID, "dep": "dep-1"}]

    def test_append_workflow_export_data_missing_workflow_raises(self, monkeypatch: pytest.MonkeyPatch):
        workflow_service = MagicMock()
        workflow_service.get_draft_workflow.return_value = None
        monkeypatch.setattr(app_dsl_service, "WorkflowService", lambda: workflow_service)

        with pytest.raises(ValueError, match="Missing draft workflow configuration"):
            AppDslService._append_workflow_export_data(
                export_data={},
                app_model=_app_stub(),
                include_secret=False,
                workflow_id=None,
            )

    # ── Model Config Export Data ──────────────────────────────────────

    def test_append_model_config_export_data_filters_credential_id(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            AppDslService,
            "_extract_dependencies_from_model_config",
            lambda *_args, **_kwargs: ["dep-1"],
        )
        monkeypatch.setattr(
            app_dsl_service.DependenciesAnalysisService,
            "generate_dependencies",
            lambda *, tenant_id, dependencies: [
                SimpleNamespace(
                    model_dump=lambda: {
                        "tenant": tenant_id,
                        "dep": dependencies[0],
                    }
                )
            ],
        )
        monkeypatch.setattr(app_dsl_service, "jsonable_encoder", lambda x: x)

        app_model_config = SimpleNamespace(to_dict=lambda: {"agent_mode": {"tools": [{"credential_id": "secret"}]}})
        app_model = _app_stub(app_model_config=app_model_config)
        export_data: dict = {}

        AppDslService._append_model_config_export_data(export_data, app_model)
        assert export_data["model_config"]["agent_mode"]["tools"] == [{}]
        assert export_data["dependencies"] == [{"tenant": _DEFAULT_TENANT_ID, "dep": "dep-1"}]

    def test_append_model_config_export_data_requires_app_config(self):
        with pytest.raises(ValueError, match="Missing app configuration"):
            AppDslService._append_model_config_export_data({}, _app_stub(app_model_config=None))

    # ── Dependency Extraction ─────────────────────────────────────────

    def test_extract_dependencies_from_workflow_graph_covers_all_node_types(self, monkeypatch: pytest.MonkeyPatch):
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

        monkeypatch.setattr(
            app_dsl_service.ToolNodeData,
            "model_validate",
            lambda _d: SimpleNamespace(provider_id="p1"),
        )
        monkeypatch.setattr(
            app_dsl_service.LLMNodeData,
            "model_validate",
            lambda _d: SimpleNamespace(model=SimpleNamespace(provider="m1")),
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

        monkeypatch.setattr(
            app_dsl_service.KnowledgeRetrievalNodeData,
            "model_validate",
            kr_validate,
        )

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
        assert deps == [
            "tool:p1",
            "model:m1",
            "model:m2",
            "model:m3",
            "model:m4",
        ]

    def test_extract_dependencies_from_workflow_graph_handles_exceptions(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            app_dsl_service.ToolNodeData,
            "model_validate",
            lambda _d: (_ for _ in ()).throw(ValueError("bad")),
        )
        deps = AppDslService._extract_dependencies_from_workflow_graph(
            {"nodes": [{"data": {"type": BuiltinNodeTypes.TOOL}}]}
        )
        assert deps == []

    def test_extract_dependencies_from_model_config_parses_providers(self, monkeypatch: pytest.MonkeyPatch):
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

    def test_extract_dependencies_from_model_config_handles_exceptions(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            app_dsl_service.DependenciesAnalysisService,
            "analyze_model_provider_dependency",
            lambda _p: (_ for _ in ()).throw(ValueError("bad")),
        )
        deps = AppDslService._extract_dependencies_from_model_config({"model": {"provider": "p1"}})
        assert deps == []

    # ── Leaked Dependencies ───────────────────────────────────────────

    def test_get_leaked_dependencies_empty_returns_empty(self):
        assert AppDslService.get_leaked_dependencies(_DEFAULT_TENANT_ID, []) == []

    def test_get_leaked_dependencies_delegates(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            app_dsl_service.DependenciesAnalysisService,
            "get_leaked_dependencies",
            lambda *, tenant_id, dependencies: [SimpleNamespace(tenant_id=tenant_id, deps=dependencies)],
        )
        res = AppDslService.get_leaked_dependencies(_DEFAULT_TENANT_ID, [SimpleNamespace(id="x")])
        assert len(res) == 1

    # ── Encryption/Decryption ─────────────────────────────────────────

    def test_encrypt_decrypt_dataset_id_respects_config(self, monkeypatch: pytest.MonkeyPatch):
        tenant_id = _DEFAULT_TENANT_ID
        dataset_uuid = "00000000-0000-0000-0000-000000000000"

        monkeypatch.setattr(
            app_dsl_service.dify_config,
            "DSL_EXPORT_ENCRYPT_DATASET_ID",
            False,
        )
        assert AppDslService.encrypt_dataset_id(dataset_id=dataset_uuid, tenant_id=tenant_id) == dataset_uuid

        monkeypatch.setattr(
            app_dsl_service.dify_config,
            "DSL_EXPORT_ENCRYPT_DATASET_ID",
            True,
        )
        encrypted = AppDslService.encrypt_dataset_id(dataset_id=dataset_uuid, tenant_id=tenant_id)
        assert encrypted != dataset_uuid
        assert base64.b64decode(encrypted.encode())
        assert AppDslService.decrypt_dataset_id(encrypted_data=encrypted, tenant_id=tenant_id) == dataset_uuid

    def test_decrypt_dataset_id_returns_plain_uuid_unchanged(self):
        value = "00000000-0000-0000-0000-000000000000"
        assert AppDslService.decrypt_dataset_id(encrypted_data=value, tenant_id=_DEFAULT_TENANT_ID) == value

    def test_decrypt_dataset_id_returns_none_on_invalid_data(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            app_dsl_service.dify_config,
            "DSL_EXPORT_ENCRYPT_DATASET_ID",
            True,
        )
        assert AppDslService.decrypt_dataset_id(encrypted_data="not-base64", tenant_id=_DEFAULT_TENANT_ID) is None

    def test_decrypt_dataset_id_returns_none_when_decrypted_is_not_uuid(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            app_dsl_service.dify_config,
            "DSL_EXPORT_ENCRYPT_DATASET_ID",
            True,
        )
        encrypted = AppDslService.encrypt_dataset_id(dataset_id="not-a-uuid", tenant_id=_DEFAULT_TENANT_ID)
        assert AppDslService.decrypt_dataset_id(encrypted_data=encrypted, tenant_id=_DEFAULT_TENANT_ID) is None

    # ── Utility ───────────────────────────────────────────────────────

    def test_is_valid_uuid_handles_bad_inputs(self):
        assert AppDslService._is_valid_uuid("00000000-0000-0000-0000-000000000000") is True
        assert AppDslService._is_valid_uuid("nope") is False
