import io
import json
import logging
import time
import uuid
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from numbers import Real
from threading import Event, Thread
from typing import Any, cast

from celery import Task, shared_task
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from clients.agent_backend import (
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    create_agent_backend_run_client,
)
from configs import dify_config
from core.db.session_factory import session_factory
from core.evaluation.agent.agent_v2_trace_collector import AgentV2TraceCollector
from core.evaluation.agent.customized_workflow_adapter import (
    AGENT_CUSTOM_EVALUATOR_NODE_ID,
    build_agent_custom_evaluator_node_result,
)
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolDefinition,
    EvaluationCategory,
    EvaluationDatasetInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationRunData,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentConfig, JudgmentResult
from core.evaluation.evaluation_manager import EvaluationManager
from core.evaluation.exceptions import EvaluationWorkflowVersionNotFoundError
from core.evaluation.judgment.processor import JudgmentProcessor
from core.evaluation.runners.agent_evaluation_runner import AgentEvaluationRunner
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from core.evaluation.runners.llm_evaluation_runner import LLMEvaluationRunner
from core.evaluation.runners.retrieval_evaluation_runner import RetrievalEvaluationRunner
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.agent import AgentWorkspaceBinding
from models.enums import CreatorUserRole
from models.evaluation import (
    EvaluationRun,
    EvaluationRunItem,
    EvaluationRunItemStatus,
    EvaluationRunStatus,
    EvaluationTargetType,
)
from models.model import UploadFile
from services.agent.evaluation_target_service import AgentEvaluationTargetService
from services.agent.workspace_service import AgentWorkspaceService
from services.evaluation_service import EvaluationService
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

logger = logging.getLogger(__name__)

_PERSIST_BATCH_SIZE = 10
_HEARTBEAT_JOIN_TIMEOUT_SECONDS = 5


class EvaluationRunCancelledError(Exception):
    """Raised when cooperative cancellation stops an evaluation task."""


class EvaluationRunOwnershipLostError(Exception):
    """Raised when a task invocation no longer owns the evaluation run lease."""


@dataclass(frozen=True)
class EvaluationRunLease:
    """Fencing token owned by one Celery invocation of an evaluation run."""

    run_id: str
    token: str


def _workflow_task_id(evaluation_run_id: str, phase: str, position: int) -> str:
    return EvaluationService.workflow_task_id(evaluation_run_id, phase, position)


@shared_task(
    queue="evaluation",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=dify_config.EVALUATION_RUN_MAX_RETRIES,
)
def run_evaluation(task: Task, run_data_dict: dict[str, Any]) -> None:
    """Execute a run with bounded retries and durable row checkpoints.

    Dataset-row evaluation errors remain terminal item results. Unexpected
    orchestration or infrastructure failures retry the task with exponential
    backoff, resuming from the persisted checkpoints.
    """
    run_data = EvaluationRunData.model_validate(run_data_dict)
    lease = EvaluationRunLease(run_id=run_data.evaluation_run_id, token=str(uuid.uuid4()))
    with session_factory.create_session() as session:
        try:
            _execute_evaluation(session, run_data, lease)
        except EvaluationRunCancelledError:
            logger.info("Evaluation run %s stopped after cancellation", run_data.evaluation_run_id)
        except EvaluationRunOwnershipLostError:
            logger.info(
                "Evaluation run %s stopped because execution lease %s is no longer current",
                run_data.evaluation_run_id,
                lease.token,
            )
        except EvaluationWorkflowVersionNotFoundError as exc:
            logger.exception(
                "Evaluation run %s cannot continue because a pinned workflow version is missing",
                run_data.evaluation_run_id,
            )
            _mark_run_failed(session, lease, str(exc))
        except ValueError as exc:
            logger.exception("Evaluation run %s failed validation", run_data.evaluation_run_id)
            _mark_run_failed(session, lease, str(exc))
        except Exception as exc:
            retry_number = task.request.retries + 1
            max_retries = dify_config.EVALUATION_RUN_MAX_RETRIES
            if task.request.retries >= max_retries:
                logger.exception(
                    "Evaluation run %s exhausted its retry budget after %d attempts",
                    run_data.evaluation_run_id,
                    task.request.retries + 1,
                )
                _mark_run_failed(
                    session,
                    lease,
                    f"Evaluation failed after {task.request.retries + 1} attempts: {exc}",
                )
                return

            countdown = dify_config.EVALUATION_RUN_RETRY_DELAY * (2**task.request.retries)
            logger.warning(
                "Evaluation run %s failed; scheduling retry %d/%d in %d seconds",
                run_data.evaluation_run_id,
                retry_number,
                max_retries,
                countdown,
                exc_info=True,
            )
            retry_signal = task.retry(exc=exc, countdown=countdown, throw=False)
            try:
                retry_scheduled = _mark_run_pending_for_retry(
                    session,
                    lease,
                    str(exc),
                    retry_number,
                    max_retries,
                )
            except Exception:
                logger.exception("Failed to persist retry state for evaluation run %s", run_data.evaluation_run_id)
                retry_scheduled = True
            if not retry_scheduled:
                logger.info("Evaluation run %s became terminal before retry", run_data.evaluation_run_id)
                return
            raise retry_signal from exc


def _renew_evaluation_run_heartbeat(lease: EvaluationRunLease) -> bool:
    """Renew the lease only while the evaluation remains executable."""
    with session_factory.create_session() as session:
        result = cast(
            CursorResult[Any],
            session.execute(
                update(EvaluationRun)
                .where(
                    EvaluationRun.id == lease.run_id,
                    EvaluationRun.status == EvaluationRunStatus.RUNNING,
                    EvaluationRun.execution_token == lease.token,
                )
                .values(heartbeat_at=naive_utc_now())
            ),
        )
        session.commit()
        return result.rowcount == 1


def _renew_evaluation_run_heartbeat_while_running(lease: EvaluationRunLease, stop_event: Event) -> None:
    interval = dify_config.EVALUATION_RUN_HEARTBEAT_INTERVAL
    while not stop_event.wait(interval):
        try:
            if not _renew_evaluation_run_heartbeat(lease):
                return
        except Exception:
            logger.exception("Failed to renew heartbeat for evaluation run %s", lease.run_id)


@contextmanager
def _maintain_evaluation_run_heartbeat(lease: EvaluationRunLease) -> Generator[None]:
    stop_event = Event()
    heartbeat_thread = Thread(
        target=_renew_evaluation_run_heartbeat_while_running,
        args=(lease, stop_event),
        daemon=True,
        name=f"EvaluationRunHeartbeat({lease.run_id})",
    )
    heartbeat_thread.start()
    try:
        yield
    finally:
        stop_event.set()
        heartbeat_thread.join(timeout=_HEARTBEAT_JOIN_TIMEOUT_SECONDS)
        if heartbeat_thread.is_alive():
            logger.warning("Evaluation run %s heartbeat thread did not stop", lease.run_id)


@shared_task(queue="evaluation")
def reconcile_stale_evaluation_runs() -> int:
    """Fail running evaluations whose heartbeat lease has expired.

    The compare-and-set update makes the sweep idempotent and lets a normal
    heartbeat, completion, or cancellation win if it races with the reconciler.
    """
    cutoff = naive_utc_now() - timedelta(seconds=dify_config.EVALUATION_RUN_LEASE_TIMEOUT)
    stale_runs: list[tuple[str, str, str | None, str, int]] = []
    with session_factory.create_session() as session:
        candidates = list(
            session.scalars(
                select(EvaluationRun)
                .where(
                    EvaluationRun.status == EvaluationRunStatus.RUNNING,
                    EvaluationRun.heartbeat_at.is_not(None),
                    EvaluationRun.heartbeat_at < cutoff,
                )
                .limit(100)
            ).all()
        )
        for run in candidates:
            result = cast(
                CursorResult[Any],
                session.execute(
                    update(EvaluationRun)
                    .where(
                        EvaluationRun.id == run.id,
                        EvaluationRun.status == EvaluationRunStatus.RUNNING,
                        EvaluationRun.execution_token == run.execution_token,
                        EvaluationRun.heartbeat_at.is_not(None),
                        EvaluationRun.heartbeat_at < cutoff,
                    )
                    .values(
                        status=EvaluationRunStatus.FAILED,
                        execution_token=None,
                        heartbeat_at=None,
                        completed_at=naive_utc_now(),
                        error="Evaluation run heartbeat lease expired.",
                    )
                ),
            )
            if result.rowcount == 1:
                stale_runs.append(
                    (
                        run.tenant_id,
                        run.id,
                        run.celery_task_id,
                        EvaluationTargetType(run.target_type).value,
                        run.total_items,
                    )
                )
        session.commit()

    if not stale_runs:
        return 0

    from celery import current_app as celery_app

    for tenant_id, run_id, celery_task_id, target_type, total_items in stale_runs:
        if target_type in {EvaluationTargetType.APPS.value, EvaluationTargetType.SNIPPETS.value}:
            EvaluationService._stop_workflow_tasks(run_id, total_items)
        elif target_type == EvaluationTargetType.AGENTS.value:
            EvaluationService._stop_agent_evaluation_tasks(
                tenant_id=tenant_id,
                evaluation_run_id=run_id,
                total_items=total_items,
            )
        if celery_task_id:
            try:
                celery_app.control.revoke(celery_task_id, terminate=False)
            except Exception:
                logger.exception("Failed to revoke stale evaluation task %s", celery_task_id)
    logger.warning("Marked %d stale evaluation runs as failed", len(stale_runs))
    return len(stale_runs)


