import types
from collections.abc import Generator

import pytest
from pytest_mock import MockerFixture

from contexts.wrapper import RecyclableContextVar
from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import DatasourceMessage, DatasourceProviderType
from core.datasource.errors import DatasourceProviderNotFoundError
from core.workflow.file_reference import parse_file_reference
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.node_events import StreamChunkEvent, StreamCompletedEvent


def _gen_messages_text_only(text: str) -> Generator[DatasourceMessage, None, None]:
    yield DatasourceMessage(
        type=DatasourceMessage.MessageType.TEXT,
        message=DatasourceMessage.TextMessage(text=text),
        meta=None,
    )


def _drain_generator(gen: Generator[DatasourceMessage, None, object]) -> tuple[list[DatasourceMessage], object | None]:
    messages: list[DatasourceMessage] = []
    try:
        while True:
            messages.append(next(gen))
    except StopIteration as e:
        return messages, e.value


def _invalidate_recyclable_contextvars() -> None:
    """
    Ensure RecyclableContextVar.get() raises LookupError until reset by code under test.
    """
    RecyclableContextVar.increment_thread_recycles()


def test_get_icon_url_calls_runtime(mocker: MockerFixture):
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


def test_get_datasource_runtime_delegates_to_provider_controller(mocker: MockerFixture):
    provider_controller = mocker.Mock()
    provider_controller.get_datasource.return_value = object()
    mocker.patch.object(DatasourceManager, "get_datasource_plugin_provider", return_value=provider_controller)

    runtime = DatasourceManager.get_datasource_runtime(
        provider_id="prov/x",
        datasource_name="ds",
        tenant_id="t1",
        datasource_type=DatasourceProviderType.ONLINE_DOCUMENT,
    )
    assert runtime is provider_controller.get_datasource.return_value
    provider_controller.get_datasource.assert_called_once_with("ds")


@pytest.mark.parametrize(
    ("datasource_type", "controller_path"),
    [
        (
            DatasourceProviderType.ONLINE_DOCUMENT,
            "core.datasource.datasource_manager.OnlineDocumentDatasourcePluginProviderController",
        ),
        (
            DatasourceProviderType.ONLINE_DRIVE,
            "core.datasource.datasource_manager.OnlineDriveDatasourcePluginProviderController",
        ),
        (
            DatasourceProviderType.WEBSITE_CRAWL,
            "core.datasource.datasource_manager.WebsiteCrawlDatasourcePluginProviderController",
        ),
        (
            DatasourceProviderType.LOCAL_FILE,
            "core.datasource.datasource_manager.LocalFileDatasourcePluginProviderController",
        ),
    ],
)
def test_get_datasource_plugin_provider_creates_controller_and_caches(mocker, datasource_type, controller_path):
    _invalidate_recyclable_contextvars()

    provider_entity = types.SimpleNamespace(declaration=object(), plugin_id="plugin", plugin_unique_identifier="uniq")
    fetch = mocker.patch(
        "core.datasource.datasource_manager.PluginDatasourceManager.fetch_datasource_provider",
        return_value=provider_entity,
    )
    ctrl_cls = mocker.patch(controller_path)

    first = DatasourceManager.get_datasource_plugin_provider(
        provider_id=f"prov/{datasource_type.value}",
        tenant_id="t1",
        datasource_type=datasource_type,
    )
    second = DatasourceManager.get_datasource_plugin_provider(
        provider_id=f"prov/{datasource_type.value}",
        tenant_id="t1",
        datasource_type=datasource_type,
    )

    assert first is second
    assert fetch.call_count == 1
    assert ctrl_cls.call_count == 1


def test_get_datasource_plugin_provider_raises_when_provider_entity_missing(mocker: MockerFixture):
    _invalidate_recyclable_contextvars()
    mocker.patch(
        "core.datasource.datasource_manager.PluginDatasourceManager.fetch_datasource_provider",
        return_value=None,
    )

    with pytest.raises(DatasourceProviderNotFoundError, match="plugin provider prov/notfound not found"):
        DatasourceManager.get_datasource_plugin_provider(
            provider_id="prov/notfound",
            tenant_id="t1",
            datasource_type=DatasourceProviderType.ONLINE_DOCUMENT,
        )


def test_get_datasource_plugin_provider_raises_for_unsupported_type(mocker: MockerFixture):
    _invalidate_recyclable_contextvars()
    provider_entity = types.SimpleNamespace(declaration=object(), plugin_id="plugin", plugin_unique_identifier="uniq")
    mocker.patch(
        "core.datasource.datasource_manager.PluginDatasourceManager.fetch_datasource_provider",
        return_value=provider_entity,
    )

    with pytest.raises(ValueError, match="Unsupported datasource type"):
        DatasourceManager.get_datasource_plugin_provider(
            provider_id="prov/x",
            tenant_id="t1",
            datasource_type=types.SimpleNamespace(),  # not a DatasourceProviderType at runtime
        )


