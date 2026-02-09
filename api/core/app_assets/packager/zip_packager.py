import io
import zipfile
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from typing import TYPE_CHECKING

from core.app_assets.entities import AssetItem

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
            lock = Lock()
            # FOR DELVELPMENT AND TESTING ONLY, TODO: optimize
            with ThreadPoolExecutor(max_workers=8) as executor:
                futures: list[Future[None]] = []
                for asset in assets:

                    def _write_asset(a: AssetItem) -> None:
                        content = self._storage.load_once(a.get_storage_key())
                        with lock:
                            zf.writestr(a.path, content)

                    futures.append(executor.submit(_write_asset, asset))

                # Wait for all futures to complete
                for future in futures:
                    future.result()

        return zip_buffer.getvalue()
