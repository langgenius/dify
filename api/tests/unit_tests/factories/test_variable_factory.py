import math
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from core.file import File, FileTransferMethod, FileType
from core.variables import (
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FloatVariable,
    IntegerVariable,
    SecretVariable,
    StringVariable,
)
from core.variables.exc import VariableError
from core.variables.segments import (
    ArrayAnySegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayObjectSegment,
    ArrayStringSegment,
    BooleanSegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    Segment,
    StringSegment,
)
from core.variables.types import SegmentType
from factories import variable_factory
from factories.variable_factory import TypeMismatchError, build_segment, build_segment_with_type


def test_string_variable():
    test_data = {"value_type": "string", "name": "test_text", "value": "Hello, World!"}
    result = variable_factory.build_conversation_variable_from_mapping(test_data)
    assert isinstance(result, StringVariable)


def test_integer_variable():
    test_data = {"value_type": "number", "name": "test_int", "value": 42}
    result = variable_factory.build_conversation_variable_from_mapping(test_data)
    assert isinstance(result, IntegerVariable)


def test_float_variable():
    test_data = {"value_type": "number", "name": "test_float", "value": 3.14}
    result = variable_factory.build_conversation_variable_from_mapping(test_data)
    assert isinstance(result, FloatVariable)


def test_secret_variable():
    test_data = {"value_type": "secret", "name": "test_secret", "value": "secret_value"}
    result = variable_factory.build_conversation_variable_from_mapping(test_data)
    assert isinstance(result, SecretVariable)


def test_invalid_value_type():
    test_data = {"value_type": "unknown", "name": "test_invalid", "value": "value"}
    with pytest.raises(VariableError):
        variable_factory.build_conversation_variable_from_mapping(test_data)


def test_build_a_blank_string():
    result = variable_factory.build_conversation_variable_from_mapping(
        {
            "value_type": "string",
            "name": "blank",
            "value": "",
        }
    )
    assert isinstance(result, StringVariable)
    assert result.value == ""


def test_build_a_object_variable_with_none_value():
    var = variable_factory.build_segment(
        {
            "key1": None,
        }
    )
    assert isinstance(var, ObjectSegment)
    assert var.value["key1"] is None


def test_object_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "object",
        "name": "test_object",
        "description": "Description of the variable.",
        "value": {
            "key1": "text",
            "key2": 2,
        },
    }
    variable = variable_factory.build_conversation_variable_from_mapping(mapping)
    assert isinstance(variable, ObjectSegment)
    assert isinstance(variable.value["key1"], str)
    assert isinstance(variable.value["key2"], int)


def test_array_string_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "array[string]",
        "name": "test_array",
        "description": "Description of the variable.",
        "value": [
            "text",
            "text",
        ],
    }
    variable = variable_factory.build_conversation_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayStringVariable)
    assert isinstance(variable.value[0], str)
    assert isinstance(variable.value[1], str)


def test_array_number_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "array[number]",
        "name": "test_array",
        "description": "Description of the variable.",
        "value": [
            1,
            2.0,
        ],
    }
    variable = variable_factory.build_conversation_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayNumberVariable)
    assert isinstance(variable.value[0], int)
    assert isinstance(variable.value[1], float)


def test_build_segment_scalar_values():
    @dataclass
    class TestCase:
        value: Any
        expected: Segment
        description: str

    cases = [
        TestCase(
            value=True,
            expected=BooleanSegment(value=True),
            description="build_segment with boolean should yield BooleanSegment",
        )
    ]

    for idx, c in enumerate(cases, 1):
        seg = build_segment(c.value)
        assert seg == c.expected, f"Test case {idx} failed: {c.description}"


