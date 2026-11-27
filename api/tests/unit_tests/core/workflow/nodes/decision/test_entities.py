"""Entity validation for the ``decision`` node data."""

import pytest
from pydantic import ValidationError

from core.workflow.nodes.decision.entities import (
    DECISION_NODE_TYPE,
    OTHERWISE_HANDLE,
    DecideBy,
    DecisionNodeData,
    Outcome,
    RuleGroup,
    numeric_constant_error,
)


def _data(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "type": DECISION_NODE_TYPE,
        "title": "Decision",
        "intent": "users asking for a refund go to refund; complaints go to a human",
        "decide_by": "llm",
        "outcomes": [
            {"id": "refund", "label": "Refund", "when": "The user wants a refund or a return"},
            {"id": "human", "label": "Hand off to a human", "when": "The user is complaining or upset"},
        ],
        "otherwise": {"label": "Can't decide"},
        "inputs": [{"variable": "message", "value_selector": ["start", "message"]}],
        "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
        "context": {"glossary": "", "prompt": ""},
        "extras": [
            {"name": "urgency", "from": "fixed", "values": {"refund": "normal", "human": "high"}},
            {"name": "summary", "from": "model", "hint": "One sentence on what the user wants"},
        ],
    }
    data.update(overrides)
    return data


class TestDecisionNodeData:
    def test_parses_the_full_contract(self) -> None:
        node_data = DecisionNodeData.model_validate(_data())

        assert node_data.type == DECISION_NODE_TYPE
        assert node_data.decide_by is DecideBy.LLM
        assert [outcome.id for outcome in node_data.outcomes] == ["refund", "human"]
        assert node_data.outcomes[0].when == "The user wants a refund or a return"
        assert node_data.otherwise.label == "Can't decide"
        assert node_data.inputs[0].value_selector == ["start", "message"]
        assert node_data.model is not None
        assert node_data.model.provider == "openai"
        assert [extra.name for extra in node_data.extras] == ["urgency", "summary"]
        assert node_data.extras[0].from_ == "fixed"
        assert node_data.extras[1].hint == "One sentence on what the user wants"

    def test_accepts_a_rule_group_for_when(self) -> None:
        node_data = DecisionNodeData.model_validate(
            _data(
                decide_by="rules",
                model=None,
                outcomes=[
                    {
                        "id": "vip",
                        "label": "Premium service",
                        "when": {
                            "logical_operator": "and",
                            "conditions": [
                                {"variable_selector": ["start", "amount"], "comparison_operator": ">", "value": "3"}
                            ],
                        },
                    }
                ],
            )
        )

        when = node_data.outcomes[0].when
        assert isinstance(when, RuleGroup)
        assert when.logical_operator == "and"
        assert when.conditions[0].comparison_operator == ">"

    def test_accepts_a_string_for_when_under_rules_mode(self) -> None:
        """Drafts are saved mid-edit, so either shape parses under either mode."""
        node_data = DecisionNodeData.model_validate(
            _data(decide_by="rules", model=None, outcomes=[{"id": "a", "when": "still being written"}])
        )

        assert node_data.outcomes[0].when == "still being written"

    def test_accepts_a_rule_group_under_llm_mode(self) -> None:
        node_data = DecisionNodeData.model_validate(
            _data(
                outcomes=[
                    {
                        "id": "a",
                        "when": {
                            "logical_operator": "or",
                            "conditions": [
                                {"variable_selector": ["start", "x"], "comparison_operator": "is", "value": "y"}
                            ],
                        },
                    }
                ]
            )
        )

        assert isinstance(node_data.outcomes[0].when, RuleGroup)

    def test_model_is_optional(self) -> None:
        node_data = DecisionNodeData.model_validate(_data(decide_by="rules", model=None))

        assert node_data.model is None

    @pytest.mark.parametrize("decide_by", ["rules", "llm", "decision_model"])
    def test_accepts_every_decide_by_value(self, decide_by: str) -> None:
        assert DecisionNodeData.model_validate(_data(decide_by=decide_by)).decide_by == decide_by

    def test_rejects_duplicate_outcome_ids(self) -> None:
        with pytest.raises(ValidationError, match="Duplicate outcome id 'refund'"):
            DecisionNodeData.model_validate(
                _data(outcomes=[{"id": "refund", "when": "a"}, {"id": "refund", "when": "b"}])
            )

    def test_rejects_the_reserved_otherwise_id(self) -> None:
        with pytest.raises(ValidationError, match="reserved"):
            DecisionNodeData.model_validate(_data(outcomes=[{"id": OTHERWISE_HANDLE, "when": "a"}]))

    @pytest.mark.parametrize("outcome_id", ["", "has space", "has.dot", "a" * 65, "sla/sh"])
    def test_rejects_outcome_ids_outside_the_pattern(self, outcome_id: str) -> None:
        with pytest.raises(ValidationError, match="must match"):
            DecisionNodeData.model_validate(_data(outcomes=[{"id": outcome_id, "when": "a"}]))

    @pytest.mark.parametrize("outcome_id", ["a", "A-1_b", "x" * 64])
    def test_accepts_outcome_ids_inside_the_pattern(self, outcome_id: str) -> None:
        node_data = DecisionNodeData.model_validate(_data(outcomes=[{"id": outcome_id, "when": "a"}]))

        assert node_data.outcomes[0].id == outcome_id

    @pytest.mark.parametrize("name", ["outcome", "outcome_id", "reason", "decided_by"])
    def test_rejects_extra_names_that_collide_with_builtin_outputs(self, name: str) -> None:
        with pytest.raises(ValidationError, match="collides with a built-in output"):
            DecisionNodeData.model_validate(_data(extras=[{"name": name, "from": "fixed", "values": {}}]))

    def test_rejects_duplicate_extra_names(self) -> None:
        with pytest.raises(ValidationError, match="Duplicate extra name 'urgency'"):
            DecisionNodeData.model_validate(
                _data(
                    extras=[
                        {"name": "urgency", "from": "fixed", "values": {}},
                        {"name": "urgency", "from": "model", "hint": "x"},
                    ]
                )
            )

    def test_rejects_duplicate_input_names_in_llm_mode(self) -> None:
        """Review V4 F4: the model inputs are a name -> value mapping, so a repeated
        name would silently drop a value; DSL import must not bypass the generator check."""
        with pytest.raises(ValidationError, match="Duplicate input variable 'text'"):
            DecisionNodeData.model_validate(
                _data(
                    decide_by="llm",
                    inputs=[
                        {"variable": "text", "value_selector": ["extract_a", "text"]},
                        {"variable": "text", "value_selector": ["extract_b", "text"]},
                    ],
                )
            )

    def test_accepts_leftover_duplicate_input_names_in_rules_mode(self) -> None:
        """Review V5 R1: a rules draft may keep the llm inputs from before a mode
        switch; rules never read them, so a repeat there must not block loading."""
        node_data = DecisionNodeData.model_validate(
            _data(
                decide_by="rules",
                outcomes=[{"id": "approve", "when": None}],
                inputs=[
                    {"variable": "text", "value_selector": ["extract_a", "text"]},
                    {"variable": "text", "value_selector": ["extract_b", "text"]},
                ],
            )
        )

        assert node_data.decide_by == DecideBy.RULES
        assert [input_.variable for input_ in node_data.inputs] == ["text", "text"]

    def test_rejects_an_empty_extra_name(self) -> None:
        with pytest.raises(ValidationError, match="must not be empty"):
            DecisionNodeData.model_validate(_data(extras=[{"name": "  ", "from": "fixed", "values": {}}]))

    @pytest.mark.parametrize("name", ["紧急程度", "has space", "1abc", "has.dot", "has-dash", "a" * 31])
    def test_rejects_extra_names_outside_the_editor_pattern(self, name: str) -> None:
        """The editor only accepts output names it can use as variable names."""
        with pytest.raises(ValidationError, match="must match"):
            DecisionNodeData.model_validate(_data(extras=[{"name": name, "from": "fixed", "values": {}}]))

    @pytest.mark.parametrize("name", ["a", "A_1", "_private", "x" * 30, "urgency_2"])
    def test_accepts_extra_names_inside_the_editor_pattern(self, name: str) -> None:
        node_data = DecisionNodeData.model_validate(_data(extras=[{"name": name, "from": "fixed", "values": {}}]))

        assert node_data.extras[0].name == name

    def test_extra_from_alias_round_trips(self) -> None:
        node_data = DecisionNodeData.model_validate(_data())

        dumped = node_data.model_dump(mode="python", by_alias=True)

        assert dumped["extras"][0]["from"] == "fixed"
        assert DecisionNodeData.model_validate(dumped).extras[0].from_ == "fixed"

    def test_outcome_defaults(self) -> None:
        outcome = Outcome(id="a")

        assert outcome.label == ""
        assert outcome.when is None


class TestNumericConstantError:
    """Only a constant string that cannot parse as a number makes a numeric rule unevaluable."""

    def test_a_non_numeric_string_constant_is_reported(self) -> None:
        assert numeric_constant_error(">", "lots") == "comparison_operator '>' needs a number, but the value is 'lots'"

    @pytest.mark.parametrize("value", ["500", "-1.5", "{{#start.limit#}}"])
    def test_a_number_or_a_template_is_accepted(self, value: str) -> None:
        assert numeric_constant_error("≥", value) is None

    @pytest.mark.parametrize("value", [["3"], True, None])
    def test_a_non_string_value_is_left_to_the_condition_processor(self, value: object) -> None:
        """The check inspects constant strings only; other shapes are reported when the rule runs."""
        assert numeric_constant_error("=", value) is None

    def test_a_non_numeric_operator_never_reports(self) -> None:
        assert numeric_constant_error("contains", "lots") is None