def _execute_evaluation(session: Session, run_data: EvaluationRunData, lease: EvaluationRunLease) -> None:
    if lease.run_id != run_data.evaluation_run_id:
        raise ValueError("Evaluation run lease does not match the task payload.")

    evaluation_run = session.scalar(
        select(EvaluationRun).where(EvaluationRun.id == run_data.evaluation_run_id).with_for_update()
    )
    if evaluation_run is None:
        logger.error("EvaluationRun %s not found", run_data.evaluation_run_id)
        return
    if evaluation_run.status in {
        EvaluationRunStatus.COMPLETED,
        EvaluationRunStatus.FAILED,
        EvaluationRunStatus.CANCELLED,
    }:
        session.rollback()
        return
    if evaluation_run.status != EvaluationRunStatus.PENDING or evaluation_run.execution_token is not None:
        logger.info(
            "Skipping duplicate delivery for evaluation run %s; current status=%s owner=%s",
            evaluation_run.id,
            evaluation_run.status,
            evaluation_run.execution_token,
        )
        session.rollback()
        return

    run_created_by = evaluation_run.created_by
    completed_items, failed_items, checkpointed_items = _get_completed_checkpoint_counts(
        session,
        evaluation_run.id,
    )
    now = naive_utc_now()
    evaluation_run.status = EvaluationRunStatus.RUNNING
    evaluation_run.execution_token = lease.token
    evaluation_run.started_at = evaluation_run.started_at or now
    evaluation_run.heartbeat_at = now
    evaluation_run.completed_at = None
    evaluation_run.completed_items = completed_items
    evaluation_run.failed_items = failed_items
    evaluation_run.progress_rate = max(
        evaluation_run.progress_rate,
        _checkpoint_progress(checkpointed_items, evaluation_run.total_items),
    )
    evaluation_run.error = None
    session.commit()

    persisted_framework = EvaluationFrameworkEnum(
        evaluation_run.config_snapshot_dict.get("evaluation_framework", EvaluationFrameworkEnum.RAGAS)
    )
    if (
        evaluation_run.tenant_id != run_data.tenant_id
        or EvaluationTargetType(evaluation_run.target_type).value != run_data.target_type
        or evaluation_run.target_id != run_data.target_id
        or evaluation_run.target_workflow_version_id != run_data.target_workflow_version_id
        or evaluation_run.target_agent_config_snapshot_id != run_data.target_agent_config_snapshot_id
        or persisted_framework != run_data.evaluation_framework
    ):
        raise ValueError("Evaluation task payload does not match the persisted run.")
    if run_data.target_type == EvaluationTargetType.AGENTS.value and not run_data.target_agent_config_snapshot_id:
        raise ValueError("Evaluation task payload is missing target_agent_config_snapshot_id.")
    if (
        run_data.target_type
        not in {
            EvaluationTargetType.KNOWLEDGE_BASE.value,
            EvaluationTargetType.AGENTS.value,
        }
        and not run_data.target_workflow_version_id
    ):
        raise ValueError("Evaluation task payload is missing target_workflow_version_id.")

    EvaluationService.validate_default_metric_node_types(run_data.default_metrics)

    evaluation_instance = EvaluationManager.get_evaluation_instance(run_data.evaluation_framework)
    if evaluation_instance is None:
        raise ValueError("Evaluation framework not configured")

    with _maintain_evaluation_run_heartbeat(lease):
        _execute_running_evaluation(session, run_data, evaluation_instance, run_created_by, lease)


def _execute_running_evaluation(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    run_created_by: str,
    lease: EvaluationRunLease,
) -> None:
    if run_data.target_type == EvaluationTargetType.KNOWLEDGE_BASE.value:
        _resume_retrieval_rows(
            session,
            run_data,
            evaluation_instance,
            run_created_by,
            lease,
        )
    elif run_data.target_type == EvaluationTargetType.AGENTS.value:
        _resume_agent_rows(
            session,
            run_data,
            evaluation_instance,
            run_created_by,
            lease,
        )
    else:
        _resume_workflow_rows(
            session,
            run_data,
            evaluation_instance,
            lease,
        )

    _assert_execution_lease(session, lease)
    results = _load_completed_checkpoint_results(session, run_data)
    # The cancellation check starts a read transaction. End it before writing
    # the result object to external storage; the final status update below is
    # the database-side compare-and-set that publishes the file atomically.
    session.rollback()
    metrics_summary = _compute_metrics_summary(results, run_data.judgment_config)
    result_xlsx = _generate_result_xlsx(run_data.input_list, results)
    _update_run_progress(session, lease, 0.98)
    session.rollback()
    result_file = _store_result_file(
        run_data.tenant_id,
        run_data.evaluation_run_id,
        result_xlsx,
        session,
        created_by=run_created_by,
    )

    completed_items = sum(1 for result in results if result.error is None)
    failed_items = len(run_data.input_list) - completed_items
    statement = (
        update(EvaluationRun)
        .where(
            EvaluationRun.id == run_data.evaluation_run_id,
            EvaluationRun.status == EvaluationRunStatus.RUNNING,
            EvaluationRun.execution_token == lease.token,
        )
        .values(
            status=EvaluationRunStatus.COMPLETED,
            execution_token=None,
            heartbeat_at=None,
            completed_at=naive_utc_now(),
            completed_items=completed_items,
            failed_items=failed_items,
            metrics_summary=json.dumps(metrics_summary, ensure_ascii=False),
            result_file_id=result_file.id,
            progress_rate=1.0,
        )
    )
    try:
        result = cast(CursorResult[Any], session.execute(statement))
    except Exception:
        session.rollback()
        _delete_stored_result_file(result_file.key)
        raise
    if result.rowcount != 1:
        session.rollback()
        _delete_stored_result_file(result_file.key)
        _assert_execution_lease(session, lease)
        raise EvaluationRunOwnershipLostError(f"Evaluation run {lease.run_id} completion lease was rejected.")
    session.commit()
    logger.info("Evaluation run %s completed successfully", run_data.evaluation_run_id)


def _resume_retrieval_rows(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    run_created_by: str,
    lease: EvaluationRunLease,
) -> None:
    """Resume knowledge-base evaluation from completed row checkpoints."""
    completed_indices = _get_completed_checkpoint_indices(session, run_data.evaluation_run_id)
    pending_items = [item for item in run_data.input_list if item.index not in completed_indices]
    if not pending_items:
        return

    node_run_results, retrieval_errors = EvaluationService.execute_retrieval_test_targets(
        tenant_id=run_data.tenant_id,
        dataset_id=run_data.target_id,
        account_id=run_created_by,
        input_list=pending_items,
        cancellation_check=lambda: _cooperative_checkpoint(session, lease),
        progress_callback=lambda completed, total: _update_run_progress(
            session,
            lease,
            0.05 + 0.45 * (len(completed_indices) + completed) / max(len(run_data.input_list), 1),
        ),
    )
    _assert_execution_lease(session, lease)
    for position, item in enumerate(pending_items):
        item_run_data = run_data.model_copy(update={"input_list": [item]})
        _evaluate_retrieval_results(
            session=session,
            run_data=item_run_data,
            evaluation_instance=evaluation_instance,
            node_run_results=[node_run_results[position]],
            retrieval_errors=[retrieval_errors[position]],
            lease=lease,
            report_progress=False,
        )


