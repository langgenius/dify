import pytest

from core.workflow.enums import NodeType
from core.workflow.nodes.base.entities import BaseNodeData
from core.workflow.nodes.base.node import Node

# Ensures that all node classes are imported.
from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING

_ = NODE_TYPE_CLASSES_MAPPING


class _TestNodeData(BaseNodeData):
    """Test node data for unit tests."""

    pass


def _get_all_subclasses(root: type[Node]) -> list[type[Node]]:
    subclasses = []
    queue = [root]
    while queue:
        cls = queue.pop()

        subclasses.extend(cls.__subclasses__())
        queue.extend(cls.__subclasses__())

    return subclasses


def test_ensure_subclasses_of_base_node_has_node_type_and_version_method_defined():
    classes = _get_all_subclasses(Node)  # type: ignore
    type_version_set: set[tuple[NodeType, str]] = set()

    for cls in classes:
        # Only validate production node classes; skip test-defined subclasses and external helpers
        module_name = getattr(cls, "__module__", "")
        if not module_name.startswith("core."):
            continue
        # Validate that 'version' is directly defined in the class (not inherited) by checking the class's __dict__
        assert "version" in cls.__dict__, f"class {cls} should have version method defined (NOT INHERITED.)"
        node_type = cls.node_type
        node_version = cls.version()

        assert isinstance(cls.node_type, NodeType)
        assert isinstance(node_version, str)
        node_type_and_version = (node_type, node_version)
        assert node_type_and_version not in type_version_set
        type_version_set.add(node_type_and_version)


def test_extract_node_data_type_from_generic_extracts_type():
    """When a class inherits from Node[T], it should extract T."""

    class _ConcreteNode(Node[_TestNodeData]):
        node_type = NodeType.CODE

        @staticmethod
        def version() -> str:
            return "1"

    result = _ConcreteNode._extract_node_data_type_from_generic()

    assert result is _TestNodeData


def test_extract_node_data_type_from_generic_returns_none_for_base_node():
    """The base Node class itself should return None (no generic parameter)."""
    result = Node._extract_node_data_type_from_generic()

    assert result is None


def test_extract_node_data_type_from_generic_raises_for_non_base_node_data():
    """When generic parameter is not a BaseNodeData subtype, should raise TypeError."""
    with pytest.raises(TypeError, match="must parameterize Node with a BaseNodeData subtype"):

        class _InvalidNode(Node[str]):  # type: ignore[type-arg]
            pass


def test_extract_node_data_type_from_generic_raises_for_non_type():
    """When generic parameter is not a concrete type, should raise TypeError."""
    from typing import TypeVar

    T = TypeVar("T")

    with pytest.raises(TypeError, match="must parameterize Node with a BaseNodeData subtype"):

        class _InvalidNode(Node[T]):  # type: ignore[type-arg]
            pass


def test_init_subclass_raises_without_generic_or_explicit_type():
    """A subclass must either use Node[T] or explicitly set _node_data_type."""
    with pytest.raises(TypeError, match="must inherit from Node\\[T\\] with a BaseNodeData subtype"):

        class _InvalidNode(Node):
            pass


def test_init_subclass_rejects_explicit_node_data_type_without_generic():
    """Setting _node_data_type explicitly cannot bypass the Node[T] requirement."""
    with pytest.raises(TypeError, match="must inherit from Node\\[T\\] with a BaseNodeData subtype"):

        class _ExplicitNode(Node):
            _node_data_type = _TestNodeData
            node_type = NodeType.CODE

            @staticmethod
            def version() -> str:
                return "1"


def test_init_subclass_sets_node_data_type_from_generic():
    """Verify that __init_subclass__ sets _node_data_type from the generic parameter."""

    class _AutoNode(Node[_TestNodeData]):
        node_type = NodeType.CODE

        @staticmethod
        def version() -> str:
            return "1"

    assert _AutoNode._node_data_type is _TestNodeData
