import pytest

from core.evaluation.agent import agent_judge_evaluator
from core.evaluation.agent.agent_judge_evaluator import (
    AgentLLMJudgeEvaluator,
    CriterionAssessment,
    SuccessCriterionAssessment,
    TaskCompletionCriteria,
    TaskCompletionJudgeOutput,
    ToolArgumentCriteria,
    ToolArgumentJudgeOutput,
    ToolCallArgumentAssessment,
    ToolSelectionCriteria,
    ToolSelectionJudgeOutput,
    TrajectoryQualityJudgeOutput,
    _sanitize_value,
    _strict_judge_json_schema,
    _tool_selection_payload,
    _validated_success_criteria_assessments,
)
from core.evaluation.agent.judge_prompts import get_agent_judge_prompt
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    AgentToolDefinition,
    AgentTrajectory,
    AgentTrajectoryStep,
)


class _FakeJudgeModel:
    model_identifier = "provider/model"

    def __init__(self, output: object) -> None:
        self.output = output
        self.payload: dict[str, object] | None = None
        self.system_prompt = ""

    def generate(self, *, system_prompt, payload, schema):
        self.system_prompt = system_prompt
        self.payload = dict(payload)
        assert isinstance(self.output, schema)
        return self.output


def _criterion(score: float | None, *, applicable: bool = True) -> CriterionAssessment:
    return CriterionAssessment(
        applicable=applicable,
        score=score,
        reason="Evidence-based reason.",
        evidence_step_ids=["final-output"],
    )


@pytest.mark.parametrize(
    "schema_model",
    [
        TaskCompletionJudgeOutput,
        TrajectoryQualityJudgeOutput,
        ToolSelectionJudgeOutput,
        ToolArgumentJudgeOutput,
    ],
)
def test_agent_judge_json_schema_is_strict_at_every_object_level(schema_model: type) -> None:
    schema = _strict_judge_json_schema(schema_model)

    def assert_strict(value: object) -> None:
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
                properties = value.get("properties", {})
                assert isinstance(properties, dict)
                assert value.get("required") == list(properties)
            for nested_value in value.values():
                assert_strict(nested_value)
        elif isinstance(value, list):
            for nested_value in value:
                assert_strict(nested_value)

    assert_strict(schema)


def test_task_completion_recomputes_weighted_score_and_uses_success_criteria(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_model = _FakeJudgeModel(
        TaskCompletionJudgeOutput(
            score=0.99,
            reason="The task is mostly complete.",
            criteria=TaskCompletionCriteria(
                goal_satisfaction=_criterion(0.75),
                correctness_and_evidence_consistency=_criterion(0.5),
                completeness=_criterion(1.0),
            ),
            success_criteria_assessments=[
                SuccessCriterionAssessment(
                    criterion_id="success-criterion-1",
                    applicable=True,
                    score=0.75,
                    reason="The criterion is mostly satisfied.",
                    evidence_step_ids=["final-output"],
                )
            ],
            failed_criteria=["correctness_and_evidence_consistency"],
        )
    )
    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", lambda *_args: fake_model)
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Find the shipment status."},
        output="The order shipped.",
        success_criteria=["Use the real shipment status."],
        trajectory=AgentTrajectory(
            source="legacy",
            steps=[
                AgentTrajectoryStep(
                    step_id="final-output",
                    sequence=0,
                    step_type="final_output",
                    content="The order shipped.",
                    status="succeeded",
                )
            ],
        ),
    )

    result = AgentLLMJudgeEvaluator().evaluate(
        [item],
        ["task_completion"],
        "provider",
        "model",
        "tenant",
    )[0]

    assert result.error is None
    assert result.metrics[0].value == 0.7125
    assert result.metrics[0].details["reported_score"] == 0.99
    assert result.metrics[0].details["prompt_version"] == "agent.task_completion.v2"
    assert fake_model.payload is not None
    assert fake_model.payload["success_criteria"] == [
        {"criterion_id": "success-criterion-1", "requirement": "Use the real shipment status."}
    ]
    assert result.metrics[0].details["success_criteria_assessments"][0]["score"] == 0.75
    assert "TARGET METRIC: task_completion" in fake_model.system_prompt


