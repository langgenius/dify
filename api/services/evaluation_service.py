import csv
import io
import json
import logging
import math
import uuid
from collections.abc import Callable, Mapping, Sequence
from decimal import Decimal, InvalidOperation
from typing import Any, TypedDict, Union, cast

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from core.evaluation.agent.customized_workflow_adapter import (
    AGENT_CUSTOM_EVALUATOR_DATASET_COLUMNS,
    AGENT_CUSTOM_EVALUATOR_NODE_ID,
    AGENT_CUSTOM_EVALUATOR_OUTPUT_TYPES,
)
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    METRIC_NODE_TYPE_MAPPING,
    METRIC_VALUE_TYPE_MAPPING,
    NATIVE_AGENT_METRIC_NAMES,
    AgentToolCall,
    CustomizedMetrics,
    DefaultMetric,
    EvaluationCategory,
    EvaluationConfigData,
    EvaluationDatasetInput,
    EvaluationRunData,
    EvaluationRunRequest,
    EvaluationRunSnapshot,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentConfig
from core.evaluation.evaluation_manager import EvaluationManager
from core.evaluation.exceptions import EvaluationWorkflowVersionNotFoundError
from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from libs.datetime_utils import naive_utc_now
from models.account import Tenant
from models.agent import Agent
from models.dataset import Dataset
from models.evaluation import (
    EvaluationConfiguration,
    EvaluationRun,
    EvaluationRunItem,
    EvaluationRunItemStatus,
    EvaluationRunStatus,
    EvaluationTargetType,
)
from models.model import App, AppMode, UploadFile
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.agent.evaluation_target_service import AgentEvaluationTargetService
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.snippet_service import SnippetService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


class EvaluationTemplateColumn(TypedDict):
    name: str
    type: str


