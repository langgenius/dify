import dataclasses

from pydantic import BaseModel

from core.file import File, FileTransferMethod, FileType
from core.helper import encrypter
from core.variables.segments import (
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
from core.variables.types import SegmentType
from core.variables.variables import (
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
    VariableUnion,
)
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.system_variable import SystemVariable


def test_segment_group_to_text():
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="fake-user-id"),
        user_inputs={},
        environment_variables=[
            SecretVariable(name="secret_key", value="fake-secret-key"),
        ],
        conversation_variables=[],
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
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="1", app_id="1", workflow_id="1"),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    template = "Hello, world!"
    segments_group = variable_pool.convert_template(template)
    assert segments_group.text == "Hello, world!"
    assert segments_group.log == "Hello, world!"


def test_convert_variable_to_segment_group():
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="fake-user-id"),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    template = "{{#sys.user_id#}}"
    segments_group = variable_pool.convert_template(template)
    assert segments_group.text == "fake-user-id"
    assert segments_group.log == "fake-user-id"
    assert isinstance(segments_group.value[0], StringVariable)
    assert segments_group.value[0].value == "fake-user-id"


class _Segments(BaseModel):
    segments: list[SegmentUnion]


class _Variables(BaseModel):
    variables: list[VariableUnion]


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
        tenant_id="test-tenant",
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
        print("Json: ", json)
        loaded = _Segments.model_validate_json(json)
        assert loaded == model

    def test_segment_number(self):
        """Test number segment serialization compatibility"""
        model = _Segments(segments=[IntegerSegment(value=1), FloatSegment(value=1.0)])
        json = model.model_dump_json()
        print("Json: ", json)
        loaded = _Segments.model_validate_json(json)
        assert loaded == model

    def test_variables(self):
        """Test variable serialization compatibility"""
        model = _Variables(variables=[IntegerVariable(value=1, name="int"), StringVariable(value="a", name="str")])
        json = model.model_dump_json()
        print("Json: ", json)
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
                assert loaded_file.tenant_id == orig_file.tenant_id
                assert loaded_file.type == orig_file.type
                assert loaded_file.filename == orig_file.filename
            else:
                assert loaded_segment.value == original.value

    def test_all_variables_serialization(self):
        """Test serialization/deserialization of all variable types"""
        # Create one instance of each variable type
        test_file = create_test_file()

        all_variables: list[VariableUnion] = [
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
                assert loaded_file.tenant_id == orig_file.tenant_id
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
