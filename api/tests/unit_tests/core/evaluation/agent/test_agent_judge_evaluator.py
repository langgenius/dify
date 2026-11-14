from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import TypeVar

import pytest
from pydantic import BaseModel

from core.evaluation.agent import agent_judge_evaluator
from core.evaluation.agent.agent_judge_evaluator import (
    AgentLLMJudgeEvaluator,
    CriterionAssessment,
    SuccessCriterionAssessment,
    TaskCompletionCriteria,
    TaskCompletionJudgeOutput,
    ToolArgumentCriteria,
    ToolArgumentJudgeOutput,
    ToolSelectionCriteria,
    ToolSelectionJudgeOutput,
    TrajectoryQualityCriteria,
    TrajectoryQualityJudgeOutput,
    _sanitize_value,
    _strict_judge_json_schema,
    _task_completion_payload,
    _tool_argument_batch_schema,
    _tool_argument_payload,
    _tool_selection_payload,
    _validated_success_criteria_assessments,
    _weighted_score,
)
from core.evaluation.agent.judge_prompts import get_agent_judge_prompt
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    AgentToolDefinition,
    AgentTrajectory,
    AgentTrajectoryStep,
)

_JudgeOutput = TypeVar("_JudgeOutput", bound=BaseModel)


class _FakeJudgeModel:
    model_identifier = "provider/model"

    def __init__(self, output: object) -> None:
        self.output = output
        self.payload: dict[str, object] | None = None
        self.system_prompt = ""

    def generate(
        self, *, system_prompt: str, payload: Mapping[str, object], schema: type[_JudgeOutput]
    ) -> _JudgeOutput:
        self.system_prompt = system_prompt
        self.payload = dict(payload)
        assert isinstance(self.output, schema)
        return self.output