def test_task_completion_caps_goal_satisfaction_with_failed_observable_requirement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_model = _FakeJudgeModel(
        TaskCompletionJudgeOutput(
            score=0.8875,
            reason="The final answer is correct, but the required tool was not called.",
            criteria=TaskCompletionCriteria(
                goal_satisfaction=_criterion(0.75),
                correctness_and_evidence_consistency=_criterion(1.0),
                completeness=_criterion(1.0),
            ),
            success_criteria_assessments=[
                SuccessCriterionAssessment(
                    criterion_id="success-criterion-1",
                    applicable=True,
                    score=0,
                    reason="Only the current-time tool was called.",
                    evidence_step_ids=["time-call"],
                )
            ],
            failed_criteria=["goal_satisfaction"],
        )
    )
    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", lambda *_args: fake_model)
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Answer with the current time."},
        output="2026-09-30 07-03-00",
        success_criteria=["调用了运行代码工具"],
        tool_calls=[
            AgentToolCall(
                name="current_time",
                call_id="call-time",
                tool_ref="time/current_time",
                arguments={"timezone": "UTC"},
                output="2026-09-30 07:03:00",
            )
        ],
        available_tools=[
            AgentToolDefinition(
                tool_ref="time/current_time",
                name="current_time",
                display_name="获取当前时间",
                description="Return the current time.",
            ),
            AgentToolDefinition(
                tool_ref="code/code",
                name="code",
                display_name="代码解释器",
                description="Run code.",
            ),
        ],
        trajectory=AgentTrajectory(
            source="legacy",
            steps=[
                AgentTrajectoryStep(
                    step_id="time-call",
                    sequence=0,
                    step_type="tool_call",
                    tool_call_id="call-time",
                    tool_ref="time/current_time",
                    tool_name="current_time",
                    status="succeeded",
                ),
                AgentTrajectoryStep(
                    step_id="time-result",
                    sequence=1,
                    step_type="tool_result",
                    tool_call_id="call-time",
                    tool_ref="time/current_time",
                    tool_name="current_time",
                    content="2026-09-30 07:03:00",
                    status="succeeded",
                ),
            ],
        ),
    )

    metric = (
        AgentLLMJudgeEvaluator()
        .evaluate(
            [item],
            ["task_completion"],
            "provider",
            "model",
            "tenant",
        )[0]
        .metrics[0]
    )

    assert metric.value == 0.55
    assert metric.details["criteria"]["goal_satisfaction"]["score"] == 0
    assert metric.details["criteria"]["goal_satisfaction"]["reported_score"] == 0.75
    assert metric.details["success_criteria_assessments"][0]["score"] == 0
    assert fake_model.payload is not None
    assert fake_model.payload["observed_tool_calls"] == [
        {
            "step_id": "time-call",
            "tool_call_id": "call-time",
            "tool_ref": "time/current_time",
            "tool_name": "current_time",
            "tool_display_name": "获取当前时间",
            "tool_description": "Return the current time.",
            "status": "succeeded",
            "error": None,
        }
    ]


def test_task_completion_requires_one_assessment_per_success_criterion() -> None:
    with pytest.raises(ValueError, match="exactly one assessment"):
        _validated_success_criteria_assessments(
            {"success_criteria": [{"criterion_id": "success-criterion-1", "requirement": "Use the code tool."}]},
            [],
        )


def test_task_completion_rejects_inapplicable_success_criterion_without_data_limitation() -> None:
    with pytest.raises(ValueError, match="without an explicit data limitation"):
        _validated_success_criteria_assessments(
            {"success_criteria": [{"criterion_id": "success-criterion-1", "requirement": "Use the code tool."}]},
            [
                SuccessCriterionAssessment(
                    criterion_id="success-criterion-1",
                    applicable=False,
                    score=None,
                    reason="The call cannot be verified.",
                )
            ],
        )


def test_tool_argument_correctness_scores_each_assessable_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_model = _FakeJudgeModel(
        ToolArgumentJudgeOutput(
            score=1,
            reason="One argument is partially correct.",
            call_assessments=[
                ToolCallArgumentAssessment(
                    tool_call_id="call-1",
                    tool_ref="time/convert",
                    score=1,
                    reason="The timezone is ambiguous.",
                    criteria=ToolArgumentCriteria(
                        schema_conformance=_criterion(1),
                        required_parameter_coverage=_criterion(1),
                        semantic_value_correctness=_criterion(0.5),
                        context_consistency=_criterion(0.75),
                    ),
                    failed_parameter_paths=["$.destination_timezone"],
                )
            ],
        )
    )
    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", lambda *_args: fake_model)
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Convert 09:00 Shanghai time to London time."},
        output="01:00",
        tool_calls=[
            AgentToolCall(
                name="convert",
                call_id="call-1",
                tool_ref="time/convert",
                arguments={"source_timezone": "Asia/Shanghai", "destination_timezone": "London"},
            )
        ],
        available_tools=[
            AgentToolDefinition(
                tool_ref="time/convert",
                name="convert",
                input_schema={
                    "type": "object",
                    "properties": {
                        "source_timezone": {"type": "string"},
                        "destination_timezone": {"type": "string"},
                    },
                    "required": ["source_timezone", "destination_timezone"],
                },
            )
        ],
        trajectory=AgentTrajectory(
            source="legacy",
            steps=[
                AgentTrajectoryStep(
                    step_id="step-1",
                    sequence=0,
                    step_type="tool_call",
                    tool_call_id="call-1",
                    tool_ref="time/convert",
                    tool_name="convert",
                    arguments={"source_timezone": "Asia/Shanghai", "destination_timezone": "London"},
                )
            ],
        ),
    )

    metric = (
        AgentLLMJudgeEvaluator()
        .evaluate(
            [item],
            ["tool_argument_correctness"],
            "provider",
            "model",
            "tenant",
        )[0]
        .metrics[0]
    )

    assert metric.value == 0.7375
    assert metric.details["call_assessments"][0]["reported_score"] == 1
    assert metric.details["call_assessments"][0]["score"] == 0.7375
    assert fake_model.payload is not None
    assert fake_model.payload["tool_calls"][0]["tool_description"] == ""


