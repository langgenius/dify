"""The ``decision`` workflow node.

One node covers both branching styles Dify already ships: mechanical rules
(If-Else) and a language-model pick (Question Classifier). The author lists the
business outcomes; the node picks one and routes on its id.

Run-time contract:

- Outputs are all strings: ``outcome`` (the chosen label), ``outcome_id``,
  ``reason``, ``decided_by`` (the mode actually used), plus one key per extra.
- ``edge_source_handle`` is the chosen outcome id, or ``otherwise``.
- When the result is ``otherwise``: ``outcome`` is ``otherwise.label``,
  ``outcome_id`` is ``otherwise``, and every extra is ``""``.
- A missing or wrongly typed rule input yields ``otherwise`` with a reason
  starting ``Input missing or invalid:``; this is deliberate, If-Else fails the
  node instead. A variable referenced by a ``{{#node.var#}}`` template on the
  right of a condition counts as a rule input: the shared processor would
  compare against the literal selector text, so the node checks it first.
- A configuration error fails the node and names the outcome. That includes a
  constant that cannot be read as the type the rule's variable holds at run
  time (a number, or a boolean).
"""

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any, override

from graphon.enums import (
    NodeExecutionType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMUsage
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.node_events import NodeRunResult
from graphon.node_events.node import ModelInvokeCompletedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import extract_selectors_from_template
from graphon.nodes.llm.file_saver import LLMFileSaver
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMProtocol, PromptMessageSerializerProtocol
from graphon.runtime import InitParams, RuntimeState
from graphon.runtime.runtime_state_protocol import ReadOnlyVariablePool
from graphon.utils.condition.entities import Condition
from graphon.utils.condition.processor import ConditionCheckResult, ConditionProcessor
from graphon.utils.json_in_md_parser import parse_json_markdown
from graphon.variables.segments import ArrayBooleanSegment, BooleanSegment
from graphon.variables.template_resolution import VARIABLE_PATTERN, convert_template
from libs.workflow_template_values import template_value_selectors

from .entities import (
    DECISION_NODE_TYPE,
    OTHERWISE_HANDLE,
    DecideBy,
    DecisionExtra,
    DecisionNodeData,
    ExtraSource,
    LogicalOperator,
    Outcome,
    RuleGroup,
    numeric_constant_error,
)
from .exc import DecisionNodeError
from .prompts import DECISION_INSTRUCTION, build_prompt_messages

_STRING_OPERATORS: frozenset[str] = frozenset(
    ("contains", "not contains", "start with", "end with", "is", "is not", "in", "not in", "all of")
)
_UNARY_OPERATORS: frozenset[str] = frozenset(("empty", "not empty", "null", "not null", "exists", "not exists"))
_THINK_TAG_PATTERN = re.compile(r"<think[^>]*>[\s\S]*?</think>", re.IGNORECASE)


def _as_text(value: object) -> str:
    """Render an extra value as the string the node always outputs."""
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def _render_value(value: object, *, quote: bool) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False) if quote else value
    if isinstance(value, Sequence):
        return ", ".join(_render_value(item, quote=quote) for item in value)
    return str(value)


def _render_condition(condition: Condition) -> str:
    variable = condition.variable_selector[-1] if condition.variable_selector else ""
    operator = condition.comparison_operator
    if operator in _UNARY_OPERATORS:
        return f"{variable} {operator}"
    return f"{variable} {operator} {_render_value(condition.value, quote=operator in _STRING_OPERATORS)}"


def render_rule_group(group: RuleGroup) -> str:
    """Render a matched rule group as the short human-readable ``reason``."""
    joiner = " and " if group.logical_operator is LogicalOperator.AND else " or "
    return joiner.join(_render_condition(condition) for condition in group.conditions)


def _is_boolean_text(text: str) -> bool:
    """Return whether the condition processor can read ``text`` as a boolean.

    Postconditions: ``True`` exactly when ``text`` is JSON for a boolean or an
    integer, the values the processor's boolean conversion accepts.
    """
    try:
        loaded = json.loads(text)
    except ValueError:
        return False
    return isinstance(loaded, int)


