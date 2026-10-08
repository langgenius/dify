"""Unit coverage for datasource node event streaming."""

import time
from collections.abc import Generator
from types import SimpleNamespace
from typing import Never

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.datasource.datasource_node import DatasourceNode
from core.workflow.nodes.datasource.entities import DatasourceNodeData
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult, StreamCompletedEvent
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


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
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    class _Mgr:
        @classmethod
        def get_icon_url(cls, **_: object) -> str:
            return "icon"

        @classmethod
        def stream_node_events(cls, **kwargs: object) -> Generator[StreamCompletedEvent, None, None]:
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
        factory = DifyNodeFactory(graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state)
        node = factory.create_node({"id": "n", "data": node_data.model_dump()})
        build_credentials.assert_called_once_with(database_client=database_client)
        assert isinstance(node, DatasourceNode)
    else:
        node = DatasourceNode(
            node_id="n",
            data=node_data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            datasource_credentials=load_credentials,
        )

    out = list(node._run())
    assert isinstance(out[-1], StreamCompletedEvent)
    load_credentials.assert_called_once_with("t1", "p", "plug", "credential-1")
