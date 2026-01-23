from __future__ import annotations

import io
import zipfile
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from core.app_assets.entities import AssetItem
from extensions.storage.base_storage import BaseStorage


class AssetZipPackager:
    """
    Unified ZIP packager for assets.
    Automatically creates directory entries from asset paths.
    """

    def __init__(self, storage: BaseStorage, *, max_workers: int = 8) -> None:
        self._storage = storage
        self._max_workers = max_workers

    def package(self, assets: list[AssetItem], *, prefix: str = "") -> bytes:
        """
        Package assets into a ZIP file.

        Args:
            assets: List of assets to package
            prefix: Optional prefix to add to all paths in the ZIP

        Returns:
            ZIP file content as bytes
        """
        zip_buffer = io.BytesIO()

        # Extract folder paths from asset paths
        folder_paths = self._extract_folder_paths(assets, prefix)

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # Create directory entries
            for folder_path in sorted(folder_paths):
                zf.writestr(zipfile.ZipInfo(folder_path + "/"), "")

            # Write files in parallel
            if assets:
                self._write_files_parallel(zf, assets, prefix)

        return zip_buffer.getvalue()

    def _extract_folder_paths(self, assets: list[AssetItem], prefix: str) -> set[str]:
        """Extract all folder paths from asset paths."""
        folders: set[str] = set()
        for asset in assets:
            full_path = f"{prefix}/{asset.path}" if prefix else asset.path
            parts = full_path.split("/")[:-1]  # Remove filename
            folders.update("/".join(parts[:i]) for i in range(1, len(parts) + 1))
        return folders

    def _write_files_parallel(
        self,
        zf: zipfile.ZipFile,
        assets: list[AssetItem],
        prefix: str,
    ) -> None:
        lock = Lock()

        def load_and_write(asset: AssetItem) -> None:
            content = self._storage.load_once(asset.get_storage_key())
            full_path = f"{prefix}/{asset.path}" if prefix else asset.path
            with lock:
                zf.writestr(full_path, content)

        with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
            futures = [executor.submit(load_and_write, a) for a in assets]
            for future in futures:
                future.result()
