import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.file import File, FileTransferMethod, FileType
from core.tools.entities.tool_entities import ToolIdentity, ToolInvokeMessage, ToolProviderType
from core.variables.segments import StringSegment
from core.workflow.enums import (
    NodeType,
    WorkflowNodeExecutionStatus,
)
from core.workflow.node_events import (
    NodeRunResult,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.agent.exc import (
    AgentInputTypeError,
    AgentNodeError,
    AgentVariableNotFoundError,
    AgentVariableTypeError,
    ToolFileNotFoundError,
)
from core.workflow.runtime import VariablePool


@pytest.fixture
def mock_variable_pool():
    pool = MagicMock(spec=VariablePool)

    variable = MagicMock()
    variable.value = "var_value"
    variable.text = "conversation_id"
    pool.get.return_value = variable

    segment = MagicMock()
    segment.text = "rendered_text"
    segment.log = "rendered_log"
    pool.convert_template.return_value = segment

    return pool


@pytest.fixture
def mock_node():
    node = AgentNode.__new__(AgentNode)
    node.tenant_id = "tenant"
    node.app_id = "app"
    node.user_id = "user"
    node.id = "exec_id"
    node._node_id = "node_id"
    node.invoke_from = "workflow"
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.variable_pool = MagicMock()
    return node


class TestAgentNodeVersion:
    def test_version(self):
        assert AgentNode.version() == "1"


class TestFilterMcp:
    def test_meta_version_above_threshold(self, mock_node):
        strategy = MagicMock()
        strategy.meta_version = "0.0.2"

        tools = [{"type": ToolProviderType.MCP}]
        result = mock_node._filter_mcp_type_tool(strategy, tools)

        assert result == tools

    def test_meta_version_below_threshold(self, mock_node):
        strategy = MagicMock()
        strategy.meta_version = "0.0.1"

        tools = [
            {"type": ToolProviderType.MCP},
            {"type": ToolProviderType.BUILT_IN},
        ]

        result = mock_node._filter_mcp_type_tool(strategy, tools)
        assert len(result) == 1


class TestRemoveUnsupportedFeatures:
    def test_remove_invalid_feature(self, mock_node):
        feature_valid = MagicMock(value="OPEN")
        feature_invalid = MagicMock(value="UNKNOWN")

        model_schema = MagicMock()
        model_schema.features = [feature_valid, feature_invalid]

        result = mock_node._remove_unsupported_model_features_for_old_version(model_schema)

        assert feature_invalid not in result.features


class TestGenerateCredentials:
    @patch.object(ToolIdentity, "model_validate")
    def test_generate_tool_credentials(self, mock_validate, mock_node):
        mock_validate.return_value = MagicMock(provider="openai")

        parameters = {
            "tools": [
                {
                    "credential_id": "cred1",
                    "identity": {"provider": "openai"},
                }
            ]
        }

        creds = mock_node._generate_credentials(parameters)

        assert creds.tool_credentials["openai"] == "cred1"

    @patch.object(ToolIdentity, "model_validate")
    def test_generate_credentials_skips_invalid_identity(self, mock_validate, mock_node):
        mock_validate.side_effect = ValidationError.from_exception_data("ToolIdentity", [])

        parameters = {
            "tools": [
                {
                    "credential_id": "cred1",
                    "identity": {},
                }
            ]
        }

        creds = mock_node._generate_credentials(parameters)

        assert creds.tool_credentials == {}


class TestExtractVariableSelectors:
    def test_extract_variable_mapping(self):
        node_data = {
            "title": "test",
            "agent_strategy_provider_name": "provider/x",
            "agent_strategy_name": "strategy",
            "agent_strategy_label": "label",
            "agent_parameters": {
                "param1": {"type": "variable", "value": ["a", "b"]},
            },
        }

        result = AgentNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data=node_data,
        )

        assert "node1.param1" in result
        assert result["node1.param1"] == ["a", "b"]

    def test_extract_variable_mapping_for_mixed_template(self):
        node_data = {
            "title": "test",
            "agent_strategy_provider_name": "provider/x",
            "agent_strategy_name": "strategy",
            "agent_strategy_label": "label",
            "agent_parameters": {
                "param1": {"type": "mixed", "value": "Hello {{#node.query#}}"},
            },
        }

        result = AgentNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data=node_data,
        )

        assert "node1.#node.query#" in result
        assert result["node1.#node.query#"] == ["node", "query"]