class _FakeToolArgumentJudgeModel:
    model_identifier = "provider/model"

    def __init__(self, outputs: Sequence[object]) -> None:
        self.outputs = outputs
        self.payload: dict[str, object] | None = None
        self.system_prompt = ""
        self.call_count = 0

    def generate(
        self, *, system_prompt: str, payload: Mapping[str, object], schema: type[_JudgeOutput]
    ) -> _JudgeOutput:
        self.call_count += 1
        self.system_prompt = system_prompt
        self.payload = dict(payload)
        keys = [f"call_{index}" for index in range(1, len(self.outputs) + 1)]
        assert list(schema.model_fields) == keys
        assert _strict_judge_json_schema(schema)["required"] == keys
        return schema(**dict(zip(keys, self.outputs, strict=True)))


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
        _tool_argument_batch_schema(2),
    ],
)
def test_agent_judge_json_schema_is_strict_at_every_object_level(schema_model: type) -> None:
    schema = _strict_judge_json_schema(schema_model)

    def assert_strict(value: object) -> None:
        if isinstance(value, dict):
            assert "multipleOf" not in value
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
                correctness_and_evidence_consistency=_criterion(0.6),
                completeness=_criterion(1.0),
            ),
            success_criteria_assessments=[
                SuccessCriterionAssessment(
                    criterion_id="success-criterion-1",
                    applicable=True,
                    score=0.7,
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
    assert result.metrics[0].value == 0.725
    assert result.metrics[0].details["criteria"]["goal_satisfaction"]["score"] == 0.7
    assert result.metrics[0].details["reported_score"] == 0.99
    assert result.metrics[0].details["prompt_version"] == "agent.task_completion.v2"
    assert fake_model.payload is not None
    assert fake_model.payload["success_criteria"] == [
        {"criterion_id": "success-criterion-1", "requirement": "Use the real shipment status."}
    ]
    assert result.metrics[0].details["success_criteria_assessments"][0]["score"] == 0.7
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
    fake_model = _FakeToolArgumentJudgeModel(
        [
            ToolArgumentJudgeOutput(
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
        ]
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
    assert metric.details["call_assessments"][0]["tool_call_id"] == "call-1"
    assert metric.details["prompt_version"] == "agent.tool_argument_correctness.v4"
    assert fake_model.call_count == 1
    assert fake_model.payload is not None
    tool_calls = fake_model.payload["tool_calls"]
    assert isinstance(tool_calls, list)
    first_call = tool_calls[0]
    assert isinstance(first_call, dict)
    assert first_call["tool_description"] == ""
    assert first_call["assessment_key"] == "call_1"
    assert "call_assessments" not in _strict_judge_json_schema(ToolArgumentJudgeOutput)["properties"]


def test_tool_argument_correctness_judges_multiple_calls_independently(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_model = _FakeToolArgumentJudgeModel(
        [
            ToolArgumentJudgeOutput(
                score=score,
                reason=f"Assessment for call_{index}.",
                criteria=ToolArgumentCriteria(
                    schema_conformance=_criterion(score),
                    required_parameter_coverage=_criterion(score),
                    semantic_value_correctness=_criterion(score),
                    context_consistency=_criterion(score),
                ),
            )
            for index, score in enumerate((0.6, 1.0), start=1)
        ]
    )
    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", lambda *_args: fake_model)
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Convert both times."},
        output="Converted both times.",
        tool_calls=[
            AgentToolCall(name="convert", call_id="call-1", tool_ref="time/convert", arguments={"time": "09:00"}),
            AgentToolCall(name="convert", call_id="call-2", tool_ref="time/convert", arguments={"time": "10:00"}),
        ],
        available_tools=[
            AgentToolDefinition(
                tool_ref="time/convert",
                name="convert",
                input_schema={"type": "object", "properties": {"time": {"type": "string"}}},
            )
        ],
    )

    result = AgentLLMJudgeEvaluator().evaluate([item], ["tool_argument_correctness"], "provider", "model", "tenant")[0]

    assert result.error is None
    assert fake_model.call_count == 1
    assert fake_model.payload is not None
    tool_calls = fake_model.payload["tool_calls"]
    assert isinstance(tool_calls, list)
    assert all(isinstance(call, dict) for call in tool_calls)
    assert [call["assessment_key"] for call in tool_calls] == ["call_1", "call_2"]
    assert result.metrics[0].value == 0.8
    assert [assessment["tool_call_id"] for assessment in result.metrics[0].details["call_assessments"]] == [
        "call-1",
        "call-2",
    ]


def test_tool_argument_correctness_truncates_long_explanations_without_losing_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = ToolArgumentJudgeOutput(
        score=0.6,
        reason="The arguments need review.",
        criteria=ToolArgumentCriteria(
            schema_conformance=_criterion(0.6),
            required_parameter_coverage=_criterion(0.6),
            semantic_value_correctness=_criterion(0.6),
            context_consistency=_criterion(0.6),
        ),
    ).model_dump(mode="json")
    raw_outputs = [deepcopy(output) for _ in range(5)]
    raw_outputs[2]["reason"] = "Long tool-call explanation. " * 100
    raw_outputs[2]["criteria"]["semantic_value_correctness"]["reason"] = "Long criterion explanation. " * 100
    fake_model = _FakeToolArgumentJudgeModel(raw_outputs)
    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", lambda *_args: fake_model)
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Convert five times."},
        output="Converted five times.",
        tool_calls=[
            AgentToolCall(
                name="convert",
                call_id=f"call-{index}",
                tool_ref="time/convert",
                arguments={"time": f"{index:02d}:00"},
            )
            for index in range(1, 6)
        ],
        available_tools=[
            AgentToolDefinition(
                tool_ref="time/convert",
                name="convert",
                input_schema={"type": "object", "properties": {"time": {"type": "string"}}},
            )
        ],
    )

    result = AgentLLMJudgeEvaluator().evaluate([item], ["tool_argument_correctness"], "provider", "model", "tenant")[0]

    assert result.error is None
    assert fake_model.call_count == 1
    metric = result.metrics[0]
    assert metric.value == 0.6
    assert len(metric.details["call_assessments"]) == 5
    third_assessment = metric.details["call_assessments"][2]
    assert third_assessment["tool_call_id"] == "call-3"
    assert len(third_assessment["reason"]) == 500
    assert third_assessment["reason"].endswith("… [truncated]")
    criterion_reason = third_assessment["criteria"]["semantic_value_correctness"]["reason"]
    assert len(criterion_reason) == 300
    assert criterion_reason.endswith("… [truncated]")


def test_tool_argument_correctness_is_not_applicable_without_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_if_model_is_loaded(*_args: object) -> None:
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


def test_tool_selection_payload_binds_observations_before_each_call() -> None:
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Look up the weather twice."},
        output="Sunny",
        available_tools=[AgentToolDefinition(tool_ref="weather/weather", name="weather")],
        trajectory=AgentTrajectory(
            source="legacy",
            steps=[
                AgentTrajectoryStep(
                    step_id="first-result", sequence=1, step_type="tool_result", content="Paris: sunny"
                ),
                AgentTrajectoryStep(
                    step_id="second-call",
                    sequence=2,
                    step_type="tool_call",
                    tool_call_id="call-2",
                    tool_ref="weather/weather",
                ),
                AgentTrajectoryStep(step_id="second-error", sequence=3, step_type="error", error="timeout"),
                AgentTrajectoryStep(
                    step_id="third-call",
                    sequence=4,
                    step_type="tool_call",
                    tool_call_id="call-3",
                    tool_ref="weather/weather",
                ),
            ],
        ),
    )

    events = _tool_selection_payload(item)["tool_selection_events"]

    assert [event["tool_call_id"] for event in events] == ["call-2", "call-3"]
    assert [step["step_id"] for step in events[0]["preceding_observations"]] == ["first-result"]
    assert [step["step_id"] for step in events[1]["preceding_observations"]] == ["first-result", "second-error"]


def test_tool_argument_payload_marks_calls_without_visible_schema_unassessable() -> None:
    item = AgentEvaluationItem(
        index=0,
        inputs={"task": "Check the weather."},
        output="Done",
        tool_calls=[
            AgentToolCall(name="unknown", call_id="call-1"),
            AgentToolCall(name="weather", call_id="call-2"),
        ],
        available_tools=[AgentToolDefinition(tool_ref="weather/weather", name="weather", schema_available=False)],
    )

    payload, assessable_ids, warnings = _tool_argument_payload(item)

    assert payload["tool_calls"] == []
    assert assessable_ids == []
    assert len(warnings) == 2
    assert "could not be matched" in warnings[0]
    assert "no captured model-visible input schema" in warnings[1]


@pytest.mark.parametrize(
    ("metric", "available_tools", "tool_calls", "expected_status", "expected_error"),
    [
        ("tool_selection_correctness", [], [], "not_applicable", None),
        ("tool_selection_correctness", None, [], None, "runtime tool snapshot is missing"),
        ("tool_argument_correctness", None, [AgentToolCall(name="weather")], None, "runtime tool snapshot is missing"),
        ("trajectory_quality", [], [], None, "normalized Agent trajectory is missing"),
    ],
)
def test_agent_judge_preconditions_return_row_local_results(
    monkeypatch: pytest.MonkeyPatch,
    metric: str,
    available_tools: list[AgentToolDefinition] | None,
    tool_calls: list[AgentToolCall],
    expected_status: str | None,
    expected_error: str | None,
) -> None:
    def unexpected_judge(*_args: object) -> None:
        pytest.fail("A precondition failure must not invoke the judge model")

    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", unexpected_judge)
    result = AgentLLMJudgeEvaluator().evaluate(
        [
            AgentEvaluationItem(
                index=3,
                inputs={"task": "Check the weather."},
                output="Done",
                tool_calls=tool_calls,
                available_tools=available_tools,
            )
        ],
        [metric],
        "provider",
        "model",
        "tenant",
    )[0]

    assert result.index == 3
    if expected_status is not None:
        assert result.metrics[0].details["status"] == expected_status
    if expected_error is not None:
        assert expected_error in (result.error or "")


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


def test_trajectory_quality_judge_bounds_long_traces_and_preserves_warnings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_model = _FakeJudgeModel(
        TrajectoryQualityJudgeOutput(
            score=0.95,
            reason="Mostly coherent trajectory.",
            criteria=TrajectoryQualityCriteria(
                progress_and_coherence=_criterion(0.75),
                efficiency=_criterion(0.75),
                observation_usage=_criterion(0.75),
                error_recovery=_criterion(0.75),
            ),
        )
    )
    monkeypatch.setattr(agent_judge_evaluator, "_DifyAgentJudgeModel", lambda *_args: fake_model)
    steps = [
        AgentTrajectoryStep(
            step_id=f"message-{index}",
            sequence=index,
            step_type="agent_message",
            content=f"step {index}",
            status="succeeded",
        )
        for index in range(82)
    ]
    steps.append(
        AgentTrajectoryStep(
            step_id="tool-result",
            sequence=82,
            step_type="tool_result",
            content="Weather observed.",
            status="succeeded",
        )
    )
    item = AgentEvaluationItem(
        index=7,
        inputs={"task": "Check the weather."},
        output="Sunny.",
        trajectory=AgentTrajectory(source="agent_v2", steps=steps, warnings=["trace gap"]),
    )

    result = AgentLLMJudgeEvaluator().evaluate([item], ["trajectory_quality"], "provider", "model", "tenant")[0]

    assert result.metrics[0].value == 0.75
    assert result.metrics[0].details["reported_score"] == 0.95
    assert fake_model.payload is not None
    trajectory = fake_model.payload["trajectory"]
    assert isinstance(trajectory, dict)
    bounded_steps = trajectory["steps"]
    assert isinstance(bounded_steps, list)
    assert len(bounded_steps) == 80
    assert bounded_steps[-1]["content"] == "Weather observed."
    assert trajectory["warnings"][0] == "trace gap"
    assert "truncated from 83 to 80" in trajectory["warnings"][1]


def test_task_completion_payload_uses_tool_calls_when_trace_is_unavailable() -> None:
    tool = AgentToolDefinition(
        tool_ref="core:weather",
        name="weather",
        display_name="Weather",
        description="Look up weather.",
        input_schema={"type": "object"},
    )
    item = AgentEvaluationItem(
        index=1,
        inputs={"task": "Check the weather."},
        output="Sunny.",
        tool_calls=[AgentToolCall(name="weather", call_id="call-1", tool_ref=tool.tool_ref, output="Sunny")],
        available_tools=[tool],
    )

    payload = _task_completion_payload(item)

    assert payload["observed_tool_calls"][0]["tool_display_name"] == "Weather"
    assert payload["observed_tool_calls"][0]["tool_description"] == "Look up weather."
    assert payload["evidence_observations"][0]["observation"] == "Sunny"


def test_weighted_score_requires_at_least_one_applicable_criterion() -> None:
    criteria = TaskCompletionCriteria(
        goal_satisfaction=_criterion(None, applicable=False),
        correctness_and_evidence_consistency=_criterion(None, applicable=False),
        completeness=_criterion(None, applicable=False),
    )
    weights = {
        "goal_satisfaction": 0.45,
        "correctness_and_evidence_consistency": 0.35,
        "completeness": 0.20,
    }

    with pytest.raises(ValueError, match="every rubric criterion"):
        _weighted_score(criteria, weights)


def test_sanitizer_bounds_nested_and_oversized_collections() -> None:
    def wrap(value: object) -> object:
        return {"child": value}

    nested: object = "value"
    for _ in range(15):
        nested = wrap(nested)
    warnings: list[str] = []

    sanitized_nested = _sanitize_value(nested, warnings)
    sanitized_list = _sanitize_value(list(range(100)), warnings)
    sanitized_object = _sanitize_value({f"key-{index}": index for index in range(90)}, warnings)

    assert "TRUNCATED" in str(sanitized_nested)
    assert len(sanitized_list) == 80
    assert len(sanitized_object) == 80
    assert any("deeply nested" in warning for warning in warnings)
    assert any("oversized list" in warning for warning in warnings)
    assert any("oversized object" in warning for warning in warnings)
