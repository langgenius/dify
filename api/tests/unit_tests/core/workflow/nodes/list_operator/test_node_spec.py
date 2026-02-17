from types import SimpleNamespace

import pytest

from core.variables.segments import (
    ArrayAnySegment,
    ArrayBooleanSegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayStringSegment,
)
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.file import File, FileTransferMethod, FileType
from core.workflow.nodes.list_operator.entities import FilterOperator, Order
from core.workflow.nodes.list_operator.exc import (
    InvalidConditionError,
    InvalidFilterValueError,
    InvalidKeyError,
    ListOperatorError,
)
from core.workflow.nodes.list_operator.node import (
    ListOperatorNode,
    _contains,
    _endswith,
    _eq,
    _ge,
    _get_boolean_filter_func,
    _get_file_extract_number_func,
    _get_file_extract_string_func,
    _get_file_filter_func,
    _get_number_filter_func,
    _get_sequence_filter_func,
    _get_string_filter_func,
    _gt,
    _in,
    _is,
    _le,
    _lt,
    _ne,
    _negation,
    _order_file,
    _startswith,
)


class DummyPool:
    def __init__(self, variable):
        self._variable = variable

    def get(self, key):
        return self._variable

    def convert_template(self, value):
        return SimpleNamespace(text=value)


class DummyRuntime:
    def __init__(self, variable):
        self.variable_pool = DummyPool(variable)


class DummyUnsupported:
    def __init__(self):
        self.value = ["a"]


def build_node(variable, node_data):
    node = ListOperatorNode.__new__(ListOperatorNode)
    node._node_data = node_data
    node.graph_runtime_state = DummyRuntime(variable)
    return node


def base_node_data():
    return SimpleNamespace(
        variable="var",
        filter_by=SimpleNamespace(enabled=False, conditions=[]),
        extract_by=SimpleNamespace(enabled=False, serial="1"),
        order_by=SimpleNamespace(enabled=False, value=Order.ASC, key=""),
        limit=SimpleNamespace(enabled=False, size=1),
    )


class TestNegation:
    def test_negates_true(self):
        func = _negation(lambda x: True)
        assert func(1) is False

    def test_negates_false(self):
        func = _negation(lambda x: False)
        assert func(1) is True

    def test_contains(self):
        assert _contains("a")("apple")

    def test_startswith(self):
        assert _startswith("a")("apple")

    def test_endswith(self):
        assert _endswith("e")("apple")

    def test_is(self):
        assert _is(5)(5)

    def test_in(self):
        assert _in("abc")("a")

    def test_eq(self):
        assert _eq(5)(5)

    def test_ne(self):
        assert _ne(5)(4)

    def test_lt(self):
        assert _lt(5)(4)

    def test_le(self):
        assert _le(5)(5)

    def test_gt(self):
        assert _gt(5)(6)

    def test_ge(self):
        assert _ge(5)(5)


class TestStringFilters:
    def test_invalid_condition(self):
        with pytest.raises(InvalidConditionError):
            _get_string_filter_func(condition="bad", value="x")


class TestNumberFilters:
    def test_invalid_condition(self):
        with pytest.raises(InvalidConditionError):
            _get_number_filter_func(condition="bad", value=5)


class TestBooleanFilters:
    def test_invalid_condition(self):
        with pytest.raises(InvalidConditionError):
            _get_boolean_filter_func(condition="bad", value=True)


class TestSequenceFilters:
    def test_sequence_in(self):
        func = _get_sequence_filter_func(condition="in", value=["a"])
        assert func("a")

    def test_sequence_not_in(self):
        func = _get_sequence_filter_func(condition="not in", value=["a"])
        assert func("b")

    def test_invalid_condition(self):
        with pytest.raises(InvalidConditionError):
            _get_sequence_filter_func(condition="bad", value=["a"])


