from collections.abc import Iterator, Mapping, MutableMapping

from dify_graph.enums import NodeType
from dify_graph.nodes.base.node import Node

LATEST_VERSION = "latest"


class _LazyNodeTypeClassesMapping(MutableMapping[NodeType, Mapping[str, type[Node]]]):
    """Mutable dict-like view over the current node registry."""

    def __init__(self) -> None:
        self._cached_snapshot: dict[NodeType, Mapping[str, type[Node]]] = {}
        self._cached_version = -1
        self._deleted: set[NodeType] = set()
        self._overrides: dict[NodeType, Mapping[str, type[Node]]] = {}

    def _snapshot(self) -> dict[NodeType, Mapping[str, type[Node]]]:
        current_version = Node.get_registry_version()
        if self._cached_version != current_version:
            self._cached_snapshot = dict(Node.get_node_type_classes_mapping())
            self._cached_version = current_version
        if not self._deleted and not self._overrides:
            return self._cached_snapshot

        snapshot = {key: value for key, value in self._cached_snapshot.items() if key not in self._deleted}
        snapshot.update(self._overrides)
        return snapshot

    def __getitem__(self, key: NodeType) -> Mapping[str, type[Node]]:
        return self._snapshot()[key]

    def __setitem__(self, key: NodeType, value: Mapping[str, type[Node]]) -> None:
        self._deleted.discard(key)
        self._overrides[key] = value

    def __delitem__(self, key: NodeType) -> None:
        if key in self._overrides:
            del self._overrides[key]
            return
        if key in self._cached_snapshot:
            self._deleted.add(key)
            return
        raise KeyError(key)

    def __iter__(self) -> Iterator[NodeType]:
        return iter(self._snapshot())

    def __len__(self) -> int:
        return len(self._snapshot())


NODE_TYPE_CLASSES_MAPPING: MutableMapping[NodeType, Mapping[str, type[Node]]] = _LazyNodeTypeClassesMapping()
