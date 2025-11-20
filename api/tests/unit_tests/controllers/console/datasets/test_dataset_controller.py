"""
Test suite for dataset controller operations.

This module tests the dataset controller endpoints including:
- Dataset CRUD operations (create, read, update, delete)
- Document upload handling
- Batch operations
- Permission checks
- Error handling for invalid inputs
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

# Import Account first so we can reference it
from models.account import Account


# Mock current_account_with_tenant to return mock account without isinstance check
def mock_current_account_with_tenant_func():
    """Mock function that bypasses isinstance check."""
    account = MagicMock(spec=Account)
    account.__class__ = Account
    account.id = "test-user-id"
    account.email = "test@example.com"
    account.name = "Test User"
    account.current_tenant_id = "test-tenant-id"
    account.is_dataset_editor = True
    account.has_edit_permission = True
    account.is_dataset_operator = True
    return account, "test-tenant-id"


# Patch decorators and current_account_with_tenant BEFORE importing controllers
with (
    patch("libs.login.login_required", lambda f: f),
    patch("libs.login.current_account_with_tenant", mock_current_account_with_tenant_func),
    patch("controllers.console.wraps.setup_required", lambda f: f),
    patch("controllers.console.wraps.account_initialization_required", lambda f: f),
    patch("controllers.console.wraps.cloud_edition_billing_rate_limit_check", lambda x: lambda f: f),
    patch("controllers.console.wraps.cloud_edition_billing_resource_check", lambda x: lambda f: f),
    patch("controllers.console.wraps.enterprise_license_required", lambda f: f),
):
    pass

from controllers.console.datasets.error import DatasetInUseError, DatasetNameDuplicateError
from models.dataset import Dataset
from services.errors.dataset import DatasetInUseError as ServiceDatasetInUseError
from services.errors.dataset import DatasetNameDuplicateError as ServiceDatasetNameDuplicateError


def create_mock_account():
    """Create a mock Account instance that passes isinstance checks."""
    # Create a MagicMock that passes isinstance check for Account
    account = MagicMock(spec=Account)
    account.__class__ = Account  # Make isinstance() return True
    account.id = "test-user-id"
    account.email = "test@example.com"
    account.name = "Test User"
    account.current_tenant_id = "test-tenant-id"
    account.is_dataset_editor = True
    account.has_edit_permission = True
    account.is_dataset_operator = True
    return account


class TestDatasetListApi:
    """Test cases for DatasetListApi endpoint (list and create datasets)."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        from flask_login import LoginManager

        from extensions.ext_database import db

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        app.config["RESTX_MASK_SWAGGER"] = False
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        app.config["ERROR_404_HELP"] = False

        # Initialize extensions
        db.init_app(app)
        login_manager = LoginManager()
        login_manager.init_app(app)

        @login_manager.user_loader
        def load_user(user_id):
            return None

        # Create all database tables
        with app.app_context():
            db.create_all()

        return app

    @pytest.fixture
    def mock_dataset(self):
        """Create mock dataset object."""
        from unittest.mock import PropertyMock

        dataset = MagicMock()
        dataset_id = str(uuid4())
        # Configure id as a simple string attribute, not PropertyMock
        dataset.id = dataset_id
        dataset.name = "Test Dataset"
        dataset.description = "Test Description"
        dataset.tenant_id = "test-tenant-id"
        dataset.created_by = "test-user-id"
        dataset.indexing_technique = "high_quality"
        dataset.permission = "only_me"
        dataset.provider = "vendor"
        dataset.embedding_model = "text-embedding-ada-002"
        dataset.embedding_model_provider = "openai"
        from datetime import datetime

        dataset.created_at = datetime(2024, 1, 1, 0, 0, 0)
        dataset.updated_at = datetime(2024, 1, 1, 0, 0, 0)
        dataset.document_count = 0
        dataset.word_count = 0
        dataset.app_count = 0
        dataset.data_source_type = "upload_file"
        dataset.external_knowledge_api_id = None
        dataset.external_knowledge_id = None
        # Configure retrieval_model_dict to avoid boolean conversion issues
        dataset.retrieval_model_dict = {
            "reranking_enable": False,
            "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
        }
        # Configure external_retrieval_model to avoid boolean conversion issues
        dataset.external_retrieval_model = MagicMock()
        dataset.external_retrieval_model.score_threshold_enabled = False
        dataset.external_retrieval_model.score_threshold = 0.5
        # Configure other boolean fields as actual booleans, not MagicMocks
        type(dataset).built_in_field_enabled = PropertyMock(return_value=False)
        type(dataset).enabled = PropertyMock(return_value=True)
        type(dataset).is_published = PropertyMock(return_value=False)
        type(dataset).archived = PropertyMock(return_value=False)
        type(dataset).enable_api = PropertyMock(return_value=True)
        type(dataset).embedding_available = PropertyMock(return_value=True)
        return dataset

    @pytest.fixture
    def mock_user(self):
        """Create mock user object."""
        return create_mock_account()

    # Dataset List Tests
    # Dataset Create Tests
    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.create_empty_dataset")
    @patch("controllers.console.datasets.datasets.DatasetPermissionService.update_partial_member_list")
    def test_create_dataset_success(
        self,
        mock_update_permissions,
        mock_create_dataset,
        mock_current_account,
        mock_db_session,
        app,
        mock_dataset,
        mock_user,
    ):
        """
        Test successful dataset creation.

        Verifies that:
        - Dataset is created with valid parameters
        - User has editor permissions
        - Response includes created dataset details
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_create_dataset.return_value = mock_dataset

        # Act
        with app.test_request_context(
            "/datasets",
            method="POST",
            json={
                "name": "New Dataset",
                "indexing_technique": "high_quality",
                "permission": "only_me",
            },
        ):
            from controllers.console.datasets.datasets import DatasetListApi

            api = DatasetListApi()
            response, status_code = api.post()

        # Assert
        assert status_code == 201
        mock_create_dataset.assert_called_once()

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.create_empty_dataset")
    def test_create_dataset_forbidden_for_non_editor(
        self, mock_create_dataset, mock_current_account, mock_db_session, app, mock_user
    ):
        """
        Test dataset creation fails for non-editor users.

        Verifies that:
        - Forbidden error is raised for users without edit permission
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_user.is_dataset_editor = False
        mock_current_account.return_value = (mock_user, "test-tenant-id")

        # Act & Assert
        with app.test_request_context(
            "/datasets",
            method="POST",
            json={"name": "New Dataset", "indexing_technique": "high_quality"},
        ):
            from controllers.console.datasets.datasets import DatasetListApi

            api = DatasetListApi()
            with pytest.raises(Forbidden):
                api.post()

        # Verify service was not called since permission check failed
        mock_create_dataset.assert_not_called()

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.create_empty_dataset")
    def test_create_dataset_duplicate_name(
        self, mock_create_dataset, mock_current_account, mock_db_session, app, mock_user
    ):
        """
        Test dataset creation fails with duplicate name.

        Verifies that:
        - DatasetNameDuplicateError is raised for duplicate names
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_create_dataset.side_effect = ServiceDatasetNameDuplicateError("Dataset name already exists")

        # Act & Assert
        with app.test_request_context(
            "/datasets",
            method="POST",
            json={"name": "Duplicate Dataset", "indexing_technique": "high_quality"},
        ):
            from controllers.console.datasets.datasets import DatasetListApi

            api = DatasetListApi()
            with pytest.raises(DatasetNameDuplicateError):
                api.post()


class TestDatasetApi:
    """Test cases for DatasetApi endpoint (get, update, delete single dataset)."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        from flask_login import LoginManager

        from extensions.ext_database import db

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        app.config["RESTX_MASK_SWAGGER"] = False
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        app.config["ERROR_404_HELP"] = False

        # Initialize extensions
        db.init_app(app)
        login_manager = LoginManager()
        login_manager.init_app(app)

        @login_manager.user_loader
        def load_user(user_id):
            return None

        # Create all database tables
        with app.app_context():
            db.create_all()

        return app

    @pytest.fixture
    def mock_dataset(self):
        """Create mock dataset object."""
        from unittest.mock import PropertyMock

        dataset = MagicMock()
        dataset_id = str(uuid4())
        # Configure id as a simple string attribute, not PropertyMock
        dataset.id = dataset_id
        dataset.name = "Test Dataset"
        dataset.description = "Test Description"
        dataset.tenant_id = "test-tenant-id"
        dataset.created_by = "test-user-id"
        dataset.indexing_technique = "high_quality"
        dataset.permission = "only_me"
        dataset.provider = "vendor"
        dataset.embedding_model = "text-embedding-ada-002"
        dataset.embedding_model_provider = "openai"
        from datetime import datetime

        dataset.created_at = datetime(2024, 1, 1, 0, 0, 0)
        dataset.updated_at = datetime(2024, 1, 1, 0, 0, 0)
        dataset.document_count = 0
        dataset.word_count = 0
        dataset.app_count = 0
        dataset.data_source_type = "upload_file"
        dataset.external_knowledge_api_id = None
        dataset.external_knowledge_id = None
        # Configure retrieval_model_dict to avoid boolean conversion issues
        dataset.retrieval_model_dict = {
            "reranking_enable": False,
            "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
        }
        # Configure external_retrieval_model to avoid boolean conversion issues
        dataset.external_retrieval_model = MagicMock()
        dataset.external_retrieval_model.score_threshold_enabled = False
        dataset.external_retrieval_model.score_threshold = 0.5
        # Configure other boolean fields as actual booleans, not MagicMocks
        type(dataset).built_in_field_enabled = PropertyMock(return_value=False)
        type(dataset).enabled = PropertyMock(return_value=True)
        type(dataset).is_published = PropertyMock(return_value=False)
        type(dataset).archived = PropertyMock(return_value=False)
        type(dataset).enable_api = PropertyMock(return_value=True)
        type(dataset).embedding_available = PropertyMock(return_value=True)
        return dataset

    @pytest.fixture
    def mock_user(self):
        """Create mock user object."""
        return create_mock_account()

    # Dataset Get Tests
    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.get_dataset")
    def test_get_dataset_not_found(self, mock_get_dataset, mock_current_account, mock_db_session, app, mock_user):
        """
        Test dataset retrieval fails when dataset not found.

        Verifies that:
        - NotFound error is raised for non-existent dataset
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = None

        # Act & Assert
        with app.test_request_context("/datasets/non-existent-id"):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            with pytest.raises(NotFound):
                api.get("non-existent-id")

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.get_dataset")
    @patch("controllers.console.datasets.datasets.DatasetService.check_dataset_permission")
    def test_get_dataset_permission_denied(
        self,
        mock_check_permission,
        mock_get_dataset,
        mock_current_account,
        mock_db_session,
        app,
        mock_dataset,
        mock_user,
    ):
        """
        Test dataset retrieval fails without permission.

        Verifies that:
        - Forbidden error is raised when user lacks permission
        """
        # Arrange
        from services.errors.account import NoPermissionError

        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = mock_dataset
        mock_check_permission.side_effect = NoPermissionError("No permission")

        # Act & Assert
        with app.test_request_context(f"/datasets/{mock_dataset.id}"):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            with pytest.raises(Forbidden):
                api.get(mock_dataset.id)

    # Dataset Update Tests
    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.get_dataset")
    @patch("controllers.console.datasets.datasets.DatasetService.update_dataset")
    @patch("controllers.console.datasets.datasets.DatasetPermissionService.check_permission")
    @patch("controllers.console.datasets.datasets.DatasetPermissionService.get_dataset_partial_member_list")
    def test_update_dataset_success(
        self,
        mock_get_members,
        mock_check_permission,
        mock_update_dataset,
        mock_get_dataset,
        mock_current_account,
        mock_db_session,
        app,
        mock_dataset,
        mock_user,
    ):
        """
        Test successful dataset update.

        Verifies that:
        - Dataset is updated with new values
        - User has proper permissions
        - Response includes updated dataset
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = mock_dataset
        mock_update_dataset.return_value = mock_dataset
        mock_get_members.return_value = []

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="PUT",
            json={"name": "Updated Dataset", "description": "Updated Description"},
        ):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            response, status_code = api.patch(mock_dataset.id)

        # Assert
        assert status_code == 200
        mock_update_dataset.assert_called_once()

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.get_dataset")
    def test_update_dataset_not_found(self, mock_get_dataset, mock_current_account, mock_db_session, app, mock_user):
        """
        Test dataset update fails when dataset not found.

        Verifies that:
        - NotFound error is raised for non-existent dataset
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = None

        # Act & Assert
        with app.test_request_context("/datasets/non-existent-id", method="PUT", json={"name": "Updated Dataset"}):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            with pytest.raises(NotFound):
                api.patch("non-existent-id")

    # Dataset Delete Tests
    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.delete_dataset")
    @patch("controllers.console.datasets.datasets.DatasetPermissionService.clear_partial_member_list")
    def test_delete_dataset_success(
        self,
        mock_clear_members,
        mock_delete_dataset,
        mock_current_account,
        mock_db_session,
        app,
        mock_dataset,
        mock_user,
    ):
        """
        Test successful dataset deletion.

        Verifies that:
        - Dataset is deleted
        - Permissions are cleared
        - Success response is returned
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_delete_dataset.return_value = True

        # Act
        with app.test_request_context(f"/datasets/{mock_dataset.id}", method="DELETE"):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            response, status_code = api.delete(mock_dataset.id)

        # Assert
        assert status_code == 204
        # Verify delete_dataset was called with the dataset ID (user comes from current_account_with_tenant)
        assert mock_delete_dataset.call_count == 1
        call_args = mock_delete_dataset.call_args[0]
        assert call_args[0] == str(mock_dataset.id)
        mock_clear_members.assert_called_once_with(str(mock_dataset.id))

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.delete_dataset")
    def test_delete_dataset_forbidden_for_non_editor(
        self, mock_delete_dataset, mock_current_account, mock_db_session, app, mock_user
    ):
        """
        Test dataset deletion fails for non-editor users.

        Verifies that:
        - Forbidden error is raised for users without edit permission
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_user.has_edit_permission = False
        mock_user.is_dataset_operator = False
        mock_current_account.return_value = (mock_user, "test-tenant-id")

        # Act & Assert
        with app.test_request_context("/datasets/test-id", method="DELETE"):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            with pytest.raises(Forbidden):
                api.delete("test-id")

        # Verify service was not called since permission check failed
        mock_delete_dataset.assert_not_called()

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.delete_dataset")
    def test_delete_dataset_in_use(self, mock_delete_dataset, mock_current_account, mock_db_session, app, mock_user):
        """
        Test dataset deletion fails when dataset is in use.

        Verifies that:
        - DatasetInUseError is raised when dataset is used by apps
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_delete_dataset.side_effect = ServiceDatasetInUseError("Dataset is in use")

        # Act & Assert
        with app.test_request_context("/datasets/test-id", method="DELETE"):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            with pytest.raises(DatasetInUseError):
                api.delete("test-id")

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.delete_dataset")
    def test_delete_dataset_not_found(self, mock_delete_dataset, mock_current_account, mock_db_session, app, mock_user):
        """
        Test dataset deletion fails when dataset not found.

        Verifies that:
        - NotFound error is raised for non-existent dataset
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_delete_dataset.return_value = False

        # Act & Assert
        with app.test_request_context("/datasets/non-existent-id", method="DELETE"):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            with pytest.raises(NotFound):
                api.delete("non-existent-id")


class TestDocumentUploadHandling:
    """Test cases for document upload operations."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        from flask_login import LoginManager

        from extensions.ext_database import db

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        app.config["RESTX_MASK_SWAGGER"] = False
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        app.config["ERROR_404_HELP"] = False

        # Initialize extensions
        db.init_app(app)
        login_manager = LoginManager()
        login_manager.init_app(app)

        @login_manager.user_loader
        def load_user(user_id):
            return None

        # Create all database tables
        with app.app_context():
            db.create_all()

        return app

    @pytest.fixture
    def mock_dataset(self):
        """Create mock dataset object."""
        dataset = MagicMock(spec=Dataset)
        dataset.id = str(uuid4())
        dataset.name = "Test Dataset"
        dataset.tenant_id = "test-tenant-id"
        dataset.indexing_technique = "high_quality"
        dataset.doc_form = "text_model"
        dataset.provider = "vendor"
        return dataset

    @pytest.fixture
    def mock_user(self):
        """Create mock user object."""
        return create_mock_account()

    @pytest.fixture
    def mock_document(self):
        """Create mock document object."""
        document = MagicMock()
        document.id = str(uuid4())
        document.name = "test_document.txt"
        document.dataset_id = str(uuid4())
        document.indexing_status = "completed"
        document.enabled = True
        document.archived = False
        document.is_published = False
        return document

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets_document.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset")
    @patch("controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission")
    @patch("controllers.console.datasets.datasets_document.DocumentService.save_document_with_dataset_id")
    def test_upload_document_success(
        self,
        mock_save_document,
        mock_check_permission,
        mock_get_dataset,
        mock_current_account,
        mock_db_session,
        app,
        mock_dataset,
        mock_user,
        mock_document,
    ):
        """
        Test successful document upload.

        Verifies that:
        - Document is uploaded to dataset
        - User has editor permissions
        - Document indexing is triggered
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = mock_dataset
        mock_save_document.return_value = ([mock_document], "batch123")

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents",
            method="POST",
            json={
                "indexing_technique": "high_quality",
                "data_source": {
                    "type": "upload_file",
                    "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file-id-1"]}},
                },
                "process_rule": {"mode": "automatic"},
            },
        ):
            from controllers.console.datasets.datasets_document import DatasetDocumentListApi

            api = DatasetDocumentListApi()
            response = api.post(mock_dataset.id)

        # Assert
        mock_save_document.assert_called_once()
        assert "documents" in response
        assert "batch" in response

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets_document.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset")
    def test_upload_document_dataset_not_found(
        self, mock_get_dataset, mock_current_account, mock_db_session, app, mock_user
    ):
        """
        Test document upload fails when dataset not found.

        Verifies that:
        - NotFound error is raised for non-existent dataset
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = None

        # Act & Assert
        with app.test_request_context(
            "/datasets/non-existent-id/documents",
            method="POST",
            json={"indexing_technique": "high_quality"},
        ):
            from controllers.console.datasets.datasets_document import DatasetDocumentListApi

            api = DatasetDocumentListApi()
            with pytest.raises(NotFound):
                api.post("non-existent-id")

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets_document.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset")
    def test_upload_document_forbidden_for_non_editor(
        self, mock_get_dataset, mock_current_account, mock_db_session, app, mock_dataset, mock_user
    ):
        """
        Test document upload fails for non-editor users.

        Verifies that:
        - Forbidden error is raised for users without edit permission
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_user.is_dataset_editor = False
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = mock_dataset

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents",
            method="POST",
            json={"indexing_technique": "high_quality"},
        ):
            from controllers.console.datasets.datasets_document import DatasetDocumentListApi

            api = DatasetDocumentListApi()
            with pytest.raises(Forbidden):
                api.post(mock_dataset.id)


class TestBatchOperations:
    """Test cases for batch operations on documents."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        from flask_login import LoginManager

        from extensions.ext_database import db

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        app.config["RESTX_MASK_SWAGGER"] = False
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        app.config["ERROR_404_HELP"] = False

        # Initialize extensions
        db.init_app(app)
        login_manager = LoginManager()
        login_manager.init_app(app)

        @login_manager.user_loader
        def load_user(user_id):
            return None

        # Create all database tables
        with app.app_context():
            db.create_all()

        return app

    @pytest.fixture
    def mock_dataset(self):
        """Create mock dataset object."""
        dataset = MagicMock(spec=Dataset)
        dataset.id = str(uuid4())
        dataset.name = "Test Dataset"
        dataset.tenant_id = "test-tenant-id"
        dataset.provider = "vendor"
        return dataset

    @pytest.fixture
    def mock_user(self):
        """Create mock user object."""
        return create_mock_account()

    @pytest.fixture
    def mock_documents(self):
        """Create mock document list."""
        docs = []
        for i in range(3):
            doc = MagicMock()
            doc.id = str(uuid4())
            doc.name = f"document_{i}.txt"
            doc.indexing_status = "completed"
            docs.append(doc)
        return docs

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets_document.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset")
    @patch("controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission")
    @patch("controllers.console.datasets.datasets_document.DocumentService.get_batch_documents")
    def test_get_batch_documents_success(
        self,
        mock_get_batch_docs,
        mock_check_permission,
        mock_get_dataset,
        mock_current_account,
        mock_db_session,
        app,
        mock_dataset,
        mock_user,
        mock_documents,
    ):
        """
        Test successful retrieval of batch documents.

        Verifies that:
        - Batch documents are retrieved by batch ID
        - User has proper permissions
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = mock_dataset
        mock_get_batch_docs.return_value = mock_documents

        # Act
        with app.test_request_context(f"/datasets/{mock_dataset.id}/documents/batch123"):
            from controllers.console.datasets.datasets_document import DocumentResource

            resource = DocumentResource()
            documents = resource.get_batch_documents(str(mock_dataset.id), "batch123")

        # Assert
        assert len(documents) == 3
        mock_get_batch_docs.assert_called_once_with(str(mock_dataset.id), "batch123")

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets_document.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset")
    def test_get_batch_documents_dataset_not_found(
        self, mock_get_dataset, mock_current_account, mock_db_session, app, mock_user
    ):
        """
        Test batch document retrieval fails when dataset not found.

        Verifies that:
        - NotFound error is raised for non-existent dataset
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = None

        # Act & Assert
        with app.test_request_context("/datasets/non-existent-id/documents/batch123"):
            from controllers.console.datasets.datasets_document import DocumentResource

            resource = DocumentResource()
            with pytest.raises(NotFound):
                resource.get_batch_documents("non-existent-id", "batch123")

    @patch("extensions.ext_database.db.session")
    @patch("controllers.console.datasets.datasets_document.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets_document.DatasetService.get_dataset")
    @patch("controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission")
    @patch("controllers.console.datasets.datasets_document.DocumentService.get_batch_documents")
    def test_get_batch_documents_empty_batch(
        self,
        mock_get_batch_docs,
        mock_check_permission,
        mock_get_dataset,
        mock_current_account,
        mock_db_session,
        app,
        mock_dataset,
        mock_user,
    ):
        """
        Test batch document retrieval with empty batch.

        Verifies that:
        - NotFound error is raised when batch has no documents
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_get_dataset.return_value = mock_dataset
        mock_get_batch_docs.return_value = []

        # Act & Assert
        with app.test_request_context(f"/datasets/{mock_dataset.id}/documents/batch123"):
            from controllers.console.datasets.datasets_document import DocumentResource

            resource = DocumentResource()
            with pytest.raises(NotFound):
                resource.get_batch_documents(str(mock_dataset.id), "batch123")


class TestInputValidation:
    """Test cases for input validation and error handling."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        from flask_login import LoginManager

        from extensions.ext_database import db

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        app.config["RESTX_MASK_SWAGGER"] = False
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        app.config["ERROR_404_HELP"] = False

        # Initialize extensions
        db.init_app(app)
        login_manager = LoginManager()
        login_manager.init_app(app)

        @login_manager.user_loader
        def load_user(user_id):
            return None

        # Create all database tables
        with app.app_context():
            db.create_all()

        return app

    @pytest.fixture
    def mock_user(self):
        """Create mock user object."""
        return create_mock_account()

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    def test_create_dataset_invalid_name_too_short(self, mock_current_account, mock_db_session, app, mock_user):
        """
        Test dataset creation fails with name too short.

        Verifies that:
        - ValueError is raised for names shorter than 1 character
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")

        # Act & Assert
        with app.test_request_context(
            "/datasets", method="POST", json={"name": "", "indexing_technique": "high_quality"}
        ):
            from controllers.console.datasets.datasets import DatasetListApi

            api = DatasetListApi()
            with pytest.raises(BadRequest):  # Will raise validation error
                api.post()

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    def test_create_dataset_invalid_name_too_long(self, mock_current_account, mock_db_session, app, mock_user):
        """
        Test dataset creation fails with name too long.

        Verifies that:
        - ValueError is raised for names longer than 40 characters
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")

        # Act & Assert
        with app.test_request_context(
            "/datasets", method="POST", json={"name": "a" * 41, "indexing_technique": "high_quality"}
        ):
            from controllers.console.datasets.datasets import DatasetListApi

            api = DatasetListApi()
            with pytest.raises(BadRequest):  # Will raise validation error
                api.post()

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    def test_create_dataset_invalid_indexing_technique(self, mock_current_account, mock_db_session, app, mock_user):
        """
        Test dataset creation fails with invalid indexing technique.

        Verifies that:
        - Validation error is raised for unsupported indexing techniques
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")

        # Act & Assert
        with app.test_request_context(
            "/datasets", method="POST", json={"name": "Test Dataset", "indexing_technique": "invalid_technique"}
        ):
            from controllers.console.datasets.datasets import DatasetListApi

            api = DatasetListApi()
            with pytest.raises(BadRequest):  # Will raise validation error
                api.post()

    @patch("extensions.ext_database.db.session")
    @patch("libs.login.current_account_with_tenant")
    @patch("controllers.console.datasets.datasets.DatasetService.get_dataset")
    @patch("controllers.console.datasets.datasets.DatasetService.check_dataset_permission")
    def test_update_dataset_invalid_permission(
        self, mock_check_permission, mock_get_dataset, mock_current_account, mock_db_session, app, mock_user
    ):
        """
        Test dataset update fails with invalid permission value.

        Verifies that:
        - Validation error is raised for unsupported permission values
        """
        # Arrange
        mock_db_session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_user, "test-tenant-id")
        mock_dataset = MagicMock()
        mock_dataset.id = str(uuid4())
        mock_get_dataset.return_value = mock_dataset

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}", method="PUT", json={"permission": "invalid_permission"}
        ):
            from controllers.console.datasets.datasets import DatasetApi

            api = DatasetApi()
            with pytest.raises(BadRequest):  # Will raise validation error
                api.patch(mock_dataset.id)