def test_array_object_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "array[object]",
        "name": "test_array",
        "description": "Description of the variable.",
        "value": [
            {
                "key1": "text",
                "key2": 1,
            },
            {
                "key1": "text",
                "key2": 1,
            },
        ],
    }
    variable = variable_factory.build_conversation_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayObjectVariable)
    assert isinstance(variable.value[0], dict)
    assert isinstance(variable.value[1], dict)
    assert isinstance(variable.value[0]["key1"], str)
    assert isinstance(variable.value[0]["key2"], int)
    assert isinstance(variable.value[1]["key1"], str)
    assert isinstance(variable.value[1]["key2"], int)


def test_variable_cannot_large_than_200_kb():
    with pytest.raises(VariableError):
        variable_factory.build_conversation_variable_from_mapping(
            {
                "id": str(uuid4()),
                "value_type": "string",
                "name": "test_text",
                "value": "a" * 1024 * 201,
            }
        )


def test_array_none_variable():
    var = variable_factory.build_segment([None, None, None, None])
    assert isinstance(var, ArrayAnySegment)
    assert var.value == [None, None, None, None]


def test_build_segment_none_type():
    """Test building NoneSegment from None value."""
    segment = variable_factory.build_segment(None)
    assert isinstance(segment, NoneSegment)
    assert segment.value is None
    assert segment.value_type == SegmentType.NONE


def test_build_segment_none_type_properties():
    """Test NoneSegment properties and methods."""
    segment = variable_factory.build_segment(None)
    assert segment.text == ""
    assert segment.log == ""
    assert segment.markdown == ""
    assert segment.to_object() is None


def test_build_segment_array_file_single_file():
    """Test building ArrayFileSegment from list with single file."""
    file = File(
        id="test_file_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://test.example.com/test-file.png",
        filename="test-file",
        extension=".png",
        mime_type="image/png",
        size=1000,
    )
    segment = variable_factory.build_segment([file])
    assert isinstance(segment, ArrayFileSegment)
    assert len(segment.value) == 1
    assert segment.value[0] == file
    assert segment.value_type == SegmentType.ARRAY_FILE


def test_build_segment_array_file_multiple_files():
    """Test building ArrayFileSegment from list with multiple files."""
    file1 = File(
        id="test_file_id_1",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://test.example.com/test-file1.png",
        filename="test-file1",
        extension=".png",
        mime_type="image/png",
        size=1000,
    )
    file2 = File(
        id="test_file_id_2",
        tenant_id="test_tenant_id",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="test_relation_id",
        filename="test-file2",
        extension=".txt",
        mime_type="text/plain",
        size=500,
    )
    segment = variable_factory.build_segment([file1, file2])
    assert isinstance(segment, ArrayFileSegment)
    assert len(segment.value) == 2
    assert segment.value[0] == file1
    assert segment.value[1] == file2
    assert segment.value_type == SegmentType.ARRAY_FILE


def test_build_segment_array_file_empty_list():
    """Test building ArrayFileSegment from empty list should create ArrayAnySegment."""
    segment = variable_factory.build_segment([])
    assert isinstance(segment, ArrayAnySegment)
    assert segment.value == []
    assert segment.value_type == SegmentType.ARRAY_ANY


def test_build_segment_array_any_mixed_types():
    """Test building ArrayAnySegment from list with mixed types."""
    mixed_values = ["string", 42, 3.14, {"key": "value"}, None]
    segment = variable_factory.build_segment(mixed_values)
    assert isinstance(segment, ArrayAnySegment)
    assert segment.value == mixed_values
    assert segment.value_type == SegmentType.ARRAY_ANY


def test_build_segment_array_any_with_nested_arrays():
    """Test building ArrayAnySegment from list containing arrays."""
    nested_values = [["nested", "array"], [1, 2, 3], "string"]
    segment = variable_factory.build_segment(nested_values)
    assert isinstance(segment, ArrayAnySegment)
    assert segment.value == nested_values
    assert segment.value_type == SegmentType.ARRAY_ANY


def test_build_segment_array_any_mixed_with_files():
    """Test building ArrayAnySegment from list with files and other types."""
    file = File(
        id="test_file_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://test.example.com/test-file.png",
        filename="test-file",
        extension=".png",
        mime_type="image/png",
        size=1000,
    )
    mixed_values = [file, "string", 42]
    segment = variable_factory.build_segment(mixed_values)
    assert isinstance(segment, ArrayAnySegment)
    assert segment.value == mixed_values
    assert segment.value_type == SegmentType.ARRAY_ANY