class TestAgentStrategyIcon:
    @patch("core.plugin.impl.plugin.PluginInstaller")
    def test_agent_strategy_icon_found(self, mock_installer, mock_node):
        mock_node._node_data = SimpleNamespace(agent_strategy_provider_name="p/n")
        plugin = SimpleNamespace(plugin_id="p", name="n", declaration=SimpleNamespace(icon="icon"))
        mock_installer.return_value.list_plugins.return_value = [plugin]

        assert mock_node.agent_strategy_icon == "icon"

    @patch("core.plugin.impl.plugin.PluginInstaller")
    def test_agent_strategy_icon_missing(self, mock_installer, mock_node):
        mock_node._node_data = SimpleNamespace(agent_strategy_provider_name="p/n")
        mock_installer.return_value.list_plugins.return_value = []

        assert mock_node.agent_strategy_icon is None


class TestGenerateParameters:
    def test_missing_parameter_defaults_to_none(self, mock_node, mock_variable_pool):
        node_data = MagicMock()
        node_data.agent_parameters = {"missing": SimpleNamespace(type="constant", value="x")}

        result = mock_node._generate_agent_parameters(
            agent_parameters=[],
            variable_pool=mock_variable_pool,
            node_data=node_data,
            strategy=MagicMock(),
        )

        assert result["missing"] is None

    def test_variable_type(self, mock_node, mock_variable_pool):
        param = MagicMock()
        param.name = "p1"
        param.type = "string"

        strategy = MagicMock()
        node_data = MagicMock()
        node_data.agent_parameters = {"p1": SimpleNamespace(type="variable", value=["a"])}

        result = mock_node._generate_agent_parameters(
            agent_parameters=[param],
            variable_pool=mock_variable_pool,
            node_data=node_data,
            strategy=strategy,
        )

        assert result["p1"] == "var_value"

    def test_invalid_type(self, mock_node, mock_variable_pool):
        param = MagicMock()
        param.name = "p1"
        param.type = "string"

        node_data = MagicMock()
        node_data.agent_parameters = {"p1": SimpleNamespace(type="invalid", value="x")}

        with pytest.raises(AgentInputTypeError):
            mock_node._generate_agent_parameters(
                agent_parameters=[param],
                variable_pool=mock_variable_pool,
                node_data=node_data,
                strategy=MagicMock(),
            )

    def test_variable_not_found(self, mock_node):
        pool = MagicMock()
        pool.get.return_value = None

        param = MagicMock()
        param.name = "p1"
        param.type = "string"

        node_data = MagicMock()
        node_data.agent_parameters = {"p1": SimpleNamespace(type="variable", value=["a"])}

        with pytest.raises(AgentVariableNotFoundError):
            mock_node._generate_agent_parameters(
                agent_parameters=[param],
                variable_pool=pool,
                node_data=node_data,
                strategy=MagicMock(),
            )

    def test_mixed_dict_round_trip(self, mock_node):
        pool = MagicMock()
        segment = MagicMock()
        segment.text = '{"a": 1}'
        segment.log = 'log:{"a": 1}'
        pool.convert_template.return_value = segment

        param = MagicMock()
        param.name = "payload"
        param.type = "string"

        node_data = MagicMock()
        node_data.agent_parameters = {"payload": SimpleNamespace(type="mixed", value={"a": 1})}

        result = mock_node._generate_agent_parameters(
            agent_parameters=[param],
            variable_pool=pool,
            node_data=node_data,
            strategy=MagicMock(),
        )
        result_for_log = mock_node._generate_agent_parameters(
            agent_parameters=[param],
            variable_pool=pool,
            node_data=node_data,
            for_log=True,
            strategy=MagicMock(),
        )

        assert result["payload"] == {"a": 1}
        assert result_for_log["payload"].startswith("log:")

    def test_mixed_value_with_unserializable_object(self, mock_node):
        pool = MagicMock()
        segment = MagicMock()
        segment.text = "not-json"
        segment.log = "log-not-json"
        pool.convert_template.return_value = segment

        param = MagicMock()
        param.name = "payload"
        param.type = "string"

        node_data = MagicMock()
        node_data.agent_parameters = {"payload": SimpleNamespace(type="mixed", value={1, 2})}

        result = mock_node._generate_agent_parameters(
            agent_parameters=[param],
            variable_pool=pool,
            node_data=node_data,
            strategy=MagicMock(),
        )

        assert result["payload"] == "not-json"

    def test_tools_missing_variable_selector_raises(self, mock_node):
        tool_param = MagicMock()
        tool_param.name = "tools"
        tool_param.type = "array[tools]"

        tools_value = [
            {
                "enabled": True,
                "type": ToolProviderType.BUILT_IN,
                "parameters": {
                    "p1": {"auto": 0, "value": {"type": "variable", "value": None}},
                },
            }
        ]

        pool = MagicMock()
        segment = MagicMock(text=json.dumps(tools_value), log="log")
        pool.convert_template.return_value = segment

        node_data = MagicMock()
        node_data.agent_parameters = {"tools": SimpleNamespace(type="constant", value=tools_value)}

        with pytest.raises(ValueError):
            mock_node._generate_agent_parameters(
                agent_parameters=[tool_param],
                variable_pool=pool,
                node_data=node_data,
                strategy=MagicMock(meta_version="0.0.2"),
            )

    def test_tools_variable_not_found_raises(self, mock_node):
        tool_param = MagicMock()
        tool_param.name = "tools"
        tool_param.type = "array[tools]"

        tools_value = [
            {
                "enabled": True,
                "type": ToolProviderType.BUILT_IN,
                "parameters": {
                    "p1": {"auto": 0, "value": {"type": "variable", "value": ["var"]}},
                },
            }
        ]

        pool = MagicMock()
        pool.get.return_value = None
        segment = MagicMock(text=json.dumps(tools_value), log="log")
        pool.convert_template.return_value = segment

        node_data = MagicMock()
        node_data.agent_parameters = {"tools": SimpleNamespace(type="constant", value=tools_value)}

        with pytest.raises(AgentVariableNotFoundError):
            mock_node._generate_agent_parameters(
                agent_parameters=[tool_param],
                variable_pool=pool,
                node_data=node_data,
                strategy=MagicMock(meta_version="0.0.2"),
            )


