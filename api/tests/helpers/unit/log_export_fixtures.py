"""Record log export I/O with scripted Redis replies and intercepted storage and Celery calls."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from extensions.ext_redis import RedisClientWrapper
from extensions.ext_storage import storage
from services.retention import log_export_task_cache
from tasks.log_export_tasks import prepare_log_export_task


@dataclass
class LogExportRedisIo:
    client: RedisClientWrapper
    cache: dict[str, str]
    get: MagicMock
    reject_submission: bool = False
    claim_error: Exception | None = None
    renew_calls: int = 0
    renew_error: Exception | None = None
    finish_error: Exception | None = None


@pytest.fixture
def log_export_redis() -> Iterator[LogExportRedisIo]:
    """Supply script replies for HTTP and worker tests independently of Redis availability."""
    client = RedisClientWrapper()
    cache: dict[str, str] = {}
    ttls: dict[str, int] = {}

    def setex(key: str, ttl: int, payload: str) -> None:
        cache[key] = payload
        ttls[key] = ttl

    def save(*, keys: list[str], args: list[Any]) -> int:
        if io.reject_submission:
            return 0
        key, latest, _ = keys
        _, ttl_ms, raw, task_id, _ = args
        setex(key, ttl_ms // 1000, raw)
        setex(latest, ttl_ms // 1000, task_id)
        return 1

    def claim(*, keys: tuple[str, str, str], args: list[Any]) -> int:
        if (error := io.claim_error) is not None:
            raise error
        key = keys[0]
        if json.loads(cache[key])["status"] == "processing":
            return -1
        cache[key] = args[2]
        return 1

    def finish(*, keys: tuple[str, str, str, str, str], args: list[Any]) -> int:
        if (error := io.finish_error) is not None:
            raise error
        cache[keys[0]] = args[2]
        return 1

    def renew(*, keys: list[str], args: list[Any]) -> int:
        io.renew_calls += 1
        if (error := io.renew_error) is not None:
            raise error
        if len(args) == 3:
            cache[keys[0]] = args[2]
        return 1

    def unconfigured_script(**_arguments: object) -> int:
        """Permit registration when composing services, then fail if an unrelated script runs."""
        raise AssertionError("Unexpected Redis script execution in a log export test")

    scripts = {
        log_export_task_cache._SAVE_LOG_EXPORT_TASK: save,
        log_export_task_cache._CLAIM_LOG_EXPORT_TASK: claim,
        log_export_task_cache._RENEW_LOG_EXPORT_TASK: renew,
        log_export_task_cache._FINISH_LOG_EXPORT_TASK: finish,
    }
    with (
        patch.object(client, "get", wraps=cache.get) as get,
        patch.object(client, "setex", side_effect=setex),
        patch.object(client, "ttl", side_effect=ttls.get),
        patch.object(client, "delete", side_effect=cache.pop),
        patch.object(client, "register_script", side_effect=lambda script: scripts.get(script, unconfigured_script)),
    ):
        io = LogExportRedisIo(client, cache, get)
        yield io


@dataclass(frozen=True)
class LogExportStorageIo:
    exists: MagicMock
    load: MagicMock
    save_from_path: MagicMock
    generate_presigned_url: MagicMock


@pytest.fixture
def log_export_storage() -> Iterator[LogExportStorageIo]:
    """Intercept object I/O while the production adapter writes and opens the CSV."""
    with (
        patch.object(storage, "exists") as exists,
        patch.object(storage, "load") as load,
        patch.object(storage, "save_from_path") as save_from_path,
        patch.object(storage, "generate_presigned_url") as sign,
    ):
        yield LogExportStorageIo(exists, load, save_from_path, sign)


@pytest.fixture
def log_export_publish() -> Iterator[MagicMock]:
    """Record publishes while keeping the real Celery task available for inline execution."""
    with patch.object(prepare_log_export_task, "apply_async") as publish:
        yield publish