def test_build_segment_array_any_all_none_values():
    """Test building ArrayAnySegment from list with all None values."""
    none_values = [None, None, None]
    segment = variable_factory.build_segment(none_values)
    assert isinstance(segment, ArrayAnySegment)
    assert segment.value == none_values
    assert segment.value_type == SegmentType.ARRAY_ANY


def test_build_segment_array_file_properties():
    """Test ArrayFileSegment properties and methods."""
    file1 = File(
        id="test_file_id_1",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://test.example.com/test-file1.png",
        filename="test-file1",
        extension=".png",
        mime_type="image/png",
        size=1000,
    )
    file2 = File(
        id="test_file_id_2",
        tenant_id="test_tenant_id",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://test.example.com/test-file2.txt",
        filename="test-file2",
        extension=".txt",
        mime_type="text/plain",
        size=500,
    )
    segment = variable_factory.build_segment([file1, file2])

    # Test properties
    assert segment.text == ""  # ArrayFileSegment text property returns empty string
    assert segment.log == ""  # ArrayFileSegment log property returns empty string
    assert segment.markdown == f"{file1.markdown}\n{file2.markdown}"
    assert segment.to_object() == [file1, file2]


def test_build_segment_array_any_properties():
    """Test ArrayAnySegment properties and methods."""
    mixed_values = ["string", 42, None]
    segment = variable_factory.build_segment(mixed_values)

    # Test properties
    assert segment.text == str(mixed_values)
    assert segment.log == str(mixed_values)
    assert segment.markdown == "- string\n- 42\n- None"
    assert segment.to_object() == mixed_values


def test_build_segment_edge_cases():
    """Test edge cases for build_segment function."""
    # Test with complex nested structures
    complex_structure = [{"nested": {"deep": [1, 2, 3]}}, [{"inner": "value"}], "mixed"]
    segment = variable_factory.build_segment(complex_structure)
    assert isinstance(segment, ArrayAnySegment)
    assert segment.value == complex_structure

    # Test with single None in list
    single_none = [None]
    segment = variable_factory.build_segment(single_none)
    assert isinstance(segment, ArrayAnySegment)
    assert segment.value == single_none


def test_build_segment_file_array_with_different_file_types():
    """Test ArrayFileSegment with different file types."""
    image_file = File(
        id="image_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://test.example.com/image.png",
        filename="image",
        extension=".png",
        mime_type="image/png",
        size=1000,
    )

    video_file = File(
        id="video_id",
        tenant_id="test_tenant_id",
        type=FileType.VIDEO,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="video_relation_id",
        filename="video",
        extension=".mp4",
        mime_type="video/mp4",
        size=5000,
    )

    audio_file = File(
        id="audio_id",
        tenant_id="test_tenant_id",
        type=FileType.AUDIO,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="audio_relation_id",
        filename="audio",
        extension=".mp3",
        mime_type="audio/mpeg",
        size=3000,
    )

    segment = variable_factory.build_segment([image_file, video_file, audio_file])
    assert isinstance(segment, ArrayFileSegment)
    assert len(segment.value) == 3
    assert segment.value[0].type == FileType.IMAGE
    assert segment.value[1].type == FileType.VIDEO
    assert segment.value[2].type == FileType.AUDIO


