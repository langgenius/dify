import types
from collections.abc import Mapping

from core.workflow.enums import NodeType
from core.workflow.nodes.base.entities import BaseNodeData
from core.workflow.nodes.base.node import Node

# Import concrete nodes we will assert on (numeric version path)
from core.workflow.nodes.variable_assigner.v1.node import (
    VariableAssignerNode as VariableAssignerV1,
)
from core.workflow.nodes.variable_assigner.v2.node import (
    VariableAssignerNode as VariableAssignerV2,
)


def test_variable_assigner_latest_prefers_highest_numeric_version():
    # Act
    mapping: Mapping[NodeType, Mapping[str, type[Node]]] = Node.get_node_type_classes_mapping()

    # Assert basic presence
    assert NodeType.VARIABLE_ASSIGNER in mapping
    va_versions = mapping[NodeType.VARIABLE_ASSIGNER]

    # Both concrete versions must be present
    assert va_versions.get("1") is VariableAssignerV1
    assert va_versions.get("2") is VariableAssignerV2

    # And latest should point to numerically-highest version ("2")
    assert va_versions.get("latest") is VariableAssignerV2


def test_latest_prefers_highest_numeric_version():
    # Arrange: define two ephemeral subclasses with numeric versions under a NodeType
    # that has no concrete implementations in production to avoid interference.
    class _Version1(Node[BaseNodeData]):  # type: ignore[misc]
        node_type = NodeType.LEGACY_VARIABLE_AGGREGATOR

        def init_node_data(self, data):
            pass

        def _run(self):
            raise NotImplementedError

        @classmethod
        def version(cls) -> str:
            return "1"

        def _get_error_strategy(self):
            return None

        def _get_retry_config(self):
            return types.SimpleNamespace()  # not used

        def _get_title(self) -> str:
            return "version1"

        def _get_description(self):
            return None

        def _get_default_value_dict(self):
            return {}

        def get_base_node_data(self):
            return types.SimpleNamespace(title="version1")

    class _Version2(_Version1):  # type: ignore[misc]
        @classmethod
        def version(cls) -> str:
            return "2"

        def _get_title(self) -> str:
            return "version2"

    # Act: build a fresh mapping (it should now see our ephemeral subclasses)
    mapping: Mapping[NodeType, Mapping[str, type[Node]]] = Node.get_node_type_classes_mapping()

    # Assert: both numeric versions exist for this NodeType; 'latest' points to the higher numeric version
    assert NodeType.LEGACY_VARIABLE_AGGREGATOR in mapping
    legacy_versions = mapping[NodeType.LEGACY_VARIABLE_AGGREGATOR]

    assert legacy_versions.get("1") is _Version1
    assert legacy_versions.get("2") is _Version2
    assert legacy_versions.get("latest") is _Version2
