import io
import json
import logging
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from datetime import timedelta
from numbers import Real
from threading import Event, Thread
from typing import Any, cast

from celery import shared_task
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    EvaluationCategory,
    EvaluationDatasetInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationRunData,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentConfig
from core.evaluation.evaluation_manager import EvaluationManager
from core.evaluation.judgment.processor import JudgmentProcessor
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from core.evaluation.runners.llm_evaluation_runner import LLMEvaluationRunner
from core.evaluation.runners.retrieval_evaluation_runner import RetrievalEvaluationRunner
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.evaluation import (
    EvaluationRun,
    EvaluationRunItem,
    EvaluationRunStatus,
    EvaluationTargetType,
)
from models.model import UploadFile
from services.evaluation_service import EvaluationService

logger = logging.getLogger(__name__)

_PERSIST_BATCH_SIZE = 10
_HEARTBEAT_JOIN_TIMEOUT_SECONDS = 5


class EvaluationRunCancelledError(Exception):
    """Raised when cooperative cancellation stops an evaluation task."""


def _workflow_task_id(evaluation_run_id: str, phase: str, position: int) -> str:
    return EvaluationService.workflow_task_id(evaluation_run_id, phase, position)


@shared_task(queue="evaluation", acks_late=True, reject_on_worker_lost=True)
def run_evaluation(run_data_dict: dict[str, Any]) -> None:
    """Execute one evaluation run while preserving terminal state transitions."""
    run_data = EvaluationRunData.model_validate(run_data_dict)
    with session_factory.create_session() as session:
        try:
            _execute_evaluation(session, run_data)
        except EvaluationRunCancelledError:
            logger.info("Evaluation run %s stopped after cancellation", run_data.evaluation_run_id)
        except Exception as exc:
            logger.exception("Evaluation run %s failed", run_data.evaluation_run_id)
            _mark_run_failed(session, run_data.evaluation_run_id, str(exc))


def _renew_evaluation_run_heartbeat(evaluation_run_id: str) -> bool:
    """Renew the lease only while the evaluation remains executable."""
    with session_factory.create_session() as session:
        result = cast(
            CursorResult[Any],
            session.execute(
                update(EvaluationRun)
                .where(
                    EvaluationRun.id == evaluation_run_id,
                    EvaluationRun.status == EvaluationRunStatus.RUNNING,
                )
                .values(heartbeat_at=naive_utc_now())
            ),
        )
        session.commit()
        return result.rowcount == 1


def _renew_evaluation_run_heartbeat_while_running(evaluation_run_id: str, stop_event: Event) -> None:
    interval = dify_config.EVALUATION_RUN_HEARTBEAT_INTERVAL
    while not stop_event.wait(interval):
        try:
            if not _renew_evaluation_run_heartbeat(evaluation_run_id):
                return
        except Exception:
            logger.exception("Failed to renew heartbeat for evaluation run %s", evaluation_run_id)


@contextmanager
def _maintain_evaluation_run_heartbeat(evaluation_run_id: str) -> Generator[None, None, None]:
    stop_event = Event()
    heartbeat_thread = Thread(
        target=_renew_evaluation_run_heartbeat_while_running,
        args=(evaluation_run_id, stop_event),
        daemon=True,
        name=f"EvaluationRunHeartbeat({evaluation_run_id})",
    )
    heartbeat_thread.start()
    try:
        yield
    finally:
        stop_event.set()
        heartbeat_thread.join(timeout=_HEARTBEAT_JOIN_TIMEOUT_SECONDS)
        if heartbeat_thread.is_alive():
            logger.warning("Evaluation run %s heartbeat thread did not stop", evaluation_run_id)


