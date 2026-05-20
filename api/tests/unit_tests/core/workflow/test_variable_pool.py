import json
import uuid
from collections import defaultdict

import pytest

from core.workflow.system_variables import build_system_variables, system_variables_to_mapping
from core.workflow.variable_pool_initializer import add_variables_to_pool
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)
from factories.variable_factory import build_segment, segment_to_variable
from graphon.file import File, FileTransferMethod, FileType
from graphon.runtime import VariablePool
from graphon.variables import FileSegment, StringSegment
from graphon.variables.segments import (
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
from graphon.variables.variables import (
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FloatVariable,
    IntegerVariable,
    ObjectVariable,
    StringVariable,
    Variable,
)
from models.utils.file_input_compat import rebuild_serialized_graph_files_without_lookup


@pytest.fixture
def pool():
    variable_pool = VariablePool()
    add_variables_to_pool(
        variable_pool,
        build_system_variables(
            user_id="test_user_id",
            app_id="test_app_id",
            workflow_id="test_workflow_id",
        ),
    )
    return variable_pool


@pytest.fixture
def file():
    return File(
        file_type=FileType.DOCUMENT,
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
        pool = VariablePool()
        assert pool.variable_dictionary == defaultdict(dict)

        complex_system_vars = build_system_variables(
            user_id="test_user_id", app_id="test_app_id", workflow_id="test_workflow_id"
        )
        add_variables_to_pool(pool, complex_system_vars)
        add_variables_to_pool(
            pool,
            [
                segment_to_variable(
                    segment=build_segment(1),
                    selector=[ENVIRONMENT_VARIABLE_NODE_ID, "env_var_1"],
                    name="env_var_1",
                ),
                segment_to_variable(
                    segment=build_segment("1"),
                    selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_var_1"],
                    name="conv_var_1",
                ),
            ],
        )

        assert pool.get([SYSTEM_VARIABLE_NODE_ID, "user_id"]) is not None
        assert pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "env_var_1"]) is not None
        assert pool.get([CONVERSATION_VARIABLE_NODE_ID, "conv_var_1"]) is not None

    def test_from_bootstrap_loads_legacy_bootstrap_kwargs(self):
        pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(user_id="test_user_id"),
            environment_variables=[StringVariable(name="env_var", value="env-value")],
            conversation_variables=[StringVariable(name="conv_var", value="conv-value")],
            user_inputs={"ignored": "value"},
        )

        system_value = pool.get([SYSTEM_VARIABLE_NODE_ID, "user_id"])
        environment_value = pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "env_var"])
        conversation_value = pool.get([CONVERSATION_VARIABLE_NODE_ID, "conv_var"])

        assert system_value is not None
        assert system_value.value == "test_user_id"
        assert environment_value is not None
        assert environment_value.value == "env-value"
        assert conversation_value is not None
        assert conversation_value.value == "conv-value"
        assert "system_variables" not in pool.model_dump()

    def test_get_system_variables(self):
        sys_var = build_system_variables(
            user_id="test_user_id",
            app_id="test_app_id",
            workflow_id="test_workflow_id",
            workflow_execution_id="test_execution_123",
            query="test query",
            conversation_id="test_conv_id",
            dialogue_count=5,
        )
        pool = VariablePool()
        add_variables_to_pool(pool, sys_var)
        system_values = system_variables_to_mapping(sys_var)

        kv = [
            ("user_id", system_values["user_id"]),
            ("app_id", system_values["app_id"]),
            ("workflow_id", system_values["workflow_id"]),
            ("workflow_run_id", system_values["workflow_run_id"]),
            ("query", system_values["query"]),
            ("conversation_id", system_values["conversation_id"]),
            ("dialogue_count", system_values["dialogue_count"]),
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
        system_vars = build_system_variables(
            user_id="test_user_id",
            app_id="test_app_id",
            workflow_id="test_workflow_id",
            workflow_execution_id="test_execution_123",
            query="test query",
            conversation_id="test_conv_id",
            dialogue_count=5,
        )

        # Create environment variables with all types including ArrayFileVariable
        env_vars: list[Variable] = [
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
        conv_vars: list[Variable] = [
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
        pool = VariablePool()
        add_variables_to_pool(pool, system_vars)
        add_variables_to_pool(pool, env_vars)
        add_variables_to_pool(pool, conv_vars)
        return pool

    def _add_node_data_to_pool(self, pool: VariablePool, with_file=False):
        test_file = File(
            file_type=FileType.DOCUMENT,
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
        sys_vars = build_system_variables(
            user_id="test_user_id",
            app_id="test_app_id",
            workflow_id="test_workflow_id",
            workflow_execution_id="test_execution_123",
            query="test query",
            conversation_id="test_conv_id",
            dialogue_count=5,
        )
        pool = VariablePool()
        add_variables_to_pool(pool, sys_vars)
        json = pool.model_dump_json()
        pool2 = VariablePool.model_validate_json(json)
        assert pool2.variable_dictionary == pool.variable_dictionary

        for mode in ["json", "python"]:
            dict_ = pool.model_dump(mode=mode)
            pool2 = VariablePool.model_validate(dict_)
            assert pool2.variable_dictionary == pool.variable_dictionary

    def test_pool_without_file_vars(self):
        pool = self._create_pool_without_file()
        json = pool.model_dump_json()
        pool2 = pool.model_validate_json(json)
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
        """Test file-aware VariablePool round-trips through Dify's model boundary."""
        original_pool = self._create_pool_without_file()
        self._add_node_data_to_pool(original_pool, with_file=True)

        # Test dictionary round-trip
        dict_data = original_pool.model_dump()
        reconstructed_dict = VariablePool.model_validate(rebuild_serialized_graph_files_without_lookup(dict_data))

        # Test JSON round-trip
        json_data = original_pool.model_dump_json()
        reconstructed_json = VariablePool.model_validate(
            rebuild_serialized_graph_files_without_lookup(json.loads(json_data))
        )

        # Verify both reconstructed pools are equivalent
        self._assert_pools_equal(reconstructed_dict, reconstructed_json)
        # TODO: assert the data for file object...

    def _assert_pools_equal(self, pool1: VariablePool, pool2: VariablePool):
        """Assert that two VariablePools contain equivalent data"""

        assert pool1.variable_dictionary == pool2.variable_dictionary

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
            variable_dictionary=defaultdict(dict),
        )
        add_variables_to_pool(variable_pool, build_system_variables(workflow_id=str(uuid.uuid4())))
        add_variables_to_pool(
            variable_pool,
            [
                StringVariable(name="str_var", value="a", selector=[ENVIRONMENT_VARIABLE_NODE_ID, "str_var"]),
                IntegerVariable(name="int_var", value=1, selector=[CONVERSATION_VARIABLE_NODE_ID, "int_var"]),
            ],
        )
        variable_pool.add(["start", "a"], 1)
        variable_pool.add(["start", "b"], "2")
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