class TestFetchMemory:
    @patch("core.workflow.nodes.agent.agent_node.db")
    @patch("core.workflow.nodes.agent.agent_node.Session")
    def test_fetch_memory_returns_none_for_non_string_segment(self, mock_session, mock_db, mock_node):
        mock_node.graph_runtime_state.variable_pool.get.return_value = "not-string-segment"

        assert mock_node._fetch_memory(MagicMock()) is None

    @patch("core.workflow.nodes.agent.agent_node.db")
    @patch("core.workflow.nodes.agent.agent_node.Session")
    def test_fetch_memory_returns_none_when_conversation_missing(self, mock_session, mock_db, mock_node):
        mock_node.graph_runtime_state.variable_pool.get.return_value = MagicMock(spec=StringSegment, value="c1")
        mock_session.return_value.__enter__.return_value.scalar.return_value = None

        assert mock_node._fetch_memory(MagicMock()) is None

    @patch("core.workflow.nodes.agent.agent_node.TokenBufferMemory")
    @patch("core.workflow.nodes.agent.agent_node.db")
    @patch("core.workflow.nodes.agent.agent_node.Session")
    def test_fetch_memory_returns_instance(self, mock_session, mock_db, mock_memory, mock_node):
        mock_node.graph_runtime_state.variable_pool.get.return_value = MagicMock(spec=StringSegment, value="c1")
        mock_session.return_value.__enter__.return_value.scalar.return_value = MagicMock()
        mock_memory.return_value = "memory"

        assert mock_node._fetch_memory(MagicMock()) == "memory"


