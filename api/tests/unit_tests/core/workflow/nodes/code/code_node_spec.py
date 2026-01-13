from configs import dify_config
from core.helper.code_executor.code_executor import CodeLanguage
from core.variables.types import SegmentType
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.code.entities import CodeNodeData
from core.workflow.nodes.code.exc import (
    CodeNodeError,
    DepthLimitError,
    OutputValidationError,
)
from core.workflow.nodes.code.limits import CodeNodeLimits

CodeNode._limits = CodeNodeLimits(
    max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
    max_number=dify_config.CODE_MAX_NUMBER,
    min_number=dify_config.CODE_MIN_NUMBER,
    max_precision=dify_config.CODE_MAX_PRECISION,
    max_depth=dify_config.CODE_MAX_DEPTH,
    max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
    max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
    max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
)


class TestCodeNodeExceptions:
    """Test suite for code node exceptions."""

    def test_code_node_error_is_value_error(self):
        """Test CodeNodeError inherits from ValueError."""
        error = CodeNodeError("test error")

        assert isinstance(error, ValueError)
        assert str(error) == "test error"

    def test_output_validation_error_is_code_node_error(self):
        """Test OutputValidationError inherits from CodeNodeError."""
        error = OutputValidationError("validation failed")

        assert isinstance(error, CodeNodeError)
        assert isinstance(error, ValueError)
        assert str(error) == "validation failed"

    def test_depth_limit_error_is_code_node_error(self):
        """Test DepthLimitError inherits from CodeNodeError."""
        error = DepthLimitError("depth exceeded")

        assert isinstance(error, CodeNodeError)
        assert isinstance(error, ValueError)
        assert str(error) == "depth exceeded"

    def test_code_node_error_with_empty_message(self):
        """Test CodeNodeError with empty message."""
        error = CodeNodeError("")

        assert str(error) == ""

    def test_output_validation_error_with_field_info(self):
        """Test OutputValidationError with field information."""
        error = OutputValidationError("Output 'result' is not a valid type")

        assert "result" in str(error)
        assert "not a valid type" in str(error)

    def test_depth_limit_error_with_limit_info(self):
        """Test DepthLimitError with limit information."""
        error = DepthLimitError("Depth limit 5 reached, object too deep")

        assert "5" in str(error)
        assert "too deep" in str(error)


class TestCodeNodeClassMethods:
    """Test suite for CodeNode class methods."""

    def test_code_node_version(self):
        """Test CodeNode version method."""
        version = CodeNode.version()

        assert version == "1"

    def test_get_default_config_python3(self):
        """Test get_default_config for Python3."""
        config = CodeNode.get_default_config(filters={"code_language": CodeLanguage.PYTHON3})

        assert config is not None
        assert isinstance(config, dict)

    def test_get_default_config_javascript(self):
        """Test get_default_config for JavaScript."""
        config = CodeNode.get_default_config(filters={"code_language": CodeLanguage.JAVASCRIPT})

        assert config is not None
        assert isinstance(config, dict)

    def test_get_default_config_no_filters(self):
        """Test get_default_config with no filters defaults to Python3."""
        config = CodeNode.get_default_config()

        assert config is not None
        assert isinstance(config, dict)

    def test_get_default_config_empty_filters(self):
        """Test get_default_config with empty filters."""
        config = CodeNode.get_default_config(filters={})

        assert config is not None


