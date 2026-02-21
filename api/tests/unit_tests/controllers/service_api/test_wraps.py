"""
Unit tests for Service API wraps (authentication decorators)
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.service_api.wraps import (
    DatasetApiResource,
    FetchUserArg,
    WhereisUserArg,
    cloud_edition_billing_knowledge_limit_check,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    validate_and_get_api_token,
    validate_app_token,
    validate_dataset_token,
)
from enums.cloud_plan import CloudPlan
from models.account import TenantStatus
from models.model import ApiToken
from tests.unit_tests.conftest import (
    setup_mock_dataset_tenant_query,
    setup_mock_tenant_account_query,
)


class TestValidateAndGetApiToken:
    """Test suite for validate_and_get_api_token function"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    def test_missing_authorization_header(self, app):
        """Test that Unauthorized is raised when Authorization header is missing."""
        # Arrange
        with app.test_request_context("/", method="GET"):
            # No Authorization header

            # Act & Assert
            with pytest.raises(Unauthorized) as exc_info:
                validate_and_get_api_token("app")
            assert "Authorization header must be provided" in str(exc_info.value)

    def test_invalid_auth_scheme(self, app):
        """Test that Unauthorized is raised when auth scheme is not Bearer."""
        # Arrange
        with app.test_request_context("/", method="GET", headers={"Authorization": "Basic token123"}):
            # Act & Assert
            with pytest.raises(Unauthorized) as exc_info:
                validate_and_get_api_token("app")
            assert "Authorization scheme must be 'Bearer'" in str(exc_info.value)

    @patch("controllers.service_api.wraps.record_token_usage")
    @patch("controllers.service_api.wraps.ApiTokenCache")
    @patch("controllers.service_api.wraps.fetch_token_with_single_flight")
    def test_valid_token_returns_api_token(self, mock_fetch_token, mock_cache_cls, mock_record_usage, app):
        """Test that valid token returns the ApiToken object."""
        # Arrange
        mock_api_token = Mock(spec=ApiToken)
        mock_api_token.token = "valid_token_123"
        mock_api_token.type = "app"

        mock_cache_instance = Mock()
        mock_cache_instance.get.return_value = None  # Cache miss
        mock_cache_cls.get = mock_cache_instance.get
        mock_fetch_token.return_value = mock_api_token

        # Act
        with app.test_request_context("/", method="GET", headers={"Authorization": "Bearer valid_token_123"}):
            result = validate_and_get_api_token("app")

        # Assert
        assert result == mock_api_token

    @patch("controllers.service_api.wraps.record_token_usage")
    @patch("controllers.service_api.wraps.ApiTokenCache")
    @patch("controllers.service_api.wraps.fetch_token_with_single_flight")
    def test_invalid_token_raises_unauthorized(self, mock_fetch_token, mock_cache_cls, mock_record_usage, app):
        """Test that invalid token raises Unauthorized."""
        # Arrange
        from werkzeug.exceptions import Unauthorized

        mock_cache_instance = Mock()
        mock_cache_instance.get.return_value = None  # Cache miss
        mock_cache_cls.get = mock_cache_instance.get
        mock_fetch_token.side_effect = Unauthorized("Access token is invalid")

        # Act & Assert
        with app.test_request_context("/", method="GET", headers={"Authorization": "Bearer invalid_token"}):
            with pytest.raises(Unauthorized) as exc_info:
                validate_and_get_api_token("app")
            assert "Access token is invalid" in str(exc_info.value)


