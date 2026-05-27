from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from faker import Faker
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.ops.entities.config_entity import TracingProviderEnum
from models.model import TraceAppConfig
from services.account_service import AccountService, TenantService
from services.app_service import AppService, CreateAppParams
from services.ops_service import OpsService
from tests.test_containers_integration_tests.helpers import generate_valid_password


class TestOpsService:
    @pytest.fixture
    def mock_external_service_dependencies(self):
        with (
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager.for_tenant") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True
            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")
            yield {
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
                "model_manager": mock_model_manager,
                "account_feature_service": mock_account_feature_service,
            }

    @pytest.fixture
    def mock_ops_trace_manager(self):
        with patch("services.ops_service.OpsTraceManager") as mock:
            yield mock

    def _create_app(self, db_session_with_containers: Session, mock_external_service_dependencies):
        fake = Faker()
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant
        app_service = AppService()
        app = app_service.create_app(
            tenant.id,
            CreateAppParams(
                name=fake.company(),
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🤖",
                icon_background="#FF6B6B",
            ),
            account,
        )
        return app, account

    _SENTINEL = object()

    def _insert_trace_config(
        self,
        db_session: Session,
        app_id: str,
        provider: str,
        tracing_config: dict | None | object = _SENTINEL,
    ) -> TraceAppConfig:
        trace_config = TraceAppConfig(
            app_id=app_id,
            tracing_provider=provider,
            tracing_config=tracing_config if tracing_config is not self._SENTINEL else {"some": "config"},
        )
        db_session.add(trace_config)
        db_session.commit()
        return trace_config

    # ── get_tracing_app_config ─────────────────────────────────────────

    def test_get_tracing_app_config_no_config(self, db_session_with_containers: Session, mock_ops_trace_manager):
        result = OpsService.get_tracing_app_config(str(uuid.uuid4()), "arize")
        assert result is None

    def test_get_tracing_app_config_no_app(self, db_session_with_containers: Session, mock_ops_trace_manager):
        fake_app_id = str(uuid.uuid4())
        self._insert_trace_config(db_session_with_containers, fake_app_id, "arize")
        result = OpsService.get_tracing_app_config(fake_app_id, "arize")
        assert result is None

    def test_get_tracing_app_config_none_config(
        self, db_session_with_containers: Session, mock_external_service_dependencies, mock_ops_trace_manager
    ):
        app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
        self._insert_trace_config(db_session_with_containers, app.id, "arize", tracing_config=None)

        with pytest.raises(ValueError, match="Tracing config cannot be None."):
            OpsService.get_tracing_app_config(app.id, "arize")

    @pytest.mark.parametrize(
        ("provider", "default_url"),
        [
            ("arize", "https://app.arize.com/"),
            ("phoenix", "https://app.phoenix.arize.com/projects/"),
            ("langsmith", "https://smith.langchain.com/"),
            ("opik", "https://www.comet.com/opik/"),
            ("weave", "https://wandb.ai/"),
            ("aliyun", "https://arms.console.aliyun.com/"),
            ("tencent", "https://console.cloud.tencent.com/apm"),
            ("mlflow", "http://localhost:5000/"),
            ("databricks", "https://www.databricks.com/"),
        ],
    )
    def test_get_tracing_app_config_providers_exception(
        self, db_session_with_containers: Session, mock_external_service_dependencies, provider, default_url
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.decrypt_tracing_config.return_value = {}
            mock_otm.obfuscated_decrypt_token.return_value = {}
            mock_otm.get_trace_config_project_url.side_effect = Exception("error")
            mock_otm.get_trace_config_project_key.side_effect = Exception("error")

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, provider)

            result = OpsService.get_tracing_app_config(app.id, provider)

        assert result is not None
        assert result["tracing_config"]["project_url"] == default_url

    @pytest.mark.parametrize(
        "provider",
        ["arize", "phoenix", "langsmith", "opik", "weave", "aliyun", "tencent", "mlflow", "databricks"],
    )
    def test_get_tracing_app_config_providers_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies, provider
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.decrypt_tracing_config.return_value = {}
            mock_otm.obfuscated_decrypt_token.return_value = {"project_url": "success_url"}
            mock_otm.get_trace_config_project_url.return_value = "success_url"

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, provider)

            result = OpsService.get_tracing_app_config(app.id, provider)

        assert result is not None
        assert result["tracing_config"]["project_url"] == "success_url"

    def test_get_tracing_app_config_langfuse_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.decrypt_tracing_config.return_value = {"host": "https://api.langfuse.com"}
            mock_otm.obfuscated_decrypt_token.return_value = {"host": "https://api.langfuse.com"}
            mock_otm.get_trace_config_project_key.return_value = "key"

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, "langfuse")

            result = OpsService.get_tracing_app_config(app.id, "langfuse")

        assert result is not None
        assert result["tracing_config"]["project_url"] == "https://api.langfuse.com/project/key"

    def test_get_tracing_app_config_langfuse_exception(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.decrypt_tracing_config.return_value = {"host": "https://api.langfuse.com"}
            mock_otm.obfuscated_decrypt_token.return_value = {"host": "https://api.langfuse.com"}
            mock_otm.get_trace_config_project_key.side_effect = Exception("error")

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, "langfuse")

            result = OpsService.get_tracing_app_config(app.id, "langfuse")

        assert result is not None
        assert result["tracing_config"]["project_url"] == "https://api.langfuse.com/"

    # ── create_tracing_app_config ──────────────────────────────────────

    def test_create_tracing_app_config_invalid_provider(self, db_session_with_containers: Session):
        result = OpsService.create_tracing_app_config(str(uuid.uuid4()), "invalid_provider", {})
        assert result == {"error": "Invalid tracing provider: invalid_provider"}

    def test_create_tracing_app_config_invalid_credentials(
        self, db_session_with_containers: Session, mock_ops_trace_manager
    ):
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = False
        result = OpsService.create_tracing_app_config(
            str(uuid.uuid4()), TracingProviderEnum.LANGFUSE, {"public_key": "p", "secret_key": "s"}
        )
        assert result == {"error": "Invalid Credentials"}

    @pytest.mark.parametrize(
        ("provider", "config"),
        [
            (TracingProviderEnum.ARIZE, {}),
            (TracingProviderEnum.LANGFUSE, {"public_key": "p", "secret_key": "s"}),
            (TracingProviderEnum.LANGSMITH, {"api_key": "k", "project": "p"}),
            (TracingProviderEnum.ALIYUN, {"license_key": "k", "endpoint": "https://aliyun.com"}),
        ],
    )
    def test_create_tracing_app_config_project_url_exception(
        self, db_session_with_containers: Session, mock_external_service_dependencies, provider, config
    ):
        # Existing config causes the service to return None before reaching the DB insert
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.check_trace_config_is_effective.return_value = True
            mock_otm.get_trace_config_project_url.side_effect = Exception("error")
            mock_otm.get_trace_config_project_key.side_effect = Exception("error")

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, str(provider))

            result = OpsService.create_tracing_app_config(app.id, provider, config)

        assert result is None

    def test_create_tracing_app_config_langfuse_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.check_trace_config_is_effective.return_value = True
            mock_otm.get_trace_config_project_key.return_value = "key"
            mock_otm.encrypt_tracing_config.return_value = {}

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            result = OpsService.create_tracing_app_config(
                app.id,
                TracingProviderEnum.LANGFUSE,
                {"public_key": "p", "secret_key": "s", "host": "https://api.langfuse.com"},
            )

        assert result == {"result": "success"}

    def test_create_tracing_app_config_already_exists(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.check_trace_config_is_effective.return_value = True

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, str(TracingProviderEnum.ARIZE))

            result = OpsService.create_tracing_app_config(app.id, TracingProviderEnum.ARIZE, {})

        assert result is None

    def test_create_tracing_app_config_no_app(self, db_session_with_containers: Session, mock_ops_trace_manager):
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True
        result = OpsService.create_tracing_app_config(str(uuid.uuid4()), TracingProviderEnum.ARIZE, {})
        assert result is None

    def test_create_tracing_app_config_with_empty_other_keys(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # "project" is in other_keys for Arize; providing "" triggers default substitution
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.check_trace_config_is_effective.return_value = True
            mock_otm.get_trace_config_project_url.side_effect = Exception("no url")
            mock_otm.encrypt_tracing_config.return_value = {}

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            result = OpsService.create_tracing_app_config(app.id, TracingProviderEnum.ARIZE, {"project": ""})

        assert result == {"result": "success"}

    def test_create_tracing_app_config_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.check_trace_config_is_effective.return_value = True
            mock_otm.get_trace_config_project_url.return_value = "http://project_url"
            mock_otm.encrypt_tracing_config.return_value = {"encrypted": "config"}

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            result = OpsService.create_tracing_app_config(app.id, TracingProviderEnum.ARIZE, {})

        assert result == {"result": "success"}

    # ── update_tracing_app_config ──────────────────────────────────────

    def test_update_tracing_app_config_invalid_provider(self, db_session_with_containers: Session):
        with pytest.raises(ValueError, match="Invalid tracing provider: invalid_provider"):
            OpsService.update_tracing_app_config(str(uuid.uuid4()), "invalid_provider", {})

    def test_update_tracing_app_config_no_config(self, db_session_with_containers: Session, mock_ops_trace_manager):
        result = OpsService.update_tracing_app_config(str(uuid.uuid4()), TracingProviderEnum.ARIZE, {})
        assert result is None

    def test_update_tracing_app_config_no_app(self, db_session_with_containers: Session, mock_ops_trace_manager):
        fake_app_id = str(uuid.uuid4())
        self._insert_trace_config(db_session_with_containers, fake_app_id, str(TracingProviderEnum.ARIZE))
        mock_ops_trace_manager.encrypt_tracing_config.return_value = {}
        result = OpsService.update_tracing_app_config(fake_app_id, TracingProviderEnum.ARIZE, {})
        assert result is None

    def test_update_tracing_app_config_invalid_credentials(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.encrypt_tracing_config.return_value = {}
            mock_otm.decrypt_tracing_config.return_value = {}
            mock_otm.check_trace_config_is_effective.return_value = False

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, str(TracingProviderEnum.ARIZE))

            with pytest.raises(ValueError, match="Invalid Credentials"):
                OpsService.update_tracing_app_config(app.id, TracingProviderEnum.ARIZE, {})

    def test_update_tracing_app_config_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        with patch("services.ops_service.OpsTraceManager") as mock_otm:
            mock_otm.encrypt_tracing_config.return_value = {"updated": "config"}
            mock_otm.decrypt_tracing_config.return_value = {}
            mock_otm.check_trace_config_is_effective.return_value = True

            app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
            self._insert_trace_config(db_session_with_containers, app.id, str(TracingProviderEnum.ARIZE))

            result = OpsService.update_tracing_app_config(app.id, TracingProviderEnum.ARIZE, {})

        assert result is not None
        assert result["app_id"] == app.id

    # ── delete_tracing_app_config ──────────────────────────────────────

    def test_delete_tracing_app_config_no_config(self, db_session_with_containers: Session):
        result = OpsService.delete_tracing_app_config(str(uuid.uuid4()), "arize")
        assert result is None

    def test_delete_tracing_app_config_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        app, _ = self._create_app(db_session_with_containers, mock_external_service_dependencies)
        self._insert_trace_config(db_session_with_containers, app.id, "arize")

        result = OpsService.delete_tracing_app_config(app.id, "arize")

        assert result is True
        remaining = db_session_with_containers.scalar(
            select(TraceAppConfig)
            .where(TraceAppConfig.app_id == app.id, TraceAppConfig.tracing_provider == "arize")
            .limit(1)
        )
        assert remaining is None
