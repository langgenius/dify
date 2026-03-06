"""Unit tests for AgentNode file handling."""

import sys
import types
from typing import TYPE_CHECKING, Any
from unittest.mock import MagicMock, patch

import pytest

if TYPE_CHECKING:
    from core.workflow.nodes.agent.agent_node import AgentNode


def _setup_stubs(monkeypatch):
    """Set up stubs for circular import issues."""
    module_name = "core.ops.ops_trace_manager"
    if module_name not in sys.modules:
        ops_stub = types.ModuleType(module_name)
        ops_stub.TraceQueueManager = object
        ops_stub.TraceTask = object
        monkeypatch.setitem(sys.modules, module_name, ops_stub)


@pytest.fixture
def agent_imports(monkeypatch) -> dict[str, Any]:
    """Set up stubs and return imported modules."""
    _setup_stubs(monkeypatch)

    from core.agent.plugin_entities import AgentStrategyParameter
    from core.file import File, FileTransferMethod, FileType, file_manager
    from core.model_runtime.entities.message_entities import ImagePromptMessageContent
    from core.variables import FileSegment, StringSegment
    from core.workflow.nodes.agent.agent_node import AgentNode
    from core.workflow.nodes.agent.entities import AgentNodeData, VisionConfig, VisionConfigOptions
    from core.workflow.runtime.variable_pool import VariablePool

    return {
        "AgentNode": AgentNode,
        "AgentNodeData": AgentNodeData,
        "VisionConfig": VisionConfig,
        "VisionConfigOptions": VisionConfigOptions,
        "VariablePool": VariablePool,
        "AgentStrategyParameter": AgentStrategyParameter,
        "File": File,
        "FileTransferMethod": FileTransferMethod,
        "FileType": FileType,
        "file_manager": file_manager,
        "ImagePromptMessageContent": ImagePromptMessageContent,
        "FileSegment": FileSegment,
        "StringSegment": StringSegment,
    }


