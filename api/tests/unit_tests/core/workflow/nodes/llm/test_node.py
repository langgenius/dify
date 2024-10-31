import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.file import File, FileTransferMethod, FileType
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from core.variables import ArrayAnySegment, ArrayFileSegment, NoneSegment
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine import Graph, GraphInitParams, GraphRuntimeState
from core.workflow.nodes.answer import AnswerStreamGenerateRoute
from core.workflow.nodes.end import EndStreamParam
from core.workflow.nodes.llm.entities import ContextConfig, LLMNodeData, ModelConfig, VisionConfig, VisionConfigOptions
from core.workflow.nodes.llm.node import LLMNode
from models.enums import UserFrom
from models.workflow import WorkflowType


class TestLLMNode:
    @pytest.fixture
    def llm_node(self):
        data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            prompt_template=[],
            memory=None,
            context=ContextConfig(enabled=False),
            vision=VisionConfig(
                enabled=True,
                configs=VisionConfigOptions(
                    variable_selector=["sys", "files"],
                    detail=ImagePromptMessageContent.DETAIL.HIGH,
                ),
            ),
        )
        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )
        node = LLMNode(
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
        return node

    def test_fetch_files_with_file_segment(self, llm_node):
        file = File(
            id="1",
            tenant_id="test",
            type=FileType.IMAGE,
            filename="test.jpg",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="1",
        )
        llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], file)

        result = llm_node._fetch_files(selector=["sys", "files"])
        assert result == [file]

    def test_fetch_files_with_array_file_segment(self, llm_node):
        files = [
            File(
                id="1",
                tenant_id="test",
                type=FileType.IMAGE,
                filename="test1.jpg",
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="1",
            ),
            File(
                id="2",
                tenant_id="test",
                type=FileType.IMAGE,
                filename="test2.jpg",
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="2",
            ),
        ]
        llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], ArrayFileSegment(value=files))

        result = llm_node._fetch_files(selector=["sys", "files"])
        assert result == files

    def test_fetch_files_with_none_segment(self, llm_node):
        llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], NoneSegment())

        result = llm_node._fetch_files(selector=["sys", "files"])
        assert result == []

    def test_fetch_files_with_array_any_segment(self, llm_node):
        llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], ArrayAnySegment(value=[]))

        result = llm_node._fetch_files(selector=["sys", "files"])
        assert result == []

    def test_fetch_files_with_non_existent_variable(self, llm_node):
        result = llm_node._fetch_files(selector=["sys", "files"])
        assert result == []
