import logging
from typing import cast
from unittest.mock import MagicMock, Mock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
from models.account import Account
from models.dataset import DatasetCollectionBinding
from models.model import App, AppAnnotationSetting, Message, MessageAnnotation


def _app_record() -> App:
    app_record = Mock(spec=App)
    app_record.id = "app-1"
    app_record.tenant_id = "tenant-1"
    return cast(App, app_record)


def _message() -> Message:
    message = Mock(spec=Message)
    message.id = "msg-1"
    return cast(Message, message)


def _account(*, name: str) -> Account:
    account = Mock(spec=Account)
    account.name = name
    return cast(Account, account)


def _annotation_setting(
    *,
    score_threshold: float | None,
    collection_binding_detail: DatasetCollectionBinding | None,
) -> AppAnnotationSetting:
    setting = MagicMock(spec=AppAnnotationSetting)
    setting.score_threshold = score_threshold
    setting.collection_binding_detail = collection_binding_detail
    return cast(AppAnnotationSetting, setting)


def _collection_binding_detail() -> DatasetCollectionBinding:
    detail = MagicMock(spec=DatasetCollectionBinding)
    detail.provider_name = "prov"
    detail.model_name = "model"
    return cast(DatasetCollectionBinding, detail)


def _dataset_binding(binding_id: str) -> DatasetCollectionBinding:
    binding = MagicMock(spec=DatasetCollectionBinding)
    binding.id = binding_id
    return cast(DatasetCollectionBinding, binding)


def _message_annotation(
    *,
    account: Account | None,
) -> MessageAnnotation:
    ann = MagicMock(spec=MessageAnnotation)
    ann.id = "ann-1"
    ann.question = "question"
    ann.content = "content"
    ann.question_text = "question"
    ann.account_id = "acct-1"
    ann.account = account
    return cast(MessageAnnotation, ann)


class TestAnnotationReplyFeature:
    def test_query_returns_none_when_setting_missing(self):
        feature = AnnotationReplyFeature()

        with patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db:
            mock_db.session.scalar.return_value = None

            result = feature.query(
                app_record=_app_record(),
                message=_message(),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
            )

        assert result is None

    def test_query_returns_none_when_binding_missing(self):
        feature = AnnotationReplyFeature()
        annotation_setting = _annotation_setting(score_threshold=None, collection_binding_detail=None)

        with patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db:
            mock_db.session.scalar.return_value = annotation_setting

            result = feature.query(
                app_record=_app_record(),
                message=_message(),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
            )

        assert result is None

    def test_query_returns_annotation_and_records_history_for_api(self):
        feature = AnnotationReplyFeature()
        annotation_setting = _annotation_setting(
            score_threshold=None,
            collection_binding_detail=_collection_binding_detail(),
        )
        dataset_binding = _dataset_binding("binding-1")
        annotation = _message_annotation(account=_account(name="Alice"))
        document = MagicMock(metadata={"annotation_id": "ann-1", "score": 0.8})
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
                app_record=_app_record(),
                message=_message(),
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
        annotation_setting = _annotation_setting(
            score_threshold=0.5,
            collection_binding_detail=_collection_binding_detail(),
        )
        dataset_binding = _dataset_binding("binding-1")
        annotation = _message_annotation(account=None)
        document = MagicMock(metadata={"annotation_id": "ann-1", "score": 0.6})
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
                app_record=_app_record(),
                message=_message(),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.EXPLORE,
            )

        assert result == annotation
        _, _, _, _, _, _, _, from_source, _ = mock_annotation_service.add_annotation_history.call_args[0]
        assert from_source == "console"

    def test_query_logs_and_returns_none_on_exception(self, caplog):
        feature = AnnotationReplyFeature()
        annotation_setting = _annotation_setting(
            score_threshold=None,
            collection_binding_detail=_collection_binding_detail(),
        )

        with (
            patch("core.app.features.annotation_reply.annotation_reply.db") as mock_db,
            patch(
                "core.app.features.annotation_reply.annotation_reply.DatasetCollectionBindingService"
            ) as mock_binding_service,
            patch("core.app.features.annotation_reply.annotation_reply.Vector") as mock_vector,
        ):
            mock_db.session.scalar.return_value = annotation_setting
            mock_binding_service.get_dataset_collection_binding.return_value = _dataset_binding("binding-1")
            mock_vector.return_value.search_by_vector.side_effect = RuntimeError("boom")

            with caplog.at_level(logging.WARNING):
                result = feature.query(
                    app_record=_app_record(),
                    message=_message(),
                    query="hi",
                    user_id="user-1",
                    invoke_from=InvokeFrom.SERVICE_API,
                )

        assert result is None
        assert "Query annotation failed" in caplog.text
