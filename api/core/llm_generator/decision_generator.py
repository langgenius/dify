"""Code-enforced normalization and validation for the decision-node generator.

The language model proposes the node's configuration as JSON; this module
makes the proposal safe to write into a node draft unchanged. Invariants owned
here (all enforced in code, not only in the prompt):

- ``decide_by`` is ``rules`` or ``llm`` — never ``decision_model``.
- Outcome ids match the entity pattern ``^[A-Za-z0-9_-]{1,64}$``, are unique and
  never the reserved fallback handle ``otherwise``. Bad ids are fixed here
  instead of failing: readable ids are derived from ASCII labels
  (``Needs approval`` → ``needs_approval``), other labels get ``outcome_1``,
  ``outcome_2``, … by position.
- Extra names match the editor's output-variable pattern
  ``^[a-zA-Z_][a-zA-Z0-9_]{0,29}$``, are unique and never a built-in output
  name. Bad names are fixed here the same way: a name the editor accepts is
  kept, otherwise one is derived from the ASCII words in the proposal
  (``Urgency Level`` → ``urgency_level``) or from position
  (``extra_1``, ``extra_2``, …); when a name is replaced the model's original
  wording is prefixed to the extra's ``hint`` so the meaning is not lost.
- Fixed extra values are keyed by the outcome the model named — its proposed id
  or its label — and rewritten to that outcome's final id. Ownership comes from
  that original identity only, never from the final-id set, so a value cannot
  move to an outcome that merely ended up with the id another outcome was
  proposed under; a key that names no original outcome is dropped.
- In ``rules`` mode every condition's ``variable_selector`` is one of the
  available variables and its ``comparison_operator`` is legal for that
  variable's type; values follow the If-Else encoding (numbers as strings, no
  value for the operators that take none), and a numeric comparison's constant
  parses as a number unless it is a ``{{#node.var#}}`` template.
- In ``llm`` mode every ``when`` is a non-empty sentence, every input
  selector is an available variable and every input name is unique.
- An existing (preserved) outcome is matched only by the id the model proposed
  for it, and its id is reserved before new outcomes get ids, so a new outcome
  can never take over an existing, already-wired exit. A preserved outcome
  proposed zero or several times is a validation error, never a guess.
- The proposal is validated with the decision node's own entities; there is no
  second schema.

Model mistakes that cannot change the decision's meaning (ids, number
encodings) are fixed here; mistakes that would (unknown selectors, illegal
operators) are reported as validation errors for the caller's one repair retry.
"""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, NamedTuple, TypedDict

import json_repair
from pydantic import ValidationError

from core.llm_generator.entities import DecisionGenerateOutcome, DecisionGenerateVariable
from core.workflow.nodes.decision.entities import (
    BUILTIN_OUTPUT_NAMES,
    OTHERWISE_HANDLE,
    DecideBy,
    DecisionExtra,
    DecisionNodeData,
    ExtraSource,
    LogicalOperator,
    Otherwise,
    Outcome,
    RuleGroup,
    is_numeric_comparison,
    numeric_constant_error,
)
from graphon.nodes.base.entities import VariableSelector
from graphon.utils.condition.entities import Condition

_MAX_OUTCOME_ID_LENGTH = 64
_OUTCOME_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

#: Output names the workflow editor accepts; extra names become output
#: variable names later nodes reference, so the generator fixes bad ones in
#: code the same way it fixes outcome ids.
_EXTRA_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,29}$")
_MAX_EXTRA_NAME_LENGTH = 30

# Operator-by-type table mirroring the frontend If-Else node's operator logic
# in web/app/components/workflow/nodes/if-else/utils.ts (``getOperators``):
# the generator may only emit operators the If-Else UI would offer for the
# same variable type. File types are narrower than the UI, because the
# condition processor needs a sub-variable condition the generator does not
# write. The value encoding mirrors how If-Else stores values: numbers as
# strings, and no value for the operators that take none.
_NUMBER_OPERATORS: frozenset[str] = frozenset(("=", "≠", ">", "<", "≥", "≤", "empty", "not empty"))
_STRING_OPERATORS: frozenset[str] = frozenset(
    ("contains", "not contains", "start with", "end with", "is", "is not", "empty", "not empty")
)
_ARRAY_ELEMENT_OPERATORS: frozenset[str] = frozenset(("contains", "not contains", "empty", "not empty"))
#: ``contains``, ``not contains`` and ``all of`` on a file array need a
#: ``sub_variable_condition`` the generator does not write in this phase, so
#: only the operators the processor runs without one are offered here.
_FILE_OPERATORS: frozenset[str] = frozenset(("exists", "not exists", "empty", "not empty"))
_EMPTY_ONLY_OPERATORS: frozenset[str] = frozenset(("empty", "not empty"))