class TestValidateAppToken:
    """Test suite for validate_app_token decorator"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.db")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.current_app")
    def test_valid_app_token_allows_access(
        self, mock_current_app, mock_validate_token, mock_db, mock_user_logged_in, app
    ):
        """Test that valid app token allows access to decorated view."""
        # Arrange
        # Use standard Mock for login_manager to avoid AsyncMockMixin warnings
        mock_current_app.login_manager = Mock()

        mock_api_token = Mock()
        mock_api_token.app_id = str(uuid.uuid4())
        mock_api_token.tenant_id = str(uuid.uuid4())
        mock_validate_token.return_value = mock_api_token

        mock_app = Mock()
        mock_app.id = mock_api_token.app_id
        mock_app.status = "normal"
        mock_app.enable_api = True
        mock_app.tenant_id = mock_api_token.tenant_id

        mock_tenant = Mock()
        mock_tenant.status = TenantStatus.NORMAL
        mock_tenant.id = mock_api_token.tenant_id

        mock_account = Mock()
        mock_account.id = str(uuid.uuid4())

        mock_ta = Mock()
        mock_ta.account_id = mock_account.id

        # Use side_effect to return app first, then tenant
        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app,
            mock_tenant,
            mock_account,
        ]

        # Mock the tenant owner query
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_ta)

        @validate_app_token
        def protected_view(app_model):
            return {"success": True, "app_id": app_model.id}

        # Act
        with app.test_request_context("/", method="GET", headers={"Authorization": "Bearer test_token"}):
            result = protected_view()

        # Assert
        assert result["success"] is True
        assert result["app_id"] == mock_app.id

    @patch("controllers.service_api.wraps.db")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_app_not_found_raises_forbidden(self, mock_validate_token, mock_db, app):
        """Test that Forbidden is raised when app no longer exists."""
        # Arrange
        mock_api_token = Mock()
        mock_api_token.app_id = str(uuid.uuid4())
        mock_validate_token.return_value = mock_api_token

        mock_db.session.query.return_value.where.return_value.first.return_value = None

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with app.test_request_context("/", method="GET"):
            with pytest.raises(Forbidden) as exc_info:
                protected_view()
            assert "no longer exists" in str(exc_info.value)

    @patch("controllers.service_api.wraps.db")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_app_status_abnormal_raises_forbidden(self, mock_validate_token, mock_db, app):
        """Test that Forbidden is raised when app status is abnormal."""
        # Arrange
        mock_api_token = Mock()
        mock_api_token.app_id = str(uuid.uuid4())
        mock_validate_token.return_value = mock_api_token

        mock_app = Mock()
        mock_app.status = "abnormal"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_app

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with app.test_request_context("/", method="GET"):
            with pytest.raises(Forbidden) as exc_info:
                protected_view()
            assert "status is abnormal" in str(exc_info.value)

    @patch("controllers.service_api.wraps.db")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_app_api_disabled_raises_forbidden(self, mock_validate_token, mock_db, app):
        """Test that Forbidden is raised when app API is disabled."""
        # Arrange
        mock_api_token = Mock()
        mock_api_token.app_id = str(uuid.uuid4())
        mock_validate_token.return_value = mock_api_token

        mock_app = Mock()
        mock_app.status = "normal"
        mock_app.enable_api = False
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_app

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with app.test_request_context("/", method="GET"):
            with pytest.raises(Forbidden) as exc_info:
                protected_view()
            assert "API service has been disabled" in str(exc_info.value)


class TestCloudEditionBillingResourceCheck:
    """Test suite for cloud_edition_billing_resource_check decorator"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    def test_allows_when_under_limit(self, mock_get_features, mock_validate_token, app):
        """Test that request is allowed when under resource limit."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_features = Mock()
        mock_features.billing.enabled = True
        mock_features.members.limit = 10
        mock_features.members.size = 5
        mock_get_features.return_value = mock_features

        @cloud_edition_billing_resource_check("members", "app")
        def add_member():
            return "member_added"

        # Act
        with app.test_request_context("/", method="GET"):
            result = add_member()

        # Assert
        assert result == "member_added"

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    def test_rejects_when_at_limit(self, mock_get_features, mock_validate_token, app):
        """Test that Forbidden is raised when at resource limit."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_features = Mock()
        mock_features.billing.enabled = True
        mock_features.members.limit = 10
        mock_features.members.size = 10
        mock_get_features.return_value = mock_features

        @cloud_edition_billing_resource_check("members", "app")
        def add_member():
            return "member_added"

        # Act & Assert
        with app.test_request_context("/", method="GET"):
            with pytest.raises(Forbidden) as exc_info:
                add_member()
            assert "members has reached the limit" in str(exc_info.value)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    def test_allows_when_billing_disabled(self, mock_get_features, mock_validate_token, app):
        """Test that request is allowed when billing is disabled."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_features = Mock()
        mock_features.billing.enabled = False
        mock_get_features.return_value = mock_features

        @cloud_edition_billing_resource_check("members", "app")
        def add_member():
            return "member_added"

        # Act
        with app.test_request_context("/", method="GET"):
            result = add_member()

        # Assert
        assert result == "member_added"


class TestCloudEditionBillingKnowledgeLimitCheck:
    """Test suite for cloud_edition_billing_knowledge_limit_check decorator"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    def test_rejects_add_segment_in_sandbox(self, mock_get_features, mock_validate_token, app):
        """Test that add_segment is rejected in SANDBOX plan."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_features = Mock()
        mock_features.billing.enabled = True
        mock_features.billing.subscription.plan = CloudPlan.SANDBOX
        mock_get_features.return_value = mock_features

        @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
        def add_segment():
            return "segment_added"

        # Act & Assert
        with app.test_request_context("/", method="GET"):
            with pytest.raises(Forbidden) as exc_info:
                add_segment()
            assert "upgrade to a paid plan" in str(exc_info.value)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    def test_allows_other_operations_in_sandbox(self, mock_get_features, mock_validate_token, app):
        """Test that non-add_segment operations are allowed in SANDBOX."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_features = Mock()
        mock_features.billing.enabled = True
        mock_features.billing.subscription.plan = CloudPlan.SANDBOX
        mock_get_features.return_value = mock_features

        @cloud_edition_billing_knowledge_limit_check("search", "dataset")
        def search():
            return "search_results"

        # Act
        with app.test_request_context("/", method="GET"):
            result = search()

        # Assert
        assert result == "search_results"


