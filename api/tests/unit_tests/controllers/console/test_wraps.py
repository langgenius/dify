from types import SimpleNamespace
from typing import override
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request
from flask_login import LoginManager, UserMixin
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException

from controllers.common.wraps import _extract_resource_id
from controllers.console.error import NotInitValidateError, NotSetupError, UnauthorizedAndForceLogout
from controllers.console.workspace.error import AccountNotInitializedError
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    _is_setup_completed,
    account_initialization_required,
    cloud_edition_billing_enabled,
    cloud_edition_billing_paid_plan_required,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    cloud_utm_record,
    enterprise_license_required,
    is_admin_or_owner_required,
    model_validate,
    only_edition_cloud,
    only_edition_enterprise,
    only_edition_self_hosted,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
    with_current_user_id,
)
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.dataset import RateLimitLog
from services.feature_service import LicenseStatus


@pytest.fixture(autouse=True)
def reset_setup_required_cache():
    """Keep setup_required's process cache isolated across unit tests."""
    _is_setup_completed.reset_success()


class MockUser(UserMixin):
    """Simple User class for testing."""

    def __init__(self, user_id: str):
        self.id = user_id
        self.current_tenant_id = "tenant123"

    @override
    def get_id(self) -> str:
        return self.id


def make_account(account_id: str = "account-1") -> Account:
    account = Account(
        name="Test Account",
        email=f"{account_id}@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = account_id
    account.role = TenantAccountRole.OWNER
    return account


def create_app_with_login():
    """Create a Flask app with LoginManager configured."""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret-key"

    login_manager = LoginManager()
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str):
        return MockUser(user_id)

    return app


class TestAccountInitialization:
    """Test account initialization decorator"""

    def test_should_allow_initialized_account(self):
        """Test that initialized accounts can access protected views"""
        # Arrange
        mock_user = MagicMock()
        mock_user.status = AccountStatus.ACTIVE

        @account_initialization_required
        def protected_view():
            return "success"

        # Act
        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_user, "tenant123")):
            result = protected_view()

        # Assert
        assert result == "success"

    def test_should_reject_uninitialized_account(self):
        """Test that uninitialized accounts raise AccountNotInitializedError"""
        # Arrange
        mock_user = MagicMock()
        mock_user.status = AccountStatus.UNINITIALIZED

        @account_initialization_required
        def protected_view():
            return "success"

        # Act & Assert
        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_user, "tenant123")):
            with pytest.raises(AccountNotInitializedError):
                protected_view()


class TestCurrentContextInjection:
    """Test request context injection decorators."""

    def test_with_current_tenant_id_injects_tenant_id(self):
        class Handler:
            @with_current_tenant_id
            def get(self, current_tenant_id: str):
                return current_tenant_id

        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(MagicMock(), "tenant-123")):
            assert Handler().get() == "tenant-123"

    def test_with_current_user_injects_account(self):
        current_user = make_account()

        class Handler:
            @with_current_user
            def get(self, injected_user):
                return injected_user

        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(current_user, "tenant-123")):
            assert Handler().get() is current_user

    def test_with_current_user_id_injects_user_id_string(self):
        current_user = make_account("user-42")

        class Handler:
            @with_current_user_id
            def get(self, current_user_id: str):
                return current_user_id

        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(current_user, "tenant-123")):
            result = Handler().get()
            assert result == "user-42"
            assert isinstance(result, str)

    def test_stacked_current_context_injectors_preserve_argument_order(self):
        current_user = make_account()

        class Handler:
            @with_current_user
            @with_current_tenant_id
            def get(self, current_tenant_id: str, injected_user):
                return current_tenant_id, injected_user

        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(current_user, "tenant-123")):
            assert Handler().get() == ("tenant-123", current_user)

    def test_stacked_user_id_and_tenant_id_injectors(self):
        current_user = make_account("user-99")

        class Handler:
            @with_current_user_id
            @with_current_tenant_id
            def get(self, current_tenant_id: str, current_user_id: str):
                return current_user_id, current_tenant_id

        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(current_user, "tenant-456")):
            assert Handler().get() == ("user-99", "tenant-456")


