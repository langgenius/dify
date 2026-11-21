"""Node data for the ``decision`` workflow node.

The node generalises If-Else and Question Classifier: the author lists the
business outcomes, and the node picks one either by rules or by a language
model. Invariants this module owns:

- ``outcomes[].id`` is unique inside the node, matches
  ``^[A-Za-z0-9_-]{1,64}$`` and is never the reserved fallback handle
  ``otherwise``. The id doubles as the edge source handle.
- ``extras[].name`` is unique, matches the editor's output-variable pattern
  ``^[a-zA-Z_][a-zA-Z0-9_]{0,29}$`` and never shadows a built-in output key.
  Extra names become output variable names later nodes reference, so they
  must be identifiers the editor accepts.
- ``inputs[].variable`` is unique. The node hands the inputs to the model as a
  name -> value mapping, so a repeated name would silently drop a value.
- ``outcomes[].when`` accepts both authoring shapes (a rule group for
  ``rules``, a description string for ``llm``) because drafts are saved
  mid-edit; the node checks the shape it needs at run time.
"""

import re
from collections.abc import Sequence
from enum import StrEnum
from typing import Any, Final

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import NodeType
from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.llm.entities import ModelConfig
from graphon.utils.condition.entities import Condition
from graphon.variables.template_resolution import VARIABLE_PATTERN

DECISION_NODE_TYPE: Final[str] = "decision"

#: Edge source handle of the fallback exit. Reserved: no outcome may use it.
OTHERWISE_HANDLE: Final[str] = "otherwise"

#: Output keys the node always writes; an extra may not reuse one.
BUILTIN_OUTPUT_NAMES: Final[frozenset[str]] = frozenset({"outcome", "outcome_id", "reason", "decided_by"})

#: Operators that compare numbers; their constant has to parse as a number.
_NUMERIC_COMPARISON_OPERATORS: Final[frozenset[str]] = frozenset(("=", "≠", ">", "<", "≥", "≤"))

_OUTCOME_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

#: Output names the workflow editor accepts (``^[a-zA-Z_][a-zA-Z0-9_]{0,29}$``);
#: extra names become output variable names later nodes reference.
_EXTRA_NAME_PATTERN: Final = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,29}$")


def is_numeric_comparison(operator: str) -> bool:
    """Return whether ``operator`` compares numbers.

    Preconditions: ``operator`` is a condition's ``comparison_operator``.
    Postconditions: ``True`` for the operators whose constant has to be a
    number, ``False`` for every other operator, including the value-free ones.
    """
    return operator in _NUMERIC_COMPARISON_OPERATORS


def numeric_constant_error(operator: str, value: object) -> str | None:
    """Return why a numeric comparison can never be evaluated, or ``None``.

    Preconditions: ``operator`` is a condition's ``comparison_operator`` and
    ``value`` its ``value``.
    Postconditions: returns a message when ``operator`` compares numbers and
    ``value`` is a constant string that does not parse as a number. A value
    carrying a ``{{#node.var#}}`` template is resolved at run time, so it is
    not a constant and yields ``None``; so does every non-numeric operator.
    """
    if not is_numeric_comparison(operator):
        return None
    if not isinstance(value, str) or VARIABLE_PATTERN.search(value):
        return None
    try:
        float(value)
    except ValueError:
        return f"comparison_operator '{operator}' needs a number, but the value is {value!r}"
    return None


class LogicalOperator(StrEnum):
    """How the conditions of one rule group combine."""

    AND = "and"
    OR = "or"


class ExtraSource(StrEnum):
    """Where an extra output field gets its value."""

    FIXED = "fixed"
    MODEL = "model"


class DecideBy(StrEnum):
    """How the node picks an outcome."""

    RULES = "rules"
    LLM = "llm"
    #: Reserved for a later phase: parses, but running it fails the node.
    DECISION_MODEL = "decision_model"


class RuleGroup(BaseModel):
    """One rule group, in the shape If-Else uses for a single case."""

    logical_operator: LogicalOperator = LogicalOperator.AND
    conditions: list[Condition] = Field(default_factory=list)


