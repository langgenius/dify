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
    EvaluationDatasetInput,
    EvaluationItemResult,
    EvaluationRunData,
)
from core.evaluation.entities.judgment_entity import JudgmentConfig
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
from models.enums import CreatorUserRole
from models.evaluation import EvaluationRun, EvaluationRunStatus
from models.model import UploadFile
from services.evaluation_service import EvaluationService

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

    if run_data.target_type == "dataset":
        results: list[EvaluationItemResult] = _execute_retrieval_test(
            session=session,
            evaluation_run=evaluation_run,
            run_data=run_data,
            evaluation_instance=evaluation_instance,
        )
    else:
        evaluation_service = EvaluationService()
        node_run_result_mapping_list, workflow_run_ids = evaluation_service.execute_targets(
            tenant_id=run_data.tenant_id,
            target_type=run_data.target_type,
            target_id=run_data.target_id,
            input_list=run_data.input_list,
        )
        results = _execute_evaluation_runner(
            session=session,
            run_data=run_data,
            evaluation_instance=evaluation_instance,
            node_run_result_mapping_list=node_run_result_mapping_list,
        )

        _backfill_workflow_run_ids(
            session=session,
            evaluation_run_id=run_data.evaluation_run_id,
            input_list=run_data.input_list,
            workflow_run_ids=workflow_run_ids,
        )

    # Compute summary metrics
    metrics_summary = _compute_metrics_summary(results, run_data.judgment_config)

    # Generate result XLSX
    result_xlsx = _generate_result_xlsx(run_data.input_list, results)

    # Store result file
    result_file_id = _store_result_file(run_data.tenant_id, run_data.evaluation_run_id, result_xlsx, session)

    # Update run to completed
    evaluation_run: EvaluationRun = session.query(EvaluationRun).filter_by(id=run_data.evaluation_run_id).first()
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
    node_run_result_mapping_list: list[dict[str, NodeRunResult]],
) -> list[EvaluationItemResult]:
    """Execute the evaluation runner."""
    default_metrics = run_data.default_metrics
    customized_metrics = run_data.customized_metrics
    results: list[EvaluationItemResult] = []
    for default_metric in default_metrics:
        for node_info in default_metric.node_info_list:
            node_run_result_list: list[NodeRunResult] = []
            for node_run_result_mapping in node_run_result_mapping_list:
                node_run_result = node_run_result_mapping.get(node_info.node_id)
                if node_run_result is not None:
                    node_run_result_list.append(node_run_result)
            if node_run_result_list:
                runner = _create_runner(EvaluationCategory(node_info.type), evaluation_instance, session)
                results.extend(
                    runner.run(
                        evaluation_run_id=run_data.evaluation_run_id,
                        tenant_id=run_data.tenant_id,
                        target_id=run_data.target_id,
                        target_type=run_data.target_type,
                        default_metric=default_metric,
                        customized_metrics=None,
                        model_provider=run_data.evaluation_model_provider,
                        model_name=run_data.evaluation_model,
                        node_run_result_list=node_run_result_list,
                        judgment_config=run_data.judgment_config,
                        input_list=run_data.input_list,
                    )
                )
    if customized_metrics:
        runner = _create_runner(EvaluationCategory.WORKFLOW, evaluation_instance, session)
        results.extend(
            runner.run(
                evaluation_run_id=run_data.evaluation_run_id,
                tenant_id=run_data.tenant_id,
                target_id=run_data.target_id,
                target_type=run_data.target_type,
                default_metric=None,
                customized_metrics=customized_metrics,
                node_run_result_list=None,
                node_run_result_mapping_list=node_run_result_mapping_list,
                judgment_config=run_data.judgment_config,
                input_list=run_data.input_list,
            )
        )
    return results


def _create_runner(
    category: EvaluationCategory,
    evaluation_instance: BaseEvaluationInstance,
    session: Any,
) -> BaseEvaluationRunner:
    """Create the appropriate runner for the evaluation category."""
    match category:
        case EvaluationCategory.LLM:
            return LLMEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.RETRIEVAL | EvaluationCategory.KNOWLEDGE_BASE:
            return RetrievalEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.AGENT:
            return AgentEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.WORKFLOW:
            return WorkflowEvaluationRunner(evaluation_instance, session)
        case EvaluationCategory.SNIPPET:
            return SnippetEvaluationRunner(evaluation_instance, session)
        case _:
            raise ValueError(f"Unknown evaluation category: {category}")


