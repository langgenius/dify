"""Focused tests for evaluation service validation and dataset parsing."""

import io
import json

import pytest
from openpyxl import load_workbook
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.entities.evaluation_entity import (
    AgentToolCall,
    CustomizedMetricOutputField,
    CustomizedMetrics,
    DefaultMetric,
    EvaluationCategory,
    EvaluationConfigData,
    EvaluationDatasetInput,
    EvaluationRunRequest,
    EvaluationRunSnapshot,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig
from core.evaluation.evaluation_manager import EvaluationManager
from core.evaluation.exceptions import EvaluationWorkflowVersionNotFoundError
from core.evaluation.runners.retrieval_evaluation_runner import RetrievalEvaluationRunner
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentScope, AgentSource
from models.agent_config_entities import AgentSoulConfig
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.evaluation import (
    EvaluationConfiguration,
    EvaluationRun,
    EvaluationRunItem,
    EvaluationRunItemStatus,
    EvaluationRunStatus,
    EvaluationTargetType,
)
from models.model import App, AppMode
from models.workflow import (
    Workflow,
    WorkflowKind,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
)
from repositories.entities.workflow_execution import WorkflowExecutionIdentity
from services.agent.evaluation_target_service import ResolvedAgentEvaluationTarget
from services.errors.evaluation import EvaluationDatasetInvalidError
from services.evaluation_service import EvaluationService
from services.variable_truncator import VariableTruncator
from services.workflow_run_agg import WorkflowRunAgg
from services.workflow_service import WorkflowService
from tests.helpers.unit.core.evaluation.capturing_evaluation_instance import CapturingEvaluationInstance
from tests.helpers.unit.model_factories import (
    make_account,
    make_app,
    make_dataset,
    make_tenant,
    make_upload_file,
    make_workflow,
)


@pytest.fixture(autouse=True)
def stub_evaluation_model_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Avoid provider I/O while using the production evaluators' real metric policies."""
    monkeypatch.setattr(EvaluationService, "_validate_evaluation_model", lambda *_args, **_kwargs: None)


def _agent() -> Agent:
    return Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Research Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
    )


def _workflow_with_nodes(nodes: list[tuple[str, dict[str, object]]]) -> Workflow:
    edges: list[object] = []
    graph = {"nodes": [{"id": node_id, "data": data} for node_id, data in nodes], "edges": edges}
    return Workflow(graph=json.dumps(graph))


def _persist_app(session: Session, app_id: str = "app-1", mode: AppMode = AppMode.WORKFLOW) -> App:
    """Persist a target app so validation runs its actual SQL query."""
    app = make_app(app_id=app_id, mode=mode)
    session.add(app)
    session.flush()
    return app


def _persist_dataset(session: Session, provider: str = "vendor") -> None:
    """Persist a knowledge base so validation runs its actual SQL query."""
    session.add(make_dataset(provider=provider))
    session.flush()


def _persist_service_app(session: Session) -> tuple[App, Account]:
    """Persist an app creator with tenant membership for the service account lookup."""
    account = make_account()
    tenant = make_tenant()
    app = make_app(mode=AppMode.WORKFLOW, created_by=account.id)
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.NORMAL,
    )
    session.add_all([account, tenant, membership, app])
    session.flush()
    return app, account


def _agent_target() -> ResolvedAgentEvaluationTarget:
    """Build the resolved agent value returned at the service boundary."""
    return ResolvedAgentEvaluationTarget(
        agent_id="agent-1",
        agent_name="Research Agent",
        app_id="app-1",
        config_snapshot_id="snapshot-1",
        home_snapshot_id=None,
        agent_soul=AgentSoulConfig(),
    )


def _evaluator_workflow(required_input: bool = True) -> Workflow:
    """Build a real published evaluator graph with an output and optional input."""
    variables = [{"variable": "answer", "required": True}] if required_input else []
    return make_workflow(
        app_id="evaluator-app",
        kind=WorkflowKind.EVALUATION,
        graph={
            "nodes": [
                {"id": "start", "data": {"type": "start", "variables": variables}},
                {"id": "end", "data": {"type": "end", "outputs": [{"variable": "score", "value_type": "number"}]}},
            ],
            "edges": [],
        },
    )


def _patch_evaluator_workflow(monkeypatch: pytest.MonkeyPatch, workflow: Workflow) -> None:
    """Keep the WorkflowService provider boundary local to the evaluator fixture."""
    monkeypatch.setattr(WorkflowService, "__init__", lambda _self: None)
    monkeypatch.setattr(WorkflowService, "get_published_workflow", lambda *_args, **_kwargs: workflow)


def _running_run(session: Session, target_type: EvaluationTargetType, target_id: str) -> EvaluationRun:
    """Persist a running evaluation for cancellation and checkpoint tests."""
    run = EvaluationRun(
        id="run-1",
        tenant_id="tenant-1",
        target_type=target_type,
        target_id=target_id,
        evaluation_config_id="config-1",
        config_snapshot="{}",
        status=EvaluationRunStatus.RUNNING,
        total_items=2,
        celery_task_id="celery-1",
        execution_token="40000000-0000-0000-0000-000000000001",
        heartbeat_at=naive_utc_now(),
        progress_rate=0.4,
        created_by="account-1",
    )
    session.add(run)
    session.commit()
    return run


def _dispatched_payload(tasks: list[dict[str, object]]) -> dict[str, object]:
    """Validate the Celery call shape before inspecting its payload."""
    assert len(tasks) == 1
    args = tasks[0]["args"]
    assert isinstance(args, tuple)
    assert len(args) == 1
    payload = args[0]
    assert isinstance(payload, dict)
    return payload


def _dispatched_inputs(payload: dict[str, object]) -> list[dict[str, object]]:
    """Validate the dispatched dataset rows before inspecting their fields."""
    value = payload["input_list"]
    assert isinstance(value, list)
    for item in value:
        assert isinstance(item, dict)
    return value


class _RecordingCeleryControl:
    """Record the Celery revocation request at the task-control boundary."""

    def __init__(self) -> None:
        self.revocations: list[tuple[str, bool]] = []

    def revoke(self, task_id: str, *, terminate: bool) -> None:
        self.revocations.append((task_id, terminate))


def test_generated_template_uses_provided_column_names() -> None:
    content = EvaluationService._generate_xlsx_template(
        [
            {"name": "index", "type": "number"},
            {"name": "customer_question", "type": "string"},
        ],
        "App",
    )
    worksheet = load_workbook(io.BytesIO(content)).active

    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == ["index", "customer_question"]


def test_retrieval_dataset_template_has_query_and_reference_columns() -> None:
    content, filename = EvaluationService.generate_retrieval_dataset_template()
    worksheet = load_workbook(io.BytesIO(content)).active

    assert filename == "retrieval-evaluation-dataset.xlsx"
    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == ["index", "query", "expected_output"]
    assert [cell.value for cell in worksheet[2]] == [1, None, None]


