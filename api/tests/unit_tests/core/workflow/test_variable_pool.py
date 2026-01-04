import uuid
from collections import defaultdict

import pytest

from core.file import File, FileTransferMethod, FileType
from core.variables import FileSegment, StringSegment
from core.variables.segments import (
    ArrayAnySegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayObjectSegment,
    ArrayStringSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
)
from core.variables.variables import (
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FloatVariable,
    IntegerVariable,
    ObjectVariable,
    StringVariable,
    VariableUnion,
)
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.runtime import VariablePool
from core.workflow.system_variable import SystemVariable
from factories.variable_factory import build_segment, segment_to_variable


@pytest.fixture
def pool():
    return VariablePool(
        system_variables=SystemVariable(user_id="test_user_id", app_id="test_app_id", workflow_id="test_workflow_id"),
        user_inputs={},
    )


@pytest.fixture
def file():
    return File(
        tenant_id="test_tenant_id",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="test_related_id",
        remote_url="test_url",
        filename="test_file.txt",
        storage_key="",
    )


def test_get_file_attribute(pool, file):
    # Add a FileSegment to the pool
    pool.add(("node_1", "file_var"), FileSegment(value=file))

    # Test getting the 'name' attribute of the file
    result = pool.get(("node_1", "file_var", "name"))

    assert result is not None
    assert result.value == file.filename

    # Test getting a non-existent attribute
    result = pool.get(("node_1", "file_var", "non_existent_attr"))
    assert result is None


class TestVariablePool:
    def test_constructor(self):
        # Test with minimal required SystemVariable
        minimal_system_vars = SystemVariable(
            user_id="test_user_id", app_id="test_app_id", workflow_id="test_workflow_id"
        )
        pool = VariablePool(system_variables=minimal_system_vars)

        # Test with all parameters
        pool = VariablePool(
            variable_dictionary={},
            user_inputs={},
            system_variables=minimal_system_vars,
            environment_variables=[],
            conversation_variables=[],
        )

        # Test with more complex SystemVariable
        complex_system_vars = SystemVariable(
            user_id="test_user_id", app_id="test_app_id", workflow_id="test_workflow_id"
        )
        pool = VariablePool(
            user_inputs={"key": "value"},
            system_variables=complex_system_vars,
            environment_variables=[
                segment_to_variable(
                    segment=build_segment(1),
                    selector=[ENVIRONMENT_VARIABLE_NODE_ID, "env_var_1"],
                    name="env_var_1",
                )
            ],
            conversation_variables=[
                segment_to_variable(
                    segment=build_segment("1"),
                    selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_var_1"],
                    name="conv_var_1",
                )
            ],
        )

    def test_get_system_variables(self):
        sys_var = SystemVariable(
            user_id="test_user_id",
            app_id="test_app_id",
            workflow_id="test_workflow_id",
            workflow_execution_id="test_execution_123",
            query="test query",
            conversation_id="test_conv_id",
            dialogue_count=5,
        )
        pool = VariablePool(system_variables=sys_var)

        kv = [
            ("user_id", sys_var.user_id),
            ("app_id", sys_var.app_id),
            ("workflow_id", sys_var.workflow_id),
            ("workflow_run_id", sys_var.workflow_execution_id),
            ("query", sys_var.query),
            ("conversation_id", sys_var.conversation_id),
            ("dialogue_count", sys_var.dialogue_count),
        ]
        for key, expected_value in kv:
            segment = pool.get([SYSTEM_VARIABLE_NODE_ID, key])
            assert segment is not None
            assert segment.value == expected_value