def _resume_agent_rows(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    run_created_by: str,
    lease: EvaluationRunLease,
) -> None:
    """Resume each Agent V2 row from its durable backend-run checkpoint."""
    for position, item in enumerate(run_data.input_list):
        checkpoint = session.scalar(
            select(EvaluationRunItem).where(
                EvaluationRunItem.evaluation_run_id == run_data.evaluation_run_id,
                EvaluationRunItem.item_index == item.index,
            )
        )
        if checkpoint is not None and checkpoint.status == EvaluationRunItemStatus.COMPLETED:
            binding_id = checkpoint.agent_workspace_binding_id
            session.rollback()
            if binding_id:
                _retire_agent_binding(run_data.tenant_id, binding_id)
            continue

        agent_item: AgentEvaluationItem | None = None
        target_error: str | None = None
        if checkpoint is not None and checkpoint.status == EvaluationRunItemStatus.TARGET_COMPLETED:
            target_error = checkpoint.error
            binding_id = checkpoint.agent_workspace_binding_id
            if checkpoint.target_result_json:
                agent_item = AgentEvaluationItem.model_validate_json(checkpoint.target_result_json)
            elif target_error is None:
                target_error = "Checkpointed Agent target result is missing."
            session.rollback()
            if binding_id:
                _retire_agent_binding(run_data.tenant_id, binding_id)
        else:
            session.rollback()
            agent_item, target_error = _execute_agent_target(
                session=session,
                run_data=run_data,
                dataset_item=item,
                account_id=run_created_by,
                lease=lease,
            )

        _evaluate_agent_row(
            session=session,
            run_data=run_data.model_copy(update={"input_list": [item]}),
            evaluation_instance=evaluation_instance,
            agent_item=agent_item,
            target_error=target_error,
            task_position=position,
            lease=lease,
        )
        _update_run_progress(
            session,
            lease,
            0.05 + 0.9 * (position + 1) / max(len(run_data.input_list), 1),
        )


def _execute_agent_target(
    *,
    session: Session,
    run_data: EvaluationRunData,
    dataset_item: EvaluationDatasetInput,
    account_id: str,
    lease: EvaluationRunLease,
) -> tuple[AgentEvaluationItem | None, str | None]:
    """Create or reconnect one isolated Agent V2 backend run."""
    snapshot_id = run_data.target_agent_config_snapshot_id
    if not snapshot_id:
        raise ValueError("Agent evaluation target snapshot is missing.")
    _cooperative_checkpoint(session, lease)
    target = AgentEvaluationTargetService.resolve_active_snapshot(
        session=session,
        tenant_id=run_data.tenant_id,
        agent_id=run_data.target_id,
        snapshot_id=snapshot_id,
    )
    run_item = session.scalar(
        select(EvaluationRunItem)
        .where(
            EvaluationRunItem.evaluation_run_id == lease.run_id,
            EvaluationRunItem.item_index == dataset_item.index,
        )
        .with_for_update()
    )
    if run_item is None:
        run_item = EvaluationRunItem(
            evaluation_run_id=lease.run_id,
            item_index=dataset_item.index,
            status=EvaluationRunItemStatus.TARGET_RUNNING,
            inputs=json.dumps(dataset_item.inputs, ensure_ascii=False),
            expected_output=dataset_item.serialize_expected_output(),
        )
        session.add(run_item)
        session.flush()
    if run_item.status == EvaluationRunItemStatus.TARGET_COMPLETED:
        persisted_item = (
            AgentEvaluationItem.model_validate_json(run_item.target_result_json)
            if run_item.target_result_json
            else None
        )
        target_error = run_item.error
        session.rollback()
        return persisted_item, target_error
    if run_item.status == EvaluationRunItemStatus.COMPLETED:
        session.rollback()
        return None, "Agent evaluation row was already completed."

    run_item_id = run_item.id
    checkpoint_binding_id = run_item.agent_workspace_binding_id
    backend_run_id = run_item.agent_backend_run_id
    binding: AgentWorkspaceBinding | None = None
    if checkpoint_binding_id:
        binding = session.scalar(
            select(AgentWorkspaceBinding).where(
                AgentWorkspaceBinding.id == checkpoint_binding_id,
                AgentWorkspaceBinding.tenant_id == run_data.tenant_id,
            )
        )
    if backend_run_id is None:
        binding = AgentEvaluationTargetService.ensure_row_binding(
            session=session,
            target=target,
            tenant_id=run_data.tenant_id,
            run_item_id=run_item_id,
            binding_id=checkpoint_binding_id,
        )
        run_item.agent_workspace_binding_id = binding.id
        run_item.status = EvaluationRunItemStatus.TARGET_RUNNING
        _touch_execution_lease(session, lease)
        session.commit()
    else:
        session.rollback()

    binding_id = binding.id if binding is not None else checkpoint_binding_id or ""
    backend_binding_ref = binding.backend_binding_ref if binding is not None else "evaluation-replay"
    runtime = AgentEvaluationTargetService.build_runtime_request(
        target=target,
        tenant_id=run_data.tenant_id,
        account_id=account_id,
        run_item_id=run_item_id,
        binding_id=binding_id,
        backend_binding_ref=backend_binding_ref,
        query=str(dataset_item.inputs.get("query", "")),
        idempotency_key=f"evaluation:{run_data.evaluation_run_id}:{run_item_id}",
    )
    available_tools = [
        AgentToolDefinition(
            tool_ref=tool.tool_ref,
            name=tool.name,
            display_name=tool.display_name,
            description=tool.description,
            input_schema=tool.input_schema,
            schema_available=tool.schema_available,
        )
        for tool in runtime.available_tools
    ]
    client = create_agent_backend_run_client(
        base_url=dify_config.AGENT_BACKEND_BASE_URL,
        api_token=dify_config.AGENT_BACKEND_API_TOKEN,
        use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
        fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
        stream_read_timeout_seconds=dify_config.AGENT_BACKEND_STREAM_READ_TIMEOUT_SECONDS,
        stream_max_reconnects=dify_config.AGENT_BACKEND_STREAM_MAX_RECONNECTS,
    )
    if backend_run_id is None:
        create_response = client.create_run(runtime.request)
        backend_run_id = create_response.run_id
        try:
            _persist_agent_backend_run_id(session, lease, dataset_item.index, backend_run_id)
        except Exception:
            try:
                client.cancel_run(backend_run_id)
            except Exception:
                logger.exception("Failed to cancel uncheckpointed Agent evaluation run %s", backend_run_id)
            _retire_agent_binding(run_data.tenant_id, binding_id)
            raise

    collector = AgentV2TraceCollector(available_tools)
    adapter = AgentBackendRunEventAdapter()
    terminal: (
        AgentBackendRunSucceededInternalEvent
        | AgentBackendRunFailedInternalEvent
        | AgentBackendRunCancelledInternalEvent
        | None
    ) = None
    stop_error: EvaluationRunCancelledError | EvaluationRunOwnershipLostError | None = None
    last_lease_check = 0.0

    def should_stop() -> bool:
        nonlocal last_lease_check, stop_error
        now = time.monotonic()
        if now - last_lease_check < 0.5:
            return False
        last_lease_check = now
        try:
            _cooperative_checkpoint(session, lease)
        except (EvaluationRunCancelledError, EvaluationRunOwnershipLostError) as exc:
            stop_error = exc
            return True
        return False

    session.rollback()
    for raw_event in client.stream_events(backend_run_id, should_stop=should_stop):
        for event in adapter.adapt(raw_event):
            collector.consume(event)
            if isinstance(
                event,
                AgentBackendRunSucceededInternalEvent
                | AgentBackendRunFailedInternalEvent
                | AgentBackendRunCancelledInternalEvent,
            ):
                terminal = event
                break
        if terminal is not None:
            break
    if stop_error is not None:
        raise stop_error
    _cooperative_checkpoint(session, lease)
    if terminal is None:
        raise RuntimeError(f"Agent backend stream for run {backend_run_id} ended without a terminal event.")

    node_info = _agent_target_node_info(run_data)
    if isinstance(terminal, AgentBackendRunSucceededInternalEvent):
        agent_item = collector.build_item(dataset_item=dataset_item, node_info=node_info, output=terminal.output)
        target_error = None
    elif isinstance(terminal, AgentBackendRunFailedInternalEvent):
        agent_item = None
        target_error = f"Agent execution failed: {terminal.error}"
    else:
        agent_item = None
        target_error = f"Agent execution was cancelled: {terminal.message or terminal.reason or 'cancelled'}"

    retired_binding_id = _persist_agent_target_checkpoint(
        session=session,
        lease=lease,
        tenant_id=run_data.tenant_id,
        dataset_item=dataset_item,
        backend_run_id=backend_run_id,
        binding_id=binding_id or None,
        agent_item=agent_item,
        target_error=target_error,
    )
    if retired_binding_id is not None:
        _enqueue_retired_agent_binding(run_data.tenant_id, retired_binding_id)
    return agent_item, target_error


