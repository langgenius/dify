import pytest
from graphon.model_runtime.entities.llm_entities import LLMResult

import core.app.apps.pipeline.pipeline_queue_manager as module
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.pipeline.pipeline_queue_manager import PipelineQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowSucceededEvent,
)


def test_publish_sets_stop_listen_and_raises_on_stopped(mocker):
    manager = PipelineQueueManager(task_id="t", user_id="u", invoke_from=InvokeFrom.WEB_APP, app_mode="rag")
    manager._q = mocker.MagicMock()
    manager.stop_listen = mocker.MagicMock()
    manager._is_stopped = mocker.MagicMock(return_value=True)

    with pytest.raises(GenerateTaskStoppedError):
        manager._publish(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL), PublishFrom.APPLICATION_MANAGER)

    manager.stop_listen.assert_called_once()


def test_publish_stop_events_trigger_stop_listen(mocker):
    manager = PipelineQueueManager(task_id="t", user_id="u", invoke_from=InvokeFrom.WEB_APP, app_mode="rag")
    manager._q = mocker.MagicMock()
    manager.stop_listen = mocker.MagicMock()
    manager._is_stopped = mocker.MagicMock(return_value=False)

    for event in [
        QueueErrorEvent(error=ValueError("bad")),
        QueueMessageEndEvent(llm_result=LLMResult.model_construct()),
        QueueWorkflowSucceededEvent(),
        QueueWorkflowFailedEvent(error="failed", exceptions_count=1),
        QueueWorkflowPartialSuccessEvent(exceptions_count=1),
    ]:
        manager.stop_listen.reset_mock()
        manager._publish(event, PublishFrom.TASK_PIPELINE)
        manager.stop_listen.assert_called_once()


def test_publish_non_stop_event_no_stop_listen(mocker):
    manager = PipelineQueueManager(task_id="t", user_id="u", invoke_from=InvokeFrom.WEB_APP, app_mode="rag")
    manager._q = mocker.MagicMock()
    manager.stop_listen = mocker.MagicMock()
    manager._is_stopped = mocker.MagicMock(return_value=False)

    non_stop_event = mocker.MagicMock(spec=module.AppQueueEvent)
    manager._publish(non_stop_event, PublishFrom.TASK_PIPELINE)
    manager.stop_listen.assert_not_called()
