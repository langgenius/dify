from collections.abc import Generator
from pathlib import Path

import opendal

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class OpenDALStorage(BaseStorage):
    def __init__(self):
        path = Path(dify_config.STORAGE_LOCAL_PATH)
        if not path.exists():
            path.mkdir(parents=True)
        self.op = op = opendal.Operator(
            dify_config.STORAGE_OPENDAL_SCHEME,
            root=path.as_posix(),
        )

    def save(self, filename: str, data: bytes) -> None:
        self.op.write(path=filename, bs=data)

    def load_once(self, filename: str) -> bytes:
        return self.op.read(path=filename)

    def load_stream(self, filename: str) -> Generator:
        batch_size = 4096
        file = self.op.open(path=filename, mode="rb")
        while chunk := file.read(batch_size):
            yield chunk

    def download(self, filename: str, target_filepath: str):
        with Path(target_filepath).open("wb") as f:
            f.write(self.op.read(path=filename))

    def exists(self, filename):
        return self.op.stat(path=filename).mode.is_file()

    def delete(self, filename):
        return self.op.delete(path=filename)
