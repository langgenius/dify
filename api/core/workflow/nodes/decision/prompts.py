"""Prompt construction for the ``decision`` node's language-model mode.

The prompt is the instruction text followed by machine sections the node always
appends: the glossary, the outcomes, the extras the model must write, the input
values, and the output contract. Only the instruction text is author-editable;
the machine sections are generated from the node data so the model always sees
the same contract.
"""

import json
from collections.abc import Mapping, Sequence

from graphon.model_runtime.entities.message_entities import (
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)

from .entities import DecisionExtra, ExtraSource, Outcome

DECISION_INSTRUCTION = (
    "You are a decision engine inside a workflow. "
    "Read the input values and choose exactly one of the listed outcomes. "
    "Choose the outcome whose description best matches the input. "
    'If no outcome matches, choose "otherwise".'
)

OUTPUT_CONTRACT = (
    "### Output\n"
    "Return only one JSON object and nothing else, with no code fence and no commentary:\n"
    '{"outcome_id": "<one of the outcome ids, or otherwise>", '
    '"reason": "<one sentence in the language of the outcome labels>", '
    '"extras": {"<extra name>": "<value>"}}'
)


def build_glossary_section(glossary: str) -> str:
    """Return the glossary section, or an empty string when there is no glossary."""
    if not glossary.strip():
        return ""
    return "### Glossary\n" + glossary.strip()


def build_outcomes_section(outcomes: Sequence[Outcome]) -> str:
    """Return the outcomes section: a JSON list of ``{id, label, when}``."""
    payload = [{"id": outcome.id, "label": outcome.label, "when": outcome.when} for outcome in outcomes]
    return "### Outcomes\n" + json.dumps(payload, ensure_ascii=False, indent=2)


def build_extras_section(extras: Sequence[DecisionExtra]) -> str:
    """Return the extras section for the model-written extras, or an empty string."""
    payload = [{"name": extra.name, "hint": extra.hint} for extra in extras if extra.from_ is ExtraSource.MODEL]
    if not payload:
        return ""
    return "### Extras\n" + json.dumps(payload, ensure_ascii=False, indent=2)


def build_inputs_section(inputs: Mapping[str, str]) -> str:
    """Return the input values section."""
    return "### Inputs\n" + json.dumps(dict(inputs), ensure_ascii=False, indent=2)


def build_prompt_messages(
    *,
    instruction: str,
    glossary: str,
    outcomes: Sequence[Outcome],
    extras: Sequence[DecisionExtra],
    inputs: Mapping[str, str],
) -> list[PromptMessage]:
    """Build the prompt: the instruction as the system message, the machine sections as the user message."""
    sections = [
        section
        for section in (
            build_glossary_section(glossary),
            build_outcomes_section(outcomes),
            build_extras_section(extras),
            build_inputs_section(inputs),
            OUTPUT_CONTRACT,
        )
        if section
    ]
    return [
        SystemPromptMessage(content=instruction),
        UserPromptMessage(content="\n\n".join(sections)),
    ]