def _execute_retrieval_test(
    session: Any,
    evaluation_run: EvaluationRun,
    run_data: EvaluationRunData,
    evaluation_instance: BaseEvaluationInstance,
) -> list[EvaluationItemResult]:
    """Execute knowledge base retrieval for all items, then evaluate metrics.

    Unlike the workflow-based path, there are no workflow nodes to traverse.
    Hit testing is run directly for each dataset item and the results are fed
    straight into :class:`RetrievalEvaluationRunner`.
    """
    node_run_result_list = EvaluationService.execute_retrieval_test_targets(
        dataset_id=run_data.target_id,
        account_id=evaluation_run.created_by,
        input_list=run_data.input_list,
    )

    results: list[EvaluationItemResult] = []
    runner = RetrievalEvaluationRunner(evaluation_instance, session)
    results.extend(
        runner.run(
            evaluation_run_id=run_data.evaluation_run_id,
            tenant_id=run_data.tenant_id,
            target_id=run_data.target_id,
            target_type=run_data.target_type,
            default_metric=None,
            model_provider=run_data.evaluation_model_provider,
            model_name=run_data.evaluation_model,
            node_run_result_list=node_run_result_list,
            judgment_config=run_data.judgment_config,
            input_list=run_data.input_list,
        )
    )
    return results


def _backfill_workflow_run_ids(
    session: Any,
    evaluation_run_id: str,
    input_list: list[EvaluationDatasetInput],
    workflow_run_ids: list[str | None],
) -> None:
    """Set ``workflow_run_id`` on items that were created by the runner."""
    from models.evaluation import EvaluationRunItem

    for item, wf_run_id in zip(input_list, workflow_run_ids):
        if not wf_run_id:
            continue
        run_item = (
            session.query(EvaluationRunItem)
            .filter_by(evaluation_run_id=evaluation_run_id, item_index=item.index)
            .first()
        )
        if run_item:
            run_item.workflow_run_id = wf_run_id
    session.commit()


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


def _compute_metrics_summary(
    results: list[EvaluationItemResult],
    judgment_config: JudgmentConfig | None,
) -> dict[str, Any]:
    """Compute aggregate metric and judgment summaries for an evaluation run.

    Metric statistics are calculated from successful item results only. When a
    judgment config is present, the summary also reports how many successful
    items passed or failed the configured judgment rules.
    """

    summary: dict[str, Any] = {}

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

    # Collect all metric names
    all_metric_names: list[str] = []
    for result in results:
        for metric in result.metrics:
            if metric.name not in all_metric_names:
                all_metric_names.append(metric.name)

    # Collect all input keys
    input_keys: list[str] = []
    for item in input_list:
        for key in item.inputs:
            if key not in input_keys:
                input_keys.append(key)

    # Include judgment column only when at least one result has judgment conditions evaluated
    has_judgment = any(bool(r.judgment.condition_results) for r in results)

    # Build headers
    judgment_headers = ["judgment"] if has_judgment else []
    headers = (
        ["index"] + input_keys + ["expected_output", "actual_output"] + all_metric_names + judgment_headers + ["error"]
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
    for row_idx, item in enumerate(input_list, start=2):
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
        metric_scores = {m.name: m.value for m in result.metrics} if result else {}
        for metric_name in all_metric_names:
            score = metric_scores.get(metric_name)
            ws.cell(row=row_idx, column=col, value=score if score is not None else "").border = thin_border
            col += 1

        # Judgment result
        if has_judgment:
            if result and result.judgment.condition_results:
                judgment_value = "Pass" if result.judgment.passed else "Fail"
            else:
                judgment_value = ""
            ws.cell(row=row_idx, column=col, value=judgment_value).border = thin_border
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
            created_by_role=CreatorUserRole.ACCOUNT,
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
