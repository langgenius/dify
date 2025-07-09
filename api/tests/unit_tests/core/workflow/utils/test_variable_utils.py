from typing import Any

from core.variables.segments import ObjectSegment, StringSegment
from core.workflow.entities.variable_pool import VariablePool
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
        main_var = pool.get([node_id] + variable_key_list)
        assert main_var is not None
        assert main_var.value == variable_value

        # Check that nested variables are added recursively
        name_var = pool.get([node_id] + variable_key_list + ["name"])
        assert name_var is not None
        assert name_var.value == "John"

        age_var = pool.get([node_id] + variable_key_list + ["age"])
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
        main_var = pool.get([node_id] + variable_key_list)
        assert main_var is not None
        assert isinstance(main_var, ObjectSegment)
        assert main_var.value == obj_data

        # Check that nested variables are added recursively
        status_var = pool.get([node_id] + variable_key_list + ["status"])
        assert status_var is not None
        assert status_var.value == "success"

        code_var = pool.get([node_id] + variable_key_list + ["code"])
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

        # Check deeply nested variables
        name_var = pool.get([node_id] + variable_key_list + ["user", "profile", "name"])
        assert name_var is not None
        assert name_var.value == "Alice"

        email_var = pool.get([node_id] + variable_key_list + ["user", "profile", "email"])
        assert email_var is not None
        assert email_var.value == "alice@example.com"

        theme_var = pool.get([node_id] + variable_key_list + ["user", "settings", "theme"])
        assert theme_var is not None
        assert theme_var.value == "dark"

        notifications_var = pool.get([node_id] + variable_key_list + ["user", "settings", "notifications"])
        assert notifications_var is not None
        assert notifications_var.value == 1  # Boolean True is converted to integer 1

        version_var = pool.get([node_id] + variable_key_list + ["metadata", "version"])
        assert version_var is not None
        assert version_var.value == "1.0"

    def test_append_non_dict_value(self):
        """Test appending a non-dictionary value (should not recurse)"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["simple"]
        variable_value = "simple_string"

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that only the main variable is added
        main_var = pool.get([node_id] + variable_key_list)
        assert main_var is not None
        assert main_var.value == variable_value

        # Ensure no additional variables are created
        assert len(pool.variable_dictionary[node_id]) == 1

    def test_append_segment_non_object_value(self):
        """Test appending a Segment that is not ObjectSegment (should not recurse)"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["text"]
        variable_value = StringSegment(value="Hello World")

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that only the main variable is added
        main_var = pool.get([node_id] + variable_key_list)
        assert main_var is not None
        assert isinstance(main_var, StringSegment)
        assert main_var.value == "Hello World"

        # Ensure no additional variables are created
        assert len(pool.variable_dictionary[node_id]) == 1

    def test_append_empty_dict_value(self):
        """Test appending an empty dictionary value"""
        pool = VariablePool.empty()
        node_id = "test_node"
        variable_key_list = ["empty"]
        variable_value: dict[str, Any] = {}

        append_variables_recursively(pool, node_id, variable_key_list, variable_value)

        # Check that the main variable is added
        main_var = pool.get([node_id] + variable_key_list)
        assert main_var is not None
        assert main_var.value == {}

        # Ensure only the main variable is created (no recursion for empty dict)
        assert len(pool.variable_dictionary[node_id]) == 1
