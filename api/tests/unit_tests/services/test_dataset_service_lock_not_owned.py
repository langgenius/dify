import types
from unittest.mock import Mock, create_autospec

import pytest
from redis.exceptions import LockNotOwnedError

from models.account import Account
from models.dataset import Dataset, Document
from services.dataset_service import DocumentService, SegmentService


class FakeLock:
    """Lock that always fails on enter with LockNotOwnedError."""

    def __enter__(self):
        raise LockNotOwnedError("simulated")

    def __exit__(self, exc_type, exc, tb):
        # Normal contextmanager signature; return False so exceptions propagate
        return False


@pytest.fixture
def fake_current_user(monkeypatch):
    user = create_autospec(Account, instance=True)
    user.id = "user-1"
    user.current_tenant_id = "tenant-1"
    monkeypatch.setattr("services.dataset_service.current_user", user)
    return user


@pytest.fixture
def fake_features(monkeypatch):
    """Features.billing.enabled == False to skip quota logic."""
    features = types.SimpleNamespace(
        billing=types.SimpleNamespace(enabled=False, subscription=types.SimpleNamespace(plan="ENTERPRISE")),
        documents_upload_quota=types.SimpleNamespace(limit=10_000, size=0),
    )
    monkeypatch.setattr(
        "services.dataset_service.FeatureService.get_features",
        lambda tenant_id: features,
    )
    return features


@pytest.fixture
def fake_lock(monkeypatch):
    """Patch redis_client.lock to always raise LockNotOwnedError on enter."""

    def _fake_lock(name, timeout=None, *args, **kwargs):
        return FakeLock()

    # DatasetService imports redis_client directly from extensions.ext_redis
    monkeypatch.setattr("services.dataset_service.redis_client.lock", _fake_lock)


# ---------------------------------------------------------------------------
# 1. Knowledge Pipeline document creation (save_document_with_dataset_id)
# ---------------------------------------------------------------------------


def test_save_document_with_dataset_id_ignores_lock_not_owned(
    monkeypatch,
    fake_current_user,
    fake_features,
    fake_lock,
):
    # Arrange
    dataset = create_autospec(Dataset, instance=True)
    dataset.id = "ds-1"
    dataset.tenant_id = fake_current_user.current_tenant_id
    dataset.data_source_type = "upload_file"
    dataset.indexing_technique = "high_quality"  # so we skip re-initialization branch

    # Minimal knowledge_config stub that satisfies pre-lock code
    info_list = types.SimpleNamespace(data_source_type="upload_file")
    data_source = types.SimpleNamespace(info_list=info_list)
    knowledge_config = types.SimpleNamespace(
        doc_form="qa_model",
        original_document_id=None,  # go into "new document" branch
        data_source=data_source,
        indexing_technique="high_quality",
        embedding_model=None,
        embedding_model_provider=None,
        retrieval_model=None,
        process_rule=None,
        duplicate=False,
        doc_language="en",
    )

    account = fake_current_user

    # Avoid touching real doc_form logic
    monkeypatch.setattr("services.dataset_service.DatasetService.check_doc_form", lambda *a, **k: None)
    # Avoid real DB interactions
    monkeypatch.setattr("services.dataset_service.db", Mock())

    # Act: this would hit the redis lock, whose __enter__ raises LockNotOwnedError.
    # Our implementation should catch it and still return (documents, batch).
    documents, batch = DocumentService.save_document_with_dataset_id(
        dataset=dataset,
        knowledge_config=knowledge_config,
        account=account,
    )

    # Assert
    # We mainly care that:
    # - No exception is raised
    # - The function returns a sensible tuple
    assert isinstance(documents, list)
    assert isinstance(batch, str)


# ---------------------------------------------------------------------------
# 2. Single-segment creation (add_segment)
# ---------------------------------------------------------------------------


def test_add_segment_ignores_lock_not_owned(
    monkeypatch,
    fake_current_user,
    fake_lock,
):
    # Arrange
    dataset = create_autospec(Dataset, instance=True)
    dataset.id = "ds-1"
    dataset.tenant_id = fake_current_user.current_tenant_id
    dataset.indexing_technique = "economy"  # skip embedding/token calculation branch

    document = create_autospec(Document, instance=True)
    document.id = "doc-1"
    document.dataset_id = dataset.id
    document.word_count = 0
    document.doc_form = "qa_model"

    # Minimal args required by add_segment
    args = {
        "content": "question text",
        "answer": "answer text",
        "keywords": ["k1", "k2"],
    }

    # Avoid real DB operations
    db_mock = Mock()
    db_mock.session = Mock()
    monkeypatch.setattr("services.dataset_service.db", db_mock)
    monkeypatch.setattr("services.dataset_service.VectorService", Mock())

    # Act
    result = SegmentService.create_segment(args=args, document=document, dataset=dataset)

    # Assert
    # Under LockNotOwnedError except, add_segment should swallow the error and return None.
    assert result is None


# ---------------------------------------------------------------------------
# 3. Multi-segment creation (multi_create_segment)
# ---------------------------------------------------------------------------


def test_multi_create_segment_ignores_lock_not_owned(
    monkeypatch,
    fake_current_user,
    fake_lock,
):
    # Arrange
    dataset = create_autospec(Dataset, instance=True)
    dataset.id = "ds-1"
    dataset.tenant_id = fake_current_user.current_tenant_id
    dataset.indexing_technique = "economy"  # again, skip high_quality path

    document = create_autospec(Document, instance=True)
    document.id = "doc-1"
    document.dataset_id = dataset.id
    document.word_count = 0
    document.doc_form = "qa_model"
