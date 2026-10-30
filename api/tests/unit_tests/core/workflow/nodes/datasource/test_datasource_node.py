import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.datasource.datasource_node import DatasourceNode
from core.workflow.nodes.datasource.entities import DatasourceNodeData
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent


class _VarSeg:
    def __init__(self, v):
        self.value = v


class _VarPool:
    def __init__(self, mapping):
        self._m = mapping

    def get(self, selector):
        d = self._m
        for k in selector:
            d = d[k]
        return _VarSeg(d)

    def add(self, *_args, **_kwargs):
        pass


class _GraphState:
    def __init__(self, var_pool):
        self.variable_pool = var_pool


class _GraphParams:
    workflow_id = "wf-1"
    graph_config = {}
    run_context = {
        DIFY_RUN_CONTEXT_KEY: {
            "tenant_id": "t1",
            "app_id": "app-1",
            "user_id": "u1",
            "user_from": "account",
            "invoke_from": "debugger",
        }
    }
    call_depth = 0


def test_datasource_node_delegates_to_manager_stream(mocker: MockerFixture):
    # prepare sys variables
    sys_vars = {
        "sys": {
            "datasource_type": "online_document",
            "datasource_info": {
                "workspace_id": "w",
                "page": {"page_id": "pg", "type": "t"},
                "credential_id": "",
            },
        }
    }
    var_pool = _VarPool(sys_vars)
    gs = _GraphState(var_pool)
    gp = _GraphParams()

    # stub manager class
    class _Mgr:
        @classmethod
        def get_icon_url(cls, **_):
            return "icon"

        @classmethod
        def stream_node_events(cls, **_):
            yield StreamChunkEvent(selector=["n", "text"], chunk="hi", is_final=False)
            yield StreamCompletedEvent(node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED))

        @classmethod
        def get_upload_file_by_id(cls, **_):
            raise AssertionError("not called")

    mocker.patch("core.workflow.nodes.datasource.datasource_node.DatasourceManager", new=_Mgr)

    node = DatasourceNode(
        node_id="n",
        data=DatasourceNodeData(
            type="datasource",
            version="1",
            title="Datasource",
            provider_type="plugin",
            provider_name="p",
            plugin_id="plug",
            datasource_name="ds",
        ),
        init_params=gp,
        runtime_state=gs,
        datasource_credentials=lambda _tenant, _provider, _plugin, _credential: {},
    )

    evts = list(node._run())
    assert isinstance(evts[0], StreamChunkEvent)
    assert isinstance(evts[-1], StreamCompletedEvent)


@pytest.mark.parametrize(
    ("datasource_info", "expected_file_id"),
    [
        ({"name": "file", "real_file_id": "real-file"}, "real-file"),
        (
            {
                "name": "file",
                "real_file_id": "real-file",
                "reference": build_file_reference(record_id="reference-file"),
                "related_id": "related-file",
            },
            "real-file",
        ),
    ],
)
def test_local_file_uses_shared_persisted_reference_precedence(
    mocker: MockerFixture,
    datasource_info: dict[str, str],
    expected_file_id: str,
) -> None:
    sys_vars = {
        "sys": {
            "datasource_type": "local_file",
            "datasource_info": datasource_info,
        }
    }
    fetched: list[tuple[str, str]] = []

    class _Mgr:
        @classmethod
        def get_icon_url(cls, **_: object) -> str:
            return "icon"

        @classmethod
        def get_upload_file_by_id(cls, *, file_id: str, tenant_id: str) -> dict[str, str]:
            fetched.append((file_id, tenant_id))
            return {"id": file_id}

    mocker.patch("core.workflow.nodes.datasource.datasource_node.DatasourceManager", new=_Mgr)
    node = DatasourceNode(
        node_id="n",
        data=DatasourceNodeData(
            type="datasource",
            version="1",
            title="Datasource",
            provider_type="plugin",
            provider_name="p",
            plugin_id="plug",
            datasource_name="ds",
        ),
        init_params=_GraphParams(),
        runtime_state=_GraphState(_VarPool(sys_vars)),
        datasource_credentials=lambda _tenant, _provider, _plugin, _credential: {},
    )

    events = list(node._run())

    assert fetched == [(expected_file_id, "t1")]
    assert len(events) == 1
    assert isinstance(events[0], StreamCompletedEvent)
