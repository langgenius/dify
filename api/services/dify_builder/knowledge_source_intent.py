"""Source-bound cognition, never resource authorization or a goal waiver.

Only original user text and validated submitted controls establish the source.
Derived requirements and generated plans cannot confirm their own intent.
Existing actor, version, resource and explicit waiver owners remain authoritative.
"""

import json
from typing import Literal, NotRequired, TypedDict

from core.dify_builder.models import DifyBuilderContext
from runtime_contracts.builder.execution import canonical_digest

SOURCE_INPUT = "_builder_knowledge_source"


class KnowledgeSourceIntent(TypedDict):
    state: Literal["required", "excluded", "unspecified", "unknown"]
    evidence: list[str]
    # Added only by the planning adapter, never accepted from model JSON.
    source_digest: NotRequired[str]


KNOWLEDGE_SOURCE_DOMAIN_INSTRUCTION = (
    " Knowledge source means a Dify Workspace dataset or native Knowledge source for retrieval-grounded answers. "
    "External document search or fetch through a Tool or MCP is a tool source, regardless of provider or "
    "whether its content is company, product or public documentation. A tool source alone does not require "
    "native Knowledge. A mixed request that independently requires native Knowledge still retains that requirement."
)


INTENT_INSTRUCTION = (
    '\nIn the SAME response include knowledge_source_intent: {"state":"required|excluded|unspecified|unknown",'
    '"evidence":["exact source excerpt"]}. Use exactly these two keys. Classify the ORIGINAL USER SOURCE, '
    "not derived requirement keys, proposed plans or catalogue availability."
    + KNOWLEDGE_SOURCE_DOMAIN_INSTRUCTION
    + " required includes any affirmative, mixed, conditional or undecided native Knowledge requirement, "
    "including an explicitly named Workspace dataset or Knowledge source. "
    "excluded means the user explicitly excludes native Knowledge use; a restriction on retrieval nodes/configuration "
    "does not exclude the source. unspecified means no native Knowledge source decision, including tool-only "
    "requests without an explicit Knowledge exclusion; unknown means uncertain. "
    "A negative list can include arbitrary activities, not only fixed resource names. Never invent an exclusion. "
    "For required/excluded cite 1-4 exact excerpts (at most 600 characters each) from the original goal or "
    "actual submitted answer label/value in USER SOURCE. Use the label together with its submitted value, "
    "never infer intent from an arbitrary field key or an unselected option. Recommendations and model summaries "
    "are not submitted answers. This classification never changes a previously required or retained source; "
    "only the user's existing explicit goal-change decision may do that."
)


def parse_source_intent(value: object, source: dict) -> KnowledgeSourceIntent | None:
    """Validate a bounded semantic result against real source; invalid means unknown.

    This checks shape and exact grounding, not the truth of model reasoning.
    Never infer a decision from arbitrary keys or normalize malformed metadata.
    """
    if not isinstance(value, dict) or set(value) != {"state", "evidence"}:
        return None
    state = value.get("state")
    evidence = value.get("evidence")
    texts = [source.get("goal", "")]
    answers = source.get("answers", [])
    if not isinstance(answers, list):
        return None
    for answer in answers:
        if isinstance(answer, dict):
            texts.extend([answer.get("label", ""), json.dumps(answer.get("value"), ensure_ascii=False)])
            if isinstance(answer.get("value"), str):
                texts.append(answer["value"])
    if (
        not isinstance(evidence, list)
        or len(evidence) > 4
        or any(
            not isinstance(quote, str)
            or not quote.strip()
            or len(quote) > 600
            or not any(isinstance(text, str) and quote in text for text in texts)
            for quote in evidence
        )
        or (state in ("required", "excluded") and not evidence)
    ):
        return None
    match state:
        case "required" | "excluded" | "unspecified" | "unknown":
            return {"state": state, "evidence": list(evidence)}
        case _:
            return None


def bind_planning_source_intent(value: object, source: dict) -> KnowledgeSourceIntent | None:
    """Tag newly parsed planner metadata with the exact request source digest.

    The request includes execution generation as well as stable user source.
    A cancelled in-flight result must not rebind an exclusion after Resume.
    The model's fixed schema cannot supply this server-owned tag.
    """
    if type(source.get("generation")) is not int:
        return None
    intent = parse_source_intent(value, source)
    if intent is not None:
        intent["source_digest"] = canonical_digest(source)
    return intent


