"""
Shared fixtures for Service API controller tests.

This module provides reusable fixtures for mocking authentication,
database interactions, and common test data patterns used across
Service API controller tests.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import TYPE_CHECKING

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.base import TypeBase
from models.enums import ApiTokenType, AppStatus, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import ApiToken, App, AppMode, EndUser, EndUserType

if TYPE_CHECKING:
    from models.dataset import ChildChunk, Dataset, Document, DocumentSegment


@dataclass(frozen=True)
class ServiceApiIdentity:
    """Persisted owner identity for service-API authentication tests."""

    session: Session
    tenant: Tenant
    account: Account
    membership: TenantAccountJoin


@pytest.fixture
def service_api_identity(sqlite_engine: Engine) -> Iterator[ServiceApiIdentity]:
    """Given an isolated SQLite engine, yield a persisted tenant owner and close its session afterward."""
    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[TypeBase.metadata.tables[model.__tablename__] for model in (Account, Tenant, TenantAccountJoin)],
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
def app() -> Flask:
    """Create Flask test application with proper configuration."""
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def mock_tenant_id() -> str:
    """Return a fresh UUID string for an isolated test tenant."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_app_id() -> str:
    """Return a fresh UUID string for an isolated test app."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_end_user(mock_tenant_id: str) -> EndUser:
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
def mock_app_model(mock_app_id: str, mock_tenant_id: str) -> App:
    """Create an App model with all required attributes for API testing."""
    app = App(
        id=mock_app_id,
        tenant_id=mock_tenant_id,
        name="Test App",
        description="A test application",
        mode=AppMode.CHAT,
        status=AppStatus.NORMAL,
        enable_api=True,
    )
    return app


@pytest.fixture
def mock_tenant(mock_tenant_id: str) -> Tenant:
    """Create a Tenant model."""
    tenant = Tenant(name="Service API Tenant", status=TenantStatus.NORMAL)
    tenant.id = mock_tenant_id
    return tenant


@pytest.fixture
def mock_account() -> Account:
    """Create an Account model."""
    account = Account(name="Service API Account", email=f"service-{uuid.uuid4()}@example.com")
    account.id = str(uuid.uuid4())
    return account


@pytest.fixture
def mock_api_token(mock_app_id: str, mock_tenant_id: str) -> ApiToken:
    """Create a real API token for authentication tests."""
    return ApiToken(
        app_id=mock_app_id,
        tenant_id=mock_tenant_id,
        token=f"test_token_{uuid.uuid4().hex[:8]}",
        type=ApiTokenType.APP,
    )


@pytest.fixture
def mock_dataset_api_token(mock_tenant_id: str) -> ApiToken:
    """Create a real API token for dataset endpoints."""
    return ApiToken(
        tenant_id=mock_tenant_id,
        token=f"dataset_token_{uuid.uuid4().hex[:8]}",
        type=ApiTokenType.DATASET,
    )


@pytest.fixture
def mock_dataset() -> Dataset:
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
def mock_document() -> Document:
    """Return an unpersisted completed Document with its required source and creator fields."""
    from models.dataset import Document

    document = Document(
        id=str(uuid.uuid4()),
        dataset_id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
        name="test_document.txt",
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="test-batch",
        created_from=DocumentCreatedFrom.API,
        created_by=str(uuid.uuid4()),
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    return document


@pytest.fixture
def mock_segment() -> DocumentSegment:
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
        status=SegmentStatus.COMPLETED,
    )
    segment.id = str(uuid.uuid4())
    return segment


@pytest.fixture
def mock_child_chunk() -> ChildChunk:
    """Return an unpersisted ChildChunk with valid required fields."""
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
