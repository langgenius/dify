import types
from unittest.mock import create_autospec

import pytest
from redis.exceptions import LockNotOwnedError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.account import Account, Tenant
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentSegment
from models.enums import ProcessRuleMode
from services.knowledge.dataset_service import DocumentService, SegmentService
from services.knowledge.entities.knowledge_entities import DataSource, InfoList, KnowledgeConfig
from services.knowledge.segments.application import SegmentMutationService

TENANT_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"
DATASET_ID = "33333333-3333-3333-3333-333333333333"
DOCUMENT_ID = "44444444-4444-4444-4444-444444444444"


class FakeLock:
    """Lock that always fails on enter with LockNotOwnedError."""

    def __enter__(self) -> None:
        raise LockNotOwnedError("simulated")

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: types.TracebackType | None
    ) -> bool:
        # Normal contextmanager signature; return False so exceptions propagate
        return False


@pytest.fixture
def fake_current_user(monkeypatch: pytest.MonkeyPatch) -> Account:
    tenant = Tenant(name="Test Tenant")
    tenant.id = TENANT_ID
    user = Account(name="Test User", email="test@example.com")
    user.id = USER_ID
    user._current_tenant = tenant
    monkeypatch.setattr("services.knowledge.dataset_service.current_user", user)
    return user


@pytest.fixture
def fake_features(monkeypatch: pytest.MonkeyPatch) -> types.SimpleNamespace:
    features = types.SimpleNamespace(
        billing=types.SimpleNamespace(subscription=types.SimpleNamespace(plan="ENTERPRISE")),
        documents_upload_quota=types.SimpleNamespace(limit=10_000, size=0),
    )
    monkeypatch.setattr(
        "services.knowledge.dataset_service.FeatureService.get_features",
        lambda tenant_id, **_kwargs: features,
    )
    return features


@pytest.fixture
def fake_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch redis_client.lock to always raise LockNotOwnedError on enter."""

    def _fake_lock(name: str, timeout: float | None = None, *args: object, **kwargs: object) -> FakeLock:
        return FakeLock()

    # DatasetService imports redis_client directly from extensions.ext_redis
    monkeypatch.setattr("services.knowledge.dataset_service.redis_client.lock", _fake_lock)


# ---------------------------------------------------------------------------
# 1. Knowledge Pipeline document creation (save_document_with_dataset_id)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("sqlite_session", [(Account, Tenant, Dataset, DatasetProcessRule, Document)], indirect=True)
def test_save_document_with_dataset_id_ignores_lock_not_owned(
    monkeypatch: pytest.MonkeyPatch,
    fake_current_user: Account,
    fake_features: types.SimpleNamespace,
    fake_lock: None,
    sqlite_session: Session,
) -> None:
    # Arrange
    dataset = Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="Test Dataset",
        description="",
        created_by=USER_ID,
        data_source_type="upload_file",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
    )
    process_rule = DatasetProcessRule(
        dataset_id=DATASET_ID,
        mode=ProcessRuleMode.AUTOMATIC,
        rules=None,
        created_by=USER_ID,
    )
    sqlite_session.add_all([fake_current_user._current_tenant, fake_current_user, dataset, process_rule])
    sqlite_session.commit()

    knowledge_config = KnowledgeConfig(
        doc_form=IndexStructureType.QA_INDEX,
        original_document_id=None,  # go into "new document" branch
        data_source=DataSource(info_list=InfoList(data_source_type="upload_file")),
        indexing_technique="high_quality",
        duplicate=False,
        doc_language="en",
    )

    account = fake_current_user

    # Avoid touching real doc_form logic
    monkeypatch.setattr("services.knowledge.dataset_service.DatasetService.check_doc_form", lambda *a, **k: None)

    # Act: this would hit the redis lock, whose __enter__ raises LockNotOwnedError.
    # Our implementation should catch it and still return (documents, batch).
    documents, batch = DocumentService.save_document_with_dataset_id(
        dataset=dataset,
        knowledge_config=knowledge_config,
        account=account,
        dataset_process_rule=process_rule,
        session=sqlite_session,
    )

    # Assert
    # We mainly care that:
    # - No exception is raised
    # - The function returns a sensible tuple
    assert documents == []
    assert batch
    assert not sqlite_session.in_transaction()
    assert sqlite_session.scalar(select(func.count(Document.id))) == 0
    assert sqlite_session.get(DatasetProcessRule, process_rule.id) is process_rule


# ---------------------------------------------------------------------------
# 2. Single-segment creation (add_segment)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 3. Multi-segment creation (multi_create_segment)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("sqlite_session", [(Account, Tenant, Dataset, Document, DocumentSegment)], indirect=True)
def test_multi_create_segment_ignores_lock_not_owned(
    monkeypatch: pytest.MonkeyPatch,
    fake_current_user: Account,
    fake_lock: None,
    sqlite_session: Session,
) -> None:
    # Arrange
    dataset = Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="Test Dataset",
        description="",
        created_by=USER_ID,
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    document = Document(
        id=DOCUMENT_ID,
        tenant_id=TENANT_ID,
        dataset_id=DATASET_ID,
        position=1,
        data_source_type="upload_file",
        data_source_info="{}",
        batch="batch-1",
        name="Test Document",
        created_from="web",
        created_by=USER_ID,
        word_count=0,
        doc_form=IndexStructureType.QA_INDEX,
    )
    sqlite_session.add_all([fake_current_user._current_tenant, fake_current_user, dataset, document])
    sqlite_session.commit()

    mutations = create_autospec(SegmentMutationService, instance=True)
    result = SegmentService.multi_create_segment(
        segments=[{"content": "question", "answer": "answer", "keywords": ["key"]}],
        document=document,
        dataset=dataset,
        session=sqlite_session,
        mutations=mutations,
    )

    assert result is None
    mutations.index_segments.assert_not_called()
    assert not sqlite_session.in_transaction()
    assert sqlite_session.scalar(select(func.count(DocumentSegment.id))) == 0
    sqlite_session.refresh(document)
    assert document.word_count == 0
