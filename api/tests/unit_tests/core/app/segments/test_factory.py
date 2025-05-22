from dataclasses import dataclass
from uuid import uuid4

import pytest
from hypothesis import given
from hypothesis import strategies as st

from core.file import File, FileTransferMethod, FileType
from core.variables import (
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FloatVariable,
    IntegerVariable,
    ObjectSegment,
    SecretVariable,
    SegmentType,
    StringVariable,
)
from core.variables.exc import VariableError
from core.variables.segments import ArrayAnySegment
from factories import variable_factory


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


@st.composite
def _generate_file(draw) -> File:
    file_id = draw(st.text(min_size=1, max_size=10))
    tenant_id = draw(st.text(min_size=1, max_size=10))
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


def _scalar_value() -> st.SearchStrategy[int | float | str | File]:
    return st.one_of(
        st.none(),
        st.integers(),
        st.floats(),
        st.text(),
        _generate_file(),
    )


@given(_scalar_value())
def test_build_segment_and_extract_values_for_scalar_types(value):
    seg = variable_factory.build_segment(value)
    assert seg.value == value


@given(st.lists(_scalar_value()))
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
        TestCase(0, SegmentType.NUMBER),
        TestCase(0.0, SegmentType.NUMBER),
        TestCase("", SegmentType.STRING),
        TestCase(file, SegmentType.FILE),
    ]

    for idx, c in enumerate(cases, 1):
        segment = variable_factory.build_segment(c.value)
        assert segment.value_type == c.expected_type, f"test case {idx} failed."
