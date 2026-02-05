from __future__ import annotations

import os
from collections import defaultdict
from collections.abc import Generator
from enum import StrEnum

from pydantic import BaseModel, Field


class AssetNodeType(StrEnum):
    FILE = "file"
    FOLDER = "folder"


class AppAssetNode(BaseModel):
    id: str = Field(description="Unique identifier for the node")
    node_type: AssetNodeType = Field(description="Type of node: file or folder")
    name: str = Field(description="Name of the file or folder")
    parent_id: str | None = Field(default=None, description="Parent folder ID, None for root level")
    order: int = Field(default=0, description="Sort order within parent folder, lower values first")
    extension: str = Field(default="", description="File extension without dot, empty for folders")
    size: int = Field(default=0, description="File size in bytes, 0 for folders")

    @classmethod
    def create_folder(cls, node_id: str, name: str, parent_id: str | None = None) -> AppAssetNode:
        return cls(id=node_id, node_type=AssetNodeType.FOLDER, name=name, parent_id=parent_id)

    @classmethod
    def create_file(cls, node_id: str, name: str, parent_id: str | None = None, size: int = 0) -> AppAssetNode:
        return cls(
            id=node_id,
            node_type=AssetNodeType.FILE,
            name=name,
            parent_id=parent_id,
            extension=name.rsplit(".", 1)[-1] if "." in name else "",
            size=size,
        )


class AppAssetNodeView(BaseModel):
    id: str = Field(description="Unique identifier for the node")
    node_type: str = Field(description="Type of node: 'file' or 'folder'")
    name: str = Field(description="Name of the file or folder")
    path: str = Field(description="Full path from root, e.g. '/folder/file.txt'")
    extension: str = Field(default="", description="File extension without dot")
    size: int = Field(default=0, description="File size in bytes")
    children: list[AppAssetNodeView] = Field(default_factory=list, description="Child nodes for folders")


class BatchUploadNode(BaseModel):
    """Structure for batch upload_url tree nodes, used for both input and output."""

    name: str
    node_type: AssetNodeType
    size: int = 0
    children: list[BatchUploadNode] = []
    id: str | None = None
    upload_url: str | None = None

    def to_app_asset_nodes(self, parent_id: str | None = None) -> list[AppAssetNode]:
        """
        Generate IDs when missing and convert to AppAssetNode list.
        Mutates self to set id field when it is not set.
        """
        from uuid import uuid4

        self.id = self.id or str(uuid4())
        nodes: list[AppAssetNode] = []

        if self.node_type == AssetNodeType.FOLDER:
            nodes.append(AppAssetNode.create_folder(self.id, self.name, parent_id))
            for child in self.children:
                nodes.extend(child.to_app_asset_nodes(self.id))
        else:
            nodes.append(AppAssetNode.create_file(self.id, self.name, parent_id, self.size))

        return nodes


class TreeNodeNotFoundError(Exception):
    """Tree internal: node not found"""

    pass


class TreeParentNotFoundError(Exception):
    """Tree internal: parent folder not found"""

    pass


class TreePathConflictError(Exception):
    """Tree internal: path already exists"""

    pass


