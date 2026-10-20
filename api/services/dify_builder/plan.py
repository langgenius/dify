"""Plan proposals and the presentation snapshot shared by Build and Edit."""

from dataclasses import dataclass

from core.dify_builder.contract import PlanCard
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
)


@dataclass
class WorkflowPlan:
    title: str
    input_summary: str
    output_summary: str
    items: list[str]


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
    items: list[str] = []
    for index, item in enumerate(plan):
        if not isinstance(item, str):
            raise ValueError(f"The plan[{index}] field must be a nonblank string, received {type(item).__name__}.")
        if not item.strip():
            raise ValueError(f"The plan[{index}] field is blank; every item must be a nonblank string.")
        items.append(item)
    overview: dict[str, str] = {}
    for key in ("title", "input_summary", "output_summary"):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"The {key} field must be a nonblank string.")
        overview[key] = value
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