def test_generated_template_includes_reference_columns_for_selected_metrics(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    app = App(name="Reference App", mode=AppMode.WORKFLOW)
    monkeypatch.setattr(
        EvaluationService,
        "_get_app_input_fields",
        lambda *_args: [{"variable": "input", "label": "Input label", "type": "text-input"}],
    )

    content, _ = EvaluationService.generate_dataset_template(
        app,
        "apps",
        EvaluationConfigData(
            evaluation_framework=EvaluationFrameworkEnum.DEEPEVAL,
            default_metrics=[
                DefaultMetric(
                    metric="answer_correctness",
                    node_info_list=[NodeInfo(node_id="llm-1", type="llm", title="Answer")],
                )
            ],
        ),
        sqlite_session,
    )
    worksheet = load_workbook(io.BytesIO(content)).active

    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == ["index", "input", "Answer : expected_output"]


def test_evaluation_framework_request_defaults_to_ragas_and_rejects_none() -> None:
    assert EvaluationConfigData().evaluation_framework == EvaluationFrameworkEnum.RAGAS
    with pytest.raises(ValidationError):
        EvaluationConfigData.model_validate({"evaluation_framework": "none"})


def test_selected_framework_is_saved_and_reused_for_file_only_runs(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(EvaluationService, "validate_evaluation_config", lambda *_args, **_kwargs: None)
    tenant_id = "30000000-0000-0000-0000-000000000010"
    target_id = "30000000-0000-0000-0000-000000000020"
    account_id = "30000000-0000-0000-0000-000000000030"
    config = EvaluationService.save_evaluation_config(
        sqlite_session,
        tenant_id,
        "apps",
        target_id,
        account_id,
        EvaluationConfigData(evaluation_framework=EvaluationFrameworkEnum.DEEPEVAL),
    )
    sqlite_session.commit()

    saved_config = sqlite_session.get(EvaluationConfiguration, config.id)
    assert saved_config is not None
    assert saved_config.evaluation_framework == EvaluationFrameworkEnum.DEEPEVAL
    file_only = EvaluationRunRequest(file_id="file-1")
    resolved = EvaluationService.resolve_run_request_config(sqlite_session, tenant_id, "apps", target_id, file_only)
    assert resolved.evaluation_framework == EvaluationFrameworkEnum.DEEPEVAL

    explicit = EvaluationRunRequest(file_id="file-1", evaluation_framework=EvaluationFrameworkEnum.RAGAS)
    resolved = EvaluationService.resolve_run_request_config(sqlite_session, tenant_id, "apps", target_id, explicit)
    assert resolved.evaluation_framework == EvaluationFrameworkEnum.RAGAS


def test_metric_lists_follow_selected_framework(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVALUATION_FRAMEWORK", "none")
    ragas_metrics = EvaluationService.get_console_supported_metrics(
        EvaluationCategory.LLM, EvaluationFrameworkEnum.RAGAS
    )
    deepeval_metrics = EvaluationService.get_console_supported_metrics(
        EvaluationCategory.LLM, EvaluationFrameworkEnum.DEEPEVAL
    )
    assert "semantic_similarity" in ragas_metrics
    assert "semantic_similarity" not in deepeval_metrics


def test_parse_csv_dataset_preserves_node_title_scoped_references() -> None:
    items = EvaluationService._parse_dataset(
        b"index,query,Answer : expected_output\n7,hello,world\n",
        "dataset.csv",
    )

    assert len(items) == 1
    assert items[0].index == 7
    assert items[0].inputs == {"query": "hello"}
    assert items[0].expected_outputs == {"Answer": "world"}


def test_parse_dataset_preserves_node_title_scoped_expected_tool_calls() -> None:
    items = EvaluationService._rows_to_dataset_items(
        [
            ["index", "query", "Research Agent : expected_tool_calls"],
            [
                7,
                "weather in Paris",
                json.dumps([{"name": "weather", "arguments": {"city": "Paris"}}]),
            ],
        ]
    )

    assert items[0].inputs == {"query": "weather in Paris"}
    assert items[0].expected_tool_calls_by_node == {
        "Research Agent": [AgentToolCall(name="weather", arguments={"city": "Paris"})]
    }
    assert items[0].iter_expected_output_columns() == [
        (
            "Research Agent : expected_tool_calls",
            '[{"arguments": {"city": "Paris"}, "name": "weather"}]',
        )
    ]


def test_parse_dataset_preserves_optional_agent_success_criteria() -> None:
    items = EvaluationService._rows_to_dataset_items(
        [
            ["index", "query", "Research Agent : success_criteria"],
            [1, "weather in Paris", "- Use real weather data\n- Include the temperature"],
        ]
    )

    assert items[0].inputs == {"query": "weather in Paris"}
    assert items[0].success_criteria_by_node == {"Research Agent": ["Use real weather data", "Include the temperature"]}
    assert items[0].get_success_criteria_for_node("agent-1", "Research Agent") == [
        "Use real weather data",
        "Include the temperature",
    ]
    assert items[0].iter_expected_output_columns() == [
        (
            "Research Agent : success_criteria",
            "Use real weather data\nInclude the temperature",
        )
    ]


def test_parse_dataset_rejects_invalid_expected_tool_calls() -> None:
    with pytest.raises(EvaluationDatasetInvalidError, match="JSON array of tool calls.*7"):
        EvaluationService._rows_to_dataset_items(
            [
                ["index", "query", "Research Agent : expected_tool_calls"],
                [7, "hello", '{"name": "weather"}'],
            ]
        )


def test_parse_csv_dataset_rejects_duplicate_indices() -> None:
    with pytest.raises(EvaluationDatasetInvalidError, match="index '1' is duplicated"):
        EvaluationService._parse_dataset(
            b"index,query\n1,first\n1,second\n",
            "dataset.csv",
        )


def test_parse_csv_dataset_preserves_supported_scalar_input_types() -> None:
    items = EvaluationService._parse_dataset(
        b"index,query,temperature,enabled\n1,hello,2,true\n2,world,0.75,0\n3,large,9007199254740993,YES\n",
        "dataset.csv",
        input_types={"query": "string", "temperature": "number", "enabled": "boolean"},
    )

    assert items[0].inputs == {"query": "hello", "temperature": 2, "enabled": True}
    assert items[1].inputs == {"query": "world", "temperature": 0.75, "enabled": False}
    assert items[2].inputs == {"query": "large", "temperature": 9007199254740993, "enabled": True}


def test_parse_csv_dataset_rejects_invalid_number_input() -> None:
    with pytest.raises(EvaluationDatasetInvalidError, match="temperature.*number.*7"):
        EvaluationService._parse_dataset(
            b"index,temperature\n7,not-a-number\n",
            "dataset.csv",
            input_types={"temperature": "number"},
        )


def test_parse_csv_dataset_rejects_invalid_boolean_input() -> None:
    with pytest.raises(EvaluationDatasetInvalidError, match="enabled.*boolean.*8"):
        EvaluationService._parse_dataset(
            b"index,enabled\n8,maybe\n",
            "dataset.csv",
            input_types={"enabled": "boolean"},
        )


def test_dataset_input_columns_reject_unsupported_types() -> None:
    assert EvaluationService._dataset_input_types([{"variable": "enabled", "type": "checkbox"}]) == {
        "enabled": "boolean"
    }
    with pytest.raises(ValueError, match="only support string, number, and boolean.*file"):
        EvaluationService._dataset_input_types([{"variable": "attachment", "type": "file"}])


def test_dataset_validation_requires_references_for_reference_metrics() -> None:
    items = [EvaluationDatasetInput(index=7, inputs={"query": "hello"})]
    metrics = [DefaultMetric(metric="context_recall", node_info_list=[])]

    with pytest.raises(EvaluationDatasetInvalidError, match="expected_output.*7"):
        EvaluationService._validate_dataset_expected_outputs(items, metrics)


def test_dataset_validation_allows_reference_free_metrics() -> None:
    items = [EvaluationDatasetInput(index=7, inputs={"query": "hello"})]
    metrics = [DefaultMetric(metric="context_relevance", node_info_list=[])]

    EvaluationService._validate_dataset_expected_outputs(items, metrics)


def test_dataset_validation_resolves_references_by_node_title() -> None:
    evaluation_instance = EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.DEEPEVAL)
    assert evaluation_instance is not None
    metrics = [
        DefaultMetric(
            metric="answer_correctness",
            node_info_list=[
                NodeInfo(node_id="llm-1", type="llm", title="Primary Answer"),
                NodeInfo(node_id="llm-2", type="llm", title="Backup Answer"),
            ],
        )
    ]

    EvaluationService._validate_dataset_expected_outputs(
        [
            EvaluationDatasetInput(
                index=7,
                inputs={"query": "hello"},
                expected_outputs={"Primary Answer": "first", "Backup Answer": "second"},
            )
        ],
        metrics,
        evaluation_instance=evaluation_instance,
    )

    with pytest.raises(EvaluationDatasetInvalidError, match="expected_output.*7"):
        EvaluationService._validate_dataset_expected_outputs(
            [
                EvaluationDatasetInput(
                    index=7,
                    inputs={"query": "hello"},
                    expected_outputs={"Primary Answer": "first"},
                )
            ],
            metrics,
            evaluation_instance=evaluation_instance,
        )


def test_dataset_validation_requires_reference_tool_calls_for_ragas_agent_metric() -> None:
    evaluation_instance = EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.RAGAS)
    assert evaluation_instance is not None
    metrics = [
        DefaultMetric(
            metric="tool_call_accuracy",
            node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Research Agent")],
        )
    ]

    with pytest.raises(EvaluationDatasetInvalidError, match="expected_tool_calls.*7"):
        EvaluationService._validate_dataset_expected_outputs(
            [EvaluationDatasetInput(index=7, inputs={"query": "hello"})],
            metrics,
            evaluation_instance=evaluation_instance,
        )

    with pytest.raises(EvaluationDatasetInvalidError, match="expected_tool_calls.*7"):
        EvaluationService._validate_dataset_expected_outputs(
            [
                EvaluationDatasetInput(
                    index=7,
                    inputs={"query": "hello"},
                    expected_tool_calls_by_node={
                        "Other Agent": [AgentToolCall(name="search", arguments={"query": "hello"})]
                    },
                )
            ],
            metrics,
            evaluation_instance=evaluation_instance,
        )

    EvaluationService._validate_dataset_expected_outputs(
        [
            EvaluationDatasetInput(
                index=7,
                inputs={"query": "hello"},
                expected_tool_calls_by_node={
                    "Research Agent": [AgentToolCall(name="search", arguments={"query": "hello"})]
                },
            )
        ],
        metrics,
        evaluation_instance=evaluation_instance,
    )


def test_hidden_reference_agent_metrics_do_not_generate_template_columns() -> None:
    evaluation_instance = EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.RAGAS)
    assert evaluation_instance is not None

    columns = EvaluationService._get_expected_tool_call_columns(
        [
            DefaultMetric(
                metric="tool_call_accuracy",
                node_info_list=[
                    NodeInfo(node_id="agent-1", type="agent", title="Research Agent"),
                    NodeInfo(node_id="agent-2", type="agent", title="Backup Agent"),
                ],
            ),
            DefaultMetric(
                metric="argument_correctness",
                node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Research Agent")],
            ),
        ],
        evaluation_instance=evaluation_instance,
    )

    assert columns == []


