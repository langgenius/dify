"""Plan proposals and the presentation snapshot shared by Build and Edit."""

import re
from collections.abc import Iterator
from dataclasses import dataclass

from core.dify_builder.contract import PlanCard, ResourceOption
from core.dify_builder.models import DifyBuilderContext

PLAN_PRESENTATION_INSTRUCTION = (
    "Give the plan a short, specific title describing its goal, without a step count. "
    "Describe input_summary and output_summary in one concise natural-language sentence each. "
    "They describe the entire resulting workflow after this plan is applied: what starts it or "
    "what it receives, and what it returns or delivers. Include inputs and outputs that remain "
    "unchanged. These are expected workflow behavior, not the edit request, node configuration, "
    "a JSON schema, sample data, or a claim that the workflow has already run. "
    "Do not invent inputs, destinations, external effects, or results absent from the source. "
    'Reply with ONLY JSON: {"title": "...", "input_summary": "...", '
    '"output_summary": "...", "plan": ["step", ...]}.'
    " Keep at most 30 steps, 2000 characters per step/summary, 200 characters in the title, "
    "and 24000 characters across the complete plan."
)


@dataclass
class WorkflowPlan:
    title: str
    input_summary: str
    output_summary: str
    items: list[str]
    # Set only by resource reconciliation; unused selections must not force a
    # generated action. None retains the ordinary abstract/Edit plan contract.
    used_resource_ids: list[str] | None = None
    # Server-owned, nonexecuting knowledge preferences; never graph bindings.
    discovery_resource_ids: list[str] | None = None


class ResourceDiscovery(list[ResourceOption]):  # noqa: FURB189 - preserve the existing list-valued agent port
    """Server facts; model hints may ask a question, never waive a goal."""

    def __init__(
        self,
        options: list[ResourceOption],
        *,
        knowledge_source_unavailable: bool = False,
        knowledge_requires_clarification: bool = False,
    ) -> None:
        super().__init__(options)
        self.knowledge_source_unavailable = knowledge_source_unavailable
        self.knowledge_requires_clarification = knowledge_requires_clarification


_KNOWLEDGE_CUE = re.compile(r"知识库|知识检索|knowledge[ _-]+(?:bases?|retrieval)", re.IGNORECASE)
_SOURCE_SCOPE_BREAK = re.compile(r"[。.!?！？;；\n]|\b(?:but|however|yet|instead|then)\b|但是|不过|然而|而是|但")
_SOURCE_EXCLUSION = re.compile(
    r"不(?:要)?(?:使用|用|依赖|访问|查询|检索|增加|添加)|(?:无需|无须|不需要)(?:使用|用|依赖|访问|查询|检索|增加|添加)?|"
    r"(?:禁止|禁用|排除)(?:使用|访问|查询|检索|增加|添加)?|"
    r"\b(?:do not|don't|must not|should not|never)\s+(?:use|query|access|include|add|rely on|retrieve from)\s+|"
    r"\b(?:without|exclude|excluding|no need for)\s+|\bno need to\s+(?:use|query|access)\s+|"
    r"\bavoid\s+(?:using|querying|accessing)\s+"
)
_RESOURCE_MODIFIER = r"(?:(?:a|an|the|any|external|existing|workspace|other|外部|现有|已有|任何|工作区|其他)\s*)*"
_RESOURCE_CLASS = (
    r"(?:工具|插件|模型|文件|代码|知识库|知识检索|code|tools?|https?|agents?|plugins?|models?|files?|"
    r"knowledge[ _-]+(?:bases?|retrieval))"
)
_RESOURCE_LIST_SEPARATOR = r"(?:[,，、/&]|\band\b|\bor\b|和|或|以及|与)"
# Keep independent post-comma clauses only for the original bounded grammar.
# Expanded prefixes require a complete suffix list, never shared predicate prose.
_LEGACY_EXCLUDED_LIST_TAIL = re.compile(
    rf"\s*(?:{_RESOURCE_MODIFIER}{_RESOURCE_CLASS}\s*{_RESOURCE_LIST_SEPARATOR}\s*)*{_RESOURCE_MODIFIER}"
)
_EXCLUDED_LIST_TAIL = re.compile(
    rf"\s*(?:{_RESOURCE_MODIFIER}(?:new\s+|新)?(?:资源|resources?|{_RESOURCE_CLASS})"
    rf"\s*{_RESOURCE_LIST_SEPARATOR}\s*)*"
    rf"{_RESOURCE_MODIFIER}"
)
_SUFFIX_RESOURCE_ITEM = (
    rf"{_RESOURCE_MODIFIER}(?:new\s+|新)?"
    rf"(?:资源|resources?|凭据|credentials?|(?:业务)?(?:账户|账号)|(?:business\s+)?accounts?|{_RESOURCE_CLASS})"
)
_EXCLUDED_LIST_SUFFIX = re.compile(
    rf"\s*(?:{_RESOURCE_LIST_SEPARATOR}\s*{_SUFFIX_RESOURCE_ITEM}\s*)*(?=$|[。.!?！？;；\n])"
)
_INDEPENDENT_POSTCOMMA = re.compile(rf"\s*[,，](?!\s*{_SUFFIX_RESOURCE_ITEM})")
_NEGATED_EXCLUSION = re.compile(r"不|无需|无须|禁止|禁用|避免|拒绝|\b(?:not|never|without|avoid|cannot|no|\w+n['’]t)\b")
_SOURCE_IMPLEMENTATION = re.compile(
    r"\s*(?:的)?(?:检索)?(?:节点|配置|参数|绑定)|"
    r"\s+(?:retrieval\s+)?(?:nodes?|configuration|settings|parameters?|bindings?)\b"
)
_CONDITIONAL_SOURCE = re.compile(r"\b(?:if|unless|except)\b|除非|如果|若")

