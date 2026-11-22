"""Record log export I/O at the Redis, object storage, and Celery boundaries."""

from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from extensions.ext_redis import RedisClientWrapper
from extensions.ext_storage import storage
from tasks.log_export_tasks import prepare_log_export_task


@dataclass(frozen=True)
class LogExportRedisIo:
    client: RedisClientWrapper
    setex: MagicMock
    get: MagicMock
    register_script: MagicMock


@pytest.fixture
def log_export_redis() -> Iterator[LogExportRedisIo]:
    """Use the real task cache while intercepting its calls to the Redis server."""
    client = RedisClientWrapper()
    with (
        patch.object(client, "setex") as setex,
        patch.object(client, "get", return_value=None) as get,
        patch.object(client, "register_script") as register_script,
    ):
        yield LogExportRedisIo(client, setex, get, register_script)


@dataclass(frozen=True)
class LogExportStorageIo:
    exists: MagicMock
    load: MagicMock
    save_file: MagicMock
    generate_presigned_url: MagicMock


@pytest.fixture
def log_export_storage() -> Iterator[LogExportStorageIo]:
    """Intercept object I/O while the production adapter writes and opens the CSV."""
    with (
        patch.object(storage, "exists") as exists,
        patch.object(storage, "load") as load,
        patch.object(storage, "save_file") as save_file,
        patch.object(storage, "generate_presigned_url") as sign,
    ):
        yield LogExportStorageIo(exists, load, save_file, sign)


@pytest.fixture
def log_export_publish() -> Iterator[MagicMock]:
    """Record publishes while keeping the real Celery task available for inline execution."""
    with patch.object(prepare_log_export_task, "apply_async") as publish:
        yield publish