class TestVariablePoolSerialization:
    """Test cases for VariablePool serialization and deserialization using Pydantic's built-in methods.

    These tests focus exclusively on serialization/deserialization logic to ensure that
    VariablePool data can be properly serialized to dictionaries/JSON and reconstructed
    while preserving all data integrity.
    """

    _NODE1_ID = "node_1"
    _NODE2_ID = "node_2"
    _NODE3_ID = "node_3"

    def _create_pool_without_file(self):
        # Create comprehensive system variables
        system_vars = SystemVariable(
            user_id="test_user_id",
            app_id="test_app_id",
            workflow_id="test_workflow_id",
            workflow_execution_id="test_execution_123",
            query="test query",
            conversation_id="test_conv_id",
            dialogue_count=5,
        )

        # Create environment variables with all types including ArrayFileVariable
        env_vars: list[VariableUnion] = [
            StringVariable(
                id="env_string_id",
                name="env_string",
                value="env_string_value",
                selector=[ENVIRONMENT_VARIABLE_NODE_ID, "env_string"],
            ),
            IntegerVariable(
                id="env_integer_id",
                name="env_integer",
                value=1,
                selector=[ENVIRONMENT_VARIABLE_NODE_ID, "env_integer"],
            ),
            FloatVariable(
                id="env_float_id",
                name="env_float",
                value=1.0,
                selector=[ENVIRONMENT_VARIABLE_NODE_ID, "env_float"],
            ),
        ]

        # Create conversation variables with complex data
        conv_vars: list[VariableUnion] = [
            StringVariable(
                id="conv_string_id",
                name="conv_string",
                value="conv_string_value",
                selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_string"],
            ),
            IntegerVariable(
                id="conv_integer_id",
                name="conv_integer",
                value=1,
                selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_integer"],
            ),
            FloatVariable(
                id="conv_float_id",
                name="conv_float",
                value=1.0,
                selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_float"],
            ),
            ObjectVariable(
                id="conv_object_id",
                name="conv_object",
                value={"key": "value", "nested": {"data": 123}},
                selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_object"],
            ),
            ArrayStringVariable(
                id="conv_array_string_id",
                name="conv_array_string",
                value=["conv_array_string_value"],
                selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_array_string"],
            ),
            ArrayNumberVariable(
                id="conv_array_number_id",
                name="conv_array_number",
                value=[1, 1.0],
                selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_array_number"],
            ),
            ArrayObjectVariable(
                id="conv_array_object_id",
                name="conv_array_object",
                value=[{"a": 1}, {"b": "2"}],
                selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_array_object"],
            ),
        ]

        # Create comprehensive user inputs
        user_inputs = {
            "string_input": "test_value",
            "number_input": 42,
            "object_input": {"nested": {"key": "value"}},
            "array_input": ["item1", "item2", "item3"],
        }

        # Create VariablePool
        pool = VariablePool(
            system_variables=system_vars,
            user_inputs=user_inputs,
            environment_variables=env_vars,
            conversation_variables=conv_vars,
        )
        return pool

    def _add_node_data_to_pool(self, pool: VariablePool, with_file=False):
        test_file = File(
            tenant_id="test_tenant_id",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test_related_id",
            remote_url="test_url",
            filename="test_file.txt",
            storage_key="test_storage_key",
        )

        # Add various segment types to variable dictionary
        pool.add((self._NODE1_ID, "string_var"), StringSegment(value="test_string"))
        pool.add((self._NODE1_ID, "int_var"), IntegerSegment(value=123))
        pool.add((self._NODE1_ID, "float_var"), FloatSegment(value=45.67))
        pool.add((self._NODE1_ID, "object_var"), ObjectSegment(value={"test": "data"}))
        if with_file:
            pool.add((self._NODE1_ID, "file_var"), FileSegment(value=test_file))
        pool.add((self._NODE1_ID, "none_var"), NoneSegment())

        # Add array segments including ArrayFileVariable
        pool.add((self._NODE2_ID, "array_string"), ArrayStringSegment(value=["a", "b", "c"]))
        pool.add((self._NODE2_ID, "array_number"), ArrayNumberSegment(value=[1, 2, 3]))
        pool.add((self._NODE2_ID, "array_object"), ArrayObjectSegment(value=[{"a": 1}, {"b": 2}]))
        if with_file:
            pool.add((self._NODE2_ID, "array_file"), ArrayFileSegment(value=[test_file]))
        pool.add((self._NODE2_ID, "array_any"), ArrayAnySegment(value=["mixed", 123, {"key": "value"}]))

    def test_system_variables(self):
        sys_vars = SystemVariable(
            user_id="test_user_id",
            app_id="test_app_id",
            workflow_id="test_workflow_id",
            workflow_execution_id="test_execution_123",
            query="test query",
            conversation_id="test_conv_id",
            dialogue_count=5,
        )
        pool = VariablePool(system_variables=sys_vars)
        json = pool.model_dump_json()
        pool2 = VariablePool.model_validate_json(json)
        assert pool2.system_variables == sys_vars

        for mode in ["json", "python"]:
            dict_ = pool.model_dump(mode=mode)
            pool2 = VariablePool.model_validate(dict_)
            assert pool2.system_variables == sys_vars

    def test_pool_without_file_vars(self):
        pool = self._create_pool_without_file()
        json = pool.model_dump_json()
        pool2 = pool.model_validate_json(json)
        assert pool2.system_variables == pool.system_variables
        assert pool2.conversation_variables == pool.conversation_variables
        assert pool2.environment_variables == pool.environment_variables
        assert pool2.user_inputs == pool.user_inputs
        assert pool2.variable_dictionary == pool.variable_dictionary
        assert pool2 == pool

    def test_basic_dictionary_round_trip(self):
        """Test basic round-trip serialization: model_dump() → model_validate()"""
        # Create a comprehensive VariablePool with all data types
        original_pool = self._create_pool_without_file()
        self._add_node_data_to_pool(original_pool)

        # Serialize to dictionary using Pydantic's model_dump()
        serialized_data = original_pool.model_dump()

        # Verify serialized data structure
        assert isinstance(serialized_data, dict)
        assert "system_variables" in serialized_data
        assert "user_inputs" in serialized_data
        assert "environment_variables" in serialized_data
        assert "conversation_variables" in serialized_data
        assert "variable_dictionary" in serialized_data

        # Deserialize back using Pydantic's model_validate()
        reconstructed_pool = VariablePool.model_validate(serialized_data)

        # Verify data integrity is preserved
        self._assert_pools_equal(original_pool, reconstructed_pool)

    def test_json_round_trip(self):
        """Test JSON round-trip serialization: model_dump_json() → model_validate_json()"""
        # Create a comprehensive VariablePool with all data types
        original_pool = self._create_pool_without_file()
        self._add_node_data_to_pool(original_pool)

        # Serialize to JSON string using Pydantic's model_dump_json()
        json_data = original_pool.model_dump_json()

        # Verify JSON is valid string
        assert isinstance(json_data, str)
        assert len(json_data) > 0

        # Deserialize back using Pydantic's model_validate_json()
        reconstructed_pool = VariablePool.model_validate_json(json_data)

        # Verify data integrity is preserved
        self._assert_pools_equal(original_pool, reconstructed_pool)

    def test_complex_data_serialization(self):
        """Test serialization of complex data structures including ArrayFileVariable"""
        original_pool = self._create_pool_without_file()
        self._add_node_data_to_pool(original_pool, with_file=True)

        # Test dictionary round-trip
        dict_data = original_pool.model_dump()
        reconstructed_dict = VariablePool.model_validate(dict_data)

        # Test JSON round-trip
        json_data = original_pool.model_dump_json()
        reconstructed_json = VariablePool.model_validate_json(json_data)

        # Verify both reconstructed pools are equivalent
        self._assert_pools_equal(reconstructed_dict, reconstructed_json)
        # TODO: assert the data for file object...

    def _assert_pools_equal(self, pool1: VariablePool, pool2: VariablePool):
        """Assert that two VariablePools contain equivalent data"""

        # Compare system variables
        assert pool1.system_variables == pool2.system_variables

        # Compare user inputs
        assert dict(pool1.user_inputs) == dict(pool2.user_inputs)

        # Compare environment variables count
        assert pool1.environment_variables == pool2.environment_variables

        # Compare conversation variables count
        assert pool1.conversation_variables == pool2.conversation_variables

        # Test key variable retrievals to ensure functionality is preserved
        test_selectors = [
            (SYSTEM_VARIABLE_NODE_ID, "user_id"),
            (SYSTEM_VARIABLE_NODE_ID, "app_id"),
            (ENVIRONMENT_VARIABLE_NODE_ID, "env_string"),
            (ENVIRONMENT_VARIABLE_NODE_ID, "env_number"),
            (CONVERSATION_VARIABLE_NODE_ID, "conv_string"),
            (self._NODE1_ID, "string_var"),
            (self._NODE1_ID, "int_var"),
            (self._NODE1_ID, "float_var"),
            (self._NODE2_ID, "array_string"),
            (self._NODE2_ID, "array_number"),
        ]

        for selector in test_selectors:
            val1 = pool1.get(selector)
            val2 = pool2.get(selector)

            # Both should exist or both should be None
            assert (val1 is None) == (val2 is None)

            if val1 is not None and val2 is not None:
                # Values should be equal
                assert val1.value == val2.value
                # Value types should be the same (more important than exact class type)
                assert val1.value_type == val2.value_type

    def test_variable_pool_deserialization_default_dict(self):
        variable_pool = VariablePool(
            user_inputs={"a": 1, "b": "2"},
            system_variables=SystemVariable(workflow_id=str(uuid.uuid4())),
            environment_variables=[
                StringVariable(name="str_var", value="a"),
            ],
            conversation_variables=[IntegerVariable(name="int_var", value=1)],
        )
        assert isinstance(variable_pool.variable_dictionary, defaultdict)
        json = variable_pool.model_dump_json()
        loaded = VariablePool.model_validate_json(json)
        assert isinstance(loaded.variable_dictionary, defaultdict)

        loaded.add(["non_exist_node", "a"], 1)

        pool_dict = variable_pool.model_dump()
        loaded = VariablePool.model_validate(pool_dict)
        assert isinstance(loaded.variable_dictionary, defaultdict)
        loaded.add(["non_exist_node", "a"], 1)


