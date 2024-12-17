import httpx

from core.app.entities.app_invoke_entities import InvokeFrom
from core.file import File, FileTransferMethod, FileType
from core.variables import FileVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine import Graph, GraphInitParams, GraphRuntimeState
from core.workflow.nodes.answer import AnswerStreamGenerateRoute
from core.workflow.nodes.end import EndStreamParam
from core.workflow.nodes.http_request import (
    BodyData,
    HttpRequestNode,
    HttpRequestNodeAuthorization,
    HttpRequestNodeBody,
    HttpRequestNodeData,
)
from models.enums import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType


def test_http_request_node_binary_file(monkeypatch):
    data = HttpRequestNodeData(
        title="test",
        method="post",
        url="http://example.org/post",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="",
        params="",
        body=HttpRequestNodeBody(
            type="binary",
            data=[
                BodyData(
                    key="file",
                    type="file",
                    value="",
                    file=["1111", "file"],
                )
            ],
        ),
    )
    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
    )
    variable_pool.add(
        ["1111", "file"],
        FileVariable(
            name="file",
            value=File(
                tenant_id="1",
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="1111",
            ),
        ),
    )
    node = HttpRequestNode(
        id="1",
        config={
            "id": "1",
            "data": data.model_dump(),
        },
        graph_init_params=GraphInitParams(
            tenant_id="1",
            app_id="1",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="1",
            graph_config={},
            user_id="1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.SERVICE_API,
            call_depth=0,
        ),
        graph=Graph(
            root_node_id="1",
            answer_stream_generate_routes=AnswerStreamGenerateRoute(
                answer_dependencies={},
                answer_generate_route={},
            ),
            end_stream_param=EndStreamParam(
                end_dependencies={},
                end_stream_variable_selector_mapping={},
            ),
        ),
        graph_runtime_state=GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        ),
    )
    monkeypatch.setattr(
        "core.workflow.nodes.http_request.executor.file_manager.download",
        lambda *args, **kwargs: b"test",
    )
    monkeypatch.setattr(
        "core.helper.ssrf_proxy.post",
        lambda *args, **kwargs: httpx.Response(200, content=kwargs["content"]),
    )
    result = node._run()
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["body"] == "test"


def test_http_request_node_form_with_file(monkeypatch):
    data = HttpRequestNodeData(
        title="test",
        method="post",
        url="http://example.org/post",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="",
        params="",
        body=HttpRequestNodeBody(
            type="form-data",
            data=[
                BodyData(
                    key="file",
                    type="file",
                    file=["1111", "file"],
                ),
                BodyData(
                    key="name",
                    type="text",
                    value="test",
                ),
            ],
        ),
    )
    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
    )
    variable_pool.add(
        ["1111", "file"],
        FileVariable(
            name="file",
            value=File(
                tenant_id="1",
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="1111",
            ),
        ),
    )
    node = HttpRequestNode(
        id="1",
        config={
            "id": "1",
            "data": data.model_dump(),
        },
        graph_init_params=GraphInitParams(
            tenant_id="1",
            app_id="1",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="1",
            graph_config={},
            user_id="1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.SERVICE_API,
            call_depth=0,
        ),
        graph=Graph(
            root_node_id="1",
            answer_stream_generate_routes=AnswerStreamGenerateRoute(
                answer_dependencies={},
                answer_generate_route={},
            ),
            end_stream_param=EndStreamParam(
                end_dependencies={},
                end_stream_variable_selector_mapping={},
            ),
        ),
        graph_runtime_state=GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        ),
    )
    monkeypatch.setattr(
        "core.workflow.nodes.http_request.executor.file_manager.download",
        lambda *args, **kwargs: b"test",
    )

    def attr_checker(*args, **kwargs):
        assert kwargs["data"] == {"name": "test"}
        assert kwargs["files"] == {"file": (None, b"test", "application/octet-stream")}
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.helper.ssrf_proxy.post",
        attr_checker,
    )
    result = node._run()
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["body"] == ""