def test_task_completion_generates_optional_success_criteria_columns() -> None:
    evaluation_instance = EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.RAGAS)
    assert evaluation_instance is not None

    columns = EvaluationService._get_success_criteria_columns(
        [
            DefaultMetric(
                metric="task_completion",
                node_info_list=[
                    NodeInfo(node_id="agent-1", type="agent", title="Research Agent"),
                    NodeInfo(node_id="agent-2", type="agent", title="Backup Agent"),
                ],
            ),
            DefaultMetric(
                metric="trajectory_quality",
                node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Research Agent")],
            ),
        ],
        target_type="apps",
        evaluation_instance=evaluation_instance,
    )

    assert columns == [
        {"name": "Research Agent : success_criteria", "type": "string"},
        {"name": "Backup Agent : success_criteria", "type": "string"},
    ]


def test_standalone_agent_template_uses_plain_success_criteria_column(sqlite_session: Session) -> None:
    content, _ = EvaluationService.generate_dataset_template(
        _agent(),
        "agents",
        EvaluationConfigData(
            default_metrics=[
                DefaultMetric(
                    metric="task_completion",
                    node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Research Agent")],
                )
            ],
        ),
        sqlite_session,
    )
    workbook = load_workbook(io.BytesIO(content))
    worksheet = workbook.active

    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == ["index", "query", "success_criteria"]

    worksheet.cell(row=2, column=2, value="Find the weather")
    worksheet.cell(row=2, column=3, value="Use real weather data")
    uploaded = io.BytesIO()
    workbook.save(uploaded)
    items = EvaluationService._parse_dataset(uploaded.getvalue(), "dataset.xlsx")
    assert items[0].get_success_criteria_for_node("agent-1", "Research Agent") == ["Use real weather data"]


def test_agent_custom_evaluator_adds_referenced_dataset_columns(sqlite_session: Session) -> None:
    columns = EvaluationService.get_dataset_column_names(
        _agent(),
        "agents",
        EvaluationConfigData(
            customized_metrics=CustomizedMetrics(
                evaluation_workflow_id="evaluator-app",
                input_fields={
                    "answer": "{{#agent.expected_output#}}",
                    "criteria": "{{#agent.success_criteria_json#}}",
                    "trace": "{{#agent.trajectory_json#}}",
                    "calls": "{{#agent.expected_tool_calls_json#}}",
                },
                output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
            )
        ),
        sqlite_session,
    )

    assert columns == [
        {"name": "index", "type": "number"},
        {"name": "query", "type": "string"},
        {"name": "expected_output", "type": "string"},
        {"name": "success_criteria", "type": "string"},
        {"name": "expected_tool_calls", "type": "string"},
    ]


def test_agent_custom_evaluator_reuses_native_success_criteria_column(sqlite_session: Session) -> None:
    columns = EvaluationService.get_dataset_column_names(
        _agent(),
        "agents",
        EvaluationConfigData(
            default_metrics=[
                DefaultMetric(
                    metric="task_completion",
                    node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Research Agent")],
                )
            ],
            customized_metrics=CustomizedMetrics(
                evaluation_workflow_id="evaluator-app",
                input_fields={"criteria": "{{#agent.success_criteria_json#}}"},
                output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
            ),
        ),
        sqlite_session,
    )

    assert columns == [
        {"name": "index", "type": "number"},
        {"name": "query", "type": "string"},
        {"name": "success_criteria", "type": "string"},
    ]


def test_console_supported_metrics_hide_legacy_agent_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        EvaluationService,
        "get_supported_metrics",
        lambda *_args, **_kwargs: [
            "task_completion",
            "trajectory_quality",
            "tool_selection_correctness",
            "tool_argument_correctness",
            "argument_correctness",
            "tool_call_accuracy",
        ],
    )

    assert EvaluationService.get_console_supported_metrics(EvaluationCategory.AGENT) == [
        "task_completion",
        "trajectory_quality",
        "tool_selection_correctness",
        "tool_argument_correctness",
    ]


def test_available_metrics_hide_legacy_agent_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        EvaluationService,
        "_union_supported_metric_names",
        lambda *_args, **_kwargs: [
            "faithfulness",
            "task_completion",
            "argument_correctness",
            "tool_call_accuracy",
        ],
    )

    assert EvaluationService.get_available_metrics() == ["faithfulness", "task_completion"]


def test_expected_output_columns_use_node_titles() -> None:
    evaluation_instance = EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.DEEPEVAL)
    assert evaluation_instance is not None

    columns = EvaluationService._get_expected_output_columns(
        [
            DefaultMetric(
                metric="answer_correctness",
                node_info_list=[
                    NodeInfo(node_id="llm-1", type="llm", title="Primary Answer"),
                    NodeInfo(node_id="llm-2", type="llm", title="Backup Answer"),
                ],
            )
        ],
        evaluation_instance=evaluation_instance,
    )

    assert columns == [
        {"name": "Primary Answer : expected_output", "type": "string"},
        {"name": "Backup Answer : expected_output", "type": "string"},
    ]


def test_dataset_references_fall_back_to_legacy_node_ids() -> None:
    expected_tool_calls = [AgentToolCall(name="search", arguments={"query": "hello"})]
    item = EvaluationDatasetInput(
        index=7,
        inputs={"query": "hello"},
        expected_outputs={"llm-1": "legacy answer"},
        expected_tool_calls_by_node={"agent-1": expected_tool_calls},
    )

    assert item.get_expected_output_for_node("llm-1", "Answer") == "legacy answer"
    assert item.get_expected_tool_calls_for_node("agent-1", "Research Agent") == expected_tool_calls