class TestRbacPermissionRequired:
    """Test enterprise RBAC decorator."""

    def test_resource_scoped_check_uses_resource_id(self):
        current_user = make_account("account-1")

        @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_DELETE)
        def protected_view(**kwargs):
            return "ok"

        with (
            patch("controllers.common.wraps.dify_config.RBAC_ENABLED", True),
            patch("controllers.common.wraps.current_account_with_tenant", return_value=(current_user, "tenant-1")),
            patch("controllers.common.wraps._extract_resource_id", return_value="app-123") as mock_extract,
            patch("controllers.common.wraps._is_resource_owned_by_current_user", return_value=False) as mock_owned,
            patch("controllers.common.wraps.RBACService.CheckAccess.check", return_value=True) as mock_check,
        ):
            assert protected_view(app_id="app-123") == "ok"

        mock_extract.assert_called_once_with("app", {"app_id": "app-123"})
        mock_owned.assert_called_once_with("tenant-1", "account-1", "app", "app-123")
        mock_check.assert_called_once_with(
            "tenant-1",
            "account-1",
            scene="app_delete",
            resource_type="app",
            resource_id="app-123",
        )

    def test_workspace_scoped_check_skips_resource_id_extraction(self):
        current_user = make_account("account-2")

        @rbac_permission_required(
            RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT, resource_required=False
        )
        def protected_view():
            return "ok"

        with (
            patch("controllers.common.wraps.dify_config.RBAC_ENABLED", True),
            patch("controllers.common.wraps.current_account_with_tenant", return_value=(current_user, "tenant-2")),
            patch("controllers.common.wraps._extract_resource_id") as mock_extract,
            patch("controllers.common.wraps._is_resource_owned_by_current_user", return_value=False) as mock_owned,
            patch("controllers.common.wraps.RBACService.CheckAccess.check", return_value=True) as mock_check,
        ):
            assert protected_view() == "ok"

        mock_extract.assert_not_called()
        mock_owned.assert_not_called()
        mock_check.assert_called_once_with(
            "tenant-2",
            "account-2",
            scene="dataset_create_and_management",
            resource_type="dataset",
            resource_id=None,
        )

    def test_workspace_scene_omits_resource_type(self):
        current_user = make_account("account-3")

        @rbac_permission_required(
            RBACResourceScope.WORKSPACE, RBACPermission.WORKSPACE_ROLE_MANAGE, resource_required=False
        )
        def protected_view():
            return "ok"

        with (
            patch("controllers.common.wraps.dify_config.RBAC_ENABLED", True),
            patch("controllers.common.wraps.current_account_with_tenant", return_value=(current_user, "tenant-3")),
            patch("controllers.common.wraps.RBACService.CheckAccess.check", return_value=True) as mock_check,
        ):
            assert protected_view() == "ok"

        mock_check.assert_called_once_with(
            "tenant-3",
            "account-3",
            scene="workspace_role_manage",
            resource_type=None,
            resource_id=None,
        )

    def test_resource_owned_app_skips_rbac_check(self):
        current_user = make_account("account-4")

        @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_DELETE)
        def protected_view(**kwargs):
            return "ok"

        with (
            patch("controllers.common.wraps.dify_config.RBAC_ENABLED", True),
            patch("controllers.common.wraps.current_account_with_tenant", return_value=(current_user, "tenant-4")),
            patch("controllers.common.wraps._extract_resource_id", return_value="app-123"),
            patch("controllers.common.wraps._is_resource_owned_by_current_user", return_value=True) as mock_owned,
            patch("controllers.common.wraps.RBACService.CheckAccess.check") as mock_check,
        ):
            assert protected_view(app_id="app-123") == "ok"

        mock_owned.assert_called_once_with("tenant-4", "account-4", "app", "app-123")
        mock_check.assert_not_called()

    def test_resource_owned_dataset_skips_rbac_check(self):
        current_user = make_account("account-5")

        @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
        def protected_view(**kwargs):
            return "ok"

        with (
            patch("controllers.common.wraps.dify_config.RBAC_ENABLED", True),
            patch("controllers.common.wraps.current_account_with_tenant", return_value=(current_user, "tenant-5")),
            patch("controllers.common.wraps._extract_resource_id", return_value="dataset-123"),
            patch("controllers.common.wraps._is_resource_owned_by_current_user", return_value=True) as mock_owned,
            patch("controllers.common.wraps.RBACService.CheckAccess.check") as mock_check,
        ):
            assert protected_view(dataset_id="dataset-123") == "ok"

        mock_owned.assert_called_once_with("tenant-5", "account-5", "dataset", "dataset-123")
        mock_check.assert_not_called()

    def test_extract_resource_id_prefers_path_args(self):
        app = Flask(__name__)

        with app.test_request_context("/"):
            request.view_args = {"app_id": "view-app"}

            assert _extract_resource_id("app", {"app_id": "path-app"}) == "path-app"

    def test_extract_resource_id_falls_back_to_request_view_args(self):
        app = Flask(__name__)

        with app.test_request_context("/"):
            request.view_args = {"app_id": "view-app"}

            assert _extract_resource_id("app") == "view-app"

    def test_extract_resource_id_supports_legacy_route_aliases(self):
        app = Flask(__name__)

        with app.test_request_context("/apps/app-1/api-keys"):
            request.view_args = {"resource_id": "app-1"}
            assert _extract_resource_id(RBACResourceScope.APP) == "app-1"

        with app.test_request_context("/agent/agent-1/features"):
            request.view_args = {"agent_id": "agent-1"}
            assert _extract_resource_id(RBACResourceScope.APP) == "agent-1"

        with app.test_request_context("/datasets/dataset-1/api-keys"):
            request.view_args = {"resource_id": "dataset-1"}
            assert _extract_resource_id(RBACResourceScope.DATASET) == "dataset-1"

    def test_legacy_admin_decorator_noops_when_rbac_enabled(self):
        @is_admin_or_owner_required
        def protected_view():
            return "ok"

        with patch("controllers.console.wraps.dify_config.RBAC_ENABLED", True):
            assert protected_view() == "ok"


