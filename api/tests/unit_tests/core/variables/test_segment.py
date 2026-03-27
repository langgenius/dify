import dataclasses

import orjson
import pytest
from graphon.file import File, FileTransferMethod, FileType
from graphon.runtime import VariablePool
from graphon.variables.segment_group import SegmentGroup
from graphon.variables.segments import (
    ArrayAnySegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayObjectSegment,
    ArrayStringSegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    Segment,
    SegmentUnion,
    StringSegment,
    get_segment_discriminator,
)
from graphon.variables.types import SegmentType
from graphon.variables.utils import (
    dumps_with_segments,
    segment_orjson_default,
    to_selector,
)
from graphon.variables.variables import (
    ArrayAnyVariable,
    ArrayFileVariable,
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FileVariable,
    FloatVariable,
    IntegerVariable,
    NoneVariable,
    ObjectVariable,
    SecretVariable,
    StringVariable,
    Variable,
)
from pydantic import BaseModel

from core.helper import encrypter
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_variables_to_pool


def _build_variable_pool(
    *,
    system_variables: list[Variable] | None = None,
    environment_variables: list[Variable] | None = None,
) -> VariablePool:
    variable_pool = VariablePool()
    add_variables_to_pool(
        variable_pool,
        build_bootstrap_variables(
            system_variables=system_variables or [],
            environment_variables=environment_variables or [],
        ),
    )
    return variable_pool


def test_segment_group_to_text():
    variable_pool = _build_variable_pool(
        system_variables=build_system_variables(user_id="fake-user-id"),
        environment_variables=[
            SecretVariable(name="secret_key", value="fake-secret-key"),
        ],
    )
    variable_pool.add(("node_id", "custom_query"), "fake-user-query")
    template = (
        "Hello, {{#sys.user_id#}}! Your query is {{#node_id.custom_query#}}. And your key is {{#env.secret_key#}}."
    )
    segments_group = variable_pool.convert_template(template)

    assert segments_group.text == "Hello, fake-user-id! Your query is fake-user-query. And your key is fake-secret-key."
    assert segments_group.log == (
        f"Hello, fake-user-id! Your query is fake-user-query."
        f" And your key is {encrypter.obfuscated_token('fake-secret-key')}."
    )


def test_convert_constant_to_segment_group():
    variable_pool = _build_variable_pool(
        system_variables=build_system_variables(user_id="1", app_id="1", workflow_id="1"),
    )
    template = "Hello, world!"
    segments_group = variable_pool.convert_template(template)
    assert segments_group.text == "Hello, world!"
    assert segments_group.log == "Hello, world!"


def test_convert_variable_to_segment_group():
    variable_pool = _build_variable_pool(system_variables=build_system_variables(user_id="fake-user-id"))
    template = "{{#sys.user_id#}}"
    segments_group = variable_pool.convert_template(template)
    assert segments_group.text == "fake-user-id"
    assert segments_group.log == "fake-user-id"
    assert isinstance(segments_group.value[0], StringVariable)
    assert segments_group.value[0].value == "fake-user-id"


class _Segments(BaseModel):
    segments: list[SegmentUnion]


class _Variables(BaseModel):
    variables: list[Variable]


def create_test_file(
    file_type: FileType = FileType.DOCUMENT,
    transfer_method: FileTransferMethod = FileTransferMethod.LOCAL_FILE,
    filename: str = "test.txt",
    extension: str = ".txt",
    mime_type: str = "text/plain",
    size: int = 1024,
) -> File:
    """Factory function to create File objects for testing"""
    return File(
        type=file_type,
        transfer_method=transfer_method,
        filename=filename,
        extension=extension,
        mime_type=mime_type,
        size=size,
        related_id="test-file-id" if transfer_method != FileTransferMethod.REMOTE_URL else None,
        remote_url="https://example.com/file.txt" if transfer_method == FileTransferMethod.REMOTE_URL else None,
        storage_key="test-storage-key",
    )