class TestAgentNodeFileHandling:
    """Tests for file handling in query, instruction, and vision variable selector."""

    @pytest.fixture
    def mock_file(self, agent_imports):
        """Create a mock file."""
        File = agent_imports["File"]
        FileType = agent_imports["FileType"]
        FileTransferMethod = agent_imports["FileTransferMethod"]
        return File(
            id="test-file-id",
            tenant_id="test-tenant",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test-related-id",
            filename="test.png",
            extension=".png",
            mime_type="image/png",
            size=1024,
        )

    @pytest.fixture
    def mock_custom_file(self, agent_imports):
        """Create a mock custom (unsupported) file."""
        File = agent_imports["File"]
        FileType = agent_imports["FileType"]
        FileTransferMethod = agent_imports["FileTransferMethod"]
        return File(
            id="test-custom-id",
            tenant_id="test-tenant",
            type=FileType.CUSTOM,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test-related-id",
            filename="test.zip",
            extension=".zip",
            mime_type="application/zip",
            size=4096,
        )

    @pytest.fixture
    def mock_strategy(self, agent_imports) -> MagicMock:
        """Create a mock agent strategy."""
        AgentStrategyParameter = agent_imports["AgentStrategyParameter"]
        strategy = MagicMock()
        strategy.get_parameters.return_value = [
            AgentStrategyParameter(
                name="query",
                type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
                required=True,
                label={"en_US": "Query"},
            ),
            AgentStrategyParameter(
                name="instruction",
                type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
                required=False,
                label={"en_US": "Instruction"},
            ),
        ]
        return strategy

    @pytest.fixture
    def base_node_data(self, agent_imports) -> dict:
        """Create base node data for tests."""
        VisionConfig = agent_imports["VisionConfig"]
        return {
            "title": "Test Agent",
            "agent_strategy_provider_name": "test-provider",
            "agent_strategy_name": "test-strategy",
            "agent_strategy_label": "Test Strategy",
            "agent_parameters": {},
            "vision": VisionConfig(enabled=False),
        }

    def _create_agent_node(self, agent_imports) -> "AgentNode":
        """Create an AgentNode instance for testing."""
        AgentNode = agent_imports["AgentNode"]
        node = object.__new__(AgentNode)
        node.tenant_id = "test-tenant"
        node.app_id = "test-app"
        return node

    def test_query_with_text_only_returns_string(self, agent_imports, mock_strategy, base_node_data):
        """When query contains only text, it should return a string."""
        # Arrange
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        StringSegment = agent_imports["StringSegment"]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "text_var"], StringSegment(value="Hello, world!"))

        base_node_data["agent_parameters"] = {
            "query": AgentNodeData.AgentInput(
                type="mixed",
                value="{{#node1.text_var#}}",
            ),
        }
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        # Act
        result = agent_node._generate_agent_parameters(
            agent_parameters=agent_parameters,
            variable_pool=variable_pool,
            node_data=node_data,
            for_log=False,
            strategy=mock_strategy,
        )

        # Assert
        assert result["query"] == "Hello, world!"
        assert isinstance(result["query"], str)

    def test_query_with_file_returns_list(self, agent_imports, mock_file, mock_strategy, base_node_data):
        """When query contains a file, it should return a list."""
        # Arrange
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        FileSegment = agent_imports["FileSegment"]
        file_manager = agent_imports["file_manager"]
        ImagePromptMessageContent = agent_imports["ImagePromptMessageContent"]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "file_var"], FileSegment(value=mock_file))

        base_node_data["agent_parameters"] = {
            "query": AgentNodeData.AgentInput(
                type="mixed",
                value="{{#node1.file_var#}}",
            ),
        }
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        with patch.object(file_manager, "to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            # Act
            result = agent_node._generate_agent_parameters(
                agent_parameters=agent_parameters,
                variable_pool=variable_pool,
                node_data=node_data,
                for_log=False,
                strategy=mock_strategy,
            )

            # Assert
            assert isinstance(result["query"], list)
            assert len(result["query"]) == 1
            assert result["query"][0]["type"] == "image"

    def test_query_with_text_and_file_returns_list_with_both(
        self, agent_imports, mock_file, mock_strategy, base_node_data
    ):
        """When query contains both text and file, it should return a list with both."""
        # Arrange
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        FileSegment = agent_imports["FileSegment"]
        file_manager = agent_imports["file_manager"]
        ImagePromptMessageContent = agent_imports["ImagePromptMessageContent"]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "file_var"], FileSegment(value=mock_file))

        base_node_data["agent_parameters"] = {
            "query": AgentNodeData.AgentInput(
                type="mixed",
                value="Describe this: {{#node1.file_var#}}",
            ),
        }
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        with patch.object(file_manager, "to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            # Act
            result = agent_node._generate_agent_parameters(
                agent_parameters=agent_parameters,
                variable_pool=variable_pool,
                node_data=node_data,
                for_log=False,
                strategy=mock_strategy,
            )

            # Assert
            assert isinstance(result["query"], list)
            assert len(result["query"]) == 2
            assert result["query"][0]["type"] == "text"
            assert result["query"][1]["type"] == "image"

    def test_custom_file_type_is_ignored(self, agent_imports, mock_custom_file, mock_strategy, base_node_data):
        """Custom file types should be ignored and return text only."""
        # Arrange
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        FileSegment = agent_imports["FileSegment"]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "file_var"], FileSegment(value=mock_custom_file))

        base_node_data["agent_parameters"] = {
            "query": AgentNodeData.AgentInput(
                type="mixed",
                value="{{#node1.file_var#}}",
            ),
        }
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        # Act
        result = agent_node._generate_agent_parameters(
            agent_parameters=agent_parameters,
            variable_pool=variable_pool,
            node_data=node_data,
            for_log=False,
            strategy=mock_strategy,
        )

        # Assert
        # Custom file types are ignored, so result should be the text representation
        assert isinstance(result["query"], str)

    def test_instruction_with_file_returns_list(self, agent_imports, mock_file, mock_strategy, base_node_data):
        """When instruction contains a file, it should return a list (same as query)."""
        # Arrange
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        FileSegment = agent_imports["FileSegment"]
        file_manager = agent_imports["file_manager"]
        ImagePromptMessageContent = agent_imports["ImagePromptMessageContent"]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "file_var"], FileSegment(value=mock_file))

        base_node_data["agent_parameters"] = {
            "instruction": AgentNodeData.AgentInput(
                type="mixed",
                value="You are a helpful assistant. {{#node1.file_var#}}",
            ),
        }
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        with patch.object(file_manager, "to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            # Act
            result = agent_node._generate_agent_parameters(
                agent_parameters=agent_parameters,
                variable_pool=variable_pool,
                node_data=node_data,
                for_log=False,
                strategy=mock_strategy,
            )

            # Assert
            assert isinstance(result["instruction"], list)
            assert len(result["instruction"]) == 2
            assert result["instruction"][0]["type"] == "text"
            assert result["instruction"][1]["type"] == "image"

    def test_vision_variable_selector_files_added_to_query(
        self, agent_imports, mock_file, mock_strategy, base_node_data
    ):
        """Vision variable selector files should be added to query only."""
        # Arrange
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        StringSegment = agent_imports["StringSegment"]
        FileSegment = agent_imports["FileSegment"]
        VisionConfig = agent_imports["VisionConfig"]
        VisionConfigOptions = agent_imports["VisionConfigOptions"]
        file_manager = agent_imports["file_manager"]
        ImagePromptMessageContent = agent_imports["ImagePromptMessageContent"]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "text_var"], StringSegment(value="Describe this image"))
        variable_pool.add(["sys", "files"], FileSegment(value=mock_file))

        base_node_data["agent_parameters"] = {
            "query": AgentNodeData.AgentInput(
                type="mixed",
                value="{{#node1.text_var#}}",
            ),
        }
        base_node_data["vision"] = VisionConfig(
            enabled=True,
            configs=VisionConfigOptions(
                variable_selector=["sys", "files"],
            ),
        )
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        with patch.object(file_manager, "to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            # Act
            result = agent_node._generate_agent_parameters(
                agent_parameters=agent_parameters,
                variable_pool=variable_pool,
                node_data=node_data,
                for_log=False,
                strategy=mock_strategy,
            )

            # Assert
            assert isinstance(result["query"], list)
            assert len(result["query"]) == 2
            assert result["query"][0]["type"] == "text"
            assert result["query"][0]["data"] == "Describe this image"
            assert result["query"][1]["type"] == "image"

    def test_for_log_returns_text_representation(self, agent_imports, mock_file, mock_strategy, base_node_data):
        """When for_log is True, files should be represented as log text."""
        # Arrange
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        FileSegment = agent_imports["FileSegment"]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "file_var"], FileSegment(value=mock_file))

        base_node_data["agent_parameters"] = {
            "query": AgentNodeData.AgentInput(
                type="mixed",
                value="{{#node1.file_var#}}",
            ),
        }
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        # Act
        result = agent_node._generate_agent_parameters(
            agent_parameters=agent_parameters,
            variable_pool=variable_pool,
            node_data=node_data,
            for_log=True,
            strategy=mock_strategy,
        )

        # Assert
        # for_log=True should return log representation, not a list
        assert isinstance(result["query"], str)

    def test_non_query_instruction_parameter_returns_text(
        self, agent_imports, mock_file, mock_strategy, base_node_data
    ):
        """Parameters other than query/instruction should return text even with files."""
        # Arrange
        AgentStrategyParameter = agent_imports["AgentStrategyParameter"]
        VariablePool = agent_imports["VariablePool"]
        AgentNodeData = agent_imports["AgentNodeData"]
        FileSegment = agent_imports["FileSegment"]

        mock_strategy.get_parameters.return_value = [
            AgentStrategyParameter(
                name="other_param",
                type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
                required=False,
                label={"en_US": "Other"},
            ),
        ]

        variable_pool = VariablePool()
        variable_pool.add(["node1", "file_var"], FileSegment(value=mock_file))

        base_node_data["agent_parameters"] = {
            "other_param": AgentNodeData.AgentInput(
                type="mixed",
                value="{{#node1.file_var#}}",
            ),
        }
        node_data = AgentNodeData.model_validate(base_node_data)
        agent_parameters = mock_strategy.get_parameters()

        agent_node = self._create_agent_node(agent_imports)

        # Act
        result = agent_node._generate_agent_parameters(
            agent_parameters=agent_parameters,
            variable_pool=variable_pool,
            node_data=node_data,
            for_log=False,
            strategy=mock_strategy,
        )

        # Assert
        # Non-query/instruction parameters should return text representation
        assert isinstance(result["other_param"], str)
