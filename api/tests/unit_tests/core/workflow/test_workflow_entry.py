from types import SimpleNamespace

import pytest

from configs import dify_config
from core.app.apps.exc import GenerateTaskStoppedError
from core.helper.code_executor.code_executor import CodeLanguage
from core.variables.variables import StringVariable
from core.workflow.constants import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
)
from core.workflow.file import File, FileTransferMethod, FileType
from core.workflow.graph_events import GraphRunFailedEvent
from core.workflow.nodes import NodeType
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.code.limits import CodeNodeLimits
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_entry import WorkflowEntry


@pytest.fixture(autouse=True)
def _mock_ssrf_head(monkeypatch):
    """Avoid any real network requests during tests.

    file_factory._get_remote_file_info() uses ssrf_proxy.head to inspect
    remote files. We stub it to return a minimal response object with
    headers so filename/mime/size can be derived deterministically.
    """

    def fake_head(url, *args, **kwargs):
        # choose a content-type by file suffix for determinism
        if url.endswith(".pdf"):
            ctype = "application/pdf"
        elif url.endswith(".jpg") or url.endswith(".jpeg"):
            ctype = "image/jpeg"
        elif url.endswith(".png"):
            ctype = "image/png"
        else:
            ctype = "application/octet-stream"
        filename = url.split("/")[-1] or "file.bin"
        headers = {
            "Content-Type": ctype,
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": "12345",
        }
        return SimpleNamespace(status_code=200, headers=headers)

    monkeypatch.setattr("core.helper.ssrf_proxy.head", fake_head)