def _persist_agent_backend_run_id(
    session: Session,
    lease: EvaluationRunLease,
    item_index: int,
    backend_run_id: str,
) -> None:
    _assert_execution_lease(session, lease)
    run_item = session.scalar(
        select(EvaluationRunItem).where(
            EvaluationRunItem.evaluation_run_id == lease.run_id,
            EvaluationRunItem.item_index == item_index,
        )
    )
    if run_item is None:
        raise RuntimeError("Agent evaluation row checkpoint is missing.")
    run_item.agent_backend_run_id = backend_run_id
    run_item.status = EvaluationRunItemStatus.TARGET_RUNNING
    _touch_execution_lease(session, lease)
    session.commit()


def _persist_agent_target_checkpoint(
    *,
    session: Session,
    lease: EvaluationRunLease,
    tenant_id: str,
    dataset_item: EvaluationDatasetInput,
    backend_run_id: str,
    binding_id: str | None,
    agent_item: AgentEvaluationItem | None,
    target_error: str | None,
) -> str | None:
    _assert_execution_lease(session, lease)
    run_item = session.scalar(
        select(EvaluationRunItem).where(
            EvaluationRunItem.evaluation_run_id == lease.run_id,
            EvaluationRunItem.item_index == dataset_item.index,
        )
    )
    if run_item is None:
        raise RuntimeError("Agent evaluation row checkpoint is missing.")
    run_item.status = EvaluationRunItemStatus.TARGET_COMPLETED
    run_item.agent_backend_run_id = backend_run_id
    run_item.agent_workspace_binding_id = binding_id
    run_item.inputs = json.dumps(dataset_item.inputs, ensure_ascii=False)
    run_item.expected_output = dataset_item.serialize_expected_output()
    run_item.actual_output = agent_item.output if agent_item is not None else None
    run_item.target_result_json = agent_item.model_dump_json() if agent_item is not None else None
    run_item.error = target_error
    retired_binding_id = (
        AgentWorkspaceService.retire_binding(
            session=session,
            tenant_id=tenant_id,
            binding_id=binding_id,
        )
        if binding_id
        else None
    )
    _touch_execution_lease(session, lease)
    session.commit()
    return retired_binding_id


def _enqueue_retired_agent_binding(tenant_id: str, binding_id: str) -> None:
    try:
        enqueue_agent_resource_collection(tenant_id=tenant_id, binding_ids=(binding_id,))
    except Exception:
        logger.exception("Failed to enqueue Agent evaluation binding %s for collection", binding_id)


def _retire_agent_binding(tenant_id: str, binding_id: str) -> None:
    try:
        with session_factory.create_session() as cleanup_session:
            retired_binding_id = AgentWorkspaceService.retire_binding(
                session=cleanup_session,
                tenant_id=tenant_id,
                binding_id=binding_id,
            )
            cleanup_session.commit()
        if retired_binding_id is not None:
            _enqueue_retired_agent_binding(tenant_id, retired_binding_id)
    except Exception:
        logger.exception("Failed to retire Agent evaluation binding %s", binding_id)


def _agent_target_node_info(run_data: EvaluationRunData) -> NodeInfo:
    for metric in run_data.default_metrics:
        if metric.node_info_list:
            return metric.node_info_list[0]
    return NodeInfo(node_id=run_data.target_id, type="agent", title="Agent")


def _evaluate_agent_row(
    *,
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    agent_item: AgentEvaluationItem | None,
    target_error: str | None,
    task_position: int,
    lease: EvaluationRunLease,
) -> None:
    dataset_item = run_data.input_list[0]
    node_info = _agent_target_node_info(run_data)
    if target_error is not None or agent_item is None:
        result = EvaluationItemResult(
            index=dataset_item.index,
            actual_output=agent_item.output if agent_item is not None else None,
            error=f"Target execution failed: {target_error or 'Agent target result is missing.'}",
        )
        results_by_index = {dataset_item.index: result}
    else:
        results_by_index = {
            dataset_item.index: EvaluationItemResult(
                index=dataset_item.index,
                actual_output=agent_item.output,
                metadata={
                    "agent_trace_source": "agent_v2",
                    "agent_trace_warnings": agent_item.trajectory.warnings if agent_item.trajectory else [],
                },
            )
        }
    if target_error is None and agent_item is not None and run_data.default_metrics:
        try:
            evaluated = evaluation_instance.evaluate_agent(
                [agent_item],
                [metric.metric for metric in run_data.default_metrics],
                run_data.evaluation_model_provider,
                run_data.evaluation_model,
                run_data.tenant_id,
            )
            if not evaluated:
                raise RuntimeError("Agent evaluator returned no result.")
            result = evaluated[0].model_copy(
                update={
                    "index": dataset_item.index,
                    "actual_output": agent_item.output,
                    "metadata": {
                        **evaluated[0].metadata,
                        "agent_trace_source": "agent_v2",
                        "agent_trace_warnings": agent_item.trajectory.warnings if agent_item.trajectory else [],
                    },
                }
            )
            for metric in result.metrics:
                metric.node_info = node_info
            _merge_result(results_by_index, dataset_item.index, result)
        except Exception as exc:
            logger.exception("Failed Agent V2 metrics for evaluation row %s", dataset_item.index)
            _merge_result(
                results_by_index,
                dataset_item.index,
                EvaluationItemResult(
                    index=dataset_item.index,
                    actual_output=agent_item.output,
                    error=f"Agent evaluation failed: {exc}",
                ),
            )

    if target_error is None and agent_item is not None and run_data.customized_metrics is not None:
        _clear_workflow_cancellation_signals(session, lease, "evaluator", [task_position])
        try:
            customized_results = evaluation_instance.evaluate_with_customized_workflow(
                node_run_result_mapping_list=[
                    {AGENT_CUSTOM_EVALUATOR_NODE_ID: build_agent_custom_evaluator_node_result(agent_item)}
                ],
                customized_metrics=run_data.customized_metrics,
                tenant_id=run_data.tenant_id,
                cancellation_check=lambda: _cooperative_checkpoint(session, lease),
                task_id_factory=lambda _: _workflow_task_id(
                    run_data.evaluation_run_id,
                    "evaluator",
                    task_position,
                ),
            )
            _merge_customized_results(results_by_index, customized_results, [dataset_item])
        except EvaluationWorkflowVersionNotFoundError:
            raise
        except Exception as exc:
            logger.exception("Failed customized Agent metrics for evaluation row %s", dataset_item.index)
            _merge_result(
                results_by_index,
                dataset_item.index,
                EvaluationItemResult(index=dataset_item.index, error=f"Customized evaluation failed: {exc}"),
            )

    results = [results_by_index[dataset_item.index]]
    if run_data.judgment_config:
        results = _apply_judgment(results, run_data.judgment_config)
    results = [_with_overall_score(item) for item in results]
    _persist_results(session, lease, results, [dataset_item])