class TestModelValidationInjection:
    """Test request model validation decorator."""

    class Payload(BaseModel):
        name: str
        count: int

    def test_should_inject_payload_from_json_body(self):
        app = Flask(__name__)

        class Handler:
            @model_validate(TestModelValidationInjection.Payload)
            def post(self, payload: TestModelValidationInjection.Payload, item_id: str):
                return payload, item_id

        with app.test_request_context("/items/item-1", method="POST", json={"name": "alpha", "count": "2"}):
            payload, item_id = Handler().post(item_id="item-1")

        assert payload == self.Payload(name="alpha", count=2)
        assert item_id == "item-1"

    def test_should_inject_payload_from_query_params(self):
        app = Flask(__name__)

        class Handler:
            @model_validate(TestModelValidationInjection.Payload)
            def get(self, payload: TestModelValidationInjection.Payload):
                return payload

        with app.test_request_context("/items?name=alpha&count=2", method="GET"):
            payload = Handler().get()

        assert payload == self.Payload(name="alpha", count=2)

    def test_should_raise_unprocessable_entity_for_invalid_payload(self):
        app = Flask(__name__)

        class Handler:
            @model_validate(TestModelValidationInjection.Payload)
            def post(self, payload: TestModelValidationInjection.Payload):
                return payload

        with app.test_request_context("/items", method="POST", json={"name": "alpha"}):
            with pytest.raises(HTTPException) as exc_info:
                Handler().post()

        assert exc_info.value.code == 422
        assert exc_info.value.description is not None
        assert "count" in exc_info.value.description


class TestEditionChecks:
    """Test edition-specific decorators"""

    def test_only_edition_cloud_allows_cloud_edition(self):
        """Test cloud edition decorator allows CLOUD edition"""

        # Arrange
        @only_edition_cloud
        def cloud_view():
            return "cloud_success"

        # Act
        with patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"):
            result = cloud_view()

        # Assert
        assert result == "cloud_success"

    def test_only_edition_cloud_rejects_other_editions(self):
        """Test cloud edition decorator rejects non-CLOUD editions"""
        # Arrange
        app = Flask(__name__)

        @only_edition_cloud
        def cloud_view():
            return "cloud_success"

        # Act & Assert
        with app.test_request_context():
            with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
                with pytest.raises(HTTPException) as exc_info:
                    cloud_view()
                assert exc_info.value.code == 404

    def test_only_edition_enterprise_allows_when_enabled(self):
        """Test enterprise edition decorator allows when ENTERPRISE_ENABLED is True"""

        # Arrange
        @only_edition_enterprise
        def enterprise_view():
            return "enterprise_success"

        # Act
        with patch("controllers.console.wraps.dify_config.ENTERPRISE_ENABLED", True):
            result = enterprise_view()

        # Assert
        assert result == "enterprise_success"

    def test_only_edition_self_hosted_allows_self_hosted(self):
        """Test self-hosted edition decorator allows SELF_HOSTED edition"""

        # Arrange
        @only_edition_self_hosted
        def self_hosted_view():
            return "self_hosted_success"

        # Act
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            result = self_hosted_view()

        # Assert
        assert result == "self_hosted_success"