def test_get_datasource_plugin_provider_raises_when_controller_none(mocker: MockerFixture):
    _invalidate_recyclable_contextvars()
    provider_entity = types.SimpleNamespace(declaration=object(), plugin_id="plugin", plugin_unique_identifier="uniq")
    mocker.patch(
        "core.datasource.datasource_manager.PluginDatasourceManager.fetch_datasource_provider",
        return_value=provider_entity,
    )
    mocker.patch(
        "core.datasource.datasource_manager.OnlineDocumentDatasourcePluginProviderController",
        return_value=None,
    )

    with pytest.raises(DatasourceProviderNotFoundError, match="Datasource provider prov/x not found"):
        DatasourceManager.get_datasource_plugin_provider(
            provider_id="prov/x",
            tenant_id="t1",
            datasource_type=DatasourceProviderType.ONLINE_DOCUMENT,
        )


def test_stream_online_results_yields_messages_online_document(mocker: MockerFixture):
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


def test_stream_online_results_sets_credentials_and_returns_empty_dict_online_document(mocker: MockerFixture):
    class _Runtime:
        def __init__(self) -> None:
            self.runtime = types.SimpleNamespace(credentials=None)

        def get_online_document_page_content(self, **_kwargs):
            yield from _gen_messages_text_only("hello")

    runtime = _Runtime()
    mocker.patch.object(DatasourceManager, "get_datasource_runtime", return_value=runtime)
    mocker.patch(
        "core.datasource.datasource_manager.DatasourceProviderService.get_datasource_credentials",
        return_value={"token": "t"},
    )

    gen = DatasourceManager.stream_online_results(
        user_id="u1",
        datasource_name="ds",
        datasource_type="online_document",
        provider_id="p/x",
        tenant_id="t1",
        provider="prov",
        plugin_id="plug",
        credential_id="cred",
        datasource_param=types.SimpleNamespace(workspace_id="w", page_id="pg", type="t"),
        online_drive_request=None,
    )
    messages, final_value = _drain_generator(gen)

    assert runtime.runtime.credentials == {"token": "t"}
    assert [m.message.text for m in messages] == ["hello"]
    assert final_value == {}


def test_stream_online_results_raises_when_missing_params(mocker: MockerFixture):
    class _Runtime:
        def __init__(self) -> None:
            self.runtime = types.SimpleNamespace(credentials=None)

        def get_online_document_page_content(self, **_kwargs):
            yield from _gen_messages_text_only("never")

        def online_drive_download_file(self, **_kwargs):
            yield from _gen_messages_text_only("never")

    mocker.patch.object(DatasourceManager, "get_datasource_runtime", return_value=_Runtime())
    mocker.patch(
        "core.datasource.datasource_manager.DatasourceProviderService.get_datasource_credentials",
        return_value={},
    )

    with pytest.raises(ValueError, match="datasource_param is required for ONLINE_DOCUMENT streaming"):
        list(
            DatasourceManager.stream_online_results(
                user_id="u1",
                datasource_name="ds",
                datasource_type="online_document",
                provider_id="p/x",
                tenant_id="t1",
                provider="prov",
                plugin_id="plug",
                credential_id="",
                datasource_param=None,
                online_drive_request=None,
            )
        )

    with pytest.raises(ValueError, match="online_drive_request is required for ONLINE_DRIVE streaming"):
        list(
            DatasourceManager.stream_online_results(
                user_id="u1",
                datasource_name="ds",
                datasource_type="online_drive",
                provider_id="p/x",
                tenant_id="t1",
                provider="prov",
                plugin_id="plug",
                credential_id="",
                datasource_param=None,
                online_drive_request=None,
            )
        )


def test_stream_online_results_yields_messages_and_returns_empty_dict_online_drive(mocker: MockerFixture):
    class _Runtime:
        def __init__(self) -> None:
            self.runtime = types.SimpleNamespace(credentials=None)

        def online_drive_download_file(self, **_kwargs):
            yield from _gen_messages_text_only("drive")

    runtime = _Runtime()
    mocker.patch.object(DatasourceManager, "get_datasource_runtime", return_value=runtime)
    mocker.patch(
        "core.datasource.datasource_manager.DatasourceProviderService.get_datasource_credentials",
        return_value={"token": "t"},
    )

    gen = DatasourceManager.stream_online_results(
        user_id="u1",
        datasource_name="ds",
        datasource_type="online_drive",
        provider_id="p/x",
        tenant_id="t1",
        provider="prov",
        plugin_id="plug",
        credential_id="cred",
        datasource_param=None,
        online_drive_request=types.SimpleNamespace(id="fid", bucket="b"),
    )
    messages, final_value = _drain_generator(gen)

    assert runtime.runtime.credentials == {"token": "t"}
    assert [m.message.text for m in messages] == ["drive"]
    assert final_value == {}