def _resume_workflow_rows(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    lease: EvaluationRunLease,
) -> None:
    """Resume target execution and scoring without replaying durable row checkpoints."""
    checkpoint_by_index = {
        checkpoint.item_index: checkpoint
        for checkpoint in session.scalars(
            select(EvaluationRunItem).where(EvaluationRunItem.evaluation_run_id == run_data.evaluation_run_id)
        ).all()
    }
    session.rollback()

    evaluation_inputs: dict[int, tuple[dict[str, NodeRunResult], str | None, str | None]] = {}
    pending_items: list[EvaluationDatasetInput] = []
    pending_positions: list[int] = []
    target_ready_count = 0

    for position, item in enumerate(run_data.input_list):
        checkpoint = checkpoint_by_index.get(item.index)
        if checkpoint is not None and checkpoint.status == EvaluationRunItemStatus.COMPLETED:
            target_ready_count += 1
            continue
        if checkpoint is not None and checkpoint.status == EvaluationRunItemStatus.TARGET_COMPLETED:
            target_ready_count += 1
            if checkpoint.workflow_run_id:
                checkpoint_node_results = EvaluationService._query_node_run_results(
                    session=session,
                    tenant_id=run_data.tenant_id,
                    app_id=run_data.target_id,
                    workflow_run_id=checkpoint.workflow_run_id,
                )
                session.rollback()
                target_error = checkpoint.error
                if not checkpoint_node_results and target_error is None:
                    target_error = "Checkpointed target workflow results are no longer available."
                evaluation_inputs[position] = (
                    checkpoint_node_results,
                    checkpoint.workflow_run_id,
                    target_error,
                )
            else:
                evaluation_inputs[position] = ({}, None, "Checkpointed target workflow run ID is missing.")
            continue
        pending_items.append(item)
        pending_positions.append(position)

    if pending_items:
        _clear_workflow_cancellation_signals(
            session,
            lease,
            "target",
            pending_positions,
        )

        def _checkpoint_target_result(
            local_position: int,
            node_results: dict[str, NodeRunResult],
            workflow_run_id: str | None,
            error: str | None,
        ) -> None:
            if workflow_run_id:
                _persist_target_checkpoint(
                    session,
                    lease,
                    pending_items[local_position],
                    workflow_run_id,
                    error,
                )

        node_results_list, workflow_run_ids, target_errors = EvaluationService.execute_targets(
            evaluation_run_id=run_data.evaluation_run_id,
            tenant_id=run_data.tenant_id,
            target_type=run_data.target_type,
            target_id=run_data.target_id,
            target_workflow_version_id=run_data.target_workflow_version_id or "",
            input_list=pending_items,
            cancellation_check=lambda: _cooperative_checkpoint(session, lease),
            progress_callback=lambda completed, total: _update_run_progress(
                session,
                lease,
                0.05 + 0.45 * (target_ready_count + completed) / max(len(run_data.input_list), 1),
            ),
            result_callback=_checkpoint_target_result,
            task_positions=pending_positions,
        )
        for local_position, original_position in enumerate(pending_positions):
            evaluation_inputs[original_position] = (
                node_results_list[local_position],
                workflow_run_ids[local_position],
                target_errors[local_position],
            )

    for position, item in enumerate(run_data.input_list):
        checkpoint = checkpoint_by_index.get(item.index)
        if checkpoint is not None and checkpoint.status == EvaluationRunItemStatus.COMPLETED:
            continue
        _cooperative_checkpoint(session, lease)
        row_node_results, workflow_run_id, target_error = evaluation_inputs[position]
        item_run_data = run_data.model_copy(update={"input_list": [item]})
        if item_run_data.customized_metrics is not None:
            _clear_workflow_cancellation_signals(
                session,
                lease,
                "evaluator",
                [position],
            )
        _execute_evaluation_runner(
            session=session,
            run_data=item_run_data,
            evaluation_instance=evaluation_instance,
            node_run_result_mapping_list=[row_node_results],
            workflow_run_id_map={item.index: workflow_run_id} if workflow_run_id else None,
            target_errors=[target_error],
            task_positions=[position],
            lease=lease,
            report_progress=False,
        )


def _persist_target_checkpoint(
    session: Session,
    lease: EvaluationRunLease,
    item_input: EvaluationDatasetInput,
    workflow_run_id: str,
    target_error: str | None = None,
) -> None:
    """Persist enough target state to avoid replaying a completed workflow on retry."""
    _assert_execution_lease(session, lease)
    run_item = session.scalar(
        select(EvaluationRunItem).where(
            EvaluationRunItem.evaluation_run_id == lease.run_id,
            EvaluationRunItem.item_index == item_input.index,
        )
    )
    if run_item is not None and run_item.status == EvaluationRunItemStatus.COMPLETED:
        session.rollback()
        return
    if run_item is None:
        run_item = EvaluationRunItem(
            evaluation_run_id=lease.run_id,
            item_index=item_input.index,
        )
        session.add(run_item)
    run_item.status = EvaluationRunItemStatus.TARGET_COMPLETED
    run_item.workflow_run_id = workflow_run_id
    run_item.inputs = json.dumps(item_input.inputs, ensure_ascii=False)
    run_item.expected_output = item_input.serialize_expected_output()
    run_item.error = target_error
    _touch_execution_lease(session, lease)
    session.commit()


def _clear_workflow_cancellation_signals(
    session: Session,
    lease: EvaluationRunLease,
    phase: str,
    positions: Sequence[int],
) -> None:
    """Clear signals from an earlier attempt without erasing a concurrent user cancellation."""
    from core.app.apps.execution_coordinator import clear_app_task_cancellation_signals

    _cooperative_checkpoint(session, lease)
    for position in positions:
        clear_app_task_cancellation_signals(_workflow_task_id(lease.run_id, phase, position))
    _cooperative_checkpoint(session, lease)


def _get_completed_checkpoint_indices(session: Session, evaluation_run_id: str) -> set[int]:
    return set(
        session.scalars(
            select(EvaluationRunItem.item_index).where(
                EvaluationRunItem.evaluation_run_id == evaluation_run_id,
                EvaluationRunItem.status == EvaluationRunItemStatus.COMPLETED,
            )
        ).all()
    )


def _get_completed_checkpoint_counts(session: Session, evaluation_run_id: str) -> tuple[int, int, int]:
    rows = session.execute(
        select(EvaluationRunItem.status, EvaluationRunItem.error).where(
            EvaluationRunItem.evaluation_run_id == evaluation_run_id,
        )
    ).all()
    completed = sum(1 for status, error in rows if status == EvaluationRunItemStatus.COMPLETED and error is None)
    failed = sum(1 for status, error in rows if status == EvaluationRunItemStatus.COMPLETED and error is not None)
    return completed, failed, completed + failed


def _checkpoint_progress(checkpointed_items: int, total_items: int) -> float:
    if checkpointed_items <= 0 or total_items <= 0:
        return 0.01
    return min(0.95, 0.05 + 0.9 * checkpointed_items / total_items)


def _load_completed_checkpoint_results(
    session: Session,
    run_data: EvaluationRunData,
) -> list[EvaluationItemResult]:
    checkpoints = list(
        session.scalars(
            select(EvaluationRunItem).where(
                EvaluationRunItem.evaluation_run_id == run_data.evaluation_run_id,
                EvaluationRunItem.status == EvaluationRunItemStatus.COMPLETED,
            )
        ).all()
    )
    checkpoint_by_index = {checkpoint.item_index: checkpoint for checkpoint in checkpoints}
    missing_indices = [item.index for item in run_data.input_list if item.index not in checkpoint_by_index]
    if missing_indices:
        raise RuntimeError(f"Evaluation row checkpoints are incomplete: {missing_indices[:10]}")

    return [_checkpoint_to_result(checkpoint_by_index[item.index]) for item in run_data.input_list]


def _checkpoint_to_result(checkpoint: EvaluationRunItem) -> EvaluationItemResult:
    return EvaluationItemResult(
        index=checkpoint.item_index,
        actual_output=checkpoint.actual_output,
        metrics=[EvaluationMetric.model_validate(metric) for metric in checkpoint.metrics_list],
        metadata=checkpoint.metadata_dict,
        judgment=JudgmentResult.model_validate(checkpoint.judgment_dict),
        overall_score=checkpoint.overall_score,
        error=checkpoint.error,
    )


