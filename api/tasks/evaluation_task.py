import io
import json
import logging
from collections.abc import Sequence
from numbers import Real
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


class EvaluationRunCancelledError(Exception):
    """Raised when cooperative cancellation stops an evaluation task."""


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


def _execute_evaluation(session: Session, run_data: EvaluationRunData) -> None:
    evaluation_run = session.scalar(
        select(EvaluationRun).where(EvaluationRun.id == run_data.evaluation_run_id).with_for_update()
    )
    if evaluation_run is None:
        logger.error("EvaluationRun %s not found", run_data.evaluation_run_id)
        return
    if (
        evaluation_run.tenant_id != run_data.tenant_id
        or evaluation_run.target_type.value != run_data.target_type
        or evaluation_run.target_id != run_data.target_id
    ):
        raise ValueError("Evaluation task payload does not match the persisted run.")
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
    evaluation_run.status = EvaluationRunStatus.RUNNING
    evaluation_run.started_at = evaluation_run.started_at or naive_utc_now()
    evaluation_run.completed_at = None
    evaluation_run.completed_items = 0
    evaluation_run.failed_items = 0
    evaluation_run.error = None
    session.commit()

    if run_data.target_type == EvaluationTargetType.KNOWLEDGE_BASE.value:
        results = _execute_retrieval_test(
            session=session,
            account_id=run_created_by,
            run_data=run_data,
            evaluation_instance=evaluation_instance,
        )
    else:
        node_results, workflow_run_ids = EvaluationService.execute_targets(
            tenant_id=run_data.tenant_id,
            target_type=run_data.target_type,
            target_id=run_data.target_id,
            input_list=run_data.input_list,
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
        )

    _raise_if_cancelled(session, run_data.evaluation_run_id)
    # The cancellation check starts a read transaction. End it before writing
    # the result object to external storage; the final status update below is
    # the database-side compare-and-set that publishes the file atomically.
    session.rollback()
    metrics_summary = _compute_metrics_summary(results, run_data.judgment_config)
    result_xlsx = _generate_result_xlsx(run_data.input_list, results)
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
) -> list[EvaluationItemResult]:
    """Evaluate configured node/metric pairs and persist one result per row."""
    results_by_index: dict[int, EvaluationItemResult] = {}

    for default_metric in run_data.default_metrics:
        for node_info in default_metric.node_info_list:
            node_run_results: list[NodeRunResult] = []
            dataset_items: list[EvaluationDatasetInput] = []
            dataset_indices: list[int] = []
            for position, mapping in enumerate(node_run_result_mapping_list):
                node_result = mapping.get(node_info.node_id)
                if node_result is None:
                    continue
                node_run_results.append(node_result)
                dataset_items.append(run_data.input_list[position])
                dataset_indices.append(run_data.input_list[position].index)

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

    if run_data.customized_metrics:
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

    results = _finalize_results(
        input_list=run_data.input_list,
        results_by_index=results_by_index,
        missing_errors=_build_missing_result_errors(run_data.input_list, node_run_result_mapping_list),
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
    node_run_results = EvaluationService.execute_retrieval_test_targets(
        tenant_id=run_data.tenant_id,
        dataset_id=run_data.target_id,
        account_id=account_id,
        input_list=run_data.input_list,
    )
    _raise_if_cancelled(session, run_data.evaluation_run_id)

    results_by_index: dict[int, EvaluationItemResult] = {}
    runner = RetrievalEvaluationRunner(evaluation_instance)
    node_info = NodeInfo(
        node_id=run_data.target_id,
        type="knowledge-retrieval",
        title="Knowledge Retrieval",
    )
    dataset_indices = [item.index for item in run_data.input_list]
    for default_metric in run_data.default_metrics:
        try:
            evaluated = runner.evaluate_metrics(
                node_run_result_list=node_run_results,
                default_metric=default_metric,
                model_provider=run_data.evaluation_model_provider,
                model_name=run_data.evaluation_model,
                tenant_id=run_data.tenant_id,
                dataset_items=run_data.input_list,
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

    results = _finalize_results(
        input_list=run_data.input_list,
        results_by_index=results_by_index,
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
) -> dict[int, str]:
    errors: dict[int, str] = {}
    for item, node_results in zip(input_list, node_run_result_mapping_list):
        errors[item.index] = (
            "No evaluation metrics were generated for this row."
            if node_results
            else "Target execution produced no successful node results for this row."
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
                .values(completed_items=completed, failed_items=failed)
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
        result = result_by_index.get(item.index)

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

        ws.cell(row=row_idx, column=col, value=result.actual_output if result else "").border = thin_border
        col += 1

        metric_scores = {_metric_column_name(metric): metric.value for metric in result.metrics} if result else {}
        for metric_name in metric_columns:
            score = metric_scores.get(metric_name)
            ws.cell(row=row_idx, column=col, value=score if score is not None else "").border = thin_border
            col += 1

        if has_judgment:
            if result and result.judgment.condition_results:
                judgment_value = "Pass" if result.judgment.passed else "Fail"
            else:
                judgment_value = ""
            ws.cell(row=row_idx, column=col, value=judgment_value).border = thin_border
            col += 1

        ws.cell(row=row_idx, column=col, value=result.error if result else "").border = thin_border

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