def _boolean_constant_error(operator: str, value: object) -> str | None:
    """Return why a condition on a boolean variable can never be evaluated, or ``None``.

    Preconditions: the condition's variable holds a boolean or an array of
    booleans at run time; ``operator`` and ``value`` are the condition's.
    Postconditions: returns a message when the operator takes a value and a
    literal part of ``value`` is text the processor cannot read as a boolean.
    A scalar string carrying a ``{{#node.var#}}`` template is resolved at run
    time, so it is not a constant and yields ``None``; list items are never
    resolved by the processor, so each one is checked as a constant.
    """
    if operator in _UNARY_OPERATORS:
        return None
    if isinstance(value, str):
        items: list[object] = [] if VARIABLE_PATTERN.search(value) else [value]
    elif isinstance(value, Sequence):
        items = list(value)
    else:
        items = []
    bad = [item for item in items if isinstance(item, str) and not _is_boolean_text(item)]
    if not bad:
        return None
    return f"comparison_operator '{operator}' on a boolean needs true or false, but the value is {bad[0]!r}"


def _missing_template_reference(variable_pool: ReadOnlyVariablePool, condition: Condition) -> list[str] | None:
    """Return the first selector a condition's value template names that is not in the pool, or ``None``.

    Preconditions: ``condition`` is about to be evaluated against ``variable_pool``.
    Postconditions: mirrors what the shared processor resolves: only a scalar
    string value of an operator that takes a value is template-resolved, with
    the same pattern ``convert_template`` uses. Any other value yields ``None``.
    """
    value = condition.value
    if condition.comparison_operator in _UNARY_OPERATORS or not isinstance(value, str):
        return None
    selectors = [reference.split(".") for reference in VARIABLE_PATTERN.findall(value)]
    return next((selector for selector in selectors if variable_pool.get(selector) is None), None)


def _strip_think_tags(text: str) -> str:
    if "</think>" not in text:
        return text
    return _THINK_TAG_PATTERN.sub("", text)


