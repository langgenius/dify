from collections.abc import Generator
from pathlib import Path

import opendal

from extensions.storage.base_storage import BaseStorage


class OpenDALStorage(BaseStorage):
    def __init__(self, scheme: str, root_path: str):
        self.op = op = opendal.Operator(
            scheme=scheme,
            root=root_path,
        )

    def save(self, filename: str, data: bytes) -> None:
        self.op.write(path=filename, bs=data)

    def load_once(self, filename: str) -> bytes:
        if not self.exists(filename):
            raise FileNotFoundError("File not found")

        return self.op.read(path=filename)

    def load_stream(self, filename: str) -> Generator:
        if not self.exists(filename):
            raise FileNotFoundError("File not found")

        batch_size = 4096
        file = self.op.open(path=filename, mode="rb")
        while chunk := file.read(batch_size):
            yield chunk

    def download(self, filename: str, target_filepath: str):
        if not self.exists(filename):
            raise FileNotFoundError("File not found")

        with Path(target_filepath).open("wb") as f:
            f.write(self.op.read(path=filename))

    def exists(self, filename: str):
        return self.op.stat(path=filename).mode.is_file()

    def delete(self, filename: str):
        if self.exists(filename):
            self.op.delete(path=filename)
