from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from core.app.entities.queue_entities import QueueMessageFileEvent
from core.app.entities.task_entities import MessageFileStreamResponse, StreamEvent
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.file import FileTransferMethod


class _FakeSession:
    def __init__(self, row):
        self._row = row

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, *_args, **_kwargs):
        class _Result:
            def __init__(self, row):
                self._row = row

            def first(self):
                return self._row

        return _Result(self._row)


@pytest.fixture
def manager():
    # minimal generate entity for MessageCycleManager
    application_generate_entity = SimpleNamespace(task_id="task-1")
    task_state = SimpleNamespace()
    return MessageCycleManager(
        application_generate_entity=application_generate_entity,
        task_state=task_state,
    )


def _build_message_file(
    *,
    id: str = "mf-1",
    type: str = "document",
    belongs_to: str | None = None,
    url: str = "http://host/toolfileid.pptx",
    upload_file_id: str = "tf-1",
    transfer_method: FileTransferMethod = FileTransferMethod.TOOL_FILE,
):
    return SimpleNamespace(
        id=id,
        type=type,
        belongs_to=belongs_to,
        url=url,
        upload_file_id=upload_file_id,
        transfer_method=transfer_method,
    )


def _build_tool_file(
    *,
    id: str = "tf-1",
    mimetype: str = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    name: str = "slides.pptx",
    size: int = 1234,
):
    return SimpleNamespace(id=id, mimetype=mimetype, name=name, size=size)


def test_message_file_tool_file_http_url(manager, monkeypatch):
    """
    TOOL_FILE with http url should keep url unchanged and include ToolFile metadata.
    """
    message_file = _build_message_file(url="http://host/toolfileid.pptx")
    tool_file = _build_tool_file()

    # patch db.engine to avoid Flask app context requirement
    monkeypatch.setattr(
        "core.app.task_pipeline.message_cycle_manager.db",
        SimpleNamespace(engine=object()),
    )
    # patch Session (context manager) to return our tuple row
    monkeypatch.setattr(
        "core.app.task_pipeline.message_cycle_manager.Session",
        lambda *_args, **_kwargs: _FakeSession((message_file, tool_file)),
    )

    event = Mock(spec=QueueMessageFileEvent)
    event.message_file_id = message_file.id

    resp = manager.message_file_to_stream_response(event)

    assert isinstance(resp, MessageFileStreamResponse)
    assert resp.event == StreamEvent.MESSAGE_FILE
    assert resp.id == message_file.id
    # default belongs_to to user when None
    assert resp.belongs_to == "user"
    # keep original http url
    assert resp.url == message_file.url
    assert resp.upload_file_id == message_file.upload_file_id
    assert resp.transfer_method == message_file.transfer_method
    assert resp.mime_type == tool_file.mimetype
    assert resp.filename == tool_file.name
    assert resp.size == tool_file.size
    assert resp.related_id == tool_file.id
    assert resp.extension == ".pptx"


def test_message_file_non_tool_file_sign_and_fallbacks(manager, monkeypatch):
    """
    Non TOOL_FILE should ignore ToolFile and sign local url; fallbacks applied.
    """
    # local file style url without scheme should be signed
    message_file = _build_message_file(
        url="toolfileid.pdf",
        transfer_method=FileTransferMethod.LOCAL_FILE,
        belongs_to="assistant",
    )
    # even provided, should be ignored for non TOOL_FILE
    tool_file = _build_tool_file(
        mimetype="application/pdf",
        name="doc.pdf",
        size=42,
    )

    # patch db.engine to avoid Flask app context requirement
    monkeypatch.setattr(
        "core.app.task_pipeline.message_cycle_manager.db",
        SimpleNamespace(engine=object()),
    )
    # patch Session to return our row
    monkeypatch.setattr(
        "core.app.task_pipeline.message_cycle_manager.Session",
        lambda *_args, **_kwargs: _FakeSession((message_file, tool_file)),
    )

    # patch signer
    with patch(
        "core.app.task_pipeline.message_cycle_manager.sign_tool_file",
        return_value="http://signed/toolfileid.pdf",
    ) as sign_mock:
        event = Mock(spec=QueueMessageFileEvent)
        event.message_file_id = message_file.id

        resp = manager.message_file_to_stream_response(event)

        assert isinstance(resp, MessageFileStreamResponse)
        assert resp.belongs_to == "assistant"
        # should be signed since not an http url
        assert resp.url == "http://signed/toolfileid.pdf"
        # fallbacks when ToolFile ignored
        assert resp.mime_type == "application/octet-stream"
        assert resp.filename == ""
        assert resp.size == 0
        assert resp.related_id is None
        assert resp.extension == ".pdf"
        sign_mock.assert_called_once()