@st.composite
def _generate_file(draw) -> File:
    file_type, mime_type, extension = draw(
        st.sampled_from(
            [
                (FileType.IMAGE, "image/png", ".png"),
                (FileType.VIDEO, "video/mp4", ".mp4"),
                (FileType.DOCUMENT, "text/plain", ".txt"),
                (FileType.AUDIO, "audio/mpeg", ".mp3"),
            ]
        )
    )
    filename = "test-file"
    size = draw(st.integers(min_value=0, max_value=1024 * 1024))

    transfer_method = draw(st.sampled_from(list(FileTransferMethod)))
    if transfer_method == FileTransferMethod.REMOTE_URL:
        url = "https://test.example.com/test-file"
        file = File(
            id="test_file_id",
            tenant_id="test_tenant_id",
            type=file_type,
            transfer_method=transfer_method,
            remote_url=url,
            related_id=None,
            filename=filename,
            extension=extension,
            mime_type=mime_type,
            size=size,
        )
    else:
        relation_id = draw(st.uuids(version=4))

        file = File(
            id="test_file_id",
            tenant_id="test_tenant_id",
            type=file_type,
            transfer_method=transfer_method,
            related_id=str(relation_id),
            filename=filename,
            extension=extension,
            mime_type=mime_type,
            size=size,
        )
    return file


def _scalar_value() -> st.SearchStrategy[int | float | str | File | None]:
    return st.one_of(
        st.none(),
        st.integers(min_value=-(10**6), max_value=10**6),
        st.floats(allow_nan=True, allow_infinity=False),
        st.text(max_size=50),
        _generate_file(),
    )


@settings(max_examples=50)
@given(_scalar_value())
def test_build_segment_and_extract_values_for_scalar_types(value):
    seg = variable_factory.build_segment(value)
    # nan == nan yields false, so we need to use `math.isnan` to check `seg.value` here.
    if isinstance(value, float) and math.isnan(value):
        assert math.isnan(seg.value)
    else:
        assert seg.value == value


@settings(max_examples=50)
@given(values=st.lists(_scalar_value(), max_size=20))
def test_build_segment_and_extract_values_for_array_types(values):
    seg = variable_factory.build_segment(values)
    assert seg.value == values


def test_build_segment_type_for_scalar():
    @dataclass(frozen=True)
    class TestCase:
        value: int | float | str | File
        expected_type: SegmentType

    file = File(
        id="test_file_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://test.example.com/test-file.png",
        filename="test-file",
        extension=".png",
        mime_type="image/png",
        size=1000,
    )
    cases = [
        TestCase(0, SegmentType.INTEGER),
        TestCase(0.0, SegmentType.FLOAT),
        TestCase("", SegmentType.STRING),
        TestCase(file, SegmentType.FILE),
    ]

    for idx, c in enumerate(cases, 1):
        segment = variable_factory.build_segment(c.value)
        assert segment.value_type == c.expected_type, f"test case {idx} failed."


