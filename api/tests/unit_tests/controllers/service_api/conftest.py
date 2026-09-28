"""
Shared fixtures for Service API controller tests.

This module provides reusable fixtures for mocking authentication,
database interactions, and common test data patterns used across
Service API controller tests.
"""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.base import TypeBase
from models.model import ApiToken, App, AppMode, EndUser, EndUserType


@dataclass(frozen=True)
class ServiceApiIdentity:
    """Persisted owner identity for service-API authentication tests."""

    session: Session
    tenant: Tenant
    account: Account
    membership: TenantAccountJoin


@pytest.fixture
def service_api_identity(sqlite_engine: Engine) -> Iterator[ServiceApiIdentity]:
    """Yield an isolated SQLite session with a real active tenant owner."""
    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[Account.__table__, Tenant.__table__, TenantAccountJoin.__table__],
    )
    with Session(sqlite_engine, expire_on_commit=False) as session:
        tenant = Tenant(name="Service API Workspace")
        tenant.id = str(uuid.uuid4())
        account = Account(name="Service API Owner", email=f"owner-{tenant.id}@example.com")
        account.id = str(uuid.uuid4())
        membership = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
        )
        account._current_tenant = tenant
        session.add_all([tenant, account, membership])
        session.commit()
        yield ServiceApiIdentity(
            session=session,
            tenant=tenant,
            account=account,
            membership=membership,
        )


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
    """Create a real EndUser model with required attributes."""
    user = EndUser(
        id=str(uuid.uuid4()),
        external_user_id=f"external_{uuid.uuid4().hex[:8]}",
        tenant_id=mock_tenant_id,
        app_id=None,
        type=EndUserType.SERVICE_API,
        name="Service API User",
        session_id=str(uuid.uuid4()),
    )
    return user


@pytest.fixture
def mock_app_model(mock_app_id, mock_tenant_id):
    """Create an App model with all required attributes for API testing."""
    app = App(
        id=mock_app_id,
        tenant_id=mock_tenant_id,
        name="Test App",
        description="A test application",
        mode=AppMode.CHAT,
        status="normal",
        enable_api=True,
    )
    return app


@pytest.fixture
def mock_tenant(mock_tenant_id):
    """Create a Tenant model."""
    tenant = Tenant(name="Service API Tenant", status=TenantStatus.NORMAL)
    tenant.id = mock_tenant_id
    return tenant


@pytest.fixture
def mock_account():
    """Create an Account model."""
    account = Account(name="Service API Account", email=f"service-{uuid.uuid4()}@example.com")
    account.id = str(uuid.uuid4())
    return account


@pytest.fixture
def mock_api_token(mock_app_id, mock_tenant_id):
    """Create a real API token for authentication tests."""
    return ApiToken(
        app_id=mock_app_id,
        tenant_id=mock_tenant_id,
        token=f"test_token_{uuid.uuid4().hex[:8]}",
        type="app",
    )


@pytest.fixture
def mock_dataset_api_token(mock_tenant_id):
    """Create a real API token for dataset endpoints."""
    return ApiToken(
        tenant_id=mock_tenant_id,
        token=f"dataset_token_{uuid.uuid4().hex[:8]}",
        type="dataset",
    )


@pytest.fixture
def mock_dataset():
    """Create a Dataset model."""
    from models.dataset import Dataset

    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
        name="Test Dataset",
        indexing_technique="economy",
        embedding_model=None,
        embedding_model_provider=None,
    )
    return dataset


@pytest.fixture
def mock_document():
    """Create a Document model."""
    from models.dataset import Document

    document = Document(
        id=str(uuid.uuid4()),
        dataset_id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
        name="test_document.txt",
        indexing_status="completed",
        enabled=True,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    return document


@pytest.fixture
def mock_segment():
    """Create a DocumentSegment model."""
    from models.dataset import DocumentSegment

    segment = DocumentSegment(
        tenant_id=str(uuid.uuid4()),
        dataset_id=str(uuid.uuid4()),
        document_id=str(uuid.uuid4()),
        position=1,
        content="Test segment content",
        word_count=3,
        tokens=0,
        created_by="account-id",
        enabled=True,
        status="completed",
    )
    segment.id = str(uuid.uuid4())
    return segment


@pytest.fixture
def mock_child_chunk():
    """Create a mock ChildChunk model."""
    from models.dataset import ChildChunk

    child_chunk = ChildChunk(
        tenant_id=str(uuid.uuid4()),
        dataset_id="dataset-id",
        document_id="document-id",
        segment_id=str(uuid.uuid4()),
        position=1,
        content="Test child chunk content",
        word_count=0,
        created_by="account-id",
    )
    child_chunk.id = str(uuid.uuid4())
    return child_chunk