class TestCloudEditionBillingRateLimitCheck:
    """Test suite for cloud_edition_billing_rate_limit_check decorator"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_knowledge_rate_limit")
    def test_allows_within_rate_limit(self, mock_get_rate_limit, mock_validate_token, app):
        """Test that request is allowed when within rate limit."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_rate_limit = Mock()
        mock_rate_limit.enabled = True
        mock_rate_limit.limit = 100
        mock_get_rate_limit.return_value = mock_rate_limit

        # Mock redis operations
        with patch("controllers.service_api.wraps.redis_client") as mock_redis:
            mock_redis.zcard.return_value = 50  # Under limit

            @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
            def knowledge_request():
                return "success"

            # Act
            with app.test_request_context("/", method="GET"):
                result = knowledge_request()

            # Assert
            assert result == "success"
            mock_redis.zadd.assert_called_once()
            mock_redis.zremrangebyscore.assert_called_once()

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_knowledge_rate_limit")
    @patch("controllers.service_api.wraps.db")
    def test_rejects_over_rate_limit(self, mock_db, mock_get_rate_limit, mock_validate_token, app):
        """Test that Forbidden is raised when over rate limit."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_rate_limit = Mock()
        mock_rate_limit.enabled = True
        mock_rate_limit.limit = 10
        mock_rate_limit.subscription_plan = "pro"
        mock_get_rate_limit.return_value = mock_rate_limit

        with patch("controllers.service_api.wraps.redis_client") as mock_redis:
            mock_redis.zcard.return_value = 15  # Over limit

            @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
            def knowledge_request():
                return "success"

            # Act & Assert
            with app.test_request_context("/", method="GET"):
                with pytest.raises(Forbidden) as exc_info:
                    knowledge_request()
                assert "rate limit" in str(exc_info.value)


class TestValidateDatasetToken:
    """Test suite for validate_dataset_token decorator"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.db")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.current_app")
    def test_valid_dataset_token(self, mock_current_app, mock_validate_token, mock_db, mock_user_logged_in, app):
        """Test that valid dataset token allows access."""
        # Arrange
        # Use standard Mock for login_manager
        mock_current_app.login_manager = Mock()

        tenant_id = str(uuid.uuid4())
        mock_api_token = Mock()
        mock_api_token.tenant_id = tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.id = tenant_id
        mock_tenant.status = TenantStatus.NORMAL

        mock_ta = Mock()
        mock_ta.account_id = str(uuid.uuid4())

        mock_account = Mock()
        mock_account.id = mock_ta.account_id
        mock_account.current_tenant = mock_tenant

        # Mock the tenant account join query
        setup_mock_dataset_tenant_query(mock_db, mock_tenant, mock_ta)

        # Mock the account query
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_account

        @validate_dataset_token
        def protected_view(tenant_id):
            return {"success": True, "tenant_id": tenant_id}

        # Act
        with app.test_request_context("/", method="GET", headers={"Authorization": "Bearer test_token"}):
            result = protected_view()

        # Assert
        assert result["success"] is True
        assert result["tenant_id"] == tenant_id

    @patch("controllers.service_api.wraps.db")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_dataset_not_found_raises_not_found(self, mock_validate_token, mock_db, app):
        """Test that NotFound is raised when dataset doesn't exist."""
        # Arrange
        mock_api_token = Mock()
        mock_api_token.tenant_id = str(uuid.uuid4())
        mock_validate_token.return_value = mock_api_token

        mock_db.session.query.return_value.where.return_value.first.return_value = None

        @validate_dataset_token
        def protected_view(dataset_id=None, **kwargs):
            return {"success": True}

        # Act & Assert
        with app.test_request_context("/", method="GET"):
            with pytest.raises(NotFound) as exc_info:
                protected_view(dataset_id=str(uuid.uuid4()))
            assert "Dataset not found" in str(exc_info.value)


class TestFetchUserArg:
    """Test suite for FetchUserArg model"""

    def test_fetch_user_arg_defaults(self):
        """Test FetchUserArg default values."""
        # Arrange & Act
        arg = FetchUserArg(fetch_from=WhereisUserArg.JSON)

        # Assert
        assert arg.fetch_from == WhereisUserArg.JSON
        assert arg.required is False

    def test_fetch_user_arg_required(self):
        """Test FetchUserArg with required=True."""
        # Arrange & Act
        arg = FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True)

        # Assert
        assert arg.fetch_from == WhereisUserArg.QUERY
        assert arg.required is True


class TestDatasetApiResource:
    """Test suite for DatasetApiResource base class"""

    def test_method_decorators_has_validate_dataset_token(self):
        """Test that DatasetApiResource has validate_dataset_token in method_decorators."""
        # Assert
        assert validate_dataset_token in DatasetApiResource.method_decorators

    def test_get_dataset_method_exists(self):
        """Test that get_dataset method exists on DatasetApiResource."""
        # Assert
        assert hasattr(DatasetApiResource, "get_dataset")
