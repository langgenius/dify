"""
Unit tests for Service API wraps (authentication decorators)
"""

import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
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
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.dataset import Dataset, RateLimitLog
from models.enums import ApiTokenType
from models.model import ApiToken, App, AppMode, IconType


def _configure_current_app_mock(mock_current_app):
    mock_current_app.login_manager = Mock()
    mock_current_app._get_current_object = Mock(return_value=Mock())


def _api_token(*, tenant_id: str, app_id: str | None = None, token_type: ApiTokenType) -> ApiToken:
    return ApiToken(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        type=token_type,
        token="test_token",
    )


def _persist_workspace(session: Session) -> tuple[Tenant, Account, TenantAccountJoin]:
    tenant = Tenant(name="Workspace")
    account = Account(name="Owner", email=f"owner-{uuid.uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    session.add_all([tenant, account, membership])
    session.commit()
    return tenant, account, membership


def _app_model(*, tenant_id: str, enable_api: bool = True) -> App:
    return App(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Service API App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=enable_api,
    )


class TestValidateAndGetApiToken:
    """Test suite for validate_and_get_api_token function"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    def test_missing_authorization_header(self, app: Flask):
        """Test that Unauthorized is raised when Authorization header is missing."""
        # Arrange
        with app.test_request_context("/", method="GET"):
            # No Authorization header

            # Act & Assert
            with pytest.raises(Unauthorized) as exc_info:
                validate_and_get_api_token("app")
            assert "Authorization header must be provided" in str(exc_info.value)

    def test_invalid_auth_scheme(self, app: Flask):
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
    def test_valid_token_returns_api_token(self, mock_fetch_token, mock_cache_cls, mock_record_usage, app: Flask):
        """Test that valid token returns the ApiToken object."""
        # Arrange
        api_token = _api_token(
            tenant_id=str(uuid.uuid4()),
            app_id=str(uuid.uuid4()),
            token_type=ApiTokenType.APP,
        )
        api_token.token = "valid_token_123"

        mock_cache_instance = Mock()
        mock_cache_instance.get.return_value = None  # Cache miss
        mock_cache_cls.get = mock_cache_instance.get
        mock_fetch_token.return_value = api_token

        # Act
        with app.test_request_context("/", method="GET", headers={"Authorization": "Bearer valid_token_123"}):
            result = validate_and_get_api_token("app")

        # Assert
        assert result == api_token

    @patch("controllers.service_api.wraps.record_token_usage")
    @patch("controllers.service_api.wraps.ApiTokenCache")
    @patch("controllers.service_api.wraps.fetch_token_with_single_flight")
    def test_invalid_token_raises_unauthorized(self, mock_fetch_token, mock_cache_cls, mock_record_usage, app: Flask):
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
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.current_app")
    @pytest.mark.parametrize(
        "sqlite_session",
        [(App, ApiToken, Tenant, Account, TenantAccountJoin)],
        indirect=True,
    )
    def test_valid_app_token_allows_access(
        self,
        mock_current_app,
        mock_validate_token,
        mock_user_logged_in,
        app: Flask,
        sqlite_session: Session,
    ):
        """Test that valid app token allows access to decorated view."""
        # Arrange
        _configure_current_app_mock(mock_current_app)

        tenant, account, _ = _persist_workspace(sqlite_session)
        app_model = _app_model(tenant_id=tenant.id)
        api_token = _api_token(tenant_id=tenant.id, app_id=app_model.id, token_type=ApiTokenType.APP)
        sqlite_session.add_all([app_model, api_token])
        sqlite_session.commit()
        mock_validate_token.return_value = api_token
        session_registry = Mock(wraps=sqlite_session, return_value=sqlite_session)

        @validate_app_token
        def protected_view(app_model):
            return {"success": True, "app_id": app_model.id}

        # Act
        with (
            app.test_request_context("/", method="GET", headers={"Authorization": "Bearer test_token"}),
            patch("controllers.service_api.wraps.db.session", session_registry),
            patch("models.account.db", SimpleNamespace(engine=sqlite_session.get_bind())),
        ):
            result = protected_view()

        # Assert
        assert result["success"] is True
        assert result["app_id"] == app_model.id
        assert account.current_tenant_id == tenant.id

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_app_not_found_raises_forbidden(self, mock_validate_token, app: Flask, sqlite_session: Session):
        """Test that Forbidden is raised when app no longer exists."""
        # Arrange
        api_token = _api_token(
            tenant_id=str(uuid.uuid4()),
            app_id=str(uuid.uuid4()),
            token_type=ApiTokenType.APP,
        )
        mock_validate_token.return_value = api_token

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with (
            app.test_request_context("/", method="GET"),
            patch("controllers.service_api.wraps.db.session", sqlite_session),
        ):
            with pytest.raises(Forbidden) as exc_info:
                protected_view()
            assert "no longer exists" in str(exc_info.value)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_app_status_abnormal_raises_forbidden(self, mock_validate_token, app: Flask, sqlite_session: Session):
        """Test that Forbidden is raised when app status is abnormal."""
        # Arrange
        app_model = _app_model(tenant_id=str(uuid.uuid4()))
        sqlite_session.add(app_model)
        sqlite_session.commit()
        app_model.status = "abnormal"
        mock_validate_token.return_value = _api_token(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            token_type=ApiTokenType.APP,
        )

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with (
            app.test_request_context("/", method="GET"),
            patch("controllers.service_api.wraps.db.session", sqlite_session),
        ):
            with pytest.raises(Forbidden) as exc_info:
                protected_view()
            assert "status is abnormal" in str(exc_info.value)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_app_api_disabled_raises_forbidden(self, mock_validate_token, app: Flask, sqlite_session: Session):
        """Test that Forbidden is raised when app API is disabled."""
        # Arrange
        app_model = _app_model(tenant_id=str(uuid.uuid4()), enable_api=False)
        sqlite_session.add(app_model)
        sqlite_session.commit()
        mock_validate_token.return_value = _api_token(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            token_type=ApiTokenType.APP,
        )

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with (
            app.test_request_context("/", method="GET"),
            patch("controllers.service_api.wraps.db.session", sqlite_session),
        ):
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
    def test_allows_when_under_limit(self, mock_get_features, mock_validate_token, app: Flask):
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
        mock_get_features.assert_called_once_with("tenant123", exclude_vector_space=True)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    @patch("controllers.service_api.wraps.FeatureService.get_vector_space")
    def test_loads_vector_space_from_dedicated_quota_api(
        self, mock_get_vector_space, mock_get_features, mock_validate_token, app: Flask
    ):
        """Test vector-space resource checks avoid loading the full feature payload."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_vector_space = Mock()
        mock_vector_space.limit = 10
        mock_vector_space.size = 5
        mock_get_vector_space.return_value = mock_vector_space

        @cloud_edition_billing_resource_check("vector_space", "dataset")
        def add_segment():
            return "segment_added"

        # Act
        with (
            app.test_request_context("/", method="GET"),
            patch("controllers.service_api.wraps.dify_config.BILLING_ENABLED", True),
        ):
            result = add_segment()

        # Assert
        assert result == "segment_added"
        mock_get_vector_space.assert_called_once_with("tenant123")
        mock_get_features.assert_not_called()

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    def test_loads_features_when_checking_non_vector_space_limit(
        self, mock_get_features, mock_validate_token, app: Flask
    ):
        """Test non-vector-space resource checks keep using the light feature payload."""
        # Arrange
        mock_validate_token.return_value = Mock(tenant_id="tenant123")

        mock_features = Mock()
        mock_features.billing.enabled = True
        mock_features.documents_upload_quota.limit = 10
        mock_features.documents_upload_quota.size = 5
        mock_get_features.return_value = mock_features

        @cloud_edition_billing_resource_check("documents", "dataset")
        def upload_document():
            return "document_uploaded"

        # Act
        with app.test_request_context("/", method="GET"):
            result = upload_document()

        # Assert
        assert result == "document_uploaded"
        mock_get_features.assert_called_once_with("tenant123", exclude_vector_space=True)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.FeatureService.get_features")
    def test_rejects_when_at_limit(self, mock_get_features, mock_validate_token, app: Flask):
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
    def test_allows_when_billing_disabled(self, mock_get_features, mock_validate_token, app: Flask):
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
    def test_rejects_add_segment_in_sandbox(self, mock_get_features, mock_validate_token, app: Flask):
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
    def test_allows_other_operations_in_sandbox(self, mock_get_features, mock_validate_token, app: Flask):
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
    def test_allows_within_rate_limit(self, mock_get_rate_limit, mock_validate_token, app: Flask):
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
    @pytest.mark.parametrize("sqlite_session", [(RateLimitLog,)], indirect=True)
    def test_rejects_over_rate_limit(
        self,
        mock_get_rate_limit,
        mock_validate_token,
        app: Flask,
        sqlite_session: Session,
    ):
        """Test that Forbidden is raised when over rate limit."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        mock_validate_token.return_value = _api_token(
            tenant_id=tenant_id,
            token_type=ApiTokenType.DATASET,
        )

        mock_rate_limit = Mock()
        mock_rate_limit.enabled = True
        mock_rate_limit.limit = 10
        mock_rate_limit.subscription_plan = "pro"
        mock_get_rate_limit.return_value = mock_rate_limit

        with (
            patch("controllers.service_api.wraps.redis_client") as mock_redis,
            patch(
                "controllers.service_api.wraps.db",
                SimpleNamespace(engine=sqlite_session.get_bind()),
            ),
        ):
            mock_redis.zcard.return_value = 15  # Over limit

            @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
            def knowledge_request():
                return "success"

            # Act & Assert
            with app.test_request_context("/", method="GET"):
                with pytest.raises(Forbidden) as exc_info:
                    knowledge_request()
                assert "rate limit" in str(exc_info.value)

        persisted_logs = sqlite_session.scalars(select(RateLimitLog)).all()
        assert len(persisted_logs) == 1
        assert persisted_logs[0].tenant_id == tenant_id
        assert persisted_logs[0].subscription_plan == "pro"
        assert persisted_logs[0].operation == "knowledge"


class TestValidateDatasetToken:
    """Test suite for validate_dataset_token decorator"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.current_app")
    @pytest.mark.parametrize(
        "sqlite_session",
        [(Tenant, Account, TenantAccountJoin)],
        indirect=True,
    )
    def test_valid_dataset_token(
        self,
        mock_current_app,
        mock_validate_token,
        mock_user_logged_in,
        app: Flask,
        sqlite_session: Session,
    ):
        """Test that valid dataset token allows access."""
        # Arrange
        _configure_current_app_mock(mock_current_app)

        tenant, account, _ = _persist_workspace(sqlite_session)
        api_token = _api_token(tenant_id=tenant.id, token_type=ApiTokenType.DATASET)
        mock_validate_token.return_value = api_token
        session_registry = Mock(wraps=sqlite_session, return_value=sqlite_session)

        @validate_dataset_token
        def protected_view(tenant_id):
            return {"success": True, "tenant_id": tenant_id}

        # Act
        with (
            app.test_request_context("/", method="GET", headers={"Authorization": "Bearer test_token"}),
            patch("controllers.service_api.wraps.db.session", session_registry),
            patch("models.account.db", SimpleNamespace(engine=sqlite_session.get_bind())),
        ):
            result = protected_view()

        # Assert
        assert result["success"] is True
        assert result["tenant_id"] == tenant.id
        assert account.current_tenant_id == tenant.id

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @pytest.mark.parametrize("sqlite_session", [(Dataset,)], indirect=True)
    def test_dataset_not_found_raises_not_found(self, mock_validate_token, app: Flask, sqlite_session: Session):
        """Test that NotFound is raised when dataset doesn't exist."""
        # Arrange
        api_token = _api_token(tenant_id=str(uuid.uuid4()), token_type=ApiTokenType.DATASET)
        mock_validate_token.return_value = api_token

        @validate_dataset_token
        def protected_view(dataset_id=None, **kwargs):
            return {"success": True}

        # Act & Assert
        with (
            app.test_request_context("/", method="GET"),
            patch("controllers.service_api.wraps.db.session", sqlite_session),
        ):
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
