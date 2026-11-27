"""Tests for the decision-node configuration generator.

The model instance is faked with a scripted callable (no network): each test
pins one code-enforced rule from the generator, from id fixing to the rules→llm
fallback.
"""

import json
from collections.abc import Callable
from typing import NoReturn

import pytest

import core.llm_generator.llm_generator as llm_generator_module
from core.app.app_config.entities import ModelConfig
from core.llm_generator.decision_generator import (
    DecisionBuildResult,
    _derive_extra_name,
    _derive_outcome_id,
    build_decision_config,
    empty_decision_result,
    fallback_to_llm,
    parse_decision_payload,
)
from core.llm_generator.entities import (
    DecisionGenerateOutcome,
    DecisionGeneratePayload,
    DecisionGenerateVariable,
)
from core.llm_generator.llm_generator import LLMGenerator
from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
from core.telemetry import PromptGenerationEvent
from core.workflow.nodes.decision.entities import DecideBy
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
)
from tests.helpers.unit.core.model_fixtures import make_model_instance

"""Decision generator tests."""


def _llm_result(content: str) -> LLMResult:
    return LLMResult(
        model="test-model",
        message=AssistantPromptMessage(content=content),
        usage=LLMUsage.empty_usage(),
    )


class _ScriptedInvoke:
    """Callable standing in for ``ModelInstance.invoke_llm``; records every prompt."""

    def __init__(self, replies: list[str]) -> None:
        self._replies = list(replies)
        self.calls: list[list[PromptMessage]] = []

    def __call__(self, *, prompt_messages: list[PromptMessage], **_kwargs: object) -> LLMResult:
        self.calls.append(list(prompt_messages))
        return _llm_result(self._replies.pop(0))


def _variable(selector: list[str], type_: str = "number") -> DecisionGenerateVariable:
    return DecisionGenerateVariable(value_selector=selector, type=type_, description="")


_AMOUNT_VARIABLES = [_variable(["start", "amount"]), _variable(["start", "note"], "string")]


def _payload(
    *,
    instruction: str = "orders over 500 need approval, the rest pass",
    decide_by: DecideBy | None = None,
    variables: list[DecisionGenerateVariable] | None = None,
    outcomes: list[DecisionGenerateOutcome] | None = None,
    language: str | None = None,
) -> DecisionGeneratePayload:
    return DecisionGeneratePayload(
        instruction=instruction,
        model_config=ModelConfig(provider="openai", name="gpt-4", mode=LLMMode.CHAT, completion_params={}),
        available_variables=_AMOUNT_VARIABLES if variables is None else variables,
        decide_by=decide_by,
        outcomes=outcomes or [],
        language=language,
    )


_APPROVAL_CONDITION: dict[str, object] = {
    "variable_selector": ["start", "amount"],
    "comparison_operator": ">",
    "value": 500,
}
_PASS_CONDITION: dict[str, object] = {"variable_selector": ["start", "note"], "comparison_operator": "not empty"}


