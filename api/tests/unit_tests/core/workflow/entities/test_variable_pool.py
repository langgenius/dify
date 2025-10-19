from core.variables.segments import (
    BooleanSegment,
    IntegerSegment,
    NoneSegment,
    StringSegment,
)
from core.workflow.runtime import VariablePool


class TestVariablePoolGetAndNestedAttribute:
    #
    # _get_nested_attribute tests
    #
    def test__get_nested_attribute_existing_key(self):
        pool = VariablePool.empty()
        obj = {"a": 123}
        segment = pool._get_nested_attribute(obj, "a")
        assert segment is not None
        assert segment.value == 123

    def test__get_nested_attribute_missing_key(self):
        pool = VariablePool.empty()
        obj = {"a": 123}
        segment = pool._get_nested_attribute(obj, "b")
        assert segment is None

    def test__get_nested_attribute_non_dict(self):
        pool = VariablePool.empty()
        obj = ["not", "a", "dict"]
        segment = pool._get_nested_attribute(obj, "a")
        assert segment is None

    def test__get_nested_attribute_with_none_value(self):
        pool = VariablePool.empty()
        obj = {"a": None}
        segment = pool._get_nested_attribute(obj, "a")
        assert segment is not None
        assert isinstance(segment, NoneSegment)

    def test__get_nested_attribute_with_empty_string(self):
        pool = VariablePool.empty()
        obj = {"a": ""}
        segment = pool._get_nested_attribute(obj, "a")
        assert segment is not None
        assert isinstance(segment, StringSegment)
        assert segment.value == ""

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

    def test_get_nested_object_attribute_with_falsy_values(self):
        pool = VariablePool.empty()
        obj_value = {
            "inner_none": None,
            "inner_empty": "",
            "inner_zero": 0,
            "inner_false": False,
        }
        pool.add(("node1", "obj"), obj_value)

        segment_none = pool.get(("node1", "obj", "inner_none"))
        assert segment_none is not None
        assert isinstance(segment_none, NoneSegment)

        segment_empty = pool.get(("node1", "obj", "inner_empty"))
        assert segment_empty is not None
        assert isinstance(segment_empty, StringSegment)
        assert segment_empty.value == ""

        segment_zero = pool.get(("node1", "obj", "inner_zero"))
        assert segment_zero is not None
        assert isinstance(segment_zero, IntegerSegment)
        assert segment_zero.value == 0

        segment_false = pool.get(("node1", "obj", "inner_false"))
        assert segment_false is not None
        assert isinstance(segment_false, BooleanSegment)
        assert segment_false.value is False
