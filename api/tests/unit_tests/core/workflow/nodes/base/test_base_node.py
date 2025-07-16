from core.workflow.nodes.base.node import BaseNode
from core.workflow.nodes.enums import NodeType

# Ensures that all node classes are imported.
from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING

_ = NODE_TYPE_CLASSES_MAPPING


def _get_all_subclasses(root: type[BaseNode]) -> list[type[BaseNode]]:
    subclasses = []
    queue = [root]
    while queue:
        cls = queue.pop()

        subclasses.extend(cls.__subclasses__())
        queue.extend(cls.__subclasses__())

    return subclasses


def test_ensure_subclasses_of_base_node_has_node_type_and_version_method_defined():
    classes = _get_all_subclasses(BaseNode)  # type: ignore
    type_version_set: set[tuple[NodeType, str]] = set()

    for cls in classes:
        # Validate that 'version' is directly defined in the class (not inherited) by checking the class's __dict__
        assert "version" in cls.__dict__, f"class {cls} should have version method defined (NOT INHERITED.)"
        node_type = cls._node_type
        node_version = cls.version()

        assert isinstance(cls._node_type, NodeType)
        assert isinstance(node_version, str)
        node_type_and_version = (node_type, node_version)
        assert node_type_and_version not in type_version_set
        type_version_set.add(node_type_and_version)