class TestFetchModel:
    @patch("core.workflow.nodes.agent.agent_node.ModelManager")
    @patch("core.workflow.nodes.agent.agent_node.ProviderManager")
    def test_fetch_model(self, mock_provider_manager, mock_model_manager, mock_node):
        provider_model_bundle = MagicMock()
        provider_model_bundle.configuration.get_current_credentials.return_value = "creds"
        provider_model_bundle.configuration.provider.provider = "prov"
        provider_model_bundle.model_type_instance.get_model_schema.return_value = "schema"
        mock_provider_manager.return_value.get_provider_model_bundle.return_value = provider_model_bundle

        model_manager = MagicMock()
        model_manager.get_model_instance.return_value = "instance"
        mock_model_manager.return_value = model_manager

        instance, schema = mock_node._fetch_model({"provider": "p", "model": "m", "model_type": "llm"})

        assert instance == "instance"
        assert schema == "schema"


class TestTransformMessage:
    def test_text_message(self, mock_node):
        text_message = MagicMock()
        text_message.type = text_message.MessageType.TEXT
        text_message.message.text = "hello"

        def generator():
            yield text_message

        events = list(
            mock_node._transform_message(
                messages=generator(),
                tool_info={},
                parameters_for_log={},
                user_id="u",
                tenant_id="t",
                node_type=NodeType.AGENT,
                node_id="node",
                node_execution_id="exec",
            )
        )

        assert any(isinstance(e, StreamChunkEvent) for e in events)
        assert any(isinstance(e, StreamCompletedEvent) for e in events)

    @patch("core.workflow.nodes.agent.agent_node.ToolFileMessageTransformer.transform_tool_invoke_messages")
    def test_file_missing_meta(self, mock_transform, mock_node):
        msg = MagicMock()
        msg.type = ToolInvokeMessage.MessageType.FILE
        msg.meta = {}  # missing "file"

        mock_transform.return_value = [msg]

        with pytest.raises(AgentNodeError):
            list(
                mock_node._transform_message(
                    messages=iter([]),
                    tool_info={},
                    parameters_for_log={},
                    user_id="u",
                    tenant_id="t",
                    node_type=NodeType.AGENT,
                    node_id="node",
                    node_execution_id="exec",
                )
            )

    @patch("core.workflow.nodes.agent.agent_node.ToolFileMessageTransformer.transform_tool_invoke_messages")
    def test_variable_stream_type_error(self, mock_transform, mock_node):
        variable_message = ToolInvokeMessage.VariableMessage.model_construct(
            variable_name="streamed",
            variable_value=1,
            stream=True,
        )
        msg = ToolInvokeMessage.model_construct(
            type=ToolInvokeMessage.MessageType.VARIABLE,
            message=variable_message,
            meta=None,
        )
        mock_transform.return_value = [msg]

        with pytest.raises(AgentVariableTypeError):
            list(
                mock_node._transform_message(
                    messages=iter([]),
                    tool_info={},
                    parameters_for_log={},
                    user_id="u",
                    tenant_id="t",
                    node_type=NodeType.AGENT,
                    node_id="node",
                    node_execution_id="exec",
                )
            )

    @patch("core.workflow.nodes.agent.agent_node.ToolFileMessageTransformer.transform_tool_invoke_messages")
    def test_transform_message_json_link_variable_and_log(self, mock_transform, mock_node):
        json_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON,
            message=ToolInvokeMessage.JsonMessage(json_object={"execution_metadata": {"prompt_tokens": 1}}),
        )
        text_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.TEXT,
            message=ToolInvokeMessage.TextMessage(text="hello"),
        )
        link_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LINK,
            message=ToolInvokeMessage.TextMessage(text="https://example.com"),
        )
        variable_stream_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.VARIABLE,
            message=ToolInvokeMessage.VariableMessage(
                variable_name="streamed",
                variable_value="part",
                stream=True,
            ),
        )
        variable_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.VARIABLE,
            message=ToolInvokeMessage.VariableMessage(variable_name="result", variable_value=123, stream=False),
        )
        log_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LOG,
            message=ToolInvokeMessage.LogMessage(
                id="log-1",
                label="step",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                data={"k": "v"},
            ),
        )

        mock_transform.return_value = [
            text_message,
            link_message,
            json_message,
            variable_stream_message,
            variable_message,
            log_message,
        ]

        events = list(
            mock_node._transform_message(
                messages=iter([]),
                tool_info={"icon": ""},
                parameters_for_log={"p": "v"},
                user_id="u",
                tenant_id="t",
                node_type=NodeType.AGENT,
                node_id="node",
                node_execution_id="exec",
            )
        )

        completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
        outputs = completed.node_run_result.outputs

        assert outputs["text"] == "helloLink: https://example.com\n"
        assert outputs["streamed"] == "part"
        assert outputs["result"] == 123
        assert isinstance(outputs["json"], list)

    @patch("core.workflow.nodes.agent.agent_node.ToolFileMessageTransformer.transform_tool_invoke_messages")
    def test_file_message_wrong_type(self, mock_transform, mock_node):
        file_message = ToolInvokeMessage.FileMessage.model_construct(file_marker="file_marker")
        msg = ToolInvokeMessage.model_construct(
            type=ToolInvokeMessage.MessageType.FILE,
            message=file_message,
            meta={"file": "not-a-file"},
        )
        mock_transform.return_value = [msg]

        with pytest.raises(AgentNodeError):
            list(
                mock_node._transform_message(
                    messages=iter([]),
                    tool_info={},
                    parameters_for_log={},
                    user_id="u",
                    tenant_id="t",
                    node_type=NodeType.AGENT,
                    node_id="node",
                    node_execution_id="exec",
                )
            )

    @patch("core.workflow.nodes.agent.agent_node.db")
    @patch("core.workflow.nodes.agent.agent_node.Session")
    @patch("core.workflow.nodes.agent.agent_node.file_factory.build_from_mapping")
    @patch("core.workflow.nodes.agent.agent_node.file_factory.get_file_type_by_mime_type")
    @patch("core.workflow.nodes.agent.agent_node.ToolFileMessageTransformer.transform_tool_invoke_messages")
    def test_image_and_blob_messages(
        self,
        mock_transform,
        mock_get_type,
        mock_build,
        mock_session,
        mock_db,
        mock_node,
    ):
        mock_session.return_value.__enter__.return_value.scalar.return_value = MagicMock(mimetype="image/png")
        mock_get_type.return_value = FileType.IMAGE
        mock_build.side_effect = [
            File(
                tenant_id="t",
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.REMOTE_URL,
                remote_url="http://x/123.png",
            ),
            File(
                tenant_id="t",
                type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.TOOL_FILE,
                related_id="456",
                extension=".bin",
            ),
        ]

        image_msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.IMAGE_LINK,
            message=ToolInvokeMessage.TextMessage(text="http://x/123.png"),
            meta={"transfer_method": FileTransferMethod.REMOTE_URL},
        )
        blob_msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB,
            message=ToolInvokeMessage.TextMessage(text="http://x/456.bin"),
            meta={"a": 1},
        )
        mock_transform.return_value = [image_msg, blob_msg]

        events = list(
            mock_node._transform_message(
                messages=iter([]),
                tool_info={},
                parameters_for_log={},
                user_id="u",
                tenant_id="t",
                node_type=NodeType.AGENT,
                node_id="node",
                node_execution_id="exec",
            )
        )

        completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
        assert len(completed.node_run_result.outputs["files"].value) == 2

    @patch("core.workflow.nodes.agent.agent_node.db")
    @patch("core.workflow.nodes.agent.agent_node.Session")
    @patch("core.workflow.nodes.agent.agent_node.ToolFileMessageTransformer.transform_tool_invoke_messages")
    def test_tool_file_not_found_raises(self, mock_transform, mock_session, mock_db, mock_node):
        mock_session.return_value.__enter__.return_value.scalar.return_value = None
        image_msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.IMAGE_LINK,
            message=ToolInvokeMessage.TextMessage(text="http://x/123.png"),
            meta=None,
        )
        mock_transform.return_value = [image_msg]

        with pytest.raises(ToolFileNotFoundError):
            list(
                mock_node._transform_message(
                    messages=iter([]),
                    tool_info={},
                    parameters_for_log={},
                    user_id="u",
                    tenant_id="t",
                    node_type=NodeType.AGENT,
                    node_id="node",
                    node_execution_id="exec",
                )
            )

    @patch("core.workflow.nodes.agent.agent_node.ToolFileMessageTransformer.transform_tool_invoke_messages")
    def test_file_message_success(self, mock_transform, mock_node):
        file_obj = File(
            tenant_id="t",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="http://x/image.png",
        )
        msg = ToolInvokeMessage.model_construct(
            type=ToolInvokeMessage.MessageType.FILE,
            message=ToolInvokeMessage.FileMessage.model_construct(file_marker="file_marker"),
            meta={"file": file_obj},
        )
        mock_transform.return_value = [msg]

        events = list(
            mock_node._transform_message(
                messages=iter([]),
                tool_info={},
                parameters_for_log={},
                user_id="u",
                tenant_id="t",
                node_type=NodeType.AGENT,
                node_id="node",
                node_execution_id="exec",
            )
        )

        completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
        assert completed.node_run_result.outputs["files"].value == [file_obj]