#: Insertion-ordered so the rendered prompt table stays readable.
_OPERATORS_BY_TYPE: dict[str, frozenset[str]] = {
    "string": _STRING_OPERATORS,
    "number": _NUMBER_OPERATORS,
    "integer": _NUMBER_OPERATORS,
    "boolean": frozenset(("is", "is not")),
    "file": _FILE_OPERATORS,
    "array[string]": _ARRAY_ELEMENT_OPERATORS,
    "array[number]": _ARRAY_ELEMENT_OPERATORS,
    "array[boolean]": _ARRAY_ELEMENT_OPERATORS,
    "array": _EMPTY_ONLY_OPERATORS,
    "array[object]": _EMPTY_ONLY_OPERATORS,
    "array[file]": _FILE_OPERATORS,
}

#: The ``default`` branch of the frontend table (object, secret, unknown types).
DEFAULT_OPERATORS: frozenset[str] = frozenset(("is", "is not", "empty", "not empty"))

#: Operators that take no value; the If-Else UI stores none for them. The
#: ``null`` / ``not null`` spellings are the ones the stored Condition payload
#: uses (``comparisonOperatorNotRequireValue`` in the same frontend file).
_VALUE_FREE_OPERATORS: frozenset[str] = frozenset(("empty", "not empty", "null", "not null", "exists", "not exists"))

#: Fallback label reason written in code when a rules proposal cannot be written.
_RULES_UNWRITABLE_REASON = "No rule can be written against the available variables; decided by language model instead."


class DecisionGenerateResultDict(TypedDict):
    """Wire shape returned by the generator: a draft-ready node configuration."""

    decide_by: str
    decide_by_reason: str
    outcomes: list[dict[str, Any]]
    otherwise: dict[str, Any]
    inputs: list[dict[str, Any]]
    extras: list[dict[str, Any]]
    error: str


@dataclass(frozen=True)
class _ModelOutcome:
    """One outcome as the model proposed it, with the id already fixed in code."""

    id: str
    label: str
    when: Any
    when_description: str
    #: The id the model wrote, kept so extra values keyed by it can be rewritten.
    proposed_id: str


class _OutcomeIdentity(NamedTuple):
    """One outcome's final id and the keys the model may have used for it."""

    final_id: str
    proposed_id: str
    label: str


@dataclass(frozen=True)
class DecisionBuildResult:
    """Outcome of validating one model proposal.

    ``config`` is a draft-ready configuration when ``errors`` is empty, else
    ``None``. ``attempted_decide_by`` is the mode the proposal was checked
    against (``None`` when the model did not name a usable mode).
    ``valid_rule_groups`` counts the outcomes whose ``when`` built a rule group,
    so the caller can tell a partially writable rules proposal from one where
    no rule can be written at all.
    """

    config: DecisionGenerateResultDict | None
    errors: list[str]
    attempted_decide_by: DecideBy | None
    valid_rule_groups: int


def empty_decision_result() -> DecisionGenerateResultDict:
    """Return the all-defaults result used when generation fails."""
    return {
        "decide_by": "",
        "decide_by_reason": "",
        "outcomes": [],
        "otherwise": {"label": ""},
        "inputs": [],
        "extras": [],
        "error": "",
    }


def decision_result_error(message: str) -> DecisionGenerateResultDict:
    """Return the failure result: a short reason, everything else empty/default."""
    result = empty_decision_result()
    result["error"] = message
    return result


def format_operator_table() -> str:
    """Render the operator-by-type table for the generation prompt."""
    lines = [f"  - {var_type}: {', '.join(sorted(operators))}" for var_type, operators in _OPERATORS_BY_TYPE.items()]
    lines.append(f"  - other types (object, secret, unknown): {', '.join(sorted(DEFAULT_OPERATORS))}")
    return "\n".join(lines)


# Reasoning models may prepend their thinking as a ``<think>`` block; it can
# contain braces, so it is removed before the JSON object is located.
_THINK_BLOCK_PATTERN = re.compile(r"<think[^>]*>[\s\S]*?</think>", re.IGNORECASE)


def parse_decision_payload(text: str) -> tuple[Mapping[str, Any] | None, str | None]:
    """Parse the model reply into a JSON object, tolerating noise around it.

    Preconditions: ``text`` is the raw reply content.
    Returns ``(payload, error)``: exactly one is non-None; ``payload`` is a
    JSON object, or the error explains what the reply was not.
    """
    raw = _THINK_BLOCK_PATTERN.sub("", text).strip()
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        raw = raw[first_brace : last_brace + 1]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        try:
            parsed = json_repair.loads(raw)
        except Exception:
            return None, "The reply was not a valid JSON object."
    if not isinstance(parsed, dict):
        return None, "The reply was not a JSON object."
    return parsed, None


