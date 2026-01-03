from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock

import pytest

from models.model import AppMode
from tasks.app_generate.workflow_execute_task import _publish_streaming_response


@pytest.fixture
def mock_topic(mocker) -> MagicMock:
    topic = MagicMock()
    mocker.patch(
        "tasks.app_generate.workflow_execute_task.MessageBasedAppGenerator.get_response_topic",
        return_value=topic,
    )
    return topic


def test_publish_streaming_response_with_uuid(mock_topic: MagicMock):
    workflow_run_id = uuid.uuid4()
    response_stream = iter([{"event": "foo"}, "ping"])

    _publish_streaming_response(response_stream, workflow_run_id, app_mode=AppMode.ADVANCED_CHAT)

    payloads = [call.args[0] for call in mock_topic.publish.call_args_list]
    assert payloads == [json.dumps({"event": "foo"}).encode(), json.dumps("ping").encode()]


def test_publish_streaming_response_coerces_string_uuid(mock_topic: MagicMock):
    workflow_run_id = uuid.uuid4()
    response_stream = iter([{"event": "bar"}])

    _publish_streaming_response(response_stream, str(workflow_run_id), app_mode=AppMode.ADVANCED_CHAT)

    mock_topic.publish.assert_called_once_with(json.dumps({"event": "bar"}).encode())
