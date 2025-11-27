import pytest
from pydantic import ValidationError

from core.helper.code_executor.code_executor import CodeLanguage
from core.variables.types import SegmentType
from core.workflow.nodes.code.entities import CodeNodeData


class TestCodeNodeDataOutput:
    """Test suite for CodeNodeData.Output model."""

    def test_output_with_string_type(self):
        """Test Output with STRING type."""
        output = CodeNodeData.Output(type=SegmentType.STRING)

        assert output.type == SegmentType.STRING
        assert output.children is None

    def test_output_with_number_type(self):
        """Test Output with NUMBER type."""
        output = CodeNodeData.Output(type=SegmentType.NUMBER)

        assert output.type == SegmentType.NUMBER
        assert output.children is None

    def test_output_with_boolean_type(self):
        """Test Output with BOOLEAN type."""
        output = CodeNodeData.Output(type=SegmentType.BOOLEAN)

        assert output.type == SegmentType.BOOLEAN

    def test_output_with_object_type(self):
        """Test Output with OBJECT type."""
        output = CodeNodeData.Output(type=SegmentType.OBJECT)

        assert output.type == SegmentType.OBJECT

    def test_output_with_array_string_type(self):
        """Test Output with ARRAY_STRING type."""
        output = CodeNodeData.Output(type=SegmentType.ARRAY_STRING)

        assert output.type == SegmentType.ARRAY_STRING

    def test_output_with_array_number_type(self):
        """Test Output with ARRAY_NUMBER type."""
        output = CodeNodeData.Output(type=SegmentType.ARRAY_NUMBER)

        assert output.type == SegmentType.ARRAY_NUMBER

    def test_output_with_array_object_type(self):
        """Test Output with ARRAY_OBJECT type."""
        output = CodeNodeData.Output(type=SegmentType.ARRAY_OBJECT)

        assert output.type == SegmentType.ARRAY_OBJECT

    def test_output_with_array_boolean_type(self):
        """Test Output with ARRAY_BOOLEAN type."""
        output = CodeNodeData.Output(type=SegmentType.ARRAY_BOOLEAN)

        assert output.type == SegmentType.ARRAY_BOOLEAN

    def test_output_with_nested_children(self):
        """Test Output with nested children for OBJECT type."""
        child_output = CodeNodeData.Output(type=SegmentType.STRING)
        parent_output = CodeNodeData.Output(
            type=SegmentType.OBJECT,
            children={"name": child_output},
        )

        assert parent_output.type == SegmentType.OBJECT
        assert parent_output.children is not None
        assert "name" in parent_output.children
        assert parent_output.children["name"].type == SegmentType.STRING

    def test_output_with_deeply_nested_children(self):
        """Test Output with deeply nested children."""
        inner_child = CodeNodeData.Output(type=SegmentType.NUMBER)
        middle_child = CodeNodeData.Output(
            type=SegmentType.OBJECT,
            children={"value": inner_child},
        )
        outer_output = CodeNodeData.Output(
            type=SegmentType.OBJECT,
            children={"nested": middle_child},
        )

        assert outer_output.children is not None
        assert outer_output.children["nested"].children is not None
        assert outer_output.children["nested"].children["value"].type == SegmentType.NUMBER

    def test_output_with_multiple_children(self):
        """Test Output with multiple children."""
        output = CodeNodeData.Output(
            type=SegmentType.OBJECT,
            children={
                "name": CodeNodeData.Output(type=SegmentType.STRING),
                "age": CodeNodeData.Output(type=SegmentType.NUMBER),
                "active": CodeNodeData.Output(type=SegmentType.BOOLEAN),
            },
        )

        assert output.children is not None
        assert len(output.children) == 3
        assert output.children["name"].type == SegmentType.STRING
        assert output.children["age"].type == SegmentType.NUMBER
        assert output.children["active"].type == SegmentType.BOOLEAN

    def test_output_rejects_invalid_type(self):
        """Test Output rejects invalid segment types."""
        with pytest.raises(ValidationError):
            CodeNodeData.Output(type=SegmentType.FILE)

    def test_output_rejects_array_file_type(self):
        """Test Output rejects ARRAY_FILE type."""
        with pytest.raises(ValidationError):
            CodeNodeData.Output(type=SegmentType.ARRAY_FILE)