def test_stream_online_results_raises_for_unsupported_stream_type(mocker: MockerFixture):
    mocker.patch.object(DatasourceManager, "get_datasource_runtime", return_value=mocker.Mock())
    mocker.patch(
        "core.datasource.datasource_manager.DatasourceProviderService.get_datasource_credentials",
        return_value={},
    )

    with pytest.raises(ValueError, match="Unsupported datasource type for streaming"):
        list(
            DatasourceManager.stream_online_results(
                user_id="u1",
                datasource_name="ds",
                datasource_type="website_crawl",
                provider_id="p/x",
                tenant_id="t1",
                provider="prov",
                plugin_id="plug",
                credential_id="",
                datasource_param=None,
                online_drive_request=None,
            )
        )


def test_stream_node_events_emits_events_online_document(mocker: MockerFixture):
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


def test_stream_node_events_builds_file_and_variables_from_messages(mocker: MockerFixture):
    mocker.patch.object(DatasourceManager, "stream_online_results", return_value=_gen_messages_text_only("ignored"))

    def _transformed(**_kwargs):
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.IMAGE_LINK,
            message=DatasourceMessage.TextMessage(text="/files/datasources/tool_file_1.png"),
            meta={},
        )
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.TEXT,
            message=DatasourceMessage.TextMessage(text="hello"),
            meta=None,
        )
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.LINK,
            message=DatasourceMessage.TextMessage(text="http://example.com"),
            meta=None,
        )
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.VARIABLE,
            message=DatasourceMessage.VariableMessage(variable_name="v", variable_value="a", stream=True),
            meta=None,
        )
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.VARIABLE,
            message=DatasourceMessage.VariableMessage(variable_name="v", variable_value="b", stream=True),
            meta=None,
        )
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.VARIABLE,
            message=DatasourceMessage.VariableMessage(variable_name="x", variable_value=1, stream=False),
            meta=None,
        )
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.JSON,
            message=DatasourceMessage.JsonMessage(json_object={"k": "v"}),
            meta=None,
        )

    mocker.patch(
        "core.datasource.datasource_manager.DatasourceFileMessageTransformer.transform_datasource_invoke_messages",
        side_effect=_transformed,
    )

    fake_tool_file = types.SimpleNamespace(mimetype="image/png")

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def scalar(self, _stmt):
            return fake_tool_file

    mocker.patch("core.datasource.datasource_manager.session_factory.create_session", return_value=_Session())
    mocker.patch("core.datasource.datasource_manager.get_file_type_by_mime_type", return_value=FileType.IMAGE)
    built = File(
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="tool_file_1",
        extension=".png",
        mime_type="image/png",
        storage_key="k",
    )
    build_from_mapping = mocker.patch(
        "core.datasource.datasource_manager.file_factory.build_from_mapping",
        return_value=built,
    )

    variable_pool = mocker.Mock()

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
            datasource_info={"info": "x"},
            variable_pool=variable_pool,
            datasource_param=types.SimpleNamespace(workspace_id="w", page_id="pg", type="t"),
            online_drive_request=None,
        )
    )

    build_from_mapping.assert_called_once()
    variable_pool.add.assert_not_called()

    assert any(isinstance(e, StreamChunkEvent) and e.chunk == "hello" for e in events)
    assert any(isinstance(e, StreamChunkEvent) and e.chunk.startswith("Link: http") for e in events)
    assert any(isinstance(e, StreamChunkEvent) and e.selector == ["nodeA", "v"] and e.chunk == "a" for e in events)
    assert any(isinstance(e, StreamChunkEvent) and e.selector == ["nodeA", "v"] and e.chunk == "b" for e in events)
    assert isinstance(events[-2], StreamChunkEvent)
    assert events[-2].is_final is True

    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.outputs["v"] == "ab"
    assert events[-1].node_run_result.outputs["x"] == 1