@shared_task(queue="evaluation")
def reconcile_stale_evaluation_runs() -> int:
    """Fail running evaluations whose heartbeat lease has expired.

    The compare-and-set update makes the sweep idempotent and lets a normal
    heartbeat, completion, or cancellation win if it races with the reconciler.
    """
    cutoff = naive_utc_now() - timedelta(seconds=dify_config.EVALUATION_RUN_LEASE_TIMEOUT)
    stale_runs: list[tuple[str, str | None, str, int]] = []
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
                        EvaluationRun.heartbeat_at.is_not(None),
                        EvaluationRun.heartbeat_at < cutoff,
                    )
                    .values(
                        status=EvaluationRunStatus.FAILED,
                        completed_at=naive_utc_now(),
                        error="Evaluation run heartbeat lease expired.",
                    )
                ),
            )
            if result.rowcount == 1:
                stale_runs.append(
                    (run.id, run.celery_task_id, EvaluationTargetType(run.target_type).value, run.total_items)
                )
        session.commit()

    if not stale_runs:
        return 0

    from celery import current_app as celery_app

    for run_id, celery_task_id, target_type, total_items in stale_runs:
        if target_type in {EvaluationTargetType.APPS.value, EvaluationTargetType.SNIPPETS.value}:
            EvaluationService._stop_workflow_tasks(run_id, total_items)
        if celery_task_id:
            try:
                celery_app.control.revoke(celery_task_id, terminate=False)
            except Exception:
                logger.exception("Failed to revoke stale evaluation task %s", celery_task_id)
    logger.warning("Marked %d stale evaluation runs as failed", len(stale_runs))
    return len(stale_runs)


def _execute_evaluation(session: Session, run_data: EvaluationRunData) -> None:
    evaluation_run = session.scalar(
        select(EvaluationRun).where(EvaluationRun.id == run_data.evaluation_run_id).with_for_update()
    )
    if evaluation_run is None:
        logger.error("EvaluationRun %s not found", run_data.evaluation_run_id)
        return
    if (
        evaluation_run.tenant_id != run_data.tenant_id
        or EvaluationTargetType(evaluation_run.target_type).value != run_data.target_type
        or evaluation_run.target_id != run_data.target_id
        or evaluation_run.target_workflow_version_id != run_data.target_workflow_version_id
    ):
        raise ValueError("Evaluation task payload does not match the persisted run.")
    if run_data.target_type != EvaluationTargetType.KNOWLEDGE_BASE.value and not run_data.target_workflow_version_id:
        raise ValueError("Evaluation task payload is missing target_workflow_version_id.")
    if evaluation_run.status in {
        EvaluationRunStatus.COMPLETED,
        EvaluationRunStatus.FAILED,
        EvaluationRunStatus.CANCELLED,
    }:
        return
    run_created_by = evaluation_run.created_by

    evaluation_instance = EvaluationManager.get_evaluation_instance()
    if evaluation_instance is None:
        raise ValueError("Evaluation framework not configured")

    # Redelivery is idempotent at the result boundary: discard a partial prior attempt.
    session.query(EvaluationRunItem).filter_by(evaluation_run_id=evaluation_run.id).delete()
    now = naive_utc_now()
    evaluation_run.status = EvaluationRunStatus.RUNNING
    evaluation_run.started_at = evaluation_run.started_at or now
    evaluation_run.heartbeat_at = now
    evaluation_run.completed_at = None
    evaluation_run.completed_items = 0
    evaluation_run.failed_items = 0
    evaluation_run.progress_rate = 0.01
    evaluation_run.error = None
    session.commit()

    with _maintain_evaluation_run_heartbeat(run_data.evaluation_run_id):
        _execute_running_evaluation(session, run_data, evaluation_instance, run_created_by)