def build_decision_config(
    model_payload: Mapping[str, Any],
    *,
    available_variables: Sequence[DecisionGenerateVariable],
    preserved_outcomes: Sequence[DecisionGenerateOutcome],
    forced_decide_by: DecideBy | None,
) -> DecisionBuildResult:
    """Validate a model proposal against the decision node's own entities.

    Preconditions:
    - ``model_payload`` is a parsed JSON object from the language model.
    - ``available_variables`` / ``preserved_outcomes`` come from the validated
      request payload; ``forced_decide_by`` is the mode the user chose, if any.

    Postconditions:
    - With no errors, ``config`` validates unchanged as a ``DecisionNodeData``
      and carries every invariant listed in the module docstring; preserved
      outcomes keep their ids, labels and list position.
    - With errors, ``config`` is ``None`` and the errors name the offending
      outcome or condition so the repair retry can quote them back.
    """
    errors: list[str] = []
    attempted = forced_decide_by
    if attempted is None:
        attempted = _parse_decide_by(model_payload.get("decide_by"))
        if attempted is None:
            errors.append("'decide_by' must be 'rules' or 'llm'")
            return DecisionBuildResult(None, errors, None, 0)

    model_outcomes = _normalize_model_outcomes(
        model_payload.get("outcomes"),
        reserved_ids=frozenset(preserved.id for preserved in preserved_outcomes),
        errors=errors,
    )
    outcome_entries = _assemble_outcome_entries(model_outcomes, preserved_outcomes, errors)
    if not outcome_entries:
        errors.append("At least one outcome is required")

    outcome_entities: list[Outcome] = []
    valid_rule_groups = 0
    for outcome_id, label, when_raw in outcome_entries:
        if attempted is DecideBy.RULES:
            when: str | RuleGroup | None = _build_rule_group(outcome_id, when_raw, available_variables, errors)
            if when is not None:
                valid_rule_groups += 1
        else:
            when = _build_llm_when(outcome_id, when_raw, errors)
        outcome_entities.append(Outcome(id=outcome_id, label=label, when=when))

    input_entities: list[VariableSelector] = []
    if attempted is DecideBy.LLM:
        input_entities = _build_inputs(model_payload.get("inputs"), available_variables, errors)

    extra_entities = _build_extras(model_payload.get("extras"), errors)
    extra_entities = _remap_extra_values(
        extra_entities,
        value_keys=_outcome_value_keys(_outcome_identities(model_outcomes, preserved_outcomes)),
    )
    otherwise_entity = _build_otherwise(model_payload.get("otherwise"), errors)
    reason = model_payload.get("decide_by_reason")
    decide_by_reason = reason if isinstance(reason, str) else ""

    if errors:
        return DecisionBuildResult(None, errors, attempted, valid_rule_groups)

    try:
        DecisionNodeData(
            decide_by=attempted,
            outcomes=outcome_entities,
            otherwise=otherwise_entity,
            inputs=input_entities,
            extras=extra_entities,
        )
    except ValidationError as error:
        node_errors = [f"node data: {issue['msg']}" for issue in error.errors()]
        return DecisionBuildResult(None, node_errors, attempted, valid_rule_groups)

    config: DecisionGenerateResultDict = {
        "decide_by": attempted.value,
        "decide_by_reason": decide_by_reason,
        "outcomes": [_dump_outcome(outcome) for outcome in outcome_entities],
        "otherwise": {"label": otherwise_entity.label},
        "inputs": [
            {"variable": input_.variable, "value_selector": list(input_.value_selector)} for input_ in input_entities
        ],
        "extras": [extra.model_dump(mode="json", by_alias=True) for extra in extra_entities],
        "error": "",
    }
    return DecisionBuildResult(config, [], attempted, valid_rule_groups)


