import io
import zipfile
from typing import TYPE_CHECKING

from core.app_assets.assets import AssetItem

from .base import AssetPackager

if TYPE_CHECKING:
    from extensions.ext_storage import Storage


class ZipPackager(AssetPackager):
    _storage: "Storage"

    def __init__(self, storage: "Storage") -> None:
        self._storage = storage

    def package(self, assets: list[AssetItem]) -> bytes:
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for asset in assets:
                content = self._storage.load_once(asset.get_storage_key())
                zf.writestr(asset.path, content)

        return zip_buffer.getvalue()
