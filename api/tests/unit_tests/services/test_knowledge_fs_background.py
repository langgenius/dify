import shutil
from collections.abc import Callable, Iterator
from pathlib import Path
from unittest.mock import patch

import pytest
from billiard.exceptions import SoftTimeLimitExceeded
from pydantic import ValidationError

from services.knowledge_fs.background_contract import (
    DELIVERY_TASK,
    DISPATCH_QUEUE,
    DOCUMENT_QUEUE,
    OPERATION_QUEUES,
    SOURCE_QUEUE,
    BackgroundJobPayload,
)
from services.knowledge_fs.background_engine import (
    KnowledgeFSBackgroundEngine,
    KnowledgeFSBackgroundEngineError,
    engine_environment,
)
from services.knowledge_fs.background_publisher import check_background_publisher_ready, publish_background_job

JOB = {
    "id": "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
    "type": "document.compile",
    "payload": {"attemptId": "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02"},
    "attempts": 1,
}


@pytest.mark.parametrize(
    "override",
    [
        {"type": "shell"},
        {"command": "anything"},
        {"attempts": 0},
        {"attempts": True},
        {"runAfter": 1.5},
        {"payload": {"attemptId": JOB["payload"]["attemptId"], "tenantId": "untrusted"}},
        {"type": "quality.page-index-findability"},
    ],
)
def test_locator_rejects_untrusted_execution_parameters(override: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        BackgroundJobPayload.model_validate({**JOB, **override})


def test_publisher_uses_the_shared_broker_and_preserves_delivery_id(config_overrides: Callable[..., None]) -> None:
    config_overrides(KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED=True)
    with patch("services.knowledge_fs.background_publisher.current_app") as celery:
        publish_background_job(BackgroundJobPayload.model_validate(JOB))
    kwargs = celery.send_task.call_args.kwargs
    assert celery.send_task.call_args.args == (DELIVERY_TASK,)
    assert kwargs["queue"] == DOCUMENT_QUEUE
    assert kwargs["task_id"] == JOB["id"]
    assert kwargs["kwargs"]["delivery"] == JOB
    assert kwargs["retry"] is False


def test_disabled_publisher_does_not_silently_accept_work(config_overrides: Callable[..., None]) -> None:
    config_overrides(KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED=False)
    with patch("services.knowledge_fs.background_publisher.current_app") as celery:
        with pytest.raises(RuntimeError, match="not enabled"):
            publish_background_job(BackgroundJobPayload.model_validate(JOB))
        celery.send_task.assert_not_called()


def test_dispatch_and_source_waits_cannot_share_the_document_execution_queue() -> None:
    assert OPERATION_QUEUES["document.dispatch"] == DISPATCH_QUEUE
    assert OPERATION_QUEUES["source.execute"] == SOURCE_QUEUE
    assert SOURCE_QUEUE != DOCUMENT_QUEUE
    assert DISPATCH_QUEUE != DOCUMENT_QUEUE


def test_worker_does_not_inherit_control_plane_signing_keys_or_shell_hooks() -> None:
    env = engine_environment(
        {
            "PATH": "/bin",
            "DATABASE_URL": "test-db",
            "DIFY_INNER_API_KEY": "test-key",
            "KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM": "private",
            "NODE_OPTIONS": "--require evil",
            "SECRET_KEY": "private",
            "KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY": "4",
            "NODE_ENV": "development",
            "DIFY_ROOT_KNOWLEDGE_BACKGROUND_EXECUTION_OVERRIDE": "embedded",
        }
    )
    assert "NODE_OPTIONS" not in env
    assert "SECRET_KEY" not in env
    assert "KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM" not in env
    assert env["KNOWLEDGE_BACKGROUND_EXECUTION"] == "celery"
    assert env["DIFY_INNER_API_KEY"] == "test-key"
    assert env["KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY"] == "4"
    assert env["NODE_ENV"] == "production"
    assert env["DIFY_ROOT_KNOWLEDGE_BACKGROUND_EXECUTION_OVERRIDE"] == "celery"


def test_publisher_readiness_checks_broker_without_publish_retry(config_overrides: Callable[..., None]) -> None:
    config_overrides(KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED=True)
    with patch("services.knowledge_fs.background_publisher.current_app") as celery:
        celery.conf.broker_transport_options = {"global_keyprefix": "test:"}
        check_background_publisher_ready()
        connection = celery.connection_for_write.return_value.__enter__.return_value
        connection.ensure_connection.assert_called_once_with(max_retries=0, timeout=3)
        celery.send_task.assert_not_called()


@pytest.fixture
def engine(tmp_path: Path, config_overrides: Callable[..., None]) -> Iterator[KnowledgeFSBackgroundEngine]:
    if shutil.which("node") is None:
        pytest.skip("Node is required for the private IPC unit fixture")
    script = tmp_path / "engine.mjs"
    script.write_text("""
import {createInterface} from 'node:readline';
let calls=0;
createInterface({input:process.stdin}).on('line', line => {
  const input=JSON.parse(line);
  const result={outcome:'completed',pid:process.pid,calls:++calls};
  if(input.operation==='invalid-retry') {result.outcome='retry';result.runAfter='later';}
  if(input.operation==='invalid-outcome') result.outcome='unknown';
  if(input.operation==='oversize') result.body='x'.repeat(17000);
  const id=input.operation==='wrong-id'?'wrong':input.id;
  process.stdout.write(JSON.stringify({protocol:input.protocol,id,ok:true,result})+'\\n');
});
""")
    config_overrides(KNOWLEDGE_FS_BACKGROUND_ENGINE_PATH=str(script))
    instance = KnowledgeFSBackgroundEngine()
    try:
        yield instance
    finally:
        instance.close()


def test_engine_reuses_a_private_child_without_calling_an_api_pod(engine: KnowledgeFSBackgroundEngine) -> None:
    first = engine.execute("document.dispatch")
    second = engine.execute("source.execute")
    assert first["pid"] == second["pid"]
    assert first["calls"] == 1
    assert second["calls"] == 2


def test_mismatched_response_kills_the_engine_and_restarts_cleanly(engine: KnowledgeFSBackgroundEngine) -> None:
    first = engine.execute("document.dispatch")
    with pytest.raises(KnowledgeFSBackgroundEngineError, match="identity mismatch"):
        engine.execute("wrong-id")
    second = engine.execute("document.dispatch")
    assert second["pid"] != first["pid"]
    assert second["calls"] == 1


def test_ipc_rejects_large_locators_before_spawning_a_process() -> None:
    engine = KnowledgeFSBackgroundEngine()
    with patch.object(engine, "_start") as start:
        with pytest.raises(KnowledgeFSBackgroundEngineError, match="too large"):
            engine.execute("delivery", {"body": "x" * 20_000})
        start.assert_not_called()


@pytest.mark.parametrize("operation", ["invalid-retry", "invalid-outcome", "oversize"])
def test_invalid_engine_responses_discard_the_child(engine: KnowledgeFSBackgroundEngine, operation: str) -> None:
    with pytest.raises(KnowledgeFSBackgroundEngineError):
        engine.execute(operation)
    assert engine.execute("document.dispatch")["calls"] == 1


def test_soft_time_limit_terminates_the_active_engine_before_retry(engine: KnowledgeFSBackgroundEngine) -> None:
    first = engine.execute("document.dispatch")
    with patch("services.knowledge_fs.background_engine.selectors.DefaultSelector") as selector:
        selector.return_value.__enter__.return_value.select.side_effect = SoftTimeLimitExceeded()
        with pytest.raises(SoftTimeLimitExceeded):
            engine.execute("document.dispatch")
    second = engine.execute("document.dispatch")
    assert second["pid"] != first["pid"]
    assert second["calls"] == 1
