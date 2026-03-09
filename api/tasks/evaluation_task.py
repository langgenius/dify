import io
import json
import logging
from typing import Any

from celery import shared_task
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from configs import dify_config
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    EvaluationCategory,
    EvaluationItemResult,
    EvaluationRunData,
)
from core.evaluation.evaluation_manager import EvaluationManager
from core.evaluation.runners.agent_evaluation_runner import AgentEvaluationRunner
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from core.evaluation.runners.llm_evaluation_runner import LLMEvaluationRunner
from core.evaluation.runners.retrieval_evaluation_runner import RetrievalEvaluationRunner
from core.evaluation.runners.snippet_evaluation_runner import SnippetEvaluationRunner
from core.evaluation.runners.workflow_evaluation_runner import WorkflowEvaluationRunner
from core.workflow.node_events.base import NodeRunResult
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.evaluation import EvaluationRun, EvaluationRunStatus
from models.model import UploadFile

logger = logging.getLogger(__name__)


@shared_task(queue="evaluation")
def run_evaluation(run_data_dict: dict[str, Any]) -> None:
    """Celery task for running evaluations asynchronously.

    Workflow:
    1. Deserialize EvaluationRunData
    2. Update status to RUNNING
    3. Select appropriate Runner based on evaluation_category
    4. Execute runner.run() which handles target execution + metric computation
    5. Generate result XLSX
    6. Update EvaluationRun status to COMPLETED
    """
    run_data = EvaluationRunData.model_validate(run_data_dict)

    with db.engine.connect() as connection:
        from sqlalchemy.orm import Session

        session = Session(bind=connection)

        try:
            _execute_evaluation(session, run_data)
        except Exception as e:
            logger.exception("Evaluation run %s failed", run_data.evaluation_run_id)
            _mark_run_failed(session, run_data.evaluation_run_id, str(e))
        finally:
            session.close()


def _execute_evaluation(session: Any, run_data: EvaluationRunData) -> None:
    """Core evaluation execution logic."""
    evaluation_run = session.query(EvaluationRun).filter_by(id=run_data.evaluation_run_id).first()
    if not evaluation_run:
        logger.error("EvaluationRun %s not found", run_data.evaluation_run_id)
        return

    # Check if cancelled
    if evaluation_run.status == EvaluationRunStatus.CANCELLED:
        logger.info("EvaluationRun %s was cancelled", run_data.evaluation_run_id)
        return

    # Get evaluation instance
    evaluation_instance = EvaluationManager.get_evaluation_instance()
    if evaluation_instance is None:
        raise ValueError("Evaluation framework not configured")

    _execute_evaluation_runner(session, run_data, evaluation_instance, node_run_result_mapping)


    # Compute summary metrics
    metrics_summary = _compute_metrics_summary(results)

    # Generate result XLSX
    result_xlsx = _generate_result_xlsx(run_data.items, results)

    # Store result file
    result_file_id = _store_result_file(
        run_data.tenant_id, run_data.evaluation_run_id, result_xlsx, session
    )

    # Update run to completed
    evaluation_run = session.query(EvaluationRun).filter_by(id=run_data.evaluation_run_id).first()
    if evaluation_run:
        evaluation_run.status = EvaluationRunStatus.COMPLETED
        evaluation_run.completed_at = naive_utc_now()
        evaluation_run.metrics_summary = json.dumps(metrics_summary)
        if result_file_id:
            evaluation_run.result_file_id = result_file_id
        session.commit()

    logger.info("Evaluation run %s completed successfully", run_data.evaluation_run_id)

def _execute_evaluation_runner(
    session: Any, 
    run_data: EvaluationRunData, 
    evaluation_instance: BaseEvaluationInstance, 
    node_run_result_mapping: dict[str, NodeRunResult],
) -> list[EvaluationItemResult]:
    """Execute the evaluation runner."""
    default_metrics = run_data.default_metrics
    customized_metrics = run_data.customized_metrics
    for default_metric in default_metrics:
        for node_info in default_metric.node_info_list:
            node_run_result = node_run_result_mapping.get(node_info.node_id)
            if node_run_result:
                runner = _create_runner(EvaluationCategory(node_info.type), evaluation_instance, session)
                runner.run(
                    evaluation_run_id=run_data.evaluation_run_id,
                    tenant_id=run_data.tenant_id,
                    target_id=run_data.target_id,
                    target_type=run_data.target_type,
                    default_metric=default_metric,
                    customized_metrics=None,
                    model_provider=run_data.evaluation_model_provider,
                    model_name=run_data.evaluation_model,
                    node_run_result=node_run_result,
                )
            else:
                default_metric.score = 0
    if customized_metrics:
        runner = _create_runner(EvaluationCategory.WORKFLOW, evaluation_instance, session)
        runner.run(
            evaluation_run_id=run_data.evaluation_run_id,
            tenant_id=run_data.tenant_id,
            target_id=run_data.target_id,
            target_type=run_data.target_type,
            default_metric=None,
            customized_metrics=customized_metrics,
            node_run_result=None,
            node_run_result_mapping=node_run_result_mapping,
        )