class TestCodeNodeCheckMethods:
    """Test suite for CodeNode check methods."""

    def test_check_string_none_value(self):
        """Test _check_string with None value."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_string(None, "test_var")

        assert result is None

    def test_check_string_removes_null_bytes(self):
        """Test _check_string removes null bytes."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_string("hello\x00world", "test_var")

        assert result == "helloworld"
        assert "\x00" not in result

    def test_check_string_valid_string(self):
        """Test _check_string with valid string."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_string("valid string", "test_var")

        assert result == "valid string"

    def test_check_string_empty_string(self):
        """Test _check_string with empty string."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_string("", "test_var")

        assert result == ""

    def test_check_string_with_unicode(self):
        """Test _check_string with unicode characters."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_string("你好世界🌍", "test_var")

        assert result == "你好世界🌍"

    def test_check_boolean_none_value(self):
        """Test _check_boolean with None value."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_boolean(None, "test_var")

        assert result is None

    def test_check_boolean_true_value(self):
        """Test _check_boolean with True value."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_boolean(True, "test_var")

        assert result is True

    def test_check_boolean_false_value(self):
        """Test _check_boolean with False value."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_boolean(False, "test_var")

        assert result is False

    def test_check_number_none_value(self):
        """Test _check_number with None value."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_number(None, "test_var")

        assert result is None

    def test_check_number_integer_value(self):
        """Test _check_number with integer value."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_number(42, "test_var")

        assert result == 42

    def test_check_number_float_value(self):
        """Test _check_number with float value."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_number(3.14, "test_var")

        assert result == 3.14

    def test_check_number_zero(self):
        """Test _check_number with zero."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_number(0, "test_var")

        assert result == 0

    def test_check_number_negative(self):
        """Test _check_number with negative number."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_number(-100, "test_var")

        assert result == -100

    def test_check_number_negative_float(self):
        """Test _check_number with negative float."""
        node = CodeNode.__new__(CodeNode)
        result = node._check_number(-3.14159, "test_var")

        assert result == -3.14159


class TestCodeNodeConvertBooleanToInt:
    """Test suite for _convert_boolean_to_int static method."""

    def test_convert_none_returns_none(self):
        """Test converting None returns None."""
        result = CodeNode._convert_boolean_to_int(None)

        assert result is None

    def test_convert_true_returns_one(self):
        """Test converting True returns 1."""
        result = CodeNode._convert_boolean_to_int(True)

        assert result == 1
        assert isinstance(result, int)

    def test_convert_false_returns_zero(self):
        """Test converting False returns 0."""
        result = CodeNode._convert_boolean_to_int(False)

        assert result == 0
        assert isinstance(result, int)

    def test_convert_integer_returns_same(self):
        """Test converting integer returns same value."""
        result = CodeNode._convert_boolean_to_int(42)

        assert result == 42

    def test_convert_float_returns_same(self):
        """Test converting float returns same value."""
        result = CodeNode._convert_boolean_to_int(3.14)

        assert result == 3.14

    def test_convert_zero_returns_zero(self):
        """Test converting zero returns zero."""
        result = CodeNode._convert_boolean_to_int(0)

        assert result == 0

    def test_convert_negative_returns_same(self):
        """Test converting negative number returns same value."""
        result = CodeNode._convert_boolean_to_int(-100)

        assert result == -100


class TestCodeNodeExtractVariableSelector:
    """Test suite for _extract_variable_selector_to_variable_mapping."""

    def test_extract_empty_variables(self):
        """Test extraction with no variables."""
        node_data = {
            "title": "Test",
            "variables": [],
            "code_language": "python3",
            "code": "def main(): return {}",
            "outputs": {},
        }

        result = CodeNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node_1",
            node_data=node_data,
        )

        assert result == {}

    def test_extract_single_variable(self):
        """Test extraction with single variable."""
        node_data = {
            "title": "Test",
            "variables": [
                {"variable": "input_text", "value_selector": ["start", "text"]},
            ],
            "code_language": "python3",
            "code": "def main(): return {}",
            "outputs": {},
        }

        result = CodeNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node_1",
            node_data=node_data,
        )

        assert "node_1.input_text" in result
        assert result["node_1.input_text"] == ["start", "text"]

    def test_extract_multiple_variables(self):
        """Test extraction with multiple variables."""
        node_data = {
            "title": "Test",
            "variables": [
                {"variable": "var1", "value_selector": ["node_a", "output1"]},
                {"variable": "var2", "value_selector": ["node_b", "output2"]},
                {"variable": "var3", "value_selector": ["node_c", "output3"]},
            ],
            "code_language": "python3",
            "code": "def main(): return {}",
            "outputs": {},
        }

        result = CodeNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="code_node",
            node_data=node_data,
        )

        assert len(result) == 3
        assert "code_node.var1" in result
        assert "code_node.var2" in result
        assert "code_node.var3" in result

    def test_extract_with_nested_selector(self):
        """Test extraction with nested value selector."""
        node_data = {
            "title": "Test",
            "variables": [
                {"variable": "deep_var", "value_selector": ["node", "obj", "nested", "value"]},
            ],
            "code_language": "python3",
            "code": "def main(): return {}",
            "outputs": {},
        }

        result = CodeNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node_x",
            node_data=node_data,
        )

        assert result["node_x.deep_var"] == ["node", "obj", "nested", "value"]


class TestCodeNodeDataValidation:
    """Test suite for CodeNodeData validation scenarios."""

    def test_valid_python3_code_node_data(self):
        """Test valid Python3 CodeNodeData."""
        data = CodeNodeData(
            title="Python Code",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {'result': 1}",
            outputs={"result": CodeNodeData.Output(type=SegmentType.NUMBER)},
        )

        assert data.code_language == CodeLanguage.PYTHON3

    def test_valid_javascript_code_node_data(self):
        """Test valid JavaScript CodeNodeData."""
        data = CodeNodeData(
            title="JS Code",
            variables=[],
            code_language=CodeLanguage.JAVASCRIPT,
            code="function main() { return { result: 1 }; }",
            outputs={"result": CodeNodeData.Output(type=SegmentType.NUMBER)},
        )

        assert data.code_language == CodeLanguage.JAVASCRIPT

    def test_code_node_data_with_all_output_types(self):
        """Test CodeNodeData with all valid output types."""
        data = CodeNodeData(
            title="All Types",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {}",
            outputs={
                "str_out": CodeNodeData.Output(type=SegmentType.STRING),
                "num_out": CodeNodeData.Output(type=SegmentType.NUMBER),
                "bool_out": CodeNodeData.Output(type=SegmentType.BOOLEAN),
                "obj_out": CodeNodeData.Output(type=SegmentType.OBJECT),
                "arr_str": CodeNodeData.Output(type=SegmentType.ARRAY_STRING),
                "arr_num": CodeNodeData.Output(type=SegmentType.ARRAY_NUMBER),
                "arr_bool": CodeNodeData.Output(type=SegmentType.ARRAY_BOOLEAN),
                "arr_obj": CodeNodeData.Output(type=SegmentType.ARRAY_OBJECT),
            },
        )

        assert len(data.outputs) == 8

    def test_code_node_data_complex_nested_output(self):
        """Test CodeNodeData with complex nested output structure."""
        data = CodeNodeData(
            title="Complex Output",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {}",
            outputs={
                "response": CodeNodeData.Output(
                    type=SegmentType.OBJECT,
                    children={
                        "data": CodeNodeData.Output(
                            type=SegmentType.OBJECT,
                            children={
                                "items": CodeNodeData.Output(type=SegmentType.ARRAY_STRING),
                                "count": CodeNodeData.Output(type=SegmentType.NUMBER),
                            },
                        ),
                        "status": CodeNodeData.Output(type=SegmentType.STRING),
                        "success": CodeNodeData.Output(type=SegmentType.BOOLEAN),
                    },
                ),
            },
        )

        assert data.outputs["response"].type == SegmentType.OBJECT
        assert data.outputs["response"].children is not None
        assert "data" in data.outputs["response"].children
        assert data.outputs["response"].children["data"].children is not None


class TestCodeNodeInitialization:
    """Test suite for CodeNode initialization methods."""

    def test_init_node_data_python3(self):
        """Test init_node_data with Python3 configuration."""
        node = CodeNode.__new__(CodeNode)
        data = {
            "title": "Test Node",
            "variables": [],
            "code_language": "python3",
            "code": "def main(): return {'x': 1}",
            "outputs": {"x": {"type": "number"}},
        }

        node.init_node_data(data)

        assert node._node_data.title == "Test Node"
        assert node._node_data.code_language == CodeLanguage.PYTHON3

    def test_init_node_data_javascript(self):
        """Test init_node_data with JavaScript configuration."""
        node = CodeNode.__new__(CodeNode)
        data = {
            "title": "JS Node",
            "variables": [],
            "code_language": "javascript",
            "code": "function main() { return { x: 1 }; }",
            "outputs": {"x": {"type": "number"}},
        }

        node.init_node_data(data)

        assert node._node_data.code_language == CodeLanguage.JAVASCRIPT

    def test_get_title(self):
        """Test _get_title method."""
        node = CodeNode.__new__(CodeNode)
        node._node_data = CodeNodeData(
            title="My Code Node",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="",
            outputs={},
        )

        assert node._get_title() == "My Code Node"

    def test_get_description_none(self):
        """Test _get_description returns None when not set."""
        node = CodeNode.__new__(CodeNode)
        node._node_data = CodeNodeData(
            title="Test",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="",
            outputs={},
        )

        assert node._get_description() is None

    def test_node_data_property(self):
        """Test node_data property returns node data."""
        node = CodeNode.__new__(CodeNode)
        node._node_data = CodeNodeData(
            title="Base Test",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="",
            outputs={},
        )

        result = node.node_data

        assert result == node._node_data
        assert result.title == "Base Test"