class TestRunMethod:
    @patch("core.workflow.nodes.agent.agent_node.get_plugin_agent_strategy")
    def test_strategy_failure(self, mock_strategy, mock_node):
        mock_strategy.side_effect = Exception("error")

        mock_node._node_data = MagicMock()
        mock_node.graph_runtime_state.variable_pool.get.return_value = None

        events = list(mock_node._run())

        completed = events[-1]
        assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED

    @patch("core.workflow.nodes.agent.agent_node.get_plugin_agent_strategy")
    def test_invoke_failure(self, mock_strategy, mock_node):
        strategy = MagicMock()
        strategy.get_parameters.return_value = []
        strategy.invoke.side_effect = Exception("invoke error")

        mock_strategy.return_value = strategy

        mock_node._node_data = MagicMock()
        mock_node.node_data.agent_parameters = {}
        mock_node.graph_runtime_state.variable_pool.get.return_value = None

        mock_node._generate_agent_parameters = MagicMock(return_value={})
        mock_node._generate_credentials = MagicMock(return_value={})

        events = list(mock_node._run())

        assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.FAILED

    @patch("core.workflow.nodes.agent.agent_node.get_plugin_agent_strategy")
    def test_transform_message_failure(self, mock_strategy, mock_node):
        from core.plugin.impl.exc import PluginDaemonClientSideError

        strategy = MagicMock()
        strategy.get_parameters.return_value = []
        strategy.invoke.return_value = iter([])
        mock_strategy.return_value = strategy

        mock_node._node_data = MagicMock()
        mock_node.node_data.agent_parameters = {}
        mock_node.graph_runtime_state.variable_pool.get.return_value = None

        mock_node._generate_agent_parameters = MagicMock(return_value={})
        mock_node._generate_credentials = MagicMock(return_value={})
        mock_node._transform_message = MagicMock(side_effect=PluginDaemonClientSideError("boom"))
        mock_node.node_data.agent_strategy_provider_name = "p/n"
        mock_node.node_data.agent_strategy_name = "s"

        with patch("core.plugin.impl.plugin.PluginInstaller") as mock_installer:
            mock_installer.return_value.list_plugins.return_value = []
            events = list(mock_node._run())

        assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.FAILED

    @patch("core.workflow.nodes.agent.agent_node.get_plugin_agent_strategy")
    def test_run_success_yields_transform_message_events(self, mock_strategy, mock_node):
        strategy = MagicMock()
        strategy.get_parameters.return_value = []
        strategy.invoke.return_value = iter([])
        mock_strategy.return_value = strategy

        mock_node._node_data = MagicMock()
        mock_node.node_data.agent_parameters = {}
        mock_node.graph_runtime_state.variable_pool.get.return_value = None

        mock_node._generate_agent_parameters = MagicMock(return_value={})
        mock_node._generate_credentials = MagicMock(return_value={})

        mock_node._transform_message = MagicMock(
            return_value=iter(
                [StreamCompletedEvent(node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED))]
            )
        )

        with patch("core.plugin.impl.plugin.PluginInstaller") as mock_installer:
            mock_installer.return_value.list_plugins.return_value = []
            events = list(mock_node._run())

        assert any(isinstance(event, StreamCompletedEvent) for event in events)