def test_validate_config_rejects_node_type_spoofing(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    _persist_app(sqlite_session)
    workflow = _workflow_with_nodes([("node-1", {"type": "llm"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="context_precision",
                node_info_list=[NodeInfo(node_id="node-1", type="knowledge-retrieval", title="Retriever")],
            )
        ],
    )

    with pytest.raises(ValueError, match="type does not match"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_config_accepts_native_metric_for_agent_v2_node(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_app(sqlite_session)
    workflow = _workflow_with_nodes([("agent-1", {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="task_completion",
                node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Agent")],
            )
        ],
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        data=config,
    )


def test_validate_agent_target_accepts_only_native_metrics_for_the_target(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    resolved_agents: list[str] = []

    def resolve_target(*, session: Session, tenant_id: str, agent_id: str) -> ResolvedAgentEvaluationTarget:
        assert session is sqlite_session
        assert tenant_id == "tenant-1"
        resolved_agents.append(agent_id)
        return _agent_target()

    monkeypatch.setattr(
        "services.evaluation_service.AgentEvaluationTargetService.resolve_active_snapshot",
        resolve_target,
    )
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="task_completion",
                node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Research Agent")],
            )
        ],
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="agents",
        target_id="agent-1",
        data=config,
    )

    assert resolved_agents == ["agent-1"]

    unsupported = config.model_copy(
        update={
            "default_metrics": [
                DefaultMetric(
                    metric="tool_call_accuracy",
                    node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Research Agent")],
                )
            ]
        }
    )
    with pytest.raises(ValueError, match="not supported for Agent V2"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="agents",
            target_id="agent-1",
            data=unsupported,
        )


def test_validate_agent_target_accepts_customized_evaluator(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(
        "services.evaluation_service.AgentEvaluationTargetService.resolve_active_snapshot",
        lambda **_kwargs: _agent_target(),
    )
    _persist_app(sqlite_session, "evaluator-app")
    evaluator_workflow = _evaluator_workflow()
    _patch_evaluator_workflow(monkeypatch, evaluator_workflow)
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={"answer": "{{#agent.output#}}"},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="agents",
        target_id="agent-1",
        data=config,
    )


@pytest.mark.parametrize(
    "selector",
    ["{{#agent.text#}}", "{{#agent.output.nested#}}"],
)
def test_validate_agent_target_rejects_unknown_customized_output(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    selector: str,
) -> None:
    monkeypatch.setattr(
        "services.evaluation_service.AgentEvaluationTargetService.resolve_active_snapshot",
        lambda **_kwargs: _agent_target(),
    )
    _persist_app(sqlite_session, "evaluator-app")
    evaluator_workflow = _evaluator_workflow()
    _patch_evaluator_workflow(monkeypatch, evaluator_workflow)
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={"answer": selector},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="must use one of"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="agents",
            target_id="agent-1",
            data=config,
        )


def test_agent_default_metrics_are_scoped_to_the_agent(sqlite_session: Session) -> None:
    agent = _agent()

    metrics = EvaluationService.get_default_metrics_with_nodes_for_published_target(
        agent,
        "agents",
        sqlite_session,
    )

    assert [metric.metric for metric in metrics] == [
        "task_completion",
        "trajectory_quality",
        "tool_selection_correctness",
        "tool_argument_correctness",
    ]
    expected_node = NodeInfo(node_id="agent-1", type="agent", title="Research Agent")
    assert all(metric.node_info_list == [expected_node] for metric in metrics)


def test_agent_node_discovery_scopes_agent_v2_to_native_metrics() -> None:
    workflow = _workflow_with_nodes(
        [
            ("legacy-agent", {"type": "agent", "version": "2", "title": "Legacy Agent"}),
            (
                "agent-v2",
                {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Agent V2"},
            ),
        ]
    )

    nodes = EvaluationService._nodes_for_metrics_from_workflow(
        workflow,
        ["argument_correctness", "task_completion"],
    )

    assert nodes == {
        "argument_correctness": [{"node_id": "legacy-agent", "type": "agent", "title": "Legacy Agent"}],
        "task_completion": [
            {"node_id": "legacy-agent", "type": "agent", "title": "Legacy Agent"},
            {"node_id": "agent-v2", "type": "agent", "title": "Agent V2"},
        ],
    }


def test_knowledge_retrieval_v2_node_discovery_uses_retrieval_metrics() -> None:
    workflow = _workflow_with_nodes(
        [
            ("retrieval-v1", {"type": "knowledge-retrieval", "title": "Legacy Retrieval"}),
            ("retrieval-v2", {"type": "knowledge-retrieval-v2", "title": "Knowledge Retrieval V2"}),
        ]
    )

    nodes = EvaluationService._nodes_for_metrics_from_workflow(workflow, ["context_precision"])

    assert nodes == {
        "context_precision": [
            {"node_id": "retrieval-v1", "type": "knowledge-retrieval", "title": "Legacy Retrieval"},
            {"node_id": "retrieval-v2", "type": "knowledge-retrieval-v2", "title": "Knowledge Retrieval V2"},
        ]
    }


def test_knowledge_retrieval_v2_evaluation_scores_full_offloaded_results(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    full_items = [{"content": f"passage {index}"} for index in range(21)]
    full_query = "question: " + "x" * 6000
    truncator = VariableTruncator(string_length_limit=5000, array_element_limit=20, max_size_bytes=6000)
    preview_inputs, inputs_truncated = truncator.truncate_variable_mapping({"query": full_query})
    preview_outputs, outputs_truncated = truncator.truncate_variable_mapping({"result": full_items})
    assert inputs_truncated
    assert outputs_truncated
    input_file = make_upload_file(key="workflow/retrieval-v2-input.json")
    output_file = make_upload_file(key="workflow/retrieval-v2-output.json")
    execution = WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id="node-execution-1",
        node_id="retrieval-v2",
        node_type="knowledge-retrieval-v2",
        title="Knowledge Retrieval V2",
        inputs=json.dumps(preview_inputs),
        process_data=None,
        outputs=json.dumps(preview_outputs),
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        finished_at=None,
    )
    sqlite_session.add_all([input_file, output_file, execution])
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            WorkflowNodeExecutionOffload(
                tenant_id="tenant-1",
                app_id="app-1",
                node_execution_id=execution.id,
                type_=ExecutionOffLoadType.INPUTS,
                file_id=input_file.id,
            ),
            WorkflowNodeExecutionOffload(
                tenant_id="tenant-1",
                app_id="app-1",
                node_execution_id=execution.id,
                type_=ExecutionOffLoadType.OUTPUTS,
                file_id=output_file.id,
            ),
        ]
    )
    sqlite_session.commit()
    storage_payloads = {
        input_file.key: json.dumps({"query": full_query}),
        output_file.key: json.dumps({"result": full_items}),
    }
    loaded_keys: list[str] = []

    def storage_load(key: str) -> str:
        loaded_keys.append(key)
        return storage_payloads[key]

    monkeypatch.setattr("extensions.ext_storage.storage.load", storage_load)

    node_results = EvaluationService._query_node_run_results(sqlite_session, "tenant-1", "app-1", "run-1")
    evaluation_instance = CapturingEvaluationInstance()
    RetrievalEvaluationRunner(evaluation_instance).evaluate_metrics(
        node_run_result_list=[node_results["retrieval-v2"]],
        default_metric=DefaultMetric(
            metric="context_precision",
            node_info_list=[
                NodeInfo(node_id="retrieval-v2", type="knowledge-retrieval-v2", title="Knowledge Retrieval V2")
            ],
        ),
        model_provider="provider",
        model_name="model",
        tenant_id="tenant-1",
    )

    evaluated_item = evaluation_instance.retrieval_items[0]
    assert evaluated_item.inputs == {"query": full_query}
    assert evaluated_item.context == [item["content"] for item in full_items]
    assert loaded_keys == [input_file.key, output_file.key]


def test_validate_config_requires_default_embedding_for_embedding_metrics(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _persist_app(sqlite_session)
    workflow = _workflow_with_nodes([("node-1", {"type": "llm"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)
    validated_tenants: list[str] = []

    def validate_embeddings(*, tenant_id: str) -> None:
        validated_tenants.append(tenant_id)

    monkeypatch.setattr(EvaluationService, "_validate_default_embedding_model", validate_embeddings)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="answer_relevancy",
                node_info_list=[NodeInfo(node_id="node-1", type="llm", title="LLM")],
            )
        ],
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        data=config,
    )

    assert validated_tenants == ["tenant-1"]


def test_validate_config_does_not_require_embeddings_for_deepeval_metrics(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    monkeypatch.setenv("EVALUATION_FRAMEWORK", "none")
    _persist_app(sqlite_session)
    workflow = _workflow_with_nodes([("node-1", {"type": "llm"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)
    validated_tenants: list[str] = []

    def validate_embeddings(*, tenant_id: str) -> None:
        validated_tenants.append(tenant_id)

    monkeypatch.setattr(EvaluationService, "_validate_default_embedding_model", validate_embeddings)
    config = EvaluationConfigData(
        evaluation_framework=EvaluationFrameworkEnum.DEEPEVAL,
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="answer_relevancy",
                node_info_list=[NodeInfo(node_id="node-1", type="llm", title="LLM")],
            )
        ],
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        data=config,
    )

    assert validated_tenants == []
    assert EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.DEEPEVAL) is not None


def test_validate_knowledge_base_config_uses_retrieval_metrics(sqlite_session: Session) -> None:
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_precision", node_info_list=[])],
    )

    _persist_dataset(sqlite_session)

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="dataset-1",
        data=config,
    )

    assert "context_precision" in EvaluationService.get_supported_metrics(
        EvaluationCategory.RETRIEVAL, EvaluationFrameworkEnum.RAGAS
    )


def test_validate_knowledge_base_config_rejects_workflow_node_scope(sqlite_session: Session) -> None:
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="context_precision",
                node_info_list=[
                    NodeInfo(node_id="knowledge-retrieval-1", type="knowledge-retrieval", title="Retriever")
                ],
            )
        ],
    )
    _persist_dataset(sqlite_session)

    with pytest.raises(ValueError, match="target-scoped.*must not select workflow nodes"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="knowledge_base",
            target_id="dataset-1",
            data=config,
        )