# A complete identifier role, not an arbitrary negative substring or node list.
_EXCLUDED_RESOURCE_LIST_ROLE = re.compile(
    r"(?:forbidden|excluded|disallowed|no|without)"
    r"(?:_(?:(?:extra|additional|other)_)?(?:resources|components|additions))?"
)


def _requirement_texts(value: object) -> Iterator[str]:
    # Ordinary JSON keys and booleans do not request a source.
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, child in value.items():
            if isinstance(key, str) and _EXCLUDED_RESOURCE_LIST_ROLE.fullmatch(key) and isinstance(child, list):
                # Only exact native categories inherit this explicit list role.
                # Unknown prose and nested children may still request retrieval.
                for member in child:
                    if isinstance(member, str) and re.fullmatch(_RESOURCE_CLASS, member.strip(), re.IGNORECASE):
                        continue
                    yield from _requirement_texts(member)
            else:
                yield from _requirement_texts(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _requirement_texts(child)


def has_knowledge_source_cue(goal: str, requirements: object) -> bool:
    """Ask for affirmative/uncertain sources, not an explicitly excluded resource.

    Only a local use/access exclusion (including a resource list) discounts a
    mention. Node/configuration restrictions and double negatives cannot waive
    retrieval. Any remaining mention, including a positive requirement elsewhere,
    still asks; this does not override offered resources or other source guards.
    """
    for text in (goal, *_requirement_texts(requirements)):
        text = text.casefold()
        for cue in _KNOWLEDGE_CUE.finditer(text):
            if _SOURCE_IMPLEMENTATION.match(text[cue.end() :]):
                return True
            suffix = text[cue.end() :]
            prefix = _SOURCE_SCOPE_BREAK.split(text[: cue.start()])[-1]
            if _CONDITIONAL_SOURCE.search(prefix + _SOURCE_SCOPE_BREAK.split(text[cue.end() :])[0]):
                return True
            excluded = any(
                _EXCLUDED_LIST_TAIL.fullmatch(prefix[exclusion.end() :])
                and (
                    _EXCLUDED_LIST_SUFFIX.match(suffix)
                    or (
                        _LEGACY_EXCLUDED_LIST_TAIL.fullmatch(prefix[exclusion.end() :])
                        and _INDEPENDENT_POSTCOMMA.match(suffix)
                    )
                )
                # An earlier negation in the same adjoining clause makes the
                # exclusion unproven (cannot avoid, 不可以不, 不需要禁止...).
                and not _NEGATED_EXCLUSION.search(re.split(r"[,，、]", prefix[: exclusion.start()])[-1])
                for exclusion in _SOURCE_EXCLUSION.finditer(prefix)
            )
            if not excluded:
                return True
    return False


def validated_confirmed_requirement_keys(value: object) -> list[str] | None:
    """Copy server provenance; malformed or absent data retains legacy scanning."""
    if (
        not isinstance(value, list)
        or any(not isinstance(key, str) or not key for key in value)
        or len(set(value)) != len(value)
    ):
        return None
    return list(value)


def has_confirmed_knowledge_source_cue(
    goal: str, requirements: dict[str, object], confirmed_keys: list[str] | None
) -> bool:
    """Discount derived summaries only for an already recognized raw exclusion.

    Keep all requirements for unknown provenance or goals without an explicit
    excluded source. Confirmed keys refer to current values, including defaults;
    a missing current key is unproven and must keep the source gate closed.
    """
    keys = validated_confirmed_requirement_keys(confirmed_keys)
    if keys is None or not _KNOWLEDGE_CUE.search(goal) or has_knowledge_source_cue(goal, {}):
        return has_knowledge_source_cue(goal, requirements)
    if any(key not in requirements for key in keys):
        return True
    return has_knowledge_source_cue(goal, {key: requirements[key] for key in keys})


class EditPlanNotActionableError(RuntimeError):
    """An Edit goal has no approvable change; never a stored/public plan."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)


def parse_plan_response(data: object) -> WorkflowPlan:
    """Decode the complete proposal; failures never quote source or generated prose."""
    if not isinstance(data, dict):
        raise ValueError(f"The response must be an object, received {type(data).__name__}.")
    if "plan" not in data:
        raise ValueError("The required plan field is missing.")
    plan = data["plan"]
    if not isinstance(plan, list):
        raise ValueError(f"The plan field must be a nonempty list of strings, received {type(plan).__name__}.")
    if not plan:
        raise ValueError("The plan field must contain at least one nonblank string.")
    if len(plan) > 30:
        raise ValueError("The plan exceeds the 30-step limit.")
    items: list[str] = []
    for index, item in enumerate(plan):
        if not isinstance(item, str):
            raise ValueError(f"The plan[{index}] field must be a nonblank string, received {type(item).__name__}.")
        if not item.strip():
            raise ValueError(f"The plan[{index}] field is blank; every item must be a nonblank string.")
        if len(item) > 2000:
            raise ValueError("A plan step exceeds the 2000-character limit.")
        items.append(item)
    overview: dict[str, str] = {}
    for key in ("title", "input_summary", "output_summary"):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"The {key} field must be a nonblank string.")
        if len(value) > (200 if key == "title" else 2000):
            raise ValueError(f"The {key} field exceeds its character limit.")
        overview[key] = value
    if sum(map(len, [*items, *overview.values()])) > 24_000:
        raise ValueError("The complete plan exceeds the 24000-character limit.")
    return WorkflowPlan(
        title=overview["title"],
        input_summary=overview["input_summary"],
        output_summary=overview["output_summary"],
        items=items,
    )


def store_plan(context: DifyBuilderContext, plan: WorkflowPlan) -> None:
    """Replace steps and their overview together, including on replanning."""
    context.plan_items = list(plan.items)
    context.plan_title = plan.title
    context.plan_input_summary = plan.input_summary
    context.plan_output_summary = plan.output_summary


def make_plan_card(context: DifyBuilderContext) -> PlanCard:
    """Freeze the overview alongside the final, resource-bound step list."""
    return PlanCard(
        title=context.plan_title,
        input_summary=context.plan_input_summary,
        output_summary=context.plan_output_summary,
        items=list(context.plan_items),
    )