class EvaluationService:
    """
    Service for evaluation-related operations.

    Provides functionality to generate evaluation dataset templates
    based on App or Snippet input parameters.
    """

    ALLOWED_APP_MODES = {AppMode.WORKFLOW}
    CONSOLE_DISABLED_CATEGORIES: set[str] = set()
    SUPPORTED_NODE_TYPES = {"llm", "knowledge-retrieval", "knowledge_retrieval", "agent"}
    # Retain legacy Agent metric execution for saved runs and API compatibility,
    # but do not offer those metrics in console selectors or templates.
    CONSOLE_DISABLED_METRICS = {
        "tool_correctness",
        "argument_correctness",
        "tool_call_accuracy",
    }
    STRING_DATASET_INPUT_TYPES = {"", "string", "text", "text-input", "paragraph", "select"}
    NUMBER_DATASET_INPUT_TYPES = {"number", "integer", "float", "int"}
    BOOLEAN_DATASET_INPUT_TYPES = {"boolean", "bool", "checkbox", "switch"}
    TRUE_DATASET_VALUES = {"true", "1", "yes", "y", "on"}
    FALSE_DATASET_VALUES = {"false", "0", "no", "n", "off"}

    @classmethod
    def generate_dataset_template(
        cls,
        target: Union[App, CustomizedSnippet, Agent],
        target_type: str,
        data: EvaluationConfigData,
        session: Session,
    ) -> tuple[bytes, str]:
        """
        Generate evaluation dataset template as XLSX bytes.

        Creates an XLSX file with headers based on the evaluation target's input parameters
        and the selected evaluation metrics.

        :param target: App, CustomizedSnippet, or Agent instance
        :param target_type: Target type string ("apps", "snippets", or "agents")
        :param data: Evaluation configuration used to determine reference columns
        :param session: Database session used to resolve target inputs
        :return: Tuple of (xlsx_content_bytes, filename)
        :raises ValueError: If target type is not supported or app mode is excluded
        """
        columns = cls.get_dataset_column_names(target, target_type, data, session)
        xlsx_content = cls._generate_xlsx_template(columns, target.name)

        # Build filename
        truncated_name = target.name[:10] + "..." if len(target.name) > 10 else target.name
        filename = f"{truncated_name}-evaluation-dataset.xlsx"

        return xlsx_content, filename

    @classmethod
    def _get_app_input_fields(cls, app: App, session: Session) -> list[dict]:
        """
        Get input fields from App's workflow.

        :param app: App instance
        :return: List of input field definitions
        """
        cls._validate_app_mode(app)
        workflow_service = WorkflowService()
        workflow = workflow_service.get_published_workflow(app_model=app, session=session)
        if not workflow:
            workflow = workflow_service.get_draft_workflow(app_model=app, session=session)

        if not workflow:
            return []

        # Get user input form from workflow
        user_input_form = workflow.user_input_form()
        return user_input_form

    @classmethod
    def _get_snippet_input_fields(cls, snippet: CustomizedSnippet, session: Session) -> list[dict]:
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
        snippet_service = SnippetService(session=session)
        workflow = snippet_service.get_published_workflow(snippet=snippet)
        if not workflow:
            workflow = snippet_service.get_draft_workflow(snippet=snippet)

        if workflow:
            return workflow.user_input_form()

        return []

    @classmethod
    def _generate_xlsx_template(
        cls,
        columns: Sequence[EvaluationTemplateColumn],
        target_name: str,
    ) -> bytes:
        """
        Generate XLSX template file content.

        Creates a workbook with:
        - First row as header row with the provided template column names
        - Styled header with background color and borders
        - Empty data rows ready for user input

        :param columns: Ordered template column definitions
        :param target_name: Name of the target (for sheet name)
        :return: XLSX file content as bytes
        """
        wb = Workbook()
        ws = wb.active
        if ws is None:
            ws = wb.create_sheet("Evaluation Dataset")

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

        headers = [column["name"] for column in columns]

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

    @classmethod
    def generate_retrieval_dataset_template(cls) -> tuple[bytes, str]:
        """Generate evaluation dataset XLSX template for knowledge base retrieval.

        The template contains three columns: ``index``, ``query``, and
        ``expected_output``.  Callers upload a filled copy and start an
        evaluation run with ``target_type="knowledge_base"``.

        :returns: (xlsx_content_bytes, filename)
        """
        wb = Workbook()
        ws = wb.active
        if ws is None:
            ws = wb.create_sheet("Evaluation Dataset")
        ws.title = "Evaluation Dataset"

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        )

        headers = ["index", "query", "expected_output"]
        for col_idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border

        ws.column_dimensions["A"].width = 10
        ws.column_dimensions["B"].width = 30
        ws.column_dimensions["C"].width = 30

        # Add one sample row
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=2, column=col_idx, value="")
            cell.border = thin_border
            if col_idx == 1:
                cell.value = 1
                cell.alignment = Alignment(horizontal="center")

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output.getvalue(), "retrieval-evaluation-dataset.xlsx"

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
        data: EvaluationConfigData,
        target_workflow: Workflow | None = None,
        validation_data: EvaluationConfigData | None = None,
    ) -> EvaluationConfiguration:
        cls.validate_evaluation_config(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            data=validation_data or data,
            target_workflow=target_workflow,
        )
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

        config.evaluation_model_provider = data.evaluation_model_provider
        config.evaluation_model = data.evaluation_model
        config.metrics_config = json.dumps(
            {
                "default_metrics": [m.model_dump() for m in data.default_metrics],
                "customized_metrics": data.customized_metrics.model_dump() if data.customized_metrics else None,
            }
        )
        config.judgment_conditions = json.dumps(data.judgment_config.model_dump() if data.judgment_config else {})
        config.evaluator_app_id = data.customized_metrics.evaluation_workflow_id if data.customized_metrics else None
        config.updated_by = account_id
        session.flush()
        return config

    @classmethod
    def list_targets_by_customized_workflow(
        cls,
        session: Session,
        tenant_id: str,
        customized_workflow_id: str,
    ) -> list[EvaluationConfiguration]:
        """Return all evaluation configs that reference the given workflow as customized metrics."""
        from sqlalchemy import select

        return list(
            session.scalars(
                select(EvaluationConfiguration).where(
                    EvaluationConfiguration.tenant_id == tenant_id,
                    EvaluationConfiguration.evaluator_app_id == customized_workflow_id,
                )
            ).all()
        )

    @classmethod
    def resolve_run_request_config(
        cls,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        run_request: EvaluationRunRequest,
    ) -> EvaluationRunRequest:
        """Hydrate an empty run request from the latest saved evaluation config.

        Console callers may submit only ``file_id`` when they want to reuse the
        previously saved evaluation settings. We only hydrate the request when
        *all* config fields are absent so partially specified payloads remain
        exactly as submitted by the caller.
        """
        if cls._has_inline_run_config(run_request):
            return run_request

        config = cls.get_evaluation_config(session, tenant_id, target_type, target_id)
        if config is None:
            raise EvaluationNotFoundError("Evaluation configuration not found. Save evaluation settings first.")

        return EvaluationRunRequest(
            file_id=run_request.file_id,
            evaluation_model=config.evaluation_model or "",
            evaluation_model_provider=config.evaluation_model_provider or "",
            default_metrics=[DefaultMetric.model_validate(metric) for metric in config.default_metrics_list],
            customized_metrics=(
                CustomizedMetrics.model_validate(config.customized_metrics_dict)
                if config.customized_metrics_dict
                else None
            ),
            judgment_config=(
                JudgmentConfig.model_validate(config.judgment_config_dict) if config.judgment_config_dict else None
            ),
        )

    @staticmethod
    def _has_inline_run_config(run_request: EvaluationRunRequest) -> bool:
        """Return True when the request body already includes evaluation settings."""
        return bool(
            run_request.evaluation_model.strip()
            or run_request.evaluation_model_provider.strip()
            or run_request.default_metrics
            or run_request.customized_metrics is not None
            or run_request.judgment_config is not None
        )

    @classmethod
    def validate_evaluation_config(
        cls,
        *,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        data: EvaluationConfigData,
        target_workflow: Workflow | None = None,
    ) -> None:
        """Validate supported metrics, target-specific metric scopes, and the optional custom evaluator."""
        normalized_target_type = EvaluationTargetType(target_type)
        if not data.default_metrics and data.customized_metrics is None:
            raise ValueError("At least one default or customized metric is required.")
        if data.default_metrics and (not data.evaluation_model_provider or not data.evaluation_model):
            raise ValueError("evaluation_model_provider and evaluation_model are required for default metrics.")
        if data.default_metrics:
            evaluation_instance = EvaluationManager.get_evaluation_instance()
            if evaluation_instance is None:
                raise EvaluationFrameworkNotConfiguredError()
            cls._validate_evaluation_model(
                tenant_id=tenant_id,
                provider=data.evaluation_model_provider,
                model_name=data.evaluation_model,
            )
            if any(evaluation_instance.metric_requires_embeddings(metric.metric) for metric in data.default_metrics):
                cls._validate_default_embedding_model(tenant_id=tenant_id)
        else:
            evaluation_instance = None

        published_nodes: dict[str, Mapping[str, Any]] = {}
        if normalized_target_type == EvaluationTargetType.KNOWLEDGE_BASE:
            dataset = session.scalar(
                select(Dataset).where(
                    Dataset.id == target_id,
                    Dataset.tenant_id == tenant_id,
                )
            )
            if dataset is None:
                raise ValueError("Evaluation target not found.")
            if dataset.provider == "external":
                raise ValueError("External knowledge bases are not supported by evaluation.")
        elif normalized_target_type == EvaluationTargetType.AGENTS:
            target_agent = AgentEvaluationTargetService.resolve_active_snapshot(
                session=session,
                tenant_id=tenant_id,
                agent_id=target_id,
            )
            published_nodes[target_id] = {"type": "agent", "title": target_agent.agent_name}
        else:
            target: App | CustomizedSnippet | None
            if normalized_target_type == EvaluationTargetType.APPS:
                target = session.scalar(
                    select(App).where(
                        App.id == target_id,
                        App.tenant_id == tenant_id,
                        App.status == "normal",
                    )
                )
            else:
                target = session.scalar(
                    select(CustomizedSnippet).where(
                        CustomizedSnippet.id == target_id,
                        CustomizedSnippet.tenant_id == tenant_id,
                    )
                )
            if target is None:
                raise ValueError("Evaluation target not found.")
            if normalized_target_type == EvaluationTargetType.APPS:
                cls._validate_app_mode(cast(App, target))
            published_workflow = target_workflow or cls._resolve_published_workflow(
                target, normalized_target_type.value, session
            )
            if published_workflow is None:
                raise ValueError("The evaluation target must have a published workflow.")
            target_input_fields = (
                target.input_fields_list
                if isinstance(target, CustomizedSnippet) and target.input_fields_list
                else published_workflow.user_input_form()
                if hasattr(published_workflow, "user_input_form")
                else []
            )
            cls._dataset_input_types([field for field in target_input_fields if isinstance(field, Mapping)])
            published_nodes = dict(published_workflow.walk_nodes())

        for metric in data.default_metrics:
            if normalized_target_type == EvaluationTargetType.KNOWLEDGE_BASE:
                if metric.node_info_list:
                    raise ValueError(
                        f"Knowledge base metric '{metric.metric}' is target-scoped and must not select workflow nodes."
                    )
                categories = {EvaluationCategory.RETRIEVAL}
            elif normalized_target_type == EvaluationTargetType.AGENTS:
                if metric.metric not in {name.value for name in NATIVE_AGENT_METRIC_NAMES}:
                    raise ValueError(f"Metric '{metric.metric}' is not supported for Agent V2 evaluation.")
                if len(metric.node_info_list) != 1:
                    raise ValueError(f"Agent metric '{metric.metric}' must select the target Agent.")
                node = metric.node_info_list[0]
                if node.node_id != target_id or node.type != "agent":
                    raise ValueError(f"Agent metric '{metric.metric}' must select the target Agent.")
                categories = {EvaluationCategory.AGENT}
            else:
                if not metric.node_info_list:
                    raise ValueError(f"Metric '{metric.metric}' must select at least one node.")
                for node in metric.node_info_list:
                    published_node = published_nodes.get(node.node_id)
                    if published_node is None:
                        raise ValueError(f"Node '{node.node_id}' is not in the published target workflow.")
                    if is_dify_agent_node_data(published_node) and metric.metric not in {
                        name.value for name in NATIVE_AGENT_METRIC_NAMES
                    }:
                        raise ValueError(
                            f"Metric '{metric.metric}' is not supported for Agent V2 node '{node.node_id}'."
                        )
                    published_type = str(published_node.get("type", ""))
                    if cls.category_for_node_type(published_type) != cls.category_for_node_type(node.type):
                        raise ValueError(f"Node '{node.node_id}' type does not match the published workflow.")
                categories = {cls.category_for_node_type(node.type) for node in metric.node_info_list}

            for category in categories:
                supported_metrics = set(cls.get_supported_metrics(category))
                if metric.metric not in supported_metrics:
                    raise ValueError(f"Metric '{metric.metric}' is not supported for category '{category.value}'.")

        customized_metrics = data.customized_metrics
        if customized_metrics is not None:
            if normalized_target_type == EvaluationTargetType.KNOWLEDGE_BASE:
                raise ValueError("Customized evaluation workflows are not supported for knowledge bases.")
            output_variables = [field.variable for field in customized_metrics.output_fields]
            if not output_variables:
                raise ValueError("Customized metrics must select at least one evaluation workflow output.")
            if len(output_variables) != len(set(output_variables)):
                raise ValueError("Customized metric output variables must be unique.")
            evaluator_app = session.scalar(
                select(App).where(
                    App.id == customized_metrics.evaluation_workflow_id,
                    App.tenant_id == tenant_id,
                    App.status == "normal",
                )
            )
            if evaluator_app is None:
                raise ValueError("Evaluation workflow app not found.")
            workflow_service = WorkflowService()
            evaluator_workflow = (
                workflow_service.get_published_workflow_by_id(
                    app_model=evaluator_app,
                    workflow_id=customized_metrics.evaluation_workflow_version_id,
                    session=session,
                )
                if customized_metrics.evaluation_workflow_version_id
                else workflow_service.get_published_workflow(app_model=evaluator_app, session=session)
            )
            if (
                evaluator_workflow is None
                or evaluator_workflow.type != WorkflowType.WORKFLOW
                or evaluator_workflow.resolved_kind != WorkflowKind.EVALUATION
            ):
                raise ValueError("The customized evaluator must be a published evaluation workflow.")
            available_output_variables = {
                output.get("variable")
                for _, node_data in evaluator_workflow.walk_nodes()
                if node_data.get("type") == "end"
                for output in (node_data.get("outputs") or [])
                if isinstance(output, Mapping) and isinstance(output.get("variable"), str)
            }
            missing_output_variables = sorted(set(output_variables) - available_output_variables)
            if missing_output_variables:
                raise ValueError(
                    "Customized metric outputs are not declared by the published evaluation workflow: "
                    + ", ".join(missing_output_variables)
                )
            cls._validate_customized_inputs(
                customized_metrics=customized_metrics,
                evaluator_workflow=evaluator_workflow,
                published_node_ids=(
                    {AGENT_CUSTOM_EVALUATOR_NODE_ID}
                    if normalized_target_type == EvaluationTargetType.AGENTS
                    else set(published_nodes)
                ),
                allowed_output_fields_by_node=(
                    {AGENT_CUSTOM_EVALUATOR_NODE_ID: set(AGENT_CUSTOM_EVALUATOR_OUTPUT_TYPES)}
                    if normalized_target_type == EvaluationTargetType.AGENTS
                    else None
                ),
            )

        cls._validate_judgment_config(
            data,
            target_type=normalized_target_type,
            target_id=target_id,
        )

    @classmethod
    def _validate_app_mode(cls, app: App) -> None:
        app_mode = AppMode.value_of(app.mode)
        if app_mode not in cls.ALLOWED_APP_MODES:
            raise ValueError("Only workflow apps support evaluation.")

    @staticmethod
    def _validate_evaluation_model(*, tenant_id: str, provider: str, model_name: str) -> None:
        """Resolve the configured judge model now so invalid runs fail admission."""
        try:
            from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly
            from graphon.model_runtime.entities.model_entities import ModelType

            assembly = create_plugin_model_assembly(tenant_id=tenant_id)
            assembly.model_manager.get_model_instance(
                tenant_id=tenant_id,
                provider=provider,
                model_type=ModelType.LLM,
                model=model_name,
            )
            configurations = assembly.provider_manager.get_configurations(tenant_id)
            configured_models = configurations.get_models(provider=provider, model_type=ModelType.LLM)
            target_model = next(
                (
                    model
                    for model in configured_models
                    if model.model == model_name and model.provider.provider == provider
                ),
                None,
            )
            if target_model is None:
                raise ValueError(f"Model {model_name} not found for provider {provider}")
            target_model.raise_for_status()
        except Exception as exc:
            raise ValueError(
                f"Failed to validate evaluation model (provider: {provider}, model: {model_name}): {exc}"
            ) from exc

    @staticmethod
    def _validate_default_embedding_model(*, tenant_id: str) -> None:
        """Ensure embedding-backed RAGAS metrics can use the tenant default model."""
        try:
            from core.model_manager import ModelManager
            from graphon.model_runtime.entities.model_entities import ModelType

            ModelManager.for_tenant(tenant_id=tenant_id).get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.TEXT_EMBEDDING,
            )
        except Exception as exc:
            raise ValueError(f"Failed to validate the default text embedding model: {exc}") from exc

    @staticmethod
    def _validate_customized_inputs(
        *,
        customized_metrics: CustomizedMetrics,
        evaluator_workflow: Workflow,
        published_node_ids: set[str],
        allowed_output_fields_by_node: Mapping[str, set[str]] | None = None,
    ) -> None:
        input_definitions = [field for field in evaluator_workflow.user_input_form() if isinstance(field, Mapping)]
        declared_inputs = {
            str(field.get("variable") or field.get("name"))
            for field in input_definitions
            if field.get("variable") or field.get("name")
        }
        configured_inputs = set(customized_metrics.input_fields)
        unknown_inputs = sorted(configured_inputs - declared_inputs)
        if unknown_inputs:
            raise ValueError(
                "Customized metric inputs are not declared by the evaluation workflow: " + ", ".join(unknown_inputs)
            )
        required_inputs = {
            str(field.get("variable") or field.get("name"))
            for field in input_definitions
            if field.get("required") and (field.get("variable") or field.get("name"))
        }
        missing_inputs = sorted(required_inputs - configured_inputs)
        if missing_inputs:
            raise ValueError("Customized evaluator required inputs are not mapped: " + ", ".join(missing_inputs))

        for field_name, value_source in customized_metrics.input_fields.items():
            if not isinstance(value_source, str):
                continue
            selectors = VariableTemplateParser(value_source).extract_variable_selectors()
            if "{{#" in value_source and not selectors:
                raise ValueError(f"Customized metric input '{field_name}' contains an invalid variable selector.")
            for selector in selectors:
                node_id = selector.value_selector[0]
                if node_id not in published_node_ids:
                    raise ValueError(
                        f"Customized metric selector node '{node_id}' is not in the published target workflow."
                    )
                allowed_output_fields = (allowed_output_fields_by_node or {}).get(node_id)
                if allowed_output_fields is not None and (
                    len(selector.value_selector) != 2 or selector.value_selector[1] not in allowed_output_fields
                ):
                    allowed_fields = ", ".join(sorted(allowed_output_fields))
                    raise ValueError(
                        f"Customized metric selector for Agent '{node_id}' must use one of: {allowed_fields}."
                    )

    @staticmethod
    def _validate_judgment_config(
        data: EvaluationConfigData,
        *,
        target_type: EvaluationTargetType,
        target_id: str,
    ) -> None:
        if data.judgment_config is None:
            return
        if target_type == EvaluationTargetType.KNOWLEDGE_BASE:
            available_selectors = {(target_id, metric.metric) for metric in data.default_metrics}
        else:
            available_selectors = {
                (node.node_id, metric.metric) for metric in data.default_metrics for node in metric.node_info_list
            }
            if data.customized_metrics is not None:
                available_selectors.update(
                    (data.customized_metrics.evaluation_workflow_id, output.variable)
                    for output in data.customized_metrics.output_fields
                )
        for condition in data.judgment_config.conditions:
            if len(condition.variable_selector) < 2:
                raise ValueError("Judgment selector must contain node ID and metric name.")
            selector = (condition.variable_selector[0], condition.variable_selector[1])
            if selector not in available_selectors:
                raise ValueError(f"Judgment selector '{selector[0]}.{selector[1]}' is not configured for evaluation.")

    @staticmethod
    def category_for_node_type(node_type: str) -> EvaluationCategory:
        """Map graph node types explicitly instead of relying on enum string equality."""
        mapping = {
            "llm": EvaluationCategory.LLM,
            "knowledge-retrieval": EvaluationCategory.RETRIEVAL,
            "knowledge_retrieval": EvaluationCategory.RETRIEVAL,
            "agent": EvaluationCategory.AGENT,
        }
        try:
            return mapping[node_type]
        except KeyError as exc:
            raise ValueError(f"Evaluation does not support node type '{node_type}'.") from exc

    @classmethod
    def _pin_customized_evaluator(
        cls,
        *,
        session: Session,
        tenant_id: str,
        run_request: EvaluationRunRequest,
    ) -> EvaluationRunRequest:
        customized_metrics = run_request.customized_metrics
        if customized_metrics is None:
            return run_request
        app = session.scalar(
            select(App).where(
                App.id == customized_metrics.evaluation_workflow_id,
                App.tenant_id == tenant_id,
                App.status == "normal",
            )
        )
        if app is None:
            raise ValueError("Evaluation workflow app not found.")
        workflow = WorkflowService().get_published_workflow(app_model=app, session=session)
        if (
            workflow is None
            or workflow.type != WorkflowType.WORKFLOW
            or workflow.resolved_kind != WorkflowKind.EVALUATION
        ):
            raise ValueError("The customized evaluator must be a published evaluation workflow.")
        pinned_metrics = customized_metrics.model_copy(update={"evaluation_workflow_version_id": workflow.id})
        return run_request.model_copy(update={"customized_metrics": pinned_metrics})

    @classmethod
    def _pin_target_workflow(
        cls,
        *,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
    ) -> tuple[str | None, Workflow | None, list[Mapping[str, Any]]]:
        """Resolve the target's immutable workflow and dataset input schema."""
        normalized_target_type = EvaluationTargetType(target_type)
        if normalized_target_type == EvaluationTargetType.KNOWLEDGE_BASE:
            return None, None, [{"variable": "query", "type": "string"}]

        target: App | CustomizedSnippet | None
        if normalized_target_type == EvaluationTargetType.APPS:
            target = session.scalar(
                select(App).where(
                    App.id == target_id,
                    App.tenant_id == tenant_id,
                    App.status == "normal",
                )
            )
            if target is not None:
                cls._validate_app_mode(target)
        else:
            target = session.scalar(
                select(CustomizedSnippet).where(
                    CustomizedSnippet.id == target_id,
                    CustomizedSnippet.tenant_id == tenant_id,
                )
            )
        if target is None:
            raise ValueError("Evaluation target not found.")

        workflow = cls._resolve_published_workflow(target, normalized_target_type.value, session)
        if workflow is None:
            raise ValueError("The evaluation target must have a published workflow.")
        if isinstance(target, CustomizedSnippet) and target.input_fields_list:
            input_fields = target.input_fields_list
        else:
            input_fields = workflow.user_input_form() if hasattr(workflow, "user_input_form") else []
        return workflow.id, workflow, [field for field in input_fields if isinstance(field, Mapping)]

    @staticmethod
    def _pin_target_agent(
        *,
        session: Session,
        tenant_id: str,
        target_id: str,
    ) -> tuple[str, list[Mapping[str, Any]]]:
        """Resolve the immutable published Agent configuration used by a run."""
        target = AgentEvaluationTargetService.resolve_active_snapshot(
            session=session,
            tenant_id=tenant_id,
            agent_id=target_id,
        )
        return target.config_snapshot_id, [{"variable": "query", "type": "string"}]

    @staticmethod
    def _extract_llm_context_node_mapping(workflow: Workflow | None) -> dict[str, list[str]]:
        """Capture retrieval sources explicitly configured as each LLM node's context."""
        if workflow is None:
            return {}
        mapping: dict[str, list[str]] = {}
        for node_id, node_data in workflow.walk_nodes():
            if node_data.get("type") != "llm":
                continue
            context_config = node_data.get("context")
            if not isinstance(context_config, Mapping) or not context_config.get("enabled"):
                continue
            selector = context_config.get("variable_selector")
            if isinstance(selector, list) and selector and isinstance(selector[0], str):
                mapping[node_id] = [selector[0]]
        return mapping

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
        dataset_filename: str,
        run_request: EvaluationRunRequest,
    ) -> EvaluationRun:
        """Validate dataset, create run record, dispatch Celery task.

        Saves the effective parameters as the latest EvaluationConfiguration
        before creating the run. When the request body contains only ``file_id``,
        the latest saved evaluation config for the target is reused.
        """
        # Check framework is configured
        evaluation_framework = EvaluationManager.get_configured_framework()
        evaluation_instance = EvaluationManager.get_evaluation_instance(evaluation_framework)
        if evaluation_instance is None:
            raise EvaluationFrameworkNotConfiguredError()

        resolved_run_request = cls.resolve_run_request_config(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            run_request=run_request,
        )
        pinned_run_request = cls._pin_customized_evaluator(
            session=session,
            tenant_id=tenant_id,
            run_request=resolved_run_request,
        )
        target_agent_config_snapshot_id: str | None = None
        if target_type == EvaluationTargetType.AGENTS.value:
            target_agent_config_snapshot_id, target_input_fields = cls._pin_target_agent(
                session=session,
                tenant_id=tenant_id,
                target_id=target_id,
            )
            target_workflow_version_id = None
            target_workflow = None
        else:
            target_workflow_version_id, target_workflow, target_input_fields = cls._pin_target_workflow(
                session=session,
                tenant_id=tenant_id,
                target_type=target_type,
                target_id=target_id,
            )
        dataset_input_types = cls._dataset_input_types(target_input_fields)

        # Save the editable configuration without pinning it to today's published evaluator.
        config = cls.save_evaluation_config(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            account_id=account_id,
            data=resolved_run_request,
            target_workflow=target_workflow,
            validation_data=pinned_run_request,
        )

        # Parse dataset
        items = cls._parse_dataset(
            dataset_file_content,
            dataset_filename,
            input_types=dataset_input_types,
        )
        max_rows = dify_config.EVALUATION_MAX_DATASET_ROWS
        if len(items) > max_rows:
            raise EvaluationDatasetInvalidError(f"Dataset has {len(items)} rows, max is {max_rows}.")
        cls._validate_dataset_expected_outputs(
            items,
            resolved_run_request.default_metrics,
            evaluation_instance=evaluation_instance,
        )
        if target_type in {EvaluationTargetType.KNOWLEDGE_BASE.value, EvaluationTargetType.AGENTS.value}:
            missing_query_indices = [item.index for item in items if not str(item.inputs.get("query", "")).strip()]
            if missing_query_indices:
                raise EvaluationDatasetInvalidError(
                    f"{target_type} evaluation datasets require a non-empty 'query' value; "
                    f"invalid rows: {missing_query_indices[:10]}."
                )

        # Serialize admission for a tenant so the concurrent-run limit is authoritative.
        locked_tenant = session.scalar(select(Tenant.id).where(Tenant.id == tenant_id).with_for_update())
        if locked_tenant is None:
            raise ValueError("Tenant not found.")
        active_runs = (
            session.query(EvaluationRun)
            .filter_by(tenant_id=tenant_id)
            .filter(EvaluationRun.status.in_([EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING]))
            .count()
        )
        max_concurrent = dify_config.EVALUATION_MAX_CONCURRENT_RUNS
        if active_runs >= max_concurrent:
            raise EvaluationMaxConcurrentRunsError(f"Maximum concurrent runs ({max_concurrent}) reached.")

        celery_task_id = str(uuid.uuid4())
        run_snapshot = EvaluationRunSnapshot.model_validate(
            {
                **pinned_run_request.model_dump(mode="json"),
                "evaluation_framework": evaluation_framework,
                "dataset_input_types": dataset_input_types,
            }
        )
        evaluation_run = EvaluationRun(
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            target_workflow_version_id=target_workflow_version_id,
            target_agent_config_snapshot_id=target_agent_config_snapshot_id,
            evaluation_config_id=config.id,
            config_snapshot=run_snapshot.model_dump_json(),
            status=EvaluationRunStatus.PENDING,
            progress_rate=0.0,
            dataset_file_id=resolved_run_request.file_id,
            total_items=len(items),
            created_by=account_id,
            celery_task_id=celery_task_id,
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
            target_workflow_version_id=target_workflow_version_id,
            target_agent_config_snapshot_id=target_agent_config_snapshot_id,
            evaluation_framework=evaluation_framework,
            evaluation_model_provider=pinned_run_request.evaluation_model_provider,
            evaluation_model=pinned_run_request.evaluation_model,
            default_metrics=pinned_run_request.default_metrics,
            customized_metrics=pinned_run_request.customized_metrics,
            judgment_config=pinned_run_request.judgment_config,
            llm_context_node_mapping=cls._extract_llm_context_node_mapping(target_workflow),
            input_list=items,
        )

        # Dispatch Celery task
        from tasks.evaluation_task import run_evaluation

        try:
            run_evaluation.apply_async(
                args=(run_data.model_dump(mode="json"),),
                task_id=celery_task_id,
            )
        except Exception as exc:
            evaluation_run.status = EvaluationRunStatus.FAILED
            evaluation_run.error = f"Failed to dispatch evaluation task: {exc}"[:2000]
            evaluation_run.completed_at = naive_utc_now()
            session.commit()
            raise

        return evaluation_run

    @classmethod
    def retry_evaluation_run(
        cls,
        *,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        run_id: str,
        dataset_file_content: bytes,
        dataset_filename: str,
    ) -> EvaluationRun:
        """Redispatch a failed run while retaining its immutable snapshot and row checkpoints."""
        run = cls.get_evaluation_run_detail(session, tenant_id, target_type, target_id, run_id)
        if run.status != EvaluationRunStatus.FAILED:
            raise ValueError("Only failed evaluation runs can be retried.")

        run_snapshot = EvaluationRunSnapshot.model_validate(run.config_snapshot_dict)
        evaluation_instance = EvaluationManager.get_evaluation_instance(run_snapshot.evaluation_framework)
        if evaluation_instance is None:
            raise EvaluationFrameworkNotConfiguredError()
        run_request = EvaluationRunRequest.model_validate(
            run_snapshot.model_dump(exclude={"dataset_input_types", "evaluation_framework"})
        )
        pinned_workflow = cls._resolve_pinned_target_workflow_for_run(session=session, run=run)
        if run_snapshot.dataset_input_types:
            input_types = run_snapshot.dataset_input_types
        elif EvaluationTargetType(run.target_type) in {
            EvaluationTargetType.KNOWLEDGE_BASE,
            EvaluationTargetType.AGENTS,
        }:
            input_types = {"query": "string"}
        elif pinned_workflow is not None:
            input_types = cls._dataset_input_types(
                [field for field in pinned_workflow.user_input_form() if isinstance(field, Mapping)]
            )
        else:
            # The worker owns the terminal missing-version decision. Parsing as
            # strings here still lets the retry be recorded and fail consistently.
            input_types = {}

        items = cls._parse_dataset(
            dataset_file_content,
            dataset_filename,
            input_types=input_types,
        )
        if len(items) != run.total_items:
            raise EvaluationDatasetInvalidError("The persisted evaluation dataset no longer matches the run.")
        cls._validate_dataset_expected_outputs(
            items,
            run_request.default_metrics,
            evaluation_instance=evaluation_instance,
        )
        if target_type in {EvaluationTargetType.KNOWLEDGE_BASE.value, EvaluationTargetType.AGENTS.value}:
            missing_query_indices = [item.index for item in items if not str(item.inputs.get("query", "")).strip()]
            if missing_query_indices:
                raise EvaluationDatasetInvalidError(
                    f"{target_type} evaluation datasets require a non-empty 'query' value; "
                    f"invalid rows: {missing_query_indices[:10]}."
                )

        run_data = EvaluationRunData(
            evaluation_run_id=run.id,
            tenant_id=run.tenant_id,
            target_type=EvaluationTargetType(run.target_type).value,
            target_id=run.target_id,
            target_workflow_version_id=run.target_workflow_version_id,
            target_agent_config_snapshot_id=run.target_agent_config_snapshot_id,
            evaluation_framework=run_snapshot.evaluation_framework,
            evaluation_model_provider=run_request.evaluation_model_provider,
            evaluation_model=run_request.evaluation_model,
            default_metrics=run_request.default_metrics,
            customized_metrics=run_request.customized_metrics,
            judgment_config=run_request.judgment_config,
            llm_context_node_mapping=cls._extract_llm_context_node_mapping(pinned_workflow),
            input_list=items,
        )

        # End the read transaction before taking the same tenant admission lock
        # used by new runs. The run status is rechecked under a row lock below.
        session.rollback()
        locked_tenant = session.scalar(select(Tenant.id).where(Tenant.id == tenant_id).with_for_update())
        if locked_tenant is None:
            raise ValueError("Tenant not found.")
        active_runs = (
            session.query(EvaluationRun)
            .filter_by(tenant_id=tenant_id)
            .filter(EvaluationRun.status.in_([EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING]))
            .count()
        )
        max_concurrent = dify_config.EVALUATION_MAX_CONCURRENT_RUNS
        if active_runs >= max_concurrent:
            raise EvaluationMaxConcurrentRunsError(f"Maximum concurrent runs ({max_concurrent}) reached.")

        locked_run = session.scalar(
            select(EvaluationRun)
            .where(
                EvaluationRun.id == run_id,
                EvaluationRun.tenant_id == tenant_id,
                EvaluationRun.target_type == target_type,
                EvaluationRun.target_id == target_id,
            )
            .with_for_update()
        )
        if locked_run is None:
            raise EvaluationNotFoundError("Evaluation run not found.")
        if locked_run.status != EvaluationRunStatus.FAILED:
            raise ValueError("Only failed evaluation runs can be retried.")

        agent_checkpoints_to_reset: list[tuple[str | None, str | None]] = []
        agent_checkpoint_ids_to_reset: list[str] = []
        if target_type == EvaluationTargetType.AGENTS.value:
            running_agent_items = list(
                session.scalars(
                    select(EvaluationRunItem).where(
                        EvaluationRunItem.evaluation_run_id == locked_run.id,
                        EvaluationRunItem.status == EvaluationRunItemStatus.TARGET_RUNNING,
                    )
                ).all()
            )
            agent_checkpoints_to_reset = [
                (item.agent_backend_run_id, item.agent_workspace_binding_id) for item in running_agent_items
            ]
            agent_checkpoint_ids_to_reset = [item.id for item in running_agent_items]

        checkpoint_rows = session.execute(
            select(EvaluationRunItem.item_index, EvaluationRunItem.status, EvaluationRunItem.error).where(
                EvaluationRunItem.evaluation_run_id == locked_run.id
            )
        ).all()
        dataset_indices = {item.index for item in items}
        stale_checkpoint_indices = [
            item_index for item_index, _, _ in checkpoint_rows if item_index not in dataset_indices
        ]
        if stale_checkpoint_indices:
            raise EvaluationDatasetInvalidError(
                "The persisted evaluation dataset no longer matches the run checkpoints."
            )
        if agent_checkpoint_ids_to_reset:
            session.execute(delete(EvaluationRunItem).where(EvaluationRunItem.id.in_(agent_checkpoint_ids_to_reset)))
        completed_items = sum(
            1 for _, status, error in checkpoint_rows if status == EvaluationRunItemStatus.COMPLETED and error is None
        )
        failed_items = sum(
            1
            for _, status, error in checkpoint_rows
            if status == EvaluationRunItemStatus.COMPLETED and error is not None
        )
        checkpointed_items = completed_items + failed_items
        celery_task_id = str(uuid.uuid4())
        locked_run.status = EvaluationRunStatus.PENDING
        locked_run.celery_task_id = celery_task_id
        locked_run.execution_token = None
        locked_run.started_at = None
        locked_run.heartbeat_at = None
        locked_run.completed_at = None
        locked_run.completed_items = completed_items
        locked_run.failed_items = failed_items
        locked_run.progress_rate = (
            min(0.95, 0.05 + 0.9 * checkpointed_items / locked_run.total_items)
            if checkpointed_items and locked_run.total_items
            else 0.0
        )
        locked_run.metrics_summary = None
        locked_run.error = None
        session.commit()

        if agent_checkpoints_to_reset:
            cls._stop_agent_checkpoints(
                tenant_id=tenant_id,
                checkpoints=agent_checkpoints_to_reset,
            )

        from tasks.evaluation_task import run_evaluation

        try:
            run_evaluation.apply_async(
                args=(run_data.model_dump(mode="json"),),
                task_id=celery_task_id,
            )
        except Exception as exc:
            locked_run.status = EvaluationRunStatus.FAILED
            locked_run.error = f"Failed to dispatch evaluation task: {exc}"[:2000]
            locked_run.completed_at = naive_utc_now()
            session.commit()
            raise

        return locked_run

    @classmethod
    def _resolve_pinned_target_workflow_for_run(
        cls,
        *,
        session: Session,
        run: EvaluationRun,
    ) -> Workflow | None:
        """Load the immutable target workflow when it still exists."""
        target_type = EvaluationTargetType(run.target_type)
        workflow_id = run.target_workflow_version_id
        if target_type == EvaluationTargetType.KNOWLEDGE_BASE or not workflow_id:
            return None
        if target_type == EvaluationTargetType.SNIPPETS:
            snippet = session.scalar(
                select(CustomizedSnippet).where(
                    CustomizedSnippet.id == run.target_id,
                    CustomizedSnippet.tenant_id == run.tenant_id,
                )
            )
            if snippet is None:
                return None
            return SnippetService(session=session).get_published_workflow_by_id(snippet, workflow_id)

        app = session.scalar(
            select(App).where(
                App.id == run.target_id,
                App.tenant_id == run.tenant_id,
                App.status == "normal",
            )
        )
        if app is None:
            return None
        return WorkflowService().get_published_workflow_by_id(
            app_model=app,
            workflow_id=workflow_id,
            session=session,
        )

    @classmethod
    def _validate_dataset_expected_outputs(
        cls,
        items: Sequence[EvaluationDatasetInput],
        default_metrics: Sequence[DefaultMetric],
        *,
        evaluation_instance: BaseEvaluationInstance | None = None,
    ) -> None:
        """Fail early when selected metrics require references absent from the dataset."""
        if not default_metrics:
            return
        evaluation_instance = evaluation_instance or EvaluationManager.get_evaluation_instance()
        if evaluation_instance is None:
            raise EvaluationFrameworkNotConfiguredError()

        required_output_nodes: list[NodeInfo | None] = []
        required_tool_call_nodes: list[NodeInfo | None] = []
        for metric in default_metrics:
            nodes: list[NodeInfo | None] = list(metric.node_info_list) if metric.node_info_list else [None]
            if evaluation_instance.metric_requires_expected_output(metric.metric):
                required_output_nodes.extend(nodes)
            if evaluation_instance.metric_requires_expected_tool_calls(metric.metric) is True:
                required_tool_call_nodes.extend(nodes)

        missing_output_indices = [
            item.index
            for item in items
            if any(
                not str(
                    item.get_expected_output_for_node(
                        node.node_id if node else None,
                        node.title if node else None,
                    )
                    or ""
                ).strip()
                for node in required_output_nodes
            )
        ]
        if missing_output_indices:
            raise EvaluationDatasetInvalidError(
                "The selected metrics require a non-empty expected_output; "
                f"invalid rows: {missing_output_indices[:10]}."
            )

        missing_tool_call_indices = [
            item.index
            for item in items
            if any(
                not item.get_expected_tool_calls_for_node(
                    node.node_id if node else None,
                    node.title if node else None,
                )
                for node in required_tool_call_nodes
            )
        ]
        if missing_tool_call_indices:
            raise EvaluationDatasetInvalidError(
                "The selected metrics require non-empty expected_tool_calls; "
                f"invalid rows: {missing_tool_call_indices[:10]}."
            )

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
        target_type: str,
        target_id: str,
        run_id: str,
    ) -> EvaluationRun:
        run = (
            session.query(EvaluationRun)
            .filter_by(
                id=run_id,
                tenant_id=tenant_id,
                target_type=target_type,
                target_id=target_id,
            )
            .first()
        )
        if not run:
            raise EvaluationNotFoundError("Evaluation run not found.")
        return run

    @classmethod
    def get_evaluation_run_items(
        cls,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        run_id: str,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[EvaluationRunItem], int]:
        """Query evaluation run items with pagination."""
        cls.get_evaluation_run_detail(session, tenant_id, target_type, target_id, run_id)
        query = (
            session.query(EvaluationRunItem)
            .filter_by(
                evaluation_run_id=run_id,
                status=EvaluationRunItemStatus.COMPLETED,
            )
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
        target_type: str,
        target_id: str,
        run_id: str,
    ) -> EvaluationRun:
        run = cls.get_evaluation_run_detail(session, tenant_id, target_type, target_id, run_id)
        if run.status not in (EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING):
            raise ValueError(f"Cannot cancel evaluation run in status: {run.status}")

        run.status = EvaluationRunStatus.CANCELLED
        run.execution_token = None
        run.heartbeat_at = None
        run.completed_at = naive_utc_now()
        celery_task_id = run.celery_task_id
        session.commit()

        if target_type in {EvaluationTargetType.APPS.value, EvaluationTargetType.SNIPPETS.value}:
            cls._stop_workflow_tasks(run.id, run.total_items)
        elif target_type == EvaluationTargetType.AGENTS.value:
            cls._stop_agent_evaluation_tasks(
                tenant_id=tenant_id,
                evaluation_run_id=run.id,
                total_items=run.total_items,
            )

        # Persist cancellation before notifying Celery so cooperative checks in
        # a running task can observe the terminal state immediately.
        if celery_task_id:
            try:
                from celery import current_app as celery_app

                celery_app.control.revoke(celery_task_id, terminate=False)
            except Exception:
                logger.exception("Failed to revoke Celery task %s", celery_task_id)

        return run

    @staticmethod
    def workflow_task_id(evaluation_run_id: str, phase: str, position: int) -> str:
        return f"evaluation:{evaluation_run_id}:{phase}:{position}"

    @classmethod
    def _stop_workflow_tasks(cls, evaluation_run_id: str, total_items: int) -> None:
        cls._stop_workflow_task_positions(evaluation_run_id, range(total_items))

    @classmethod
    def _stop_workflow_task_positions(
        cls,
        evaluation_run_id: str,
        positions: Sequence[int],
        phases: Sequence[str] = ("target", "evaluator"),
    ) -> None:
        """Stop selected workflow phases for the selected original row positions."""
        from core.app.apps.base_app_queue_manager import AppQueueManager
        from extensions.ext_redis import redis_client
        from graphon.graph_engine.manager import GraphEngineManager

        try:
            manager = GraphEngineManager(redis_client)
        except Exception:
            logger.exception(
                "Failed to initialize graph engine manager while stopping evaluation run %s", evaluation_run_id
            )
            manager = None
        for position in positions:
            for phase in phases:
                task_id = cls.workflow_task_id(evaluation_run_id, phase, position)
                try:
                    AppQueueManager.set_stop_flag_no_user_check(task_id)
                except Exception:
                    logger.exception("Failed to set stop flag for evaluation workflow task %s", task_id)
                if manager is None:
                    continue
                try:
                    manager.send_stop_command(task_id)
                except Exception:
                    logger.exception("Failed to send stop command for evaluation workflow task %s", task_id)

    @classmethod
    def _stop_agent_evaluation_tasks(
        cls,
        *,
        tenant_id: str,
        evaluation_run_id: str,
        total_items: int,
    ) -> None:
        """Stop both the Agent backend target and any customized evaluator workflows."""

        cls._stop_agent_runs(tenant_id=tenant_id, evaluation_run_id=evaluation_run_id)
        cls._stop_workflow_task_positions(
            evaluation_run_id,
            range(total_items),
            phases=("evaluator",),
        )

    @staticmethod
    def _stop_agent_runs(*, tenant_id: str, evaluation_run_id: str) -> None:
        """Best-effort cancellation and retirement for in-flight Agent V2 rows."""
        with session_factory.create_session() as session:
            checkpoints = [
                (backend_run_id, binding_id)
                for backend_run_id, binding_id in session.execute(
                    select(
                        EvaluationRunItem.agent_backend_run_id,
                        EvaluationRunItem.agent_workspace_binding_id,
                    ).where(
                        EvaluationRunItem.evaluation_run_id == evaluation_run_id,
                        EvaluationRunItem.status == EvaluationRunItemStatus.TARGET_RUNNING,
                    )
                ).all()
            ]
        EvaluationService._stop_agent_checkpoints(tenant_id=tenant_id, checkpoints=checkpoints)

    @staticmethod
    def _stop_agent_checkpoints(
        *,
        tenant_id: str,
        checkpoints: Sequence[tuple[str | None, str | None]],
    ) -> None:
        """Stop already-resolved Agent runs after the owning DB change commits."""
        from clients.agent_backend import create_agent_backend_run_client
        from services.agent.workspace_service import AgentWorkspaceService
        from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

        if not checkpoints:
            return

        try:
            client = create_agent_backend_run_client(
                base_url=dify_config.AGENT_BACKEND_BASE_URL,
                api_token=dify_config.AGENT_BACKEND_API_TOKEN,
                use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
                fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
                stream_read_timeout_seconds=dify_config.AGENT_BACKEND_STREAM_READ_TIMEOUT_SECONDS,
                stream_max_reconnects=dify_config.AGENT_BACKEND_STREAM_MAX_RECONNECTS,
            )
        except Exception:
            logger.exception("Failed to initialize Agent backend client while stopping evaluation rows")
        else:
            for backend_run_id, _ in checkpoints:
                if not backend_run_id:
                    continue
                try:
                    client.cancel_run(backend_run_id)
                except Exception:
                    logger.exception("Failed to cancel Agent evaluation backend run %s", backend_run_id)

        retired_binding_ids: list[str] = []
        for binding_id in dict.fromkeys(binding_id for _, binding_id in checkpoints if binding_id):
            try:
                with session_factory.create_session() as session:
                    retired_binding_id = AgentWorkspaceService.retire_binding(
                        session=session,
                        tenant_id=tenant_id,
                        binding_id=binding_id,
                    )
                    session.commit()
                if retired_binding_id is not None:
                    retired_binding_ids.append(retired_binding_id)
            except Exception:
                logger.exception("Failed to retire Agent evaluation binding %s", binding_id)
        if retired_binding_ids:
            try:
                enqueue_agent_resource_collection(
                    tenant_id=tenant_id,
                    binding_ids=tuple(retired_binding_ids),
                )
            except Exception:
                logger.exception("Failed to enqueue Agent evaluation resource collection")

    @classmethod
    def stage_target_evaluation_cleanup(
        cls,
        *,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
    ) -> None:
        """Delete target-owned evaluation rows in the caller's transaction.

        Broker notifications and object-storage deletion are deferred until the
        transaction commits, so a rollback leaves the evaluation data usable.
        """
        normalized_target_type = EvaluationTargetType(target_type)
        runs = list(
            session.scalars(
                select(EvaluationRun).where(
                    EvaluationRun.tenant_id == tenant_id,
                    EvaluationRun.target_type == normalized_target_type,
                    EvaluationRun.target_id == target_id,
                )
            ).all()
        )
        run_ids = [run.id for run in runs]
        result_file_ids = [run.result_file_id for run in runs if run.result_file_id]
        result_files = (
            list(
                session.scalars(
                    select(UploadFile).where(
                        UploadFile.tenant_id == tenant_id,
                        UploadFile.id.in_(result_file_ids),
                    )
                ).all()
            )
            if result_file_ids
            else []
        )
        tasks_to_stop: list[tuple[str, str | None, str, int]] = [
            (run.id, run.celery_task_id, EvaluationTargetType(run.target_type).value, run.total_items)
            for run in runs
            if run.status in {EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING}
        ]
        agent_checkpoints: list[tuple[str | None, str | None]] = []
        if run_ids and any(target_type == EvaluationTargetType.AGENTS.value for _, _, target_type, _ in tasks_to_stop):
            agent_checkpoints = [
                (backend_run_id, binding_id)
                for backend_run_id, binding_id in session.execute(
                    select(
                        EvaluationRunItem.agent_backend_run_id,
                        EvaluationRunItem.agent_workspace_binding_id,
                    ).where(
                        EvaluationRunItem.evaluation_run_id.in_(run_ids),
                        EvaluationRunItem.status == EvaluationRunItemStatus.TARGET_RUNNING,
                    )
                ).all()
            ]

        if run_ids:
            session.execute(delete(EvaluationRunItem).where(EvaluationRunItem.evaluation_run_id.in_(run_ids)))
            session.execute(delete(EvaluationRun).where(EvaluationRun.id.in_(run_ids)))
        session.execute(
            delete(EvaluationConfiguration).where(
                EvaluationConfiguration.tenant_id == tenant_id,
                EvaluationConfiguration.target_type == normalized_target_type,
                EvaluationConfiguration.target_id == target_id,
            )
        )
        if result_file_ids:
            session.execute(
                delete(UploadFile).where(
                    UploadFile.tenant_id == tenant_id,
                    UploadFile.id.in_(result_file_ids),
                )
            )

        if normalized_target_type == EvaluationTargetType.APPS:
            cls._remove_evaluator_references(
                session=session,
                tenant_id=tenant_id,
                evaluator_app_id=target_id,
                tasks_to_stop=tasks_to_stop,
            )

        storage_keys = [upload_file.key for upload_file in result_files]
        if not tasks_to_stop and not storage_keys:
            return

        cancelled = False

        def cancel_external_cleanup(_session: Session) -> None:
            nonlocal cancelled
            cancelled = True

        def cleanup_external_state(_session: Session) -> None:
            if cancelled:
                return
            from celery import current_app as celery_app

            from extensions.ext_storage import storage

            for run_id, celery_task_id, run_target_type, total_items in tasks_to_stop:
                if run_target_type in {EvaluationTargetType.APPS.value, EvaluationTargetType.SNIPPETS.value}:
                    cls._stop_workflow_tasks(run_id, total_items)
                elif run_target_type == EvaluationTargetType.AGENTS.value:
                    cls._stop_workflow_task_positions(
                        run_id,
                        range(total_items),
                        phases=("evaluator",),
                    )
                if celery_task_id:
                    try:
                        celery_app.control.revoke(celery_task_id, terminate=False)
                    except Exception:
                        logger.exception("Failed to revoke evaluation task %s during target cleanup", celery_task_id)
            if agent_checkpoints:
                cls._stop_agent_checkpoints(tenant_id=tenant_id, checkpoints=agent_checkpoints)
            for storage_key in storage_keys:
                try:
                    storage.delete(storage_key)
                except Exception:
                    logger.exception("Failed to delete evaluation result file %s", storage_key)

        event.listen(session, "after_rollback", cancel_external_cleanup, once=True)
        event.listen(session, "after_commit", cleanup_external_state, once=True)

    @classmethod
    def _remove_evaluator_references(
        cls,
        *,
        session: Session,
        tenant_id: str,
        evaluator_app_id: str,
        tasks_to_stop: list[tuple[str, str | None, str, int]],
    ) -> None:
        referenced_configs = list(
            session.scalars(
                select(EvaluationConfiguration).where(
                    EvaluationConfiguration.tenant_id == tenant_id,
                    EvaluationConfiguration.evaluator_app_id == evaluator_app_id,
                )
            ).all()
        )
        for config in referenced_configs:
            metrics_config = config.metrics_config_dict
            metrics_config["customized_metrics"] = None
            default_metrics = metrics_config.get("default_metrics") or []
            if not default_metrics:
                session.delete(config)
                continue
            config.metrics_config = json.dumps(metrics_config, ensure_ascii=False)
            config.evaluator_app_id = None
            judgment = config.judgment_config_dict
            if judgment:
                conditions = judgment.get("conditions") or []
                judgment["conditions"] = [
                    condition
                    for condition in conditions
                    if not (
                        isinstance(condition, Mapping)
                        and isinstance(condition.get("variable_selector"), list)
                        and condition["variable_selector"]
                        and condition["variable_selector"][0] == evaluator_app_id
                    )
                ]
                config.judgment_conditions = json.dumps(judgment, ensure_ascii=False)

        active_runs = list(
            session.scalars(
                select(EvaluationRun).where(
                    EvaluationRun.tenant_id == tenant_id,
                    EvaluationRun.status.in_([EvaluationRunStatus.PENDING, EvaluationRunStatus.RUNNING]),
                )
            ).all()
        )
        for run in active_runs:
            customized_metrics = run.config_snapshot_dict.get("customized_metrics")
            if not isinstance(customized_metrics, Mapping):
                continue
            if customized_metrics.get("evaluation_workflow_id") != evaluator_app_id:
                continue
            run.status = EvaluationRunStatus.CANCELLED
            run.execution_token = None
            run.heartbeat_at = None
            run.completed_at = naive_utc_now()
            run.error = "The customized evaluator app was deleted."
            tasks_to_stop.append(
                (run.id, run.celery_task_id, EvaluationTargetType(run.target_type).value, run.total_items)
            )

    @classmethod
    def get_evaluation_file(
        cls,
        *,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        file_id: str,
    ) -> UploadFile:
        """Load a file only when a scoped evaluation run owns the reference."""
        owning_run = session.scalar(
            select(EvaluationRun.id).where(
                EvaluationRun.tenant_id == tenant_id,
                EvaluationRun.target_type == target_type,
                EvaluationRun.target_id == target_id,
                (EvaluationRun.dataset_file_id == file_id) | (EvaluationRun.result_file_id == file_id),
            )
        )
        if owning_run is None:
            raise EvaluationNotFoundError("Evaluation file not found.")
        upload_file = session.scalar(
            select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id)
        )
        if upload_file is None:
            raise EvaluationNotFoundError("Evaluation file not found.")
        return upload_file

    @classmethod
    def get_supported_metrics(cls, category: EvaluationCategory) -> list[str]:
        return EvaluationManager.get_supported_metrics(category)

    @classmethod
    def get_console_supported_metrics(cls, category: EvaluationCategory) -> list[str]:
        """Return selectable metrics while retaining hidden legacy metrics for old runs."""
        return [metric for metric in cls.get_supported_metrics(category) if metric not in cls.CONSOLE_DISABLED_METRICS]

    @classmethod
    def get_available_metrics(cls) -> list[str]:
        """Return console-visible metrics implemented by the configured framework."""
        return [metric for metric in cls._union_supported_metric_names() if metric not in cls.CONSOLE_DISABLED_METRICS]

    @classmethod
    def filter_console_default_metrics(
        cls,
        default_metrics: Sequence[DefaultMetric | Mapping[str, Any]],
    ) -> list[DefaultMetric]:
        """Drop obsolete metrics/nodes from console-facing evaluation configs."""
        filtered: list[DefaultMetric] = []
        for raw_metric in default_metrics:
            metric = raw_metric if isinstance(raw_metric, DefaultMetric) else DefaultMetric.model_validate(raw_metric)
            if metric.metric in cls.CONSOLE_DISABLED_METRICS:
                continue

            visible_nodes = [node for node in metric.node_info_list if node.type not in cls.CONSOLE_DISABLED_CATEGORIES]
            if not visible_nodes:
                continue

            filtered.append(metric.model_copy(update={"node_info_list": visible_nodes}))
        return filtered

    @classmethod
    def filter_console_judgment_config(
        cls,
        judgment_config: JudgmentConfig | Mapping[str, Any] | None,
    ) -> JudgmentConfig | None:
        """Strip judgment conditions that reference metrics hidden from console evaluation."""
        if judgment_config is None:
            return None

        config = (
            judgment_config
            if isinstance(judgment_config, JudgmentConfig)
            else JudgmentConfig.model_validate(judgment_config)
        )
        visible_conditions = [
            condition
            for condition in config.conditions
            if len(condition.variable_selector) < 2
            or condition.variable_selector[1] not in cls.CONSOLE_DISABLED_METRICS
        ]
        if not visible_conditions:
            return None
        return config.model_copy(update={"conditions": visible_conditions})

    @classmethod
    def serialize_console_default_metrics(
        cls,
        default_metrics: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        """Return sanitized default metrics payload for console responses."""
        return [metric.model_dump() for metric in cls.filter_console_default_metrics(default_metrics)]

    @classmethod
    def serialize_console_judgment_config(
        cls,
        judgment_config: Mapping[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Return sanitized judgment config payload for console responses."""
        filtered = cls.filter_console_judgment_config(judgment_config)
        return filtered.model_dump() if filtered else None

    @classmethod
    def get_dataset_column_names(
        cls,
        target: Union[App, CustomizedSnippet, Agent],
        target_type: str,
        data: EvaluationConfigData,
        session: Session,
    ) -> list[EvaluationTemplateColumn]:
        """Build dataset template columns from target inputs and the selected evaluation config."""
        input_columns = cls._get_target_input_columns(target, target_type, session)
        expected_output_columns = cls._get_expected_output_columns(data.default_metrics)
        success_criteria_columns = cls._get_success_criteria_columns(data.default_metrics)
        expected_tool_call_columns = cls._get_expected_tool_call_columns(data.default_metrics)
        agent_custom_reference_columns = (
            cls._get_agent_custom_reference_columns(data.customized_metrics)
            if target_type == EvaluationTargetType.AGENTS.value
            else []
        )
        provided_agent_reference_columns: set[str] = set()
        if expected_output_columns:
            provided_agent_reference_columns.add("expected_output")
        if success_criteria_columns:
            provided_agent_reference_columns.add("success_criteria")
        if expected_tool_call_columns:
            provided_agent_reference_columns.add("expected_tool_calls")
        agent_custom_reference_columns = [
            column
            for column in agent_custom_reference_columns
            if column["name"] not in provided_agent_reference_columns
        ]
        return [
            {"name": "index", "type": "number"},
            *input_columns,
            *expected_output_columns,
            *success_criteria_columns,
            *expected_tool_call_columns,
            *agent_custom_reference_columns,
        ]

    @staticmethod
    def _get_agent_custom_reference_columns(
        customized_metrics: CustomizedMetrics | None,
    ) -> list[EvaluationTemplateColumn]:
        """Add dataset columns consumed by the standalone Agent custom-evaluator contract."""
        if customized_metrics is None:
            return []

        referenced_outputs = {
            selector.value_selector[1]
            for value_source in customized_metrics.input_fields.values()
            if isinstance(value_source, str)
            for selector in VariableTemplateParser(value_source).extract_variable_selectors()
            if len(selector.value_selector) == 2 and selector.value_selector[0] == AGENT_CUSTOM_EVALUATOR_NODE_ID
        }
        return [
            {"name": column_name, "type": "string"}
            for output_name, column_name in AGENT_CUSTOM_EVALUATOR_DATASET_COLUMNS.items()
            if output_name in referenced_outputs
        ]

    @classmethod
    def _get_target_input_columns(
        cls,
        target: Union[App, CustomizedSnippet, Agent],
        target_type: str,
        session: Session,
    ) -> list[EvaluationTemplateColumn]:
        """Resolve user-input variables for the target in workflow order."""
        if target_type == EvaluationTargetType.APPS.value and isinstance(target, App):
            input_fields = cls._get_app_input_fields(target, session)
        elif target_type == EvaluationTargetType.SNIPPETS.value and isinstance(target, CustomizedSnippet):
            input_fields = cls._get_snippet_input_fields(target, session)
        elif target_type == EvaluationTargetType.AGENTS.value and isinstance(target, Agent):
            input_fields = [{"variable": "query", "type": "string"}]
        else:
            raise ValueError(f"Unsupported target type: {target_type}")

        columns: list[EvaluationTemplateColumn] = []
        seen: set[str] = set()
        for field in input_fields:
            column_name = str(field.get("variable") or field.get("label") or "").strip()
            if not column_name or column_name in seen:
                continue
            seen.add(column_name)
            columns.append(
                {
                    "name": column_name,
                    "type": cls._normalize_template_column_type(
                        field.get("type") or field.get("value_type") or field.get("input_type")
                    ),
                }
            )
        return columns

    @classmethod
    def _get_expected_output_columns(
        cls,
        default_metrics: Sequence[DefaultMetric | Mapping[str, Any]],
        *,
        evaluation_instance: BaseEvaluationInstance | None = None,
    ) -> list[EvaluationTemplateColumn]:
        """Build one node-title-scoped expected_output column per node that needs a reference answer."""
        filtered_metrics = cls.filter_console_default_metrics(default_metrics)
        if not filtered_metrics:
            return []
        evaluation_instance = evaluation_instance or EvaluationManager.get_evaluation_instance()
        if evaluation_instance is None:
            raise EvaluationFrameworkNotConfiguredError()

        columns: list[EvaluationTemplateColumn] = []
        seen: set[str] = set()
        for metric in filtered_metrics:
            if not evaluation_instance.metric_requires_expected_output(metric.metric):
                continue
            for node_info in metric.node_info_list:
                column_name = f"{node_info.title} : expected_output"
                if column_name in seen:
                    continue
                seen.add(column_name)
                columns.append({"name": column_name, "type": "string"})
        return columns

    @classmethod
    def _get_expected_tool_call_columns(
        cls,
        default_metrics: Sequence[DefaultMetric | Mapping[str, Any]],
        *,
        evaluation_instance: BaseEvaluationInstance | None = None,
    ) -> list[EvaluationTemplateColumn]:
        """Build node-title-scoped JSON reference columns for Agent metrics."""
        filtered_metrics = cls.filter_console_default_metrics(default_metrics)
        if not filtered_metrics:
            return []
        evaluation_instance = evaluation_instance or EvaluationManager.get_evaluation_instance()
        if evaluation_instance is None:
            raise EvaluationFrameworkNotConfiguredError()

        columns: list[EvaluationTemplateColumn] = []
        seen: set[str] = set()
        for metric in filtered_metrics:
            if evaluation_instance.metric_requires_expected_tool_calls(metric.metric) is not True:
                continue
            for node_info in metric.node_info_list:
                column_name = f"{node_info.title} : expected_tool_calls"
                if column_name in seen:
                    continue
                seen.add(column_name)
                columns.append({"name": column_name, "type": "string"})
        return columns

    @classmethod
    def _get_success_criteria_columns(
        cls,
        default_metrics: Sequence[DefaultMetric | Mapping[str, Any]],
        *,
        evaluation_instance: BaseEvaluationInstance | None = None,
    ) -> list[EvaluationTemplateColumn]:
        """Build optional node-scoped success-criteria columns for Agent task metrics."""
        filtered_metrics = cls.filter_console_default_metrics(default_metrics)
        if not filtered_metrics:
            return []
        evaluation_instance = evaluation_instance or EvaluationManager.get_evaluation_instance()
        if evaluation_instance is None:
            raise EvaluationFrameworkNotConfiguredError()

        columns: list[EvaluationTemplateColumn] = []
        seen: set[str] = set()
        for metric in filtered_metrics:
            if evaluation_instance.metric_accepts_success_criteria(metric.metric) is not True:
                continue
            for node_info in metric.node_info_list:
                column_name = f"{node_info.title} : success_criteria"
                if column_name in seen:
                    continue
                seen.add(column_name)
                columns.append({"name": column_name, "type": "string"})
        return columns

    @staticmethod
    def _normalize_template_column_type(raw_type: Any) -> str:
        normalized = str(raw_type or "").strip().lower()
        if normalized in EvaluationService.NUMBER_DATASET_INPUT_TYPES:
            return "number"
        if normalized in EvaluationService.BOOLEAN_DATASET_INPUT_TYPES:
            return "boolean"
        if normalized in EvaluationService.STRING_DATASET_INPUT_TYPES:
            return "string"
        raise ValueError(
            "Evaluation datasets only support string, number, and boolean inputs; "
            f"unsupported input type: {normalized}."
        )

    @classmethod
    def _dataset_input_types(cls, input_fields: Sequence[Mapping[str, Any]]) -> dict[str, str]:
        """Return target input names mapped to the supported dataset scalar types."""
        input_types: dict[str, str] = {}
        for field in input_fields:
            column_name = str(field.get("variable") or field.get("label") or "").strip()
            if not column_name:
                continue
            input_types[column_name] = cls._normalize_template_column_type(
                field.get("type") or field.get("value_type") or field.get("input_type")
            )
        return input_types

    @classmethod
    def _nodes_for_metrics_from_workflow(
        cls,
        workflow: Workflow,
        metrics: list[str],
    ) -> dict[str, list[dict[str, str]]]:
        node_type_to_nodes: dict[str, list[dict[str, str]]] = {}
        agent_v2_node_ids: set[str] = set()
        for node_id, node_data in workflow.walk_nodes():
            if not cls._is_supported_evaluation_node(node_data):
                continue
            ntype = str(node_data.get("type", ""))
            node_type_to_nodes.setdefault(ntype, []).append(
                NodeInfo(node_id=node_id, type=ntype, title=node_data.get("title", "")).model_dump()
            )
            if is_dify_agent_node_data(node_data):
                agent_v2_node_ids.add(node_id)

        result: dict[str, list[dict[str, str]]] = {}
        native_agent_metrics = {metric.value for metric in NATIVE_AGENT_METRIC_NAMES}
        for metric in metrics:
            required_node_type = METRIC_NODE_TYPE_MAPPING.get(metric)
            if required_node_type is None:
                result[metric] = []
                continue
            matching_nodes = node_type_to_nodes.get(required_node_type, [])
            if required_node_type == "agent" and metric not in native_agent_metrics:
                matching_nodes = [node for node in matching_nodes if node["node_id"] not in agent_v2_node_ids]
            result[metric] = matching_nodes
        return result

    @classmethod
    def _is_supported_evaluation_node(cls, node_data: Mapping[str, Any]) -> bool:
        """Return whether a published workflow node can be selected for evaluation."""
        node_type = str(node_data.get("type", ""))
        return node_type in cls.SUPPORTED_NODE_TYPES

    @classmethod
    def _union_supported_metric_names(cls) -> list[str]:
        """Metric names the current evaluation framework supports for any :class:`EvaluationCategory`."""
        ordered: list[str] = []
        seen: set[str] = set()
        for category in EvaluationCategory:
            for name in cls.get_supported_metrics(category):
                if name not in seen:
                    seen.add(name)
                    ordered.append(name)
        return ordered

    @classmethod
    def get_default_metrics_with_nodes_for_published_target(
        cls,
        target: Union[App, CustomizedSnippet, Agent],
        target_type: str,
        session: Session,
    ) -> list[DefaultMetric]:
        """List default metrics and matching nodes using only the *published* workflow graph.

        Metrics are those supported by the configured evaluation framework and present in
        :data:`METRIC_NODE_TYPE_MAPPING`. Node lists are derived from the published workflow only
        (no draft fallback).
        """
        if target_type == EvaluationTargetType.AGENTS.value and isinstance(target, Agent):
            target_node = NodeInfo(node_id=target.id, type="agent", title=target.name)
            agent_supported = set(cls.get_console_supported_metrics(EvaluationCategory.AGENT))
            return [
                DefaultMetric(
                    metric=metric.value,
                    value_type=METRIC_VALUE_TYPE_MAPPING.get(metric.value, "number"),
                    node_info_list=[target_node],
                )
                for metric in NATIVE_AGENT_METRIC_NAMES
                if metric.value in agent_supported
            ]

        workflow = cls._resolve_published_workflow(target, target_type, session)
        if not workflow:
            return []

        supported = cls._union_supported_metric_names()
        metric_names = sorted(m for m in supported if m in METRIC_NODE_TYPE_MAPPING)
        if not metric_names:
            return []

        nodes_by_metric = cls._nodes_for_metrics_from_workflow(workflow, metric_names)
        return [
            DefaultMetric(
                metric=m,
                value_type=METRIC_VALUE_TYPE_MAPPING.get(m, "number"),
                node_info_list=[NodeInfo.model_validate(n) for n in nodes_by_metric.get(m, [])],
            )
            for m in metric_names
        ]

    @classmethod
    def get_nodes_for_metrics(
        cls,
        target: Union[App, CustomizedSnippet, Agent],
        target_type: str,
        session: Session,
        metrics: list[str] | None = None,
    ) -> dict[str, list[dict[str, str]]]:
        """Return node info grouped by metric (or all nodes when *metrics* is empty).

        :param target: App or CustomizedSnippet instance.
        :param target_type: ``"apps"`` or ``"snippets"``.
        :param metrics: Optional list of metric names to filter by.
            When *None* or empty, returns ``{"all": [<every node>]}``.
        :returns: ``{metric_name: [NodeInfo dict, ...]}`` or
            ``{"all": [NodeInfo dict, ...]}``.
        """
        if target_type == EvaluationTargetType.AGENTS.value and isinstance(target, Agent):
            node = NodeInfo(node_id=target.id, type="agent", title=target.name).model_dump()
            if not metrics:
                return {"all": [node]}
            supported = {metric.value for metric in NATIVE_AGENT_METRIC_NAMES}
            return {metric: [node] if metric in supported else [] for metric in metrics}

        workflow = cls._resolve_workflow(target, target_type, session)
        if not workflow:
            return {"all": []} if not metrics else {m: [] for m in metrics}

        if not metrics:
            all_nodes = [
                NodeInfo(node_id=node_id, type=node_data.get("type", ""), title=node_data.get("title", "")).model_dump()
                for node_id, node_data in workflow.walk_nodes()
                if cls._is_supported_evaluation_node(node_data)
            ]
            return {"all": all_nodes}

        return cls._nodes_for_metrics_from_workflow(workflow, metrics)

    @classmethod
    def _resolve_published_workflow(
        cls,
        target: Union[App, CustomizedSnippet, Agent],
        target_type: str,
        session: Session,
    ) -> Workflow | None:
        """Resolve only the published workflow for the target (no draft fallback)."""
        if target_type == EvaluationTargetType.SNIPPETS.value and isinstance(target, CustomizedSnippet):
            return SnippetService(session=session).get_published_workflow(snippet=target)
        if target_type == EvaluationTargetType.APPS.value and isinstance(target, App):
            return WorkflowService().get_published_workflow(app_model=target, session=session)
        return None

    @classmethod
    def _resolve_workflow(
        cls,
        target: Union[App, CustomizedSnippet, Agent],
        target_type: str,
        session: Session,
    ) -> Workflow | None:
        """Resolve the *published* (preferred) or *draft* workflow for the target."""
        if target_type == EvaluationTargetType.SNIPPETS.value and isinstance(target, CustomizedSnippet):
            snippet_service = SnippetService(session=session)
            workflow = snippet_service.get_published_workflow(snippet=target)
            if not workflow:
                workflow = snippet_service.get_draft_workflow(snippet=target)
            return workflow
        elif target_type == EvaluationTargetType.APPS.value and isinstance(target, App):
            workflow_service = WorkflowService()
            workflow = workflow_service.get_published_workflow(app_model=target, session=session)
            if not workflow:
                workflow = workflow_service.get_draft_workflow(app_model=target, session=session)
            return workflow
        return None

    # ---- Category Resolution ----

    @classmethod
    def _resolve_evaluation_category(cls, default_metrics: list[DefaultMetric]) -> EvaluationCategory:
        """Derive evaluation category from default_metrics node_info types.

        Uses the type of the first node_info found in default_metrics.
        Falls back to LLM if no metrics are provided.
        """
        for metric in default_metrics:
            for node_info in metric.node_info_list:
                try:
                    return cls.category_for_node_type(node_info.type)
                except ValueError:
                    continue
        return EvaluationCategory.LLM

    @classmethod
    def execute_targets(
        cls,
        evaluation_run_id: str,
        tenant_id: str,
        target_type: str,
        target_id: str,
        target_workflow_version_id: str,
        input_list: list[EvaluationDatasetInput],
        max_workers: int | None = None,
        cancellation_check: Callable[[], None] | None = None,
        progress_callback: Callable[[int, int], None] | None = None,
        result_callback: Callable[[int, dict[str, NodeRunResult], str | None, str | None], None] | None = None,
        task_positions: Sequence[int] | None = None,
    ) -> tuple[list[dict[str, NodeRunResult]], list[str | None], list[str | None]]:
        """Execute the evaluation target for every test-data item in parallel.

        :param tenant_id: Workspace / tenant ID.
        :param target_type: ``"apps"`` or ``"snippets"``.
        :param target_id: ID of the App or CustomizedSnippet.
        :param input_list: All test-data items parsed from the dataset.
        :param max_workers: Maximum number of parallel worker threads.
        :param result_callback: Coordinator-thread hook invoked as each target result arrives.
        :param task_positions: Original dataset positions used to keep workflow task IDs stable across retries.
        :return: Tuple of (node_results, workflow_run_ids).
            node_results: ordered list of ``{node_id: NodeRunResult}`` mappings;
            the *i*-th element corresponds to ``input_list[i]``.
            workflow_run_ids: ordered list of workflow_run_id strings (or None)
            for each input item.
        """
        from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait

        from flask import Flask, current_app

        flask_app: Flask = current_app._get_current_object()  # type: ignore

        resolved_task_positions = list(task_positions) if task_positions is not None else list(range(len(input_list)))
        if len(resolved_task_positions) != len(input_list):
            raise ValueError("task_positions must align with input_list.")

        def _worker(
            task_position: int,
            item: EvaluationDatasetInput,
        ) -> tuple[dict[str, NodeRunResult], str | None, str | None]:
            with flask_app.app_context():
                with session_factory.create_session() as thread_session:
                    try:
                        response = cls._run_single_target(
                            session=thread_session,
                            tenant_id=tenant_id,
                            target_type=target_type,
                            target_id=target_id,
                            target_workflow_version_id=target_workflow_version_id,
                            item=item,
                            task_id=cls.workflow_task_id(evaluation_run_id, "target", task_position),
                        )

                        workflow_run_id = cls._extract_workflow_run_id(response)
                        if not workflow_run_id:
                            logger.warning(
                                "No workflow_run_id for item %d (target=%s)",
                                item.index,
                                target_id,
                            )
                            return {}, None, "Target execution returned no workflow run ID."

                        node_results = cls._query_node_run_results(
                            session=thread_session,
                            tenant_id=tenant_id,
                            app_id=target_id,
                            workflow_run_id=workflow_run_id,
                        )
                        if not node_results:
                            return {}, workflow_run_id, "Target execution produced no successful node results."
                        return node_results, workflow_run_id, None
                    except EvaluationWorkflowVersionNotFoundError:
                        raise
                    except Exception as exc:
                        logger.exception(
                            "Target execution failed for item %d (target=%s)",
                            item.index,
                            target_id,
                        )
                        return {}, None, str(exc) or type(exc).__name__

        worker_count = max_workers or dify_config.EVALUATION_MAX_PARALLEL_TARGETS
        executor = ThreadPoolExecutor(max_workers=worker_count)
        future_positions: dict[Future[tuple[dict[str, NodeRunResult], str | None, str | None]], int] = {
            executor.submit(_worker, resolved_task_positions[position], item): position
            for position, item in enumerate(input_list)
        }
        ordered_results: list[dict[str, NodeRunResult]] = [{} for _ in input_list]
        ordered_workflow_run_ids: list[str | None] = [None for _ in input_list]
        ordered_errors: list[str | None] = [None for _ in input_list]
        pending = set(future_positions)
        completed = 0
        try:
            while pending:
                if cancellation_check is not None:
                    cancellation_check()
                done, pending = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
                for future in done:
                    position = future_positions[future]
                    try:
                        node_result, workflow_run_id, error = future.result()
                    except EvaluationWorkflowVersionNotFoundError:
                        raise
                    except Exception as exc:
                        logger.exception("Unexpected error collecting target execution result")
                        node_result, workflow_run_id, error = {}, None, str(exc) or type(exc).__name__
                    ordered_results[position] = node_result
                    ordered_workflow_run_ids[position] = workflow_run_id
                    ordered_errors[position] = error
                    if result_callback is not None:
                        result_callback(position, node_result, workflow_run_id, error)
                    completed += 1
                    if progress_callback is not None:
                        progress_callback(completed, len(input_list))
        except Exception:
            for future in pending:
                future.cancel()
            cls._stop_workflow_task_positions(evaluation_run_id, resolved_task_positions)
            executor.shutdown(wait=True, cancel_futures=True)
            raise
        else:
            executor.shutdown(wait=True)

        return ordered_results, ordered_workflow_run_ids, ordered_errors

    @classmethod
    def _run_single_target(
        cls,
        session: Session,
        tenant_id: str,
        target_type: str,
        target_id: str,
        target_workflow_version_id: str,
        item: EvaluationDatasetInput,
        task_id: str | None = None,
    ) -> Mapping[str, object]:
        """Execute a single evaluation target with one test-data item.

        Dispatches to the appropriate execution service based on
        ``target_type``:

        * ``"snippets"`` → :meth:`SnippetGenerateService.run_published`
        * ``"apps"`` → :meth:`WorkflowAppGenerator().generate` (blocking mode)

        :returns: The blocking response mapping from the workflow engine.
        :raises ValueError: If the target itself is invalid or missing.
        :raises EvaluationWorkflowVersionNotFoundError: If the pinned published version was deleted.
        """
        from core.app.apps.workflow.app_generator import WorkflowAppGenerator
        from core.app.entities.app_invoke_entities import InvokeFrom
        from core.evaluation.runners import get_service_account_for_app, get_service_account_for_snippet

        if target_type == EvaluationTargetType.SNIPPETS.value:
            from services.snippet_generate_service import SnippetGenerateService

            snippet = session.scalar(
                select(CustomizedSnippet).where(
                    CustomizedSnippet.id == target_id,
                    CustomizedSnippet.tenant_id == tenant_id,
                )
            )
            if not snippet:
                raise ValueError(f"Snippet {target_id} not found")

            service_account = get_service_account_for_snippet(session, target_id, tenant_id)

            pinned_workflow = SnippetService(session=session).get_published_workflow_by_id(
                snippet,
                target_workflow_version_id,
            )
            if pinned_workflow is None:
                raise EvaluationWorkflowVersionNotFoundError(
                    f"Pinned workflow version {target_workflow_version_id} no longer exists for snippet {target_id}."
                )

            try:
                return SnippetGenerateService.run_published(
                    snippet=snippet,
                    user=service_account,
                    args={"inputs": item.inputs},
                    invoke_from=InvokeFrom.SERVICE_API,
                    session_maker=session_factory.get_session_maker(),
                    workflow_id=target_workflow_version_id,
                    task_id=task_id,
                    capture_agent_evaluation_trace=True,
                )
            except ValueError as exc:
                if "No published workflow found" in str(exc):
                    raise EvaluationWorkflowVersionNotFoundError(
                        f"Pinned workflow version {target_workflow_version_id} no longer exists "
                        f"for snippet {target_id}."
                    ) from exc
                raise
        if target_type == EvaluationTargetType.APPS.value:
            # target_type == "apps"
            app = session.scalar(
                select(App).where(
                    App.id == target_id,
                    App.tenant_id == tenant_id,
                    App.status == "normal",
                )
            )
            if not app:
                raise ValueError(f"App {target_id} not found")
            cls._validate_app_mode(app)

            service_account = get_service_account_for_app(session, target_id, tenant_id)

            workflow_service = WorkflowService()
            workflow = workflow_service.get_published_workflow_by_id(
                app_model=app,
                workflow_id=target_workflow_version_id,
                session=session,
            )
            if not workflow:
                raise EvaluationWorkflowVersionNotFoundError(
                    f"Pinned workflow version {target_workflow_version_id} no longer exists for app {target_id}."
                )

            response: Mapping[str, object] = WorkflowAppGenerator().generate(
                app_model=app,
                workflow=workflow,
                user=service_account,
                args={"inputs": item.inputs},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                call_depth=0,
                task_id=task_id,
                capture_agent_evaluation_trace=True,
            )
            return response
        raise ValueError(f"Unsupported evaluation target type: {target_type}")

    @staticmethod
    def _extract_workflow_run_id(response: Mapping[str, object]) -> str | None:
        """Extract ``workflow_run_id`` from a blocking workflow response."""
        wf_run_id = response.get("workflow_run_id")
        if wf_run_id:
            return str(wf_run_id)
        data = response.get("data")
        if isinstance(data, Mapping) and data.get("id"):
            return str(data["id"])
        return None

    @staticmethod
    def _query_node_run_results(
        session: Session,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
    ) -> dict[str, NodeRunResult]:
        """Return the latest successful execution for each selected graph node.

        Loop and iteration bodies can execute the same node more than once. MVP
        evaluation deliberately scores the last successful execution, matching
        the final value visible to downstream workflow nodes.
        """
        from sqlalchemy import asc, select

        from graphon.enums import WorkflowNodeExecutionStatus
        from models.workflow import WorkflowNodeExecutionModel

        stmt = (
            WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel))
            .where(
                WorkflowNodeExecutionModel.tenant_id == tenant_id,
                WorkflowNodeExecutionModel.app_id == app_id,
                WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
            )
            .order_by(asc(WorkflowNodeExecutionModel.created_at))
        )

        node_models: list[WorkflowNodeExecutionModel] = list(session.execute(stmt).scalars().all())

        result: dict[str, NodeRunResult] = {}
        for node in node_models:
            if node.status != WorkflowNodeExecutionStatus.SUCCEEDED:
                continue
            # Convert string-keyed metadata to WorkflowNodeExecutionMetadataKey-keyed
            raw_metadata = node.execution_metadata_dict
            typed_metadata: dict[WorkflowNodeExecutionMetadataKey, object] = {}
            for key, val in raw_metadata.items():
                try:
                    typed_metadata[WorkflowNodeExecutionMetadataKey(key)] = val
                except ValueError:
                    pass  # skip unknown metadata keys

            result[node.node_id] = NodeRunResult(
                status=WorkflowNodeExecutionStatus(node.status),
                inputs=node.inputs_dict or {},
                process_data=node.process_data_dict or {},
                outputs=node.outputs_dict or {},
                metadata=typed_metadata,
                error=node.error or "",
            )
        return result

    # ---- Dataset Parsing ----

    @classmethod
    def _parse_dataset(
        cls,
        file_content: bytes,
        filename: str,
        *,
        input_types: Mapping[str, str] | None = None,
    ) -> list[EvaluationDatasetInput]:
        """Parse evaluation dataset from CSV or XLSX content.

        Supported schemas:

        - ``index,<input...>,expected_output`` for the legacy single-reference flow
        - ``index,<input...>,<node_title> : expected_output`` for node-specific references
        - ``index,<input...>,<node_title> : expected_tool_calls`` for Agent trace references
        - ``index,<input...>,<node_title> : success_criteria`` for optional Agent success requirements

        Column parsing treats the *last* ``:`` as the separator between the
        node title and the reference-field suffix.
        """
        filename_lower = filename.lower()
        if filename_lower.endswith(".csv"):
            return cls._parse_csv_dataset(file_content, input_types=input_types)
        if filename_lower.endswith(".xlsx"):
            return cls._parse_xlsx_dataset(file_content, input_types=input_types)
        raise EvaluationDatasetInvalidError("Evaluation datasets must be CSV or XLSX files.")

    @classmethod
    def _parse_xlsx_dataset(
        cls,
        xlsx_content: bytes,
        *,
        input_types: Mapping[str, str] | None = None,
    ) -> list[EvaluationDatasetInput]:
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

        try:
            return cls._rows_to_dataset_items(rows, input_types=input_types)
        finally:
            wb.close()

    @classmethod
    def _parse_csv_dataset(
        cls,
        csv_content: bytes,
        *,
        input_types: Mapping[str, str] | None = None,
    ) -> list[EvaluationDatasetInput]:
        """Parse evaluation dataset from UTF-8 CSV bytes.

        CSV follows the same schema as XLSX:
        the first column must be `index`, remaining columns become inputs,
        and expected-output columns can be either the legacy
        ``expected_output`` or node-scoped ``<node_title> : expected_output``.
        Agent tool-call references use JSON in ``expected_tool_calls`` columns.
        """
        try:
            decoded = csv_content.decode("utf-8-sig")
        except UnicodeDecodeError as e:
            raise EvaluationDatasetInvalidError("CSV file must be UTF-8 encoded.") from e

        reader = csv.reader(io.StringIO(decoded))
        rows = list(reader)
        if len(rows) < 2:
            raise EvaluationDatasetInvalidError("Dataset must have at least a header row and one data row.")

        headers = [str(h).strip() if h is not None else "" for h in rows[0]]
        if not headers or headers[0].lower() != "index":
            raise EvaluationDatasetInvalidError("First column header must be 'index'.")

        return cls._rows_to_dataset_items(rows, input_types=input_types)

    @classmethod
    def _rows_to_dataset_items(
        cls,
        rows: Sequence[Sequence[Any]],
        *,
        input_types: Mapping[str, str] | None = None,
    ) -> list[EvaluationDatasetInput]:
        """Normalize spreadsheet rows into dataset items with index validation."""
        headers = [str(h).strip() if h is not None else "" for h in rows[0]]
        input_headers = headers[1:]
        if any(not header for header in input_headers):
            raise EvaluationDatasetInvalidError("Dataset headers must not be empty.")
        if len(set(input_headers)) != len(input_headers):
            raise EvaluationDatasetInvalidError("Dataset headers must be unique.")

        items: list[EvaluationDatasetInput] = []
        seen_indices: set[int] = set()
        for row_idx, row in enumerate(rows[1:], start=1):
            values = list(row)
            if all(v is None or str(v).strip() == "" for v in values):
                continue

            index_val = values[0] if values else row_idx
            try:
                index = int(str(index_val))
            except (TypeError, ValueError):
                index = row_idx

            if index in seen_indices:
                raise EvaluationDatasetInvalidError(f"Dataset index '{index}' is duplicated.")
            seen_indices.add(index)

            inputs: dict[str, Any] = {}
            expected_output: str | None = None
            expected_outputs: dict[str, str] = {}
            expected_tool_calls: list[AgentToolCall] | None = None
            expected_tool_calls_by_node: dict[str, list[AgentToolCall]] = {}
            success_criteria: list[str] | None = None
            success_criteria_by_node: dict[str, list[str]] = {}
            for col_idx, header in enumerate(input_headers):
                val = values[col_idx + 1] if col_idx + 1 < len(values) else None
                string_value = str(val) if val is not None else ""
                success_criteria_target = cls._parse_success_criteria_header(header)
                if success_criteria_target is not None:
                    parsed_criteria = cls._parse_success_criteria_cell(val)
                    if success_criteria_target == "":
                        success_criteria = parsed_criteria
                    elif parsed_criteria is not None:
                        success_criteria_by_node[success_criteria_target] = parsed_criteria
                    continue

                expected_tool_calls_target = cls._parse_expected_tool_calls_header(header)
                if expected_tool_calls_target is not None:
                    parsed_tool_calls = cls._parse_expected_tool_calls_cell(
                        val,
                        header=header,
                        row_index=index,
                    )
                    if expected_tool_calls_target == "":
                        expected_tool_calls = parsed_tool_calls
                    elif parsed_tool_calls is not None:
                        expected_tool_calls_by_node[expected_tool_calls_target] = parsed_tool_calls
                    continue

                expected_output_target = cls._parse_expected_output_header(header)
                if expected_output_target is None:
                    inputs[header] = cls._coerce_dataset_input(
                        value=val,
                        input_type=(input_types or {}).get(header, "string"),
                        header=header,
                        row_index=index,
                    )
                    continue

                if expected_output_target == "":
                    expected_output = string_value
                else:
                    expected_outputs[expected_output_target] = string_value

            items.append(
                EvaluationDatasetInput(
                    index=index,
                    inputs=inputs,
                    expected_output=expected_output,
                    expected_outputs=expected_outputs,
                    expected_tool_calls=expected_tool_calls,
                    expected_tool_calls_by_node=expected_tool_calls_by_node,
                    success_criteria=success_criteria,
                    success_criteria_by_node=success_criteria_by_node,
                )
            )

        if not items:
            raise EvaluationDatasetInvalidError("Dataset must contain at least one non-empty data row.")
        return items

    @staticmethod
    def _coerce_dataset_input(
        *, value: Any, input_type: str, header: str, row_index: int
    ) -> str | int | float | bool | None:
        """Coerce one dataset cell to a supported workflow scalar."""
        if input_type == "string":
            return str(value) if value is not None else ""
        if input_type == "boolean":
            if value is None or (isinstance(value, str) and not value.strip()):
                return None
            if isinstance(value, bool):
                return value
            normalized_value = str(value).strip().lower()
            if normalized_value in EvaluationService.TRUE_DATASET_VALUES:
                return True
            if normalized_value in EvaluationService.FALSE_DATASET_VALUES:
                return False
            raise EvaluationDatasetInvalidError(
                f"Dataset input '{header}' must be a boolean; invalid row: {row_index}."
            )
        if input_type != "number":
            raise EvaluationDatasetInvalidError(f"Dataset input '{header}' has unsupported type '{input_type}'.")
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        if isinstance(value, bool):
            raise EvaluationDatasetInvalidError(f"Dataset input '{header}' must be a number; invalid row: {row_index}.")
        if isinstance(value, int):
            return value
        try:
            decimal_value = Decimal(str(value).strip())
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise EvaluationDatasetInvalidError(
                f"Dataset input '{header}' must be a number; invalid row: {row_index}."
            ) from exc
        if not decimal_value.is_finite():
            raise EvaluationDatasetInvalidError(
                f"Dataset input '{header}' must be a finite number; invalid row: {row_index}."
            )
        if decimal_value == decimal_value.to_integral_value():
            return int(decimal_value)
        numeric_value = float(decimal_value)
        if not math.isfinite(numeric_value):
            raise EvaluationDatasetInvalidError(
                f"Dataset input '{header}' must be a finite number; invalid row: {row_index}."
            )
        return numeric_value

    @staticmethod
    def _parse_expected_output_header(header: str) -> str | None:
        """Return the node title or legacy node ID for an expected-output column, if any.

        ``expected_output`` keeps the legacy single-reference behaviour and
        returns an empty string marker. Node-specific columns split on the last
        ``:`` so titles such as ``RAG: final judge`` remain valid.
        """
        normalized_header = header.strip()
        if normalized_header == "expected_output":
            return ""

        if ":" not in normalized_header:
            return None

        node_key, suffix = normalized_header.rsplit(":", 1)
        if suffix.strip() != "expected_output":
            return None

        normalized_node_key = node_key.strip()
        return normalized_node_key or None

    @staticmethod
    def _parse_expected_tool_calls_header(header: str) -> str | None:
        """Return the node title or legacy node ID for an expected-tool-calls column, if any."""
        normalized_header = header.strip()
        if normalized_header == "expected_tool_calls":
            return ""
        if ":" not in normalized_header:
            return None

        node_key, suffix = normalized_header.rsplit(":", 1)
        if suffix.strip() != "expected_tool_calls":
            return None
        normalized_node_key = node_key.strip()
        return normalized_node_key or None

    @staticmethod
    def _parse_success_criteria_header(header: str) -> str | None:
        """Return the node title or legacy node ID for a success-criteria column, if any."""
        normalized_header = header.strip()
        if normalized_header == "success_criteria":
            return ""
        if ":" not in normalized_header:
            return None

        node_key, suffix = normalized_header.rsplit(":", 1)
        if suffix.strip() != "success_criteria":
            return None
        normalized_node_key = node_key.strip()
        return normalized_node_key or None

    @staticmethod
    def _parse_success_criteria_cell(value: Any) -> list[str] | None:
        """Parse user-friendly newline text or a JSON string array into criteria."""
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        if isinstance(value, list):
            criteria = [str(item).strip() for item in value if str(item).strip()]
            return criteria or None

        text = str(value).strip()
        if text.startswith("["):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list) and all(isinstance(item, str) for item in parsed):
                criteria = [item.strip() for item in parsed if item.strip()]
                return criteria or None

        criteria = []
        for line in text.splitlines():
            normalized = line.strip()
            if normalized.startswith(("- ", "* ")):
                normalized = normalized[2:].strip()
            if normalized:
                criteria.append(normalized)
        return criteria or None

    @staticmethod
    def _parse_expected_tool_calls_cell(
        value: Any,
        *,
        header: str,
        row_index: int,
    ) -> list[AgentToolCall] | None:
        """Parse one JSON array of ``{"name", "arguments"}`` tool-call objects."""
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        try:
            payload = json.loads(value) if isinstance(value, str) else value
            if not isinstance(payload, list):
                raise ValueError("expected a JSON array")
            return [AgentToolCall.model_validate(tool_call) for tool_call in payload]
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            raise EvaluationDatasetInvalidError(
                f"Dataset column '{header}' must contain a JSON array of tool calls; invalid row: {row_index}."
            ) from exc

    @classmethod
    def execute_retrieval_test_targets(
        cls,
        tenant_id: str,
        dataset_id: str,
        account_id: str,
        input_list: list[EvaluationDatasetInput],
        max_workers: int | None = None,
        cancellation_check: Callable[[], None] | None = None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> tuple[list[NodeRunResult | None], list[str | None]]:
        """Run hit testing against a knowledge base for every input item in parallel.

        Each item must supply a ``query`` key in its ``inputs`` dict.  The
        retrieved segments are normalised into the same ``NodeRunResult`` format
        that :class:`RetrievalEvaluationRunner` expects:

        .. code-block:: python

            NodeRunResult(
                inputs={"query": "..."},
                outputs={"result": [{"content": "...", "score": ...}, ...]},
            )

        :returns: Ordered retrieval results and per-row errors. Failed rows
            remain ``None`` and are never scored as a successful empty retrieval.
        """
        from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait

        from flask import current_app

        flask_app = current_app._get_current_object()  # type: ignore

        def _worker(item: EvaluationDatasetInput) -> NodeRunResult:
            with flask_app.app_context():
                from models.account import Account, TenantAccountJoin
                from models.dataset import Dataset
                from services.hit_testing_service import HitTestingService

                with session_factory.create_session() as thread_session:
                    dataset = thread_session.scalar(
                        select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id)
                    )
                    if not dataset:
                        raise ValueError(f"Dataset {dataset_id} not found")
                    if dataset.provider == "external":
                        raise ValueError("External knowledge bases are not supported by evaluation")

                    account = thread_session.get(Account, account_id)
                    if not account:
                        raise ValueError(f"Account {account_id} not found")
                    membership = thread_session.scalar(
                        select(TenantAccountJoin).where(
                            TenantAccountJoin.account_id == account_id,
                            TenantAccountJoin.tenant_id == tenant_id,
                        )
                    )
                    if membership is None:
                        raise ValueError(f"Account {account_id} is not a member of tenant {tenant_id}")
                    account.set_tenant_id(tenant_id)

                    query = str(item.inputs.get("query", ""))
                    response = HitTestingService.retrieve(
                        session=thread_session,
                        dataset=dataset,
                        query=query,
                        account=account,
                        retrieval_model=None,
                        external_retrieval_model={},
                        limit=10,
                    )

                records = response.get("records", [])
                result_list: list[dict[str, Any]] = []
                for record in records if isinstance(records, list) else []:
                    if not isinstance(record, dict):
                        continue
                    segment = record.get("segment")
                    segment_content = segment.get("content", "") if isinstance(segment, dict) else ""
                    content = segment_content or record.get("content", "")
                    if content:
                        result_list.append({"content": content, "score": record.get("score")})

                return NodeRunResult(
                    inputs={"query": query},
                    outputs={"result": result_list},
                )

        worker_count = max_workers or dify_config.EVALUATION_MAX_PARALLEL_TARGETS
        executor = ThreadPoolExecutor(max_workers=worker_count)
        future_positions: dict[Future[NodeRunResult], int] = {
            executor.submit(_worker, item): position for position, item in enumerate(input_list)
        }
        results: list[NodeRunResult | None] = [None for _ in input_list]
        errors: list[str | None] = [None for _ in input_list]
        pending = set(future_positions)
        completed = 0
        try:
            while pending:
                if cancellation_check is not None:
                    cancellation_check()
                done, pending = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
                for future in done:
                    position = future_positions[future]
                    try:
                        results[position] = future.result()
                    except Exception as exc:
                        item = input_list[position]
                        logger.exception("Retrieval test failed for item %d (dataset=%s)", item.index, dataset_id)
                        errors[position] = str(exc) or type(exc).__name__
                    completed += 1
                    if progress_callback is not None:
                        progress_callback(completed, len(input_list))
        except Exception:
            for future in pending:
                future.cancel()
            executor.shutdown(wait=False, cancel_futures=True)
            raise
        else:
            executor.shutdown(wait=True)

        return results, errors