class TestWorkflowEntry:
    """Test WorkflowEntry class methods."""

    def test_mapping_user_inputs_to_variable_pool_with_system_variables(self):
        """Test mapping system variables from user inputs to variable pool."""
        # Initialize variable pool with system variables
        variable_pool = VariablePool(
            system_variables=SystemVariable(
                user_id="test_user_id",
                app_id="test_app_id",
                workflow_id="test_workflow_id",
            ),
            user_inputs={},
        )

        # Define variable mapping - sys variables mapped to other nodes
        variable_mapping = {
            "node1.input1": ["node1", "input1"],  # Regular mapping
            "node2.query": ["node2", "query"],  # Regular mapping
            "sys.user_id": ["output_node", "user"],  # System variable mapping
        }

        # User inputs including sys variables
        user_inputs = {
            "node1.input1": "new_user_id",
            "node2.query": "test query",
            "sys.user_id": "system_user",
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify variables were added to pool
        # Note: variable_pool.get returns Variable objects, not raw values
        node1_var = variable_pool.get(["node1", "input1"])
        assert node1_var is not None
        assert node1_var.value == "new_user_id"

        node2_var = variable_pool.get(["node2", "query"])
        assert node2_var is not None
        assert node2_var.value == "test query"

        # System variable gets mapped to output node
        output_var = variable_pool.get(["output_node", "user"])
        assert output_var is not None
        assert output_var.value == "system_user"

    def test_single_step_run_injects_code_limits(self):
        """Ensure single-step CodeNode execution configures limits."""
        # Arrange
        node_id = "code_node"
        node_data = {
            "type": "code",
            "title": "Code",
            "desc": None,
            "variables": [],
            "code_language": CodeLanguage.PYTHON3,
            "code": "def main():\n    return {}",
            "outputs": {},
        }
        node_config = {"id": node_id, "data": node_data}

        class StubWorkflow:
            def __init__(self):
                self.tenant_id = "tenant"
                self.app_id = "app"
                self.id = "workflow"
                self.graph_dict = {"nodes": [node_config], "edges": []}

            def get_node_config_by_id(self, target_id: str):
                assert target_id == node_id
                return node_config

        workflow = StubWorkflow()
        variable_pool = VariablePool(system_variables=SystemVariable.default(), user_inputs={})
        expected_limits = CodeNodeLimits(
            max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
            max_number=dify_config.CODE_MAX_NUMBER,
            min_number=dify_config.CODE_MIN_NUMBER,
            max_precision=dify_config.CODE_MAX_PRECISION,
            max_depth=dify_config.CODE_MAX_DEPTH,
            max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
            max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
            max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
        )

        # Act
        node, _ = WorkflowEntry.single_step_run(
            workflow=workflow,
            node_id=node_id,
            user_id="user",
            user_inputs={},
            variable_pool=variable_pool,
        )

        # Assert
        assert isinstance(node, CodeNode)
        assert node._limits == expected_limits

    def test_mapping_user_inputs_to_variable_pool_with_env_variables(self):
        """Test mapping environment variables from user inputs to variable pool."""
        # Initialize variable pool with environment variables
        env_var = StringVariable(name="API_KEY", value="existing_key")
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            environment_variables=[env_var],
            user_inputs={},
        )

        # Add env variable to pool (simulating initialization)
        variable_pool.add([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"], env_var)

        # Define variable mapping - env variables should not be overridden
        variable_mapping = {
            "node1.api_key": [ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"],
            "node2.new_env": [ENVIRONMENT_VARIABLE_NODE_ID, "NEW_ENV"],
        }

        # User inputs
        user_inputs = {
            "node1.api_key": "user_provided_key",  # This should not override existing env var
            "node2.new_env": "new_env_value",
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify env variable was not overridden
        env_value = variable_pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"])
        assert env_value is not None
        assert env_value.value == "existing_key"  # Should remain unchanged

        # New env variables from user input should not be added
        assert variable_pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "NEW_ENV"]) is None

    def test_mapping_user_inputs_to_variable_pool_with_conversation_variables(self):
        """Test mapping conversation variables from user inputs to variable pool."""
        # Initialize variable pool with conversation variables
        conv_var = StringVariable(name="last_message", value="Hello")
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            conversation_variables=[conv_var],
            user_inputs={},
        )

        # Add conversation variable to pool
        variable_pool.add([CONVERSATION_VARIABLE_NODE_ID, "last_message"], conv_var)

        # Define variable mapping
        variable_mapping = {
            "node1.message": ["node1", "message"],  # Map to regular node
            "conversation.context": ["chat_node", "context"],  # Conversation var to regular node
        }

        # User inputs
        user_inputs = {
            "node1.message": "Updated message",
            "conversation.context": "New context",
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify variables were added to their target nodes
        node1_var = variable_pool.get(["node1", "message"])
        assert node1_var is not None
        assert node1_var.value == "Updated message"

        chat_var = variable_pool.get(["chat_node", "context"])
        assert chat_var is not None
        assert chat_var.value == "New context"

    def test_mapping_user_inputs_to_variable_pool_with_regular_variables(self):
        """Test mapping regular node variables from user inputs to variable pool."""
        # Initialize empty variable pool
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        )

        # Define variable mapping for regular nodes
        variable_mapping = {
            "input_node.text": ["input_node", "text"],
            "llm_node.prompt": ["llm_node", "prompt"],
            "code_node.input": ["code_node", "input"],
        }

        # User inputs
        user_inputs = {
            "input_node.text": "User input text",
            "llm_node.prompt": "Generate a summary",
            "code_node.input": {"key": "value"},
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify regular variables were added
        text_var = variable_pool.get(["input_node", "text"])
        assert text_var is not None
        assert text_var.value == "User input text"

        prompt_var = variable_pool.get(["llm_node", "prompt"])
        assert prompt_var is not None
        assert prompt_var.value == "Generate a summary"

        input_var = variable_pool.get(["code_node", "input"])
        assert input_var is not None
        assert input_var.value == {"key": "value"}

    def test_mapping_user_inputs_with_file_handling(self):
        """Test mapping file inputs from user inputs to variable pool."""
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        )

        # Define variable mapping
        variable_mapping = {
            "file_node.file": ["file_node", "file"],
            "file_node.files": ["file_node", "files"],
        }

        # User inputs with file data - using remote_url which doesn't require upload_file_id
        user_inputs = {
            "file_node.file": {
                "type": "document",
                "transfer_method": "remote_url",
                "url": "http://example.com/test.pdf",
            },
            "file_node.files": [
                {
                    "type": "image",
                    "transfer_method": "remote_url",
                    "url": "http://example.com/image1.jpg",
                },
                {
                    "type": "image",
                    "transfer_method": "remote_url",
                    "url": "http://example.com/image2.jpg",
                },
            ],
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify file was converted and added
        file_var = variable_pool.get(["file_node", "file"])
        assert file_var is not None
        assert file_var.value.type == FileType.DOCUMENT
        assert file_var.value.transfer_method == FileTransferMethod.REMOTE_URL

        # Verify file list was converted and added
        files_var = variable_pool.get(["file_node", "files"])
        assert files_var is not None
        assert isinstance(files_var.value, list)
        assert len(files_var.value) == 2
        assert all(isinstance(f, File) for f in files_var.value)
        assert files_var.value[0].type == FileType.IMAGE
        assert files_var.value[1].type == FileType.IMAGE
        assert files_var.value[0].type == FileType.IMAGE
        assert files_var.value[1].type == FileType.IMAGE

    def test_mapping_user_inputs_missing_variable_error(self):
        """Test that mapping raises error when required variable is missing."""
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        )

        # Define variable mapping
        variable_mapping = {
            "node1.required_input": ["node1", "required_input"],
        }

        # User inputs without required variable
        user_inputs = {
            "node1.other_input": "some value",
        }

        # Should raise ValueError for missing variable
        with pytest.raises(ValueError, match="Variable key node1.required_input not found in user inputs"):
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

    def test_mapping_user_inputs_with_alternative_key_format(self):
        """Test mapping with alternative key format (without node prefix)."""
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        )

        # Define variable mapping
        variable_mapping = {
            "node1.input": ["node1", "input"],
        }

        # User inputs with alternative key format
        user_inputs = {
            "input": "value without node prefix",  # Alternative format without node prefix
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify variable was added using alternative key
        input_var = variable_pool.get(["node1", "input"])
        assert input_var is not None
        assert input_var.value == "value without node prefix"

    def test_mapping_user_inputs_with_complex_selectors(self):
        """Test mapping with complex node variable keys."""
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        )

        # Define variable mapping - selectors can only have 2 elements
        variable_mapping = {
            "node1.data.field1": ["node1", "data_field1"],  # Complex key mapped to simple selector
            "node2.config.settings.timeout": ["node2", "timeout"],  # Complex key mapped to simple selector
        }

        # User inputs
        user_inputs = {
            "node1.data.field1": "nested value",
            "node2.config.settings.timeout": 30,
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify variables were added with simple selectors
        data_var = variable_pool.get(["node1", "data_field1"])
        assert data_var is not None
        assert data_var.value == "nested value"

        timeout_var = variable_pool.get(["node2", "timeout"])
        assert timeout_var is not None
        assert timeout_var.value == 30

    def test_mapping_user_inputs_invalid_node_variable(self):
        """Test that mapping handles invalid node variable format."""
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        )

        # Define variable mapping with single element node variable (at least one dot is required)
        variable_mapping = {
            "singleelement": ["node1", "input"],  # No dot separator
        }

        user_inputs = {"singleelement": "some value"}  # Must use exact key

        # Should NOT raise error - function accepts it and uses direct key
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify it was added
        var = variable_pool.get(["node1", "input"])
        assert var is not None
        assert var.value == "some value"

    def test_mapping_all_variable_types_together(self):
        """Test mapping all four types of variables in one operation."""
        # Initialize variable pool with some existing variables
        env_var = StringVariable(name="API_KEY", value="existing_key")
        conv_var = StringVariable(name="session_id", value="session123")

        variable_pool = VariablePool(
            system_variables=SystemVariable(
                user_id="test_user",
                app_id="test_app",
                query="initial query",
            ),
            environment_variables=[env_var],
            conversation_variables=[conv_var],
            user_inputs={},
        )

        # Add existing variables to pool
        variable_pool.add([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"], env_var)
        variable_pool.add([CONVERSATION_VARIABLE_NODE_ID, "session_id"], conv_var)

        # Define comprehensive variable mapping
        variable_mapping = {
            # System variables mapped to regular nodes
            "sys.user_id": ["start", "user"],
            "sys.app_id": ["start", "app"],
            # Environment variables (won't be overridden)
            "env.API_KEY": ["config", "api_key"],
            # Conversation variables mapped to regular nodes
            "conversation.session_id": ["chat", "session"],
            # Regular variables
            "input.text": ["input", "text"],
            "process.data": ["process", "data"],
        }

        # User inputs
        user_inputs = {
            "sys.user_id": "new_user",
            "sys.app_id": "new_app",
            "env.API_KEY": "attempted_override",  # Should not override env var
            "conversation.session_id": "new_session",
            "input.text": "user input text",
            "process.data": {"value": 123, "status": "active"},
        }

        # Execute mapping
        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        # Verify system variables were added to their target nodes
        start_user = variable_pool.get(["start", "user"])
        assert start_user is not None
        assert start_user.value == "new_user"

        start_app = variable_pool.get(["start", "app"])
        assert start_app is not None
        assert start_app.value == "new_app"

        # Verify env variable was not overridden (still has original value)
        env_value = variable_pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"])
        assert env_value is not None
        assert env_value.value == "existing_key"

        # Environment variables get mapped to other nodes even when they exist in env pool
        # But the original env value remains unchanged
        config_api_key = variable_pool.get(["config", "api_key"])
        assert config_api_key is not None
        assert config_api_key.value == "attempted_override"

        # Verify conversation variable was mapped to target node
        chat_session = variable_pool.get(["chat", "session"])
        assert chat_session is not None
        assert chat_session.value == "new_session"

        # Verify regular variables were added
        input_text = variable_pool.get(["input", "text"])
        assert input_text is not None
        assert input_text.value == "user input text"

        process_data = variable_pool.get(["process", "data"])
        assert process_data is not None
        assert process_data.value == {"value": 123, "status": "active"}

    def test_mapping_user_inputs_with_structured_output_merge(self):
        """Structured output inputs should merge into a single dict variable."""
        variable_pool = VariablePool(system_variables=SystemVariable.default(), user_inputs={})

        variable_mapping = {
            "node1.structured_output.foo": ["node1", "structured_output", "foo"],
            "node1.structured_output.bar": ["node1", "structured_output", "bar"],
        }
        user_inputs = {
            "node1.structured_output.foo": "value_1",
            "node1.structured_output.bar": "value_2",
        }

        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        structured_output = variable_pool.get(["node1", "structured_output"])
        assert structured_output is not None
        assert structured_output.value == {"foo": "value_1", "bar": "value_2"}

    def test_handle_special_values_with_file_and_nested_collections(self):
        """File values should be serialized while other values remain intact."""
        file_value = File(
            tenant_id="test_tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test_related_id",
            remote_url="",
            filename="doc.pdf",
            storage_key="",
        )
        payload = {
            "file": file_value,
            "items": [
                {"file": file_value, "value": 1},
                {"value": 2},
            ],
        }

        converted = WorkflowEntry.handle_special_values(payload)

        assert converted is not None
        assert converted["file"]["filename"] == "doc.pdf"
        assert converted["items"][0]["file"]["filename"] == "doc.pdf"
        assert converted["items"][0]["value"] == 1
        assert converted["items"][1]["value"] == 2

    def test_create_single_node_graph_structure(self):
        """Single node graph should include a start node and an edge."""
        node_id = "node_1"
        node_data = {"type": NodeType.CODE, "title": "Code", "desc": None}

        graph_dict = WorkflowEntry._create_single_node_graph(node_id=node_id, node_data=node_data)

        assert graph_dict["nodes"][0]["id"] == "start"
        assert graph_dict["nodes"][1]["id"] == node_id
        assert graph_dict["edges"][0]["source"] == "start"
        assert graph_dict["edges"][0]["target"] == node_id

    def test_run_free_node_rejects_unsupported_node_type(self):
        """run_free_node should reject non-supported node types."""
        with pytest.raises(ValueError, match="not supported"):
            WorkflowEntry.run_free_node(
                node_data={"type": NodeType.CODE, "title": "Code", "desc": None},
                node_id="node_1",
                tenant_id="tenant",
                user_id="user",
                user_inputs={},
            )

    def test_mapping_user_inputs_with_falsy_primary_value_falls_back(self):
        """Falsy primary input should fall back to key without node prefix."""
        variable_pool = VariablePool(system_variables=SystemVariable.default(), user_inputs={})
        variable_mapping = {
            "node1.count": ["node1", "count"],
        }
        user_inputs = {
            "node1.count": 0,
            "count": 7,
        }

        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id="test_tenant",
        )

        count_var = variable_pool.get(["node1", "count"])
        assert count_var is not None
        assert count_var.value == 7

    def test_handle_special_values_with_list_input(self):
        """Lists are not supported by handle_special_values and should raise."""
        file_value = File(
            tenant_id="test_tenant",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test_related_id",
            remote_url="",
            filename="img.png",
            storage_key="",
        )
        payload = ["a", file_value, {"nested": file_value}]

        with pytest.raises(ValueError) as excinfo:
            WorkflowEntry.handle_special_values(payload)

        assert "dictionary update sequence" in str(excinfo.value)

    def test_init_rejects_excessive_call_depth(self, monkeypatch):
        monkeypatch.setattr(dify_config, "WORKFLOW_CALL_MAX_DEPTH", 0)

        with pytest.raises(ValueError, match="Max workflow call depth"):
            WorkflowEntry(
                tenant_id="tenant",
                app_id="app",
                workflow_id="workflow",
                graph_config={},
                graph=SimpleNamespace(),
                user_id="user",
                user_from=None,
                invoke_from=None,
                call_depth=1,
                variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
                graph_runtime_state=GraphRuntimeState(
                    variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
                    start_at=0.0,
                ),
            )

    def test_init_adds_layers_with_debug_and_otel(self, monkeypatch):
        layers: list[object] = []

        class StubGraphEngine:
            def __init__(self, *args, **kwargs):
                pass

            def layer(self, layer):
                layers.append(layer)

            def run(self):
                return iter(())

        monkeypatch.setattr("core.workflow.workflow_entry.GraphEngine", StubGraphEngine)
        monkeypatch.setattr(dify_config, "DEBUG", True)
        monkeypatch.setattr(dify_config, "ENABLE_OTEL", True)

        entry = WorkflowEntry(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            graph_config={},
            graph=SimpleNamespace(),
            user_id="user",
            user_from=None,
            invoke_from=None,
            call_depth=0,
            variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
            graph_runtime_state=GraphRuntimeState(
                variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
                start_at=0.0,
            ),
        )

        assert entry.graph_engine is not None
        assert len(layers) >= 2

    def test_run_yields_failed_event_on_exception(self, monkeypatch):
        class StubGraphEngine:
            def __init__(self, *args, **kwargs):
                pass

            def layer(self, layer):
                pass

            def run(self):
                raise RuntimeError("boom")

        monkeypatch.setattr("core.workflow.workflow_entry.GraphEngine", StubGraphEngine)
        monkeypatch.setattr(dify_config, "DEBUG", False)
        monkeypatch.setattr(dify_config, "ENABLE_OTEL", False)

        entry = WorkflowEntry(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            graph_config={},
            graph=SimpleNamespace(),
            user_id="user",
            user_from=None,
            invoke_from=None,
            call_depth=0,
            variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
            graph_runtime_state=GraphRuntimeState(
                variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
                start_at=0.0,
            ),
        )

        events = list(entry.run())
        assert len(events) == 1
        assert isinstance(events[0], GraphRunFailedEvent)
        assert events[0].error == "boom"

    def test_run_swallows_generate_task_stopped(self, monkeypatch):
        class StubGraphEngine:
            def __init__(self, *args, **kwargs):
                pass

            def layer(self, layer):
                pass

            def run(self):
                raise GenerateTaskStoppedError

        monkeypatch.setattr("core.workflow.workflow_entry.GraphEngine", StubGraphEngine)
        monkeypatch.setattr(dify_config, "DEBUG", False)
        monkeypatch.setattr(dify_config, "ENABLE_OTEL", False)

        entry = WorkflowEntry(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            graph_config={},
            graph=SimpleNamespace(),
            user_id="user",
            user_from=None,
            invoke_from=None,
            call_depth=0,
            variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
            graph_runtime_state=GraphRuntimeState(
                variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
                start_at=0.0,
            ),
        )

        assert list(entry.run()) == []
