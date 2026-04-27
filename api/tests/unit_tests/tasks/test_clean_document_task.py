"""
Unit tests for clean_document_task.

Focuses on the resilience contract added by the billing-failure fix:
``index_processor.clean()`` is wrapped in ``try/except`` so that a transient
failure inside the vector / keyword cleanup (e.g. ``ValueError("Unable to
retrieve billing information...")`` raised by ``BillingService._send_request``
when ``Vector(dataset)`` transitively triggers ``FeatureService.get_features``)
does not abort the entire task and leave PG with stranded ``DocumentSegment``
/ ``ChildChunk`` / ``UploadFile`` / ``DatasetMetadataBinding`` rows.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from tasks.clean_document_task import clean_document_task


@pytest.fixture
def document_id():
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id():
    return str(uuid.uuid4())


@pytest.fixture
def tenant_id():
    return str(uuid.uuid4())


@pytest.fixture
def mock_session_factory():
    """Patch ``session_factory.create_session`` to return per-call mock sessions.

    Each call to ``create_session()`` yields a fresh ``MagicMock`` session so we
    can assert ``execute()`` calls across the multiple short-lived transactions
    used by ``clean_document_task``.
    """
    with patch("tasks.clean_document_task.session_factory", autospec=True) as mock_sf:
        sessions: list[MagicMock] = []

        def _create_session():
            session = MagicMock()
            session.scalars.return_value.all.return_value = []
            session.execute.return_value.all.return_value = []
            session.scalar.return_value = None
            cm = MagicMock()
            cm.__enter__.return_value = session
            cm.__exit__.return_value = None
            sessions.append(session)
            return cm

        mock_sf.create_session.side_effect = _create_session
        yield mock_sf, sessions


@pytest.fixture
def mock_storage():
    with patch("tasks.clean_document_task.storage", autospec=True) as mock:
        mock.delete.return_value = None
        yield mock


@pytest.fixture
def mock_index_processor_factory():
    """Mock ``IndexProcessorFactory`` so we can inject behavior into ``clean``."""
    with patch("tasks.clean_document_task.IndexProcessorFactory", autospec=True) as factory_cls:
        processor = MagicMock()
        processor.clean.return_value = None
        factory_instance = MagicMock()
        factory_instance.init_index_processor.return_value = processor
        factory_cls.return_value = factory_instance

        yield {
            "factory_cls": factory_cls,
            "factory_instance": factory_instance,
            "processor": processor,
        }


def _build_segment(segment_id: str, content: str = "segment content") -> MagicMock:
    seg = MagicMock()
    seg.id = segment_id
    seg.index_node_id = f"node-{segment_id}"
    seg.content = content
    return seg


def _build_dataset(dataset_id: str, tenant_id: str) -> MagicMock:
    ds = MagicMock()
    ds.id = dataset_id
    ds.tenant_id = tenant_id
    return ds


class TestVectorCleanupResilience:
    """Vector / keyword cleanup must not abort the task on transient failure."""

    def test_billing_failure_during_vector_cleanup_does_not_skip_pg_cleanup(
        self,
        document_id,
        dataset_id,
        tenant_id,
        mock_session_factory,
        mock_storage,
        mock_index_processor_factory,
    ):
        """Reproduces the production incident:

        ``Vector(dataset)`` transitively calls ``FeatureService.get_features``
        which calls ``BillingService._send_request("GET", ...)``. When billing
        returns non-200 it raises ``ValueError("Unable to retrieve billing
        information...")``. Before the fix this propagated out of
        ``clean_document_task`` and left ``DocumentSegment`` / ``ChildChunk`` /
        ``UploadFile`` / ``DatasetMetadataBinding`` rows orphaned because the
        already-deleted ``Document`` row had been hard-committed by the caller
        (``dataset_service.delete_document``) before ``.delay()`` was invoked.

        Contract: a billing failure inside ``index_processor.clean()`` must be
        caught, logged, and the rest of the task must continue so PG ends up
        consistent with the deleted ``Document`` even if Qdrant retains
        orphan vectors that can be reaped later.
        """
        mock_sf, sessions = mock_session_factory

        # First create_session(): Step 1 (load segments + attachments).
        step1_session = MagicMock()
        step1_session.scalars.return_value.all.return_value = [
            _build_segment("seg-1"),
            _build_segment("seg-2"),
        ]
        step1_session.execute.return_value.all.return_value = []
        step1_session.scalar.return_value = _build_dataset(dataset_id, tenant_id)
        # Second create_session(): Step 2 (vector cleanup). Returns dataset.
        step2_session = MagicMock()
        step2_session.scalar.return_value = _build_dataset(dataset_id, tenant_id)
        step2_session.scalars.return_value.all.return_value = []
        step2_session.execute.return_value.all.return_value = []
        # Subsequent sessions: Step 3+ (image / segment / file / metadata cleanup).
        # Default fixture returns empty results which is fine for these short txns.
        cm1, cm2 = MagicMock(), MagicMock()
        cm1.__enter__.return_value = step1_session
        cm1.__exit__.return_value = None
        cm2.__enter__.return_value = step2_session
        cm2.__exit__.return_value = None

        def _default_cm():
            session = MagicMock()
            session.scalars.return_value.all.return_value = []
            session.execute.return_value.all.return_value = []
            session.scalar.return_value = None
            cm = MagicMock()
            cm.__enter__.return_value = session
            cm.__exit__.return_value = None
            sessions.append(session)
            return cm

        mock_sf.create_session.side_effect = [cm1, cm2] + [_default_cm() for _ in range(10)]

        # Simulate the production failure: index_processor.clean() raises ValueError
        # mirroring BillingService._send_request when billing returns non-200.
        mock_index_processor_factory["processor"].clean.side_effect = ValueError(
            "Unable to retrieve billing information. Please try again later or contact support."
        )

        # Act — must not raise out of the task even though clean() raises.
        clean_document_task(
            document_id=document_id,
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_id=None,
        )

        # Assert
        # 1. Vector cleanup was attempted.
        mock_index_processor_factory["processor"].clean.assert_called_once()
        # 2. Despite the failure the task continued: at least one DocumentSegment
        #    delete was issued. We use the count of session.execute calls across
        #    later short transactions as a proxy for "Step 3+ executed".
        execute_calls = sum(s.execute.call_count for s in sessions)
        assert execute_calls > 0, (
            "Step 3+ DB cleanup did not run after vector cleanup failure; "
            "this regression would re-introduce the orphan-segment bug."
        )

    def test_vector_cleanup_success_path_remains_unaffected(
        self,
        document_id,
        dataset_id,
        tenant_id,
        mock_session_factory,
        mock_storage,
        mock_index_processor_factory,
    ):
        """Backward-compat: the happy path must still call ``clean()`` exactly
        once with the expected arguments and complete without errors.
        """
        mock_sf, sessions = mock_session_factory

        step1_session = MagicMock()
        step1_session.scalars.return_value.all.return_value = [_build_segment("seg-1")]
        step1_session.execute.return_value.all.return_value = []
        step1_session.scalar.return_value = _build_dataset(dataset_id, tenant_id)
        step2_session = MagicMock()
        step2_session.scalar.return_value = _build_dataset(dataset_id, tenant_id)
        step2_session.scalars.return_value.all.return_value = []
        step2_session.execute.return_value.all.return_value = []
        cm1, cm2 = MagicMock(), MagicMock()
        cm1.__enter__.return_value = step1_session
        cm1.__exit__.return_value = None
        cm2.__enter__.return_value = step2_session
        cm2.__exit__.return_value = None

        def _default_cm():
            session = MagicMock()
            session.scalars.return_value.all.return_value = []
            session.execute.return_value.all.return_value = []
            session.scalar.return_value = None
            cm = MagicMock()
            cm.__enter__.return_value = session
            cm.__exit__.return_value = None
            sessions.append(session)
            return cm

        mock_sf.create_session.side_effect = [cm1, cm2] + [_default_cm() for _ in range(10)]

        clean_document_task(
            document_id=document_id,
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_id=None,
        )

        assert mock_index_processor_factory["processor"].clean.call_count == 1
        # Index cleanup invoked with the expected delete_summaries / delete_child_chunks flags.
        _, kwargs = mock_index_processor_factory["processor"].clean.call_args
        assert kwargs.get("with_keywords") is True
        assert kwargs.get("delete_child_chunks") is True
        assert kwargs.get("delete_summaries") is True

    def test_no_segments_skips_vector_cleanup(
        self,
        document_id,
        dataset_id,
        tenant_id,
        mock_session_factory,
        mock_storage,
        mock_index_processor_factory,
    ):
        """When the document has no segments (e.g. indexing failed before
        producing any), vector cleanup must not be attempted — and therefore
        the new try/except wrapper does not change behavior here.
        """
        mock_sf, sessions = mock_session_factory

        step1_session = MagicMock()
        step1_session.scalars.return_value.all.return_value = []  # no segments
        step1_session.execute.return_value.all.return_value = []
        step1_session.scalar.return_value = _build_dataset(dataset_id, tenant_id)
        cm1 = MagicMock()
        cm1.__enter__.return_value = step1_session
        cm1.__exit__.return_value = None

        def _default_cm():
            session = MagicMock()
            session.scalars.return_value.all.return_value = []
            session.execute.return_value.all.return_value = []
            session.scalar.return_value = None
            cm = MagicMock()
            cm.__enter__.return_value = session
            cm.__exit__.return_value = None
            sessions.append(session)
            return cm

        mock_sf.create_session.side_effect = [cm1] + [_default_cm() for _ in range(10)]

        clean_document_task(
            document_id=document_id,
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_id=None,
        )

        # Vector cleanup is gated on ``index_node_ids``; when there are no
        # segments the IndexProcessorFactory path is never entered.
        mock_index_processor_factory["factory_cls"].assert_not_called()
