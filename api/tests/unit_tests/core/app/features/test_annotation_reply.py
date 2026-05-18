import logging
from types import SimpleNamespace
from unittest.mock import Mock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature


class TestAnnotationReplyFeature:
    def test_query_returns_none_when_setting_missing(self):
        feature = AnnotationReplyFeature()

        with patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db:
            mock_db.session.scalar.return_value = None

            result = feature.query(
                app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                message=SimpleNamespace(id="msg-1"),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
            )

        assert result is None

    def test_query_returns_none_when_binding_missing(self):
        feature = AnnotationReplyFeature()
        annotation_setting = SimpleNamespace(collection_binding_detail=None)

        with patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db:
            mock_db.session.scalar.return_value = annotation_setting

            result = feature.query(
                app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                message=SimpleNamespace(id="msg-1"),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
            )

        assert result is None

    def test_query_returns_annotation_and_records_history_for_api(self):
        feature = AnnotationReplyFeature()
        annotation_setting = SimpleNamespace(
            score_threshold=None,
            collection_binding_detail=SimpleNamespace(provider_name="prov", model_name="model"),
        )
        dataset_binding = SimpleNamespace(id="binding-1")
        annotation = SimpleNamespace(
            id="ann-1",
            question_text="question",
            content="content",
            account_id="acct-1",
            account=SimpleNamespace(name="Alice"),
        )
        document = SimpleNamespace(metadata={"annotation_id": "ann-1", "score": 0.8})
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [document]

        with (
            patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db,
            patch(
                "core.app.features.annotation_reply.annotation_reply.DatasetCollectionBindingService"
            ) as mock_binding_service,
            patch("core.app.features.annotation_reply.annotation_reply.Vector") as mock_vector,
            patch(
                "core.app.features.annotation_reply.annotation_reply.AppAnnotationService"
            ) as mock_annotation_service,
        ):
            mock_db.session.scalar.return_value = annotation_setting
            mock_binding_service.get_dataset_collection_binding.return_value = dataset_binding
            mock_vector.return_value = vector_instance
            mock_annotation_service.get_annotation_by_id.return_value = annotation

            result = feature.query(
                app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                message=SimpleNamespace(id="msg-1"),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
            )

        assert result == annotation
        mock_annotation_service.add_annotation_history.assert_called_once()
        _, _, _, _, _, _, _, from_source, score = mock_annotation_service.add_annotation_history.call_args[0]
        assert from_source == "api"
        assert score == 0.8

    def test_query_returns_annotation_and_records_history_for_console(self):
        feature = AnnotationReplyFeature()
        annotation_setting = SimpleNamespace(
            score_threshold=0.5,
            collection_binding_detail=SimpleNamespace(provider_name="prov", model_name="model"),
        )
        dataset_binding = SimpleNamespace(id="binding-1")
        annotation = SimpleNamespace(
            id="ann-1",
            question_text="question",
            content="content",
            account_id="acct-1",
            account=None,
        )
        document = SimpleNamespace(metadata={"annotation_id": "ann-1", "score": 0.6})
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [document]

        with (
            patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db,
            patch(
                "core.app.features.annotation_reply.annotation_reply.DatasetCollectionBindingService"
            ) as mock_binding_service,
            patch("core.app.features.annotation_reply.annotation_reply.Vector") as mock_vector,
            patch(
                "core.app.features.annotation_reply.annotation_reply.AppAnnotationService"
            ) as mock_annotation_service,
        ):
            mock_db.session.scalar.return_value = annotation_setting
            mock_binding_service.get_dataset_collection_binding.return_value = dataset_binding
            mock_vector.return_value = vector_instance
            mock_annotation_service.get_annotation_by_id.return_value = annotation

            result = feature.query(
                app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                message=SimpleNamespace(id="msg-1"),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.EXPLORE,
            )

        assert result == annotation
        _, _, _, _, _, _, _, from_source, _ = mock_annotation_service.add_annotation_history.call_args[0]
        assert from_source == "console"

    def test_query_logs_and_returns_none_on_exception(self, caplog):
        feature = AnnotationReplyFeature()
        annotation_setting = SimpleNamespace(
            score_threshold=None,
            collection_binding_detail=SimpleNamespace(provider_name="prov", model_name="model"),
        )

        with (
            patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db,
            patch(
                "core.app.features.annotation_reply.annotation_reply.DatasetCollectionBindingService"
            ) as mock_binding_service,
            patch("core.app.features.annotation_reply.annotation_reply.Vector") as mock_vector,
        ):
            mock_db.session.scalar.return_value = annotation_setting
            mock_binding_service.get_dataset_collection_binding.return_value = SimpleNamespace(id="binding-1")
            mock_vector.return_value.search_by_vector.side_effect = RuntimeError("boom")

            with caplog.at_level(logging.WARNING):
                result = feature.query(
                    app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                    message=SimpleNamespace(id="msg-1"),
                    query="hi",
                    user_id="user-1",
                    invoke_from=InvokeFrom.SERVICE_API,
                )

        assert result is None
        assert "Query annotation failed" in caplog.text
