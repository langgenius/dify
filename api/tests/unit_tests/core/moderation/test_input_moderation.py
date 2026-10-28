from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import ModerationChecked, TraceCorrelation, TraceEvent

from core.app.app_config.entities import AppConfig, SensitiveWordAvoidanceEntity
from core.moderation.base import ModerationAction, ModerationError, ModerationInputsResult
from core.moderation.input_moderation import InputModeration
from models.model import AppMode


class _Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


def _trace_scope(recorder: _Recorder) -> TraceScope:
    return TraceScope(
        emitter=recorder,
        tenant_id="test_tenant_id",
        app_id="test_app_id",
        user_id="test_user_id",
        correlation=TraceCorrelation(external_trace_id=None, session_id=None, parent=None),
    )


class TestInputModeration:
    @pytest.fixture
    def app_config(self):
        return AppConfig(tenant_id="test_tenant_id", app_id="test_app_id", app_mode=AppMode.CHAT)

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
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_config,
            inputs=inputs,
            query=query,
            message_id=message_id,
            trace_scope=None,
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
        sensitive_word_config = SensitiveWordAvoidanceEntity(type="keywords", config={"keywords": ["bad"]})
        app_config.sensitive_word_avoidance = sensitive_word_config

        # Setup factory mock
        mock_factory = mock_factory_cls.return_value
        mock_result = ModerationInputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)
        mock_factory.moderation_for_inputs.return_value = mock_result

        flagged, final_inputs, final_query = input_moderation.check(
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_config,
            inputs=inputs,
            query=query,
            message_id=message_id,
            trace_scope=None,
        )

        assert flagged is False
        assert final_inputs == inputs
        assert final_query == query
        mock_factory_cls.assert_called_once_with(
            name="keywords", app_id=app_id, tenant_id=tenant_id, config={"keywords": ["bad"]}
        )
        mock_factory.moderation_for_inputs.assert_called_once_with(dict(inputs), query)

    def test_check_without_sensitive_word_avoidance_emits_nothing(
        self, app_config: AppConfig, input_moderation: InputModeration
    ) -> None:
        recorder = _Recorder()

        input_moderation.check(
            app_id="test_app_id",
            tenant_id="test_tenant_id",
            app_config=app_config,
            inputs={"input_key": "input_value"},
            query="test query",
            message_id="test_message_id",
            trace_scope=_trace_scope(recorder),
        )

        assert recorder.events == []

    @patch("core.moderation.input_moderation.ModerationFactory")
    def test_check_with_trace_scope_emits_moderation_checked(
        self, mock_factory_cls: MagicMock, app_config: AppConfig, input_moderation: InputModeration
    ) -> None:
        app_config.sensitive_word_avoidance = SensitiveWordAvoidanceEntity(type="keywords", config={})
        mock_factory_cls.return_value.moderation_for_inputs.return_value = ModerationInputsResult(
            flagged=False, action=ModerationAction.DIRECT_OUTPUT
        )
        recorder = _Recorder()

        input_moderation.check(
            app_id="test_app_id",
            tenant_id="test_tenant_id",
            app_config=app_config,
            inputs={"input_key": "input_value", "budget": Decimal("1.5")},
            query="test query",
            message_id="test_message_id",
            trace_scope=_trace_scope(recorder),
        )

        [event] = recorder.events
        payload = event.payload
        assert isinstance(payload, ModerationChecked)
        assert payload == ModerationChecked(
            message_id="test_message_id",
            inputs={"input_key": "input_value", "budget": "1.5"},
            query="",
            flagged=False,
            action="direct_output",
            preset_response="",
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
        assert payload.started_at.utcoffset() == timedelta(0)
        assert payload.ended_at >= payload.started_at

    @patch("core.moderation.input_moderation.ModerationFactory")
    def test_check_flagged_direct_output_emits_before_raising(
        self, mock_factory_cls: MagicMock, app_config: AppConfig, input_moderation: InputModeration
    ) -> None:
        app_config.sensitive_word_avoidance = SensitiveWordAvoidanceEntity(type="keywords", config={})
        mock_factory_cls.return_value.moderation_for_inputs.return_value = ModerationInputsResult(
            flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked content"
        )
        recorder = _Recorder()

        with pytest.raises(ModerationError, match="Blocked content"):
            input_moderation.check(
                app_id="test_app_id",
                tenant_id="test_tenant_id",
                app_config=app_config,
                inputs={"input_key": "input_value"},
                query="test query",
                message_id="test_message_id",
                trace_scope=_trace_scope(recorder),
            )

        [event] = recorder.events
        payload = event.payload
        assert isinstance(payload, ModerationChecked)
        assert payload.flagged is True
        assert payload.action == "direct_output"
        assert payload.preset_response == "Blocked content"

    @patch("core.moderation.input_moderation.ModerationFactory")
    def test_check_flagged_direct_output(self, mock_factory_cls, app_config, input_moderation):
        app_id = "test_app_id"
        tenant_id = "test_tenant_id"
        inputs = {"input_key": "input_value"}
        query = "test query"
        message_id = "test_message_id"

        # Setup config
        sensitive_word_config = SensitiveWordAvoidanceEntity(type="keywords", config={})
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
                trace_scope=None,
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
        sensitive_word_config = SensitiveWordAvoidanceEntity(type="keywords", config={})
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
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_config,
            inputs=inputs,
            query=query,
            message_id=message_id,
            trace_scope=None,
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
        sensitive_word_config = SensitiveWordAvoidanceEntity(type="keywords", config={})
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
            trace_scope=None,
        )

        assert flagged is True
        assert final_inputs == inputs
        assert final_query == query