def _create_runner(
    category: EvaluationCategory,
    evaluation_instance: BaseEvaluationInstance,
    session: Any,
) -> BaseEvaluationRunner:
    """Create the appropriate runner for the evaluation category."""
    match category:
        case EvaluationCategory.LLM:
            return LLMEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.RETRIEVAL:
            return RetrievalEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.AGENT:
            return AgentEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.WORKFLOW:
            return WorkflowEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.SNIPPET:
            return SnippetEvaluationRunner(evaluation_instance, session)
        case _:
            raise ValueError(f"Unknown evaluation category: {category}")


def _mark_run_failed(session: Any, run_id: str, error: str) -> None:
    """Mark an evaluation run as failed."""
    try:
        evaluation_run = session.query(EvaluationRun).filter_by(id=run_id).first()
        if evaluation_run:
            evaluation_run.status = EvaluationRunStatus.FAILED
            evaluation_run.error = error[:2000]  # Truncate error
            evaluation_run.completed_at = naive_utc_now()
            session.commit()
    except Exception:
        logger.exception("Failed to mark run %s as failed", run_id)


def _compute_metrics_summary(results: list[EvaluationItemResult]) -> dict[str, Any]:
    """Compute average scores per metric across all results."""
    metric_scores: dict[str, list[float]] = {}
    for result in results:
        if result.error:
            continue
        for metric in result.metrics:
            if metric.name not in metric_scores:
                metric_scores[metric.name] = []
            metric_scores[metric.name].append(metric.score)

    summary: dict[str, Any] = {}
    for name, scores in metric_scores.items():
        summary[name] = {
            "average": sum(scores) / len(scores) if scores else 0.0,
            "min": min(scores) if scores else 0.0,
            "max": max(scores) if scores else 0.0,
            "count": len(scores),
        }

    # Overall average
    all_scores = [s for scores in metric_scores.values() for s in scores]
    summary["_overall"] = {
        "average": sum(all_scores) / len(all_scores) if all_scores else 0.0,
        "total_items": len(results),
        "successful_items": sum(1 for r in results if r.error is None),
        "failed_items": sum(1 for r in results if r.error is not None),
    }

    return summary


def _generate_result_xlsx(
    items: list[Any],
    results: list[EvaluationItemResult],
) -> bytes:
    """Generate result XLSX with input data, actual output, and metric scores."""
    wb = Workbook()
    ws = wb.active
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

    # Collect all metric names
    all_metric_names: list[str] = []
    for result in results:
        for metric in result.metrics:
            if metric.name not in all_metric_names:
                all_metric_names.append(metric.name)

    # Collect all input keys
    input_keys: list[str] = []
    for item in items:
        for key in item.inputs:
            if key not in input_keys:
                input_keys.append(key)

    # Build headers
    headers = (
        ["index"]
        + input_keys
        + ["expected_output", "actual_output"]
        + all_metric_names
        + ["overall_score", "error"]
    )

    # Write header row
    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border

    # Set column widths
    ws.column_dimensions["A"].width = 10
    for col_idx in range(2, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = 25

    # Build result lookup
    result_by_index = {r.index: r for r in results}

    # Write data rows
    for row_idx, item in enumerate(items, start=2):
        result = result_by_index.get(item.index)

        col = 1
        # Index
        ws.cell(row=row_idx, column=col, value=item.index).border = thin_border
        col += 1

        # Input values
        for key in input_keys:
            val = item.inputs.get(key, "")
            ws.cell(row=row_idx, column=col, value=str(val)).border = thin_border
            col += 1

        # Expected output
        ws.cell(row=row_idx, column=col, value=item.expected_output or "").border = thin_border
        col += 1

        # Actual output
        ws.cell(row=row_idx, column=col, value=result.actual_output if result else "").border = thin_border
        col += 1

        # Metric scores
        metric_scores = {m.name: m.score for m in result.metrics} if result else {}
        for metric_name in all_metric_names:
            score = metric_scores.get(metric_name)
            ws.cell(row=row_idx, column=col, value=score if score is not None else "").border = thin_border
            col += 1

        # Overall score
        ws.cell(
            row=row_idx, column=col, value=result.overall_score if result else ""
        ).border = thin_border
        col += 1

        # Error
        ws.cell(row=row_idx, column=col, value=result.error if result else "").border = thin_border

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output.getvalue()


def _store_result_file(
    tenant_id: str,
    run_id: str,
    xlsx_content: bytes,
    session: Any,
) -> str | None:
    """Store result XLSX file and return the UploadFile ID."""
    try:
        from extensions.ext_storage import storage
        from libs.uuid_utils import uuidv7

        filename = f"evaluation-result-{run_id[:8]}.xlsx"
        storage_key = f"evaluation_results/{tenant_id}/{str(uuidv7())}.xlsx"

        storage.save(storage_key, xlsx_content)

        upload_file: UploadFile = UploadFile(
            tenant_id=tenant_id,
            storage_type=dify_config.STORAGE_TYPE,
            key=storage_key,
            name=filename,
            size=len(xlsx_content),
            extension="xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            created_by_role="account",
            created_by="system",
            created_at=naive_utc_now(),
            used=False,
        )
        session.add(upload_file)
        session.commit()
        return upload_file.id
    except Exception:
        logger.exception("Failed to store result file for run %s", run_id)
        return None
