from unittest.mock import Mock

import pytest

from controllers.console.datasets.error import PipelineNotFoundError
from controllers.console.datasets.wraps import get_rag_pipeline
from models.dataset import Pipeline


class TestGetRagPipeline:
    def test_missing_pipeline_id(self):
        @get_rag_pipeline
        def dummy_view(**kwargs):
            return "ok"

        with pytest.raises(ValueError, match="missing pipeline_id"):
            dummy_view()

    def test_pipeline_not_found(self, mocker):
        @get_rag_pipeline
        def dummy_view(**kwargs):
            return "ok"

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )

        mock_query = Mock()
        mock_query.where.return_value.first.return_value = None

        mocker.patch(
            "controllers.console.datasets.wraps.db.session.query",
            return_value=mock_query,
        )

        with pytest.raises(PipelineNotFoundError):
            dummy_view(pipeline_id="pipeline-1")

    def test_pipeline_found_and_injected(self, mocker):
        pipeline = Mock(spec=Pipeline)
        pipeline.id = "pipeline-1"
        pipeline.tenant_id = "tenant-1"

        @get_rag_pipeline
        def dummy_view(**kwargs):
            return kwargs["pipeline"]

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )

        mock_query = Mock()
        mock_query.where.return_value.first.return_value = pipeline

        mocker.patch(
            "controllers.console.datasets.wraps.db.session.query",
            return_value=mock_query,
        )

        result = dummy_view(pipeline_id="pipeline-1")

        assert result is pipeline

    def test_pipeline_id_removed_from_kwargs(self, mocker):
        pipeline = Mock(spec=Pipeline)

        @get_rag_pipeline
        def dummy_view(**kwargs):
            assert "pipeline_id" not in kwargs
            return "ok"

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )

        mock_query = Mock()
        mock_query.where.return_value.first.return_value = pipeline

        mocker.patch(
            "controllers.console.datasets.wraps.db.session.query",
            return_value=mock_query,
        )

        result = dummy_view(pipeline_id="pipeline-1")

        assert result == "ok"

    def test_pipeline_id_cast_to_string(self, mocker):
        pipeline = Mock(spec=Pipeline)

        @get_rag_pipeline
        def dummy_view(**kwargs):
            return kwargs["pipeline"]

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )

        def where_side_effect(*args, **kwargs):
            assert args[0].right.value == "123"
            return Mock(first=lambda: pipeline)

        mock_query = Mock()
        mock_query.where.side_effect = where_side_effect

        mocker.patch(
            "controllers.console.datasets.wraps.db.session.query",
            return_value=mock_query,
        )

        result = dummy_view(pipeline_id=123)

        assert result is pipeline
