from collections.abc import Generator
from unittest.mock import MagicMock

import pytest

from extensions import ext_redis


def get_example_filename() -> str:
    return 'test_text.txt'


def get_example_file_data() -> bytes:
    return b'test_text'


@pytest.fixture
def setup_mock_redis() -> None:
    # get
    ext_redis.redis_client.get = MagicMock(return_value=None)

    # set
    ext_redis.redis_client.set = MagicMock(return_value=None)

    # lock
    mock_redis_lock = MagicMock()
    mock_redis_lock.__enter__ = MagicMock()
    mock_redis_lock.__exit__ = MagicMock()
    ext_redis.redis_client.lock = mock_redis_lock


class AbstractOssTest:
    def __init__(self):
        self.client = None
        self.filename = get_example_filename()
        self.data = get_example_file_data()

    def save(self):
        raise NotImplementedError

    def load_once(self) -> bytes:
        raise NotImplementedError

    def load_stream(self) -> Generator:
        raise NotImplementedError

    def download(self):
        raise NotImplementedError

    def exists(self):
        raise NotImplementedError

    def delete(self):
        raise NotImplementedError

    def run_all_tests(self):
        self.save()
        self.load_once()
        self.load_stream()
        self.exists()
        self.delete()
