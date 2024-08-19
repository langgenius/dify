import os
import shutil
from collections.abc import Generator

from flask import Flask

from extensions.storage.base_storage import BaseStorage


class LocalStorage(BaseStorage):
    """Implementation for local storage."""

    def __init__(self, app: Flask):
        super().__init__(app)
        folder = self.app.config.get("STORAGE_LOCAL_PATH")
        if not os.path.isabs(folder):
            folder = os.path.join(app.root_path, folder)
        self.folder = folder

    def save(self, filename, data):
        if not self.folder or self.folder.endswith("/"):
            filename = self.folder + filename
        else:
            filename = self.folder + "/" + filename

        folder = os.path.dirname(filename)
        os.makedirs(folder, exist_ok=True)

        with open(os.path.join(os.getcwd(), filename), "wb") as f:
            f.write(data)

    def load_once(self, filename: str) -> bytes:
        if not self.folder or self.folder.endswith("/"):
            filename = self.folder + filename
        else:
            filename = self.folder + "/" + filename

        if not os.path.exists(filename):
            raise FileNotFoundError("File not found")

        with open(filename, "rb") as f:
            data = f.read()

        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            if not self.folder or self.folder.endswith("/"):
                filename = self.folder + filename
            else:
                filename = self.folder + "/" + filename

            if not os.path.exists(filename):
                raise FileNotFoundError("File not found")

            with open(filename, "rb") as f:
                while chunk := f.read(4096):  # Read in chunks of 4KB
                    yield chunk

        return generate()

    def download(self, filename, target_filepath):
        if not self.folder or self.folder.endswith("/"):
            filename = self.folder + filename
        else:
            filename = self.folder + "/" + filename

        if not os.path.exists(filename):
            raise FileNotFoundError("File not found")

        shutil.copyfile(filename, target_filepath)

    def exists(self, filename):
        if not self.folder or self.folder.endswith("/"):
            filename = self.folder + filename
        else:
            filename = self.folder + "/" + filename

        return os.path.exists(filename)

    def delete(self, filename):
        if not self.folder or self.folder.endswith("/"):
            filename = self.folder + filename
        else:
            filename = self.folder + "/" + filename
        if os.path.exists(filename):
            os.remove(filename)