def fallback_to_llm(
    model_payload: Mapping[str, Any],
    *,
    available_variables: Sequence[DecisionGenerateVariable],
    preserved_outcomes: Sequence[DecisionGenerateOutcome],
) -> DecisionGenerateResultDict | None:
    """Build an llm-mode config from a rules proposal whose rules cannot be written.

    Preconditions: ``build_decision_config`` reported errors for a proposal the
    model was free to mode-choose, and no rule group could be built from it.
    Postconditions: returns a config validated through the node entities with
    each outcome's ``when`` taken from its ``when_description`` sentence, or
    ``None`` when the proposal carries no usable descriptions. A preserved
    outcome is matched only by the id the model proposed, exactly once; a
    missing or repeated match also yields ``None`` instead of a guess; a
    repeat counts over every outcome object in the proposal, including those
    without a description.
    """
    raw_outcomes = model_payload.get("outcomes")
    if not isinstance(raw_outcomes, list):
        return None
    # An existing outcome proposed more than once cannot be matched without
    # guessing which proposal owns its wired exit. Count before dropping the
    # outcomes without a description: the builder already rejected this
    # ambiguity, and the fallback must not quietly resolve it.
    proposed_ids = [raw.get("id") for raw in raw_outcomes if isinstance(raw, Mapping)]
    if any(proposed_ids.count(preserved.id) > 1 for preserved in preserved_outcomes):
        return None
    parsed = [
        (index, raw)
        for index, raw in enumerate(raw_outcomes)
        if isinstance(raw, Mapping) and isinstance(raw.get("when_description"), str) and raw["when_description"].strip()
    ]
    if not parsed:
        return None

    model_by_id = {raw.get("id"): raw for _, raw in parsed if isinstance(raw.get("id"), str)}
    preserved_ids = {preserved.id for preserved in preserved_outcomes}
    used_ids: set[str] = set()
    identities: list[_OutcomeIdentity] = []
    outcome_entities: list[Outcome] = []
    for preserved in preserved_outcomes:
        raw = model_by_id.get(preserved.id)
        if raw is None:
            return None
        used_ids.add(preserved.id)
        identities.append(_OutcomeIdentity(final_id=preserved.id, proposed_id=preserved.id, label=preserved.label))
        outcome_entities.append(Outcome(id=preserved.id, label=preserved.label, when=raw["when_description"].strip()))
    for index, raw in parsed:
        raw_id = raw.get("id")
        if isinstance(raw_id, str) and raw_id in preserved_ids:
            continue
        label = raw.get("label")
        label = label if isinstance(label, str) else ""
        outcome_id = _derive_outcome_id(raw_id, label, index, used_ids)
        identities.append(
            _OutcomeIdentity(
                final_id=outcome_id,
                proposed_id=raw_id if isinstance(raw_id, str) else "",
                label=label,
            )
        )
        outcome_entities.append(Outcome(id=outcome_id, label=label, when=raw["when_description"].strip()))

    inputs: list[VariableSelector] = []
    used_names: set[str] = set()
    for variable in available_variables:
        name = _short_variable_name(variable, used_names)
        inputs.append(VariableSelector(variable=name, value_selector=list(variable.value_selector)))

    extra_errors: list[str] = []
    extra_entities = _build_extras(model_payload.get("extras"), extra_errors)
    if extra_errors:
        # Extras are optional; a malformed one must not block the fallback.
        extra_entities = []
    extra_entities = _remap_extra_values(
        extra_entities,
        value_keys=_outcome_value_keys(identities),
    )
    otherwise_entity = _build_otherwise(model_payload.get("otherwise"), [])

    try:
        DecisionNodeData(
            decide_by=DecideBy.LLM,
            outcomes=outcome_entities,
            otherwise=otherwise_entity,
            inputs=inputs,
            extras=extra_entities,
        )
    except ValidationError:
        return None

    return {
        "decide_by": DecideBy.LLM.value,
        "decide_by_reason": _RULES_UNWRITABLE_REASON,
        "outcomes": [_dump_outcome(outcome) for outcome in outcome_entities],
        "otherwise": {"label": otherwise_entity.label},
        "inputs": [{"variable": input_.variable, "value_selector": list(input_.value_selector)} for input_ in inputs],
        "extras": [extra.model_dump(mode="json", by_alias=True) for extra in extra_entities],
        "error": "",
    }


def _parse_decide_by(value: Any) -> DecideBy | None:
    """Return the mode the model named, or ``None`` when it is not generatable."""
    if value == DecideBy.RULES.value:
        return DecideBy.RULES
    if value == DecideBy.LLM.value:
        return DecideBy.LLM
    return None


def _normalize_model_outcomes(
    raw_outcomes: Any,
    *,
    reserved_ids: frozenset[str],
    errors: list[str],
) -> list[_ModelOutcome | None]:
    """Fix outcome ids in code and keep labels, ``when`` and descriptions for validation.

    Preconditions: ``reserved_ids`` holds the ids of the existing (preserved)
    outcomes, which may already be wired to downstream nodes.
    Postconditions: an outcome the model proposed under a reserved id keeps
    exactly that id, so it can only be matched to the existing outcome through
    its ``proposed_id``; every other outcome gets an id derived by
    ``_derive_outcome_id`` that is never a reserved id, so a new outcome can
    never take over an existing outcome's id (and with it the existing exit's
    edge). Errors for malformed entries are appended to ``errors``; their
    position holds ``None``.
    """
    if not isinstance(raw_outcomes, list):
        errors.append("'outcomes' must be a list of objects")
        return []
    used_ids: set[str] = set(reserved_ids)
    normalized: list[_ModelOutcome | None] = []
    for index, raw in enumerate(raw_outcomes):
        if not isinstance(raw, Mapping):
            errors.append(f"outcomes[{index}] must be an object")
            normalized.append(None)
        else:
            normalized.append(_normalize_model_outcome(raw, index, reserved_ids, used_ids))
    return normalized


def _normalize_model_outcome(
    raw: Mapping[str, Any],
    index: int,
    reserved_ids: frozenset[str],
    used_ids: set[str],
) -> _ModelOutcome:
    """Return one proposed outcome with its id fixed in code.

    Preconditions: ``used_ids`` already contains every id in ``reserved_ids``
    plus the ids chosen for earlier outcomes of this proposal.
    Postconditions: a proposal naming a reserved id keeps it unchanged (two
    proposals naming the same reserved id are left for
    ``_assemble_outcome_entries`` to reject); any other proposal gets a fresh
    id from ``_derive_outcome_id``, which is added to ``used_ids``.
    """
    label = raw.get("label")
    label = label if isinstance(label, str) else ""
    when_description = raw.get("when_description")
    when_description = when_description if isinstance(when_description, str) else ""
    proposed_id = raw.get("id")
    proposed_id = proposed_id if isinstance(proposed_id, str) else ""
    outcome_id = proposed_id if proposed_id in reserved_ids else _derive_outcome_id(proposed_id, label, index, used_ids)
    return _ModelOutcome(
        id=outcome_id,
        label=label,
        when=raw.get("when"),
        when_description=when_description,
        proposed_id=proposed_id,
    )


