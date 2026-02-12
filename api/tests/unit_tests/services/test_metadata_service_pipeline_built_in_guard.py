from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from models.dataset import Dataset, Pipeline
from models.workflow import Workflow
from services.metadata_service import MetadataService

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_pipeline(*, workflow_id: str | None = "workflow-published-1") -> MagicMock:
    pipeline = MagicMock(spec=Pipeline)
    pipeline.id = "pipeline-1"
    pipeline.name = "Pipeline A"
    pipeline.workflow_id = workflow_id
    return pipeline


def _make_workflow(graph_dict: dict) -> MagicMock:
    workflow = MagicMock(spec=Workflow)
    workflow.id = "workflow-1"
    workflow.graph_dict = graph_dict
    return workflow


def _make_dataset(*, pipeline_id: str | None = "pipeline-1") -> MagicMock:
    dataset = MagicMock(spec=Dataset)
    dataset.id = "dataset-1"
    dataset.pipeline_id = pipeline_id
    return dataset


def _setup_db_for_check(mock_db, *, dataset=None, pipeline=None, workflow=None):
    """Wire up ``db.session.query(Model).filter_by(...).first()`` chains."""
    queries = []
    if dataset is not None:
        q = MagicMock()
        q.filter_by.return_value.first.return_value = dataset
        queries.append(q)
    if pipeline is not None:
        q = MagicMock()
        q.filter_by.return_value.first.return_value = pipeline
        queries.append(q)
    if workflow is not None:
        q = MagicMock()
        q.filter_by.return_value.first.return_value = workflow
        queries.append(q)
    mock_db.session.query.side_effect = queries


# ---------------------------------------------------------------------------
# check_built_in_enabled_in_published_pipeline
# ---------------------------------------------------------------------------


class TestCheckBuiltInEnabledInPublishedPipeline:
    @patch("services.metadata_service.db")
    def test_returns_true_when_enabled(self, mock_db):
        workflow = _make_workflow(
            {
                "nodes": [{"data": {"type": "knowledge-index", "enable_built_in_metadata": True}}],
            }
        )
        _setup_db_for_check(mock_db, dataset=_make_dataset(), pipeline=_make_pipeline(), workflow=workflow)

        is_enabled, name = MetadataService.check_built_in_enabled_in_published_pipeline("dataset-1")

        assert is_enabled is True
        assert name == "Pipeline A"

    @patch("services.metadata_service.db")
    def test_returns_false_when_disabled(self, mock_db):
        workflow = _make_workflow(
            {
                "nodes": [{"data": {"type": "knowledge-index", "enable_built_in_metadata": False}}],
            }
        )
        _setup_db_for_check(mock_db, dataset=_make_dataset(), pipeline=_make_pipeline(), workflow=workflow)

        is_enabled, name = MetadataService.check_built_in_enabled_in_published_pipeline("dataset-1")

        assert is_enabled is False
        assert name is None

    @patch("services.metadata_service.db")
    def test_returns_false_when_no_pipeline_id(self, mock_db):
        _setup_db_for_check(mock_db, dataset=_make_dataset(pipeline_id=None))

        is_enabled, name = MetadataService.check_built_in_enabled_in_published_pipeline("dataset-1")

        assert is_enabled is False
        assert name is None

    @patch("services.metadata_service.db")
    def test_returns_false_when_no_published_workflow(self, mock_db):
        _setup_db_for_check(
            mock_db,
            dataset=_make_dataset(),
            pipeline=_make_pipeline(workflow_id=None),
        )

        is_enabled, name = MetadataService.check_built_in_enabled_in_published_pipeline("dataset-1")

        assert is_enabled is False
        assert name is None

    @patch("services.metadata_service.db")
    def test_fail_closed_on_graph_parse_error(self, mock_db):
        """If graph_dict raises, assume built-in is enabled (fail-closed)."""
        workflow = MagicMock(spec=Workflow)
        workflow.id = "wf-bad"
        type(workflow).graph_dict = PropertyMock(side_effect=RuntimeError("corrupt"))
        _setup_db_for_check(mock_db, dataset=_make_dataset(), pipeline=_make_pipeline(), workflow=workflow)

        is_enabled, name = MetadataService.check_built_in_enabled_in_published_pipeline("dataset-1")

        assert is_enabled is True
        assert name == "Pipeline A"

    @patch("services.metadata_service.db")
    def test_multiple_nodes_only_one_enabled(self, mock_db):
        workflow = _make_workflow(
            {
                "nodes": [
                    {"data": {"type": "knowledge-index", "enable_built_in_metadata": False}},
                    {"data": {"type": "knowledge-index", "enable_built_in_metadata": True}},
                ],
            }
        )
        _setup_db_for_check(mock_db, dataset=_make_dataset(), pipeline=_make_pipeline(), workflow=workflow)

        is_enabled, name = MetadataService.check_built_in_enabled_in_published_pipeline("dataset-1")

        assert is_enabled is True
        assert name == "Pipeline A"

    @patch("services.metadata_service.db")
    def test_ignores_non_knowledge_index_nodes(self, mock_db):
        workflow = _make_workflow(
            {
                "nodes": [
                    {"data": {"type": "llm", "enable_built_in_metadata": True}},
                ],
            }
        )
        _setup_db_for_check(mock_db, dataset=_make_dataset(), pipeline=_make_pipeline(), workflow=workflow)

        is_enabled, name = MetadataService.check_built_in_enabled_in_published_pipeline("dataset-1")

        assert is_enabled is False
        assert name is None


# ---------------------------------------------------------------------------
# disable_built_in_field — always guards against published pipeline usage
# ---------------------------------------------------------------------------


class TestDisableBuiltInField:
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch.object(MetadataService, "check_built_in_enabled_in_published_pipeline")
    @patch.object(MetadataService, "knowledge_base_metadata_lock_check")
    def test_raises_when_pipeline_uses_built_in(
        self,
        mock_lock_check,
        mock_check_built_in,
        mock_document_service,
        mock_redis_client,
        mock_db,
    ):
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset-1"
        dataset.built_in_field_enabled = True
        mock_check_built_in.return_value = (True, "Pipeline A")

        with pytest.raises(
            ValueError,
            match="Cannot disable built-in metadata",
        ):
            MetadataService.disable_built_in_field(dataset)

        mock_check_built_in.assert_called_once_with(dataset.id)
        # Lock IS acquired first, then guard rejects — but no DB mutation happens
        mock_lock_check.assert_called_once()
        mock_db.session.add.assert_not_called()
        mock_db.session.commit.assert_not_called()
        # Lock is released in finally
        mock_redis_client.delete.assert_called_once()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch.object(MetadataService, "check_built_in_enabled_in_published_pipeline")
    @patch.object(MetadataService, "knowledge_base_metadata_lock_check")
    def test_allows_when_pipeline_not_using(
        self,
        mock_lock_check,
        mock_check_built_in,
        mock_document_service,
        mock_redis_client,
        mock_db,
    ):
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset-1"
        dataset.built_in_field_enabled = True
        mock_check_built_in.return_value = (False, None)
        mock_document_service.get_working_documents_by_dataset_id.return_value = []

        MetadataService.disable_built_in_field(dataset)

        mock_check_built_in.assert_called_once_with(dataset.id)
        assert dataset.built_in_field_enabled is False
        mock_db.session.commit.assert_called_once()

    def test_noop_when_already_disabled(self):
        dataset = MagicMock(spec=Dataset)
        dataset.built_in_field_enabled = False

        # Should return immediately without any side effects
        MetadataService.disable_built_in_field(dataset)

        assert dataset.built_in_field_enabled is False