def _execute_running_evaluation(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    run_created_by: str,
) -> None:
    if run_data.target_type == EvaluationTargetType.KNOWLEDGE_BASE.value:
        results = _execute_retrieval_test(
            session=session,
            account_id=run_created_by,
            run_data=run_data,
            evaluation_instance=evaluation_instance,
        )
    else:
        node_results, workflow_run_ids, target_errors = EvaluationService.execute_targets(
            evaluation_run_id=run_data.evaluation_run_id,
            tenant_id=run_data.tenant_id,
            target_type=run_data.target_type,
            target_id=run_data.target_id,
            target_workflow_version_id=run_data.target_workflow_version_id or "",
            input_list=run_data.input_list,
            cancellation_check=lambda: _cooperative_checkpoint(session, run_data.evaluation_run_id),
            progress_callback=lambda completed, total: _update_run_progress(
                session,
                run_data.evaluation_run_id,
                0.05 + 0.55 * completed / max(total, 1),
            ),
        )
        _raise_if_cancelled(session, run_data.evaluation_run_id)
        workflow_run_id_map = {
            item.index: workflow_run_id
            for item, workflow_run_id in zip(run_data.input_list, workflow_run_ids)
            if workflow_run_id
        }
        results = _execute_evaluation_runner(
            session=session,
            run_data=run_data,
            evaluation_instance=evaluation_instance,
            node_run_result_mapping_list=node_results,
            workflow_run_id_map=workflow_run_id_map,
            target_errors=target_errors,
        )

    _raise_if_cancelled(session, run_data.evaluation_run_id)
    # The cancellation check starts a read transaction. End it before writing
    # the result object to external storage; the final status update below is
    # the database-side compare-and-set that publishes the file atomically.
    session.rollback()
    metrics_summary = _compute_metrics_summary(results, run_data.judgment_config)
    result_xlsx = _generate_result_xlsx(run_data.input_list, results)
    _update_run_progress(session, run_data.evaluation_run_id, 0.98)
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
        )
        .values(
            status=EvaluationRunStatus.COMPLETED,
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
        raise EvaluationRunCancelledError()
    session.commit()
    logger.info("Evaluation run %s completed successfully", run_data.evaluation_run_id)


def _execute_evaluation_runner(
    session: Session,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
    node_run_result_mapping_list: list[dict[str, NodeRunResult]],
    workflow_run_id_map: dict[int, str] | None = None,
    target_errors: Sequence[str | None] | None = None,
) -> list[EvaluationItemResult]:
    """Evaluate configured node/metric pairs and persist one result per row."""
    results_by_index: dict[int, EvaluationItemResult] = {}

    total_steps = sum(len(metric.node_info_list) for metric in run_data.default_metrics) + bool(
        run_data.customized_metrics
    )
    completed_steps = 0
    for default_metric in run_data.default_metrics:
        for node_info in default_metric.node_info_list:
            _cooperative_checkpoint(session, run_data.evaluation_run_id)
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
            _update_run_progress(
                session,
                run_data.evaluation_run_id,
                0.6 + 0.25 * completed_steps / max(total_steps, 1),
            )

    if run_data.customized_metrics:
        _cooperative_checkpoint(session, run_data.evaluation_run_id)
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
                    cancellation_check=lambda: _cooperative_checkpoint(session, run_data.evaluation_run_id),
                    task_id_factory=lambda position: _workflow_task_id(
                        run_data.evaluation_run_id,
                        "evaluator",
                        successful_positions[position],
                    ),
                )
                _merge_customized_results(results_by_index, customized_results, customized_input_items)
        except Exception as exc:
            logger.exception("Failed customized metrics for run %s", run_data.evaluation_run_id)
            for item in customized_input_items:
                _merge_result(
                    results_by_index,
                    item.index,
                    EvaluationItemResult(index=item.index, error=f"Customized evaluation failed: {exc}"),
                )
        completed_steps += 1
        _update_run_progress(
            session,
            run_data.evaluation_run_id,
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
        run_data.evaluation_run_id,
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
) -> list[EvaluationItemResult]:
    node_run_results, retrieval_errors = EvaluationService.execute_retrieval_test_targets(
        tenant_id=run_data.tenant_id,
        dataset_id=run_data.target_id,
        account_id=account_id,
        input_list=run_data.input_list,
        cancellation_check=lambda: _cooperative_checkpoint(session, run_data.evaluation_run_id),
        progress_callback=lambda completed, total: _update_run_progress(
            session,
            run_data.evaluation_run_id,
            0.05 + 0.45 * completed / max(total, 1),
        ),
    )
    _raise_if_cancelled(session, run_data.evaluation_run_id)

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
        _cooperative_checkpoint(session, run_data.evaluation_run_id)
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
        _update_run_progress(
            session,
            run_data.evaluation_run_id,
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
    _persist_results(session, run_data.evaluation_run_id, results, run_data.input_list)
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
    for position, (item, node_results) in enumerate(zip(input_list, node_run_result_mapping_list)):
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
    evaluation_run_id: str,
    results: Sequence[EvaluationItemResult],
    input_list: Sequence[EvaluationDatasetInput],
    workflow_run_id_map: dict[int, str] | None = None,
) -> None:
    """Upsert results in small batches and expose cooperative progress."""
    result_map = {result.index: result for result in results}
    workflow_run_ids = workflow_run_id_map or {}
    completed = 0
    failed = 0

    for position, item_input in enumerate(input_list, start=1):
        _raise_if_cancelled(session, evaluation_run_id)
        result = result_map.get(
            item_input.index,
            EvaluationItemResult(index=item_input.index, error="Missing evaluation result."),
        )
        run_item = session.scalar(
            select(EvaluationRunItem).where(
                EvaluationRunItem.evaluation_run_id == evaluation_run_id,
                EvaluationRunItem.item_index == item_input.index,
            )
        )
        values = {
            "workflow_run_id": workflow_run_ids.get(item_input.index),
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
                evaluation_run_id=evaluation_run_id,
                item_index=item_input.index,
                **values,
            )
            session.add(run_item)
        else:
            for field_name, value in values.items():
                setattr(run_item, field_name, value)

        if result.error is None:
            completed += 1
        else:
            failed += 1

        if position % _PERSIST_BATCH_SIZE == 0 or position == len(input_list):
            progress_update = (
                update(EvaluationRun)
                .where(
                    EvaluationRun.id == evaluation_run_id,
                    EvaluationRun.status == EvaluationRunStatus.RUNNING,
                )
                .values(
                    completed_items=completed,
                    failed_items=failed,
                    progress_rate=0.86 + 0.1 * position / max(len(input_list), 1),
                )
            )
            update_result = cast(CursorResult[Any], session.execute(progress_update))
            if update_result.rowcount != 1:
                session.rollback()
                raise EvaluationRunCancelledError()
            session.commit()


