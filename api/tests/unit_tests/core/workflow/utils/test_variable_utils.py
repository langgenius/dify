from typing import Any

from core.variables.segments import ObjectSegment, StringSegment
from core.workflow.entities import VariablePool
from core.workflow.utils.variable_utils import append_variables_recursively


class TestAppendVariablesRecursively:
    """Test cases for append_variables_recursively function"""

    def test_append_simple_dict_value(self):
        """Test appending a simple dictionary value"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["output"]
        variable_value = {"name": "John", "age": 30}

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that the main variable is added
        main_var = pool.get([node_id, "output"])
        assert main_var is not None
        assert main_var.value == variable_value

        # With the new behavior, nested values are accessed through the main variable
        # They are not added as separate variables
        name_var = pool.get([node_id, "output", "name"])
        assert name_var is not None
        assert name_var.value == "John"

        age_var = pool.get([node_id, "output", "age"])
        assert age_var is not None
        assert age_var.value == 30

    def test_append_object_segment_value(self):
        """Test appending an ObjectSegment value"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["result"]

        # Create an ObjectSegment
        obj_data = {"status": "success", "code": 200}
        variable_value = ObjectSegment(value=obj_data)

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that the main variable is added
        main_var = pool.get([node_id, "result"])
        assert main_var is not None
        assert isinstance(main_var, ObjectSegment)
        assert main_var.value == obj_data

        # With the new behavior, nested values are accessed through the main variable
        status_var = pool.get([node_id, "result", "status"])
        assert status_var is not None
        assert status_var.value == "success"

        code_var = pool.get([node_id, "result", "code"])
        assert code_var is not None
        assert code_var.value == 200

    def test_append_nested_dict_value(self):
        """Test appending a nested dictionary value"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["data"]

        variable_value = {
            "user": {
                "profile": {"name": "Alice", "email": "alice@example.com"},
                "settings": {"theme": "dark", "notifications": True},
            },
            "metadata": {"version": "1.0", "timestamp": 1234567890},
        }

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that the main variable is added
        main_var = pool.get([node_id, "data"])
        assert main_var is not None
        assert main_var.value == variable_value

        # With the new behavior, nested values are accessed through the main variable
        user_var = pool.get([node_id, "data", "user"])
        assert user_var is not None
        assert isinstance(user_var.value, dict)
        assert "profile" in user_var.value
        assert "settings" in user_var.value

    def test_append_non_dict_value(self):
        """Test appending a non-dictionary value"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["simple"]
        variable_value = "simple_string"

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that only the main variable is added
        main_var = pool.get([node_id, "simple"])
        assert main_var is not None
        assert main_var.value == variable_value

        # Ensure only one variable is created
        assert len(pool.variable_dictionary[node_id]) == 1

    def test_append_segment_non_object_value(self):
        """Test appending a Segment that is not ObjectSegment"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["text"]
        variable_value = StringSegment(value="Hello World")

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that only the main variable is added
        main_var = pool.get([node_id, "text"])
        assert main_var is not None
        assert isinstance(main_var, StringSegment)
        assert main_var.value == "Hello World"

        # Ensure only one variable is created
        assert len(pool.variable_dictionary[node_id]) == 1

    def test_append_empty_dict_value(self):
        """Test appending an empty dictionary value"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["empty"]
        variable_value: dict[str, Any] = {}

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that the main variable is added
        main_var = pool.get([node_id, "empty"])
        assert main_var is not None
        assert main_var.value == {}

        # Ensure only one variable is created
        assert len(pool.variable_dictionary[node_id]) == 1
