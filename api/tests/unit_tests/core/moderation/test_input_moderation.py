from unittest.mock import MagicMock, patch

import pytest

from core.app.app_config.entities import AppConfig, SensitiveWordAvoidanceEntity
from core.moderation.base import ModerationAction, ModerationError, ModerationInputsResult
from core.moderation.input_moderation import InputModeration
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager


class TestInputModeration:
    @pytest.fixture
    def app_config(self):
        config = MagicMock(spec=AppConfig)
        config.sensitive_word_avoidance = None
        return config

    @pytest.fixture
    def input_moderation(self):
        return InputModeration()

    def test_check_no_sensitive_word_avoidance(self, app_config, input_moderation):
        app_id = "test_app_id"
        tenant_id = "test_tenant_id"
        inputs = {"input_key": "input_value"}
        query = "test query"
        message_id = "test_message_id"

        flagged, final_inputs, final_query = input_moderation.check(
            app_id=app_id, tenant_id=tenant_id, app_config=app_config, inputs=inputs, query=query, message_id=message_id
        )

        assert flagged is False
        assert final_inputs == inputs
        assert final_query == query

    @patch("core.moderation.input_moderation.ModerationFactory")
    def test_check_not_flagged(self, mock_factory_cls, app_config, input_moderation):
        app_id = "test_app_id"
        tenant_id = "test_tenant_id"
        inputs = {"input_key": "input_value"}
        query = "test query"
        message_id = "test_message_id"

        # Setup config
        sensitive_word_config = MagicMock(spec=SensitiveWordAvoidanceEntity)
        sensitive_word_config.type = "keywords"
        sensitive_word_config.config = {"keywords": ["bad"]}
        app_config.sensitive_word_avoidance = sensitive_word_config

        # Setup factory mock
        mock_factory = mock_factory_cls.return_value
        mock_result = ModerationInputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)
        mock_factory.moderation_for_inputs.return_value = mock_result

        flagged, final_inputs, final_query = input_moderation.check(
            app_id=app_id, tenant_id=tenant_id, app_config=app_config, inputs=inputs, query=query, message_id=message_id
        )

        assert flagged is False
        assert final_inputs == inputs
        assert final_query == query
        mock_factory_cls.assert_called_once_with(
            name="keywords", app_id=app_id, tenant_id=tenant_id, config={"keywords": ["bad"]}
        )
        mock_factory.moderation_for_inputs.assert_called_once_with(dict(inputs), query)

    @patch("core.moderation.input_moderation.ModerationFactory")
    @patch("core.moderation.input_moderation.TraceTask")
    def test_check_with_trace_manager(self, mock_trace_task, mock_factory_cls, app_config, input_moderation):
        app_id = "test_app_id"
        tenant_id = "test_tenant_id"
        inputs = {"input_key": "input_value"}
        query = "test query"
        message_id = "test_message_id"
        trace_manager = MagicMock(spec=TraceQueueManager)

        # Setup config
        sensitive_word_config = MagicMock(spec=SensitiveWordAvoidanceEntity)
        sensitive_word_config.type = "keywords"
        sensitive_word_config.config = {}
        app_config.sensitive_word_avoidance = sensitive_word_config

        # Setup factory mock
        mock_factory = mock_factory_cls.return_value
        mock_result = ModerationInputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)
        mock_factory.moderation_for_inputs.return_value = mock_result

        input_moderation.check(
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_config,
            inputs=inputs,
            query=query,
            message_id=message_id,
            trace_manager=trace_manager,
        )

        trace_manager.add_trace_task.assert_called_once_with(mock_trace_task.return_value)
        mock_trace_task.assert_called_once()
        call_kwargs = mock_trace_task.call_args.kwargs
        call_args = mock_trace_task.call_args.args
        assert call_args[0] == TraceTaskName.MODERATION_TRACE
        assert call_kwargs["message_id"] == message_id
        assert call_kwargs["moderation_result"] == mock_result
        assert call_kwargs["inputs"] == inputs
        assert "timer" in call_kwargs

    @patch("core.moderation.input_moderation.ModerationFactory")
    def test_check_flagged_direct_output(self, mock_factory_cls, app_config, input_moderation):
        app_id = "test_app_id"
        tenant_id = "test_tenant_id"
        inputs = {"input_key": "input_value"}
        query = "test query"
        message_id = "test_message_id"

        # Setup config
        sensitive_word_config = MagicMock(spec=SensitiveWordAvoidanceEntity)
        sensitive_word_config.type = "keywords"
        sensitive_word_config.config = {}
        app_config.sensitive_word_avoidance = sensitive_word_config

        # Setup factory mock
        mock_factory = mock_factory_cls.return_value
        mock_result = ModerationInputsResult(
            flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked content"
        )
        mock_factory.moderation_for_inputs.return_value = mock_result

        with pytest.raises(ModerationError) as excinfo:
            input_moderation.check(
                app_id=app_id,
                tenant_id=tenant_id,
                app_config=app_config,
                inputs=inputs,
                query=query,
                message_id=message_id,
            )

        assert str(excinfo.value) == "Blocked content"

    @patch("core.moderation.input_moderation.ModerationFactory")
    def test_check_flagged_overridden(self, mock_factory_cls, app_config, input_moderation):
        app_id = "test_app_id"
        tenant_id = "test_tenant_id"
        inputs = {"input_key": "input_value"}
        query = "test query"
        message_id = "test_message_id"

        # Setup config
        sensitive_word_config = MagicMock(spec=SensitiveWordAvoidanceEntity)
        sensitive_word_config.type = "keywords"
        sensitive_word_config.config = {}
        app_config.sensitive_word_avoidance = sensitive_word_config

        # Setup factory mock
        mock_factory = mock_factory_cls.return_value
        mock_result = ModerationInputsResult(
            flagged=True,
            action=ModerationAction.OVERRIDDEN,
            inputs={"input_key": "overridden_value"},
            query="overridden query",
        )
        mock_factory.moderation_for_inputs.return_value = mock_result

        flagged, final_inputs, final_query = input_moderation.check(
            app_id=app_id, tenant_id=tenant_id, app_config=app_config, inputs=inputs, query=query, message_id=message_id
        )

        assert flagged is True
        assert final_inputs == {"input_key": "overridden_value"}
        assert final_query == "overridden query"

    @patch("core.moderation.input_moderation.ModerationFactory")
    def test_check_flagged_other_action(self, mock_factory_cls, app_config, input_moderation):
        app_id = "test_app_id"
        tenant_id = "test_tenant_id"
        inputs = {"input_key": "input_value"}
        query = "test query"
        message_id = "test_message_id"

        # Setup config
        sensitive_word_config = MagicMock(spec=SensitiveWordAvoidanceEntity)
        sensitive_word_config.type = "keywords"
        sensitive_word_config.config = {}
        app_config.sensitive_word_avoidance = sensitive_word_config

        # Setup factory mock
        mock_factory = mock_factory_cls.return_value
        mock_result = MagicMock()
        mock_result.flagged = True
        mock_result.action = "NONE"  # Some other action
        mock_factory.moderation_for_inputs.return_value = mock_result

        flagged, final_inputs, final_query = input_moderation.check(
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_config,
            inputs=inputs,
            query=query,
            message_id=message_id,
        )

        assert flagged is True
        assert final_inputs == inputs
        assert final_query == query