class AppAssetFileTree(BaseModel):
    """
    File tree structure for app assets using adjacency list pattern.

    Design:
    - Storage: Flat list with parent_id references (adjacency list)
    - Path: Computed dynamically via get_path(), not stored
    - Order: Integer field for user-defined sorting within each folder
    - API response: transform() builds nested tree with computed paths

    Why adjacency list over nested tree or materialized path:
    - Simpler CRUD: move/rename only updates one node's parent_id
    - No path cascade: renaming parent doesn't require updating all descendants
    - JSON-friendly: flat list serializes cleanly to database JSON column
    - Trade-off: path lookup is O(depth), acceptable for typical file trees
    """

    nodes: list[AppAssetNode] = Field(default_factory=list, description="Flat list of all nodes in the tree")

    def ensure_unique_name(
        self,
        parent_id: str | None,
        name: str,
        *,
        is_file: bool,
        extra_taken: set[str] | None = None,
    ) -> str:
        """
        Return a sibling-unique name by appending numeric suffixes when needed.

        The suffix format is " <n>" (e.g. "report 1", "report 2"). For files,
        the suffix is inserted before the extension.
        """
        taken = extra_taken or set()
        if not self.has_child_named(parent_id, name) and name not in taken:
            return name
        suffix_index = 1
        while True:
            candidate = self._apply_name_suffix(name, suffix_index, is_file=is_file)
            if not self.has_child_named(parent_id, candidate) and candidate not in taken:
                return candidate
            suffix_index += 1

    @staticmethod
    def _apply_name_suffix(name: str, suffix_index: int, *, is_file: bool) -> str:
        if not is_file:
            return f"{name} {suffix_index}"
        stem, extension = os.path.splitext(name)
        return f"{stem} {suffix_index}{extension}"

    def get(self, node_id: str) -> AppAssetNode | None:
        return next((n for n in self.nodes if n.id == node_id), None)

    def get_children(self, parent_id: str | None) -> list[AppAssetNode]:
        return [n for n in self.nodes if n.parent_id == parent_id]

    def has_child_named(self, parent_id: str | None, name: str) -> bool:
        return any(n.name == name and n.parent_id == parent_id for n in self.nodes)

    def get_path(self, node_id: str) -> str:
        node = self.get(node_id)
        if not node:
            raise TreeNodeNotFoundError(node_id)
        parts: list[str] = []
        current: AppAssetNode | None = node
        while current:
            parts.append(current.name)
            current = self.get(current.parent_id) if current.parent_id else None
        return "/".join(reversed(parts))

    def relative_path(self, a: AppAssetNode, b: AppAssetNode) -> str:
        """
        Calculate relative path from node a to node b for Markdown references.
        Path is computed from a's parent directory (where the file resides).

        Examples:
            /foo/a.md -> /foo/b.md         => ./b.md
            /foo/a.md -> /foo/sub/b.md     => ./sub/b.md
            /foo/sub/a.md -> /foo/b.md     => ../b.md
            /foo/sub/deep/a.md -> /foo/b.md => ../../b.md
        """

        def get_ancestor_ids(node_id: str | None) -> list[str]:
            chain: list[str] = []
            current_id = node_id
            while current_id:
                chain.append(current_id)
                node = self.get(current_id)
                current_id = node.parent_id if node else None
            return chain

        a_dir_ancestors = get_ancestor_ids(a.parent_id)
        b_ancestors = [b.id] + get_ancestor_ids(b.parent_id)
        a_dir_set = set(a_dir_ancestors)

        lca_id: str | None = None
        lca_index_in_b = -1
        for idx, ancestor_id in enumerate(b_ancestors):
            if ancestor_id in a_dir_set or (a.parent_id is None and b_ancestors[idx:] == []):
                lca_id = ancestor_id
                lca_index_in_b = idx
                break

        if a.parent_id is None:
            steps_up = 0
            lca_index_in_b = len(b_ancestors)
        elif lca_id is None:
            steps_up = len(a_dir_ancestors)
            lca_index_in_b = len(b_ancestors)
        else:
            steps_up = 0
            for ancestor_id in a_dir_ancestors:
                if ancestor_id == lca_id:
                    break
                steps_up += 1

        path_down: list[str] = []
        for i in range(lca_index_in_b - 1, -1, -1):
            node = self.get(b_ancestors[i])
            if node:
                path_down.append(node.name)

        if steps_up == 0:
            return "./" + "/".join(path_down)

        parts: list[str] = [".."] * steps_up + path_down
        return "/".join(parts)

    def get_descendant_ids(self, node_id: str) -> list[str]:
        result: list[str] = []
        stack = [node_id]
        while stack:
            current_id = stack.pop()
            for child in self.nodes:
                if child.parent_id == current_id:
                    result.append(child.id)
                    stack.append(child.id)
        return result

    def add(self, node: AppAssetNode) -> AppAssetNode:
        if self.get(node.id):
            raise TreePathConflictError(node.id)
        if self.has_child_named(node.parent_id, node.name):
            raise TreePathConflictError(node.name)
        if node.parent_id:
            parent = self.get(node.parent_id)
            if not parent or parent.node_type != AssetNodeType.FOLDER:
                raise TreeParentNotFoundError(node.parent_id)
        siblings = self.get_children(node.parent_id)
        node.order = max((s.order for s in siblings), default=-1) + 1
        self.nodes.append(node)
        return node

    def update(self, node_id: str, size: int) -> AppAssetNode:
        node = self.get(node_id)
        if not node or node.node_type != AssetNodeType.FILE:
            raise TreeNodeNotFoundError(node_id)
        node.size = size
        return node

    def rename(self, node_id: str, new_name: str) -> AppAssetNode:
        node = self.get(node_id)
        if not node:
            raise TreeNodeNotFoundError(node_id)
        if node.name != new_name and self.has_child_named(node.parent_id, new_name):
            raise TreePathConflictError(new_name)
        node.name = new_name
        if node.node_type == AssetNodeType.FILE:
            node.extension = new_name.rsplit(".", 1)[-1] if "." in new_name else ""
        return node

    def move(self, node_id: str, new_parent_id: str | None) -> AppAssetNode:
        node = self.get(node_id)
        if not node:
            raise TreeNodeNotFoundError(node_id)
        if new_parent_id:
            parent = self.get(new_parent_id)
            if not parent or parent.node_type != AssetNodeType.FOLDER:
                raise TreeParentNotFoundError(new_parent_id)
        if self.has_child_named(new_parent_id, node.name):
            raise TreePathConflictError(node.name)
        node.parent_id = new_parent_id
        siblings = self.get_children(new_parent_id)
        node.order = max((s.order for s in siblings if s.id != node_id), default=-1) + 1
        return node

    def reorder(self, node_id: str, after_node_id: str | None) -> AppAssetNode:
        node = self.get(node_id)
        if not node:
            raise TreeNodeNotFoundError(node_id)

        siblings = sorted(self.get_children(node.parent_id), key=lambda x: x.order)
        siblings = [s for s in siblings if s.id != node_id]

        if after_node_id is None:
            insert_idx = 0
        else:
            after_node = self.get(after_node_id)
            if not after_node or after_node.parent_id != node.parent_id:
                raise TreeNodeNotFoundError(after_node_id)
            insert_idx = next((i for i, s in enumerate(siblings) if s.id == after_node_id), -1) + 1

        siblings.insert(insert_idx, node)
        for idx, sibling in enumerate(siblings):
            sibling.order = idx

        return node

    def remove(self, node_id: str) -> list[str]:
        node = self.get(node_id)
        if not node:
            raise TreeNodeNotFoundError(node_id)
        ids_to_remove = [node_id] + self.get_descendant_ids(node_id)
        self.nodes = [n for n in self.nodes if n.id not in ids_to_remove]
        return ids_to_remove

    def walk_files(self) -> Generator[AppAssetNode, None, None]:
        return (n for n in self.nodes if n.node_type == AssetNodeType.FILE)

    def transform(self) -> list[AppAssetNodeView]:
        by_parent: dict[str | None, list[AppAssetNode]] = defaultdict(list)
        for n in self.nodes:
            by_parent[n.parent_id].append(n)

        for children in by_parent.values():
            children.sort(key=lambda x: x.order)

        paths: dict[str, str] = {}
        tree_views: dict[str, AppAssetNodeView] = {}

        def build_view(node: AppAssetNode, parent_path: str) -> None:
            path = f"{parent_path}/{node.name}"
            paths[node.id] = path
            child_views: list[AppAssetNodeView] = []
            for child in by_parent.get(node.id, []):
                build_view(child, path)
                child_views.append(tree_views[child.id])
            tree_views[node.id] = AppAssetNodeView(
                id=node.id,
                node_type=node.node_type.value,
                name=node.name,
                path=path,
                extension=node.extension,
                size=node.size,
                children=child_views,
            )

        for root_node in by_parent.get(None, []):
            build_view(root_node, "")

        return [tree_views[n.id] for n in by_parent.get(None, [])]
