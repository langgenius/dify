from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
from core.workflow.nodes.datasource.datasource_node import DatasourceNode
from core.workflow.nodes.datasource.entities import DatasourceNodeData
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult, StreamCompletedEvent


class _Seg:
    def __init__(self, v):
        self.value = v


class _VarPool:
    def __init__(self, data):
        self.data = data

    def get(self, path):
        d = self.data
        for k in path:
            d = d[k]
        return _Seg(d)

    def add(self, *_a, **_k):
        pass


class _GS:
    def __init__(self, vp):
        self.variable_pool = vp


class _GP:
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


def test_node_integration_minimal_stream(mocker: MockerFixture):
    sys_d = {
        "sys": {
            "datasource_type": "online_document",
            "datasource_info": {"workspace_id": "w", "page": {"page_id": "pg", "type": "t"}, "credential_id": ""},
        }
    }
    vp = _VarPool(sys_d)

    class _Mgr:
        @classmethod
        def get_icon_url(cls, **_):
            return "icon"

        @classmethod
        def stream_node_events(cls, **_):
            yield from ()
            yield StreamCompletedEvent(node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED))

        @classmethod
        def get_upload_file_by_id(cls, **_):
            raise AssertionError

    mocker.patch("core.workflow.nodes.datasource.datasource_node.DatasourceManager", new=_Mgr)

    node = DatasourceNode(
        node_id="n",
        config=DatasourceNodeData(
            type="datasource",
            version="1",
            title="Datasource",
            provider_type="plugin",
            provider_name="p",
            plugin_id="plug",
            datasource_name="ds",
        ),
        graph_init_params=_GP(),
        graph_runtime_state=_GS(vp),
    )

    out = list(node._run())
    assert isinstance(out[-1], StreamCompletedEvent)