class TestBillingEnabled:
    """Test billing enabled decorator."""

    def test_should_allow_when_billing_config_enabled(self):
        """Test billing decorator uses local config without loading tenant features."""

        @cloud_edition_billing_enabled
        def billing_view():
            return "billing_success"

        with patch("controllers.console.wraps.dify_config.BILLING_ENABLED", True):
            with patch("controllers.console.wraps.FeatureService.get_features") as get_features:
                result = billing_view()

        assert result == "billing_success"
        get_features.assert_not_called()

    def test_should_reject_when_billing_config_disabled(self):
        """Test billing decorator rejects when local billing config is disabled."""
        app = create_app_with_login()

        @cloud_edition_billing_enabled
        def billing_view():
            return "billing_success"

        with app.test_request_context():
            with patch("controllers.console.wraps.dify_config.BILLING_ENABLED", False):
                with patch("controllers.console.wraps.FeatureService.get_features") as get_features:
                    with pytest.raises(HTTPException) as exc_info:
                        billing_view()

        assert exc_info.value.code == 403
        assert "Billing feature is not enabled" in str(exc_info.value.description)
        get_features.assert_not_called()


class TestBillingPaidPlanRequired:
    @pytest.mark.parametrize("plan", ["professional", "team"])
    def test_should_allow_paid_plan(self, plan: str):
        @cloud_edition_billing_paid_plan_required
        def paid_view():
            return "paid_success"

        billing_info = {"enabled": True, "subscription": {"plan": plan}}
        with (
            patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ),
            patch("controllers.console.wraps.BillingService.get_info", return_value=billing_info) as get_info,
        ):
            result = paid_view()

        assert result == "paid_success"
        get_info.assert_called_once_with("tenant123", exclude_vector_space=True)

    @pytest.mark.parametrize(
        ("enabled", "plan"),
        [(False, "professional"), (True, "sandbox"), (True, "unknown")],
    )
    def test_should_reject_non_paid_plan(self, enabled: bool, plan: str):
        app = create_app_with_login()

        @cloud_edition_billing_paid_plan_required
        def paid_view():
            return "paid_success"

        billing_info = {"enabled": enabled, "subscription": {"plan": plan}}
        with app.test_request_context():
            with (
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(MockUser("test_user"), "tenant123"),
                ),
                patch("controllers.console.wraps.BillingService.get_info", return_value=billing_info),
                pytest.raises(HTTPException) as exc_info,
            ):
                paid_view()

        assert exc_info.value.code == 403
        assert "requires a paid plan" in str(exc_info.value.description)


class TestBillingResourceLimits:
    """Test billing resource limit decorators"""

    def test_should_allow_when_under_resource_limit(self):
        """Test that requests are allowed when under resource limits"""
        # Arrange
        mock_features = MagicMock()
        mock_features.billing.enabled = True
        mock_features.members.limit = 10
        mock_features.members.size = 5

        @cloud_edition_billing_resource_check("members")
        def add_member():
            return "member_added"

        # Act
        with patch(
            "controllers.console.wraps.current_account_with_tenant", return_value=(MockUser("test_user"), "tenant123")
        ):
            with patch(
                "controllers.console.wraps.FeatureService.get_features", return_value=mock_features
            ) as get_features:
                result = add_member()

        # Assert
        assert result == "member_added"
        get_features.assert_called_once_with("tenant123", exclude_vector_space=True)

    def test_should_load_vector_space_from_dedicated_quota_api(self):
        """Test vector-space limit checks avoid loading the full feature payload."""
        # Arrange
        mock_vector_space = MagicMock()
        mock_vector_space.limit = 10
        mock_vector_space.size = 5

        @cloud_edition_billing_resource_check("vector_space")
        def add_segment():
            return "segment_added"

        # Act
        with patch(
            "controllers.console.wraps.current_account_with_tenant", return_value=(MockUser("test_user"), "tenant123")
        ):
            with (
                patch("controllers.console.wraps.dify_config.BILLING_ENABLED", True),
                patch(
                    "controllers.console.wraps.FeatureService.get_vector_space", return_value=mock_vector_space
                ) as get_vector_space,
                patch("controllers.console.wraps.FeatureService.get_features") as get_features,
            ):
                result = add_segment()

        # Assert
        assert result == "segment_added"
        get_vector_space.assert_called_once_with("tenant123")
        get_features.assert_not_called()

    def test_should_reject_when_over_resource_limit(self):
        """Test that requests are rejected when over resource limits"""
        # Arrange
        app = create_app_with_login()
        mock_features = MagicMock()
        mock_features.billing.enabled = True
        mock_features.members.limit = 10
        mock_features.members.size = 10

        @cloud_edition_billing_resource_check("members")
        def add_member():
            return "member_added"

        # Act & Assert
        with app.test_request_context():
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features):
                    with pytest.raises(HTTPException) as exc_info:
                        add_member()
                    assert exc_info.value.code == 403
                    assert "members has reached the limit" in str(exc_info.value.description)

    def test_should_check_source_for_documents_limit(self):
        """Test document limit checks request source"""
        # Arrange
        app = create_app_with_login()
        mock_features = MagicMock()
        mock_features.billing.enabled = True
        mock_features.documents_upload_quota.limit = 100
        mock_features.documents_upload_quota.size = 100

        @cloud_edition_billing_resource_check("documents")
        def upload_document():
            return "document_uploaded"

        # Test 1: Should reject when source is datasets
        with app.test_request_context("/?source=datasets"):
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features):
                    with pytest.raises(HTTPException) as exc_info:
                        upload_document()
                    assert exc_info.value.code == 403

        # Test 2: Should allow when source is not datasets
        with app.test_request_context("/?source=other"):
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features):
                    result = upload_document()
                    assert result == "document_uploaded"


