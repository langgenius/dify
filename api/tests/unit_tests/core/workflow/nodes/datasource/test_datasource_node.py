import time
from collections.abc import Generator
from types import SimpleNamespace
from typing import Never

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.datasource.datasource_node import DatasourceNode
from core.workflow.nodes.datasource.entities import DatasourceNodeData
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from graphon.runtime import RuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


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


"""Unit coverage for datasource node event streaming."""


@pytest.mark.parametrize("use_factory", [False, True])
def test_node_integration_minimal_stream(mocker: MockerFixture, sqlite_engine: Engine, use_factory: bool) -> None:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            datasource_type="online_document",
            datasource_info={
                "workspace_id": "w",
                "page": {"page_id": "pg", "type": "t"},
                "credential_id": "credential-1",
            },
        )
    )
    graph_init_params = build_test_graph_init_params(
        workflow_id="wf-1",
        tenant_id="t1",
        app_id="app-1",
        user_id="u1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    graph_runtime_state = RuntimeState(
        variable_pool=variable_pool,
        start_at=time.perf_counter(),
        workflow_id=graph_init_params.workflow_id,
    )

    class _Mgr:
        @classmethod
        def get_icon_url(cls, **_: object) -> str:
            return "icon"

        @classmethod
        def stream_node_events(cls, **kwargs: object) -> Generator[StreamCompletedEvent]:
            assert kwargs["tenant_id"] == "t1"
            assert kwargs["credentials"] == {"integration_secret": "token"}
            yield from ()
            yield StreamCompletedEvent(node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED))

        @classmethod
        def get_upload_file_by_id(cls, **_: object) -> Never:
            raise AssertionError

    mocker.patch("core.workflow.nodes.datasource.datasource_node.DatasourceManager", new=_Mgr)

    load_credentials = mocker.Mock(return_value={"integration_secret": "token"})
    node_data = DatasourceNodeData(
        type="datasource",
        version="1",
        title="Datasource",
        provider_type="plugin",
        provider_name="p",
        plugin_id="plug",
        datasource_name="ds",
    )
    if use_factory:
        database_client = sessionmaker(sqlite_engine)
        mocker.patch("core.workflow.node_factory.get_session_maker", return_value=database_client)
        build_credentials = mocker.patch(
            "core.workflow.node_factory.build_data_source_credentials",
            return_value=SimpleNamespace(providers=SimpleNamespace(get_datasource_credentials=load_credentials)),
        )
        factory = DifyNodeFactory(init_params=graph_init_params, runtime_state=graph_runtime_state)
        node = factory.create_node({"id": "n", "data": node_data.model_dump()})
        build_credentials.assert_called_once_with(database_client=database_client)
        assert isinstance(node, DatasourceNode)
    else:
        node = DatasourceNode(
            node_id="n",
            data=node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            datasource_credentials=load_credentials,
        )

    out = list(node._run())
    assert isinstance(out[-1], StreamCompletedEvent)
    load_credentials.assert_called_once_with("t1", "p", "plug", "credential-1")