def _assemble_outcome_entries(
    model_outcomes: Sequence[_ModelOutcome | None],
    preserved_outcomes: Sequence[DecisionGenerateOutcome],
    errors: list[str],
) -> list[tuple[str, str, Any]]:
    """Place preserved outcomes first with their exact ids and labels, then the model's additions.

    Preconditions: ``model_outcomes`` comes from ``_normalize_model_outcomes``
    with the preserved ids reserved.
    Postconditions: a preserved outcome takes the ``when`` of the one model
    outcome whose original ``proposed_id`` equals its id. It is never matched
    through a rewritten id, so a new outcome cannot hand its condition to an
    existing, already-wired exit. No match, or more than one, is reported in
    ``errors`` for the repair retry instead of guessing; the preserved outcome
    is then left out of the result. Model outcomes not proposed under a
    preserved id follow in proposal order.
    """
    entries: list[tuple[str, str, Any]] = []
    for preserved in preserved_outcomes:
        matches = [outcome for outcome in model_outcomes if outcome is not None and outcome.proposed_id == preserved.id]
        if not matches:
            errors.append(f"No 'when' was generated for the existing outcome '{preserved.id}'")
        elif len(matches) > 1:
            errors.append(
                f"The existing outcome '{preserved.id}' was proposed {len(matches)} times; propose it exactly once"
            )
        else:
            entries.append((preserved.id, preserved.label, matches[0].when))
    preserved_ids = {preserved.id for preserved in preserved_outcomes}
    appended = [
        (outcome.id, outcome.label, outcome.when)
        for outcome in model_outcomes
        if outcome is not None and outcome.proposed_id not in preserved_ids
    ]
    return [*entries, *appended]


def _derive_outcome_id(candidate: Any, label: str, index: int, used_ids: set[str]) -> str:
    """Return an id the decision node accepts, fixing the model's proposal in code.

    Preconditions: ``used_ids`` holds the ids already chosen in this proposal.
    Postconditions: the returned id matches ``^[A-Za-z0-9_-]{1,64}$``, is not
    the reserved ``otherwise`` handle, is unique in ``used_ids`` and is added
    to it. Readable ids come from ASCII labels; other labels get
    ``outcome_{index + 1}``.
    """
    if (
        isinstance(candidate, str)
        and _OUTCOME_ID_PATTERN.match(candidate)
        and candidate != OTHERWISE_HANDLE
        and candidate not in used_ids
    ):
        used_ids.add(candidate)
        return candidate
    base = _slug_from_label(label) or f"outcome_{index + 1}"
    outcome_id = base[:_MAX_OUTCOME_ID_LENGTH]
    suffix = 2
    while outcome_id == OTHERWISE_HANDLE or outcome_id in used_ids:
        outcome_id = _with_suffix(base, suffix, _MAX_OUTCOME_ID_LENGTH)
        suffix += 1
    used_ids.add(outcome_id)
    return outcome_id


def _with_suffix(base: str, suffix: int, max_length: int) -> str:
    """Append ``_<suffix>`` to ``base``, shortening the base so the suffix survives.

    Preconditions: ``base`` is a candidate name, ``suffix`` a positive integer.
    Postconditions: the result is at most ``max_length`` characters and ends
    with ``_<suffix>``. Truncating the joined string instead would cut the
    suffix off a base already at ``max_length``, leaving the candidate
    unchanged and the caller's uniqueness loop spinning forever.
    """
    tail = f"_{suffix}"
    return f"{base[: max_length - len(tail)]}{tail}"


def _slug_from_label(label: str) -> str:
    """``Needs approval`` → ``needs_approval``; non-ASCII or empty labels yield ``''``."""
    if not label or not label.isascii():
        return ""
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug[:_MAX_OUTCOME_ID_LENGTH]


def _outcome_identities(
    model_outcomes: Sequence[_ModelOutcome | None],
    preserved_outcomes: Sequence[DecisionGenerateOutcome],
) -> list[_OutcomeIdentity]:
    """List every outcome's final id with the keys the model may have used for it.

    Preconditions: ``model_outcomes`` carries the ids already fixed in code;
    ``preserved_outcomes`` are the outcomes whose ids and labels were kept.
    Postconditions: preserved outcomes come first, then the model's outcomes in
    proposal order; each entry pairs a final id with the proposed id and label
    that may key a fixed extra value.
    """
    identities = [
        _OutcomeIdentity(final_id=preserved.id, proposed_id=preserved.id, label=preserved.label)
        for preserved in preserved_outcomes
    ]
    identities.extend(
        _OutcomeIdentity(final_id=outcome.id, proposed_id=outcome.proposed_id, label=outcome.label)
        for outcome in model_outcomes
        if outcome is not None
    )
    return identities