def user_source(context: DifyBuilderContext) -> dict | None:
    """Reconstruct current real source; legacy/incomplete provenance stays unknown.

    Values are read from the current requirements only when a server-recorded
    submitted control agrees. Goal, answers and logical task define accepted
    interpretation; execution generation belongs only to in-flight results.
    """
    keys = context.confirmed_requirement_keys
    if (
        not isinstance(keys, list)
        or any(not isinstance(key, str) or not key for key in keys)
        or len(keys) != len(set(keys))
        or any(key not in context.confirmed_requirement_sources for key in keys)
    ):
        return None
    answers = []
    try:
        for key in sorted(keys):
            control = context.confirmed_requirement_sources[key]
            if (
                not isinstance(control, dict)
                or key not in context.requirements
                or json.dumps(control.get("value"), sort_keys=True, allow_nan=False)
                != json.dumps(context.requirements[key], sort_keys=True, allow_nan=False)
            ):
                return None
            answers.append({"key": key, **control})
        # Rendered copy references contain string enums. Persist native JSON
        # primitives so their digest survives the repository JSON roundtrip.
        return json.loads(
            json.dumps(
                {
                    "goal": context.goal_text,
                    "answers": answers,
                    "logical_task_id": context.logical_task_id,
                },
                ensure_ascii=False,
                allow_nan=False,
            )
        )
    except (TypeError, ValueError, RecursionError):
        return None


def record_source_intent(context: DifyBuilderContext, value: object) -> None:
    """Bind newly parsed cognition to current source; never rebind an old result.

    Missing/invalid results do not refresh a stale exclusion. An established
    positive remains required within its task until the existing waiver owner
    accepts an explicit user change.
    """
    source = user_source(context)
    intent = None
    if source is not None and isinstance(value, dict):
        if "source_digest" in value:
            producer_source = {**source, "generation": context.task_control.get("generation", 0)}
            if value.get("source_digest") == canonical_digest(producer_source) and set(value) == {
                "state",
                "evidence",
                "source_digest",
            }:
                intent = parse_source_intent({"state": value.get("state"), "evidence": value.get("evidence")}, source)
        else:
            intent = parse_source_intent(value, source)
    if intent is not None:
        required = established_source_required(context) or intent["state"] == "required"
        context.knowledge_source_intent = {
            **intent,
            "source_digest": canonical_digest(source),
            "generation": context.task_control.get("generation", 0),
            "logical_task_id": context.logical_task_id,
            "required": required,
        }


def established_source_required(context: DifyBuilderContext) -> bool:
    """Keep required intent for its logical task, including ordinary Resume.

    Execution generation fences in-flight results; it does not authorize
    dropping a positive requirement. New logical tasks do not inherit it.
    """
    record = context.knowledge_source_intent
    return (
        record.get("required") is True and record.get("logical_task_id") == context.logical_task_id
    ) or context.resource_selection.get("blocked_capability") == "knowledge_retrieval_phase_two"


def current_source_intent(context: DifyBuilderContext) -> KnowledgeSourceIntent | None:
    """Read accepted source meaning across Resume; changed user source excludes nothing."""
    record = context.knowledge_source_intent
    if not record:
        return None
    source = user_source(context)
    if source is None or record.get("source_digest") != canonical_digest(source):
        return None
    return parse_source_intent({"state": record.get("state"), "evidence": record.get("evidence")}, source)


def source_intent_needs_refresh(context: DifyBuilderContext) -> bool:
    """Refresh invalidated fresh-source cognition in the already planned call.

    Legacy/missing intent retains existing conservative behavior. Established
    required sources reach discovery without asking the planner again.
    """
    return (
        bool(context.knowledge_source_intent)
        and current_source_intent(context) is None
        and not established_source_required(context)
    )


def planning_requirements(context: DifyBuilderContext, requirements: dict) -> dict:
    """Add a server-owned source envelope only for the semantic-intent path.

    Always discard a derived value under the reserved key. No new invocation
    or endpoint is introduced; existing planning cognition returns its intent.
    """
    result = {key: value for key, value in requirements.items() if key != SOURCE_INPUT}
    source = user_source(context)
    if context.knowledge_source_intent and source is not None:
        result[SOURCE_INPUT] = {**source, "generation": context.task_control.get("generation", 0)}
    return result
