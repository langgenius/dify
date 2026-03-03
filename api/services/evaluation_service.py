import io
import json
import logging
from typing import Any, Union

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from configs import dify_config
from core.evaluation.entities.evaluation_entity import (
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationRunData,
)
from core.evaluation.evaluation_manager import EvaluationManager
from models.evaluation import (
    EvaluationConfiguration,
    EvaluationRun,
    EvaluationRunItem,
    EvaluationRunStatus,
)
from models.model import App, AppMode
from models.snippet import CustomizedSnippet
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.snippet_service import SnippetService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


class EvaluationService:
    """
    Service for evaluation-related operations.

    Provides functionality to generate evaluation dataset templates
    based on App or Snippet input parameters.
    """

    # Excluded app modes that don't support evaluation templates
    EXCLUDED_APP_MODES = {AppMode.RAG_PIPELINE}

    @classmethod
    def generate_dataset_template(
        cls,
        target: Union[App, CustomizedSnippet],
        target_type: str,
    ) -> tuple[bytes, str]:
        """
        Generate evaluation dataset template as XLSX bytes.

        Creates an XLSX file with headers based on the evaluation target's input parameters.
        The first column is index, followed by input parameter columns.

        :param target: App or CustomizedSnippet instance
        :param target_type: Target type string ("app" or "snippet")
        :return: Tuple of (xlsx_content_bytes, filename)
        :raises ValueError: If target type is not supported or app mode is excluded
        """
        # Validate target type
        if target_type == "app":
            if not isinstance(target, App):
                raise ValueError("Invalid target: expected App instance")
            if AppMode.value_of(target.mode) in cls.EXCLUDED_APP_MODES:
                raise ValueError(f"App mode '{target.mode}' does not support evaluation templates")
            input_fields = cls._get_app_input_fields(target)
        elif target_type == "snippet":
            if not isinstance(target, CustomizedSnippet):
                raise ValueError("Invalid target: expected CustomizedSnippet instance")
            input_fields = cls._get_snippet_input_fields(target)
        else:
            raise ValueError(f"Unsupported target type: {target_type}")

        # Generate XLSX template
        xlsx_content = cls._generate_xlsx_template(input_fields, target.name)

        # Build filename
        truncated_name = target.name[:10] + "..." if len(target.name) > 10 else target.name
        filename = f"{truncated_name}-evaluation-dataset.xlsx"

        return xlsx_content, filename

    @classmethod
    def _get_app_input_fields(cls, app: App) -> list[dict]:
        """
        Get input fields from App's workflow.

        :param app: App instance
        :return: List of input field definitions
        """
        workflow_service = WorkflowService()
        workflow = workflow_service.get_published_workflow(app_model=app)
        if not workflow:
            workflow = workflow_service.get_draft_workflow(app_model=app)

        if not workflow:
            return []

        # Get user input form from workflow
        user_input_form = workflow.user_input_form()
        return user_input_form

    @classmethod
    def _get_snippet_input_fields(cls, snippet: CustomizedSnippet) -> list[dict]:
        """
        Get input fields from Snippet.

        Tries to get from snippet's own input_fields first,
        then falls back to workflow's user_input_form.

        :param snippet: CustomizedSnippet instance
        :return: List of input field definitions
        """
        # Try snippet's own input_fields first
        input_fields = snippet.input_fields_list
        if input_fields:
            return input_fields

        # Fallback to workflow's user_input_form
        snippet_service = SnippetService()
        workflow = snippet_service.get_published_workflow(snippet=snippet)
        if not workflow:
            workflow = snippet_service.get_draft_workflow(snippet=snippet)

        if workflow:
            return workflow.user_input_form()

        return []

    @classmethod
    def _generate_xlsx_template(cls, input_fields: list[dict], target_name: str) -> bytes:
        """
        Generate XLSX template file content.

        Creates a workbook with:
        - First row as header row with "index" and input field names
        - Styled header with background color and borders
        - Empty data rows ready for user input

        :param input_fields: List of input field definitions
        :param target_name: Name of the target (for sheet name)
        :return: XLSX file content as bytes
        """
        wb = Workbook()
        ws = wb.active

        sheet_name = "Evaluation Dataset"
        ws.title = sheet_name

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        )

        # Build header row
        headers = ["index"]

        for field in input_fields:
            field_label = field.get("label") or field.get("variable")
            headers.append(field_label)

        # Write header row
        for col_idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border

        # Set column widths
        ws.column_dimensions["A"].width = 10  # index column
        for col_idx in range(2, len(headers) + 1):
            ws.column_dimensions[get_column_letter(col_idx)].width = 20

        # Add one empty row with row number for user reference
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=2, column=col_idx, value="")
            cell.border = thin_border
            if col_idx == 1:
                cell.value = 1
                cell.alignment = Alignment(horizontal="center")

        # Save to bytes
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        return output.getvalue()

    # ---- Evaluation Configuration CRUD ----

    @classmethod
    def get_evaluation_config(
        cls,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
    ) -> EvaluationConfiguration | None:
        return (
            session.query(EvaluationConfiguration)
            .filter_by(tenant_id=tenant_id, target_type=target_type, target_id=target_id)
            .first()
        )

    @classmethod
    def save_evaluation_config(
        cls,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        account_id: str,
        data: dict[str, Any],
    ) -> EvaluationConfiguration:
        config = cls.get_evaluation_config(session, tenant_id, target_type, target_id)
        if config is None:
            config = EvaluationConfiguration(
                tenant_id=tenant_id,
                target_type=target_type,
                target_id=target_id,
                created_by=account_id,
                updated_by=account_id,
            )
            session.add(config)

        config.evaluation_model_provider = data.get("evaluation_model_provider")
        config.evaluation_model = data.get("evaluation_model")
        config.metrics_config = json.dumps(data.get("metrics_config", {}))
        config.judgement_conditions = json.dumps(data.get("judgement_conditions", {}))
        config.updated_by = account_id
        session.commit()
        session.refresh(config)
        return config

    # ---- Evaluation Run Management ----

    @classmethod
    def start_evaluation_run(
        cls,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        account_id: str,
        dataset_file_content: bytes,
        evaluation_category: EvaluationCategory,
    ) -> EvaluationRun:
        """Validate dataset, create run record, dispatch Celery task."""
        # Check framework is configured
        evaluation_instance = EvaluationManager.get_evaluation_instance()
        if evaluation_instance is None:
            raise EvaluationFrameworkNotConfiguredError()

        # Check evaluation config exists
        config = cls.get_evaluation_config(session, tenant_id, target_type, target_id)
        if config is None:
            raise EvaluationNotFoundError("Evaluation configuration not found. Please configure evaluation first.")

        # Check concurrent run limit
        active_runs = (
            session.query(EvaluationRun)
            .filter_by(tenant_id=tenant_id)
            .filter(EvaluationRun.status.in_([EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING]))
            .count()
        )
        max_concurrent = dify_config.EVALUATION_MAX_CONCURRENT_RUNS
        if active_runs >= max_concurrent:
            raise EvaluationMaxConcurrentRunsError(
                f"Maximum concurrent runs ({max_concurrent}) reached."
            )

        # Parse dataset
        items = cls._parse_dataset(dataset_file_content)
        max_rows = dify_config.EVALUATION_MAX_DATASET_ROWS
        if len(items) > max_rows:
            raise EvaluationDatasetInvalidError(f"Dataset has {len(items)} rows, max is {max_rows}.")

        # Create evaluation run
        evaluation_run = EvaluationRun(
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            evaluation_config_id=config.id,
            status=EvaluationRunStatus.PENDING,
            total_items=len(items),
            created_by=account_id,
        )
        session.add(evaluation_run)
        session.commit()
        session.refresh(evaluation_run)

        # Build Celery task data
        run_data = EvaluationRunData(
            evaluation_run_id=evaluation_run.id,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            evaluation_category=evaluation_category,
            evaluation_model_provider=config.evaluation_model_provider or "",
            evaluation_model=config.evaluation_model or "",
            metrics_config=config.metrics_config_dict,
            items=items,
        )

        # Dispatch Celery task
        from tasks.evaluation_task import run_evaluation

        task = run_evaluation.delay(run_data.model_dump())
        evaluation_run.celery_task_id = task.id
        session.commit()

        return evaluation_run

    @classmethod
    def get_evaluation_runs(
        cls,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[EvaluationRun], int]:
        """Query evaluation run history with pagination."""
        query = (
            session.query(EvaluationRun)
            .filter_by(tenant_id=tenant_id, target_type=target_type, target_id=target_id)
            .order_by(EvaluationRun.created_at.desc())
        )
        total = query.count()
        runs = query.offset((page - 1) * page_size).limit(page_size).all()
        return runs, total

    @classmethod
    def get_evaluation_run_detail(
        cls,
        session: Session,
        tenant_id: str,
        run_id: str,
    ) -> EvaluationRun:
        run = (
            session.query(EvaluationRun)
            .filter_by(id=run_id, tenant_id=tenant_id)
            .first()
        )
        if not run:
            raise EvaluationNotFoundError("Evaluation run not found.")
        return run

    @classmethod
    def get_evaluation_run_items(
        cls,
        session: Session,
        run_id: str,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[EvaluationRunItem], int]:
        """Query evaluation run items with pagination."""
        query = (
            session.query(EvaluationRunItem)
            .filter_by(evaluation_run_id=run_id)
            .order_by(EvaluationRunItem.item_index.asc())
        )
        total = query.count()
        items = query.offset((page - 1) * page_size).limit(page_size).all()
        return items, total

    @classmethod
    def cancel_evaluation_run(
        cls,
        session: Session,
        tenant_id: str,
        run_id: str,
    ) -> EvaluationRun:
        run = cls.get_evaluation_run_detail(session, tenant_id, run_id)
        if run.status not in (EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING):
            raise ValueError(f"Cannot cancel evaluation run in status: {run.status}")

        run.status = EvaluationRunStatus.CANCELLED

        # Revoke Celery task if running
        if run.celery_task_id:
            try:
                from celery import current_app as celery_app

                celery_app.control.revoke(run.celery_task_id, terminate=True)
            except Exception:
                logger.exception("Failed to revoke Celery task %s", run.celery_task_id)

        session.commit()
        return run

    @classmethod
    def get_supported_metrics(cls, category: EvaluationCategory) -> list[str]:
        return EvaluationManager.get_supported_metrics(category)

    # ---- Dataset Parsing ----

    @classmethod
    def _parse_dataset(cls, xlsx_content: bytes) -> list[EvaluationItemInput]:
        """Parse evaluation dataset from XLSX bytes."""
        wb = load_workbook(io.BytesIO(xlsx_content), read_only=True)
        ws = wb.active
        if ws is None:
            raise EvaluationDatasetInvalidError("XLSX file has no active worksheet.")

        rows = list(ws.iter_rows(values_only=True))
        if len(rows) < 2:
            raise EvaluationDatasetInvalidError("Dataset must have at least a header row and one data row.")

        headers = [str(h).strip() if h is not None else "" for h in rows[0]]
        if not headers or headers[0].lower() != "index":
            raise EvaluationDatasetInvalidError("First column header must be 'index'.")

        input_headers = headers[1:]  # Skip 'index'
        items = []
        for row_idx, row in enumerate(rows[1:], start=1):
            values = list(row)
            if all(v is None or str(v).strip() == "" for v in values):
                continue  # Skip empty rows

            index_val = values[0] if values else row_idx
            try:
                index = int(index_val)
            except (TypeError, ValueError):
                index = row_idx

            inputs: dict[str, Any] = {}
            for col_idx, header in enumerate(input_headers):
                val = values[col_idx + 1] if col_idx + 1 < len(values) else None
                inputs[header] = str(val) if val is not None else ""

            # Check for expected_output column
            expected_output = inputs.pop("expected_output", None)
            context_str = inputs.pop("context", None)
            context = context_str.split(";") if context_str else None

            items.append(
                EvaluationItemInput(
                    index=index,
                    inputs=inputs,
                    expected_output=expected_output,
                    context=context,
                )
            )

        wb.close()
        return items
