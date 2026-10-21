"""Worker-bootstrap coverage for durable knowledge tasks."""

from __future__ import annotations

import inspect
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, cast

import pytest

_API_ROOT = Path(__file__).resolve().parents[3]
_RESULT_MARKER = "CELERY_BOOTSTRAP_RESULT="
_BATCH_CLEAN_MODULE = "tasks.batch_clean_document_task"
_BATCH_CLEAN_TASK = f"{_BATCH_CLEAN_MODULE}.batch_clean_document_task"
_RAG_PIPELINE_QUEUE_RECOVERY_MODULE = "tasks.rag_pipeline.rag_pipeline_queue_recovery_task"
_RAG_PIPELINE_QUEUE_RECOVERY_TASK = f"{_RAG_PIPELINE_QUEUE_RECOVERY_MODULE}.recover_rag_pipeline_tenant_queue"
_RAG_PIPELINE_V2_TASKS = frozenset(
    {
        "tasks.rag_pipeline.rag_pipeline_run_task.rag_pipeline_run_task_v2",
        "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task_v2",
    }
)
_SEGMENT_STATUS_TASKS = frozenset(
    {
        "tasks.enable_segments_to_index_task.enable_segments_to_index_task",
        "tasks.disable_segments_from_index_task.disable_segments_from_index_task",
    }
)

_REQUIRED_MODULES = frozenset(
    {
        "tasks.clean_document_task",
        "tasks.clean_upload_files_task",
        "tasks.cleanup_knowledge_index_task",
        _BATCH_CLEAN_MODULE,
        "tasks.retry_document_indexing_task",
        "tasks.document_indexing_task",
        "tasks.document_indexing_sync_task",
        "tasks.duplicate_document_indexing_task",
        "tasks.document_indexing_update_task",
        "tasks.add_document_to_index_task",
        "tasks.remove_document_from_index_task",
        "tasks.recover_document_indexing_task",
        "tasks.sync_website_document_indexing_task",
        "tasks.index_created_segments_task",
        "tasks.delete_segment_from_index_task",
        "tasks.reconcile_segment_index_task",
        "tasks.clean_dataset_task",
        "tasks.deal_dataset_vector_index_task",
        "tasks.deal_dataset_index_update_task",
        "tasks.generate_summary_index_task",
        "tasks.regenerate_summary_index_task",
        "tasks.enable_segments_to_index_task",
        "tasks.disable_segments_from_index_task",
        "tasks.knowledge_task_outbox_task",
        _RAG_PIPELINE_QUEUE_RECOVERY_MODULE,
    }
)
_REQUIRED_TASKS = frozenset(
    {
        "tasks.clean_document_task.clean_document_task",
        "tasks.clean_upload_files_task.clean_upload_files_task",
        "tasks.cleanup_knowledge_index_task.cleanup_knowledge_index_task",
        _BATCH_CLEAN_TASK,
        "tasks.retry_document_indexing_task.retry_document_indexing_task",
        "tasks.document_indexing_task.document_indexing_task",
        "tasks.document_indexing_task.normal_document_indexing_task",
        "tasks.document_indexing_task.priority_document_indexing_task",
        "tasks.document_indexing_sync_task.document_indexing_sync_task",
        "tasks.document_indexing_sync_task.sync_notion_document_indexing_task",
        "tasks.duplicate_document_indexing_task.duplicate_document_indexing_task",
        "tasks.duplicate_document_indexing_task.normal_duplicate_document_indexing_task",
        "tasks.duplicate_document_indexing_task.priority_duplicate_document_indexing_task",
        "tasks.document_indexing_update_task.document_indexing_update_task",
        "tasks.add_document_to_index_task.add_document_to_index_task",
        "tasks.remove_document_from_index_task.remove_document_from_index_task",
        "tasks.recover_document_indexing_task.recover_document_indexing_task",
        "tasks.sync_website_document_indexing_task.sync_website_document_indexing_task",
        "tasks.index_created_segments_task.index_created_segments_task",
        "tasks.delete_segment_from_index_task.delete_segment_from_index_task",
        "tasks.reconcile_segment_index_task.reconcile_segment_index_task",
        "tasks.clean_dataset_task.clean_dataset_task",
        "tasks.deal_dataset_vector_index_task.deal_dataset_vector_index_task",
        "tasks.deal_dataset_index_update_task.deal_dataset_index_update_task",
        "tasks.generate_summary_index_task.generate_summary_index_task",
        "tasks.regenerate_summary_index_task.regenerate_summary_index_task",
        "tasks.enable_segments_to_index_task.enable_segments_to_index_task",
        "tasks.disable_segments_from_index_task.disable_segments_from_index_task",
        "tasks.knowledge_task_outbox_task.dispatch_knowledge_task_outbox",
        "tasks.knowledge_task_outbox_task.recover_knowledge_tenant_task_queue",
        _RAG_PIPELINE_QUEUE_RECOVERY_TASK,
        *_RAG_PIPELINE_V2_TASKS,
    }
)