def _rules_reply(
    *,
    approval_conditions: list[dict[str, object]] | None = None,
    pass_conditions: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    """A valid rules-mode reply; a test replaces one outcome's conditions to break it."""
    return {
        "decide_by": "rules",
        "decide_by_reason": "Both results depend only on comparing a number.",
        "outcomes": [
            {
                "id": "needs_approval",
                "label": "Needs approval",
                "when": {
                    "logical_operator": "and",
                    "conditions": [_APPROVAL_CONDITION] if approval_conditions is None else approval_conditions,
                },
                "when_description": "The order amount is over 500.",
            },
            {
                "id": "pass",
                "label": "Pass",
                "when": {
                    "logical_operator": "and",
                    "conditions": [_PASS_CONDITION] if pass_conditions is None else pass_conditions,
                },
                "when_description": "The order amount is 500 or less.",
            },
        ],
        "otherwise": {"label": "Can't decide"},
        "inputs": [],
        "extras": [],
    }


def _llm_reply() -> dict[str, object]:
    return {
        "decide_by": "llm",
        "decide_by_reason": "The note's meaning decides the result.",
        "outcomes": [
            {
                "id": "urgent",
                "label": "Needs approval",
                "when": "The note asks for approval or sounds urgent.",
                "when_description": "The note asks for approval or sounds urgent.",
            },
            {
                "id": "pass",
                "label": "Pass",
                "when": "The note is a routine order.",
                "when_description": "The note is a routine order.",
            },
        ],
        "otherwise": {"label": "Can't decide"},
        "inputs": [{"variable": "note", "value_selector": ["start", "note"]}],
        "extras": [],
    }


def _single_condition_payload(selector: list[str], operator: str, value: object) -> dict[str, object]:
    """One rules-mode outcome whose single condition is the one under test."""
    return {
        "decide_by": "rules",
        "outcomes": [
            {
                "id": "matched",
                "label": "Matched",
                "when": {
                    "logical_operator": "and",
                    "conditions": [{"variable_selector": selector, "comparison_operator": operator, "value": value}],
                },
            }
        ],
    }


_InstallModel = Callable[[list[str]], _ScriptedInvoke]


@pytest.fixture
def install_model(monkeypatch: pytest.MonkeyPatch) -> _InstallModel:
    """Resolve any tenant's model to a real instance whose invoke is scripted."""

    def _install(replies: list[str]) -> _ScriptedInvoke:
        model_instance = make_model_instance(provider="openai", model="gpt-4")
        invoke = _ScriptedInvoke(replies)
        monkeypatch.setattr(model_instance, "invoke_llm", invoke)
        model_manager = create_plugin_model_manager(tenant_id="tenant")
        monkeypatch.setattr(model_manager, "get_model_instance", lambda **_kwargs: model_instance)
        monkeypatch.setattr(llm_generator_module.ModelManager, "for_tenant", lambda **_kwargs: model_manager)
        return invoke

    return _install


class TestGenerateDecision:
    def test_rules_happy_path(self, install_model: _InstallModel) -> None:
        invoke = install_model([json.dumps(_rules_reply())])

        result = LLMGenerator.generate_decision("tenant", _payload())

        assert result["error"] == ""
        assert result["decide_by"] == "rules"
        assert result["decide_by_reason"] == "Both results depend only on comparing a number."
        assert result["otherwise"] == {"label": "Can't decide"}
        # The number 500 from the model is stored the way If-Else stores it: as a string.
        assert result["outcomes"][0] == {
            "id": "needs_approval",
            "label": "Needs approval",
            "when": {
                "logical_operator": "and",
                "conditions": [{"variable_selector": ["start", "amount"], "comparison_operator": ">", "value": "500"}],
            },
        }
        # "not empty" takes no value.
        assert result["outcomes"][1]["when"]["conditions"][0] == {
            "variable_selector": ["start", "note"],
            "comparison_operator": "not empty",
        }
        assert result["inputs"] == []
        assert len(invoke.calls) == 1

    def test_llm_happy_path_with_inputs(self, install_model: _InstallModel) -> None:
        install_model([json.dumps(_llm_reply())])

        result = LLMGenerator.generate_decision("tenant", _payload())

        assert result["error"] == ""
        assert result["decide_by"] == "llm"
        assert result["outcomes"][0]["when"] == "The note asks for approval or sounds urgent."
        assert result["inputs"] == [{"variable": "note", "value_selector": ["start", "note"]}]

    def test_forced_decide_by_rules(self, install_model: _InstallModel) -> None:
        install_model([json.dumps(_rules_reply())])

        result = LLMGenerator.generate_decision("tenant", _payload(decide_by=DecideBy.RULES))

        assert result["decide_by"] == "rules"
        assert result["error"] == ""

    def test_forced_rules_never_switches_mode(self, install_model: _InstallModel) -> None:
        # Both replies propose llm mode although the user forced rules.
        install_model([json.dumps(_llm_reply()), json.dumps(_llm_reply())])

        result = LLMGenerator.generate_decision("tenant", _payload(decide_by=DecideBy.RULES))

        assert result["decide_by"] == ""
        assert result["outcomes"] == []
        assert "Failed to generate the decision configuration" in result["error"]

    def test_preserved_ids_and_labels_kept_in_order(self, install_model: _InstallModel) -> None:
        reply: dict[str, object] = {
            "decide_by": "rules",
            "decide_by_reason": "Comparing the amount is enough.",
            "outcomes": [
                {
                    "id": "approve",
                    "label": "Renamed by the model",
                    "when": {
                        "logical_operator": "and",
                        "conditions": [
                            {"variable_selector": ["start", "amount"], "comparison_operator": ">", "value": "500"}
                        ],
                    },
                    "when_description": "Over 500.",
                },
                {
                    "id": "extra_outcome",
                    "label": "Also possible",
                    "when": {
                        "logical_operator": "and",
                        "conditions": [
                            {"variable_selector": ["start", "amount"], "comparison_operator": "=", "value": "0"}
                        ],
                    },
                    "when_description": "Zero amount.",
                },
                {
                    "id": "auto",
                    "label": "Renamed too",
                    "when": {
                        "logical_operator": "and",
                        "conditions": [
                            {"variable_selector": ["start", "amount"], "comparison_operator": "≤", "value": "500"}
                        ],
                    },
                    "when_description": "At most 500.",
                },
            ],
            "otherwise": {"label": "Can't decide"},
            "inputs": [],
            "extras": [],
        }
        install_model([json.dumps(reply)])
        payload = _payload(
            outcomes=[
                DecisionGenerateOutcome(id="approve", label="Approve me"),
                DecisionGenerateOutcome(id="auto", label="Auto pass"),
            ]
        )

        result = LLMGenerator.generate_decision("tenant", payload)

        assert result["error"] == ""
        assert [outcome["id"] for outcome in result["outcomes"]] == ["approve", "auto", "extra_outcome"]
        # Preserved ids and labels survive exactly; only the "when" is written.
        assert result["outcomes"][0]["label"] == "Approve me"
        assert result["outcomes"][1]["label"] == "Auto pass"
        assert result["outcomes"][2]["label"] == "Also possible"

    def test_bad_selector_repaired_on_retry(self, install_model: _InstallModel) -> None:
        bad = _rules_reply(
            approval_conditions=[{**_APPROVAL_CONDITION, "variable_selector": ["start", "total"]}],
        )
        invoke = install_model([json.dumps(bad), json.dumps(_rules_reply())])

        result = LLMGenerator.generate_decision("tenant", _payload())

        assert result["error"] == ""
        assert result["outcomes"][0]["when"]["conditions"][0]["variable_selector"] == ["start", "amount"]
        # One repair retry only.
        assert len(invoke.calls) == 2
        repair_user_message = invoke.calls[1][1].content
        assert isinstance(repair_user_message, str)
        assert "is not one of the available variables" in repair_user_message
        assert "Your previous attempt" in repair_user_message

    def test_still_bad_returns_error(self, install_model: _InstallModel) -> None:
        bad = _rules_reply(
            approval_conditions=[{**_APPROVAL_CONDITION, "variable_selector": ["start", "total"]}],
        )
        install_model([json.dumps(bad), json.dumps(bad)])

        result = LLMGenerator.generate_decision("tenant", _payload(decide_by=DecideBy.RULES))

        assert result == {
            **empty_decision_result(),
            "error": result["error"],
        }
        assert "is not one of the available variables" in result["error"]

    def test_operator_illegal_for_type_rejected(self, install_model: _InstallModel) -> None:
        bad = _rules_reply(approval_conditions=[{**_APPROVAL_CONDITION, "comparison_operator": "contains"}])
        install_model([json.dumps(bad), json.dumps(bad)])

        result = LLMGenerator.generate_decision("tenant", _payload(decide_by=DecideBy.RULES))

        assert result["outcomes"] == []
        assert "is not legal for type 'number'" in result["error"]

    def test_non_ascii_labels_get_outcome_n_ids(self, install_model: _InstallModel) -> None:
        reply: dict[str, object] = {
            "decide_by": "llm",
            "decide_by_reason": "The notes' meaning decides.",
            "outcomes": [
                {"label": "需要审批", "when": "备注要求审批。", "when_description": "备注要求审批。"},
                {"label": "直接通过", "when": "备注是常规订单。", "when_description": "备注是常规订单。"},
                {
                    "label": "Needs approval",
                    "when": "The note asks for approval.",
                    "when_description": "The note asks.",
                },
            ],
            "otherwise": {"label": "无法判断"},
            "inputs": [{"variable": "note", "value_selector": ["start", "note"]}],
            "extras": [],
        }
        install_model([json.dumps(reply)])

        result = LLMGenerator.generate_decision("tenant", _payload())

        assert result["error"] == ""
        assert [outcome["id"] for outcome in result["outcomes"]] == ["outcome_1", "outcome_2", "needs_approval"]

    def test_non_ascii_extra_names_are_normalised_end_to_end(self, install_model: _InstallModel) -> None:
        """The live failure: a Chinese extra name the editor would reject."""
        reply = _llm_reply()
        reply["extras"] = [{"name": "紧急程度", "from": "model", "hint": "请求的紧急程度"}]
        install_model([json.dumps(reply)])

        result = LLMGenerator.generate_decision("tenant", _payload())

        assert result["error"] == ""
        assert result["extras"] == [{"name": "extra_1", "from": "model", "values": {}, "hint": "请求的紧急程度"}]

    def test_recommended_rules_without_writable_rules_falls_back_to_llm(self, install_model: _InstallModel) -> None:
        unwritable = _rules_reply(
            approval_conditions=[{**_APPROVAL_CONDITION, "variable_selector": ["orders", "total"]}],
            pass_conditions=[{**_PASS_CONDITION, "variable_selector": ["orders", "total"]}],
        )
        install_model([json.dumps(unwritable), json.dumps(unwritable)])

        result = LLMGenerator.generate_decision("tenant", _payload())

        assert result["error"] == ""
        assert result["decide_by"] == "llm"
        assert "No rule can be written against the available variables" in result["decide_by_reason"]
        assert result["outcomes"][0]["when"] == "The order amount is over 500."
        assert result["inputs"] == [
            {"variable": "amount", "value_selector": ["start", "amount"]},
            {"variable": "note", "value_selector": ["start", "note"]},
        ]

    def test_an_existing_outcome_repeated_without_a_description_does_not_fall_back(
        self, install_model: _InstallModel
    ) -> None:
        """Review V5 R2: the repeat lacking a description still makes the existing exit ambiguous."""
        reply: dict[str, object] = {
            "decide_by": "rules",
            "outcomes": [
                {
                    "id": "urgent",
                    "label": "Escalate",
                    "when": None,
                    "when_description": "Routine requests need no human",
                },
                {"id": "urgent", "label": "Escalate", "when": None},
            ],
        }
        invoke = install_model([json.dumps(reply), json.dumps(reply)])

        result = LLMGenerator.generate_decision(
            "tenant", _payload(outcomes=[DecisionGenerateOutcome(id="urgent", label="Escalate")])
        )

        assert len(invoke.calls) == 2
        assert result == {**empty_decision_result(), "error": result["error"]}
        assert "Failed to generate the decision configuration" in result["error"]

    def test_no_variables_forces_llm_before_the_first_call(self, install_model: _InstallModel) -> None:
        reply = _llm_reply()
        no_inputs: list[dict[str, object]] = []
        reply["inputs"] = no_inputs
        invoke = install_model([json.dumps(reply)])
        payload = _payload(variables=[])

        result = LLMGenerator.generate_decision("tenant", payload)

        assert result["decide_by"] == "llm"
        assert result["error"] == ""
        user_content = invoke.calls[0][1].content
        assert isinstance(user_content, str)
        assert "no rule can be written; decide by language model" in user_content
        assert 'The mode is fixed: "llm"' in user_content

    def test_invoke_error_returns_error_result(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from graphon.model_runtime.errors.invoke import InvokeError

        model_instance = make_model_instance(provider="openai", model="gpt-4")

        def _fail(**_kwargs: object) -> NoReturn:
            raise InvokeError("Invoke failed")

        monkeypatch.setattr(model_instance, "invoke_llm", _fail)
        model_manager = create_plugin_model_manager(tenant_id="tenant")
        monkeypatch.setattr(model_manager, "get_model_instance", lambda **_kwargs: model_instance)
        monkeypatch.setattr(llm_generator_module.ModelManager, "for_tenant", lambda **_kwargs: model_manager)

        result = LLMGenerator.generate_decision("tenant", _payload())

        assert result["decide_by"] == ""
        assert "Failed to generate the decision configuration" in result["error"]
        assert "Invoke failed" in result["error"]

    def test_telemetry_emits_prompt_generation_event(
        self, install_model: _InstallModel, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_model([json.dumps(_rules_reply())])
        events: list[object] = []
        monkeypatch.setattr(llm_generator_module, "telemetry_emit", lambda event: events.append(event))

        LLMGenerator.generate_decision("tenant", _payload(), app_id="app-1")

        [event] = events
        assert type(event).__name__ == "PromptGenerationEvent"
        assert isinstance(event, PromptGenerationEvent)
        assert event.payload["operation_type"] == "decision_generate"
        assert event.payload["model_provider"] == "openai"
        assert event.payload["model_name"] == "gpt-4"
        assert event.payload["error"] is None
        assert event.context.app_id == "app-1"


class TestBuildDecisionConfig:
    def test_decision_model_is_never_generated(self) -> None:
        build = build_decision_config(
            {"decide_by": "decision_model", "outcomes": []},
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert "'decide_by' must be 'rules' or 'llm'" in build.errors

    def test_empty_outcomes_rejected(self) -> None:
        build = build_decision_config(
            {"decide_by": "rules", "outcomes": []},
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert "At least one outcome is required" in build.errors

    def test_missing_when_for_preserved_outcome_rejected(self) -> None:
        build = build_decision_config(
            {"decide_by": "llm", "outcomes": [{"id": "other", "label": "Other", "when": "x", "when_description": "x"}]},
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[DecisionGenerateOutcome(id="approve", label="Approve me")],
            forced_decide_by=None,
        )

        assert build.config is None
        assert "No 'when' was generated for the existing outcome 'approve'" in build.errors

    def test_a_new_outcome_cannot_take_an_existing_outcomes_id(self) -> None:
        """Review V4 F3: the new outcome ``new urgent`` normalises to ``urgent``. Without
        reserving existing ids and matching by the proposed id, the wired exit ``urgent``
        silently took the routine-request condition."""
        build = build_decision_config(
            {
                "decide_by": "llm",
                "outcomes": [
                    {"id": "new urgent", "label": "Urgent", "when": "Routine request; no escalation needed"},
                    {"id": "urgent", "label": "Escalate", "when": "Customer explicitly asks for a human"},
                ],
            },
            available_variables=[],
            preserved_outcomes=[DecisionGenerateOutcome(id="urgent", label="Escalate")],
            forced_decide_by=None,
        )

        assert build.errors == []
        assert build.config is not None
        assert build.config["outcomes"] == [
            {"id": "urgent", "label": "Escalate", "when": "Customer explicitly asks for a human"},
            {"id": "urgent_2", "label": "Urgent", "when": "Routine request; no escalation needed"},
        ]

    def test_an_existing_outcome_proposed_twice_is_rejected(self) -> None:
        """Review V4 F3: an ambiguous match goes to the repair retry; it is never resolved by a guess."""
        build = build_decision_config(
            {
                "decide_by": "llm",
                "outcomes": [
                    {"id": "urgent", "label": "Escalate", "when": "Customer asks for a human"},
                    {"id": "urgent", "label": "Escalate", "when": "Customer is angry"},
                ],
            },
            available_variables=[],
            preserved_outcomes=[DecisionGenerateOutcome(id="urgent", label="Escalate")],
            forced_decide_by=None,
        )

        assert build.config is None
        assert "The existing outcome 'urgent' was proposed 2 times; propose it exactly once" in build.errors

    def test_forced_rules_ignores_model_mode_choice(self) -> None:
        build = build_decision_config(
            {"decide_by": "llm", **{key: _llm_reply()[key] for key in ("outcomes", "otherwise", "inputs", "extras")}},
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=DecideBy.RULES,
        )

        assert build.attempted_decide_by is DecideBy.RULES
        assert build.config is None
        assert any("'when' must be a rule group object in rules mode" in error for error in build.errors)

    def test_reserved_otherwise_id_is_fixed(self) -> None:
        build = build_decision_config(
            {
                "decide_by": "llm",
                "outcomes": [
                    {"id": "otherwise", "label": "A", "when": "a", "when_description": "a"},
                    {"id": "otherwise", "label": "B", "when": "b", "when_description": "b"},
                ],
                "otherwise": {"label": "None"},
            },
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is not None
        assert [outcome["id"] for outcome in build.config["outcomes"]] == ["a", "b"]

    def test_rules_mode_rejects_an_empty_condition_list(self) -> None:
        """F3: the node fails at run time on a rule group without conditions, so the
        generator must never return one; the outcome is a validation error instead."""
        reply = _rules_reply(approval_conditions=[])

        build = build_decision_config(
            reply,
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert "outcome 'needs_approval': at least one condition is required in rules mode" in build.errors

    def test_rules_mode_rejects_an_outcome_whose_conditions_all_fail_validation(self) -> None:
        """F3, dropped-condition variant: every condition invalid leaves an empty group."""
        reply = _rules_reply(
            approval_conditions=[{"variable_selector": ["start", "total"], "comparison_operator": ">", "value": "1"}]
        )

        build = build_decision_config(
            reply,
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert any(
            "outcome 'needs_approval': at least one condition is required in rules mode" in error
            for error in build.errors
        )

    def test_file_array_operators_that_need_a_sub_condition_are_rejected(self) -> None:
        """F3a: the processor needs a sub-variable condition the generator never writes."""
        build = build_decision_config(
            _single_condition_payload(["start", "files"], "contains", "pdf"),
            available_variables=[_variable(["start", "files"], "array[file]")],
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert any(
            "outcome 'matched' condition 0: comparison_operator 'contains' is not legal for type 'array[file]'" in error
            for error in build.errors
        )

    def test_file_array_existence_operators_are_accepted(self) -> None:
        """F3a guard: the processor runs these without a sub-variable condition."""
        build = build_decision_config(
            _single_condition_payload(["start", "files"], "exists", None),
            available_variables=[_variable(["start", "files"], "array[file]")],
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is not None
        assert build.config["outcomes"][0]["when"]["conditions"] == [
            {"variable_selector": ["start", "files"], "comparison_operator": "exists"}
        ]

    def test_a_numeric_comparison_with_a_non_numeric_constant_is_rejected(self) -> None:
        """F3b: the processor cannot convert the constant, so the rule never runs."""
        build = build_decision_config(
            _single_condition_payload(["start", "amount"], ">", "five hundred"),
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert any(
            "outcome 'matched' condition 0: comparison_operator '>' needs a number, but the value is 'five hundred'"
            in error
            for error in build.errors
        )

    def test_a_numeric_comparison_with_a_template_value_is_accepted(self) -> None:
        """F3b guard: a template is resolved at run time, so it is not a constant."""
        build = build_decision_config(
            _single_condition_payload(["start", "amount"], ">", "{{#start.limit#}}"),
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is not None
        assert build.config["outcomes"][0]["when"]["conditions"][0]["value"] == "{{#start.limit#}}"

    def test_a_numeric_comparison_with_a_list_constant_is_rejected(self) -> None:
        """F2: a list is not a scalar, so the processor cannot convert it to a number."""
        build = build_decision_config(
            _single_condition_payload(["start", "amount"], ">", ["3"]),
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert any(
            "outcome 'matched' condition 0: comparison_operator '>' needs a single number, but the value is ['3']"
            in error
            for error in build.errors
        )


def _rules_when(when: object, *, variables: list[DecisionGenerateVariable] | None = None) -> DecisionBuildResult:
    """Validate a one-outcome rules proposal whose ``when`` is the value under test."""
    return build_decision_config(
        {"decide_by": "rules", "outcomes": [{"id": "matched", "label": "Matched", "when": when}]},
        available_variables=_AMOUNT_VARIABLES if variables is None else variables,
        preserved_outcomes=[],
        forced_decide_by=None,
    )


def _llm_with(**overrides: object) -> DecisionBuildResult:
    """Validate the valid llm proposal with some top-level keys replaced."""
    return build_decision_config(
        {**_llm_reply(), **overrides},
        available_variables=_AMOUNT_VARIABLES,
        preserved_outcomes=[],
        forced_decide_by=None,
    )


_AMOUNT_ABOVE: dict[str, object] = {"variable_selector": ["start", "amount"], "comparison_operator": ">", "value": 1}


class TestProposalShapeErrors:
    """Every malformed part of a proposal is named in an error the repair retry quotes back."""

    @pytest.mark.parametrize(
        ("when", "expected"),
        [
            (
                {"logical_operator": "xor", "conditions": [_AMOUNT_ABOVE]},
                "outcome 'matched': 'logical_operator' must be 'and' or 'or'",
            ),
            ({"logical_operator": "and", "conditions": "amount > 1"}, "outcome 'matched': 'conditions' must be a list"),
            ({"conditions": ["amount > 1"]}, "outcome 'matched' condition 0 must be an object"),
            (
                {"conditions": [{**_AMOUNT_ABOVE, "variable_selector": "start.amount"}]},
                "outcome 'matched' condition 0: 'variable_selector' must be a non-empty list of strings",
            ),
            (
                {"conditions": [{**_AMOUNT_ABOVE, "comparison_operator": 5}]},
                "outcome 'matched' condition 0: 'comparison_operator' must be a string",
            ),
            (
                {"conditions": [{**_AMOUNT_ABOVE, "value": None}]},
                "outcome 'matched' condition 0: a value is required for comparison_operator '>'",
            ),
            (
                {"conditions": [{**_AMOUNT_ABOVE, "value": {"min": 1}}]},
                "outcome 'matched' condition 0: the value must be a string, a number or a list of strings",
            ),
            (
                {"conditions": [{**_AMOUNT_ABOVE, "value": [1, True]}]},
                "outcome 'matched' condition 0: the value must be a string, a number or a list of strings",
            ),
        ],
    )
    def test_a_malformed_rule_is_reported(self, when: dict[str, object], expected: str) -> None:
        build = _rules_when(when)

        assert build.config is None
        assert expected in build.errors
        assert build.valid_rule_groups == 0

    def test_a_logical_operator_defaults_to_and(self) -> None:
        build = _rules_when({"conditions": [_AMOUNT_ABOVE]})

        assert build.config is not None
        assert build.config["outcomes"][0]["when"]["logical_operator"] == "and"

    def test_a_boolean_constant_is_kept_as_a_boolean(self) -> None:
        build = _rules_when(
            {"conditions": [{"variable_selector": ["start", "vip"], "comparison_operator": "is", "value": True}]},
            variables=[_variable(["start", "vip"], "boolean")],
        )

        assert build.config is not None
        assert build.config["outcomes"][0]["when"]["conditions"] == [
            {"variable_selector": ["start", "vip"], "comparison_operator": "is", "value": True}
        ]

    def test_outcomes_that_are_not_a_list_are_reported(self) -> None:
        build = _llm_with(outcomes="urgent, pass")

        assert build.config is None
        assert "'outcomes' must be a list of objects" in build.errors
        assert "At least one outcome is required" in build.errors

    def test_an_outcome_that_is_not_an_object_is_reported_by_position(self) -> None:
        build = _llm_with(outcomes=["urgent", {"id": "pass", "label": "Pass", "when": "Routine."}])

        assert build.config is None
        assert build.errors == ["outcomes[0] must be an object"]

    def test_an_empty_llm_when_is_reported(self) -> None:
        build = _llm_with(outcomes=[{"id": "urgent", "label": "Urgent", "when": "   "}])

        assert build.config is None
        assert build.errors == ["outcome 'urgent': 'when' must be a non-empty sentence in llm mode"]

    @pytest.mark.parametrize(
        ("inputs", "expected"),
        [
            ("note", "'inputs' must be a list"),
            (["note"], "inputs[0] must be an object"),
            (
                [{"variable": " ", "value_selector": ["start", "note"]}],
                "inputs[0]: 'variable' must be a non-empty string",
            ),
            (
                [{"variable": "note", "value_selector": []}],
                "inputs[0]: 'value_selector' must be a non-empty list of strings",
            ),
            (
                [{"variable": "note", "value_selector": ["start", "memo"]}],
                'inputs[0]: value_selector ["start", "memo"] is not one of the available variables',
            ),
        ],
    )
    def test_a_malformed_llm_input_is_reported(self, inputs: object, expected: str) -> None:
        build = _llm_with(inputs=inputs)

        assert build.config is None
        assert build.errors == [expected]

    def test_a_repeated_input_name_is_reported(self) -> None:
        """Review V4 F4: two upstream ``text`` outputs under one name would make the model see
        only the last value; the repeated name goes to the repair retry instead."""
        build = build_decision_config(
            {
                **_llm_reply(),
                "inputs": [
                    {"variable": "text", "value_selector": ["extract_a", "text"]},
                    {"variable": "text", "value_selector": ["extract_b", "text"]},
                ],
            },
            available_variables=[
                _variable(["extract_a", "text"], "string"),
                _variable(["extract_b", "text"], "string"),
            ],
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is None
        assert build.errors == ["inputs[1]: 'variable' 'text' is already used by another input"]

    def test_missing_llm_inputs_mean_no_inputs(self) -> None:
        build = _llm_with(inputs=None)

        assert build.config is not None
        assert build.config["inputs"] == []

    @pytest.mark.parametrize(
        ("extras", "expected"),
        [
            ({"name": "tier", "from": "model"}, "'extras' must be a list"),
            (["tier"], "extras[0] must be an object"),
            ([{"name": "tier", "from": "guess"}], "extras[0]: Input should be 'fixed' or 'model'"),
        ],
    )
    def test_a_malformed_extra_is_reported(self, extras: object, expected: str) -> None:
        build = _llm_with(extras=extras)

        assert build.config is None
        assert build.errors == [expected]

    @pytest.mark.parametrize(
        ("otherwise", "expected"),
        [
            ("Can't decide", "'otherwise' must be an object with a 'label'"),
            ({"label": 3}, "'otherwise.label' must be a string"),
        ],
    )
    def test_a_malformed_otherwise_is_reported(self, otherwise: object, expected: str) -> None:
        build = _llm_with(otherwise=otherwise)

        assert build.config is None
        assert build.errors == [expected]

    def test_a_missing_otherwise_gets_an_empty_label(self) -> None:
        build = _llm_with(otherwise=None)

        assert build.config is not None
        assert build.config["otherwise"] == {"label": ""}

    def test_duplicate_preserved_ids_fail_the_node_entity_check(self) -> None:
        """The node entity is the final schema: a request repeating an outcome id cannot become a draft."""
        build = build_decision_config(
            {"decide_by": "llm", "outcomes": [{"id": "approve", "label": "Approve", "when": "Over 500."}]},
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[
                DecisionGenerateOutcome(id="approve", label="Approve"),
                DecisionGenerateOutcome(id="approve", label="Approve again"),
            ],
            forced_decide_by=None,
        )

        assert build.config is None
        assert build.errors == ["node data: Value error, Duplicate outcome id 'approve'"]
        assert build.attempted_decide_by is DecideBy.LLM


class TestFallbackToLlm:
    """A rules proposal with no writable rule becomes an llm configuration built from its descriptions."""

    def test_outcomes_that_are_not_a_list_give_no_fallback(self) -> None:
        assert fallback_to_llm({"outcomes": "x"}, available_variables=_AMOUNT_VARIABLES, preserved_outcomes=[]) is None

    def test_outcomes_without_descriptions_give_no_fallback(self) -> None:
        payload: dict[str, object] = {
            "outcomes": [{"id": "a", "label": "A", "when_description": "  "}, "not an object", {"id": "b"}]
        }

        assert fallback_to_llm(payload, available_variables=_AMOUNT_VARIABLES, preserved_outcomes=[]) is None

    def test_a_preserved_outcome_without_a_description_gives_no_fallback(self) -> None:
        payload: dict[str, object] = {"outcomes": [{"id": "other", "label": "Other", "when_description": "Other."}]}

        result = fallback_to_llm(
            payload,
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[DecisionGenerateOutcome(id="approve", label="Approve me")],
        )

        assert result is None

    def test_preserved_outcomes_come_first_and_inputs_cover_every_variable(self) -> None:
        payload: dict[str, object] = {
            "outcomes": [
                {"id": "zero", "when_description": " The amount is zero. "},
                {"id": "approve", "label": "Renamed", "when_description": "The amount is over 500."},
            ],
            "otherwise": {"label": "Can't decide"},
            "extras": [{"name": "tier", "from": "guess"}],
        }

        result = fallback_to_llm(
            payload,
            available_variables=[
                _variable(["start", "amount"]),
                _variable(["llm", "amount"]),
                _variable(["start", ""], "string"),
            ],
            preserved_outcomes=[DecisionGenerateOutcome(id="approve", label="Approve me")],
        )

        assert result is not None
        assert result["decide_by"] == "llm"
        assert result["outcomes"] == [
            {"id": "approve", "label": "Approve me", "when": "The amount is over 500."},
            {"id": "zero", "label": "", "when": "The amount is zero."},
        ]
        # Input names come from the selector's last part, deduplicated; an empty part gets a generic name.
        assert result["inputs"] == [
            {"variable": "amount", "value_selector": ["start", "amount"]},
            {"variable": "amount_2", "value_selector": ["llm", "amount"]},
            {"variable": "variable", "value_selector": ["start", ""]},
        ]
        # A malformed extra is optional, so it is dropped instead of blocking the fallback.
        assert result["extras"] == []
        assert result["otherwise"] == {"label": "Can't decide"}

    def test_a_preserved_outcome_described_twice_gives_no_fallback(self) -> None:
        """Review V4 F3: the fallback does not guess which proposal owns an existing exit."""
        payload: dict[str, object] = {
            "outcomes": [
                {"id": "approve", "when_description": "Over 500."},
                {"id": "approve", "when_description": "Under 500."},
            ]
        }

        result = fallback_to_llm(
            payload,
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[DecisionGenerateOutcome(id="approve", label="Approve")],
        )

        assert result is None

    def test_a_proposal_the_node_entity_rejects_gives_no_fallback(self) -> None:
        payload: dict[str, object] = {"outcomes": [{"id": "approve", "when_description": "Over 500."}]}

        result = fallback_to_llm(
            payload,
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[
                DecisionGenerateOutcome(id="approve", label="Approve"),
                DecisionGenerateOutcome(id="approve", label="Approve again"),
            ],
        )

        assert result is None


class TestExtraNames:
    """F1: extra names become output variable names, so the editor's pattern is enforced."""

    def _build(self, *extras: dict[str, object]) -> DecisionBuildResult:
        reply = _llm_reply()
        reply["extras"] = list(extras)
        return build_decision_config(
            reply,
            available_variables=_AMOUNT_VARIABLES,
            preserved_outcomes=[],
            forced_decide_by=None,
        )

    def test_valid_names_are_kept(self) -> None:
        build = self._build({"name": "urgency_level", "from": "model", "hint": "How urgent it is"})

        assert build.config is not None
        assert build.config["extras"] == [
            {"name": "urgency_level", "from": "model", "values": {}, "hint": "How urgent it is"}
        ]

    def test_ascii_words_in_a_bad_name_become_the_snake_case_name(self) -> None:
        build = self._build({"name": "Urgency Level", "from": "model", "hint": "How urgent it is"})

        assert build.config is not None
        assert build.config["extras"][0]["name"] == "urgency_level"
        # The model's original wording is kept by prefixing it to the hint.
        assert build.config["extras"][0]["hint"] == "Urgency Level: How urgent it is"

    def test_non_ascii_names_get_extra_n_ids_and_keep_the_wording_in_the_hint(self) -> None:
        build = self._build({"name": "紧急程度", "from": "model", "hint": "请求的紧急程度"})

        assert build.config is not None
        assert build.config["extras"][0]["name"] == "extra_1"
        # The hint already carries the original wording, so it is unchanged.
        assert build.config["extras"][0]["hint"] == "请求的紧急程度"

    def test_non_ascii_name_without_the_wording_in_the_hint_gets_it_prefixed(self) -> None:
        build = self._build({"name": "紧急程度", "from": "model", "hint": "How urgent it is"})

        assert build.config is not None
        assert build.config["extras"][0]["name"] == "extra_1"
        assert build.config["extras"][0]["hint"] == "紧急程度: How urgent it is"

    def test_builtin_and_duplicate_names_are_replaced(self) -> None:
        build = self._build(
            {"name": "reason", "from": "model", "hint": "Why"},
            {"name": "urgency", "from": "fixed", "values": {"urgent": "high"}},
            {"name": "urgency", "from": "fixed", "values": {"urgent": "low"}},
        )

        assert build.config is not None
        assert [extra["name"] for extra in build.config["extras"]] == ["reason_2", "urgency", "urgency_2"]
        # Replaced names keep the model's wording in the hint.
        assert build.config["extras"][0]["hint"] == "reason: Why"

    def test_a_name_derived_from_leading_digits_stays_a_valid_identifier(self) -> None:
        build = self._build({"name": "1st urgency", "from": "model", "hint": "How urgent"})

        assert build.config is not None
        assert build.config["extras"][0]["name"] == "extra_1"


class TestLongestNameDeduplication:
    """F1: a base name already at the maximum length must still get a unique suffix.

    The suffix is reserved before the base is truncated. Truncating the joined
    string instead cuts the suffix off, the candidate never changes, and the
    uniqueness loop spins forever; the timeout turns that regression into a
    failure instead of a hung run.
    """

    @pytest.mark.timeout(10)
    def test_outcome_ids_at_the_maximum_length_still_get_a_unique_suffix(self) -> None:
        used_ids: set[str] = set()

        first = _derive_outcome_id(None, "a" * 64, 0, used_ids)
        second = _derive_outcome_id(None, "a" * 64, 1, used_ids)

        assert first == "a" * 64
        assert second != first
        assert len(second) <= 64
        assert second.endswith("_2")

    @pytest.mark.timeout(10)
    def test_extra_names_at_the_maximum_length_still_get_a_unique_suffix(self) -> None:
        used_names: set[str] = set()

        first, _ = _derive_extra_name("a" * 30, 0, used_names)
        second, _ = _derive_extra_name("a" * 30, 1, used_names)

        assert first == "a" * 30
        assert second != first
        assert len(second) <= 30
        assert second.endswith("_2")


class TestExtraValueKeys:
    """F4: a rewritten outcome id must not orphan the fixed extra values keyed by the old id."""

    def _build(self, values: dict[str, str]) -> DecisionBuildResult:
        return build_decision_config(
            {
                "decide_by": "llm",
                "outcomes": [{"id": "needs approval", "label": "Needs approval", "when": "approval needed"}],
                "extras": [{"name": "priority", "from": "fixed", "values": values}],
            },
            available_variables=[],
            preserved_outcomes=[],
            forced_decide_by=None,
        )

    def test_values_keyed_by_the_proposed_id_follow_the_rewritten_id(self) -> None:
        build = self._build({"needs approval": "high"})

        assert build.config is not None
        assert build.config["outcomes"][0]["id"] == "needs_approval"
        assert build.config["extras"][0]["values"] == {"needs_approval": "high"}

    def test_values_keyed_by_the_label_follow_the_rewritten_id(self) -> None:
        build = self._build({"Needs approval": "high"})

        assert build.config is not None
        assert build.config["extras"][0]["values"] == {"needs_approval": "high"}

    def test_values_keyed_by_no_outcome_are_dropped(self) -> None:
        build = self._build({"needs approval": "high", "gone": "x"})

        assert build.config is not None
        assert build.config["extras"][0]["values"] == {"needs_approval": "high"}

    def test_values_stay_with_their_own_outcome_when_ids_overlap(self) -> None:
        """F1: an original id equal to another outcome's final id must not take its value."""
        build = build_decision_config(
            {
                "decide_by": "llm",
                "outcomes": [
                    {"id": "needs approval", "label": "Needs approval", "when": "approval needed"},
                    {"id": "needs_approval", "label": "Second", "when": "second case"},
                ],
                "extras": [
                    {
                        "name": "priority",
                        "from": "fixed",
                        "values": {"needs approval": "first value", "needs_approval": "second value"},
                    }
                ],
            },
            available_variables=[],
            preserved_outcomes=[],
            forced_decide_by=None,
        )

        assert build.config is not None
        assert [outcome["id"] for outcome in build.config["outcomes"]] == ["needs_approval", "second"]
        assert build.config["extras"][0]["values"] == {"needs_approval": "first value", "second": "second value"}


class TestParseDecisionPayload:
    def test_plain_json(self) -> None:
        payload, error = parse_decision_payload('{"decide_by": "rules"}')
        assert error is None
        assert payload is not None
        assert payload["decide_by"] == "rules"

    def test_surrounding_prose(self) -> None:
        payload, error = parse_decision_payload('Here you go:\n```json\n{"decide_by": "rules"}\n```\nDone.')
        assert error is None
        assert payload is not None
        assert payload["decide_by"] == "rules"

    def test_repairable_json(self) -> None:
        payload, error = parse_decision_payload("{'decide_by': 'rules',}")
        assert error is None
        assert payload is not None
        assert payload["decide_by"] == "rules"

    def test_not_an_object(self) -> None:
        payload, error = parse_decision_payload('["rules"]')
        assert payload is None
        assert error is not None

    def test_a_reply_nested_beyond_the_repair_depth_is_an_error(self) -> None:
        """A truncated, deeply nested reply defeats both parsers; it is reported, not raised."""
        payload, error = parse_decision_payload('{"a":' * 600)

        assert payload is None
        assert error == "The reply was not a valid JSON object."


def test_parse_decision_payload_ignores_think_block_with_braces() -> None:
    reply = '<think>The user wants {"a": 1} style JSON, so I will answer.</think>\n{"decide_by": "llm", "outcomes": []}'

    payload, error = parse_decision_payload(reply)

    assert error is None
    assert payload == {"decide_by": "llm", "outcomes": []}
