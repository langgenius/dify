"""
Shared fixtures for Service API controller tests.

This module provides reusable fixtures for mocking authentication,
database interactions, and common test data patterns used across
Service API controller tests.
"""

import uuid
from unittest.mock import Mock

import pytest
from flask import Flask

from models.account import TenantStatus
from models.model import App, AppMode, EndUser
from tests.unit_tests.conftest import setup_mock_tenant_account_query


@pytest.fixture
def app():
    """Create Flask test application with proper configuration."""
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def mock_tenant_id():
    """Generate a consistent tenant ID for test sessions."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_app_id():
    """Generate a consistent app ID for test sessions."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_end_user(mock_tenant_id):
    """Create a mock EndUser model with required attributes."""
    user = Mock(spec=EndUser)
    user.id = str(uuid.uuid4())
    user.external_user_id = f"external_{uuid.uuid4().hex[:8]}"
    user.tenant_id = mock_tenant_id
    return user


@pytest.fixture
def mock_app_model(mock_app_id, mock_tenant_id):
    """Create a mock App model with all required attributes for API testing."""
    app = Mock(spec=App)
    app.id = mock_app_id
    app.tenant_id = mock_tenant_id
    app.name = "Test App"
    app.description = "A test application"
    app.mode = AppMode.CHAT
    app.author_name = "Test Author"
    app.status = "normal"
    app.enable_api = True
    app.tags = []

    # Mock workflow for workflow apps
    app.workflow = None
    app.app_model_config = None

    return app


@pytest.fixture
def mock_tenant(mock_tenant_id):
    """Create a mock Tenant model."""
    tenant = Mock()
    tenant.id = mock_tenant_id
    tenant.status = TenantStatus.NORMAL
    return tenant


@pytest.fixture
def mock_account():
    """Create a mock Account model."""
    account = Mock()
    account.id = str(uuid.uuid4())
    return account


@pytest.fixture
def mock_api_token(mock_app_id, mock_tenant_id):
    """Create a mock API token for authentication tests."""
    token = Mock()
    token.app_id = mock_app_id
    token.tenant_id = mock_tenant_id
    token.token = f"test_token_{uuid.uuid4().hex[:8]}"
    token.type = "app"
    return token


@pytest.fixture
def mock_dataset_api_token(mock_tenant_id):
    """Create a mock API token for dataset endpoints."""
    token = Mock()
    token.tenant_id = mock_tenant_id
    token.token = f"dataset_token_{uuid.uuid4().hex[:8]}"
    token.type = "dataset"
    return token


class AuthenticationMocker:
    """
    Helper class to set up common authentication mocking patterns.

    Usage:
        auth_mocker = AuthenticationMocker()
        with auth_mocker.mock_app_auth(mock_api_token, mock_app_model, mock_tenant):
            # Test code here
    """

    @staticmethod
    def setup_db_queries(mock_db, mock_app, mock_tenant, mock_account=None):
        """Configure mock_db to return app and tenant in sequence."""
        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app,
            mock_tenant,
        ]

        if mock_account:
            mock_ta = Mock()
            mock_ta.account_id = mock_account.id
            setup_mock_tenant_account_query(mock_db, mock_tenant, mock_ta)

    @staticmethod
    def setup_dataset_auth(mock_db, mock_tenant, mock_account):
        """Configure mock_db for dataset token authentication."""
        mock_ta = Mock()
        mock_ta.account_id = mock_account.id

        mock_query = mock_db.session.query.return_value
        target_mock = mock_query.where.return_value.where.return_value.where.return_value.where.return_value
        target_mock.one_or_none.return_value = (mock_tenant, mock_ta)

        mock_db.session.query.return_value.where.return_value.first.return_value = mock_account


@pytest.fixture
def auth_mocker():
    """Provide an AuthenticationMocker instance."""
    return AuthenticationMocker()


@pytest.fixture
def mock_dataset():
    """Create a mock Dataset model."""
    from models.dataset import Dataset

    dataset = Mock(spec=Dataset)
    dataset.id = str(uuid.uuid4())
    dataset.tenant_id = str(uuid.uuid4())
    dataset.name = "Test Dataset"
    dataset.indexing_technique = "economy"
    dataset.embedding_model = None
    dataset.embedding_model_provider = None
    return dataset


@pytest.fixture
def mock_document():
    """Create a mock Document model."""
    from models.dataset import Document

    document = Mock(spec=Document)
    document.id = str(uuid.uuid4())
    document.dataset_id = str(uuid.uuid4())
    document.tenant_id = str(uuid.uuid4())
    document.name = "test_document.txt"
    document.indexing_status = "completed"
    document.enabled = True
    document.doc_form = "text_model"
    return document


@pytest.fixture
def mock_segment():
    """Create a mock DocumentSegment model."""
    from models.dataset import DocumentSegment

    segment = Mock(spec=DocumentSegment)
    segment.id = str(uuid.uuid4())
    segment.document_id = str(uuid.uuid4())
    segment.dataset_id = str(uuid.uuid4())
    segment.tenant_id = str(uuid.uuid4())
    segment.content = "Test segment content"
    segment.word_count = 3
    segment.position = 1
    segment.enabled = True
    segment.status = "completed"
    return segment


@pytest.fixture
def mock_child_chunk():
    """Create a mock ChildChunk model."""
    from models.dataset import ChildChunk

    child_chunk = Mock(spec=ChildChunk)
    child_chunk.id = str(uuid.uuid4())
    child_chunk.segment_id = str(uuid.uuid4())
    child_chunk.tenant_id = str(uuid.uuid4())
    child_chunk.content = "Test child chunk content"
    return child_chunk


def _unwrap(method):
    """Walk ``__wrapped__`` chain to get the original function."""
    fn = method
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn
