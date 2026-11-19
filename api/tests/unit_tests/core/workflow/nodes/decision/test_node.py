"""Run-time behaviour of the ``decision`` node."""

from collections.abc import Mapping

import pytest

from core.workflow.nodes.decision.entities import (
    DECISION_NODE_TYPE,
    OTHERWISE_HANDLE,
    DecisionNodeData,
    RuleGroup,
)
from core.workflow.nodes.decision.node import DecisionNode, render_rule_group
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.variables.variables import BooleanVariable, FloatVariable, StringVariable

from .conftest import DecisionNodeBuilder, FakeDecisionModel, UnusedFileSaver, build_usage

_MODEL: dict[str, object] = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}


def _rules_data(*outcomes: Mapping[str, object], extras: list[Mapping[str, object]] | None = None) -> dict[str, object]:
    return {
        "type": DECISION_NODE_TYPE,
        "title": "Decision",
        "decide_by": "rules",
        "outcomes": list(outcomes),
        "otherwise": {"label": "Can't decide"},
        "extras": extras or [],
    }


def _llm_data(*outcomes: Mapping[str, object], extras: list[Mapping[str, object]] | None = None) -> dict[str, object]:
    return {
        "type": DECISION_NODE_TYPE,
        "title": "Decision",
        "decide_by": "llm",
        "outcomes": list(outcomes),
        "otherwise": {"label": "Can't decide"},
        "inputs": [{"variable": "message", "value_selector": ["start", "message"]}],
        "model": _MODEL,
        "extras": extras or [],
    }


def _group(*conditions: Mapping[str, object], operator: str = "and") -> dict[str, object]:
    return {"logical_operator": operator, "conditions": list(conditions)}


def _condition(selector: list[str], operator: str, value: object = None) -> dict[str, object]:
    return {"variable_selector": selector, "comparison_operator": operator, "value": value}


def _amount(value: float) -> FloatVariable:
    return FloatVariable(name="amount", value=value, selector=["start", "amount"])


def _country(value: str) -> StringVariable:
    return StringVariable(name="country", value=value, selector=["start", "country"])


def _message(value: str) -> StringVariable:
    return StringVariable(name="message", value=value, selector=["start", "message"])


class TestRulesMode:
    def test_first_matching_outcome_wins(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data(
                {"id": "small", "label": "Small", "when": _group(_condition(["start", "amount"], "<", "10"))},
                {"id": "large", "label": "Large", "when": _group(_condition(["start", "amount"], ">", "1"))},
            ),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == "small"
        assert result.outputs["outcome"] == "Small"
        assert result.edge_source_handle == "small"

    def test_and_requires_every_condition(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data(
                {
                    "id": "jp_big",
                    "label": "JP big",
                    "when": _group(
                        _condition(["start", "amount"], ">", "3"),
                        _condition(["start", "country"], "is", "JP"),
                    ),
                }
            ),
            variables=[_amount(5.0), _country("US")],
        )

        result = node._run()

        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"] == "No rule matched"

    def test_or_accepts_one_condition(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data(
                {
                    "id": "jp_big",
                    "label": "JP big",
                    "when": _group(
                        _condition(["start", "amount"], ">", "100"),
                        _condition(["start", "country"], "is", "JP"),
                        operator="or",
                    ),
                }
            ),
            variables=[_amount(5.0), _country("JP")],
        )

        result = node._run()

        assert result.outputs["outcome_id"] == "jp_big"
        assert result.outputs["reason"] == 'amount > 100 or country is "JP"'

    def test_reason_renders_the_matched_conditions(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data(
                {
                    "id": "jp_big",
                    "label": "JP big",
                    "when": _group(
                        _condition(["start", "amount"], ">", "3"),
                        _condition(["start", "country"], "is", "JP"),
                    ),
                }
            ),
            variables=[_amount(5.0), _country("JP")],
        )

        result = node._run()

        assert result.outputs["reason"] == 'amount > 3 and country is "JP"'

    def test_no_match_falls_back_to_otherwise(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data({"id": "big", "label": "Big", "when": _group(_condition(["start", "amount"], ">", "100"))}),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs == {
            "outcome": "Can't decide",
            "outcome_id": OTHERWISE_HANDLE,
            "reason": "No rule matched",
            "decided_by": "rules",
        }
        assert result.edge_source_handle == OTHERWISE_HANDLE

    def test_missing_input_falls_back_to_otherwise(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data({"id": "big", "label": "Big", "when": _group(_condition(["start", "amount"], ">", "3"))}),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"].startswith("Input missing or invalid:")

    def test_wrong_input_type_falls_back_to_otherwise(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data({"id": "big", "label": "Big", "when": _group(_condition(["start", "country"], ">", "3"))}),
            variables=[_country("JP")],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"].startswith("Input missing or invalid:")

    def test_a_numeric_constant_that_is_not_a_number_fails_the_node(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """F2: ``amount > "not-a-number"`` is a configuration error, not an input problem."""
        node = build_decision_node(
            _rules_data(
                {"id": "big", "label": "Big", "when": _group(_condition(["start", "amount"], ">", "not-a-number"))}
            ),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "big" in result.error
        assert "not-a-number" in result.error

    def test_a_numeric_constant_that_is_a_template_still_evaluates(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """F2: a template is resolved at run time, so it is not a constant."""
        node = build_decision_node(
            _rules_data(
                {"id": "big", "label": "Big", "when": _group(_condition(["start", "amount"], ">", "{{#start.limit#}}"))}
            ),
            variables=[_amount(5.0), FloatVariable(name="limit", value=3.0, selector=["start", "limit"])],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == "big"

    def test_a_boolean_equality_with_a_string_constant_still_matches(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """F3: the constant pre-check only applies when the variable holds a number."""
        node = build_decision_node(
            _rules_data({"id": "on", "label": "On", "when": _group(_condition(["start", "flag"], "=", "true"))}),
            variables=[BooleanVariable(name="flag", value=True, selector=["start", "flag"])],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == "on"

    def test_a_numeric_constant_with_a_missing_variable_falls_back_to_otherwise(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """F3: without a number to compare, the processor decides, as before the rework."""
        node = build_decision_node(
            _rules_data(
                {"id": "big", "label": "Big", "when": _group(_condition(["start", "amount"], ">", "not-a-number"))}
            ),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"].startswith("Input missing or invalid:")

    def test_a_missing_variable_in_a_value_template_falls_back_to_otherwise(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """Review V4 F2: without the check the processor compares against the literal
        selector text, so ``country is not '{{#start.blocked_country#}}'`` picked ``approve``."""
        node = build_decision_node(
            _rules_data(
                {
                    "id": "approve",
                    "label": "Approve",
                    "when": _group(_condition(["start", "country"], "is not", "{{#start.blocked_country#}}")),
                }
            ),
            variables=[_country("US")],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"] == "Input missing or invalid: Variable ['start', 'blocked_country'] not found"
        assert result.edge_source_handle == OTHERWISE_HANDLE

    def test_a_value_template_after_the_short_circuit_point_is_not_checked(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """Review V4 F2: the check runs per evaluated condition, so first-match order and
        short-circuiting are unchanged: an ``and`` group stops at its first false condition."""
        node = build_decision_node(
            _rules_data(
                {
                    "id": "blocked",
                    "label": "Blocked",
                    "when": _group(
                        _condition(["start", "amount"], ">", "100"),
                        _condition(["start", "country"], "is", "{{#start.blocked_country#}}"),
                    ),
                },
                {"id": "small", "label": "Small", "when": _group(_condition(["start", "amount"], "<", "10"))},
                {
                    "id": "later",
                    "label": "Later",
                    "when": _group(_condition(["start", "country"], "is", "{{#start.missing#}}")),
                },
            ),
            variables=[_amount(5.0), _country("US")],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == "small"
        assert [entry["results"] for entry in result.process_data["condition_results"]] == [[False], [True]]

    def test_a_boolean_constant_that_is_not_a_boolean_fails_the_node(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """Review V4 F7: a valid boolean input with an unreadable constant is a configuration
        error; without the check it ended ``succeeded`` via ``otherwise``."""
        node = build_decision_node(
            _rules_data(
                {
                    "id": "approve",
                    "label": "Approve",
                    "when": _group(_condition(["start", "approved"], "=", "not-a-boolean")),
                }
            ),
            variables=[BooleanVariable(name="approved", value=True, selector=["start", "approved"])],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "approve" in result.error
        assert "not-a-boolean" in result.error

    def test_a_boolean_constant_with_a_missing_variable_falls_back_to_otherwise(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """Review V4 F7: the constant check is type-aware at run time; a missing input still
        goes to ``otherwise``, only a bad constant for a present boolean fails."""
        node = build_decision_node(
            _rules_data(
                {
                    "id": "approve",
                    "label": "Approve",
                    "when": _group(_condition(["start", "approved"], "=", "not-a-boolean")),
                }
            ),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"].startswith("Input missing or invalid:")

    def test_leftover_duplicate_llm_inputs_do_not_stop_a_rules_node(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """Review V5 R1: inputs kept from llm mode are unused by rules, so repeats there still run."""
        data = _rules_data(
            {"id": "approve", "label": "Approve", "when": _group(_condition(["start", "country"], "is", "US"))}
        )
        data["inputs"] = [
            {"variable": "text", "value_selector": ["extract_a", "text"]},
            {"variable": "text", "value_selector": ["extract_b", "text"]},
        ]
        node = build_decision_node(data, variables=[_country("US")])

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == "approve"

    def test_string_when_fails_the_node(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(_rules_data({"id": "big", "label": "Big", "when": "not a rule group"}))

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "big" in result.error

    def test_empty_condition_list_fails_the_node(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(_rules_data({"id": "big", "label": "Big", "when": _group()}))

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "big" in result.error

    def test_no_outcomes_fails_the_node(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(_rules_data())

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "at least one outcome" in result.error

    def test_fixed_extras_follow_the_chosen_outcome(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data(
                {"id": "refund", "label": "Refund", "when": _group(_condition(["start", "amount"], ">", "3"))},
                extras=[
                    {"name": "urgency", "from": "fixed", "values": {"refund": "normal", "human": "high"}},
                    {"name": "missing", "from": "fixed", "values": {}},
                ],
            ),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert result.outputs["urgency"] == "normal"
        assert result.outputs["missing"] == ""

    def test_extras_are_empty_when_the_result_is_otherwise(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data(
                {"id": "refund", "label": "Refund", "when": _group(_condition(["start", "amount"], ">", "100"))},
                extras=[{"name": "urgency", "from": "fixed", "values": {"refund": "normal"}}],
            ),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert result.outputs["urgency"] == ""

    def test_a_matched_outcome_outputs_every_extra(self, build_decision_node: DecisionNodeBuilder) -> None:
        """F7: a model-written extra is still an output in rules mode, as an empty string."""
        node = build_decision_node(
            _rules_data(
                {"id": "refund", "label": "Refund", "when": _group(_condition(["start", "amount"], ">", "3"))},
                extras=[
                    {"name": "urgency", "from": "fixed", "values": {"refund": "normal"}},
                    {"name": "detail", "from": "model", "hint": "One sentence"},
                ],
            ),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert result.outputs["urgency"] == "normal"
        assert result.outputs["detail"] == ""

    def test_process_data_records_each_evaluated_group(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _rules_data(
                {"id": "a", "label": "A", "when": _group(_condition(["start", "amount"], ">", "100"))},
                {"id": "b", "label": "B", "when": _group(_condition(["start", "amount"], ">", "1"))},
            ),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert [entry["outcome_id"] for entry in result.process_data["condition_results"]] == ["a", "b"]
        assert [entry["final_result"] for entry in result.process_data["condition_results"]] == [False, True]

    def test_a_boolean_constant_matches_and_renders_in_the_reason(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        node = build_decision_node(
            _rules_data({"id": "on", "label": "On", "when": _group(_condition(["start", "flag"], "is", True))}),
            variables=[BooleanVariable(name="flag", value=True, selector=["start", "flag"])],
        )

        result = node._run()

        assert result.outputs["outcome_id"] == "on"
        assert result.outputs["reason"] == "flag is True"

    def test_a_fixed_extra_stored_as_null_outputs_an_empty_string(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        """Every output is a string: a null fixed value becomes ``""``, not ``"None"``."""
        node = build_decision_node(
            _rules_data(
                {"id": "refund", "label": "Refund", "when": _group(_condition(["start", "amount"], ">", "3"))},
                extras=[{"name": "urgency", "from": "fixed", "values": {"refund": None}}],
            ),
            variables=[_amount(5.0)],
        )

        result = node._run()

        assert result.outputs["outcome_id"] == "refund"
        assert result.outputs["urgency"] == ""


class TestDecisionModelMode:
    def test_decision_model_fails_with_a_clear_message(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            {
                "type": DECISION_NODE_TYPE,
                "title": "Decision",
                "decide_by": "decision_model",
                "outcomes": [{"id": "a", "label": "A", "when": "x"}],
            }
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "not supported yet" in result.error


class TestLlmMode:
    def test_happy_path_routes_on_the_chosen_outcome(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel(
            '{"outcome_id": "refund", "reason": "The user asked for a refund.", "extras": {}}',
            usage=build_usage(),
        )
        node = build_decision_node(
            _llm_data(
                {"id": "refund", "label": "Refund", "when": "The user wants a refund"},
                {"id": "human", "label": "Hand off", "when": "The user is upset"},
            ),
            variables=[_message("I want my money back")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome"] == "Refund"
        assert result.outputs["outcome_id"] == "refund"
        assert result.outputs["reason"] == "The user asked for a refund."
        assert result.outputs["decided_by"] == "llm"
        assert result.edge_source_handle == "refund"

    def test_usage_is_recorded_in_metadata_and_llm_usage(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel('{"outcome_id": "refund", "reason": "r"}', usage=build_usage(total_tokens=15))
        node = build_decision_node(
            _llm_data({"id": "refund", "label": "Refund", "when": "w"}),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 15
        assert result.metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] == "USD"
        assert result.llm_usage.total_tokens == 15

    def test_fenced_json_is_parsed(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel('Here you go:\n```json\n{"outcome_id": "human", "reason": "upset"}\n```\n')
        node = build_decision_node(
            _llm_data({"id": "human", "label": "Hand off", "when": "w"}),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.outputs["outcome_id"] == "human"

    def test_unknown_outcome_id_falls_back_to_otherwise(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel('{"outcome_id": "nope", "reason": "r"}')
        node = build_decision_node(
            _llm_data({"id": "refund", "label": "Refund", "when": "w"}),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["outcome"] == "Can't decide"
        assert "nope" in result.outputs["reason"]
        assert result.edge_source_handle == OTHERWISE_HANDLE

    def test_unparseable_output_falls_back_to_otherwise(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel("I cannot decide.")
        node = build_decision_node(
            _llm_data({"id": "refund", "label": "Refund", "when": "w"}),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"] == "Model output was not a JSON object"

    @pytest.mark.parametrize("reply", ['{"reason": "Unsure."}', '{"outcome_id": "", "reason": "Unsure."}'])
    def test_output_without_an_outcome_id_falls_back_to_otherwise(
        self, build_decision_node: DecisionNodeBuilder, reply: str
    ) -> None:
        node = build_decision_node(
            _llm_data({"id": "refund", "label": "Refund", "when": "w"}),
            variables=[_message("hi")],
            model_instance=FakeDecisionModel(reply),
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"] == "Model output did not name an outcome"
        assert result.edge_source_handle == OTHERWISE_HANDLE

    def test_a_think_block_before_the_answer_is_ignored(self, build_decision_node: DecisionNodeBuilder) -> None:
        """Reasoning text may contain JSON of its own; only the answer after it decides."""
        model = FakeDecisionModel(
            '<think>Maybe {"outcome_id": "human"}? No.</think>{"outcome_id": "refund", "reason": "Wants money back."}'
        )
        node = build_decision_node(
            _llm_data(
                {"id": "refund", "label": "Refund", "when": "The user wants a refund"},
                {"id": "human", "label": "Hand off", "when": "The user is upset"},
            ),
            variables=[_message("I want my money back")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.outputs["outcome_id"] == "refund"
        assert result.outputs["reason"] == "Wants money back."

    def test_model_choosing_otherwise_uses_its_reason(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel('{"outcome_id": "otherwise", "reason": "Nothing fits."}')
        node = build_decision_node(
            _llm_data({"id": "refund", "label": "Refund", "when": "w"}),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.outputs["outcome_id"] == OTHERWISE_HANDLE
        assert result.outputs["reason"] == "Nothing fits."

    def test_extras_come_from_fixed_values_and_the_model(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel(
            '{"outcome_id": "refund", "reason": "r", "extras": {"summary": "Wants a refund"}}',
        )
        node = build_decision_node(
            _llm_data(
                {"id": "refund", "label": "Refund", "when": "w"},
                extras=[
                    {"name": "urgency", "from": "fixed", "values": {"refund": "normal"}},
                    {"name": "summary", "from": "model", "hint": "One sentence"},
                ],
            ),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.outputs["urgency"] == "normal"
        assert result.outputs["summary"] == "Wants a refund"

    def test_model_extras_are_empty_when_the_result_is_otherwise(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        model = FakeDecisionModel('{"outcome_id": "otherwise", "reason": "r", "extras": {"summary": "x"}}')
        node = build_decision_node(
            _llm_data(
                {"id": "refund", "label": "Refund", "when": "w"},
                extras=[
                    {"name": "urgency", "from": "fixed", "values": {"refund": "normal"}},
                    {"name": "summary", "from": "model", "hint": "One sentence"},
                ],
            ),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.outputs["urgency"] == ""
        assert result.outputs["summary"] == ""

    def test_missing_model_fails_the_node(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            {
                "type": DECISION_NODE_TYPE,
                "title": "Decision",
                "decide_by": "llm",
                "outcomes": [{"id": "a", "label": "A", "when": "w"}],
            },
            variables=[_message("hi")],
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "needs a model" in result.error

    def test_missing_model_instance_fails_the_node(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _llm_data({"id": "refund", "label": "Refund", "when": "w"}),
            variables=[_message("hi")],
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error == "Decision node needs a model instance when decide_by is 'llm'"

    def test_missing_file_saver_fails_the_node_before_the_model_call(
        self, build_decision_node: DecisionNodeBuilder
    ) -> None:
        model = FakeDecisionModel('{"outcome_id": "refund", "reason": "r"}')
        node = build_decision_node(
            _llm_data({"id": "refund", "label": "Refund", "when": "w"}),
            variables=[_message("hi")],
            model_instance=model,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error == "Decision node needs an LLM file saver when decide_by is 'llm'"
        assert model.prompt_messages == []

    def test_no_outcomes_fails_the_node_before_the_model_call(self, build_decision_node: DecisionNodeBuilder) -> None:
        """Zero outcomes fail the node in llm mode too, before any model call."""
        model = FakeDecisionModel('{"outcome_id": "a", "reason": "r"}')
        node = build_decision_node(
            _llm_data(),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error == "Decision node needs at least one outcome"
        assert model.prompt_messages == []

    def test_empty_when_fails_the_node(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _llm_data({"id": "a", "label": "A", "when": "   "}),
            variables=[_message("hi")],
            model_instance=FakeDecisionModel("{}"),
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "'a'" in result.error

    def test_rule_group_when_fails_the_node(self, build_decision_node: DecisionNodeBuilder) -> None:
        node = build_decision_node(
            _llm_data({"id": "a", "label": "A", "when": _group(_condition(["start", "message"], "is", "x"))}),
            variables=[_message("hi")],
            model_instance=FakeDecisionModel("{}"),
            llm_file_saver=UnusedFileSaver(),
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "'a'" in result.error

    def test_model_errors_are_not_swallowed(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel("", error=RuntimeError("provider exploded"))
        node = build_decision_node(
            _llm_data({"id": "a", "label": "A", "when": "w"}),
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        with pytest.raises(RuntimeError, match="provider exploded"):
            node._run()

    def test_prompt_carries_the_outcomes_inputs_and_contract(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel('{"outcome_id": "refund", "reason": "r"}')
        node = build_decision_node(
            _llm_data(
                {"id": "refund", "label": "Refund", "when": "The user wants a refund"},
                extras=[{"name": "summary", "from": "model", "hint": "One sentence"}],
            ),
            variables=[_message("I want my money back")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        node._run()

        system_text = model.prompt_messages[0].get_text_content()
        user_text = model.prompt_messages[1].get_text_content()
        assert "decision engine" in system_text
        assert '"id": "refund"' in user_text
        assert '"label": "Refund"' in user_text
        assert "The user wants a refund" in user_text
        assert '"summary"' in user_text
        assert "I want my money back" in user_text
        assert "outcome_id" in user_text

    def test_context_prompt_replaces_the_builtin_instruction(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel('{"outcome_id": "refund", "reason": "r"}')
        data = _llm_data({"id": "refund", "label": "Refund", "when": "w"})
        data["context"] = {"glossary": "Refund means money back.", "prompt": "You are a refund triage clerk."}
        node = build_decision_node(
            data,
            variables=[_message("hi")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        node._run()

        assert model.prompt_messages[0].get_text_content() == "You are a refund triage clerk."
        assert "Refund means money back." in model.prompt_messages[1].get_text_content()

    def test_template_references_are_resolved(self, build_decision_node: DecisionNodeBuilder) -> None:
        model = FakeDecisionModel('{"outcome_id": "refund", "reason": "r"}')
        data = _llm_data({"id": "refund", "label": "Refund", "when": "The user wants {{#start.message#}}"})
        data["context"] = {"glossary": "Term: {{#start.message#}}", "prompt": ""}
        node = build_decision_node(
            data,
            variables=[_message("a refund")],
            model_instance=model,
            llm_file_saver=UnusedFileSaver(),
        )

        node._run()

        user_text = model.prompt_messages[1].get_text_content()
        assert "The user wants a refund" in user_text
        assert "Term: a refund" in user_text


class TestRenderRuleGroup:
    def test_renders_unary_operators_without_a_value(self) -> None:
        group = RuleGroup.model_validate(_group(_condition(["start", "country"], "empty")))

        assert render_rule_group(group) == "country empty"

    def test_renders_list_values(self) -> None:
        group = RuleGroup.model_validate(_group(_condition(["start", "country"], "in", ["JP", "KR"])))

        assert render_rule_group(group) == 'country in "JP", "KR"'

    def test_renders_a_missing_value_as_nothing(self) -> None:
        group = RuleGroup.model_validate(_group(_condition(["start", "country"], "is")))

        assert render_rule_group(group) == "country is "


class TestVariableSelectorMapping:
    def test_rules_mode_collects_only_rule_selectors(self) -> None:
        """Review V4 (host): a rules node may keep llm inputs, descriptions and context from
        an earlier switch; single-node debugging must not demand them as inputs."""
        node_data = DecisionNodeData.model_validate(
            {
                "type": DECISION_NODE_TYPE,
                "title": "Decision",
                "decide_by": "rules",
                "outcomes": [
                    {
                        "id": "vip",
                        "when": _group(_condition(["start", "amount"], ">", "{{#start.limit#}}")),
                    },
                    {"id": "described", "when": "The user wants {{#start.message#}}"},
                ],
                "inputs": [{"variable": "message", "value_selector": ["start", "message"]}],
                "context": {
                    "glossary": "Term: {{#start.glossary_term#}}",
                    "prompt": "Use {{#start.tone#}}",
                },
            }
        )

        mapping = DecisionNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="decision",
            node_data=node_data,
        )

        assert mapping == {
            "decision.#start.amount#": ["start", "amount"],
            "decision.#start.limit#": ["start", "limit"],
        }

    def test_llm_mode_collects_inputs_descriptions_and_context(self) -> None:
        """The llm counterpart of the test above (it replaces the earlier mixed-mode test,
        which asserted that a rules node also collected llm inputs and context)."""
        node_data = DecisionNodeData.model_validate(
            {
                "type": DECISION_NODE_TYPE,
                "title": "Decision",
                "decide_by": "llm",
                "outcomes": [
                    {
                        "id": "vip",
                        "when": _group(_condition(["start", "amount"], ">", "3")),
                    },
                    {"id": "described", "when": "The user wants {{#start.message#}}"},
                ],
                "inputs": [{"variable": "message", "value_selector": ["start", "message"]}],
                "context": {
                    "glossary": "Term: {{#start.glossary_term#}}",
                    "prompt": "Use {{#start.tone#}}",
                },
            }
        )

        mapping = DecisionNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="decision",
            node_data=node_data,
        )

        assert mapping == {
            "decision.#start.message#": ["start", "message"],
            "decision.message": ["start", "message"],
            "decision.#start.glossary_term#": ["start", "glossary_term"],
            "decision.#start.tone#": ["start", "tone"],
        }

    def test_collects_the_template_referenced_on_the_right_of_a_condition(self) -> None:
        """F5: the processor resolves ``condition.value`` templates, so debugging must load them."""
        node_data = DecisionNodeData.model_validate(
            {
                "type": DECISION_NODE_TYPE,
                "title": "Decision",
                "decide_by": "rules",
                "outcomes": [
                    {
                        "id": "same",
                        "when": _group(_condition(["start", "a"], "is", "{{#start.b#}}")),
                    }
                ],
            }
        )

        mapping = DecisionNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="decision",
            node_data=node_data,
        )

        assert mapping["decision.#start.a#"] == ["start", "a"]
        assert mapping["decision.#start.b#"] == ["start", "b"]

    def test_an_outcome_without_when_contributes_no_selector(self) -> None:
        """A draft outcome saved before its ``when`` is written references no variable."""
        node_data = DecisionNodeData.model_validate(
            {
                "type": DECISION_NODE_TYPE,
                "title": "Decision",
                "decide_by": "llm",
                "outcomes": [{"id": "blank", "label": "Not written yet"}],
                "inputs": [{"variable": "message", "value_selector": ["start", "message"]}],
            }
        )

        mapping = DecisionNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="decision",
            node_data=node_data,
        )

        assert mapping == {"decision.message": ["start", "message"]}


class TestRegistration:
    def test_the_node_registers_as_a_branch_node(self) -> None:
        from core.workflow.node_factory import resolve_workflow_node_class
        from graphon.enums import NodeExecutionType

        node_class = resolve_workflow_node_class(node_type=DECISION_NODE_TYPE, node_version="1")

        assert node_class is DecisionNode
        assert node_class.execution_type == NodeExecutionType.BRANCH

    def test_default_config_describes_the_editor_contract(self) -> None:
        config = DecisionNode.get_default_config()

        assert config["type"] == DECISION_NODE_TYPE
        assert config["config"] == {
            "decide_by": "rules",
            "outcomes": [],
            "otherwise": {"label": ""},
            "inputs": [],
            "extras": [],
        }
