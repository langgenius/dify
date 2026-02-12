import io
import logging
from typing import Union

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from models.model import App, AppMode
from models.snippet import CustomizedSnippet
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