class TestRateLimiting:
    """Test rate limiting decorator"""

    @patch("controllers.console.wraps.redis_client")
    def test_should_allow_requests_within_rate_limit(self, mock_redis: MagicMock):
        """Test that requests within rate limit are allowed"""
        # Arrange
        mock_rate_limit = MagicMock()
        mock_rate_limit.enabled = True
        mock_rate_limit.limit = 10
        mock_redis.zcard.return_value = 5  # 5 requests in window

        @cloud_edition_billing_rate_limit_check("knowledge")
        def knowledge_request():
            return "knowledge_success"

        # Act
        with patch(
            "controllers.console.wraps.current_account_with_tenant", return_value=(MockUser("test_user"), "tenant123")
        ):
            with patch(
                "controllers.console.wraps.FeatureService.get_knowledge_rate_limit", return_value=mock_rate_limit
            ):
                result = knowledge_request()

        # Assert
        assert result == "knowledge_success"
        mock_redis.zadd.assert_called_once()
        mock_redis.zremrangebyscore.assert_called_once()

    @patch("controllers.console.wraps.redis_client")
    @pytest.mark.parametrize("sqlite_session", [(RateLimitLog,)], indirect=True)
    def test_should_reject_requests_over_rate_limit(
        self,
        mock_redis: MagicMock,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Test that requests over rate limit are rejected and logged"""
        # Arrange
        app = create_app_with_login()
        mock_rate_limit = MagicMock()
        mock_rate_limit.enabled = True
        mock_rate_limit.limit = 10
        mock_rate_limit.subscription_plan = "pro"
        mock_redis.zcard.return_value = 11  # Over limit

        monkeypatch.setattr("controllers.console.wraps.db", SimpleNamespace(session=sqlite_session))

        @cloud_edition_billing_rate_limit_check("knowledge")
        def knowledge_request():
            return "knowledge_success"

        # Act & Assert
        with app.test_request_context():
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch(
                    "controllers.console.wraps.FeatureService.get_knowledge_rate_limit", return_value=mock_rate_limit
                ):
                    with pytest.raises(HTTPException) as exc_info:
                        knowledge_request()

                    # Verify error
                    assert exc_info.value.code == 403
                    assert "rate limit" in str(exc_info.value.description)

                    rate_limit_log = sqlite_session.scalar(select(RateLimitLog))
                    assert rate_limit_log is not None
                    assert rate_limit_log.tenant_id == "tenant123"
                    assert rate_limit_log.subscription_plan == "pro"
                    assert rate_limit_log.operation == "knowledge"


class TestCloudUtmRecord:
    """Test cloud UTM recording decorator."""

    def test_should_record_utm_when_billing_config_enabled_and_cookie_exists(self):
        """Test UTM recording uses billing config without loading tenant features."""
        app = create_app_with_login()

        @cloud_utm_record
        def view():
            return "success"

        with app.test_request_context("/", headers={"Cookie": "utm_info={}"}):
            with (
                patch("controllers.console.wraps.dify_config.BILLING_ENABLED", True),
                patch("controllers.console.wraps.current_account_with_tenant", return_value=(MockUser("u1"), "t1")),
                patch("controllers.console.wraps.OperationService.record_utm") as record_utm,
                patch("controllers.console.wraps.FeatureService.get_features") as get_features,
            ):
                result = view()

        assert result == "success"
        record_utm.assert_called_once_with("t1", {})
        get_features.assert_not_called()

    def test_should_skip_utm_when_billing_config_disabled(self):
        """Test UTM recording skips tenant feature loading when billing config is disabled."""
        app = create_app_with_login()

        @cloud_utm_record
        def view():
            return "success"

        with app.test_request_context("/", headers={"Cookie": "utm_info={}"}):
            with (
                patch("controllers.console.wraps.dify_config.BILLING_ENABLED", False),
                patch("controllers.console.wraps.current_account_with_tenant") as current_account,
                patch("controllers.console.wraps.OperationService.record_utm") as record_utm,
                patch("controllers.console.wraps.FeatureService.get_features") as get_features,
            ):
                result = view()

        assert result == "success"
        current_account.assert_not_called()
        record_utm.assert_not_called()
        get_features.assert_not_called()


class TestSystemSetup:
    """Test system setup decorator"""

    @patch("controllers.console.wraps.db")
    def test_should_allow_when_setup_complete(self, mock_db: MagicMock):
        """Test that requests are allowed when setup is complete"""
        # Arrange

        @setup_required
        def admin_view():
            return "admin_success"

        # Act
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            result = admin_view()

        # Assert
        assert result == "admin_success"

    @patch("controllers.console.wraps.db")
    def test_should_cache_completed_setup(self, mock_db):
        """Test that completed setup skips repeated DB reads in this process"""
        mock_db.session.scalar.return_value = MagicMock()

        @setup_required
        def admin_view():
            return "admin_success"

        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            assert admin_view() == "admin_success"
            assert admin_view() == "admin_success"

        assert mock_db.session.scalar.call_count == 1

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.wraps.os.environ.get")
    def test_should_not_cache_missing_setup(self, mock_environ_get, mock_db):
        """Test that first-time bootstrap completion can be observed later in the same process"""
        mock_db.session.scalar.side_effect = [None, MagicMock()]
        mock_environ_get.return_value = None

        @setup_required
        def admin_view():
            return "admin_success"

        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            with pytest.raises(NotSetupError):
                admin_view()
            assert admin_view() == "admin_success"

        assert mock_db.session.scalar.call_count == 2

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.wraps.os.environ.get")
    def test_should_raise_not_init_validate_error_with_init_password(self, mock_environ_get, mock_db: MagicMock):
        """Test NotInitValidateError when INIT_PASSWORD is set but setup not complete"""
        # Arrange
        mock_db.session.scalar.return_value = None  # No setup
        mock_environ_get.return_value = "some_password"

        @setup_required
        def admin_view():
            return "admin_success"

        # Act & Assert
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            with pytest.raises(NotInitValidateError):
                admin_view()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.wraps.os.environ.get")
    def test_should_raise_not_setup_error_without_init_password(self, mock_environ_get, mock_db: MagicMock):
        """Test NotSetupError when no INIT_PASSWORD and setup not complete"""
        # Arrange
        mock_db.session.scalar.return_value = None  # No setup
        mock_environ_get.return_value = None  # No INIT_PASSWORD

        @setup_required
        def admin_view():
            return "admin_success"

        # Act & Assert
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            with pytest.raises(NotSetupError):
                admin_view()


class TestEnterpriseLicense:
    """Test enterprise license decorator"""

    def test_should_allow_with_valid_license(self):
        """Test that valid licenses allow access"""
        # Arrange
        mock_settings = MagicMock()
        mock_settings.license.status = LicenseStatus.ACTIVE

        @enterprise_license_required
        def enterprise_feature():
            return "enterprise_success"

        # Act
        with patch("controllers.console.wraps.FeatureService.get_system_features", return_value=mock_settings):
            result = enterprise_feature()

        # Assert
        assert result == "enterprise_success"

    @pytest.mark.parametrize("invalid_status", [LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST])
    def test_should_reject_with_invalid_license(self, invalid_status):
        """Test that invalid licenses raise UnauthorizedAndForceLogout"""
        # Arrange
        mock_settings = MagicMock()
        mock_settings.license.status = invalid_status

        @enterprise_license_required
        def enterprise_feature():
            return "enterprise_success"

        # Act & Assert
        with patch("controllers.console.wraps.FeatureService.get_system_features", return_value=mock_settings):
            with pytest.raises(UnauthorizedAndForceLogout) as exc_info:
                enterprise_feature()
            assert "license is invalid" in str(exc_info.value)
