from collections.abc import Generator
from contextlib import closing

from extensions.storage.base_storage import BaseStorage


class AliyunStorage(BaseStorage):
    """Implementation for aliyun storage.
    """

    def save(self, filename, data):
        self.client.put_object(filename, data)

    def load_once(self, filename: str) -> bytes:
        with closing(self.client.get_object(filename)) as obj:
            data = obj.read()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            with closing(self.client.get_object(filename)) as obj:
                while chunk := obj.read(4096):
                    yield chunk

        return generate()

    def download(self, filename, target_filepath):
        self.client.get_object_to_file(filename, target_filepath)

    def exists(self, filename):
        return self.client.object_exists(filename)

    def delete(self, filename):
        self.client.delete_object(filename)
