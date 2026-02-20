from core.workflow.nodes.agent.exc import (
    AgentInputTypeError,
    AgentInvocationError,
    AgentMaxIterationError,
    AgentMemoryError,
    AgentMessageTransformError,
    AgentModelError,
    AgentNodeError,
    AgentParameterError,
    AgentStrategyError,
    AgentStrategyNotFoundError,
    AgentVariableError,
    AgentVariableNotFoundError,
    AgentVariableTypeError,
    ToolFileError,
    ToolFileNotFoundError,
)


class TestAgentNodeError:
    def test_base_error_message(self):
        error = AgentNodeError("base error")
        assert isinstance(error, Exception)
        assert str(error) == "base error"
        assert error.message == "base error"


class TestAgentStrategyError:
    def test_strategy_error_with_all_fields(self):
        error = AgentStrategyError(
            "strategy failed",
            strategy_name="test_strategy",
            provider_name="openai",
        )
        assert isinstance(error, AgentNodeError)
        assert error.strategy_name == "test_strategy"
        assert error.provider_name == "openai"
        assert str(error) == "strategy failed"

    def test_strategy_error_without_optional_fields(self):
        error = AgentStrategyError("strategy failed")
        assert error.strategy_name is None
        assert error.provider_name is None
        assert str(error) == "strategy failed"


class TestAgentStrategyNotFoundError:
    def test_not_found_with_provider(self):
        error = AgentStrategyNotFoundError(
            strategy_name="my_strategy",
            provider_name="anthropic",
        )
        assert isinstance(error, AgentStrategyError)
        assert error.strategy_name == "my_strategy"
        assert error.provider_name == "anthropic"
        assert str(error) == "Agent strategy 'my_strategy' not found for provider 'anthropic'"

    def test_not_found_without_provider(self):
        error = AgentStrategyNotFoundError("my_strategy")
        assert error.strategy_name == "my_strategy"
        assert error.provider_name is None
        assert str(error) == "Agent strategy 'my_strategy' not found"


class TestAgentInvocationError:
    def test_invocation_error_with_original(self):
        original = ValueError("inner")
        error = AgentInvocationError("invoke failed", original_error=original)
        assert isinstance(error, AgentNodeError)
        assert error.original_error == original
        assert str(error) == "invoke failed"

    def test_invocation_error_without_original(self):
        error = AgentInvocationError("invoke failed")
        assert error.original_error is None
        assert str(error) == "invoke failed"


class TestAgentParameterError:
    def test_parameter_error_with_name(self):
        error = AgentParameterError("bad param", parameter_name="temperature")
        assert error.parameter_name == "temperature"
        assert str(error) == "bad param"

    def test_parameter_error_without_name(self):
        error = AgentParameterError("bad param")
        assert error.parameter_name is None
        assert str(error) == "bad param"


class TestAgentVariableError:
    def test_variable_error_with_name(self):
        error = AgentVariableError("var error", variable_name="input_var")
        assert error.variable_name == "input_var"
        assert str(error) == "var error"

    def test_variable_error_without_name(self):
        error = AgentVariableError("var error")
        assert error.variable_name is None
        assert str(error) == "var error"


class TestAgentVariableNotFoundError:
    def test_variable_not_found(self):
        error = AgentVariableNotFoundError("missing_var")
        assert isinstance(error, AgentVariableError)
        assert error.variable_name == "missing_var"
        assert str(error) == "Variable 'missing_var' does not exist"


class TestAgentInputTypeError:
    def test_input_type_error(self):
        error = AgentInputTypeError("unknown_type")
        assert isinstance(error, AgentNodeError)
        assert str(error) == "Unknown agent input type 'unknown_type'"


class TestToolFileError:
    def test_tool_file_error_with_id(self):
        error = ToolFileError("file error", file_id="file123")
        assert error.file_id == "file123"
        assert str(error) == "file error"

    def test_tool_file_error_without_id(self):
        error = ToolFileError("file error")
        assert error.file_id is None
        assert str(error) == "file error"


class TestToolFileNotFoundError:
    def test_tool_file_not_found(self):
        error = ToolFileNotFoundError("file123")
        assert isinstance(error, ToolFileError)
        assert error.file_id == "file123"
        assert str(error) == "Tool file 'file123' does not exist"


class TestAgentMessageTransformError:
    def test_message_transform_error_with_original(self):
        original = RuntimeError("transform fail")
        error = AgentMessageTransformError("transform error", original_error=original)
        assert error.original_error == original
        assert str(error) == "transform error"

    def test_message_transform_error_without_original(self):
        error = AgentMessageTransformError("transform error")
        assert error.original_error is None
        assert str(error) == "transform error"


class TestAgentModelError:
    def test_model_error_with_all_fields(self):
        error = AgentModelError(
            "model error",
            model_name="gpt-4",
            provider="openai",
        )
        assert error.model_name == "gpt-4"
        assert error.provider == "openai"
        assert str(error) == "model error"

    def test_model_error_without_optional_fields(self):
        error = AgentModelError("model error")
        assert error.model_name is None
        assert error.provider is None
        assert str(error) == "model error"


class TestAgentMemoryError:
    def test_memory_error_with_conversation_id(self):
        error = AgentMemoryError("memory error", conversation_id="conv123")
        assert error.conversation_id == "conv123"
        assert str(error) == "memory error"

    def test_memory_error_without_conversation_id(self):
        error = AgentMemoryError("memory error")
        assert error.conversation_id is None
        assert str(error) == "memory error"


class TestAgentVariableTypeError:
    def test_variable_type_error_with_all_fields(self):
        error = AgentVariableTypeError(
            "type error",
            variable_name="var1",
            expected_type="str",
            actual_type="int",
        )
        assert error.variable_name == "var1"
        assert error.expected_type == "str"
        assert error.actual_type == "int"
        assert str(error) == "type error"

    def test_variable_type_error_without_optional_fields(self):
        error = AgentVariableTypeError("type error")
        assert error.variable_name is None
        assert error.expected_type is None
        assert error.actual_type is None
        assert str(error) == "type error"


class TestAgentMaxIterationError:
    def test_max_iteration_error(self):
        error = AgentMaxIterationError(5)
        assert isinstance(error, AgentNodeError)
        assert error.max_iteration == 5
        assert "Agent exceeded the maximum iteration limit of 5." in str(error)
        assert "allowed number of iterations" in str(error)