def _execute_evaluation_runner(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    node_run_result_mapping_list: list[dict[str, NodeRunResult]],
    lease: EvaluationRunLease,
    workflow_run_id_map: dict[int, str] | None = None,
    target_errors: Sequence[str | None] | None = None,
    task_positions: Sequence[int] | None = None,
    report_progress: bool = True,
) -> list[EvaluationItemResult]:
    """Evaluate configured node/metric pairs and persist one result per row."""
    results_by_index: dict[int, EvaluationItemResult] = {}
    resolved_task_positions = (
        list(task_positions) if task_positions is not None else list(range(len(run_data.input_list)))
    )
    if len(resolved_task_positions) != len(run_data.input_list):
        raise ValueError("task_positions must align with input_list.")

    total_steps = sum(len(metric.node_info_list) for metric in run_data.default_metrics) + bool(
        run_data.customized_metrics
    )
    completed_steps = 0
    for default_metric in run_data.default_metrics:
        for node_info in default_metric.node_info_list:
            _cooperative_checkpoint(session, lease)
            node_run_results: list[NodeRunResult] = []
            dataset_items: list[EvaluationDatasetInput] = []
            dataset_indices: list[int] = []
            context_list: list[list[str] | None] = []
            for position, mapping in enumerate(node_run_result_mapping_list):
                node_result = mapping.get(node_info.node_id)
                if node_result is None:
                    continue
                node_run_results.append(node_result)
                dataset_items.append(run_data.input_list[position])
                dataset_indices.append(run_data.input_list[position].index)
                context_list.append(
                    _collect_retrieval_contexts(
                        mapping,
                        run_data.llm_context_node_mapping.get(node_info.node_id, []),
                    )
                )

            if not node_run_results:
                continue

            try:
                runner = _create_runner(EvaluationService.category_for_node_type(node_info.type), evaluation_instance)
                evaluated = runner.evaluate_metrics(
                    node_run_result_list=node_run_results,
                    default_metric=default_metric,
                    model_provider=run_data.evaluation_model_provider,
                    model_name=run_data.evaluation_model,
                    tenant_id=run_data.tenant_id,
                    dataset_items=dataset_items,
                    node_info=node_info,
                    context_list=context_list,
                )
                _stamp_and_merge(evaluated, dataset_indices, node_info, results_by_index)
            except Exception as exc:
                logger.exception("Failed metric %s on node %s", default_metric.metric, node_info.node_id)
                for dataset_index in dataset_indices:
                    _merge_result(
                        results_by_index,
                        dataset_index,
                        EvaluationItemResult(
                            index=dataset_index,
                            error=f"Metric '{default_metric.metric}' failed on node '{node_info.title}': {exc}",
                        ),
                    )
            completed_steps += 1
            if report_progress:
                _update_run_progress(
                    session,
                    lease,
                    0.6 + 0.25 * completed_steps / max(total_steps, 1),
                )

    if run_data.customized_metrics:
        _cooperative_checkpoint(session, lease)
        successful_positions = [
            position for position, node_results in enumerate(node_run_result_mapping_list) if node_results
        ]
        customized_node_results = [node_run_result_mapping_list[position] for position in successful_positions]
        customized_input_items = [run_data.input_list[position] for position in successful_positions]
        try:
            if customized_node_results:
                customized_results = evaluation_instance.evaluate_with_customized_workflow(
                    node_run_result_mapping_list=customized_node_results,
                    customized_metrics=run_data.customized_metrics,
                    tenant_id=run_data.tenant_id,
                    cancellation_check=lambda: _cooperative_checkpoint(session, lease),
                    task_id_factory=lambda position: _workflow_task_id(
                        run_data.evaluation_run_id,
                        "evaluator",
                        resolved_task_positions[successful_positions[position]],
                    ),
                )
                _merge_customized_results(results_by_index, customized_results, customized_input_items)
        except EvaluationWorkflowVersionNotFoundError:
            raise
        except Exception as exc:
            logger.exception("Failed customized metrics for run %s", run_data.evaluation_run_id)
            for item in customized_input_items:
                _merge_result(
                    results_by_index,
                    item.index,
                    EvaluationItemResult(index=item.index, error=f"Customized evaluation failed: {exc}"),
                )
        completed_steps += 1
        if report_progress:
            _update_run_progress(
                session,
                lease,
                0.6 + 0.25 * completed_steps / max(total_steps, 1),
            )

    results = _finalize_results(
        input_list=run_data.input_list,
        results_by_index=results_by_index,
        missing_errors=_build_missing_result_errors(
            run_data.input_list,
            node_run_result_mapping_list,
            target_errors,
        ),
    )
    if run_data.judgment_config:
        results = _apply_judgment(results, run_data.judgment_config)
    results = [_with_overall_score(result) for result in results]
    _persist_results(
        session,
        lease,
        results,
        run_data.input_list,
        workflow_run_id_map,
    )
    return results


def _execute_retrieval_test(
    session: Session,
    account_id: str,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    lease: EvaluationRunLease,
    report_progress: bool = True,
) -> list[EvaluationItemResult]:
    node_run_results, retrieval_errors = EvaluationService.execute_retrieval_test_targets(
        tenant_id=run_data.tenant_id,
        dataset_id=run_data.target_id,
        account_id=account_id,
        input_list=run_data.input_list,
        cancellation_check=lambda: _cooperative_checkpoint(session, lease),
        progress_callback=(
            lambda completed, total: _update_run_progress(
                session,
                lease,
                0.05 + 0.45 * completed / max(total, 1),
            )
        )
        if report_progress
        else None,
    )
    _assert_execution_lease(session, lease)

    return _evaluate_retrieval_results(
        session=session,
        run_data=run_data,
        evaluation_instance=evaluation_instance,
        node_run_results=node_run_results,
        retrieval_errors=retrieval_errors,
        lease=lease,
        report_progress=report_progress,
    )


def _evaluate_retrieval_results(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    node_run_results: Sequence[NodeRunResult | None],
    retrieval_errors: Sequence[str | None],
    lease: EvaluationRunLease,
    report_progress: bool = True,
) -> list[EvaluationItemResult]:
    """Score retrieval outputs and checkpoint each supplied dataset row."""

    results_by_index: dict[int, EvaluationItemResult] = {}
    runner = RetrievalEvaluationRunner(evaluation_instance)
    node_info = NodeInfo(
        node_id=run_data.target_id,
        type="knowledge-retrieval",
        title="Knowledge Retrieval",
    )
    successful_positions = [position for position, result in enumerate(node_run_results) if result is not None]
    successful_results = [node_run_results[position] for position in successful_positions]
    typed_successful_results = [result for result in successful_results if result is not None]
    successful_items = [run_data.input_list[position] for position in successful_positions]
    dataset_indices = [item.index for item in successful_items]
    for metric_position, default_metric in enumerate(run_data.default_metrics, start=1):
        _cooperative_checkpoint(session, lease)
        try:
            evaluated = runner.evaluate_metrics(
                node_run_result_list=typed_successful_results,
                default_metric=default_metric,
                model_provider=run_data.evaluation_model_provider,
                model_name=run_data.evaluation_model,
                tenant_id=run_data.tenant_id,
                dataset_items=successful_items,
                node_info=node_info,
            )
            _stamp_and_merge(evaluated, dataset_indices, node_info, results_by_index)
        except Exception as exc:
            logger.exception("Failed retrieval metric %s for run %s", default_metric.metric, run_data.evaluation_run_id)
            for dataset_index in dataset_indices:
                _merge_result(
                    results_by_index,
                    dataset_index,
                    EvaluationItemResult(
                        index=dataset_index,
                        error=f"Retrieval metric '{default_metric.metric}' failed: {exc}",
                    ),
                )
        if report_progress:
            _update_run_progress(
                session,
                lease,
                0.5 + 0.35 * metric_position / max(len(run_data.default_metrics), 1),
            )

    results = _finalize_results(
        input_list=run_data.input_list,
        results_by_index=results_by_index,
        missing_errors={
            item.index: (
                f"Retrieval failed: {retrieval_errors[position]}"
                if retrieval_errors[position]
                else "No evaluation metrics were generated for this row."
            )
            for position, item in enumerate(run_data.input_list)
        },
    )
    if run_data.judgment_config:
        results = _apply_judgment(results, run_data.judgment_config)
    results = [_with_overall_score(result) for result in results]
    _persist_results(session, lease, results, run_data.input_list)
    return results


def _stamp_and_merge(
    evaluated: Sequence[EvaluationItemResult],
    dataset_indices: Sequence[int],
    node_info: NodeInfo | None,
    results_by_index: dict[int, EvaluationItemResult],
) -> None:
    for result in evaluated:
        if result.index < 0 or result.index >= len(dataset_indices):
            logger.warning("Evaluator returned out-of-range result index %s", result.index)
            continue
        dataset_index = dataset_indices[result.index]
        if node_info is not None:
            for metric in result.metrics:
                metric.node_info = node_info
        _merge_result(results_by_index, dataset_index, result)


def _collect_retrieval_contexts(
    node_results: dict[str, NodeRunResult],
    retrieval_node_ids: Sequence[str],
) -> list[str] | None:
    if not retrieval_node_ids:
        return None
    contexts: list[str] = []
    for node_id in retrieval_node_ids:
        node_result = node_results.get(node_id)
        if node_result is None:
            continue
        raw_results = node_result.outputs.get("result", [])
        if not isinstance(raw_results, list):
            continue
        for result in raw_results:
            if isinstance(result, Mapping) and result.get("content"):
                contexts.append(str(result["content"]))
    return contexts


