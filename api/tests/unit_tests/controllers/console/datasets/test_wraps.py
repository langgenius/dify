from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from controllers.console.datasets.error import PipelineNotFoundError
from controllers.console.datasets.wraps import get_rag_pipeline, load_rag_pipeline
from models.dataset import Pipeline


class TestGetRagPipeline:
    def test_missing_pipeline_id(self):
        @get_rag_pipeline
        def dummy_view(**kwargs):
            return "ok"

        with pytest.raises(ValueError, match="missing pipeline_id"):
            dummy_view()

    def test_pipeline_not_found(self, mocker: MockerFixture):
        @get_rag_pipeline
        def dummy_view(**kwargs):
            return "ok"

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )

        session_factory = mocker.patch("controllers.console.datasets.wraps.db.session")
        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=None,
        )

        with pytest.raises(PipelineNotFoundError):
            dummy_view(pipeline_id="pipeline-1")
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=session_factory.return_value)

    def test_pipeline_found_and_injected(self, mocker: MockerFixture):
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

        session_factory = mocker.patch("controllers.console.datasets.wraps.db.session")
        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = dummy_view(pipeline_id="pipeline-1")

        assert result is pipeline
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=session_factory.return_value)

    def test_load_rag_pipeline_uses_provided_session(self, mocker: MockerFixture):
        pipeline = Mock(spec=Pipeline)
        session = Mock(spec=Session)

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )
        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = load_rag_pipeline(session, "pipeline-1")

        assert result is pipeline
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=session)

    def test_pipeline_id_removed_from_kwargs(self, mocker: MockerFixture):
        pipeline = Mock(spec=Pipeline)

        @get_rag_pipeline
        def dummy_view(**kwargs):
            assert "pipeline_id" not in kwargs
            return "ok"

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )

        session_factory = mocker.patch("controllers.console.datasets.wraps.db.session")
        mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = dummy_view(pipeline_id="pipeline-1")

        assert result == "ok"

    def test_pipeline_id_cast_to_string(self, mocker: MockerFixture):
        pipeline = Mock(spec=Pipeline)

        @get_rag_pipeline
        def dummy_view(**kwargs):
            return kwargs["pipeline"]

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(Mock(), "tenant-1"),
        )

        session_factory = mocker.patch("controllers.console.datasets.wraps.db.session")
        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = dummy_view(pipeline_id=123)

        assert result is pipeline
        get_pipeline_by_id.assert_called_once_with("123", "tenant-1", session=session_factory.return_value)
