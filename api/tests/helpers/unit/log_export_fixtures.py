"""Record log export I/O with scripted Redis replies and intercepted storage and Celery calls."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from extensions.ext_redis import RedisClientWrapper
from extensions.ext_storage import storage
from libs.datetime_utils import utc_now
from services.retention import log_export_task_cache
from tasks import log_export_tasks
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
def log_export_redis(monkeypatch: pytest.MonkeyPatch) -> Iterator[LogExportRedisIo]:
    """Supply script replies for HTTP and worker tests independently of Redis availability."""
    client = RedisClientWrapper()
    cache: dict[str, str] = {}
    ttls: dict[str, int] = {}
    queues: dict[str, list[str]] = {}
    active: dict[str, set[str]] = {}

    def setex(key: str, ttl: int, payload: str) -> None:
        cache[key] = payload
        ttls[key] = ttl

    def delete(key: str) -> int:
        ttls.pop(key, None)
        return int(cache.pop(key, None) is not None)

    def save(*, keys: list[str], args: list[Any]) -> int:
        key, latest, requests, queue = keys
        member, raw, task_id, entry = args
        jobs = queues.setdefault(queue, [])
        members = active.setdefault(requests, set())
        if key in cache:
            return 1 if jobs and jobs[0] == entry else 2
        if io.reject_submission or member in members:
            return 0
        setex(key, -1, raw)
        setex(latest, -1, task_id)
        members.add(member)
        jobs.append(entry)
        return 1 if len(jobs) == 1 else 2

    def read_head(*, keys: list[str]) -> str | None:
        queue = queues.get(keys[0])
        return queue[0] if queue else None

    def reserve_dispatch(*, keys: list[str], args: list[Any]) -> int:
        queue, task, lease, dispatch, requests = keys
        entry, member, lease_seconds = args
        if read_head(keys=[queue]) != entry:
            return 0
        if task not in cache:
            queues[queue].pop(0)
            active[requests].discard(member)
            return -1
        if lease in cache or dispatch in cache:
            return 0
        setex(dispatch, lease_seconds, "1")
        return 1

    def claim(*, keys: tuple[str, ...], args: list[Any]) -> int:
        if (error := io.claim_error) is not None:
            raise error
        task, lease, _, queue, _, _ = keys
        current = json.loads(cache[task])
        if current["status"] not in ("pending", "processing"):
            return 0
        if args[8] == "queued" and read_head(keys=[queue]) != args[7]:
            return 0
        if current["status"] == "processing":
            return -1
        cache[task] = args[2]
        setex(lease, args[4], args[6])
        return 1

    def finish(*, keys: tuple[str, ...], args: list[Any]) -> int:
        if (error := io.finish_error) is not None:
            raise error
        task, lease, requests, latest, email, queue = keys
        status, attempt, raw, member, token, expires, entry, next_status = args
        current = json.loads(cache[task])
        if current["status"] == next_status == "canceled":
            return 2
        if current["status"] != status or current.get("attempt", 0) != attempt:
            return 0
        if status == "processing" and cache.get(lease) != token:
            return 0
        ttl = max(1, (expires - int(utc_now().timestamp() * 1000)) // 1000)
        setex(task, ttl, raw)
        if cache.get(latest) == current["task_id"]:
            ttls[latest] = ttl
        if next_status != "ready":
            delete(email)
        delete(lease)
        active.get(requests, set()).discard(member)
        if entry in queues.get(queue, []):
            queues[queue].remove(entry)
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
        log_export_task_cache._READ_LOG_EXPORT_HEAD: read_head,
        log_export_task_cache._RESERVE_LOG_EXPORT_DISPATCH: reserve_dispatch,
        log_export_task_cache._CLAIM_LOG_EXPORT_TASK: claim,
        log_export_task_cache._RENEW_LOG_EXPORT_TASK: renew,
        log_export_task_cache._FINISH_LOG_EXPORT_TASK: finish,
    }
    monkeypatch.setattr(log_export_tasks, "redis_client", client)
    with (
        patch.object(client, "get", wraps=cache.get) as get,
        patch.object(client, "setex", side_effect=setex),
        patch.object(client, "ttl", side_effect=ttls.get),
        patch.object(client, "delete", side_effect=delete),
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