class TestSegmentDumpAndLoad:
    """Test suite for segment and variable serialization/deserialization"""

    def test_segments(self):
        """Test basic segment serialization compatibility"""
        model = _Segments(segments=[IntegerSegment(value=1), StringSegment(value="a")])
        json = model.model_dump_json()
        loaded = _Segments.model_validate_json(json)
        assert loaded == model

    def test_segment_number(self):
        """Test number segment serialization compatibility"""
        model = _Segments(segments=[IntegerSegment(value=1), FloatSegment(value=1.0)])
        json = model.model_dump_json()
        loaded = _Segments.model_validate_json(json)
        assert loaded == model

    def test_variables(self):
        """Test variable serialization compatibility"""
        model = _Variables(variables=[IntegerVariable(value=1, name="int"), StringVariable(value="a", name="str")])
        json = model.model_dump_json()
        restored = _Variables.model_validate_json(json)
        assert restored == model

    def test_all_segments_serialization(self):
        """Test serialization/deserialization of all segment types"""
        # Create one instance of each segment type
        test_file = create_test_file()

        all_segments: list[SegmentUnion] = [
            NoneSegment(),
            StringSegment(value="test string"),
            IntegerSegment(value=42),
            FloatSegment(value=3.14),
            ObjectSegment(value={"key": "value", "number": 123}),
            FileSegment(value=test_file),
            ArrayAnySegment(value=[1, "string", 3.14, {"key": "value"}]),
            ArrayStringSegment(value=["hello", "world"]),
            ArrayNumberSegment(value=[1, 2.5, 3]),
            ArrayObjectSegment(value=[{"id": 1}, {"id": 2}]),
            ArrayFileSegment(value=[]),  # Empty array to avoid file complexity
        ]

        # Test serialization and deserialization
        model = _Segments(segments=all_segments)
        json_str = model.model_dump_json()
        loaded = _Segments.model_validate_json(json_str)

        # Verify all segments are preserved
        assert len(loaded.segments) == len(all_segments)

        for original, loaded_segment in zip(all_segments, loaded.segments):
            assert type(loaded_segment) == type(original)
            assert loaded_segment.value_type == original.value_type

            # For file segments, compare key properties instead of exact equality
            if isinstance(original, FileSegment) and isinstance(loaded_segment, FileSegment):
                orig_file = original.value
                loaded_file = loaded_segment.value
                assert isinstance(orig_file, File)
                assert isinstance(loaded_file, File)
                assert loaded_file.type == orig_file.type
                assert loaded_file.filename == orig_file.filename
            else:
                assert loaded_segment.value == original.value

    def test_all_variables_serialization(self):
        """Test serialization/deserialization of all variable types"""
        # Create one instance of each variable type
        test_file = create_test_file()

        all_variables: list[Variable] = [
            NoneVariable(name="none_var"),
            StringVariable(value="test string", name="string_var"),
            IntegerVariable(value=42, name="int_var"),
            FloatVariable(value=3.14, name="float_var"),
            ObjectVariable(value={"key": "value", "number": 123}, name="object_var"),
            FileVariable(value=test_file, name="file_var"),
            ArrayAnyVariable(value=[1, "string", 3.14, {"key": "value"}], name="array_any_var"),
            ArrayStringVariable(value=["hello", "world"], name="array_string_var"),
            ArrayNumberVariable(value=[1, 2.5, 3], name="array_number_var"),
            ArrayObjectVariable(value=[{"id": 1}, {"id": 2}], name="array_object_var"),
            ArrayFileVariable(value=[], name="array_file_var"),  # Empty array to avoid file complexity
        ]

        # Test serialization and deserialization
        model = _Variables(variables=all_variables)
        json_str = model.model_dump_json()
        loaded = _Variables.model_validate_json(json_str)

        # Verify all variables are preserved
        assert len(loaded.variables) == len(all_variables)

        for original, loaded_variable in zip(all_variables, loaded.variables):
            assert type(loaded_variable) == type(original)
            assert loaded_variable.value_type == original.value_type
            assert loaded_variable.name == original.name

            # For file variables, compare key properties instead of exact equality
            if isinstance(original, FileVariable) and isinstance(loaded_variable, FileVariable):
                orig_file = original.value
                loaded_file = loaded_variable.value
                assert isinstance(orig_file, File)
                assert isinstance(loaded_file, File)
                assert loaded_file.type == orig_file.type
                assert loaded_file.filename == orig_file.filename
            else:
                assert loaded_variable.value == original.value

    def test_segment_discriminator_function_for_segment_types(self):
        """Test the segment discriminator function"""

        @dataclasses.dataclass
        class TestCase:
            segment: Segment
            expected_segment_type: SegmentType

        file1 = create_test_file()
        file2 = create_test_file(filename="test2.txt")

        cases = [
            TestCase(
                NoneSegment(),
                SegmentType.NONE,
            ),
            TestCase(
                StringSegment(value=""),
                SegmentType.STRING,
            ),
            TestCase(
                FloatSegment(value=0.0),
                SegmentType.FLOAT,
            ),
            TestCase(
                IntegerSegment(value=0),
                SegmentType.INTEGER,
            ),
            TestCase(
                ObjectSegment(value={}),
                SegmentType.OBJECT,
            ),
            TestCase(
                FileSegment(value=file1),
                SegmentType.FILE,
            ),
            TestCase(
                ArrayAnySegment(value=[0, 0.0, ""]),
                SegmentType.ARRAY_ANY,
            ),
            TestCase(
                ArrayStringSegment(value=[""]),
                SegmentType.ARRAY_STRING,
            ),
            TestCase(
                ArrayNumberSegment(value=[0, 0.0]),
                SegmentType.ARRAY_NUMBER,
            ),
            TestCase(
                ArrayObjectSegment(value=[{}]),
                SegmentType.ARRAY_OBJECT,
            ),
            TestCase(
                ArrayFileSegment(value=[file1, file2]),
                SegmentType.ARRAY_FILE,
            ),
        ]

        for test_case in cases:
            segment = test_case.segment
            assert get_segment_discriminator(segment) == test_case.expected_segment_type, (
                f"get_segment_discriminator failed for type {type(segment)}"
            )
            model_dict = segment.model_dump(mode="json")
            assert get_segment_discriminator(model_dict) == test_case.expected_segment_type, (
                f"get_segment_discriminator failed for serialized form of type {type(segment)}"
            )

    def test_variable_discriminator_function_for_variable_types(self):
        """Test the variable discriminator function"""

        @dataclasses.dataclass
        class TestCase:
            variable: Variable
            expected_segment_type: SegmentType

        file1 = create_test_file()
        file2 = create_test_file(filename="test2.txt")

        cases = [
            TestCase(
                NoneVariable(name="none_var"),
                SegmentType.NONE,
            ),
            TestCase(
                StringVariable(value="test", name="string_var"),
                SegmentType.STRING,
            ),
            TestCase(
                FloatVariable(value=0.0, name="float_var"),
                SegmentType.FLOAT,
            ),
            TestCase(
                IntegerVariable(value=0, name="int_var"),
                SegmentType.INTEGER,
            ),
            TestCase(
                ObjectVariable(value={}, name="object_var"),
                SegmentType.OBJECT,
            ),
            TestCase(
                FileVariable(value=file1, name="file_var"),
                SegmentType.FILE,
            ),
            TestCase(
                SecretVariable(value="secret", name="secret_var"),
                SegmentType.SECRET,
            ),
            TestCase(
                ArrayAnyVariable(value=[0, 0.0, ""], name="array_any_var"),
                SegmentType.ARRAY_ANY,
            ),
            TestCase(
                ArrayStringVariable(value=[""], name="array_string_var"),
                SegmentType.ARRAY_STRING,
            ),
            TestCase(
                ArrayNumberVariable(value=[0, 0.0], name="array_number_var"),
                SegmentType.ARRAY_NUMBER,
            ),
            TestCase(
                ArrayObjectVariable(value=[{}], name="array_object_var"),
                SegmentType.ARRAY_OBJECT,
            ),
            TestCase(
                ArrayFileVariable(value=[file1, file2], name="array_file_var"),
                SegmentType.ARRAY_FILE,
            ),
        ]

        for test_case in cases:
            variable = test_case.variable
            assert get_segment_discriminator(variable) == test_case.expected_segment_type, (
                f"get_segment_discriminator failed for type {type(variable)}"
            )
            model_dict = variable.model_dump(mode="json")
            assert get_segment_discriminator(model_dict) == test_case.expected_segment_type, (
                f"get_segment_discriminator failed for serialized form of type {type(variable)}"
            )

    def test_invalid_value_for_discriminator(self):
        # Test invalid cases
        assert get_segment_discriminator({"value_type": "invalid"}) is None
        assert get_segment_discriminator({}) is None
        assert get_segment_discriminator("not_a_dict") is None
        assert get_segment_discriminator(42) is None
        assert get_segment_discriminator(object) is None


