from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.trace_entity import FeedbackTraceInfo, TraceTaskName, trace_info_info_map


class TestFeedbackTraceInfo:
    def test_create_with_like_rating(self):
        info = FeedbackTraceInfo(
            message_id="msg-123",
            rating="like",
            content="Great answer!",
            from_source="user",
            metadata={"message_id": "msg-123", "from_source": "user"},
        )
        assert info.rating == "like"
        assert info.content == "Great answer!"
        assert info.from_source == "user"
        assert info.message_id == "msg-123"

    def test_create_with_dislike_rating(self):
        info = FeedbackTraceInfo(
            message_id="msg-456",
            rating="dislike",
            from_source="admin",
            metadata={"message_id": "msg-456", "from_source": "admin"},
        )
        assert info.rating == "dislike"
        assert info.content is None
        assert info.from_source == "admin"

    def test_serialization_roundtrip(self):
        info = FeedbackTraceInfo(
            message_id="msg-789",
            rating="like",
            content="Helpful",
            from_source="user",
            metadata={"message_id": "msg-789", "from_source": "user"},
        )
        dumped = info.model_dump()
        restored = FeedbackTraceInfo(**dumped)
        assert restored.rating == info.rating
        assert restored.content == info.content
        assert restored.from_source == info.from_source
        assert restored.message_id == info.message_id

    def test_registered_in_trace_info_map(self):
        assert "FeedbackTraceInfo" in trace_info_info_map
        assert trace_info_info_map["FeedbackTraceInfo"] is FeedbackTraceInfo


class TestTraceTaskNameEnum:
    def test_feedback_trace_enum_value(self):
        assert TraceTaskName.FEEDBACK_TRACE == "feedback"
        assert TraceTaskName.FEEDBACK_TRACE.value == "feedback"


class TestTraceTaskFeedbackTrace:
    def test_feedback_trace_builds_correct_info(self):
        from core.ops.ops_trace_manager import TraceTask

        task = TraceTask(
            trace_type=TraceTaskName.FEEDBACK_TRACE,
            message_id="msg-abc",
            rating="like",
            content="Nice!",
            from_source="user",
        )
        result = task.execute()
        assert isinstance(result, FeedbackTraceInfo)
        assert result.message_id == "msg-abc"
        assert result.rating == "like"
        assert result.content == "Nice!"
        assert result.from_source == "user"

    def test_feedback_trace_dislike(self):
        from core.ops.ops_trace_manager import TraceTask

        task = TraceTask(
            trace_type=TraceTaskName.FEEDBACK_TRACE,
            message_id="msg-def",
            rating="dislike",
            content=None,
            from_source="admin",
        )
        result = task.execute()
        assert isinstance(result, FeedbackTraceInfo)
        assert result.rating == "dislike"
        assert result.content is None
        assert result.from_source == "admin"

    def test_feedback_trace_no_message_id_returns_empty(self):
        from core.ops.ops_trace_manager import TraceTask

        task = TraceTask(
            trace_type=TraceTaskName.FEEDBACK_TRACE,
            message_id=None,
            rating="like",
            from_source="user",
        )
        result = task.execute()
        assert result == {}


class TestLangFuseDataTraceFeedback:
    def _make_trace_instance(self):
        with patch("core.ops.langfuse_trace.langfuse_trace.Langfuse") as mock_langfuse_cls:
            mock_client = MagicMock()
            mock_langfuse_cls.return_value = mock_client

            from core.ops.entities.config_entity import LangfuseConfig
            from core.ops.langfuse_trace.langfuse_trace import LangFuseDataTrace

            config = LangfuseConfig(
                public_key="pk-test",
                secret_key="sk-test",
                host="https://langfuse.example.com",
                project_key="proj-test",
            )
            trace_instance = LangFuseDataTrace(config)
            return trace_instance, mock_client

    def test_feedback_trace_like_calls_score(self):
        trace_instance, mock_client = self._make_trace_instance()

        info = FeedbackTraceInfo(
            message_id="msg-100",
            rating="like",
            content="Excellent!",
            from_source="user",
            metadata={"message_id": "msg-100", "from_source": "user"},
        )

        trace_instance.feedback_trace(info)

        mock_client.score.assert_called_once_with(
            name="user-feedback",
            value=1.0,
            trace_id="msg-100",
            comment="Excellent!",
            data_type="BOOLEAN",
        )

    def test_feedback_trace_dislike_calls_score(self):
        trace_instance, mock_client = self._make_trace_instance()

        info = FeedbackTraceInfo(
            message_id="msg-200",
            rating="dislike",
            content=None,
            from_source="admin",
            metadata={"message_id": "msg-200", "from_source": "admin"},
        )

        trace_instance.feedback_trace(info)

        mock_client.score.assert_called_once_with(
            name="user-feedback",
            value=0.0,
            trace_id="msg-200",
            comment=None,
            data_type="BOOLEAN",
        )

    def test_feedback_trace_dispatched_via_trace_method(self):
        trace_instance, mock_client = self._make_trace_instance()

        info = FeedbackTraceInfo(
            message_id="msg-300",
            rating="like",
            content=None,
            from_source="user",
            metadata={"message_id": "msg-300", "from_source": "user"},
        )

        trace_instance.trace(info)

        mock_client.score.assert_called_once()

    def test_feedback_trace_score_error_raises_value_error(self):
        trace_instance, mock_client = self._make_trace_instance()
        mock_client.score.side_effect = Exception("network error")

        info = FeedbackTraceInfo(
            message_id="msg-400",
            rating="like",
            content=None,
            from_source="user",
            metadata={"message_id": "msg-400", "from_source": "user"},
        )

        with pytest.raises(ValueError, match="LangFuse Failed to create feedback score"):
            trace_instance.feedback_trace(info)
