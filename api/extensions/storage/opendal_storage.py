from collections.abc import Generator
from pathlib import Path
from urllib.parse import urlparse

import opendal

from configs.middleware.storage.opendal_storage_config import OpenDALScheme
from extensions.storage.base_storage import BaseStorage

S3_R2_HOSTNAME = "r2.cloudflarestorage.com"
S3_R2_COMPATIBLE_KWARGS = {
    "delete_max_size": "700",
    "disable_stat_with_override": "true",
    "region": "auto",
}
S3_SSE_WITH_AWS_MANAGED_IAM_KWARGS = {
    "server_side_encryption": "aws:kms",
}


def is_r2_endpoint(endpoint: str) -> bool:
    if not endpoint:
        return False

    parsed_url = urlparse(endpoint)
    return bool(parsed_url.hostname and parsed_url.hostname.endswith(S3_R2_HOSTNAME))


class OpenDALStorage(BaseStorage):
    def __init__(self, scheme: OpenDALScheme, **kwargs):
        if scheme == OpenDALScheme.FS:
            Path(kwargs["root"]).mkdir(parents=True, exist_ok=True)

        self.op = opendal.Operator(scheme=scheme, **kwargs)

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

    def exists(self, filename: str) -> bool:
        # FIXME this is a workaround for opendal python-binding do not have a exists method and no better
        # error handler here when opendal python-binding has a exists method, we should use it
        # more https://github.com/apache/opendal/blob/main/bindings/python/src/operator.rs
        try:
            return self.op.stat(path=filename).mode.is_file()
        except Exception as e:
            return False

    def delete(self, filename: str):
        if self.exists(filename):
            self.op.delete(path=filename)