def _outcome_value_keys(identities: Sequence[_OutcomeIdentity]) -> dict[str, str]:
    """Map every key the model may have used for an outcome to that outcome's final id.

    Preconditions: ``identities`` lists the outcomes in list order.
    Postconditions: keys are the proposed ids and the labels, values the final
    ids — including the ones that did not change. Proposed ids are recorded
    before labels and the first outcome in list order wins a shared key, so a
    key never points at another outcome's id.
    """
    keys: dict[str, str] = {}
    for identity in identities:
        if identity.proposed_id:
            keys.setdefault(identity.proposed_id, identity.final_id)
    for identity in identities:
        if identity.label:
            keys.setdefault(identity.label, identity.final_id)
    return keys


def _remap_extra_values(
    extras: Sequence[DecisionExtra],
    *,
    value_keys: Mapping[str, str],
) -> list[DecisionExtra]:
    """Point fixed extra values at the ids the outcomes ended up with.

    Preconditions: ``value_keys`` maps every key the model may have used for an
    outcome to that outcome's final id.
    Postconditions: every fixed extra keeps only the values whose key names an
    original outcome, rewritten to that outcome's final id; a key that names no
    original outcome is dropped. Ownership is never inferred from the final-id
    set, so a value cannot move to an outcome that merely ended up with the id
    another outcome was proposed under. Model-written extras are unchanged.
    """
    remapped: list[DecisionExtra] = []
    for extra in extras:
        if extra.from_ is not ExtraSource.FIXED:
            remapped.append(extra)
            continue
        values: dict[str, Any] = {}
        for key, value in extra.values.items():
            final_id = value_keys.get(key)
            if final_id is not None:
                values[final_id] = value
        remapped.append(extra.model_copy(update={"values": values}))
    return remapped


def _build_rule_group(
    outcome_id: str,
    when_raw: Any,
    available_variables: Sequence[DecisionGenerateVariable],
    errors: list[str],
) -> RuleGroup | None:
    """Validate one rules-mode ``when`` against the available variables.

    Postconditions: returns a ``RuleGroup`` whose every condition selects an
    available variable, uses an operator legal for that variable's type and
    encodes its value the way If-Else stores it — or ``None`` with the
    offending outcome named in ``errors``.
    """
    where = f"outcome '{outcome_id}'"
    if not isinstance(when_raw, Mapping):
        errors.append(f"{where}: 'when' must be a rule group object in rules mode")
        return None
    logical_operator = when_raw.get("logical_operator", "and")
    if logical_operator not in ("and", "or"):
        errors.append(f"{where}: 'logical_operator' must be 'and' or 'or'")
        return None
    raw_conditions = when_raw.get("conditions")
    if not isinstance(raw_conditions, list):
        errors.append(f"{where}: 'conditions' must be a list")
        return None
    conditions = [
        condition
        for condition in (
            _build_condition(f"{where} condition {index}", raw, available_variables, errors)
            for index, raw in enumerate(raw_conditions)
        )
        if condition is not None
    ]
    if not conditions:
        errors.append(f"{where}: at least one condition is required in rules mode")
        return None
    return RuleGroup(logical_operator=LogicalOperator(logical_operator), conditions=conditions)


def _build_condition(
    where: str,
    raw: Any,
    available_variables: Sequence[DecisionGenerateVariable],
    errors: list[str],
) -> Condition | None:
    """Validate one rule condition; every error names ``where`` it came from."""
    if not isinstance(raw, Mapping):
        errors.append(f"{where} must be an object")
        return None
    selector = raw.get("variable_selector")
    if not (isinstance(selector, list) and selector and all(isinstance(part, str) for part in selector)):
        errors.append(f"{where}: 'variable_selector' must be a non-empty list of strings")
        return None
    variable = _find_variable(available_variables, selector)
    if variable is None:
        errors.append(f"{where}: variable_selector {json.dumps(selector)} is not one of the available variables")
        return None
    operator = raw.get("comparison_operator")
    if not isinstance(operator, str):
        errors.append(f"{where}: 'comparison_operator' must be a string")
        return None
    legal_operators = _OPERATORS_BY_TYPE.get(variable.type, DEFAULT_OPERATORS)
    if operator not in legal_operators:
        errors.append(f"{where}: comparison_operator '{operator}' is not legal for type '{variable.type}'")
        return None
    value, value_ok = _normalize_condition_value(raw.get("value"), operator, where, errors)
    if not value_ok:
        return None
    problem = _numeric_constant_problem(operator, value)
    if problem is not None:
        errors.append(f"{where}: {problem}")
        return None
    try:
        return Condition.model_validate(
            {"variable_selector": selector, "comparison_operator": operator, "value": value}
        )
    except ValidationError as error:
        errors.append(f"{where}: {error.errors()[0]['msg']}")
        return None


