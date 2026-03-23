from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from core.workflow.nodes.datasource.datasource_node import DatasourceNode


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
    tenant_id = "t1"
    app_id = "app-1"
    workflow_id = "wf-1"
    graph_config = {}
    user_id = "u1"
    user_from = "account"
    invoke_from = "debugger"
    call_depth = 0


def test_datasource_node_delegates_to_manager_stream(mocker):
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

    node = DatasourceNode(
        id="n",
        config={
            "id": "n",
            "data": {
                "type": "datasource",
                "version": "1",
                "title": "Datasource",
                "provider_type": "plugin",
                "provider_name": "p",
                "plugin_id": "plug",
                "datasource_name": "ds",
            },
        },
        graph_init_params=gp,
        graph_runtime_state=gs,
        datasource_manager=_Mgr,
    )

    evts = list(node._run())
    assert isinstance(evts[0], StreamChunkEvent)
    assert isinstance(evts[-1], StreamCompletedEvent)