class TestBuildSegmentWithType:
    """Test cases for build_segment_with_type function."""

    def test_string_type(self):
        """Test building a string segment with correct type."""
        result = build_segment_with_type(SegmentType.STRING, "hello")
        assert isinstance(result, StringSegment)
        assert result.value == "hello"
        assert result.value_type == SegmentType.STRING

    def test_number_type_integer(self):
        """Test building a number segment with integer value."""
        result = build_segment_with_type(SegmentType.NUMBER, 42)
        assert isinstance(result, IntegerSegment)
        assert result.value == 42
        assert result.value_type == SegmentType.INTEGER

    def test_number_type_float(self):
        """Test building a number segment with float value."""
        result = build_segment_with_type(SegmentType.NUMBER, 3.14)
        assert isinstance(result, FloatSegment)
        assert result.value == 3.14
        assert result.value_type == SegmentType.FLOAT

    def test_object_type(self):
        """Test building an object segment with correct type."""
        test_obj = {"key": "value", "nested": {"inner": 123}}
        result = build_segment_with_type(SegmentType.OBJECT, test_obj)
        assert isinstance(result, ObjectSegment)
        assert result.value == test_obj
        assert result.value_type == SegmentType.OBJECT

    def test_file_type(self):
        """Test building a file segment with correct type."""
        test_file = File(
            id="test_file_id",
            tenant_id="test_tenant_id",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://test.example.com/test-file.png",
            filename="test-file",
            extension=".png",
            mime_type="image/png",
            size=1000,
            storage_key="test_storage_key",
        )
        result = build_segment_with_type(SegmentType.FILE, test_file)
        assert isinstance(result, FileSegment)
        assert result.value == test_file
        assert result.value_type == SegmentType.FILE

    def test_none_type(self):
        """Test building a none segment with None value."""
        result = build_segment_with_type(SegmentType.NONE, None)
        assert isinstance(result, NoneSegment)
        assert result.value is None
        assert result.value_type == SegmentType.NONE

    def test_empty_array_string(self):
        """Test building an empty array[string] segment."""
        result = build_segment_with_type(SegmentType.ARRAY_STRING, [])
        assert isinstance(result, ArrayStringSegment)
        assert result.value == []
        assert result.value_type == SegmentType.ARRAY_STRING

    def test_empty_array_number(self):
        """Test building an empty array[number] segment."""
        result = build_segment_with_type(SegmentType.ARRAY_NUMBER, [])
        assert isinstance(result, ArrayNumberSegment)
        assert result.value == []
        assert result.value_type == SegmentType.ARRAY_NUMBER

    def test_empty_array_object(self):
        """Test building an empty array[object] segment."""
        result = build_segment_with_type(SegmentType.ARRAY_OBJECT, [])
        assert isinstance(result, ArrayObjectSegment)
        assert result.value == []
        assert result.value_type == SegmentType.ARRAY_OBJECT

    def test_empty_array_file(self):
        """Test building an empty array[file] segment."""
        result = build_segment_with_type(SegmentType.ARRAY_FILE, [])
        assert isinstance(result, ArrayFileSegment)
        assert result.value == []
        assert result.value_type == SegmentType.ARRAY_FILE

    def test_empty_array_any(self):
        """Test building an empty array[any] segment."""
        result = build_segment_with_type(SegmentType.ARRAY_ANY, [])
        assert isinstance(result, ArrayAnySegment)
        assert result.value == []
        assert result.value_type == SegmentType.ARRAY_ANY

    def test_array_with_values(self):
        """Test building array segments with actual values."""
        # Array of strings
        result = build_segment_with_type(SegmentType.ARRAY_STRING, ["hello", "world"])
        assert isinstance(result, ArrayStringSegment)
        assert result.value == ["hello", "world"]
        assert result.value_type == SegmentType.ARRAY_STRING

        # Array of numbers
        result = build_segment_with_type(SegmentType.ARRAY_NUMBER, [1, 2, 3.14])
        assert isinstance(result, ArrayNumberSegment)
        assert result.value == [1, 2, 3.14]
        assert result.value_type == SegmentType.ARRAY_NUMBER

        # Array of objects
        result = build_segment_with_type(SegmentType.ARRAY_OBJECT, [{"a": 1}, {"b": 2}])
        assert isinstance(result, ArrayObjectSegment)
        assert result.value == [{"a": 1}, {"b": 2}]
        assert result.value_type == SegmentType.ARRAY_OBJECT

    def test_type_mismatch_string_to_number(self):
        """Test type mismatch when expecting number but getting string."""
        with pytest.raises(TypeMismatchError) as exc_info:
            build_segment_with_type(SegmentType.NUMBER, "not_a_number")

        assert "Type mismatch" in str(exc_info.value)
        assert "expected number" in str(exc_info.value)
        assert "str" in str(exc_info.value)

    def test_type_mismatch_number_to_string(self):
        """Test type mismatch when expecting string but getting number."""
        with pytest.raises(TypeMismatchError) as exc_info:
            build_segment_with_type(SegmentType.STRING, 123)

        assert "Type mismatch" in str(exc_info.value)
        assert "expected string" in str(exc_info.value)
        assert "int" in str(exc_info.value)

    def test_type_mismatch_none_to_string(self):
        """Test type mismatch when expecting string but getting None."""
        with pytest.raises(TypeMismatchError) as exc_info:
            build_segment_with_type(SegmentType.STRING, None)

        assert "expected string, but got None" in str(exc_info.value)

    def test_type_mismatch_empty_list_to_non_array(self):
        """Test type mismatch when expecting non-array type but getting empty list."""
        with pytest.raises(TypeMismatchError) as exc_info:
            build_segment_with_type(SegmentType.STRING, [])

        assert "expected string, but got empty list" in str(exc_info.value)

    def test_type_mismatch_object_to_array(self):
        """Test type mismatch when expecting array but getting object."""
        with pytest.raises(TypeMismatchError) as exc_info:
            build_segment_with_type(SegmentType.ARRAY_STRING, {"key": "value"})

        assert "Type mismatch" in str(exc_info.value)
        assert "expected array[string]" in str(exc_info.value)

    def test_compatible_number_types(self):
        """Test that int and float are both compatible with NUMBER type."""
        # Integer should work
        result_int = build_segment_with_type(SegmentType.NUMBER, 42)
        assert isinstance(result_int, IntegerSegment)
        assert result_int.value_type == SegmentType.INTEGER

        # Float should work
        result_float = build_segment_with_type(SegmentType.NUMBER, 3.14)
        assert isinstance(result_float, FloatSegment)
        assert result_float.value_type == SegmentType.FLOAT

    @pytest.mark.parametrize(
        ("segment_type", "value", "expected_class"),
        [
            (SegmentType.STRING, "test", StringSegment),
            (SegmentType.INTEGER, 42, IntegerSegment),
            (SegmentType.FLOAT, 3.14, FloatSegment),
            (SegmentType.OBJECT, {}, ObjectSegment),
            (SegmentType.NONE, None, NoneSegment),
            (SegmentType.ARRAY_STRING, [], ArrayStringSegment),
            (SegmentType.ARRAY_NUMBER, [], ArrayNumberSegment),
            (SegmentType.ARRAY_OBJECT, [], ArrayObjectSegment),
            (SegmentType.ARRAY_ANY, [], ArrayAnySegment),
        ],
    )
    def test_parametrized_valid_types(self, segment_type, value, expected_class):
        """Parametrized test for valid type combinations."""
        result = build_segment_with_type(segment_type, value)
        assert isinstance(result, expected_class)
        assert result.value == value
        assert result.value_type == segment_type

    @pytest.mark.parametrize(
        ("segment_type", "value"),
        [
            (SegmentType.STRING, 123),
            (SegmentType.NUMBER, "not_a_number"),
            (SegmentType.OBJECT, "not_an_object"),
            (SegmentType.ARRAY_STRING, "not_an_array"),
            (SegmentType.STRING, None),
            (SegmentType.NUMBER, None),
        ],
    )
    def test_parametrized_type_mismatches(self, segment_type, value):
        """Parametrized test for type mismatches that should raise TypeMismatchError."""
        with pytest.raises(TypeMismatchError):
            build_segment_with_type(segment_type, value)