class TestSegmentAdditionalProperties:
    def test_base_segment_text_log_markdown_size_and_to_object(self):
        """Ensure StringSegment exposes text, log, markdown, size and to_object."""
        segment = StringSegment(value="hello")

        assert segment.text == "hello"
        assert segment.log == "hello"
        assert segment.markdown == "hello"
        assert segment.size > 0
        assert segment.to_object() == "hello"

    def test_none_segment_empty_outputs(self):
        """Ensure NoneSegment renders empty text, log and markdown."""
        segment = NoneSegment()

        assert segment.text == ""
        assert segment.log == ""
        assert segment.markdown == ""

    def test_object_segment_json_outputs(self):
        """Ensure ObjectSegment renders JSON output for text, log and markdown."""
        segment = ObjectSegment(value={"key": "值", "n": 1})

        assert segment.text == '{"key": "值", "n": 1}'
        assert segment.log == '{\n  "key": "值",\n  "n": 1\n}'
        assert segment.markdown == '{\n  "key": "值",\n  "n": 1\n}'

    def test_array_segment_text_and_markdown(self):
        """Ensure ArrayAnySegment handles empty/non-empty text and markdown rendering."""
        empty_segment = ArrayAnySegment(value=[])
        non_empty_segment = ArrayAnySegment(value=[1, "two"])

        assert empty_segment.text == ""
        assert non_empty_segment.text == "[1, 'two']"
        assert non_empty_segment.markdown == "- 1\n- two"

    def test_file_segment_properties(self):
        """Ensure FileSegment markdown, text and log fields match expected behavior."""
        file = create_test_file(transfer_method=FileTransferMethod.REMOTE_URL, filename="doc.txt")
        segment = FileSegment(value=file)

        assert segment.markdown == "[doc.txt](https://example.com/file.txt)"
        assert segment.log == ""
        assert segment.text == ""

    def test_array_string_segment_text_branches(self):
        """Ensure ArrayStringSegment text handling for empty and non-empty values."""
        empty_segment = ArrayStringSegment(value=[])
        non_empty_segment = ArrayStringSegment(value=["hello", "世界"])

        assert empty_segment.text == ""
        assert non_empty_segment.text == '["hello", "世界"]'

    def test_array_file_segment_markdown_and_empty_text_log(self):
        """Ensure ArrayFileSegment markdown renders links and text/log stay empty."""
        file1 = create_test_file(transfer_method=FileTransferMethod.REMOTE_URL, filename="a.txt")
        file2 = create_test_file(transfer_method=FileTransferMethod.REMOTE_URL, filename="b.txt")
        segment = ArrayFileSegment(value=[file1, file2])

        assert segment.markdown == "[a.txt](https://example.com/file.txt)\n[b.txt](https://example.com/file.txt)"
        assert segment.log == ""
        assert segment.text == ""