class Outcome(BaseModel):
    """One possible business result and the exit it routes to."""

    id: str
    label: str = ""
    #: A rule group (``rules``) or a description string (``llm``).
    when: str | RuleGroup | None = None


class Otherwise(BaseModel):
    """The fallback exit taken when no outcome is chosen."""

    label: str = ""


class DecisionContext(BaseModel):
    """Free text handed to the language model."""

    glossary: str = ""
    #: When non-empty, replaces the built-in instruction text.
    prompt: str = ""


class DecisionExtra(BaseModel):
    """An extra output field written either from a fixed table or by the model.

    ``name`` becomes an output variable name, so it must be an identifier the
    editor accepts; the human wording belongs in ``hint`` (or the labels of
    ``values``), not in the name.
    """

    model_config = ConfigDict(populate_by_name=True)

    name: str
    from_: ExtraSource = Field(default=ExtraSource.FIXED, alias="from")
    #: ``from: "fixed"``: the value for each outcome id.
    values: dict[str, Any] = Field(default_factory=dict)
    #: ``from: "model"``: what the model should write.
    hint: str = ""

    @field_validator("name")
    @classmethod
    def _require_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Extra name must not be empty")
        if not _EXTRA_NAME_PATTERN.match(value):
            raise ValueError(f"Extra name {value!r} must match ^[a-zA-Z_][a-zA-Z0-9_]{{0,29}}$")
        return value


class DecisionNodeData(BaseNodeData):
    """Node data of the ``decision`` node."""

    type: NodeType = DECISION_NODE_TYPE
    #: The user's original sentence. Reference only: never executed, never sent to the model.
    intent: str = ""
    decide_by: DecideBy = DecideBy.RULES
    outcomes: Sequence[Outcome] = Field(default_factory=list)
    otherwise: Otherwise = Field(default_factory=Otherwise)
    #: Values handed to the language model (``llm`` only).
    inputs: Sequence[VariableSelector] = Field(default_factory=list)
    #: Required for ``llm``; may be absent for ``rules``.
    model: ModelConfig | None = None
    context: DecisionContext = Field(default_factory=DecisionContext)
    extras: Sequence[DecisionExtra] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_outcome_ids(self) -> "DecisionNodeData":
        seen: set[str] = set()
        for outcome in self.outcomes:
            if not _OUTCOME_ID_PATTERN.match(outcome.id):
                raise ValueError(f"Outcome id {outcome.id!r} must match ^[A-Za-z0-9_-]{{1,64}}$")
            if outcome.id == OTHERWISE_HANDLE:
                raise ValueError(f"Outcome id {OTHERWISE_HANDLE!r} is reserved for the fallback exit")
            if outcome.id in seen:
                raise ValueError(f"Duplicate outcome id {outcome.id!r}")
            seen.add(outcome.id)
        return self

    @model_validator(mode="after")
    def _validate_extra_names(self) -> "DecisionNodeData":
        seen: set[str] = set()
        for extra in self.extras:
            if extra.name in BUILTIN_OUTPUT_NAMES:
                raise ValueError(f"Extra name {extra.name!r} collides with a built-in output")
            if extra.name in seen:
                raise ValueError(f"Duplicate extra name {extra.name!r}")
            seen.add(extra.name)
        return self

    @model_validator(mode="after")
    def _validate_input_names(self) -> "DecisionNodeData":
        """Reject repeated ``inputs[].variable`` names when ``decide_by`` is ``llm``.

        Preconditions: none beyond field validation.
        Postconditions: on success an ``llm`` node has unique input names, so
        the name -> value mapping built for the model keeps every input; DSL
        import and draft validation reject a repeated name instead. Other
        modes never read ``inputs`` (the editor keeps them across a mode
        switch and hides them), so leftover repeats there are accepted
        unchanged and the node still loads and runs.
        """
        names = [input_.variable for input_ in self.inputs] if self.decide_by == DecideBy.LLM else []
        duplicates = sorted({name for name in names if names.count(name) > 1})
        if duplicates:
            raise ValueError(f"Duplicate input variable {duplicates[0]!r}")
        return self