# Test cases for ValueError scenarios in build_segment function
class TestBuildSegmentValueErrors:
    """Test cases for ValueError scenarios in the build_segment function."""

    @dataclass(frozen=True)
    class ValueErrorTestCase:
        """Test case data for ValueError scenarios."""

        name: str
        description: str
        test_value: Any

    def _get_test_cases(self):
        """Get all test cases for ValueError scenarios."""

        # Define inline classes for complex test cases
        class CustomType:
            pass

        def unsupported_function():
            return "test"

        def gen():
            yield 1
            yield 2

        return [
            self.ValueErrorTestCase(
                name="unsupported_custom_type",
                description="custom class that doesn't match any supported type",
                test_value=CustomType(),
            ),
            self.ValueErrorTestCase(
                name="unsupported_set_type",
                description="set (unsupported collection type)",
                test_value={1, 2, 3},
            ),
            self.ValueErrorTestCase(
                name="unsupported_tuple_type", description="tuple (unsupported type)", test_value=(1, 2, 3)
            ),
            self.ValueErrorTestCase(
                name="unsupported_bytes_type",
                description="bytes (unsupported type)",
                test_value=b"hello world",
            ),
            self.ValueErrorTestCase(
                name="unsupported_function_type",
                description="function (unsupported type)",
                test_value=unsupported_function,
            ),
            self.ValueErrorTestCase(
                name="unsupported_module_type", description="module (unsupported type)", test_value=math
            ),
            self.ValueErrorTestCase(
                name="array_with_unsupported_element_types",
                description="array with unsupported element types",
                test_value=[CustomType()],
            ),
            self.ValueErrorTestCase(
                name="mixed_array_with_unsupported_types",
                description="array with mix of supported and unsupported types",
                test_value=["valid_string", 42, CustomType()],
            ),
            self.ValueErrorTestCase(
                name="nested_unsupported_types",
                description="nested structures containing unsupported types",
                test_value=[{"valid": "data"}, CustomType()],
            ),
            self.ValueErrorTestCase(
                name="complex_number_type",
                description="complex number (unsupported type)",
                test_value=3 + 4j,
            ),
            self.ValueErrorTestCase(
                name="range_type", description="range object (unsupported type)", test_value=range(10)
            ),
            self.ValueErrorTestCase(
                name="generator_type",
                description="generator (unsupported type)",
                test_value=gen(),
            ),
            self.ValueErrorTestCase(
                name="exception_message_contains_value",
                description="set to verify error message contains the actual unsupported value",
                test_value={1, 2, 3},
            ),
            self.ValueErrorTestCase(
                name="array_with_mixed_unsupported_segment_types",
                description="array processing with unsupported segment types in match",
                test_value=[CustomType()],
            ),
            self.ValueErrorTestCase(
                name="frozenset_type",
                description="frozenset (unsupported type)",
                test_value=frozenset([1, 2, 3]),
            ),
            self.ValueErrorTestCase(
                name="memoryview_type",
                description="memoryview (unsupported type)",
                test_value=memoryview(b"hello"),
            ),
            self.ValueErrorTestCase(
                name="slice_type", description="slice object (unsupported type)", test_value=slice(1, 10, 2)
            ),
            self.ValueErrorTestCase(name="type_object", description="type object (unsupported type)", test_value=type),
            self.ValueErrorTestCase(
                name="generic_object", description="generic object (unsupported type)", test_value=object()
            ),
        ]

    def test_build_segment_unsupported_types(self):
        """Table-driven test for all ValueError scenarios in build_segment function."""
        test_cases = self._get_test_cases()

        for index, test_case in enumerate(test_cases, 1):
            # Use test value directly
            test_value = test_case.test_value

            with pytest.raises(ValueError) as exc_info:  # noqa: PT012
                segment = variable_factory.build_segment(test_value)
                pytest.fail(f"Test case {index} ({test_case.name}) should raise ValueError but not, result={segment}")

            error_message = str(exc_info.value)
            assert "not supported value" in error_message, (
                f"Test case {index} ({test_case.name}): Expected 'not supported value' in error message, "
                f"but got: {error_message}"
            )

    def test_build_segment_boolean_type(self):
        """Test that Boolean values are correctly handled as boolean type, not integers."""
        # Boolean values should now be processed as BooleanSegment, not IntegerSegment
        # This is because the bool check now comes before the int check in build_segment
        true_segment = variable_factory.build_segment(True)
        false_segment = variable_factory.build_segment(False)

        # Verify they are processed as booleans, not integers
        assert true_segment.value is True, "Test case 1 (boolean_true): Expected True to be processed as boolean True"
        assert false_segment.value is False, (
            "Test case 2 (boolean_false): Expected False to be processed as boolean False"
        )
        assert true_segment.value_type == SegmentType.BOOLEAN
        assert false_segment.value_type == SegmentType.BOOLEAN

        # Test array of booleans
        bool_array_segment = variable_factory.build_segment([True, False, True])
        assert bool_array_segment.value_type == SegmentType.ARRAY_BOOLEAN
        assert bool_array_segment.value == [True, False, True]