def _numeric_constant_problem(operator: str, value: object) -> str | None:
    """Return why a numeric comparison's constant can never be evaluated, or ``None``.

    Preconditions: ``operator`` is a condition's ``comparison_operator`` and
    ``value`` its encoded value.
    Postconditions: for a numeric comparison operator, returns a message unless
    ``value`` is a scalar string that parses as a number or carries a
    ``{{#node.var#}}`` template. A list is not a scalar, so it is rejected here
    even though the shared check only inspects strings; the processor would
    raise ``Cannot convert <class 'list'> to number`` and route to
    ``otherwise`` instead of letting the repair retry fix the rule.
    """
    if not is_numeric_comparison(operator):
        return None
    if not isinstance(value, str):
        return f"comparison_operator '{operator}' needs a single number, but the value is {value!r}"
    return numeric_constant_error(operator, value)


def _normalize_condition_value(raw_value: Any, operator: str, where: str, errors: list[str]) -> tuple[Any, bool]:
    """Encode a condition value the way If-Else stores it.

    Unary operators carry no value; numbers become strings; strings, booleans
    and string lists pass through. Returns the encoded value and whether it was
    usable.
    """
    if operator in _VALUE_FREE_OPERATORS:
        return None, True
    if raw_value is None:
        errors.append(f"{where}: a value is required for comparison_operator '{operator}'")
        return None, False
    if isinstance(raw_value, bool):
        return raw_value, True
    if isinstance(raw_value, int | float):
        return str(raw_value), True
    if isinstance(raw_value, str):
        return raw_value, True
    list_items_usable = isinstance(raw_value, list) and all(
        isinstance(item, str | int | float) and not isinstance(item, bool) for item in raw_value
    )
    if list_items_usable:
        return [item if isinstance(item, str) else str(item) for item in raw_value], True
    errors.append(f"{where}: the value must be a string, a number or a list of strings")
    return None, False


def _build_llm_when(outcome_id: str, when_raw: Any, errors: list[str]) -> str | None:
    """Validate one llm-mode ``when``: it must be a non-empty sentence."""
    if not isinstance(when_raw, str) or not when_raw.strip():
        errors.append(f"outcome '{outcome_id}': 'when' must be a non-empty sentence in llm mode")
        return None
    return when_raw.strip()


def _build_inputs(
    raw_inputs: Any,
    available_variables: Sequence[DecisionGenerateVariable],
    errors: list[str],
) -> list[VariableSelector]:
    """Validate the llm-mode inputs: chosen from the available variables, unique names.

    Preconditions: ``raw_inputs`` is the model's proposed ``inputs`` value.
    Postconditions: returns the inputs that are well formed and select an
    available variable; every malformed input and every input whose
    ``variable`` name repeats an earlier one is named in ``errors`` for the
    repair retry, so a configuration is only built when the names are unique.
    """
    if raw_inputs is None:
        return []
    if not isinstance(raw_inputs, list):
        errors.append("'inputs' must be a list")
        return []
    built = [
        (index, _build_input(f"inputs[{index}]", raw, available_variables, errors))
        for index, raw in enumerate(raw_inputs)
    ]
    # The node hands inputs to the model as a name -> value mapping, so a
    # repeated name would silently drop the earlier value; reject it instead.
    seen_names: set[str] = set()
    for index, input_ in built:
        if input_ is not None and input_.variable in seen_names:
            errors.append(f"inputs[{index}]: 'variable' {input_.variable!r} is already used by another input")
        if input_ is not None:
            seen_names.add(input_.variable)
    return [input_ for _, input_ in built if input_ is not None]


def _build_input(
    where: str,
    raw: Any,
    available_variables: Sequence[DecisionGenerateVariable],
    errors: list[str],
) -> VariableSelector | None:
    if not isinstance(raw, Mapping):
        errors.append(f"{where} must be an object")
        return None
    variable = raw.get("variable")
    if not (isinstance(variable, str) and variable.strip()):
        errors.append(f"{where}: 'variable' must be a non-empty string")
        return None
    selector = raw.get("value_selector")
    if not (isinstance(selector, list) and selector and all(isinstance(part, str) for part in selector)):
        errors.append(f"{where}: 'value_selector' must be a non-empty list of strings")
        return None
    if _find_variable(available_variables, selector) is None:
        errors.append(f"{where}: value_selector {json.dumps(selector)} is not one of the available variables")
        return None
    return VariableSelector(variable=variable, value_selector=selector)