def _raise_if_cancelled(session: Session, evaluation_run_id: str) -> None:
    session.expire_all()
    status = session.scalar(select(EvaluationRun.status).where(EvaluationRun.id == evaluation_run_id))
    if status == EvaluationRunStatus.CANCELLED:
        raise EvaluationRunCancelledError()
    if status != EvaluationRunStatus.RUNNING:
        raise RuntimeError(f"Evaluation run is no longer executable: {status}")


def _cooperative_checkpoint(session: Session, evaluation_run_id: str) -> None:
    """Check status and close the read transaction before external work."""
    _raise_if_cancelled(session, evaluation_run_id)
    session.rollback()


def _update_run_progress(session: Session, evaluation_run_id: str, progress_rate: float) -> None:
    result = cast(
        CursorResult[Any],
        session.execute(
            update(EvaluationRun)
            .where(
                EvaluationRun.id == evaluation_run_id,
                EvaluationRun.status == EvaluationRunStatus.RUNNING,
            )
            .values(progress_rate=min(max(progress_rate, 0.0), 0.99))
        ),
    )
    if result.rowcount != 1:
        session.rollback()
        raise EvaluationRunCancelledError()
    session.commit()


def _create_runner(
    category: EvaluationCategory,
    evaluation_instance: BaseEvaluationInstance,
) -> BaseEvaluationRunner:
    if category == EvaluationCategory.LLM:
        return LLMEvaluationRunner(evaluation_instance)
    if category in {EvaluationCategory.RETRIEVAL, EvaluationCategory.KNOWLEDGE_BASE}:
        return RetrievalEvaluationRunner(evaluation_instance)
    raise ValueError(f"Unsupported evaluation category: {category}")


# ---------------------------------------------------------------------------
# Status / summary / XLSX / storage helpers
# ---------------------------------------------------------------------------


def _mark_run_failed(session: Session, run_id: str, error: str) -> None:
    """Mark only a non-terminal run as failed; cancellation always wins."""
    try:
        session.rollback()
        session.execute(
            update(EvaluationRun)
            .where(
                EvaluationRun.id == run_id,
                EvaluationRun.status.in_([EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING]),
            )
            .values(
                status=EvaluationRunStatus.FAILED,
                error=error[:2000],
                completed_at=naive_utc_now(),
            )
        )
        session.commit()
    except Exception:
        logger.exception("Failed to mark run %s as failed", run_id)


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
    return f"{node_label} ({metric.node_info.node_id}) : {metric.name}"


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