def _merge_result(
    results_by_index: dict[int, EvaluationItemResult],
    index: int,
    new_result: EvaluationItemResult,
) -> None:
    existing = results_by_index.get(index)
    if existing is None:
        results_by_index[index] = new_result.model_copy(update={"index": index})
        return

    errors = [error for error in (existing.error, new_result.error) if error]
    results_by_index[index] = existing.model_copy(
        update={
            "metrics": [*existing.metrics, *new_result.metrics],
            "actual_output": existing.actual_output or new_result.actual_output,
            "metadata": {**existing.metadata, **new_result.metadata},
            "error": "; ".join(dict.fromkeys(errors)) or None,
        }
    )


def _merge_customized_results(
    results_by_index: dict[int, EvaluationItemResult],
    customized_results: Sequence[EvaluationItemResult],
    input_list: Sequence[EvaluationDatasetInput],
) -> None:
    for result in customized_results:
        dataset_index = input_list[result.index].index if 0 <= result.index < len(input_list) else result.index
        _merge_result(results_by_index, dataset_index, result)


def _build_missing_result_errors(
    input_list: Sequence[EvaluationDatasetInput],
    node_run_result_mapping_list: Sequence[dict[str, NodeRunResult]],
    target_errors: Sequence[str | None] | None = None,
) -> dict[int, str]:
    errors: dict[int, str] = {}
    for position, (item, node_results) in enumerate(zip(input_list, node_run_result_mapping_list, strict=False)):
        target_error = target_errors[position] if target_errors and position < len(target_errors) else None
        errors[item.index] = (
            f"Target execution failed: {target_error}"
            if target_error
            else (
                "No evaluation metrics were generated for this row."
                if node_results
                else "Target execution produced no successful node results for this row."
            )
        )
    return errors


def _finalize_results(
    input_list: Sequence[EvaluationDatasetInput],
    results_by_index: dict[int, EvaluationItemResult],
    missing_errors: dict[int, str] | None = None,
) -> list[EvaluationItemResult]:
    return [
        results_by_index.get(
            item.index,
            EvaluationItemResult(
                index=item.index,
                error=(missing_errors or {}).get(item.index, "No evaluation result was generated for this row."),
            ),
        )
        for item in input_list
    ]


def _apply_judgment(
    results: Sequence[EvaluationItemResult],
    judgment_config: JudgmentConfig,
) -> list[EvaluationItemResult]:
    judged: list[EvaluationItemResult] = []
    for result in results:
        if result.error is not None or not result.metrics:
            judged.append(result)
            continue
        metric_values = {
            (metric.node_info.node_id, metric.name): metric.value
            for metric in result.metrics
            if metric.node_info is not None
        }
        judged.append(
            result.model_copy(update={"judgment": JudgmentProcessor.evaluate(metric_values, judgment_config)})
        )
    return judged


def _with_overall_score(result: EvaluationItemResult) -> EvaluationItemResult:
    numeric_values = [
        float(metric.value)
        for metric in result.metrics
        if isinstance(metric.value, Real) and not isinstance(metric.value, bool)
    ]
    score = sum(numeric_values) / len(numeric_values) if numeric_values else None
    return result.model_copy(update={"overall_score": score})


def _persist_results(
    session: Session,
    lease: EvaluationRunLease,
    results: Sequence[EvaluationItemResult],
    input_list: Sequence[EvaluationDatasetInput],
    workflow_run_id_map: dict[int, str] | None = None,
) -> None:
    """Upsert results in small batches and expose cooperative progress."""
    result_map = {result.index: result for result in results}
    workflow_run_ids = workflow_run_id_map or {}

    for position, item_input in enumerate(input_list, start=1):
        _assert_execution_lease(session, lease)
        result = result_map.get(
            item_input.index,
            EvaluationItemResult(index=item_input.index, error="Missing evaluation result."),
        )
        run_item = session.scalar(
            select(EvaluationRunItem).where(
                EvaluationRunItem.evaluation_run_id == lease.run_id,
                EvaluationRunItem.item_index == item_input.index,
            )
        )
        values = {
            "status": EvaluationRunItemStatus.COMPLETED,
            "workflow_run_id": workflow_run_ids.get(
                item_input.index,
                run_item.workflow_run_id if run_item is not None else None,
            ),
            "inputs": json.dumps(item_input.inputs, ensure_ascii=False),
            "expected_output": item_input.serialize_expected_output(),
            "actual_output": result.actual_output,
            "metrics": json.dumps(
                [metric.model_dump(mode="json") for metric in result.metrics],
                ensure_ascii=False,
            )
            if result.metrics
            else None,
            "judgment": json.dumps(result.judgment.model_dump(mode="json"), ensure_ascii=False),
            "metadata_json": json.dumps(result.metadata, ensure_ascii=False) if result.metadata else None,
            "error": result.error,
            "overall_score": result.overall_score,
        }
        if run_item is None:
            run_item = EvaluationRunItem(
                evaluation_run_id=lease.run_id,
                item_index=item_input.index,
                **values,
            )
            session.add(run_item)
        else:
            for field_name, value in values.items():
                setattr(run_item, field_name, value)

        if position % _PERSIST_BATCH_SIZE == 0 or position == len(input_list):
            session.flush()
            completed, failed, checkpointed = _get_completed_checkpoint_counts(session, lease.run_id)
            total_items = session.scalar(select(EvaluationRun.total_items).where(EvaluationRun.id == lease.run_id))
            progress_update = (
                update(EvaluationRun)
                .where(
                    EvaluationRun.id == lease.run_id,
                    EvaluationRun.status == EvaluationRunStatus.RUNNING,
                    EvaluationRun.execution_token == lease.token,
                )
                .values(
                    completed_items=completed,
                    failed_items=failed,
                    progress_rate=_checkpoint_progress(checkpointed, total_items or 0),
                )
            )
            update_result = cast(CursorResult[Any], session.execute(progress_update))
            if update_result.rowcount != 1:
                session.rollback()
                _assert_execution_lease(session, lease)
                raise EvaluationRunOwnershipLostError(f"Evaluation run {lease.run_id} checkpoint lease was rejected.")
            session.commit()


def _assert_execution_lease(session: Session, lease: EvaluationRunLease) -> None:
    """Reject work from cancelled runs and stale task invocations."""
    session.expire_all()
    row = session.execute(
        select(EvaluationRun.status, EvaluationRun.execution_token).where(EvaluationRun.id == lease.run_id)
    ).one_or_none()
    if row is None:
        raise EvaluationRunOwnershipLostError(f"Evaluation run {lease.run_id} no longer exists.")

    status, execution_token = row
    if status == EvaluationRunStatus.CANCELLED:
        raise EvaluationRunCancelledError()
    if status != EvaluationRunStatus.RUNNING or execution_token != lease.token:
        raise EvaluationRunOwnershipLostError(
            f"Evaluation run {lease.run_id} is owned by another execution or is no longer executable."
        )


def _cooperative_checkpoint(session: Session, lease: EvaluationRunLease) -> None:
    """Check ownership and close the read transaction before external work."""
    _assert_execution_lease(session, lease)
    session.rollback()


def _touch_execution_lease(session: Session, lease: EvaluationRunLease) -> None:
    """Fence a pending transaction by locking and renewing its current owner."""
    result = cast(
        CursorResult[Any],
        session.execute(
            update(EvaluationRun)
            .where(
                EvaluationRun.id == lease.run_id,
                EvaluationRun.status == EvaluationRunStatus.RUNNING,
                EvaluationRun.execution_token == lease.token,
            )
            .values(heartbeat_at=naive_utc_now())
        ),
    )
    if result.rowcount != 1:
        session.rollback()
        _assert_execution_lease(session, lease)
        raise EvaluationRunOwnershipLostError(f"Evaluation run {lease.run_id} lease update was rejected.")


def _update_run_progress(session: Session, lease: EvaluationRunLease, progress_rate: float) -> None:
    result = cast(
        CursorResult[Any],
        session.execute(
            update(EvaluationRun)
            .where(
                EvaluationRun.id == lease.run_id,
                EvaluationRun.status == EvaluationRunStatus.RUNNING,
                EvaluationRun.execution_token == lease.token,
            )
            .values(progress_rate=min(max(progress_rate, 0.0), 0.99))
        ),
    )
    if result.rowcount != 1:
        session.rollback()
        _assert_execution_lease(session, lease)
        raise EvaluationRunOwnershipLostError(f"Evaluation run {lease.run_id} progress lease was rejected.")
    session.commit()


