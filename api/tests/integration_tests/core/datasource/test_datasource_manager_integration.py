from collections.abc import Generator

from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import DatasourceMessage
from core.workflow.node_events import StreamCompletedEvent


def _gen_var_stream() -> Generator[DatasourceMessage, None, None]:
    # produce a streamed variable "a"="xy"
    yield DatasourceMessage(
        type=DatasourceMessage.MessageType.VARIABLE,
        message=DatasourceMessage.VariableMessage(variable_name="a", variable_value="x", stream=True),
        meta=None,
    )
    yield DatasourceMessage(
        type=DatasourceMessage.MessageType.VARIABLE,
        message=DatasourceMessage.VariableMessage(variable_name="a", variable_value="y", stream=True),
        meta=None,
    )


def test_stream_node_events_accumulates_variables(mocker):
    mocker.patch.object(DatasourceManager, "stream_online_results", return_value=_gen_var_stream())
    events = list(
        DatasourceManager.stream_node_events(
            node_id="A",
            user_id="u",
            datasource_name="ds",
            datasource_type="online_document",
            provider_id="p/x",
            tenant_id="t",
            provider="prov",
            plugin_id="plug",
            credential_id="",
            parameters_for_log={},
            datasource_info={"user_id": "u"},
            variable_pool=mocker.Mock(),
            datasource_param=type("P", (), {"workspace_id": "w", "page_id": "pg", "type": "t"})(),
            online_drive_request=None,
        )
    )
    assert isinstance(events[-1], StreamCompletedEvent)