class TestSegmentGroupAdditional:
    def test_segment_group_markdown_and_to_object(self):
        group = SegmentGroup(value=[StringSegment(value="A"), NoneSegment(), StringSegment(value="B")])

        assert group.markdown == "AB"
        assert group.to_object() == ["A", None, "B"]


class TestSegmentUtils:
    def test_to_selector_without_paths(self):
        assert to_selector("node-1", "output") == ["node-1", "output"]

    def test_to_selector_with_paths(self):
        assert to_selector("node-1", "output", ("a", "b")) == ["node-1", "output", "a", "b"]

    def test_array_file_segment_serialization(self):
        file1 = create_test_file(transfer_method=FileTransferMethod.REMOTE_URL, filename="a.txt")
        file2 = create_test_file(transfer_method=FileTransferMethod.REMOTE_URL, filename="b.txt")

        result = segment_orjson_default(ArrayFileSegment(value=[file1, file2]))

        assert len(result) == 2
        assert result[0]["filename"] == "a.txt"
        assert result[1]["filename"] == "b.txt"

    def test_file_segment_serialization(self):
        file = create_test_file(transfer_method=FileTransferMethod.REMOTE_URL, filename="single.txt")

        result = segment_orjson_default(FileSegment(value=file))

        assert result["filename"] == "single.txt"
        assert result["remote_url"] == "https://example.com/file.txt"

    def test_segment_group_and_segment_serialization(self):
        group = SegmentGroup(value=[StringSegment(value="a"), StringSegment(value="b")])

        assert segment_orjson_default(group) == ["a", "b"]
        assert segment_orjson_default(StringSegment(value="value")) == "value"

    def test_segment_orjson_default_unsupported_type(self):
        with pytest.raises(TypeError, match="not JSON serializable"):
            segment_orjson_default(object())

    def test_dumps_with_segments(self):
        data = {
            "segment": StringSegment(value="hello"),
            "group": SegmentGroup(value=[StringSegment(value="x"), StringSegment(value="y")]),
            1: "numeric-key",
        }

        dumped = dumps_with_segments(data)
        loaded = orjson.loads(dumped)

        assert loaded["segment"] == "hello"
        assert loaded["group"] == ["x", "y"]
        assert loaded["1"] == "numeric-key"
