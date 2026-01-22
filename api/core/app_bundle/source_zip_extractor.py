from __future__ import annotations

import hashlib
import io
import zipfile
from collections.abc import Callable
from typing import TYPE_CHECKING
from uuid import uuid4

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app.entities.app_bundle_entities import ExtractedFile, ExtractedFolder, ZipSecurityError

if TYPE_CHECKING:
    from extensions.ext_storage import Storage


class SourceZipExtractor:
    def __init__(self, storage: Storage) -> None:
        self._storage = storage

    def extract_entries(
        self, zip_bytes: bytes, *, expected_prefix: str
    ) -> tuple[list[ExtractedFolder], list[ExtractedFile]]:
        folders: list[ExtractedFolder] = []
        files: list[ExtractedFile] = []

        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            for info in zf.infolist():
                name = info.filename
                self._validate_path(name)

                if not name.startswith(expected_prefix):
                    continue

                relative_path = name[len(expected_prefix) :].lstrip("/")
                if not relative_path:
                    continue

                if info.is_dir():
                    folders.append(ExtractedFolder(path=relative_path.rstrip("/")))
                else:
                    content = zf.read(info)
                    files.append(ExtractedFile(path=relative_path, content=content))

        return folders, files

    def build_tree_and_save(
        self,
        folders: list[ExtractedFolder],
        files: list[ExtractedFile],
        tenant_id: str,
        app_id: str,
        storage_key_fn: Callable[[str, str, str], str],
    ) -> AppAssetFileTree:
        tree = AppAssetFileTree()
        path_to_node_id: dict[str, str] = {}

        all_folder_paths = {f.path for f in folders}
        for file in files:
            self._ensure_parent_folders(file.path, all_folder_paths)

        sorted_folders = sorted(all_folder_paths, key=lambda p: p.count("/"))
        for folder_path in sorted_folders:
            node_id = str(uuid4())
            name = folder_path.rsplit("/", 1)[-1]
            parent_path = folder_path.rsplit("/", 1)[0] if "/" in folder_path else None
            parent_id = path_to_node_id.get(parent_path) if parent_path else None

            node = AppAssetNode.create_folder(node_id, name, parent_id)
            tree.add(node)
            path_to_node_id[folder_path] = node_id

        sorted_files = sorted(files, key=lambda f: f.path)
        for file in sorted_files:
            node_id = str(uuid4())
            name = file.path.rsplit("/", 1)[-1]
            parent_path = file.path.rsplit("/", 1)[0] if "/" in file.path else None
            parent_id = path_to_node_id.get(parent_path) if parent_path else None

            checksum = hashlib.sha256(file.content).hexdigest()
            node = AppAssetNode.create_file(node_id, name, parent_id, len(file.content), checksum)
            tree.add(node)

            storage_key = storage_key_fn(tenant_id, app_id, node_id)
            self._storage.save(storage_key, file.content)

        return tree

    def _validate_path(self, path: str) -> None:
        if ".." in path:
            raise ZipSecurityError(f"Path traversal detected: {path}")
        if path.startswith("/"):
            raise ZipSecurityError(f"Absolute path detected: {path}")
        if "\\" in path:
            raise ZipSecurityError(f"Backslash in path: {path}")

    def _ensure_parent_folders(self, file_path: str, folder_set: set[str]) -> None:
        parts = file_path.split("/")[:-1]
        for i in range(1, len(parts) + 1):
            parent = "/".join(parts[:i])
            folder_set.add(parent)