def test_validate_workflow_retrieval_metric_preserves_node_scope(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_app(sqlite_session)
    workflow = _workflow_with_nodes([("knowledge-retrieval-1", {"type": "knowledge-retrieval"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="context_precision",
                node_info_list=[
                    NodeInfo(node_id="knowledge-retrieval-1", type="knowledge-retrieval", title="Retriever")
                ],
            )
        ],
        judgment_config=JudgmentConfig(
            conditions=[
                JudgmentCondition(
                    variable_selector=["knowledge-retrieval-1", "context_precision"],
                    comparison_operator=">",
                    value="0.5",
                )
            ]
        ),
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        data=config,
    )


def test_validate_workflow_accepts_knowledge_retrieval_v2(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _persist_app(sqlite_session)
    workflow = _workflow_with_nodes([("retrieval-v2", {"type": "knowledge-retrieval-v2"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="context_precision",
                node_info_list=[
                    NodeInfo(node_id="retrieval-v2", type="knowledge-retrieval-v2", title="Knowledge Retrieval V2")
                ],
            )
        ],
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        data=config,
    )
    assert "context_precision" in EvaluationService.get_supported_metrics(
        EvaluationCategory.RETRIEVAL, EvaluationFrameworkEnum.RAGAS
    )


def test_validate_knowledge_base_config_rejects_customized_evaluator(sqlite_session: Session) -> None:
    _persist_dataset(sqlite_session)
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="not supported for knowledge bases"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="knowledge_base",
            target_id="dataset-1",
            data=config,
        )


def test_validate_config_rejects_undeclared_customized_output(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_app(sqlite_session)
    _persist_app(sqlite_session, "evaluator-app")
    target_workflow = _workflow_with_nodes([("node-1", {"type": "llm"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: target_workflow)
    _patch_evaluator_workflow(monkeypatch, _evaluator_workflow(required_input=False))
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="missing", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="not declared.*missing"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_config_rejects_non_workflow_app(sqlite_session: Session) -> None:
    _persist_app(sqlite_session, mode=AppMode.ADVANCED_CHAT)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="faithfulness",
                node_info_list=[NodeInfo(node_id="node-1", type="llm", title="LLM")],
            )
        ],
    )

    with pytest.raises(ValueError, match="Only workflow apps"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_pin_target_workflow_returns_published_snapshot_id(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_app(sqlite_session)
    workflow = make_workflow(workflow_id="workflow-version-7")
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)

    version_id, resolved_workflow, input_fields = EvaluationService._pin_target_workflow(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
    )

    assert version_id == "workflow-version-7"
    assert resolved_workflow is workflow
    assert input_fields == []


def test_extract_llm_context_node_mapping_uses_published_graph_selectors() -> None:
    workflow = _workflow_with_nodes(
        [
            ("retrieval-1", {"type": "knowledge-retrieval"}),
            (
                "llm-1",
                {"type": "llm", "context": {"enabled": True, "variable_selector": ["retrieval-1", "result"]}},
            ),
        ]
    )

    assert EvaluationService._extract_llm_context_node_mapping(workflow) == {"llm-1": ["retrieval-1"]}


def test_validate_knowledge_base_config_rejects_external_provider(sqlite_session: Session) -> None:
    _persist_dataset(sqlite_session, provider="external")
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_relevance", node_info_list=[])],
    )

    with pytest.raises(ValueError, match="External knowledge bases"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="knowledge_base",
            target_id="dataset-1",
            data=config,
        )


def test_validate_knowledge_base_judgment_uses_dataset_metric_selector(
    sqlite_session: Session,
) -> None:
    _persist_dataset(sqlite_session)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_relevance", node_info_list=[])],
        judgment_config=JudgmentConfig(
            conditions=[
                JudgmentCondition(
                    variable_selector=["dataset-1", "context_relevance"],
                    comparison_operator=">",
                    value="0.5",
                )
            ]
        ),
    )

    EvaluationService.validate_evaluation_config(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="dataset-1",
        data=config,
    )


def test_validate_knowledge_base_judgment_rejects_workflow_node_selector(
    sqlite_session: Session,
) -> None:
    _persist_dataset(sqlite_session)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_relevance", node_info_list=[])],
        judgment_config=JudgmentConfig(
            conditions=[
                JudgmentCondition(
                    variable_selector=["knowledge-retrieval-1", "context_relevance"],
                    comparison_operator=">",
                    value="0.5",
                )
            ]
        ),
    )

    with pytest.raises(ValueError, match="Judgment selector 'knowledge-retrieval-1.context_relevance'"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="knowledge_base",
            target_id="dataset-1",
            data=config,
        )


def test_validate_config_rejects_missing_required_customized_input(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_app(sqlite_session)
    _persist_app(sqlite_session, "evaluator-app")
    target_workflow = _workflow_with_nodes([("node-1", {"type": "llm"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: target_workflow)
    _patch_evaluator_workflow(monkeypatch, _evaluator_workflow())
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="required inputs.*answer"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_config_rejects_unknown_customized_selector_node(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_app(sqlite_session)
    _persist_app(sqlite_session, "evaluator-app")
    target_workflow = _workflow_with_nodes([("node-1", {"type": "llm"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: target_workflow)
    _patch_evaluator_workflow(monkeypatch, _evaluator_workflow())
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={"answer": "{{#missing_node.text#}}"},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="missing_node.*published target workflow"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_config_rejects_unknown_judgment_selector(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_app(sqlite_session)
    workflow = _workflow_with_nodes([("node-1", {"type": "llm"})])
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", lambda *_args: workflow)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="faithfulness",
                node_info_list=[NodeInfo(node_id="node-1", type="llm", title="LLM")],
            )
        ],
        judgment_config=JudgmentConfig(
            conditions=[
                JudgmentCondition(
                    variable_selector=["node-1", "answer_correctness"],
                    comparison_operator=">",
                    value="0.8",
                )
            ]
        ),
    )

    with pytest.raises(ValueError, match="Judgment selector"):
        EvaluationService.validate_evaluation_config(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_cancel_run_stops_each_possible_workflow_task(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    from celery import current_app as celery_app

    run = _running_run(sqlite_session, EvaluationTargetType.APPS, "app-1")
    stopped_workflow_tasks: list[tuple[str, int]] = []

    def stop_workflow_tasks(run_id: str, total_items: int) -> None:
        stopped_workflow_tasks.append((run_id, total_items))

    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_workflow_tasks)
    celery_control = _RecordingCeleryControl()
    monkeypatch.setattr(celery_app, "control", celery_control)

    EvaluationService.cancel_evaluation_run(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        run_id="run-1",
    )

    assert stopped_workflow_tasks == [("run-1", 2)]
    assert celery_control.revocations == [("celery-1", False)]
    assert run.execution_token is None
    assert run.heartbeat_at is None


def test_cancel_agent_run_stops_backend_and_customized_evaluator_tasks(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    from celery import current_app as celery_app

    run = _running_run(sqlite_session, EvaluationTargetType.AGENTS, "agent-1")
    stopped_agent_tasks: list[tuple[str, str, int]] = []
    stopped_workflow_tasks: list[tuple[str, int]] = []

    def stop_agent_evaluation_tasks(*, tenant_id: str, evaluation_run_id: str, total_items: int) -> None:
        stopped_agent_tasks.append((tenant_id, evaluation_run_id, total_items))

    def stop_workflow_tasks(run_id: str, total_items: int) -> None:
        stopped_workflow_tasks.append((run_id, total_items))

    monkeypatch.setattr(EvaluationService, "_stop_agent_evaluation_tasks", stop_agent_evaluation_tasks)
    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_workflow_tasks)
    celery_control = _RecordingCeleryControl()
    monkeypatch.setattr(celery_app, "control", celery_control)

    EvaluationService.cancel_evaluation_run(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="agents",
        target_id="agent-1",
        run_id="run-1",
    )

    assert stopped_agent_tasks == [("tenant-1", "run-1", 2)]
    assert stopped_workflow_tasks == []
    assert celery_control.revocations == [("celery-1", False)]
    assert run.execution_token is None
    assert run.heartbeat_at is None


def test_stop_workflow_tasks_sends_graph_commands_when_queue_stop_flags_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stop_flags: list[str] = []
    aborted_tasks: list[str] = []

    def stop_flag(task_id: str) -> None:
        stop_flags.append(task_id)
        raise RuntimeError("redis flag failed")

    def send_abort(task_id: str) -> None:
        aborted_tasks.append(task_id)

    monkeypatch.setattr(
        "core.app.apps.base_app_queue_manager.AppQueueManager.set_stop_flag_no_user_check",
        stop_flag,
    )
    monkeypatch.setattr("core.app.apps.execution_coordinator.send_abort_command", send_abort)

    EvaluationService._stop_workflow_tasks("run-1", 1)

    assert len(stop_flags) == 2
    assert aborted_tasks == stop_flags


def test_stage_target_cleanup_removes_target_rows_and_preserves_evaluator_defaults(sqlite_session: Session) -> None:
    target_config = EvaluationConfiguration(
        id="10000000-0000-0000-0000-000000000001",
        tenant_id="10000000-0000-0000-0000-000000000010",
        target_type=EvaluationTargetType.APPS,
        target_id="10000000-0000-0000-0000-000000000100",
        metrics_config=json.dumps({"default_metrics": [], "customized_metrics": None}),
        created_by="10000000-0000-0000-0000-000000001000",
        updated_by="10000000-0000-0000-0000-000000001000",
    )
    referencing_config = EvaluationConfiguration(
        id="20000000-0000-0000-0000-000000000001",
        tenant_id=target_config.tenant_id,
        target_type=EvaluationTargetType.APPS,
        target_id="20000000-0000-0000-0000-000000000100",
        metrics_config=json.dumps(
            {
                "default_metrics": [{"metric": "faithfulness", "node_info_list": []}],
                "customized_metrics": {"evaluation_workflow_id": target_config.target_id},
            }
        ),
        evaluator_app_id=target_config.target_id,
        created_by=target_config.created_by,
        updated_by=target_config.updated_by,
    )
    run = EvaluationRun(
        id="10000000-0000-0000-0000-000000000002",
        tenant_id=target_config.tenant_id,
        target_type=EvaluationTargetType.APPS,
        target_id=target_config.target_id,
        target_workflow_version_id="10000000-0000-0000-0000-000000000003",
        evaluation_config_id=target_config.id,
        config_snapshot="{}",
        status=EvaluationRunStatus.COMPLETED,
        total_items=1,
        progress_rate=1.0,
        created_by=target_config.created_by,
    )
    item = EvaluationRunItem(
        id="10000000-0000-0000-0000-000000000004",
        evaluation_run_id=run.id,
        item_index=1,
    )
    sqlite_session.add_all([target_config, referencing_config, run, item])
    sqlite_session.commit()

    EvaluationService.stage_target_evaluation_cleanup(
        session=sqlite_session,
        tenant_id=target_config.tenant_id,
        target_type="apps",
        target_id=target_config.target_id,
    )
    sqlite_session.flush()

    assert sqlite_session.get(EvaluationConfiguration, target_config.id) is None
    assert sqlite_session.get(EvaluationRun, run.id) is None
    assert sqlite_session.get(EvaluationRunItem, item.id) is None
    preserved = sqlite_session.get(EvaluationConfiguration, referencing_config.id)
    assert preserved is not None
    assert preserved.evaluator_app_id is None
    assert preserved.metrics_config_dict["customized_metrics"] is None


@pytest.mark.parametrize("target_type", ["apps", "knowledge_base"])
def test_stage_target_cleanup_deletes_result_file_after_target_deletion_commits(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    target_type: str,
) -> None:
    tenant_id = "10000000-0000-0000-0000-000000000010"
    target_id = "10000000-0000-0000-0000-000000000100"
    result_file = make_upload_file(
        file_id="10000000-0000-0000-0000-000000000020",
        tenant_id=tenant_id,
        key="evaluation_results/tenant/result.xlsx",
        name="result.xlsx",
        extension="xlsx",
        mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        created_by="10000000-0000-0000-0000-000000001000",
        used=True,
    )
    run = EvaluationRun(
        id="10000000-0000-0000-0000-000000000021",
        tenant_id=tenant_id,
        target_type=EvaluationTargetType(target_type),
        target_id=target_id,
        evaluation_config_id="10000000-0000-0000-0000-000000000001",
        config_snapshot="{}",
        status=EvaluationRunStatus.COMPLETED,
        result_file_id=result_file.id,
        total_items=1,
        created_by="10000000-0000-0000-0000-000000001000",
    )
    sqlite_session.add_all([result_file, run])
    sqlite_session.commit()
    deleted_keys: list[str] = []

    def storage_delete(key: str) -> None:
        deleted_keys.append(key)

    monkeypatch.setattr("extensions.ext_storage.storage.delete", storage_delete)

    EvaluationService.stage_target_evaluation_cleanup(
        session=sqlite_session,
        tenant_id=tenant_id,
        target_type=target_type,
        target_id=target_id,
    )
    sqlite_session.flush()

    assert sqlite_session.get(type(result_file), result_file.id) is None
    assert deleted_keys == []

    sqlite_session.commit()

    assert deleted_keys == ["evaluation_results/tenant/result.xlsx"]


def test_stage_agent_target_cleanup_stops_backend_only_after_commit(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = "10000000-0000-0000-0000-000000000010"
    target_id = "10000000-0000-0000-0000-000000000100"
    run = EvaluationRun(
        id="10000000-0000-0000-0000-000000000021",
        tenant_id=tenant_id,
        target_type=EvaluationTargetType.AGENTS,
        target_id=target_id,
        target_agent_config_snapshot_id="10000000-0000-0000-0000-000000000022",
        evaluation_config_id="10000000-0000-0000-0000-000000000001",
        config_snapshot="{}",
        status=EvaluationRunStatus.RUNNING,
        celery_task_id="celery-task-1",
        total_items=1,
        created_by="10000000-0000-0000-0000-000000001000",
    )
    item = EvaluationRunItem(
        id="10000000-0000-0000-0000-000000000023",
        evaluation_run_id=run.id,
        item_index=1,
        status=EvaluationRunItemStatus.TARGET_RUNNING,
        agent_backend_run_id="backend-run-1",
        agent_workspace_binding_id="10000000-0000-0000-0000-000000000024",
    )
    sqlite_session.add_all([run, item])
    sqlite_session.commit()
    stopped_checkpoints: list[tuple[str, list[tuple[str, str]]]] = []

    def stop_agent_checkpoints(*, tenant_id: str, checkpoints: list[tuple[str, str]]) -> None:
        stopped_checkpoints.append((tenant_id, checkpoints))

    monkeypatch.setattr(EvaluationService, "_stop_agent_checkpoints", stop_agent_checkpoints)
    from celery import current_app as celery_app

    celery_control = _RecordingCeleryControl()
    monkeypatch.setattr(celery_app, "control", celery_control)

    EvaluationService.stage_target_evaluation_cleanup(
        session=sqlite_session,
        tenant_id=tenant_id,
        target_type="agents",
        target_id=target_id,
    )
    sqlite_session.flush()

    assert stopped_checkpoints == []
    assert celery_control.revocations == []

    sqlite_session.commit()

    assert stopped_checkpoints == [(tenant_id, [("backend-run-1", "10000000-0000-0000-0000-000000000024")])]
    assert celery_control.revocations == [("celery-task-1", False)]


def test_get_run_items_hides_incomplete_target_checkpoints(sqlite_session: Session) -> None:
    run = EvaluationRun(
        id="10000000-0000-0000-0000-000000000012",
        tenant_id="10000000-0000-0000-0000-000000000010",
        target_type=EvaluationTargetType.APPS,
        target_id="10000000-0000-0000-0000-000000000100",
        target_workflow_version_id="10000000-0000-0000-0000-000000000003",
        evaluation_config_id="10000000-0000-0000-0000-000000000001",
        config_snapshot="{}",
        status=EvaluationRunStatus.RUNNING,
        total_items=2,
        created_by="10000000-0000-0000-0000-000000001000",
    )
    sqlite_session.add_all(
        [
            run,
            EvaluationRunItem(
                evaluation_run_id=run.id,
                item_index=1,
                status=EvaluationRunItemStatus.TARGET_COMPLETED,
            ),
            EvaluationRunItem(
                evaluation_run_id=run.id,
                item_index=2,
                status=EvaluationRunItemStatus.COMPLETED,
            ),
        ]
    )
    sqlite_session.commit()

    items, total = EvaluationService.get_evaluation_run_items(
        sqlite_session,
        run.tenant_id,
        "apps",
        run.target_id,
        run.id,
    )

    assert total == 1
    assert [item.item_index for item in items] == [2]


def test_stage_target_cleanup_does_not_stop_tasks_after_rollback(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = EvaluationConfiguration(
        id="30000000-0000-0000-0000-000000000001",
        tenant_id="30000000-0000-0000-0000-000000000010",
        target_type=EvaluationTargetType.SNIPPETS,
        target_id="30000000-0000-0000-0000-000000000100",
        metrics_config=json.dumps({"default_metrics": [], "customized_metrics": None}),
        created_by="30000000-0000-0000-0000-000000001000",
        updated_by="30000000-0000-0000-0000-000000001000",
    )
    run = EvaluationRun(
        id="30000000-0000-0000-0000-000000000002",
        tenant_id=config.tenant_id,
        target_type=EvaluationTargetType.SNIPPETS,
        target_id=config.target_id,
        target_workflow_version_id="30000000-0000-0000-0000-000000000003",
        evaluation_config_id=config.id,
        config_snapshot="{}",
        status=EvaluationRunStatus.RUNNING,
        total_items=1,
        progress_rate=0.2,
        created_by=config.created_by,
        celery_task_id="celery-task-1",
    )
    sqlite_session.add_all([config, run])
    sqlite_session.commit()
    stopped_workflow_tasks: list[tuple[str, int]] = []

    def stop_workflow_tasks(run_id: str, total_items: int) -> None:
        stopped_workflow_tasks.append((run_id, total_items))

    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_workflow_tasks)

    EvaluationService.stage_target_evaluation_cleanup(
        session=sqlite_session,
        tenant_id=config.tenant_id,
        target_type="snippets",
        target_id=config.target_id,
    )
    sqlite_session.rollback()
    assert sqlite_session.get(EvaluationRun, run.id) is not None

    sqlite_session.commit()

    assert stopped_workflow_tasks == []


def test_retry_failed_run_redispatches_snapshot_and_keeps_checkpoints(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant = Tenant(name="Evaluation Tenant")
    tenant.id = "30000000-0000-0000-0000-000000000010"
    run_request = EvaluationRunSnapshot(
        file_id="30000000-0000-0000-0000-000000000020",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_relevance", node_info_list=[])],
        evaluation_framework=EvaluationFrameworkEnum.DEEPEVAL,
        dataset_input_types={"query": "string"},
    )
    run = EvaluationRun(
        id="30000000-0000-0000-0000-000000000021",
        tenant_id=tenant.id,
        target_type=EvaluationTargetType.KNOWLEDGE_BASE,
        target_id="30000000-0000-0000-0000-000000000030",
        evaluation_config_id="30000000-0000-0000-0000-000000000040",
        config_snapshot=run_request.model_dump_json(),
        status=EvaluationRunStatus.FAILED,
        dataset_file_id=run_request.file_id,
        total_items=2,
        completed_items=0,
        failed_items=2,
        progress_rate=0.9,
        error="worker unavailable",
        celery_task_id="old-task-id",
        created_by="30000000-0000-0000-0000-000000000050",
        started_at=naive_utc_now(),
        completed_at=naive_utc_now(),
    )
    checkpoint = EvaluationRunItem(
        evaluation_run_id=run.id,
        item_index=1,
        status=EvaluationRunItemStatus.COMPLETED,
        inputs='{"query": "first"}',
        judgment="{}",
    )
    sqlite_session.add_all([tenant, run, checkpoint])
    sqlite_session.commit()
    dispatched_tasks: list[dict[str, object]] = []

    def apply_async(**kwargs: object) -> None:
        dispatched_tasks.append(kwargs)

    monkeypatch.setattr("tasks.evaluation_task.run_evaluation.apply_async", apply_async)

    retried = EvaluationService.retry_evaluation_run(
        session=sqlite_session,
        tenant_id=tenant.id,
        target_type="knowledge_base",
        target_id=run.target_id,
        run_id=run.id,
        dataset_file_content=b"index,query\n1,first\n2,second\n",
        dataset_filename="dataset.csv",
    )

    assert retried.status == EvaluationRunStatus.PENDING
    assert retried.celery_task_id != "old-task-id"
    assert retried.execution_token is None
    assert retried.started_at is None
    assert retried.completed_at is None
    assert retried.error is None
    assert retried.completed_items == 1
    assert retried.failed_items == 0
    assert retried.progress_rate == 0.5
    assert sqlite_session.get(EvaluationRunItem, checkpoint.id) is not None
    assert len(dispatched_tasks) == 1
    dispatched_payload = _dispatched_payload(dispatched_tasks)
    assert dispatched_payload["evaluation_run_id"] == run.id
    assert [item["inputs"] for item in _dispatched_inputs(dispatched_payload)] == [
        {"query": "first"},
        {"query": "second"},
    ]
    assert dispatched_payload["evaluation_framework"] == "deepeval"
    assert EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.DEEPEVAL) is not None

    with pytest.raises(ValueError, match="Only failed"):
        EvaluationService.retry_evaluation_run(
            session=sqlite_session,
            tenant_id=tenant.id,
            target_type="knowledge_base",
            target_id=run.target_id,
            run_id=run.id,
            dataset_file_content=b"index,query\n1,first\n2,second\n",
            dataset_filename="dataset.csv",
        )


def test_retry_failed_agent_run_restarts_an_incomplete_backend_row(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant = Tenant(name="Agent Evaluation Tenant")
    tenant.id = "30000000-0000-0000-0000-000000000110"
    run_request = EvaluationRunSnapshot(
        file_id="30000000-0000-0000-0000-000000000120",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="task_completion",
                node_info_list=[
                    NodeInfo(
                        node_id="30000000-0000-0000-0000-000000000130",
                        type="agent",
                        title="Research Agent",
                    )
                ],
            )
        ],
        evaluation_framework=EvaluationFrameworkEnum.DEEPEVAL,
        dataset_input_types={"query": "string"},
    )
    run = EvaluationRun(
        id="30000000-0000-0000-0000-000000000121",
        tenant_id=tenant.id,
        target_type=EvaluationTargetType.AGENTS,
        target_id="30000000-0000-0000-0000-000000000130",
        target_agent_config_snapshot_id="30000000-0000-0000-0000-000000000140",
        evaluation_config_id="30000000-0000-0000-0000-000000000150",
        config_snapshot=run_request.model_dump_json(),
        status=EvaluationRunStatus.FAILED,
        dataset_file_id=run_request.file_id,
        total_items=1,
        progress_rate=0.05,
        error="heartbeat lease expired",
        created_by="30000000-0000-0000-0000-000000000160",
    )
    checkpoint = EvaluationRunItem(
        evaluation_run_id=run.id,
        item_index=1,
        status=EvaluationRunItemStatus.TARGET_RUNNING,
        inputs='{"query": "first"}',
        agent_backend_run_id="backend-run-old",
        agent_workspace_binding_id="30000000-0000-0000-0000-000000000170",
    )
    sqlite_session.add_all([tenant, run, checkpoint])
    sqlite_session.commit()
    stopped_checkpoints: list[tuple[str, list[tuple[str, str]]]] = []

    def stop_agent_checkpoints(*, tenant_id: str, checkpoints: list[tuple[str, str]]) -> None:
        stopped_checkpoints.append((tenant_id, checkpoints))

    monkeypatch.setattr(EvaluationService, "_stop_agent_checkpoints", stop_agent_checkpoints)
    dispatched_tasks: list[dict[str, object]] = []

    def apply_async(**kwargs: object) -> None:
        dispatched_tasks.append(kwargs)

    monkeypatch.setattr("tasks.evaluation_task.run_evaluation.apply_async", apply_async)

    retried = EvaluationService.retry_evaluation_run(
        session=sqlite_session,
        tenant_id=tenant.id,
        target_type="agents",
        target_id=run.target_id,
        run_id=run.id,
        dataset_file_content=b"index,query\n1,first\n",
        dataset_filename="dataset.csv",
    )

    assert retried.status == EvaluationRunStatus.PENDING
    assert sqlite_session.get(EvaluationRunItem, checkpoint.id) is None
    assert stopped_checkpoints == [(tenant.id, [("backend-run-old", "30000000-0000-0000-0000-000000000170")])]
    dispatched_payload = _dispatched_payload(dispatched_tasks)
    assert dispatched_payload["target_agent_config_snapshot_id"] == run.target_agent_config_snapshot_id


def test_start_run_persists_and_dispatches_target_workflow_snapshot(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setenv("EVALUATION_FRAMEWORK", "none")
    tenant = Tenant(name="Evaluation Tenant")
    tenant.id = "tenant-1"
    sqlite_session.add(tenant)
    sqlite_session.flush()
    monkeypatch.setattr(EvaluationService, "validate_evaluation_config", lambda **_kwargs: None)
    pinned_workflow = make_workflow(workflow_id="workflow-version-7")
    monkeypatch.setattr(
        EvaluationService,
        "_pin_target_workflow",
        lambda **_kwargs: (
            "workflow-version-7",
            pinned_workflow,
            [
                {"variable": "query", "type": "text-input"},
                {"variable": "enabled", "type": "checkbox"},
            ],
        ),
    )
    dispatched_tasks: list[dict[str, object]] = []

    def apply_async(**kwargs: object) -> None:
        dispatched_tasks.append(kwargs)

    monkeypatch.setattr("tasks.evaluation_task.run_evaluation.apply_async", apply_async)

    run = EvaluationService.start_evaluation_run(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        account_id="account-1",
        dataset_file_content=b"index,query,enabled\n1,hello,true\n",
        dataset_filename="dataset.csv",
        run_request=EvaluationRunRequest(
            file_id="file-1", evaluation_model="model", evaluation_framework=EvaluationFrameworkEnum.DEEPEVAL
        ),
    )

    assert run.target_workflow_version_id == "workflow-version-7"
    assert EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.DEEPEVAL) is not None
    assert run.config_snapshot_dict["evaluation_framework"] == "deepeval"
    assert run.config_snapshot_dict["dataset_input_types"] == {"query": "string", "enabled": "boolean"}
    dispatch_kwargs = dispatched_tasks[0]
    assert set(dispatch_kwargs) == {"args", "task_id"}
    dispatched_payload = _dispatched_payload(dispatched_tasks)
    assert dispatched_payload["evaluation_framework"] == "deepeval"
    assert dispatched_payload["target_workflow_version_id"] == "workflow-version-7"
    assert _dispatched_inputs(dispatched_payload)[0]["inputs"] == {"query": "hello", "enabled": True}


def test_start_agent_run_persists_and_dispatches_agent_snapshot(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setenv("EVALUATION_FRAMEWORK", "none")
    tenant = Tenant(name="Agent Evaluation Tenant")
    tenant.id = "tenant-1"
    sqlite_session.add(tenant)
    sqlite_session.flush()
    monkeypatch.setattr(EvaluationService, "validate_evaluation_config", lambda **_kwargs: None)
    pinned_agents: list[str] = []

    def pin_agent(*, session: Session, tenant_id: str, target_id: str) -> tuple[str, list[dict[str, str]]]:
        assert session is sqlite_session
        assert tenant_id == "tenant-1"
        pinned_agents.append(target_id)
        return "snapshot-7", [{"variable": "query", "type": "string"}]

    monkeypatch.setattr(EvaluationService, "_pin_target_agent", pin_agent)
    dispatched_tasks: list[dict[str, object]] = []

    def apply_async(**kwargs: object) -> None:
        dispatched_tasks.append(kwargs)

    monkeypatch.setattr("tasks.evaluation_task.run_evaluation.apply_async", apply_async)

    run = EvaluationService.start_evaluation_run(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="agents",
        target_id="agent-1",
        account_id="account-1",
        dataset_file_content=b"index,query\n1,hello\n",
        dataset_filename="dataset.csv",
        run_request=EvaluationRunRequest(file_id="file-1", evaluation_model="model"),
    )

    assert run.target_workflow_version_id is None
    assert run.target_agent_config_snapshot_id == "snapshot-7"
    assert pinned_agents == ["agent-1"]
    dispatched_payload = _dispatched_payload(dispatched_tasks)
    assert dispatched_payload["target_workflow_version_id"] is None
    assert dispatched_payload["target_agent_config_snapshot_id"] == "snapshot-7"
    assert dispatched_payload["evaluation_framework"] == "ragas"
    assert _dispatched_inputs(dispatched_payload)[0]["inputs"] == {"query": "hello"}


def test_run_single_app_target_loads_pinned_workflow_version(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    from core.app.apps.workflow.app_generator import WorkflowAppGenerator

    app, account = _persist_service_app(sqlite_session)
    workflow = make_workflow(workflow_id="workflow-version-7")
    workflow_requests: list[tuple[App, str, Session]] = []

    def get_published_workflow_by_id(
        _self: WorkflowService, *, app_model: App, workflow_id: str, session: Session
    ) -> Workflow:
        workflow_requests.append((app_model, workflow_id, session))
        return workflow

    monkeypatch.setattr(WorkflowService, "__init__", lambda _self: None)
    monkeypatch.setattr(WorkflowService, "get_published_workflow_by_id", get_published_workflow_by_id)
    generated_requests: list[dict[str, object]] = []
    execution_drivers: list[object] = []

    def generate(self: WorkflowAppGenerator, **kwargs: object) -> dict[str, str]:
        execution_drivers.append(self._execution_driver)
        generated_requests.append(kwargs)
        return {"workflow_run_id": "workflow-run-1"}

    monkeypatch.setattr(WorkflowAppGenerator, "generate", generate)

    result = EvaluationService._run_single_target(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        target_workflow_version_id="workflow-version-7",
        item=EvaluationDatasetInput(index=1, inputs={"query": "hello"}),
        task_id=EvaluationService.workflow_task_id("run-1", "target", 0),
    )

    assert result["workflow_run_id"] == "workflow-run-1"
    assert workflow_requests == [(app, "workflow-version-7", sqlite_session)]
    assert generated_requests[0]["workflow"] is workflow
    assert generated_requests[0]["task_id"] == EvaluationService.workflow_task_id("run-1", "target", 0)
    assert generated_requests[0]["capture_agent_evaluation_trace"] is True
    assert execution_drivers == [WorkflowRunAgg.run]
    identity = generated_requests[0]["execution_identity"]
    assert isinstance(identity, WorkflowExecutionIdentity)
    assert identity.user_id == account.id


def test_run_single_app_target_fails_when_pinned_workflow_was_deleted(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    from core.app.apps.workflow.app_generator import WorkflowAppGenerator

    _persist_service_app(sqlite_session)
    monkeypatch.setattr(WorkflowService, "__init__", lambda _self: None)
    monkeypatch.setattr(WorkflowService, "get_published_workflow_by_id", lambda *_args, **_kwargs: None)
    generated_requests: list[dict[str, object]] = []

    def generate(_self: WorkflowAppGenerator, **kwargs: object) -> dict[str, str]:
        generated_requests.append(kwargs)
        return {"workflow_run_id": "unexpected"}

    monkeypatch.setattr(WorkflowAppGenerator, "generate", generate)

    with pytest.raises(EvaluationWorkflowVersionNotFoundError, match="workflow-version-7"):
        EvaluationService._run_single_target(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            target_workflow_version_id="workflow-version-7",
            item=EvaluationDatasetInput(index=1, inputs={"query": "hello"}),
            task_id=EvaluationService.workflow_task_id("run-1", "target", 0),
        )

    assert generated_requests == []


@pytest.mark.usefixtures("sqlite_session")
def test_execute_targets_preserves_row_order_and_reports_target_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    items = [EvaluationDatasetInput(index=index, inputs={"prompt": str(index)}) for index in (10, 20, 30, 40)]
    task_ids: dict[int, str] = {}

    def run_target(**kwargs: object) -> dict[str, str]:
        item = kwargs["item"]
        assert isinstance(item, EvaluationDatasetInput)
        task_id = kwargs["task_id"]
        assert isinstance(task_id, str)
        task_ids[item.index] = task_id
        if item.index == 40:
            raise RuntimeError("provider unavailable")
        if item.index == 20:
            return {}
        return {"workflow_run_id": f"workflow-{item.index}"}

    def query_results(**kwargs: object) -> dict[str, NodeRunResult]:
        if kwargs["workflow_run_id"] == "workflow-30":
            return {}
        return {"llm": NodeRunResult(outputs={"answer": "ok"})}

    monkeypatch.setattr(EvaluationService, "_run_single_target", staticmethod(run_target))
    monkeypatch.setattr(EvaluationService, "_query_node_run_results", staticmethod(query_results))
    completed: list[tuple[int, str | None, str | None]] = []
    progress: list[tuple[int, int]] = []

    results, workflow_run_ids, errors = EvaluationService.execute_targets(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        target_workflow_version_id="workflow-version-1",
        input_list=items,
        max_workers=2,
        task_positions=[3, 4, 5, 6],
        result_callback=lambda position, _result, workflow_run_id, error: completed.append(
            (position, workflow_run_id, error)
        ),
        progress_callback=lambda done, total: progress.append((done, total)),
    )

    assert [bool(result) for result in results] == [True, False, False, False]
    assert workflow_run_ids == ["workflow-10", None, "workflow-30", None]
    assert errors[0] is None
    assert "no workflow run ID" in (errors[1] or "")
    assert "no successful node results" in (errors[2] or "")
    assert errors[3] == "provider unavailable"
    assert task_ids == {
        index: EvaluationService.workflow_task_id("run-1", "target", position)
        for index, position in zip((10, 20, 30, 40), (3, 4, 5, 6), strict=True)
    }
    assert sorted(position for position, _, _ in completed) == [0, 1, 2, 3]
    assert sorted(progress) == [(1, 4), (2, 4), (3, 4), (4, 4)]


@pytest.mark.usefixtures("sqlite_session")
def test_execute_targets_propagates_missing_pinned_workflow_and_stops_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing_workflow(**_kwargs: object) -> dict[str, str]:
        raise EvaluationWorkflowVersionNotFoundError("workflow-version-1")

    stopped: list[tuple[str, list[int]]] = []
    monkeypatch.setattr(EvaluationService, "_run_single_target", staticmethod(missing_workflow))
    monkeypatch.setattr(
        EvaluationService,
        "_stop_workflow_task_positions",
        lambda run_id, positions: stopped.append((run_id, list(positions))),
    )

    with pytest.raises(EvaluationWorkflowVersionNotFoundError):
        EvaluationService.execute_targets(
            evaluation_run_id="run-1",
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            target_workflow_version_id="workflow-version-1",
            input_list=[EvaluationDatasetInput(index=1, inputs={"prompt": "test"})],
            max_workers=1,
            task_positions=[7],
        )

    assert stopped == [("run-1", [7])]


def test_execute_retrieval_targets_sets_account_tenant_with_worker_session(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    from services.hit_testing_service import HitTestingService

    account = make_account()
    tenant = make_tenant()
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.NORMAL,
    )
    dataset = make_dataset()
    sqlite_session.add_all([account, tenant, membership, dataset])
    sqlite_session.commit()
    retrievals: list[tuple[Session, Account]] = []

    def retrieve(**kwargs: object) -> dict[str, list[dict[str, object]]]:
        thread_session = kwargs["session"]
        service_account = kwargs["account"]
        assert isinstance(thread_session, Session)
        assert isinstance(service_account, Account)
        retrievals.append((thread_session, service_account))
        assert service_account.current_tenant_id == tenant.id
        return {"records": [{"segment": {"content": "matched content"}, "score": 0.9}]}

    monkeypatch.setattr(HitTestingService, "retrieve", retrieve)

    results, errors = EvaluationService.execute_retrieval_test_targets(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        account_id=account.id,
        input_list=[EvaluationDatasetInput(index=1, inputs={"query": "hello"})],
        max_workers=1,
    )

    assert errors == [None]
    assert results[0] is not None
    assert results[0].outputs == {"result": [{"content": "matched content", "score": 0.9}]}
    assert len(retrievals) == 1
    assert retrievals[0][0] is not sqlite_session
    assert retrievals[0][1].id == account.id