def test_stream_node_events_raises_when_toolfile_missing(mocker: MockerFixture):
    mocker.patch.object(DatasourceManager, "stream_online_results", return_value=_gen_messages_text_only("ignored"))

    def _transformed(**_kwargs):
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.IMAGE_LINK,
            message=DatasourceMessage.TextMessage(text="/files/datasources/missing.png"),
            meta={},
        )

    mocker.patch(
        "core.datasource.datasource_manager.DatasourceFileMessageTransformer.transform_datasource_invoke_messages",
        side_effect=_transformed,
    )

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def scalar(self, _stmt):
            return None

    mocker.patch("core.datasource.datasource_manager.session_factory.create_session", return_value=_Session())

    with pytest.raises(ValueError, match="ToolFile not found for file_id=missing, tenant_id=t1"):
        list(
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
                parameters_for_log={},
                datasource_info={},
                variable_pool=mocker.Mock(),
                datasource_param=types.SimpleNamespace(workspace_id="w", page_id="pg", type="t"),
                online_drive_request=None,
            )
        )


def test_stream_node_events_online_drive_sets_variable_pool_file_and_outputs(mocker: MockerFixture):
    mocker.patch.object(DatasourceManager, "stream_online_results", return_value=_gen_messages_text_only("ignored"))

    file_in = File(
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="tf",
        extension=".pdf",
        mime_type="application/pdf",
        storage_key="k",
    )

    def _transformed(**_kwargs):
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.FILE,
            message=DatasourceMessage.FileMessage(file_marker="file_marker"),
            meta={"file": file_in},
        )

    mocker.patch(
        "core.datasource.datasource_manager.DatasourceFileMessageTransformer.transform_datasource_invoke_messages",
        side_effect=_transformed,
    )

    variable_pool = mocker.Mock()
    events = list(
        DatasourceManager.stream_node_events(
            node_id="nodeA",
            user_id="u1",
            datasource_name="ds",
            datasource_type="online_drive",
            provider_id="p/x",
            tenant_id="t1",
            provider="prov",
            plugin_id="plug",
            credential_id="",
            parameters_for_log={},
            datasource_info={"k": "v"},
            variable_pool=variable_pool,
            datasource_param=None,
            online_drive_request=types.SimpleNamespace(id="id", bucket="b"),
        )
    )

    variable_pool.add.assert_called_once()
    assert variable_pool.add.call_args[0][0] == ["nodeA", "file"]
    assert variable_pool.add.call_args[0][1] == file_in

    completed = events[-1]
    assert isinstance(completed, StreamCompletedEvent)
    assert completed.node_run_result.outputs["file"] == file_in
    assert completed.node_run_result.outputs["datasource_type"] == DatasourceProviderType.ONLINE_DRIVE


def test_stream_node_events_skips_file_build_for_non_online_types(mocker: MockerFixture):
    mocker.patch.object(DatasourceManager, "stream_online_results", return_value=_gen_messages_text_only("ignored"))

    def _transformed(**_kwargs):
        yield DatasourceMessage(
            type=DatasourceMessage.MessageType.IMAGE_LINK,
            message=DatasourceMessage.TextMessage(text="/files/datasources/tool_file_1.png"),
            meta={},
        )

    mocker.patch(
        "core.datasource.datasource_manager.DatasourceFileMessageTransformer.transform_datasource_invoke_messages",
        side_effect=_transformed,
    )
    build_from_mapping = mocker.patch("core.datasource.datasource_manager.file_factory.build_from_mapping")

    events = list(
        DatasourceManager.stream_node_events(
            node_id="nodeA",
            user_id="u1",
            datasource_name="ds",
            datasource_type="website_crawl",
            provider_id="p/x",
            tenant_id="t1",
            provider="prov",
            plugin_id="plug",
            credential_id="",
            parameters_for_log={},
            datasource_info={},
            variable_pool=mocker.Mock(),
            datasource_param=None,
            online_drive_request=None,
        )
    )

    build_from_mapping.assert_not_called()
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.outputs["file"] is None


def test_get_upload_file_by_id_builds_file(mocker: MockerFixture):
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

    class _S:
        def __init__(self, row):
            self._row = row

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def scalar(self, *_args, **_kwargs):
            return self._row

    mocker.patch("core.datasource.datasource_manager.session_factory.create_session", return_value=_S(fake_row))

    f = DatasourceManager.get_upload_file_by_id(file_id="fid", tenant_id="t1")
    assert f.related_id == "fid"
    assert f.extension == ".txt"
    assert parse_file_reference(f.reference).storage_key is None
    assert f.storage_key == "k"


def test_get_upload_file_by_id_raises_when_missing(mocker: MockerFixture):
    class _S:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def scalar(self, *_args, **_kwargs):
            return None

    mocker.patch("core.datasource.datasource_manager.session_factory.create_session", return_value=_S())

    with pytest.raises(ValueError, match="UploadFile not found for file_id=fid, tenant_id=t1"):
        DatasourceManager.get_upload_file_by_id(file_id="fid", tenant_id="t1")