def test_tool_argument_correctness_is_not_applicable_without_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_if_model_is_loaded(*_args):
        raise AssertionError("The judge model must not be loaded for a non-applicable row.")

    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", fail_if_model_is_loaded)
    item = AgentEvaluationItem(index=0, inputs={"task": "Say hello."}, output="Hello!", available_tools=[])

    result = AgentLLMJudgeEvaluator().evaluate(
        [item],
        ["tool_argument_correctness"],
        "provider",
        "model",
        "tenant",
    )[0]

    assert result.error is None
    assert result.metrics[0].value is None
    assert result.metrics[0].details["status"] == "not_applicable"


def test_tool_selection_evaluates_hallucinated_call_when_no_tools_were_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_model = _FakeJudgeModel(
        ToolSelectionJudgeOutput(
            score=0,
            reason="The selected tool was not available.",
            criteria=ToolSelectionCriteria(
                required_capability_coverage=_criterion(0),
                selected_tool_fit=_criterion(0),
                irrelevant_selection_avoidance=_criterion(0),
            ),
        )
    )
    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", lambda *_args: fake_model)
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Say hello."},
        output="Hello!",
        tool_calls=[AgentToolCall(name="made_up_tool", call_id="call-1")],
        available_tools=[],
    )

    result = AgentLLMJudgeEvaluator().evaluate(
        [item],
        ["tool_selection_correctness"],
        "provider",
        "model",
        "tenant",
    )[0]

    assert result.error is None
    assert result.metrics[0].value == 0


def test_tool_selection_payload_excludes_arguments_and_tool_schemas() -> None:
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Get the weather."},
        output="Sunny",
        tool_calls=[AgentToolCall(name="weather", call_id="call-1", arguments={"city": "Paris"})],
        available_tools=[
            AgentToolDefinition(
                tool_ref="weather/weather",
                name="weather",
                description="Get weather.",
                input_schema={"type": "object", "properties": {"city": {"type": "string"}}},
            )
        ],
    )

    payload = _tool_selection_payload(item)

    serialized = str(payload)
    assert "Paris" not in serialized
    assert "input_schema" not in serialized
    assert payload["tool_selection_events"][0]["selected_tool_ref"] == "weather"


def test_agent_judge_sanitizer_redacts_secrets_and_truncates_large_values() -> None:
    warnings: list[str] = []

    sanitized = _sanitize_value(
        {
            "api_key": "secret",
            "result": "x" * 8_100,
            "model_visible_input_schema": {
                "properties": {"api_key": {"type": "string"}},
            },
        },
        warnings,
    )

    assert sanitized["api_key"] == "[REDACTED]"
    assert sanitized["result"].endswith("...[truncated]")
    assert sanitized["model_visible_input_schema"]["properties"]["api_key"] == {"type": "string"}
    assert len(warnings) == 2


def test_agent_judge_sanitizer_enforces_a_total_payload_budget() -> None:
    warnings: list[str] = []

    sanitized = _sanitize_value(
        {"observations": [{"content": "x" * 8_000} for _ in range(80)]},
        warnings,
    )

    assert len(str(sanitized)) < 70_000
    assert any("payload size limit" in warning for warning in warnings)


def test_agent_judge_prompts_are_english_and_contain_injection_defenses() -> None:
    version, prompt = get_agent_judge_prompt("trajectory_quality")

    assert version == "agent.trajectory_quality.v1"
    assert "untrusted evidence" in prompt
    assert "private chain-of-thought" in prompt
    assert "TARGET METRIC: trajectory_quality" in prompt

    task_version, task_prompt = get_agent_judge_prompt("task_completion")
    assert task_version == "agent.task_completion.v2"
    assert "exactly one success_criteria_assessment" in task_prompt
    assert "contains no matching successful call" in task_prompt
