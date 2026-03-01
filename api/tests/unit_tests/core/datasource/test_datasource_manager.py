import types
from collections.abc import Generator

from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import DatasourceMessage
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.node_events import StreamChunkEvent, StreamCompletedEvent


def _gen_messages_text_only(text: str) -> Generator[DatasourceMessage, None, None]:
    yield DatasourceMessage(
        type=DatasourceMessage.MessageType.TEXT,
        message=DatasourceMessage.TextMessage(text=text),
        meta=None,
    )


def test_get_icon_url_calls_runtime(mocker):
    fake_runtime = mocker.Mock()
    fake_runtime.get_icon_url.return_value = "https://icon"
    mocker.patch.object(DatasourceManager, "get_datasource_runtime", return_value=fake_runtime)

    url = DatasourceManager.get_icon_url(
        provider_id="p/x",
        tenant_id="t1",
        datasource_name="ds",
        datasource_type="online_document",
    )
    assert url == "https://icon"
    DatasourceManager.get_datasource_runtime.assert_called_once()


def test_stream_online_results_yields_messages_online_document(mocker):
    # stub runtime to yield a text message
    def _doc_messages(**_):
        yield from _gen_messages_text_only("hello")

    fake_runtime = mocker.Mock()
    fake_runtime.get_online_document_page_content.side_effect = _doc_messages
    mocker.patch.object(DatasourceManager, "get_datasource_runtime", return_value=fake_runtime)
    mocker.patch(
        "core.datasource.datasource_manager.DatasourceProviderService.get_datasource_credentials",
        return_value=None,
    )

    gen = DatasourceManager.stream_online_results(
        user_id="u1",
        datasource_name="ds",
        datasource_type="online_document",
        provider_id="p/x",
        tenant_id="t1",
        provider="prov",
        plugin_id="plug",
        credential_id="",
        datasource_param=types.SimpleNamespace(workspace_id="w", page_id="pg", type="t"),
        online_drive_request=None,
    )
    msgs = list(gen)
    assert len(msgs) == 1
    assert msgs[0].message.text == "hello"


def test_stream_node_events_emits_events_online_document(mocker):
    # make manager's low-level stream produce TEXT only
    mocker.patch.object(
        DatasourceManager,
        "stream_online_results",
        return_value=_gen_messages_text_only("hello"),
    )

    events = list(
        DatasourceManager.stream_node_events(
            node_id="nodeA",
            user_id="u1",
            datasource_name="ds",
            datasource_type="online_document",
            provider_id="p/x",
            tenant_id="t1",
            provider="prov",
            plugin_id="plug",
            credential_id="",
            parameters_for_log={"k": "v"},
            datasource_info={"user_id": "u1"},
            variable_pool=mocker.Mock(),
            datasource_param=types.SimpleNamespace(workspace_id="w", page_id="pg", type="t"),
            online_drive_request=None,
        )
    )
    # should contain one StreamChunkEvent then a final chunk (empty) and a completed event
    assert isinstance(events[0], StreamChunkEvent)
    assert events[0].chunk == "hello"
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED


def test_get_upload_file_by_id_builds_file(mocker):
    # fake UploadFile row
    fake_row = types.SimpleNamespace(
        id="fid",
        name="f",
        extension="txt",
        mime_type="text/plain",
        size=1,
        key="k",
        source_url="http://x",
    )

    class _Q:
        def __init__(self, row):
            self._row = row

        def where(self, *_args, **_kwargs):
            return self

        def first(self):
            return self._row

    class _S:
        def __init__(self, row):
            self._row = row

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def query(self, *_):
            return _Q(self._row)

    mocker.patch("core.datasource.datasource_manager.session_factory.create_session", return_value=_S(fake_row))

    f = DatasourceManager.get_upload_file_by_id(file_id="fid", tenant_id="t1")
    assert f.related_id == "fid"
    assert f.extension == ".txt"
