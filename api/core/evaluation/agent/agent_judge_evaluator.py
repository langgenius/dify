"""Dify-owned LLM judge for reference-free Agent metrics."""

from __future__ import annotations

import json
import logging
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any, TypeVar, cast

from pydantic import BaseModel, Field, model_validator

from core.evaluation.agent.judge_prompts import get_agent_judge_prompt
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolDefinition,
    AgentTrajectoryStep,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationMetricName,
)
from libs.structured_output_schema import to_strict_json_schema

logger = logging.getLogger(__name__)

_MAX_STRING_CHARS = 8_000
_MAX_COLLECTION_ITEMS = 80
_MAX_TRAJECTORY_STEPS = 80
_MAX_PAYLOAD_CHARS = 64_000
_MAX_NESTING_DEPTH = 12
_SENSITIVE_KEY = re.compile(
    r"^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|credentials?|private[_-]?key)$",
    flags=re.IGNORECASE,
)

_TASK_COMPLETION_WEIGHTS = {
    "goal_satisfaction": 0.45,
    "correctness_and_evidence_consistency": 0.35,
    "completeness": 0.20,
}
_TRAJECTORY_QUALITY_WEIGHTS = {
    "progress_and_coherence": 0.30,
    "efficiency": 0.25,
    "observation_usage": 0.25,
    "error_recovery": 0.20,
}
_TOOL_SELECTION_WEIGHTS = {
    "required_capability_coverage": 0.40,
    "selected_tool_fit": 0.40,
    "irrelevant_selection_avoidance": 0.20,
}
_TOOL_ARGUMENT_WEIGHTS = {
    "schema_conformance": 0.20,
    "required_parameter_coverage": 0.20,
    "semantic_value_correctness": 0.45,
    "context_consistency": 0.15,
}

_JudgeOutputT = TypeVar("_JudgeOutputT", bound=BaseModel)


class CriterionAssessment(BaseModel):
    applicable: bool = True
    score: float | None = Field(ge=0, le=1, multiple_of=0.25)
    reason: str = Field(min_length=1, max_length=2_000)
    evidence_step_ids: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_applicability(self) -> CriterionAssessment:
        if self.applicable and self.score is None:
            raise ValueError("An applicable criterion must have a score.")
        if not self.applicable and self.score is not None:
            raise ValueError("An inapplicable criterion must have a null score.")
        return self


class TaskCompletionCriteria(BaseModel):
    goal_satisfaction: CriterionAssessment
    correctness_and_evidence_consistency: CriterionAssessment
    completeness: CriterionAssessment


class SuccessCriterionAssessment(CriterionAssessment):
    criterion_id: str = Field(min_length=1)


class TrajectoryQualityCriteria(BaseModel):
    progress_and_coherence: CriterionAssessment
    efficiency: CriterionAssessment
    observation_usage: CriterionAssessment
    error_recovery: CriterionAssessment


class ToolSelectionCriteria(BaseModel):
    required_capability_coverage: CriterionAssessment
    selected_tool_fit: CriterionAssessment
    irrelevant_selection_avoidance: CriterionAssessment


class ToolArgumentCriteria(BaseModel):
    schema_conformance: CriterionAssessment
    required_parameter_coverage: CriterionAssessment
    semantic_value_correctness: CriterionAssessment
    context_consistency: CriterionAssessment


class _JudgeOutputBase(BaseModel):
    score: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=2_000)
    evidence_step_ids: list[str] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=20)


class TaskCompletionJudgeOutput(_JudgeOutputBase):
    criteria: TaskCompletionCriteria
    success_criteria_assessments: list[SuccessCriterionAssessment] = Field(
        default_factory=list,
        max_length=_MAX_COLLECTION_ITEMS,
    )
    failed_criteria: list[str] = Field(default_factory=list)


class TrajectoryQualityJudgeOutput(_JudgeOutputBase):
    criteria: TrajectoryQualityCriteria
    failed_criteria: list[str] = Field(default_factory=list)


class ToolSelectionJudgeOutput(_JudgeOutputBase):
    criteria: ToolSelectionCriteria
    failed_criteria: list[str] = Field(default_factory=list)


class ToolCallArgumentAssessment(BaseModel):
    tool_call_id: str = Field(min_length=1)
    tool_ref: str = Field(min_length=1)
    score: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=2_000)
    criteria: ToolArgumentCriteria
    failed_parameter_paths: list[str] = Field(default_factory=list, max_length=50)
    evidence_step_ids: list[str] = Field(default_factory=list, max_length=30)


class ToolArgumentJudgeOutput(_JudgeOutputBase):
    call_assessments: list[ToolCallArgumentAssessment] = Field(min_length=1)


class _NotApplicableError(Exception):
    pass


class _DifyAgentJudgeModel:
    """Invoke a tenant-scoped Dify model with strict structured output."""

    def __init__(self, model_provider: str, model_name: str, tenant_id: str) -> None:
        from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
        from graphon.model_runtime.entities.model_entities import ModelType

        manager = create_plugin_model_manager(tenant_id=tenant_id, user_id=None)
        self._model = manager.get_model_instance(
            tenant_id=tenant_id,
            provider=model_provider,
            model_type=ModelType.LLM,
            model=model_name,
        )
        self.model_identifier = f"{model_provider}/{model_name}"

    def generate(
        self,
        *,
        system_prompt: str,
        payload: Mapping[str, Any],
        schema: type[_JudgeOutputT],
    ) -> _JudgeOutputT:
        from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
        from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage

        prompt_messages = [
            SystemPromptMessage(content=system_prompt),
            UserPromptMessage(
                content="EVALUATION_DATA\n" + json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
            ),
        ]
        structured_result = invoke_llm_with_structured_output(
            provider=self._model.provider,
            model_schema=self._model.get_model_schema(),
            model_instance=self._model,
            prompt_messages=prompt_messages,
            json_schema=_strict_judge_json_schema(schema),
            model_parameters={"temperature": 0.0},
            stream=False,
        )
        return schema.model_validate(structured_result.structured_output)