@pytest.mark.parametrize(
    "worker_queues",
    [None, "dataset,dataset_summary,priority_dataset,pipeline,priority_pipeline"],
)
def test_worker_entrypoint_adds_versioned_pipeline_and_knowledge_queues(
    tmp_path: Path, worker_queues: str | None
) -> None:
    """A new worker consumes both generations while old workers remain on legacy queues."""

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_celery = fake_bin / "celery"
    fake_celery.write_text("#!/bin/sh\nprintf 'CELERY_ARG=%s\\n' \"$@\"\n")
    fake_celery.chmod(0o755)
    environment: dict[str, str] = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "MODE": "worker",
        "MIGRATION_ENABLED": "false",
        "CELERY_AUTO_SCALE": "false",
    }
    if worker_queues is not None:
        environment["CELERY_WORKER_QUEUES"] = worker_queues
    else:
        environment.pop("CELERY_WORKER_QUEUES", None)
        environment.pop("CELERY_QUEUES", None)

    completed = subprocess.run(
        ["bash", str(_API_ROOT / "docker" / "entrypoint.sh")],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert "CELERY_ARG=-Q" in completed.stdout
    queue_argument = next(
        line.removeprefix("CELERY_ARG=")
        for line in completed.stdout.splitlines()
        if line.startswith("CELERY_ARG=") and "dataset," in line
    )
    assert set(queue_argument.split(",")) >= {
        "dataset",
        "dataset_v2",
        "dataset_summary",
        "dataset_summary_v2",
        "priority_dataset",
        "priority_dataset_v2",
        "pipeline",
        "pipeline_v2",
        "priority_pipeline",
        "priority_pipeline_v2",
    }


@pytest.mark.parametrize(
    "arguments",
    [
        [],
        ["--queues", "dataset,dataset_summary,priority_dataset,pipeline,priority_pipeline"],
    ],
)
def test_development_worker_adds_all_versioned_queues_to_defaults_and_overrides(
    tmp_path: Path, arguments: list[str]
) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_uv = fake_bin / "uv"
    fake_uv.write_text("#!/bin/sh\nprintf 'UV_ARG=%s\\n' \"$@\"\n")
    fake_uv.chmod(0o755)
    environment = {**os.environ, "PATH": f"{fake_bin}:{os.environ['PATH']}"}
    environment.pop("QUEUES", None)

    completed = subprocess.run(
        ["bash", str(_API_ROOT.parent / "dev" / "start-worker"), *arguments],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )

    queue_argument = next(
        line.removeprefix("UV_ARG=")
        for line in completed.stdout.splitlines()
        if line.startswith("UV_ARG=") and "dataset," in line
    )
    assert set(queue_argument.split(",")) >= {
        "dataset",
        "dataset_v2",
        "dataset_summary",
        "dataset_summary_v2",
        "priority_dataset",
        "priority_dataset_v2",
        "pipeline",
        "pipeline_v2",
        "priority_pipeline",
        "priority_pipeline_v2",
    }


_PROBE_SCRIPT = f"""
import json
import os
import threading

from celery.contrib.testing.worker import start_worker
from flask import has_app_context
from redis import Redis

from dify_app import DifyApp
from extensions import ext_celery
from extensions.ext_redis import redis_client

# Registering Lua scripts is local; no Redis command is sent during worker
# bootstrap. This mirrors the production extension order without an external
# Redis service.
redis_client.initialize(Redis.from_url("redis://localhost:6379/0"))
ext_celery.setup_workflow_warm_shutdown_handler = lambda: None

celery_app = ext_celery.init_app(DifyApp("knowledge-task-bootstrap-probe"))
drop_module = os.environ.get("DROP_BOOTSTRAP_MODULE")
if drop_module:
    celery_app.conf.imports = tuple(module for module in celery_app.conf.imports if module != drop_module)

celery_app.loader.import_default_modules()
strategies = []
segment_task_contexts = {{}}
if os.environ["RUN_BOOTSTRAP_WORKER"] == "true":
    segment_task_context_event = threading.Event()

    def record_segment_task_context(task_name):
        def run(*args, **kwargs):
            segment_task_contexts[task_name] = has_app_context()
            if len(segment_task_contexts) == {len(_SEGMENT_STATUS_TASKS)}:
                segment_task_context_event.set()

        return run

    for task_name in {sorted(_SEGMENT_STATUS_TASKS)!r}:
        celery_app.tasks[task_name].run = record_segment_task_context(task_name)
    with start_worker(
        celery_app,
        pool="solo",
        perform_ping_check=False,
        loglevel="ERROR",
        shutdown_timeout=10,
    ) as worker:
        strategies = sorted(worker.consumer.strategies)
        for task_name in {sorted(_SEGMENT_STATUS_TASKS)!r}:
            celery_app.tasks[task_name].apply_async(
                args=[[], "dataset", "document", "intent", True, "a29353f0-3c41-43fc-a204-deaf1905efa9"],
                queue="celery",
            )
        if not segment_task_context_event.wait(timeout=10):
            raise RuntimeError("Timed out waiting for segment status task probes")

result = {{
    "imports": list(celery_app.conf.imports),
    "strategies": strategies,
    "segment_task_contexts": segment_task_contexts,
    "outbox_schedule_enabled": "knowledge_task_outbox_dispatch" in celery_app.conf.beat_schedule,
    "knowledge_schedule_queues": {{
        name: celery_app.conf.beat_schedule[name].get("options", {{}}).get("queue")
        for name in ("knowledge_tenant_task_queue_recovery", "knowledge_task_outbox_dispatch")
        if name in celery_app.conf.beat_schedule
    }},
    "knowledge_task_queues": {{
        name: celery_app.tasks[name].queue
        for name in (
            "tasks.knowledge_task_outbox_task.dispatch_knowledge_task_outbox",
            "tasks.knowledge_task_outbox_task.recover_knowledge_tenant_task_queue",
        )
    }},
}}
print("{_RESULT_MARKER}" + json.dumps(result, sort_keys=True))
celery_app.close()
"""


class _ProbePayload(TypedDict):
    imports: list[str]
    strategies: list[str]
    outbox_schedule_enabled: bool
    segment_task_contexts: dict[str, bool]
    knowledge_schedule_queues: dict[str, str]
    knowledge_task_queues: dict[str, str]


@dataclass(frozen=True)
class _BootstrapProbe:
    imports: frozenset[str]
    strategies: frozenset[str]
    outbox_schedule_enabled: bool
    segment_task_contexts: dict[str, bool]
    knowledge_schedule_queues: dict[str, str]
    knowledge_task_queues: dict[str, str]


def _run_probe(
    *,
    beat_enabled: bool,
    run_worker: bool,
    drop_module: str | None = None,
) -> _BootstrapProbe:
    environment = os.environ.copy()
    environment.update(
        {
            "CELERY_BACKEND": "cache",
            "CELERY_BROKER_URL": "memory://",
            "DISABLE_TELEMETRY": "true",
            "DO_NOT_TRACK": "true",
            "ENABLE_KNOWLEDGE_TASK_OUTBOX_DISPATCH": str(beat_enabled).lower(),
            "RUN_BOOTSTRAP_WORKER": str(run_worker).lower(),
        }
    )
    environment.pop("CELERY_BROKER_READ_URL", None)
    environment.pop("CELERY_BROKER_WRITE_URL", None)
    if drop_module is None:
        environment.pop("DROP_BOOTSTRAP_MODULE", None)
    else:
        environment["DROP_BOOTSTRAP_MODULE"] = drop_module

    completed = subprocess.run(
        [sys.executable, "-c", _PROBE_SCRIPT],
        cwd=_API_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    result_line = next(
        line.removeprefix(_RESULT_MARKER) for line in completed.stdout.splitlines() if line.startswith(_RESULT_MARKER)
    )
    payload = cast(_ProbePayload, json.loads(result_line))
    return _BootstrapProbe(
        imports=frozenset(payload["imports"]),
        strategies=frozenset(payload["strategies"]),
        outbox_schedule_enabled=payload["outbox_schedule_enabled"],
        segment_task_contexts=payload["segment_task_contexts"],
        knowledge_schedule_queues=payload["knowledge_schedule_queues"],
        knowledge_task_queues=payload["knowledge_task_queues"],
    )


@pytest.mark.parametrize(
    ("beat_enabled", "run_worker", "expected_schedule_queues"),
    [
        pytest.param(
            False,
            True,
            {"knowledge_tenant_task_queue_recovery": "dataset_v2"},
            id="worker-with-beat-disabled",
        ),
        pytest.param(
            True,
            False,
            {
                "knowledge_tenant_task_queue_recovery": "dataset_v2",
                "knowledge_task_outbox_dispatch": "dataset_v2",
            },
            id="beat-enabled-without-worker",
        ),
    ],
)
def test_bootstrap_registers_durable_knowledge_tasks(
    beat_enabled: bool,
    run_worker: bool,
    expected_schedule_queues: dict[str, str],
) -> None:
    probe = _run_probe(beat_enabled=beat_enabled, run_worker=run_worker)

    assert probe.imports >= _REQUIRED_MODULES
    assert probe.outbox_schedule_enabled is beat_enabled
    assert probe.knowledge_schedule_queues == expected_schedule_queues
    assert probe.knowledge_task_queues == {
        "tasks.knowledge_task_outbox_task.dispatch_knowledge_task_outbox": "dataset_v2",
        "tasks.knowledge_task_outbox_task.recover_knowledge_tenant_task_queue": "dataset_v2",
    }
    if run_worker:
        assert probe.strategies >= _REQUIRED_TASKS
        assert probe.segment_task_contexts == dict.fromkeys(_SEGMENT_STATUS_TASKS, True)


def test_worker_strategy_depends_on_required_bootstrap_module() -> None:
    probe = _run_probe(
        beat_enabled=False,
        run_worker=True,
        drop_module=_BATCH_CLEAN_MODULE,
    )

    assert _BATCH_CLEAN_MODULE not in probe.imports
    assert _BATCH_CLEAN_TASK not in probe.strategies
    assert "tasks.knowledge_task_outbox_task.dispatch_knowledge_task_outbox" in probe.strategies


_QUEUE_ROUTE_PROBE_SCRIPT = f"""
import json
import threading
import time

from celery import Celery
from celery.contrib.testing.worker import start_worker

app = Celery("knowledge-v2-route-probe", broker="memory://", backend="cache+memory://")
received = []
delivery = threading.Event()

@app.task(name="probe.delete_segment_from_index_task")
def current_cleanup(*args):
    received.append(list(args))
    delivery.set()

extended_args = [["node"], "dataset", "document", ["segment"], [], "tenant", {{}}, "intent", ["summary"]]
legacy_args = [["node"], "dataset", "document", ["segment"], [], "tenant", {{}}, "intent"]

with start_worker(
    app,
    queues=["dataset"],
    pool="solo",
    perform_ping_check=False,
    loglevel="ERROR",
    shutdown_timeout=10,
) as old_worker:
    old_strategies = sorted(old_worker.consumer.strategies)
    current_cleanup.apply_async(args=extended_args, queue="dataset_v2")
    time.sleep(0.2)
    old_worker_consumed_extended = delivery.is_set()

with start_worker(
    app,
    queues=["dataset", "dataset_v2"],
    pool="solo",
    perform_ping_check=False,
    loglevel="ERROR",
    shutdown_timeout=10,
) as new_worker:
    new_strategies = sorted(new_worker.consumer.strategies)
    if not delivery.wait(timeout=10):
        raise RuntimeError("versioned knowledge delivery was not consumed")
    delivery.clear()
    current_cleanup.apply_async(args=legacy_args, queue="dataset")
    if not delivery.wait(timeout=10):
        raise RuntimeError("legacy knowledge delivery was not consumed by the new worker")

print("{_RESULT_MARKER}" + json.dumps({{
    "old_strategies": old_strategies,
    "new_strategies": new_strategies,
    "old_worker_consumed_extended": old_worker_consumed_extended,
    "received": received,
}}, sort_keys=True))
app.close()
"""


class _RouteProbePayload(TypedDict):
    old_strategies: list[str]
    new_strategies: list[str]
    old_worker_consumed_extended: bool
    received: list[list[object]]


def _head_delete_segment_from_index_task(
    index_node_ids: list[str],
    dataset_id: str,
    document_id: str,
    segment_ids: list[str],
    child_node_ids: list[str] | None = None,
    tenant_id: str | None = None,
    cleanup_manifest: dict[str, object] | None = None,
    outbox_id: str | None = None,
) -> None:
    del index_node_ids, dataset_id, document_id, segment_ids, child_node_ids, tenant_id, cleanup_manifest, outbox_id


def test_extended_knowledge_delivery_is_isolated_from_previous_worker_signature() -> None:
    extended_args: tuple[object, ...] = (
        ["node"],
        "dataset",
        "document",
        ["segment"],
        list[str](),
        "tenant",
        dict[str, object](),
        "intent",
        ["summary"],
    )
    with pytest.raises(TypeError):
        inspect.signature(_head_delete_segment_from_index_task).bind(*extended_args)

    completed = subprocess.run(
        [sys.executable, "-c", _QUEUE_ROUTE_PROBE_SCRIPT],
        cwd=_API_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    result_line = next(
        line.removeprefix(_RESULT_MARKER) for line in completed.stdout.splitlines() if line.startswith(_RESULT_MARKER)
    )
    payload = cast(_RouteProbePayload, json.loads(result_line))

    assert "probe.delete_segment_from_index_task" in payload["old_strategies"]
    assert "probe.delete_segment_from_index_task" in payload["new_strategies"]
    assert payload["old_worker_consumed_extended"] is False
    assert payload["received"] == [
        list(extended_args),
        [["node"], "dataset", "document", ["segment"], [], "tenant", {}, "intent"],
    ]