def _build_extras(raw_extras: Any, errors: list[str]) -> list[DecisionExtra]:
    """Normalize and validate the extra outputs with the node's own entity.

    Preconditions: ``raw_extras`` is the model's proposed ``extras`` value.
    Postconditions: every returned extra has a name the editor accepts —
    unique, not a built-in output name, matching
    ``^[a-zA-Z_][a-zA-Z0-9_]{0,29}$``; a replaced name keeps the model's
    original wording prefixed to the extra's ``hint``. Field mistakes other
    than the name are reported in ``errors`` for the repair retry.
    """
    if raw_extras is None:
        return []
    if not isinstance(raw_extras, list):
        errors.append("'extras' must be a list")
        return []
    extras: list[DecisionExtra] = []
    used_names: set[str] = set()
    for index, raw in enumerate(raw_extras):
        normalized = _normalize_extra(raw, index, used_names)
        if normalized is None:
            errors.append(f"extras[{index}] must be an object")
            continue
        try:
            extras.append(DecisionExtra.model_validate(normalized))
        except ValidationError as error:
            first_issue = error.errors()[0]
            errors.append(f"extras[{index}]: {first_issue['msg']}")
    return extras


def _normalize_extra(raw: Any, index: int, used_names: set[str]) -> dict[str, Any] | None:
    """Return the extra with its name fixed in code, or ``None`` when ``raw`` is not an object.

    Preconditions: ``used_names`` holds the names already chosen in this
    proposal. Postconditions: the returned dict carries an editor-acceptable
    name; when the name replaced the model's proposal, the original wording is
    prefixed to ``hint`` unless ``hint`` already contains it.
    """
    if not isinstance(raw, Mapping):
        return None
    proposed = raw.get("name")
    proposed = proposed if isinstance(proposed, str) else ""
    hint = raw.get("hint")
    hint = hint if isinstance(hint, str) else ""
    name, replaced = _derive_extra_name(proposed, index, used_names)
    if replaced and proposed and proposed not in hint:
        hint = f"{proposed}: {hint}" if hint.strip() else proposed
    return {**raw, "name": name, "hint": hint}


def _derive_extra_name(proposed: str, index: int, used_names: set[str]) -> tuple[str, bool]:
    """Return the extra's output name and whether it replaced the model's proposal.

    Preconditions: ``used_names`` holds the names already chosen in this proposal.
    Postconditions: the returned name matches ``^[a-zA-Z_][a-zA-Z0-9_]{0,29}$``,
    is not a built-in output name, is unique in ``used_names`` and is added to
    it. Readable names come from the ASCII words of the proposal
    (``Urgency Level`` → ``urgency_level``); proposals without usable ASCII
    words get ``extra_{index + 1}``.
    """
    if (
        proposed
        and _EXTRA_NAME_PATTERN.match(proposed)
        and proposed not in BUILTIN_OUTPUT_NAMES
        and proposed not in used_names
    ):
        used_names.add(proposed)
        return proposed, False
    base = _slug_from_ascii_words(proposed)
    if not _EXTRA_NAME_PATTERN.match(base):
        base = f"extra_{index + 1}"
    name = base[:_MAX_EXTRA_NAME_LENGTH]
    suffix = 2
    while name in BUILTIN_OUTPUT_NAMES or name in used_names:
        name = _with_suffix(base, suffix, _MAX_EXTRA_NAME_LENGTH)
        suffix += 1
    used_names.add(name)
    return name, True


def _slug_from_ascii_words(text: str) -> str:
    """``Urgency Level`` → ``urgency_level``; text without ASCII words yields ``''``."""
    words = re.findall(r"[A-Za-z0-9]+", text)
    return "_".join(words).lower()[:_MAX_EXTRA_NAME_LENGTH]


def _build_otherwise(raw_otherwise: Any, errors: list[str]) -> Otherwise:
    """Validate the fallback exit: it only carries a label."""
    if raw_otherwise is None:
        return Otherwise(label="")
    if not isinstance(raw_otherwise, Mapping):
        errors.append("'otherwise' must be an object with a 'label'")
        return Otherwise(label="")
    label = raw_otherwise.get("label")
    if not isinstance(label, str):
        errors.append("'otherwise.label' must be a string")
        return Otherwise(label="")
    return Otherwise(label=label)


def _find_variable(
    available_variables: Sequence[DecisionGenerateVariable],
    selector: Sequence[str],
) -> DecisionGenerateVariable | None:
    """Return the available variable a selector names, or ``None``."""
    for variable in available_variables:
        if list(variable.value_selector) == list(selector):
            return variable
    return None


def _short_variable_name(variable: DecisionGenerateVariable, used_names: set[str]) -> str:
    """Derive a short, unique input name from a variable's selector path."""
    base = re.sub(r"[^A-Za-z0-9_]", "_", variable.value_selector[-1] if variable.value_selector else "variable")
    if not base:
        base = "variable"
    name = base
    suffix = 2
    while name in used_names:
        name = f"{base}_{suffix}"
        suffix += 1
    used_names.add(name)
    return name


def _dump_outcome(outcome: Outcome) -> dict[str, Any]:
    """Serialize one outcome for the wire, keeping the entity as the single schema."""
    return {"id": outcome.id, "label": outcome.label, "when": _dump_when(outcome.when)}


def _dump_when(when: str | RuleGroup | None) -> Any:
    if isinstance(when, RuleGroup):
        return {
            "logical_operator": when.logical_operator.value,
            "conditions": [condition.model_dump(mode="json", exclude_none=True) for condition in when.conditions],
        }
    return when