def test_get_attr():
    vp = VariablePool()
    value = {"output": StringSegment(value="hello")}

    vp.add(["node", "name"], value)
    res = vp.get(["node", "name", "output"])
    assert res is not None
    assert res.value == "hello"


class TestVariablePoolRenderTemplate:
    """Test cases for VariablePool.render_template method."""

    @pytest.fixture
    def pool_with_variables(self):
        """Create a VariablePool with various variables for testing."""
        pool = VariablePool(
            system_variables=SystemVariable(user_id="test_user", app_id="test_app", workflow_id="test_workflow"),
            user_inputs={"name": "John Doe", "age": 30, "city": "New York"},
        )

        # Add some node variables
        pool.add(("node1", "output"), StringSegment(value="Hello World"))
        pool.add(("node1", "count"), IntegerSegment(value=42))
        pool.add(("node1", "price"), FloatSegment(value=19.99))
        pool.add(("node2", "data"), ObjectSegment(value={"key": "value", "nested": {"item": "test"}}))
        pool.add(("node2", "items"), ArrayStringSegment(value=["apple", "banana", "orange"]))

        # Add user inputs as variables (since they're not automatically accessible via templates)
        pool.add(("user", "name"), StringSegment(value="John Doe"))
        pool.add(("user", "age"), IntegerSegment(value=30))
        pool.add(("user", "city"), StringSegment(value="New York"))

        return pool

    def test_render_template_with_none(self, pool_with_variables):
        """Test that render_template returns None when template is None."""
        result = pool_with_variables.render_template(None)
        assert result is None

    def test_render_template_with_primitives(self, pool_with_variables):
        """Test that primitive types are returned as-is."""
        # Integer
        assert pool_with_variables.render_template(42) == 42

        # Float
        assert pool_with_variables.render_template(3.14) == 3.14

        # Boolean
        assert pool_with_variables.render_template(True) is True
        assert pool_with_variables.render_template(False) is False

        # Complex number
        complex_num = complex(1, 2)
        assert pool_with_variables.render_template(complex_num) == complex_num

        # Bytes
        bytes_data = b"hello"
        assert pool_with_variables.render_template(bytes_data) == bytes_data

        # Bytearray
        bytearray_data = bytearray(b"world")
        assert pool_with_variables.render_template(bytearray_data) == bytearray_data

        # Memoryview
        memview = memoryview(b"test")
        assert pool_with_variables.render_template(memview) == memview

    def test_render_template_with_string(self, pool_with_variables):
        """Test rendering string templates with variable substitution."""
        # Simple variable substitution
        template = "Hello {{#node1.output#}}"
        result = pool_with_variables.render_template(template)
        assert result == "Hello Hello World"

        # Multiple variables
        template = "Count: {{#node1.count#}}, Price: {{#node1.price#}}"
        result = pool_with_variables.render_template(template)
        assert result == "Count: 42, Price: 19.99"

        # User input variables (added as node variables)
        template = "Name: {{#user.name#}}, Age: {{#user.age#}}"
        result = pool_with_variables.render_template(template)
        assert result == "Name: John Doe, Age: 30"

        # Plain string without variables
        template = "This is a plain string"
        result = pool_with_variables.render_template(template)
        assert result == "This is a plain string"

    def test_render_template_with_list(self, pool_with_variables):
        """Test rendering list templates."""
        # List with strings containing variables
        template = [
            "Hello {{#node1.output#}}",
            "Count is {{#node1.count#}}",
            42,  # Primitive
            True,  # Boolean
            ["nested", "{{#node1.output#}}"],  # Nested list
        ]

        result = pool_with_variables.render_template(template)

        assert isinstance(result, list)
        assert len(result) == 5
        assert result[0] == "Hello Hello World"
        assert result[1] == "Count is 42"
        assert result[2] == 42
        assert result[3] is True
        assert result[4] == ["nested", "Hello World"]

    def test_render_template_with_tuple(self, pool_with_variables):
        """Test rendering tuple templates."""
        template = ("{{#node1.output#}}", 42, "Price: {{#node1.price#}}")

        result = pool_with_variables.render_template(template)

        assert isinstance(result, tuple)
        assert len(result) == 3
        assert result[0] == "Hello World"
        assert result[1] == 42
        assert result[2] == "Price: 19.99"

    def test_render_template_with_dict(self, pool_with_variables):
        """Test rendering dictionary templates."""
        template = {
            "greeting": "{{#node1.output#}}",
            "count": "{{#node1.count#}}",
            "static": "plain text",
            "number": 100,
            "nested": {"price": "{{#node1.price#}}", "user": "{{#user.name#}}"},
        }

        result = pool_with_variables.render_template(template)

        assert isinstance(result, dict)
        assert result["greeting"] == "Hello World"
        assert result["count"] == "42"
        assert result["static"] == "plain text"
        assert result["number"] == 100
        assert result["nested"]["price"] == "19.99"
        assert result["nested"]["user"] == "John Doe"

    def test_render_template_with_set(self, pool_with_variables):
        """Test rendering set templates."""
        template = {"{{#node1.output#}}", "static", "Count: {{#node1.count#}}"}

        result = pool_with_variables.render_template(template)

        assert isinstance(result, set)
        assert len(result) == 3
        assert "Hello World" in result
        assert "static" in result
        assert "Count: 42" in result

    def test_render_template_with_complex_nested_structure(self, pool_with_variables):
        """Test rendering complex nested data structures."""
        template = {
            "users": [{"name": "{{#user.name#}}", "age": "{{#user.age#}}", "location": "{{#user.city#}}"}],
            "metadata": {
                "app_id": "{{#sys.app_id#}}",
                "counts": ["{{#node1.count#}}", 10, 20],
                "flags": (True, False, "{{#node1.output#}}"),
            },
            "items": {"item1", "item2", "{{#node1.output#}}"},
        }

        result = pool_with_variables.render_template(template)

        assert isinstance(result, dict)
        assert len(result["users"]) == 1
        assert result["users"][0]["name"] == "John Doe"
        assert result["users"][0]["age"] == "30"
        assert result["users"][0]["location"] == "New York"
        assert result["metadata"]["app_id"] == "test_app"
        assert result["metadata"]["counts"] == ["42", 10, 20]
        assert result["metadata"]["flags"] == (True, False, "Hello World")
        assert "Hello World" in result["items"]

    def test_render_template_with_invalid_type(self, pool_with_variables):
        """Test that render_template raises TypeError for unsupported types."""

        class CustomClass:
            pass

        custom_obj = CustomClass()

        with pytest.raises(TypeError) as exc_info:
            pool_with_variables.render_template(custom_obj)

        assert "unsupported template type" in str(exc_info.value)
        assert "CustomClass" in str(exc_info.value)

    def test_render_template_with_empty_collections(self, pool_with_variables):
        """Test rendering empty collections."""
        # Empty list
        assert pool_with_variables.render_template([]) == []

        # Empty tuple
        assert pool_with_variables.render_template(()) == ()

        # Empty dict
        assert pool_with_variables.render_template({}) == {}

        # Empty set
        assert pool_with_variables.render_template(set()) == set()

    def test_render_template_with_missing_variables(self, pool_with_variables):
        """Test rendering templates with variables that don't exist."""
        # Non-existent variable should be rendered as empty or the variable reference
        template = "Missing: {{#nonexistent.variable#}}"
        result = pool_with_variables.render_template(template)
        assert isinstance(result, str)
        assert result == "Missing: nonexistent.variable"

    def test_render_template_preserves_types_in_collections(self, pool_with_variables):
        """Test that types are preserved when rendering collections."""
        template = [
            42,  # int
            3.14,  # float
            True,  # bool
            None,  # None should be handled
            "text",  # string
            b"bytes",  # bytes
        ]

        result = pool_with_variables.render_template(template)

        assert result[0] == 42
        assert isinstance(result[0], int)
        assert result[1] == 3.14
        assert isinstance(result[1], float)
        assert result[2] is True
        assert isinstance(result[2], bool)
        assert result[3] is None
        assert result[4] == "text"
        assert isinstance(result[4], str)
        assert result[5] == b"bytes"
        assert isinstance(result[5], bytes)

    def test_render_template_recursive_depth(self, pool_with_variables):
        # The actual behavior depends on convert_template implementation.

        # Create a deeply nested structure
        template = {"level1": {"level2": {"level3": {"level4": {"value": "{{#node1.output#}}"}}}}}

        result = pool_with_variables.render_template(template)

        assert result["level1"]["level2"]["level3"]["level4"]["value"] == "Hello World"

    def test_render_template_with_mixed_variable_references(self, pool_with_variables):
        """Test templates with multiple types of variable references."""
        template = {
            "system_var": "{{#sys.user_id#}}",
            "user_input": "{{#user.name#}}",
            "node_output": "{{#node1.output#}}",
            "combined": "User {{#user.name#}} has {{#node1.count#}} items",
        }

        result = pool_with_variables.render_template(template)

        assert result["system_var"] == "test_user"
        assert result["user_input"] == "John Doe"
        assert result["node_output"] == "Hello World"
        assert result["combined"] == "User John Doe has 42 items"

    def test_render_template_with_base_model(self, pool_with_variables):
        """Test rendering BaseModel instances with variable substitution."""
        from pydantic import BaseModel, Field

        class UserModel(BaseModel):
            name: str = Field(default="")
            age: str = Field(default="")
            greeting: str = Field(default="")

        # Create a model instance with template strings
        user = UserModel(name="{{#user.name#}}", age="{{#user.age#}}", greeting="Hello {{#node1.output#}}")

        result = pool_with_variables.render_template(user)

        # Should return a new BaseModel instance with rendered values
        assert isinstance(result, UserModel)
        assert result is not user  # Should be a copy
        assert result.name == "John Doe"
        assert result.age == "30"
        assert result.greeting == "Hello Hello World"

    def test_render_template_with_nested_base_model(self, pool_with_variables):
        """Test rendering nested BaseModel structures."""
        from pydantic import BaseModel, Field

        class AddressModel(BaseModel):
            city: str = Field(default="")
            country: str = Field(default="USA")

        class PersonModel(BaseModel):
            name: str = Field(default="")
            address: AddressModel = Field(default_factory=AddressModel)
            items: list[str] = Field(default_factory=list)

        # Create nested model with templates
        person = PersonModel(
            name="{{#user.name#}}",
            address=AddressModel(city="{{#user.city#}}", country="United States"),
            items=["item1", "{{#node1.output#}}", "item3"],
        )

        result = pool_with_variables.render_template(person)

        assert isinstance(result, PersonModel)
        assert result.name == "John Doe"
        assert isinstance(result.address, AddressModel)
        assert result.address.city == "New York"
        assert result.address.country == "United States"
        assert result.items == ["item1", "Hello World", "item3"]

    def test_render_template_with_base_model_partial_fields(self, pool_with_variables):
        """Test BaseModel with only some fields set."""
        from pydantic import BaseModel, Field

        class ConfigModel(BaseModel):
            app_id: str = Field(default="")
            user_id: str = Field(default="")
            optional_field: str | None = Field(default=None)
            count: int = Field(default=0)

        # Create model with only some fields set
        config = ConfigModel(
            app_id="{{#sys.app_id#}}",
            user_id="{{#sys.user_id#}}",
            # optional_field and count not set
        )

        result = pool_with_variables.render_template(config)

        assert isinstance(result, ConfigModel)
        assert result.app_id == "test_app"
        assert result.user_id == "test_user"
        assert result.optional_field is None
        assert result.count == 0

    def test_render_template_with_base_model_complex_types(self, pool_with_variables):
        """Test BaseModel with complex field types."""
        from pydantic import BaseModel, Field

        class ComplexModel(BaseModel):
            text: str = Field(default="")
            numbers: list[int] = Field(default_factory=list)
            mapping: dict[str, str] = Field(default_factory=dict)
            tags: set[str] = Field(default_factory=set)

        model = ComplexModel(
            text="Count: {{#node1.count#}}",
            numbers=[1, 2, 3],
            mapping={"user": "{{#user.name#}}", "output": "{{#node1.output#}}"},
            tags={"tag1", "{{#user.city#}}", "tag3"},
        )

        result = pool_with_variables.render_template(model)

        assert isinstance(result, ComplexModel)
        assert result.text == "Count: 42"
        assert result.numbers == [1, 2, 3]
        assert result.mapping["user"] == "John Doe"
        assert result.mapping["output"] == "Hello World"
        assert "New York" in result.tags
        assert "tag1" in result.tags
        assert "tag3" in result.tags

    def test_render_template_with_base_model_in_collections(self, pool_with_variables):
        """Test BaseModel instances within collections."""
        from pydantic import BaseModel, Field

        class ItemModel(BaseModel):
            id: int = Field(default=0)
            name: str = Field(default="")

        # BaseModel in list
        items_list = [ItemModel(id=1, name="{{#user.name#}}"), ItemModel(id=2, name="{{#node1.output#}}")]

        result_list = pool_with_variables.render_template(items_list)
        assert len(result_list) == 2
        assert isinstance(result_list[0], ItemModel)
        assert result_list[0].name == "John Doe"
        assert isinstance(result_list[1], ItemModel)
        assert result_list[1].name == "Hello World"

        # BaseModel in dict
        items_dict = {
            "first": ItemModel(id=1, name="{{#user.city#}}"),
            "second": ItemModel(id=2, name="Count: {{#node1.count#}}"),
        }

        result_dict = pool_with_variables.render_template(items_dict)
        assert isinstance(result_dict["first"], ItemModel)
        assert result_dict["first"].name == "New York"
        assert isinstance(result_dict["second"], ItemModel)
        assert result_dict["second"].name == "Count: 42"

    def test_render_template_with_base_model_deep_copy(self, pool_with_variables):
        """Test that BaseModel rendering creates deep copies."""
        from pydantic import BaseModel, Field

        class MutableModel(BaseModel):
            items: list[str] = Field(default_factory=list)
            data: dict[str, str] = Field(default_factory=dict)

        original = MutableModel(items=["{{#user.name#}}", "item2"], data={"key": "{{#node1.output#}}"})

        # Store references to original mutable objects
        original_items = original.items
        original_data = original.data

        result = pool_with_variables.render_template(original)

        # Verify deep copy - modifying result shouldn't affect original
        assert result.items is not original_items
        assert result.data is not original_data

        # Verify values are rendered
        assert result.items[0] == "John Doe"
        assert result.data["key"] == "Hello World"

        # Original should be unchanged
        assert original.items[0] == "{{#user.name#}}"
        assert original.data["key"] == "{{#node1.output#}}"

    def test_render_template_with_base_model_validation(self, pool_with_variables):
        """Test that BaseModel with validators works correctly after rendering."""
        from pydantic import BaseModel, Field, field_validator

        class ValidatedModel(BaseModel):
            name: str = Field(min_length=1)
            count: str = Field(default="")

            @field_validator("count", mode="after")
            @classmethod
            def validate_count(cls, v: str) -> str:
                # After rendering, should be a valid number string
                if v and v != "{{#node1.count#}}" and not v.isdigit():
                    raise ValueError("count must be numeric after rendering")
                return v

        # The template string passes validation initially
        model = ValidatedModel(name="{{#user.name#}}", count="{{#node1.count#}}")

        result = pool_with_variables.render_template(model)

        assert isinstance(result, ValidatedModel)
        assert result.name == "John Doe"
        assert result.count == "42"

        # Verify the rendered value passes validation
        # This would fail if count wasn't numeric
        ValidatedModel(name="Test", count=result.count)

    def test_render_template_with_base_model_inheritance(self, pool_with_variables):
        """Test BaseModel with inheritance."""
        from pydantic import BaseModel, Field

        class BaseConfig(BaseModel):
            app_id: str = Field(default="")

        class ExtendedConfig(BaseConfig):
            user_name: str = Field(default="")
            message: str = Field(default="")

        config = ExtendedConfig(
            app_id="{{#sys.app_id#}}", user_name="{{#user.name#}}", message="Welcome to {{#node1.output#}}"
        )

        result = pool_with_variables.render_template(config)

        assert isinstance(result, ExtendedConfig)
        assert result.app_id == "test_app"
        assert result.user_name == "John Doe"
        assert result.message == "Welcome to Hello World"

    def test_render_template_with_base_model_only_set_fields(self, pool_with_variables):
        """Test that only fields that were explicitly set are rendered."""
        from pydantic import BaseModel, Field

        class PartialModel(BaseModel):
            field1: str = Field(default="default1")
            field2: str = Field(default="default2")
            field3: str = Field(default="default3")

        # Only set field1 and field3
        model = PartialModel(
            field1="{{#user.name#}}",
            field3="{{#node1.output#}}",
            # field2 not set, should keep default
        )

        result = pool_with_variables.render_template(model)

        assert result.field1 == "John Doe"
        assert result.field2 == "default2"  # Should remain default
        assert result.field3 == "Hello World"