class TestFileFunctions:
    def make_file(self):
        return File(
            tenant_id="t1",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            filename="a.txt",
            extension="txt",
            mime_type="text/plain",
            size=100,
            remote_url="http://x",
            related_id="1",
        )

    def test_extract_string_keys(self):
        f = self.make_file()
        assert _get_file_extract_string_func(key="name")(f) == "a.txt"

    def test_extract_number_key(self):
        f = self.make_file()
        assert _get_file_extract_number_func(key="size")(f) == 100

    def test_file_extract_number_invalid_key(self):
        with pytest.raises(InvalidKeyError):
            _get_file_extract_number_func(key="bad")

    def test_invalid_extract_key(self):
        with pytest.raises(InvalidKeyError):
            _get_file_extract_string_func(key="bad")

    def test_file_filter_name(self):
        func = _get_file_filter_func(key="name", condition="contains", value="a")
        assert func(self.make_file())

    def test_file_filter_size(self):
        func = _get_file_filter_func(key="size", condition=">", value="50")
        assert func(self.make_file())

    def test_file_filter_transfer_method(self):
        f = self.make_file()
        f.transfer_method = "upload"
        func = _get_file_filter_func(
            key="transfer_method",
            condition="in",
            value=["upload"],
        )
        assert func(f)

    def test_file_filter_type(self):
        f = self.make_file()
        f.type = "doc"
        func = _get_file_filter_func(
            key="type",
            condition="in",
            value=["doc"],
        )
        assert func(f)

    def test_invalid_filter_key(self):
        with pytest.raises(InvalidKeyError):
            _get_file_filter_func(key="bad", condition="is", value="x")

    def test_file_filter_size_invalid_type(self):
        with pytest.raises(InvalidKeyError):
            _get_file_filter_func(key="size", condition=">", value=100)

    def test_file_filter_invalid_key_branch(self):
        with pytest.raises(InvalidKeyError):
            _get_file_filter_func(key="invalid", condition="contains", value="x")

    def test_order_file_name(self):
        files = [self.make_file()]
        result = _order_file(order=Order.ASC, order_by="name", array=files)
        assert result[0].filename == "a.txt"

    def test_order_file_size_desc(self):
        files = [self.make_file()]
        result = _order_file(order=Order.DESC, order_by="size", array=files)
        assert result[0].size == 100

    def test_invalid_order_key(self):
        with pytest.raises(InvalidKeyError):
            _order_file(order=Order.ASC, order_by="bad", array=[self.make_file()])

    def test_apply_order_file_segment_inside_node(self):
        file = self.make_file()
        variable = ArrayFileSegment(value=[file])
        data = base_node_data()
        data.order_by.enabled = True
        data.order_by.key = "name"
        node = build_node(variable, data)
        result = node._run()
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED


class TestListOperatorRun:
    def make_file(self):
        return File(
            tenant_id="t1",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            filename="a.txt",
            extension="txt",
            mime_type="text/plain",
            size=100,
            remote_url="http://x",
            related_id="1",
        )

    def test_variable_not_found(self):
        node = build_node(None, base_node_data())
        result = node._run()
        assert result.status == WorkflowNodeExecutionStatus.FAILED

    def test_empty_array_segment(self):
        variable = ArrayStringSegment(value=[])
        node = build_node(variable, base_node_data())
        result = node._run()
        assert result.outputs["first_record"] is None

    def test_array_any_empty_branch(self):
        class Dummy:
            value = []

        node = build_node(Dummy(), base_node_data())
        result = node._run()
        assert isinstance(result.outputs["result"], ArrayAnySegment)

    def test_unsupported_type(self):
        variable = DummyUnsupported()
        node = build_node(variable, base_node_data())
        result = node._run()
        assert result.status == WorkflowNodeExecutionStatus.FAILED

    def test_success_no_ops(self):
        variable = ArrayStringSegment(value=["a", "b"])
        node = build_node(variable, base_node_data())
        result = node._run()
        assert result.outputs["first_record"] == "a"

    def test_filter_enabled(self):
        variable = ArrayStringSegment(value=["apple", "banana"])
        data = base_node_data()
        data.filter_by.enabled = True
        data.filter_by.conditions = [SimpleNamespace(comparison_operator="contains", value="apple")]
        node = build_node(variable, data)
        result = node._run()
        assert result.outputs["result"].value == ["apple"]

    def test_multiple_filter_conditions(self):
        variable = ArrayStringSegment(value=["apple", "banana"])
        data = base_node_data()
        data.filter_by.enabled = True
        data.filter_by.conditions = [
            SimpleNamespace(comparison_operator="contains", value="a"),
            SimpleNamespace(comparison_operator="contains", value="p"),
        ]
        node = build_node(variable, data)
        result = node._run()
        assert result.outputs["result"].value == ["apple"]

    def test_boolean_filter(self):
        variable = ArrayBooleanSegment(value=[True, False])
        data = base_node_data()
        data.filter_by.enabled = True
        data.filter_by.conditions = [SimpleNamespace(comparison_operator=FilterOperator.IS, value=True)]
        node = build_node(variable, data)
        result = node._run()
        assert result.outputs["result"].value == [True]

    def test_extract_enabled(self):
        variable = ArrayStringSegment(value=["a", "b"])
        data = base_node_data()
        data.extract_by.enabled = True
        data.extract_by.serial = "2"
        node = build_node(variable, data)
        result = node._run()
        assert result.outputs["result"].value == ["b"]

    def test_extract_invalid_index(self):
        variable = ArrayStringSegment(value=["a"])
        data = base_node_data()
        data.extract_by.enabled = True
        data.extract_by.serial = "0"
        node = build_node(variable, data)

        with pytest.raises(ValueError):
            node._run()

    def test_extract_upper_bound(self):
        variable = ArrayStringSegment(value=["a"])
        data = base_node_data()
        data.extract_by.enabled = True
        data.extract_by.serial = "5"
        node = build_node(variable, data)
        result = node._run()
        assert result.status == WorkflowNodeExecutionStatus.FAILED

    def test_order_enabled(self):
        variable = ArrayNumberSegment(value=[3, 1, 2])
        data = base_node_data()
        data.order_by.enabled = True
        node = build_node(variable, data)
        result = node._run()
        assert result.outputs["result"].value == [1, 2, 3]

    def test_boolean_order(self):
        variable = ArrayBooleanSegment(value=[False, True])
        data = base_node_data()
        data.order_by.enabled = True
        node = build_node(variable, data)
        result = node._run()
        assert result.outputs["result"].value == [False, True]

    def test_limit_enabled(self):
        variable = ArrayNumberSegment(value=[1, 2, 3])
        data = base_node_data()
        data.limit.enabled = True
        data.limit.size = 2
        node = build_node(variable, data)
        result = node._run()
        assert result.outputs["last_record"] == 2

    def test_file_array_serialization(self):
        file = File(
            tenant_id="t1",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            filename="a.txt",
            size=100,
            remote_url="http://example.com/a.txt",
        )
        variable = ArrayFileSegment(value=[file])
        node = build_node(variable, base_node_data())
        result = node._run()
        assert isinstance(result.inputs["variable"], list)

    def test_list_operator_error_caught(self, monkeypatch):
        variable = ArrayStringSegment(value=["a"])
        node = build_node(variable, base_node_data())

        def raise_error(*args, **kwargs):
            raise ListOperatorError("boom")

        monkeypatch.setattr(node, "_apply_filter", raise_error)
        node.node_data.filter_by.enabled = True

        result = node._run()
        assert result.status == WorkflowNodeExecutionStatus.FAILED

    def test_string_invalid_value_direct(self):
        variable = ArrayStringSegment(value=["a"])
        node = build_node(variable, base_node_data())
        node.node_data.filter_by.conditions = [SimpleNamespace(comparison_operator="contains", value=123)]
        with pytest.raises(InvalidFilterValueError):
            node._apply_filter(variable)

    def test_number_invalid_value_direct(self):
        variable = ArrayNumberSegment(value=[1])
        node = build_node(variable, base_node_data())
        node.node_data.filter_by.conditions = [SimpleNamespace(comparison_operator="=", value=5)]
        with pytest.raises(InvalidFilterValueError):
            node._apply_filter(variable)

    def test_boolean_invalid_value_direct(self):
        variable = ArrayBooleanSegment(value=[True])
        node = build_node(variable, base_node_data())
        node.node_data.filter_by.conditions = [SimpleNamespace(comparison_operator=FilterOperator.IS, value="bad")]
        with pytest.raises(ValueError):
            node._apply_filter(variable)

    def test_boolean_filter_wrong_type(self):
        variable = ArrayBooleanSegment(value=[True])
        data = base_node_data()
        data.filter_by.enabled = True
        data.filter_by.conditions = [
            SimpleNamespace(
                comparison_operator=FilterOperator.IS,
                value="not_bool",
            )
        ]

        node = build_node(variable, data)
        with pytest.raises(ValueError):
            node._run()

    def test_file_invalid_boolean_value_direct(self):
        file = File(
            tenant_id="t1",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            filename="a.txt",
            size=10,
            remote_url="http://example.com/a.txt",
        )
        variable = ArrayFileSegment(value=[file])
        node = build_node(variable, base_node_data())
        node.node_data.filter_by.conditions = [SimpleNamespace(key="name", comparison_operator="contains", value=True)]
        with pytest.raises(ValueError):
            node._apply_filter(variable)

    def test_file_filter_boolean_value_error(self):
        file = self.make_file()
        variable = ArrayFileSegment(value=[file])

        data = base_node_data()
        data.filter_by.enabled = True
        data.filter_by.conditions = [
            SimpleNamespace(
                key="name",
                comparison_operator="contains",
                value=True,
            )
        ]

        node = build_node(variable, data)

        with pytest.raises(ValueError):
            node._run()

    def test_apply_slice_large_size(self):
        variable = ArrayNumberSegment(value=[1, 2])
        node = build_node(variable, base_node_data())
        node.node_data.limit.size = 10
        sliced = node._apply_slice(variable)
        assert sliced.value == [1, 2]

    def test_number_filter_wrong_type(self):
        variable = ArrayNumberSegment(value=[1])
        data = base_node_data()
        data.filter_by.enabled = True
        data.filter_by.conditions = [
            SimpleNamespace(
                comparison_operator=">",
                value=True,
            )
        ]

        node = build_node(variable, data)
        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
