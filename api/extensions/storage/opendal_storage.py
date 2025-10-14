import logging
import os
from collections.abc import Generator
from pathlib import Path

import opendal
from dotenv import dotenv_values
from opendal import Operator

from extensions.storage.base_storage import BaseStorage

logger = logging.getLogger(__name__)


def _get_opendal_kwargs(*, scheme: str, env_file_path: str = ".env", prefix: str = "OPENDAL_"):
    kwargs = {}
    config_prefix = prefix + scheme.upper() + "_"
    for key, value in os.environ.items():
        if key.startswith(config_prefix):
            kwargs[key[len(config_prefix) :].lower()] = value

    file_env_vars: dict = dotenv_values(env_file_path) or {}
    for key, value in file_env_vars.items():
        if key.startswith(config_prefix) and key[len(config_prefix) :].lower() not in kwargs and value:
            kwargs[key[len(config_prefix) :].lower()] = value

    return kwargs


class OpenDALStorage(BaseStorage):
    def __init__(self, scheme: str, **kwargs):
        kwargs = kwargs or _get_opendal_kwargs(scheme=scheme)

        if scheme == "fs":
            root = kwargs.get("root", "storage")
            Path(root).mkdir(parents=True, exist_ok=True)

        retry_layer = opendal.layers.RetryLayer(max_times=3, factor=2.0, jitter=True)
        self.op = Operator(scheme=scheme, **kwargs).layer(retry_layer)
        logger.debug("opendal operator created with scheme %s", scheme)
        logger.debug("added retry layer to opendal operator")

    def save(self, filename: str, data: bytes):
        self.op.write(path=filename, bs=data)
        logger.debug("file %s saved", filename)

    def load_once(self, filename: str) -> bytes:
        if not self.exists(filename):
            raise FileNotFoundError("File not found")

        content: bytes = self.op.read(path=filename)
        logger.debug("file %s loaded", filename)
        return content

    def load_stream(self, filename: str) -> Generator:
        if not self.exists(filename):
            raise FileNotFoundError("File not found")

        batch_size = 4096
        with self.op.open(
            path=filename,
            mode="rb",
            chunck=batch_size,
        ) as file:
            while chunk := file.read(batch_size):
                yield chunk
        logger.debug("file %s loaded as stream", filename)

    def download(self, filename: str, target_filepath: str):
        if not self.exists(filename):
            raise FileNotFoundError("File not found")

        Path(target_filepath).write_bytes(self.op.read(path=filename))
        logger.debug("file %s downloaded to %s", filename, target_filepath)

    def exists(self, filename: str) -> bool:
        return self.op.exists(path=filename)

    def delete(self, filename: str):
        if self.exists(filename):
            self.op.delete(path=filename)
            logger.debug("file %s deleted", filename)
            return
        logger.debug("file %s not found, skip delete", filename)

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        if not self.exists(path):
            raise FileNotFoundError("Path not found")

        all_files = self.op.list(path=path)
        if files and directories:
            logger.debug("files and directories on %s scanned", path)
            return [f.path for f in all_files]
        if files:
            logger.debug("files on %s scanned", path)
            return [f.path for f in all_files if not f.path.endswith("/")]
        elif directories:
            logger.debug("directories on %s scanned", path)
            return [f.path for f in all_files if f.path.endswith("/")]
        else:
            raise ValueError("At least one of files or directories must be True")