class AgentLLMJudgeEvaluator:
    """Evaluate Dify-native Agent metrics without delegating semantics to an external framework."""

    def evaluate(
        self,
        items: Sequence[AgentEvaluationItem],
        metric_names: Sequence[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        judge_model: _DifyAgentJudgeModel | None = None
        results: list[EvaluationItemResult] = []
        for item in items:
            metrics: list[EvaluationMetric] = []
            errors: list[str] = []
            for metric_name in metric_names:
                try:
                    precomputed = self._precomputed_metric(item, metric_name)
                    if precomputed is not None:
                        metrics.append(precomputed)
                        continue
                    if judge_model is None:
                        judge_model = _DifyAgentJudgeModel(model_provider, model_name, tenant_id)
                    metrics.append(self._evaluate_metric(item, metric_name, judge_model))
                except _NotApplicableError as exc:
                    metrics.append(
                        EvaluationMetric(
                            name=metric_name,
                            value=None,
                            details={"status": "not_applicable", "reason": str(exc)},
                        )
                    )
                except Exception as exc:
                    logger.exception("Agent metric %s failed for item %d", metric_name, item.index)
                    errors.append(f"Metric '{metric_name}' failed: {exc}")

            results.append(
                EvaluationItemResult(
                    index=item.index,
                    actual_output=item.output,
                    metrics=metrics,
                    error="; ".join(errors) if errors else None,
                )
            )
        return results

    @staticmethod
    def _precomputed_metric(item: AgentEvaluationItem, metric_name: str) -> EvaluationMetric | None:
        if metric_name == EvaluationMetricName.TOOL_SELECTION_CORRECTNESS.value:
            if item.available_tools is None:
                raise ValueError("The runtime tool snapshot is missing.")
            if not item.available_tools and not item.tool_calls:
                raise _NotApplicableError("The Agent had no tools available for this dataset row.")
        elif metric_name == EvaluationMetricName.TOOL_ARGUMENT_CORRECTNESS.value:
            if not item.tool_calls:
                raise _NotApplicableError("The Agent did not call any tools for this dataset row.")
            if item.available_tools is None:
                raise ValueError("The runtime tool snapshot is missing.")
        elif metric_name == EvaluationMetricName.TRAJECTORY_QUALITY.value and item.trajectory is None:
            raise ValueError("The normalized Agent trajectory is missing.")
        return None

    def _evaluate_metric(
        self,
        item: AgentEvaluationItem,
        metric_name: str,
        judge_model: _DifyAgentJudgeModel,
    ) -> EvaluationMetric:
        prompt_version, system_prompt = get_agent_judge_prompt(metric_name)
        payload_warnings: list[str] = []
        assessable_call_ids: list[str] = []
        schema: type[_JudgeOutputBase]

        if metric_name == EvaluationMetricName.TASK_COMPLETION.value:
            payload = _task_completion_payload(item)
            schema = TaskCompletionJudgeOutput
            weights = _TASK_COMPLETION_WEIGHTS
        elif metric_name == EvaluationMetricName.TRAJECTORY_QUALITY.value:
            payload = _trajectory_quality_payload(item)
            payload_warnings = list(payload["trajectory"]["warnings"])
            schema = TrajectoryQualityJudgeOutput
            weights = _TRAJECTORY_QUALITY_WEIGHTS
        elif metric_name == EvaluationMetricName.TOOL_SELECTION_CORRECTNESS.value:
            payload = _tool_selection_payload(item)
            schema = ToolSelectionJudgeOutput
            weights = _TOOL_SELECTION_WEIGHTS
        elif metric_name == EvaluationMetricName.TOOL_ARGUMENT_CORRECTNESS.value:
            payload, assessable_call_ids, payload_warnings = _tool_argument_payload(item)
            if not assessable_call_ids:
                raise _NotApplicableError("No called tool had a captured model-visible input schema.")
            schema = ToolArgumentJudgeOutput
            weights = _TOOL_ARGUMENT_WEIGHTS
        else:
            raise ValueError(f"Unsupported native Agent metric: {metric_name}")

        sanitization_warnings: list[str] = []
        sanitized_payload = _sanitize_value(payload, sanitization_warnings)
        if not isinstance(sanitized_payload, Mapping):
            raise TypeError("The sanitized Agent evaluation payload must be an object.")
        sanitized_payload = dict(sanitized_payload)
        if sanitization_warnings:
            sanitized_payload["data_limitations"] = _dedupe_strings(sanitization_warnings)
        if metric_name == EvaluationMetricName.TOOL_ARGUMENT_CORRECTNESS.value:
            sanitized_calls = sanitized_payload.get("tool_calls")
            if not isinstance(sanitized_calls, list):
                raise ValueError("The sanitized tool-call payload is missing.")
            complete_calls = [
                call
                for call in sanitized_calls
                if (
                    isinstance(call, Mapping)
                    and call.get("tool_call_id")
                    and "model_visible_input_schema" in call
                    and "arguments" in call
                )
            ]
            sanitized_payload["tool_calls"] = complete_calls
            assessable_call_ids = [str(call["tool_call_id"]) for call in complete_calls]
            if not assessable_call_ids:
                raise _NotApplicableError("No tool call fit within the safe evaluation payload limits.")
        judge_output = judge_model.generate(
            system_prompt=system_prompt,
            payload=sanitized_payload,
            schema=schema,
        )

        details: dict[str, Any]
        if isinstance(judge_output, ToolArgumentJudgeOutput):
            sanitized_calls = cast(list[Mapping[str, Any]], sanitized_payload["tool_calls"])
            expected_tool_refs = {
                str(call["tool_call_id"]): str(call["tool_ref"])
                for call in sanitized_calls
                if call.get("tool_call_id") and call.get("tool_ref")
            }
            expected_call_ids = set(expected_tool_refs)
            returned_call_ids = [assessment.tool_call_id for assessment in judge_output.call_assessments]
            if len(returned_call_ids) != len(set(returned_call_ids)) or set(returned_call_ids) != expected_call_ids:
                raise ValueError("The judge did not return exactly one assessment for every assessable tool call.")
            if any(
                assessment.tool_ref != expected_tool_refs[assessment.tool_call_id]
                for assessment in judge_output.call_assessments
            ):
                raise ValueError("The judge returned a mismatched tool reference for an assessed call.")
            recomputed_call_scores: dict[str, float] = {}
            serialized_assessments: list[dict[str, Any]] = []
            for assessment in judge_output.call_assessments:
                score = _weighted_score(assessment.criteria, weights)
                recomputed_call_scores[assessment.tool_call_id] = score
                serialized = assessment.model_dump(mode="json")
                serialized["reported_score"] = serialized.pop("score")
                serialized["score"] = score
                serialized_assessments.append(serialized)
            score = round(sum(recomputed_call_scores.values()) / len(recomputed_call_scores), 4)
            details = {
                "status": "evaluated",
                "reason": judge_output.reason,
                "call_assessments": serialized_assessments,
                "evidence_step_ids": judge_output.evidence_step_ids,
                "warnings": _dedupe_strings([*payload_warnings, *sanitization_warnings, *judge_output.warnings]),
                "reported_score": judge_output.score,
                "prompt_version": prompt_version,
                "evaluator_model": judge_model.model_identifier,
            }
        else:
            if not isinstance(
                judge_output,
                TaskCompletionJudgeOutput | TrajectoryQualityJudgeOutput | ToolSelectionJudgeOutput,
            ):
                raise TypeError(f"Unexpected Agent judge output: {type(judge_output).__name__}")
            effective_criteria = judge_output.criteria
            effective_task_criteria: TaskCompletionCriteria | None = None
            serialized_success_criteria: list[dict[str, Any]] | None = None
            if isinstance(judge_output, TaskCompletionJudgeOutput):
                ordered_assessments = _validated_success_criteria_assessments(
                    sanitized_payload,
                    judge_output.success_criteria_assessments,
                )
                effective_task_criteria = _apply_success_criteria_to_task_completion(
                    judge_output.criteria,
                    ordered_assessments,
                )
                effective_criteria = effective_task_criteria
                serialized_success_criteria = [assessment.model_dump(mode="json") for assessment in ordered_assessments]

            score = _weighted_score(effective_criteria, weights)
            serialized_criteria = effective_criteria.model_dump(mode="json")
            if isinstance(judge_output, TaskCompletionJudgeOutput) and effective_task_criteria is not None:
                reported_goal_score = judge_output.criteria.goal_satisfaction.score
                effective_goal_score = effective_task_criteria.goal_satisfaction.score
                if effective_goal_score != reported_goal_score:
                    serialized_criteria["goal_satisfaction"]["reported_score"] = reported_goal_score
            details = {
                "status": "evaluated",
                "reason": judge_output.reason,
                "criteria": serialized_criteria,
                "failed_criteria": judge_output.failed_criteria,
                "evidence_step_ids": judge_output.evidence_step_ids,
                "warnings": _dedupe_strings([*payload_warnings, *sanitization_warnings, *judge_output.warnings]),
                "reported_score": judge_output.score,
                "prompt_version": prompt_version,
                "evaluator_model": judge_model.model_identifier,
            }
            if serialized_success_criteria is not None:
                details["success_criteria_assessments"] = serialized_success_criteria
        return EvaluationMetric(name=metric_name, value=score, details=details)


def _validated_success_criteria_assessments(
    payload: Mapping[str, Any],
    assessments: Sequence[SuccessCriterionAssessment],
) -> list[SuccessCriterionAssessment]:
    raw_criteria = payload.get("success_criteria")
    if not isinstance(raw_criteria, list):
        raise ValueError("The sanitized success-criteria payload is missing.")

    expected_ids = [
        str(criterion.get("criterion_id"))
        for criterion in raw_criteria
        if isinstance(criterion, Mapping) and criterion.get("criterion_id")
    ]
    returned_ids = [assessment.criterion_id for assessment in assessments]
    if len(expected_ids) != len(raw_criteria):
        raise ValueError("The sanitized success-criteria payload is invalid.")
    if len(returned_ids) != len(set(returned_ids)) or set(returned_ids) != set(expected_ids):
        raise ValueError("The judge did not return exactly one assessment for every success criterion.")
    if any(not assessment.applicable for assessment in assessments) and not payload.get("data_limitations"):
        raise ValueError("The judge marked a success criterion inapplicable without an explicit data limitation.")

    assessments_by_id = {assessment.criterion_id: assessment for assessment in assessments}
    return [assessments_by_id[criterion_id] for criterion_id in expected_ids]


def _apply_success_criteria_to_task_completion(
    criteria: TaskCompletionCriteria,
    assessments: Sequence[SuccessCriterionAssessment],
) -> TaskCompletionCriteria:
    assessment_scores = [
        float(assessment.score) for assessment in assessments if assessment.applicable and assessment.score is not None
    ]
    if not assessment_scores:
        return criteria

    goal_satisfaction = criteria.goal_satisfaction
    effective_score = min(
        *assessment_scores,
        float(goal_satisfaction.score) if goal_satisfaction.applicable and goal_satisfaction.score is not None else 1.0,
    )
    effective_goal_satisfaction = goal_satisfaction.model_copy(
        update={
            "applicable": True,
            "score": effective_score,
        }
    )
    return criteria.model_copy(update={"goal_satisfaction": effective_goal_satisfaction})


def _strict_judge_json_schema(schema: type[BaseModel]) -> dict[str, Any]:
    """Build a JSON Schema accepted by strict structured-output providers."""
    return to_strict_json_schema(schema.model_json_schema())


def _task_completion_payload(item: AgentEvaluationItem) -> dict[str, Any]:
    observations = _observation_steps(item)
    if not observations:
        observations = [
            {
                "step_id": call.call_id or f"tool-call-{position}",
                "tool_ref": call.tool_ref or call.name,
                "status": "unknown",
                "observation": call.output,
            }
            for position, call in enumerate(item.tool_calls, start=1)
            if call.output is not None
        ]
    return {
        "task": str(item.inputs.get("task", "")),
        "final_output": item.output,
        "success_criteria": [
            {"criterion_id": f"success-criterion-{position}", "requirement": requirement}
            for position, requirement in enumerate(item.success_criteria or [], start=1)
        ],
        "observed_tool_calls": _task_completion_tool_calls(item),
        "evidence_observations": observations,
    }


def _task_completion_tool_calls(item: AgentEvaluationItem) -> list[dict[str, Any]]:
    tool_by_ref = {tool.tool_ref: tool for tool in item.available_tools or []}
    tool_by_name = {tool.name: tool for tool in item.available_tools or []}
    calls: list[dict[str, Any]] = []
    seen_call_ids: set[str] = set()

    if item.trajectory is not None:
        for step in sorted(item.trajectory.steps, key=lambda candidate: candidate.sequence):
            if step.step_type != "tool_call":
                continue
            call_id = step.tool_call_id or step.step_id
            if call_id in seen_call_ids:
                continue
            seen_call_ids.add(call_id)
            tool = tool_by_ref.get(step.tool_ref or "") or tool_by_name.get(step.tool_name or "")
            calls.append(
                {
                    "step_id": step.step_id,
                    "tool_call_id": call_id,
                    "tool_ref": step.tool_ref or step.tool_name or "",
                    "tool_name": step.tool_name or (tool.name if tool else ""),
                    "tool_display_name": tool.display_name if tool else "",
                    "tool_description": tool.description if tool else "",
                    "status": step.status,
                    "error": step.error,
                }
            )

    if calls:
        return calls

    for position, call in enumerate(item.tool_calls, start=1):
        call_id = call.call_id or f"tool-call-{position}"
        if call_id in seen_call_ids:
            continue
        seen_call_ids.add(call_id)
        tool = tool_by_ref.get(call.tool_ref or "") or tool_by_name.get(call.name)
        calls.append(
            {
                "step_id": call_id,
                "tool_call_id": call_id,
                "tool_ref": call.tool_ref or call.name,
                "tool_name": call.name,
                "tool_display_name": tool.display_name if tool else "",
                "tool_description": tool.description if tool else "",
                "status": "unknown",
                "error": None,
            }
        )
    return calls


def _trajectory_quality_payload(item: AgentEvaluationItem) -> dict[str, Any]:
    assert item.trajectory is not None
    warnings = list(item.trajectory.warnings)
    ordered_steps = sorted(item.trajectory.steps, key=lambda candidate: candidate.sequence)
    if len(ordered_steps) > _MAX_TRAJECTORY_STEPS:
        warnings.append(f"Trajectory was truncated from {len(ordered_steps)} to {_MAX_TRAJECTORY_STEPS} steps.")
    steps: list[dict[str, Any]] = []
    for step in _bounded_trajectory_steps(ordered_steps):
        serialized = {
            "step_id": step.step_id,
            "parent_step_id": step.parent_step_id,
            "sequence": step.sequence,
            "step_type": step.step_type,
            "actor_id": step.actor_id,
            "tool_ref": step.tool_ref,
            "tool_name": step.tool_name,
            "status": step.status,
            "error": step.error,
            "duration_ms": step.duration_ms,
        }
        if step.step_type in {"tool_result", "error", "final_output"}:
            serialized["content"] = step.content
        steps.append(serialized)
    return {
        "task": str(item.inputs.get("task", "")),
        "trajectory": {
            "schema_version": item.trajectory.schema_version,
            "source": item.trajectory.source,
            "steps": steps,
            "warnings": warnings,
        },
    }


def _tool_selection_payload(item: AgentEvaluationItem) -> dict[str, Any]:
    assert item.available_tools is not None
    events: list[dict[str, Any]] = []
    preceding_observations: list[dict[str, Any]] = []
    if item.trajectory is not None:
        for step in sorted(item.trajectory.steps, key=lambda candidate: candidate.sequence):
            if step.step_type in {"tool_result", "error"}:
                preceding_observations.append(_serialize_observation(step))
            elif step.step_type == "tool_call":
                events.append(
                    {
                        "step_id": step.step_id,
                        "tool_call_id": step.tool_call_id,
                        "selected_tool_ref": step.tool_ref or step.tool_name,
                        "preceding_observations": preceding_observations[-5:],
                    }
                )
    if not events:
        events = [
            {
                "step_id": call.call_id or f"tool-call-{position}",
                "tool_call_id": call.call_id or f"tool-call-{position}",
                "selected_tool_ref": call.tool_ref or call.name,
                "preceding_observations": [],
            }
            for position, call in enumerate(item.tool_calls, start=1)
        ]
    return {
        "task": str(item.inputs.get("task", "")),
        "available_tools": [_serialize_tool_for_selection(tool) for tool in item.available_tools],
        "tool_selection_events": events,
    }


def _tool_argument_payload(item: AgentEvaluationItem) -> tuple[dict[str, Any], list[str], list[str]]:
    assert item.available_tools is not None
    tool_by_ref = {tool.tool_ref: tool for tool in item.available_tools}
    tool_by_name = {tool.name: tool for tool in item.available_tools}
    context_by_call_id = _context_before_tool_calls(item.trajectory.steps if item.trajectory else [])
    payload_calls: list[dict[str, Any]] = []
    assessable_call_ids: list[str] = []
    warnings: list[str] = []
    for position, call in enumerate(item.tool_calls, start=1):
        call_id = call.call_id or f"tool-call-{position}"
        tool = tool_by_ref.get(call.tool_ref or "") or tool_by_name.get(call.name)
        if tool is None:
            warnings.append(f"Tool call '{call_id}' could not be matched to a runtime tool definition.")
            continue
        if not tool.schema_available:
            warnings.append(f"Tool call '{call_id}' had no captured model-visible input schema.")
            continue
        assessable_call_ids.append(call_id)
        payload_calls.append(
            {
                "tool_call_id": call_id,
                "tool_ref": tool.tool_ref,
                "tool_name": tool.name,
                "tool_description": tool.description,
                "model_visible_input_schema": tool.input_schema,
                "arguments": call.arguments,
                "context_before_call": context_by_call_id.get(call_id, []),
            }
        )
    return (
        {
            "task": str(item.inputs.get("task", "")),
            "tool_calls": payload_calls,
        },
        assessable_call_ids,
        warnings,
    )


def _context_before_tool_calls(steps: Sequence[AgentTrajectoryStep]) -> dict[str, list[dict[str, Any]]]:
    context: dict[str, list[dict[str, Any]]] = {}
    observations: list[dict[str, Any]] = []
    for step in sorted(steps, key=lambda candidate: candidate.sequence):
        if step.step_type in {"tool_result", "error"}:
            observations.append(_serialize_observation(step))
        elif step.step_type == "tool_call" and step.tool_call_id:
            context[step.tool_call_id] = observations[-5:]
    return context


def _observation_steps(item: AgentEvaluationItem) -> list[dict[str, Any]]:
    if item.trajectory is None:
        return []
    return [_serialize_observation(step) for step in item.trajectory.steps if step.step_type == "tool_result"]


def _serialize_observation(step: AgentTrajectoryStep) -> dict[str, Any]:
    return {
        "step_id": step.step_id,
        "tool_ref": step.tool_ref or step.tool_name,
        "status": step.status,
        "observation": step.content,
        "error": step.error,
    }


def _serialize_tool_for_selection(tool: AgentToolDefinition) -> dict[str, Any]:
    return {
        "tool_ref": tool.tool_ref,
        "name": tool.name,
        "display_name": tool.display_name,
        "description": tool.description,
    }


def _bounded_trajectory_steps(steps: Sequence[AgentTrajectoryStep]) -> list[AgentTrajectoryStep]:
    if len(steps) <= _MAX_TRAJECTORY_STEPS:
        return list(steps)
    half = _MAX_TRAJECTORY_STEPS // 2
    return [*steps[:half], *steps[-half:]]


def _weighted_score(criteria: BaseModel, weights: Mapping[str, float]) -> float:
    weighted_total = 0.0
    applicable_weight = 0.0
    for criterion_name, weight in weights.items():
        criterion = cast(CriterionAssessment, getattr(criteria, criterion_name))
        if not criterion.applicable:
            continue
        assert criterion.score is not None
        weighted_total += float(criterion.score) * weight
        applicable_weight += weight
    if applicable_weight <= 0:
        raise ValueError("The judge marked every rubric criterion as inapplicable.")
    score = weighted_total / applicable_weight
    if not math.isfinite(score) or score < 0 or score > 1:
        raise ValueError(f"The recomputed judge score is outside [0, 1]: {score}")
    return round(score, 4)


def _sanitize_value(
    value: Any,
    warnings: list[str],
    *,
    path: str = "$",
    _remaining_chars: list[int] | None = None,
    _depth: int = 0,
) -> Any:
    if _remaining_chars is None:
        _remaining_chars = [_MAX_PAYLOAD_CHARS]
    if _depth >= _MAX_NESTING_DEPTH:
        warnings.append(f"Truncated deeply nested data at {path}.")
        return "[TRUNCATED: maximum nesting depth reached]"
    if _remaining_chars[0] <= 0:
        warnings.append("Truncated evaluation data to the payload size limit.")
        return "[TRUNCATED: payload size limit reached]"
    if isinstance(value, str):
        allowed_chars = min(_MAX_STRING_CHARS, _remaining_chars[0])
        if len(value) <= allowed_chars:
            _remaining_chars[0] -= len(value)
            return value
        warnings.append(f"Truncated oversized text at {path}.")
        suffix = "...[truncated]"
        prefix_length = max(0, allowed_chars - len(suffix))
        rendered = value[:prefix_length] + suffix
        _remaining_chars[0] -= len(rendered)
        return rendered
    if isinstance(value, Mapping):
        sanitized: dict[str, Any] = {}
        for raw_key, nested_value in list(value.items())[:_MAX_COLLECTION_ITEMS]:
            if _remaining_chars[0] <= 0:
                warnings.append("Truncated evaluation data to the payload size limit.")
                break
            key = str(raw_key)
            _remaining_chars[0] -= min(len(key) + 4, _remaining_chars[0])
            is_schema_key = ".model_visible_input_schema" in path
            if _SENSITIVE_KEY.fullmatch(key) and not is_schema_key:
                sanitized[key] = "[REDACTED]"
                _remaining_chars[0] -= min(len("[REDACTED]"), _remaining_chars[0])
                warnings.append(f"Redacted a sensitive field at {path}.{key}.")
            else:
                sanitized[key] = _sanitize_value(
                    nested_value,
                    warnings,
                    path=f"{path}.{key}",
                    _remaining_chars=_remaining_chars,
                    _depth=_depth + 1,
                )
        if len(value) > _MAX_COLLECTION_ITEMS:
            warnings.append(f"Truncated oversized object at {path}.")
        return sanitized
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        items = list(value)
        if len(items) > _MAX_COLLECTION_ITEMS:
            warnings.append(f"Truncated oversized list at {path}.")
            half = _MAX_COLLECTION_ITEMS // 2
            items = [*items[:half], *items[-half:]]
        sanitized_items: list[Any] = []
        for index, item in enumerate(items):
            if _remaining_chars[0] <= 0:
                warnings.append("Truncated evaluation data to the payload size limit.")
                break
            sanitized_items.append(
                _sanitize_value(
                    item,
                    warnings,
                    path=f"{path}[{index}]",
                    _remaining_chars=_remaining_chars,
                    _depth=_depth + 1,
                )
            )
        return sanitized_items
    _remaining_chars[0] -= min(len(str(value)) + 2, _remaining_chars[0])
    return value


def _dedupe_strings(values: Sequence[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def merge_agent_evaluation_results(
    items: Sequence[AgentEvaluationItem],
    *result_groups: Sequence[EvaluationItemResult],
) -> list[EvaluationItemResult]:
    """Merge native and legacy framework scores while preserving item order."""
    grouped_by_index = [{result.index: result for result in group} for group in result_groups]
    merged: list[EvaluationItemResult] = []
    for item in items:
        metrics: list[EvaluationMetric] = []
        errors: list[str] = []
        metadata: dict[str, Any] = {}
        actual_output: str | None = item.output
        for group in grouped_by_index:
            result = group.get(item.index)
            if result is None:
                continue
            metrics.extend(result.metrics)
            metadata.update(result.metadata)
            if result.actual_output is not None:
                actual_output = result.actual_output
            if result.error:
                errors.append(result.error)
        merged.append(
            EvaluationItemResult(
                index=item.index,
                actual_output=actual_output,
                metrics=metrics,
                metadata=metadata,
                error="; ".join(errors) if errors else None,
            )
        )
    return merged