class DecisionNode(Node[DecisionNodeData]):
    """Pick one of the configured outcomes, by rules or by a language model."""

    node_type = DECISION_NODE_TYPE
    execution_type = NodeExecutionType.BRANCH

    _model_instance: LLMProtocol | None
    _llm_file_saver: LLMFileSaver | None
    _prompt_message_serializer: PromptMessageSerializerProtocol | None
    _file_outputs: list[Any]

    def __init__(
        self,
        node_id: str,
        data: DecisionNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        model_instance: LLMProtocol | None = None,
        llm_file_saver: LLMFileSaver | None = None,
        prompt_message_serializer: PromptMessageSerializerProtocol | None = None,
    ) -> None:
        """Build the node.

        The model collaborators are optional: ``rules`` mode needs none of them,
        and a misconfigured ``llm`` node fails at run time with a clear message
        instead of breaking graph construction.
        """
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        self._model_instance = model_instance
        self._llm_file_saver = llm_file_saver
        self._prompt_message_serializer = prompt_message_serializer
        self._file_outputs = []

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @classmethod
    @override
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        _ = filters
        return {
            "type": DECISION_NODE_TYPE,
            "config": {
                "decide_by": DecideBy.RULES.value,
                "outcomes": [],
                "otherwise": {"label": ""},
                "inputs": [],
                "extras": [],
            },
        }

    @override
    def _run(self) -> NodeRunResult:
        match self.node_data.decide_by:
            case DecideBy.RULES:
                return self._run_rules()
            case DecideBy.LLM:
                return self._run_llm()
            case DecideBy.DECISION_MODEL:
                return self._failed("decide_by 'decision_model' is not supported yet")

    # ------------------------------------------------------------------ rules

    def _run_rules(self) -> NodeRunResult:
        """Evaluate the outcomes in list order; the first true group wins."""
        node_data = self.node_data
        if not node_data.outcomes:
            return self._failed("Decision node needs at least one outcome")

        groups: list[tuple[Outcome, RuleGroup]] = []
        for outcome in node_data.outcomes:
            when = outcome.when
            if not isinstance(when, RuleGroup):
                return self._failed(f"Outcome '{outcome.id}' needs a rule group in 'when' when decide_by is 'rules'")
            if not when.conditions:
                return self._failed(f"Outcome '{outcome.id}' has no conditions in 'when'")
            for condition in when.conditions:
                problem = self._constant_problem(condition)
                if problem is not None:
                    return self._failed(f"Outcome '{outcome.id}' has a rule that can never be evaluated: {problem}")
            groups.append((outcome, when))

        condition_processor = ConditionProcessor()
        evaluated: list[Mapping[str, Any]] = []
        process_data: dict[str, Any] = {"condition_results": []}
        for outcome, group in groups:
            try:
                check = self._evaluate_group(condition_processor, group)
            except (TypeError, ValueError) as error:
                return self._otherwise(
                    reason=f"Input missing or invalid: {error}",
                    decided_by=DecideBy.RULES,
                    inputs={"conditions": evaluated},
                    process_data=process_data,
                )
            evaluated.extend(check.inputs)
            process_data["condition_results"].append(
                {
                    "outcome_id": outcome.id,
                    "results": list(check.group_results),
                    "final_result": check.final_result,
                }
            )
            if check.final_result:
                return self._succeeded(
                    outcome=outcome,
                    reason=render_rule_group(group),
                    decided_by=DecideBy.RULES,
                    extras=self._rules_extras(outcome.id),
                    inputs={"conditions": evaluated},
                    process_data=process_data,
                )

        return self._otherwise(
            reason="No rule matched",
            decided_by=DecideBy.RULES,
            inputs={"conditions": evaluated},
            process_data=process_data,
        )

    def _evaluate_group(self, condition_processor: ConditionProcessor, group: RuleGroup) -> ConditionCheckResult:
        """Evaluate one rule group condition by condition, short-circuiting as the processor does.

        Preconditions: ``group`` has at least one condition.
        Postconditions: returns what ``process_conditions`` returns for the
        whole group (inputs and results of the evaluated conditions, the group
        result), evaluating conditions in order and stopping at the first
        ``False`` for ``and`` or the first ``True`` for ``or``. Before each
        condition is evaluated, every variable its value template references
        must be in the pool; otherwise raises ``ValueError`` naming the
        selector, so the caller routes to ``otherwise``. Conditions after the
        short-circuit point are neither checked nor evaluated. ``TypeError``
        and ``ValueError`` from the processor propagate unchanged.
        """
        variable_pool = self.runtime_state.variable_pool
        # ``and`` stops at the first False, ``or`` at the first True.
        stop_on = group.logical_operator is LogicalOperator.OR
        inputs: list[Mapping[str, Any]] = []
        results: list[bool] = []
        remaining = list(group.conditions)
        while remaining and (not results or results[-1] is not stop_on):
            condition = remaining.pop(0)
            missing = _missing_template_reference(variable_pool, condition)
            if missing is not None:
                raise ValueError(f"Variable {missing} not found")
            check = condition_processor.process_conditions(
                variable_pool=variable_pool,
                conditions=[condition],
                operator="and",
            )
            inputs.extend(check.inputs)
            results.append(check.final_result)
        final_result = any(results) if stop_on else all(results)
        return ConditionCheckResult(inputs, results, final_result)

    def _constant_problem(self, condition: Condition) -> str | None:
        """Return why a condition's constant can never be evaluated, or ``None``.

        Preconditions: ``condition`` is one condition of a rule group.
        Postconditions: returns a message only when the variable the condition
        selects currently holds a number (``int`` or ``float``, not ``bool``)
        or a boolean (or array of booleans) and the constant cannot be read as
        that type. A missing variable or another type is left to the
        processor, which reports it as an input problem and routes to
        ``otherwise``: the constant alone does not say which operand types the
        rule accepts, and the processor converts it for the type it finds
        (``"true"`` for a boolean, for example).
        """
        variable = self.runtime_state.variable_pool.get(condition.variable_selector)
        if variable is None:
            return None
        if isinstance(variable, BooleanSegment | ArrayBooleanSegment):
            return _boolean_constant_error(condition.comparison_operator, condition.value)
        if isinstance(variable.value, bool) or not isinstance(variable.value, int | float):
            return None
        return numeric_constant_error(condition.comparison_operator, condition.value)

    # -------------------------------------------------------------------- llm

    def _run_llm(self) -> NodeRunResult:
        """Ask the language model to pick one outcome and write the model extras.

        Fails before any model call when the node has no outcomes, mirroring
        ``_run_rules``.
        """
        node_data = self.node_data
        if not node_data.outcomes:
            return self._failed("Decision node needs at least one outcome")
        model = node_data.model
        if model is None:
            return self._failed("Decision node needs a model when decide_by is 'llm'")
        if self._model_instance is None:
            return self._failed("Decision node needs a model instance when decide_by is 'llm'")
        if self._llm_file_saver is None:
            return self._failed("Decision node needs an LLM file saver when decide_by is 'llm'")
        described: list[tuple[Outcome, str]] = []
        for outcome in node_data.outcomes:
            when = outcome.when
            if not isinstance(when, str) or not when.strip():
                return self._failed(
                    f"Outcome '{outcome.id}' needs a non-empty 'when' description when decide_by is 'llm'"
                )
            described.append((outcome, when))

        variable_pool = self.runtime_state.variable_pool
        inputs = self._collect_inputs()
        rendered_outcomes = [
            outcome.model_copy(update={"when": convert_template(variable_pool, when).text})
            for outcome, when in described
        ]
        instruction = DECISION_INSTRUCTION
        if node_data.context.prompt.strip():
            instruction = convert_template(variable_pool, node_data.context.prompt).text
        prompt_messages = build_prompt_messages(
            instruction=instruction,
            glossary=convert_template(variable_pool, node_data.context.glossary).text,
            outcomes=rendered_outcomes,
            extras=node_data.extras,
            inputs=inputs,
        )

        usage = LLMUsage.empty_usage()
        result_text = ""
        finish_reason: str | None = None
        generator = LLMNode.invoke_llm(
            model_instance=self._model_instance,
            prompt_messages=prompt_messages,
            stop=self._model_instance.stop,
            structured_output_enabled=False,
            structured_output=None,
            file_saver=self._llm_file_saver,
            file_outputs=self._file_outputs,
            node_id=self._node_id,
        )
        completed = next((event for event in generator if isinstance(event, ModelInvokeCompletedEvent)), None)
        if completed is not None:
            result_text = completed.text
            usage = completed.usage
            finish_reason = completed.finish_reason

        process_data = {
            "model_mode": model.mode,
            "prompts": self._serialize_prompts(prompt_messages, model_mode=model.mode),
            "usage": jsonable_encoder(usage),
            "finish_reason": finish_reason,
            "model_provider": self._model_instance.provider,
            "model_name": self._model_instance.model_name,
        }
        run_kwargs: dict[str, Any] = {
            "decided_by": DecideBy.LLM,
            "inputs": {"inputs": inputs},
            "process_data": process_data,
            "usage": usage,
        }

        payload = self._parse_model_output(result_text)
        if payload is None:
            return self._otherwise(reason="Model output was not a JSON object", **run_kwargs)
        outcome_id = payload.get("outcome_id")
        if not isinstance(outcome_id, str) or not outcome_id:
            return self._otherwise(reason="Model output did not name an outcome", **run_kwargs)
        model_reason = payload.get("reason")
        reason = model_reason if isinstance(model_reason, str) and model_reason.strip() else ""
        if outcome_id == OTHERWISE_HANDLE:
            return self._otherwise(reason=reason or "Model chose otherwise", **run_kwargs)

        outcome = next((candidate for candidate in node_data.outcomes if candidate.id == outcome_id), None)
        if outcome is None:
            return self._otherwise(reason=f"Model chose unknown outcome '{outcome_id}'", **run_kwargs)

        model_extras = payload.get("extras")
        return self._succeeded(
            outcome=outcome,
            reason=reason,
            extras=self._llm_extras(outcome.id, model_extras if isinstance(model_extras, Mapping) else {}),
            **run_kwargs,
        )

    def _collect_inputs(self) -> dict[str, str]:
        """Resolve the configured input selectors to the text handed to the model."""
        inputs: dict[str, str] = {}
        for input_ in self.node_data.inputs:
            segment = self.runtime_state.variable_pool.get(input_.value_selector)
            inputs[input_.variable] = "" if segment is None else _as_text(segment.value)
        return inputs

    def _serialize_prompts(self, prompt_messages: Sequence[PromptMessage], *, model_mode: LLMMode) -> Any:
        if self._prompt_message_serializer is None:
            return [message.model_dump(mode="json") for message in prompt_messages]
        return self._prompt_message_serializer.serialize(
            model_mode=model_mode,
            prompt_messages=prompt_messages,
        )

    @staticmethod
    def _parse_model_output(result_text: str) -> Mapping[str, Any] | None:
        """Parse the model reply tolerantly: code fences and surrounding text are allowed."""
        try:
            payload = parse_json_markdown(_strip_think_tags(result_text))
        except ValueError:
            return None
        return payload if isinstance(payload, Mapping) else None

    # ----------------------------------------------------------------- extras

    def _rules_extras(self, outcome_id: str) -> dict[str, str]:
        """Every extra is an output in rules mode: fixed ones carry their value, model ones are empty."""
        return {
            extra.name: _as_text(extra.values.get(outcome_id, "")) if extra.from_ is ExtraSource.FIXED else ""
            for extra in self.node_data.extras
        }

    def _llm_extras(self, outcome_id: str, model_extras: Mapping[str, Any]) -> dict[str, str]:
        extras: dict[str, str] = {}
        for extra in self.node_data.extras:
            extras[extra.name] = self._llm_extra_value(extra, outcome_id=outcome_id, model_extras=model_extras)
        return extras

    @staticmethod
    def _llm_extra_value(extra: DecisionExtra, *, outcome_id: str, model_extras: Mapping[str, Any]) -> str:
        if extra.from_ is ExtraSource.FIXED:
            return _as_text(extra.values.get(outcome_id, ""))
        return _as_text(model_extras.get(extra.name, ""))

    # ---------------------------------------------------------------- results

    def _succeeded(
        self,
        *,
        outcome: Outcome,
        reason: str,
        decided_by: DecideBy,
        extras: Mapping[str, str],
        inputs: Mapping[str, Any],
        process_data: Mapping[str, Any],
        usage: LLMUsage | None = None,
    ) -> NodeRunResult:
        outputs: dict[str, str] = {
            "outcome": outcome.label,
            "outcome_id": outcome.id,
            "reason": reason,
            "decided_by": decided_by.value,
        }
        outputs.update(extras)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=outputs,
            edge_source_handle=outcome.id,
            metadata=self._usage_metadata(usage),
            llm_usage=usage or LLMUsage.empty_usage(),
        )

    def _otherwise(
        self,
        *,
        reason: str,
        decided_by: DecideBy,
        inputs: Mapping[str, Any],
        process_data: Mapping[str, Any],
        usage: LLMUsage | None = None,
    ) -> NodeRunResult:
        outputs: dict[str, str] = {
            "outcome": self.node_data.otherwise.label,
            "outcome_id": OTHERWISE_HANDLE,
            "reason": reason,
            "decided_by": decided_by.value,
        }
        for extra in self.node_data.extras:
            outputs[extra.name] = ""
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=outputs,
            edge_source_handle=OTHERWISE_HANDLE,
            metadata=self._usage_metadata(usage),
            llm_usage=usage or LLMUsage.empty_usage(),
        )

    def _failed(self, message: str) -> NodeRunResult:
        """Report a configuration error; the message names the offending outcome."""
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error=message,
            error_type=DecisionNodeError.__name__,
        )

    @staticmethod
    def _usage_metadata(usage: LLMUsage | None) -> Mapping[WorkflowNodeExecutionMetadataKey, Any]:
        if usage is None:
            return {}
        return {
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
            WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
        }

    # --------------------------------------------------------------- mapping

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: DecisionNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """Collect the variables the current ``decide_by`` mode reads, for single-step debugging.

        Preconditions: ``node_data`` is validated decision node data.
        Postconditions: in ``rules`` mode the mapping holds every condition's
        ``variable_selector`` and every ``{{#node.var#}}`` template in its value
        (the condition processor resolves those before comparing); in ``llm``
        mode it holds the model inputs and the templates in the outcome
        descriptions, the glossary and the prompt. Configuration the other mode
        left behind is never demanded as an input. ``decision_model`` reads no
        variable (running it fails the node), so its mapping is empty.
        """
        _ = graph_config
        match node_data.decide_by:
            case DecideBy.RULES:
                return cls._rules_variable_mapping(node_id, node_data)
            case DecideBy.LLM:
                return cls._llm_variable_mapping(node_id, node_data)
            case DecideBy.DECISION_MODEL:
                return {}

    @staticmethod
    def _rules_variable_mapping(node_id: str, node_data: DecisionNodeData) -> dict[str, Sequence[str]]:
        """Map the rule selectors and value templates of every rule-group ``when``."""
        variable_mapping: dict[str, Sequence[str]] = {}
        for outcome in node_data.outcomes:
            when = outcome.when
            if isinstance(when, RuleGroup):
                for condition in when.conditions:
                    key = f"{node_id}.#{'.'.join(condition.variable_selector)}#"
                    variable_mapping[key] = list(condition.variable_selector)
                    for selector in template_value_selectors(condition.value):
                        variable_mapping[f"{node_id}.#{'.'.join(selector)}#"] = selector
        return variable_mapping

    @staticmethod
    def _llm_variable_mapping(node_id: str, node_data: DecisionNodeData) -> dict[str, Sequence[str]]:
        """Map the model inputs and the templates in descriptions, glossary and prompt."""
        variable_mapping: dict[str, Sequence[str]] = {}
        descriptions = [outcome.when for outcome in node_data.outcomes if isinstance(outcome.when, str)]
        for description in descriptions:
            for selector in extract_selectors_from_template(description):
                variable_mapping[f"{node_id}.{selector.variable}"] = list(selector.value_selector)
        for input_ in node_data.inputs:
            variable_mapping[f"{node_id}.{input_.variable}"] = list(input_.value_selector)
        for template in (node_data.context.glossary, node_data.context.prompt):
            for selector in extract_selectors_from_template(template):
                variable_mapping[f"{node_id}.{selector.variable}"] = list(selector.value_selector)
        return variable_mapping
