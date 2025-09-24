import pytest
from api.core.workflow.entities import VariablePool


class TestVariablePoolGetAndNestedAttribute:
    #
    # _get_nested_attribute tests
    #
    def test__get_nested_attribute_existing_key(self):
        pool = VariablePool.empty()
        obj = {"a": 123}
        exists, value = pool._get_nested_attribute(obj, "a")
        assert exists is True
        assert value == 123

    def test__get_nested_attribute_missing_key(self):
        pool = VariablePool.empty()
        obj = {"a": 123}
        exists, value = pool._get_nested_attribute(obj, "b")
        assert exists is False
        assert value is None

    def test__get_nested_attribute_non_dict(self):
        pool = VariablePool.empty()
        obj = ["not", "a", "dict"]
        exists, value = pool._get_nested_attribute(obj, "a")
        assert exists is False
        assert value is None

    #
    # get tests
    #
    def test_get_simple_variable(self):
        pool = VariablePool.empty()
        pool.add(("node1", "var1"), "value1")
        segment = pool.get(("node1", "var1"))
        assert segment is not None
        assert segment.value == "value1"

    def test_get_missing_variable(self):
        pool = VariablePool.empty()
        result = pool.get(("node1", "unknown"))
        assert result is None

    def test_get_with_too_short_selector(self):
        pool = VariablePool.empty()
        result = pool.get(("only_node",))
        assert result is None

    def test_get_nested_object_attribute(self):
        pool = VariablePool.empty()
        obj_value = {"inner": "hello"}
        pool.add(("node1", "obj"), obj_value)

        # simulate selector with nested attr
        segment = pool.get(("node1", "obj", "inner"))
        assert segment is not None
        assert segment.value == "hello"

    def test_get_nested_object_missing_attribute(self):
        pool = VariablePool.empty()
        obj_value = {"inner": "hello"}
        pool.add(("node1", "obj"), obj_value)

        result = pool.get(("node1", "obj", "not_exist"))
        assert result is None
