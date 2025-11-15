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