def _create_runner(
    category: EvaluationCategory,
    evaluation_instance: BaseEvaluationInstance,
) -> BaseEvaluationRunner:
    if category == EvaluationCategory.LLM:
        return LLMEvaluationRunner(evaluation_instance)
    if category == EvaluationCategory.AGENT:
        return AgentEvaluationRunner(evaluation_instance)
    if category in {EvaluationCategory.RETRIEVAL, EvaluationCategory.KNOWLEDGE_BASE}:
        return RetrievalEvaluationRunner(evaluation_instance)
    raise ValueError(f"Unsupported evaluation category: {category}")


# ---------------------------------------------------------------------------
# Status / summary / XLSX / storage helpers
# ---------------------------------------------------------------------------


def _mark_run_failed(session: Session, lease: EvaluationRunLease, error: str) -> None:
    """Fail the run only while this invocation still owns it."""
    try:
        session.rollback()
        run_identity = session.execute(
            select(EvaluationRun.tenant_id, EvaluationRun.target_type, EvaluationRun.total_items).where(
                EvaluationRun.id == lease.run_id
            )
        ).one_or_none()
        result = cast(
            CursorResult[Any],
            session.execute(
                update(EvaluationRun)
                .where(
                    EvaluationRun.id == lease.run_id,
                    EvaluationRun.status == EvaluationRunStatus.RUNNING,
                    EvaluationRun.execution_token == lease.token,
                )
                .values(
                    status=EvaluationRunStatus.FAILED,
                    execution_token=None,
                    heartbeat_at=None,
                    error=error[:2000],
                    completed_at=naive_utc_now(),
                )
            ),
        )
        session.commit()
        if (
            result.rowcount == 1
            and run_identity is not None
            and EvaluationTargetType(run_identity.target_type) == EvaluationTargetType.AGENTS
        ):
            EvaluationService._stop_agent_evaluation_tasks(
                tenant_id=run_identity.tenant_id,
                evaluation_run_id=lease.run_id,
                total_items=run_identity.total_items,
            )
    except Exception:
        logger.exception("Failed to mark run %s as failed", lease.run_id)


def _mark_run_pending_for_retry(
    session: Session,
    lease: EvaluationRunLease,
    error: str,
    retry_number: int,
    max_retries: int,
) -> bool:
    """Release the running lease while retaining row checkpoints for the next attempt."""
    session.rollback()
    result = cast(
        CursorResult[Any],
        session.execute(
            update(EvaluationRun)
            .where(
                EvaluationRun.id == lease.run_id,
                EvaluationRun.status == EvaluationRunStatus.RUNNING,
                EvaluationRun.execution_token == lease.token,
            )
            .values(
                status=EvaluationRunStatus.PENDING,
                execution_token=None,
                heartbeat_at=None,
                completed_at=None,
                error=f"Retry {retry_number}/{max_retries} scheduled after: {error}"[:2000],
            )
        ),
    )
    session.commit()
    return result.rowcount == 1


def _compute_metrics_summary(
    results: list[EvaluationItemResult],
    judgment_config: JudgmentConfig | None,
) -> dict[str, Any]:
    """Compute aggregate metric and judgment summaries for an evaluation run."""
    metric_values: dict[str, list[float]] = {}
    for result in results:
        for metric in result.metrics:
            if isinstance(metric.value, Real) and not isinstance(metric.value, bool):
                metric_values.setdefault(_metric_column_name(metric), []).append(float(metric.value))

    summary: dict[str, Any] = {
        "metrics": {
            name: {
                "count": len(values),
                "average": sum(values) / len(values),
                "min": min(values),
                "max": max(values),
            }
            for name, values in metric_values.items()
        }
    }

    if judgment_config is not None and judgment_config.conditions:
        evaluated_results: list[EvaluationItemResult] = [
            result for result in results if result.error is None and result.metrics
        ]
        passed_items = sum(1 for result in evaluated_results if result.judgment.passed)
        evaluated_items = len(evaluated_results)
        summary["_judgment"] = {
            "enabled": True,
            "logical_operator": judgment_config.logical_operator,
            "configured_conditions": len(judgment_config.conditions),
            "evaluated_items": evaluated_items,
            "passed_items": passed_items,
            "failed_items": evaluated_items - passed_items,
            "pass_rate": passed_items / evaluated_items if evaluated_items else 0.0,
        }

    return summary


def _generate_result_xlsx(
    input_list: list[EvaluationDatasetInput],
    results: list[EvaluationItemResult],
) -> bytes:
    """Generate result XLSX with input data, actual output, metric scores, and judgment."""
    wb = Workbook()
    ws = wb.active
    if ws is None:
        ws = wb.create_sheet("Evaluation Results")
    ws.title = "Evaluation Results"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    metric_columns: list[str] = []
    for result in results:
        for metric in result.metrics:
            column_name = _metric_column_name(metric)
            if column_name not in metric_columns:
                metric_columns.append(column_name)

    # Collect all input keys
    input_keys: list[str] = []
    for item in input_list:
        for key in item.inputs:
            if key not in input_keys:
                input_keys.append(key)

    expected_output_headers: list[str] = []
    for item in input_list:
        for header, _ in item.iter_expected_output_columns():
            if header not in expected_output_headers:
                expected_output_headers.append(header)

    has_judgment = any(bool(r.judgment.condition_results) for r in results)

    judgment_headers = ["judgment"] if has_judgment else []
    headers = (
        ["index"]
        + input_keys
        + expected_output_headers
        + ["actual_output"]
        + metric_columns
        + judgment_headers
        + ["error"]
    )

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border

    ws.column_dimensions["A"].width = 10
    for col_idx in range(2, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = 25

    result_by_index = {r.index: r for r in results}

    for row_idx, item in enumerate(input_list, start=2):
        row_result = result_by_index.get(item.index)

        col = 1
        ws.cell(row=row_idx, column=col, value=item.index).border = thin_border
        col += 1

        for key in input_keys:
            val = item.inputs.get(key, "")
            ws.cell(row=row_idx, column=col, value=str(val)).border = thin_border
            col += 1

        for header in expected_output_headers:
            ws.cell(row=row_idx, column=col, value=_get_expected_output_cell_value(item, header)).border = thin_border
            col += 1

        ws.cell(row=row_idx, column=col, value=row_result.actual_output if row_result else "").border = thin_border
        col += 1

        metric_scores = (
            {_metric_column_name(metric): metric.value for metric in row_result.metrics} if row_result else {}
        )
        for metric_name in metric_columns:
            score = metric_scores.get(metric_name)
            ws.cell(row=row_idx, column=col, value=score if score is not None else "").border = thin_border
            col += 1

        if has_judgment:
            if row_result and row_result.judgment.condition_results:
                judgment_value = "Pass" if row_result.judgment.passed else "Fail"
            else:
                judgment_value = ""
            ws.cell(row=row_idx, column=col, value=judgment_value).border = thin_border
            col += 1

        ws.cell(row=row_idx, column=col, value=row_result.error if row_result else "").border = thin_border

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output.getvalue()


def _metric_column_name(metric: EvaluationMetric) -> str:
    if metric.node_info is None:
        return metric.name
    node_label = metric.node_info.title or metric.node_info.node_id
    return f"{node_label} : {metric.name}"


def _get_expected_output_cell_value(item: EvaluationDatasetInput, header: str) -> str:
    """Return the expected-output cell value for a generated result file header."""
    for column_header, value in item.iter_expected_output_columns():
        if column_header == header:
            return value
    return ""


def _store_result_file(
    tenant_id: str,
    run_id: str,
    xlsx_content: bytes,
    session: Session,
    created_by: str,
) -> UploadFile:
    """Save result bytes and stage the matching UploadFile in the current transaction."""
    from libs.uuid_utils import uuidv7

    filename = f"evaluation-result-{run_id[:8]}.xlsx"
    storage_key = f"evaluation_results/{tenant_id}/{str(uuidv7())}.xlsx"
    storage.save(storage_key, xlsx_content)

    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType(dify_config.STORAGE_TYPE),
        key=storage_key,
        name=filename,
        size=len(xlsx_content),
        extension="xlsx",
        mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        created_at=naive_utc_now(),
        used=True,
        used_by=created_by,
        used_at=naive_utc_now(),
    )
    try:
        session.add(upload_file)
        session.flush()
    except Exception:
        session.rollback()
        _delete_stored_result_file(storage_key)
        raise
    return upload_file


def _delete_stored_result_file(storage_key: str) -> None:
    """Best-effort compensation when a staged result file cannot be published."""
    try:
        storage.delete(storage_key)
    except Exception:
        logger.exception("Failed to delete unpublished evaluation result file %s", storage_key)