class TestCodeNodeDataDependency:
    """Test suite for CodeNodeData.Dependency model."""

    def test_dependency_basic(self):
        """Test Dependency with name and version."""
        dependency = CodeNodeData.Dependency(name="numpy", version="1.24.0")

        assert dependency.name == "numpy"
        assert dependency.version == "1.24.0"

    def test_dependency_with_complex_version(self):
        """Test Dependency with complex version string."""
        dependency = CodeNodeData.Dependency(name="pandas", version=">=2.0.0,<3.0.0")

        assert dependency.name == "pandas"
        assert dependency.version == ">=2.0.0,<3.0.0"

    def test_dependency_with_empty_version(self):
        """Test Dependency with empty version."""
        dependency = CodeNodeData.Dependency(name="requests", version="")

        assert dependency.name == "requests"
        assert dependency.version == ""


class TestCodeNodeData:
    """Test suite for CodeNodeData model."""

    def test_code_node_data_python3(self):
        """Test CodeNodeData with Python3 language."""
        data = CodeNodeData(
            title="Test Code Node",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {'result': 42}",
            outputs={"result": CodeNodeData.Output(type=SegmentType.NUMBER)},
        )

        assert data.title == "Test Code Node"
        assert data.code_language == CodeLanguage.PYTHON3
        assert data.code == "def main(): return {'result': 42}"
        assert "result" in data.outputs
        assert data.dependencies is None

    def test_code_node_data_javascript(self):
        """Test CodeNodeData with JavaScript language."""
        data = CodeNodeData(
            title="JS Code Node",
            variables=[],
            code_language=CodeLanguage.JAVASCRIPT,
            code="function main() { return { result: 'hello' }; }",
            outputs={"result": CodeNodeData.Output(type=SegmentType.STRING)},
        )

        assert data.code_language == CodeLanguage.JAVASCRIPT
        assert "result" in data.outputs
        assert data.outputs["result"].type == SegmentType.STRING

    def test_code_node_data_with_dependencies(self):
        """Test CodeNodeData with dependencies."""
        data = CodeNodeData(
            title="Code with Deps",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="import numpy as np\ndef main(): return {'sum': 10}",
            outputs={"sum": CodeNodeData.Output(type=SegmentType.NUMBER)},
            dependencies=[
                CodeNodeData.Dependency(name="numpy", version="1.24.0"),
                CodeNodeData.Dependency(name="pandas", version="2.0.0"),
            ],
        )

        assert data.dependencies is not None
        assert len(data.dependencies) == 2
        assert data.dependencies[0].name == "numpy"
        assert data.dependencies[1].name == "pandas"

    def test_code_node_data_with_multiple_outputs(self):
        """Test CodeNodeData with multiple outputs."""
        data = CodeNodeData(
            title="Multi Output",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {'name': 'test', 'count': 5, 'items': ['a', 'b']}",
            outputs={
                "name": CodeNodeData.Output(type=SegmentType.STRING),
                "count": CodeNodeData.Output(type=SegmentType.NUMBER),
                "items": CodeNodeData.Output(type=SegmentType.ARRAY_STRING),
            },
        )

        assert len(data.outputs) == 3
        assert data.outputs["name"].type == SegmentType.STRING
        assert data.outputs["count"].type == SegmentType.NUMBER
        assert data.outputs["items"].type == SegmentType.ARRAY_STRING

    def test_code_node_data_with_object_output(self):
        """Test CodeNodeData with nested object output."""
        data = CodeNodeData(
            title="Object Output",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {'user': {'name': 'John', 'age': 30}}",
            outputs={
                "user": CodeNodeData.Output(
                    type=SegmentType.OBJECT,
                    children={
                        "name": CodeNodeData.Output(type=SegmentType.STRING),
                        "age": CodeNodeData.Output(type=SegmentType.NUMBER),
                    },
                ),
            },
        )

        assert data.outputs["user"].type == SegmentType.OBJECT
        assert data.outputs["user"].children is not None
        assert len(data.outputs["user"].children) == 2

    def test_code_node_data_with_array_object_output(self):
        """Test CodeNodeData with array of objects output."""
        data = CodeNodeData(
            title="Array Object Output",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {'users': [{'name': 'A'}, {'name': 'B'}]}",
            outputs={
                "users": CodeNodeData.Output(
                    type=SegmentType.ARRAY_OBJECT,
                    children={
                        "name": CodeNodeData.Output(type=SegmentType.STRING),
                    },
                ),
            },
        )

        assert data.outputs["users"].type == SegmentType.ARRAY_OBJECT
        assert data.outputs["users"].children is not None

    def test_code_node_data_empty_code(self):
        """Test CodeNodeData with empty code."""
        data = CodeNodeData(
            title="Empty Code",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="",
            outputs={},
        )

        assert data.code == ""
        assert len(data.outputs) == 0

    def test_code_node_data_multiline_code(self):
        """Test CodeNodeData with multiline code."""
        multiline_code = """
def main():
    result = 0
    for i in range(10):
        result += i
    return {'sum': result}
"""
        data = CodeNodeData(
            title="Multiline Code",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code=multiline_code,
            outputs={"sum": CodeNodeData.Output(type=SegmentType.NUMBER)},
        )

        assert "for i in range(10)" in data.code
        assert "result += i" in data.code

    def test_code_node_data_with_special_characters_in_code(self):
        """Test CodeNodeData with special characters in code."""
        code_with_special = "def main(): return {'msg': 'Hello\\nWorld\\t!'}"
        data = CodeNodeData(
            title="Special Chars",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code=code_with_special,
            outputs={"msg": CodeNodeData.Output(type=SegmentType.STRING)},
        )

        assert "\\n" in data.code
        assert "\\t" in data.code

    def test_code_node_data_with_unicode_in_code(self):
        """Test CodeNodeData with unicode characters in code."""
        unicode_code = "def main(): return {'greeting': '你好世界'}"
        data = CodeNodeData(
            title="Unicode Code",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code=unicode_code,
            outputs={"greeting": CodeNodeData.Output(type=SegmentType.STRING)},
        )

        assert "你好世界" in data.code

    def test_code_node_data_empty_dependencies_list(self):
        """Test CodeNodeData with empty dependencies list."""
        data = CodeNodeData(
            title="No Deps",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {}",
            outputs={},
            dependencies=[],
        )

        assert data.dependencies is not None
        assert len(data.dependencies) == 0

    def test_code_node_data_with_boolean_array_output(self):
        """Test CodeNodeData with boolean array output."""
        data = CodeNodeData(
            title="Boolean Array",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {'flags': [True, False, True]}",
            outputs={"flags": CodeNodeData.Output(type=SegmentType.ARRAY_BOOLEAN)},
        )

        assert data.outputs["flags"].type == SegmentType.ARRAY_BOOLEAN

    def test_code_node_data_with_number_array_output(self):
        """Test CodeNodeData with number array output."""
        data = CodeNodeData(
            title="Number Array",
            variables=[],
            code_language=CodeLanguage.PYTHON3,
            code="def main(): return {'values': [1, 2, 3, 4, 5]}",
            outputs={"values": CodeNodeData.Output(type=SegmentType.ARRAY_NUMBER)},
        )

        assert data.outputs["values"].type == SegmentType.ARRAY_NUMBER
