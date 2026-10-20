"""Edit plan integrity, bounded correction and complete workflow I/O context."""

import json
from collections.abc import Sequence
from copy import deepcopy
from typing import cast

import pytest

from core.dify_builder.models import Graph
from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE, TRIGGER_SCHEDULE_NODE_TYPE, TRIGGER_WEBHOOK_NODE_TYPE
from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from services.dify_builder.agent import edit


class Message:
    def __init__(self, text: str) -> None:
        self.text = text

    def get_text_content(self) -> str:
        return self.text


class Reply:
    def __init__(self, text: str) -> None:
        self.message = Message(text)


class RecordingModel:
    def __init__(self, replies: Sequence[str | Exception]) -> None:
        self.replies = iter(replies)
        self.prompts: list[str] = []

    def invoke_llm(self, **kwargs: object) -> Reply:
        messages = cast(list[SystemPromptMessage | UserPromptMessage], kwargs["prompt_messages"])
        assert isinstance(messages[1].content, str)
        self.prompts.append(messages[1].content)
        reply = next(self.replies)
        if isinstance(reply, Exception):
            raise reply
        return Reply(reply)


VALID_PLAN = {
    "title": "Add references to support answers",
    "input_summary": "A support question.",
    "output_summary": "An answer with references.",
    "plan": ["Retrieve knowledge", "Include references in the answer"],
}


def workflow(*inputs: dict[str, object]) -> Graph:
    return {
        "nodes": [
            *({"id": f"input-{index}", "data": data} for index, data in enumerate(inputs)),
            {"id": "a", "data": {"type": "template-transform", "title": "Normalize"}},
            {"id": "b", "data": {"type": "template-transform", "title": "Format"}},
            {
                "id": "end",
                "data": {"type": "end", "outputs": [{"variable": "answer", "value_selector": ["b", "output"]}]},
            },
            {"id": "answer", "data": {"type": "answer", "answer": "{{#b.output#}}"}},
        ],
        "edges": [
            *({"source": f"input-{index}", "target": "a"} for index in range(len(inputs))),
            {"source": "a", "target": "b"},
            {"source": "b", "target": "end"},
        ],
    }


@pytest.mark.parametrize("field", ["title", "input_summary", "output_summary"])
@pytest.mark.parametrize("invalid", [None, "", "   ", 7, "missing"])
def test_incomplete_edit_plan_never_discards_steps_into_an_approvable_placeholder(
    field: str, invalid: None | int | str
) -> None:
    response = {**VALID_PLAN, field: invalid}
    if invalid == "missing":
        del response[field]
    model = RecordingModel([json.dumps(response)] * 2)
    assert edit.propose_edit_plan(model, {"references": True}, workflow()) is None
    assert len(model.prompts) == 2
    assert model.prompts[0] in model.prompts[1]
    assert field in model.prompts[1]


@pytest.mark.parametrize("bad_plan", [[], "steps", [""], ["valid", 7]])
def test_invalid_steps_fail_after_one_correction(bad_plan: list[int | str] | list[object] | list[str] | str) -> None:
    model = RecordingModel([json.dumps({**VALID_PLAN, "plan": bad_plan})] * 2)
    assert edit.propose_edit_plan(model, {}, workflow()) is None
    assert len(model.prompts) == 2


@pytest.mark.parametrize("first", ["not JSON", json.dumps({**VALID_PLAN, "output_summary": ""})])
def test_one_correction_recovers_the_complete_plan_and_keeps_the_source(first: str) -> None:
    graph = workflow({"type": "start", "variables": [{"variable": "question", "type": "text-input"}]})
    model = RecordingModel([first, json.dumps(VALID_PLAN)])
    plan = edit.propose_edit_plan(model, {"references": True}, graph)
    assert plan is not None
    assert (plan.title, plan.input_summary, plan.output_summary, plan.items) == (
        VALID_PLAN["title"],
        VALID_PLAN["input_summary"],
        VALID_PLAN["output_summary"],
        VALID_PLAN["plan"],
    )
    assert len(model.prompts) == 2
    assert model.prompts[0] in model.prompts[1]


def test_first_success_uses_one_call_and_provider_failure_does_not_invent_a_plan() -> None:
    model = RecordingModel([json.dumps(VALID_PLAN)])
    assert edit.propose_edit_plan(model, {}, workflow()) is not None
    assert len(model.prompts) == 1
    broken = RecordingModel([RuntimeError("provider failed")])
    assert edit.propose_edit_plan(broken, {}, workflow()) is None
    assert len(broken.prompts) == 1
    assert edit.propose_edit_plan(None, {}, workflow()) is None


def test_invalid_json_and_schema_share_the_two_call_budget() -> None:
    model = RecordingModel(["not JSON", json.dumps({"plan": ["A step"]}), json.dumps(VALID_PLAN)])
    assert edit.propose_edit_plan(model, {}, workflow()) is None
    assert len(model.prompts) == 2


def test_webhook_fields_survive_graph_distance_and_keep_distinct_planning_sources() -> None:
    model = RecordingModel([json.dumps(VALID_PLAN)] * 2)
    for variable in ("order_id", "customer_email"):
        graph = workflow(
            {
                "type": TRIGGER_WEBHOOK_NODE_TYPE,
                "method": "post",
                "content_type": "application/json",
                "headers": [{"name": "X-Event", "type": "string", "required": True}],
                "params": [{"name": "tenant", "type": "string", "required": True}],
                "body": [{"name": variable, "type": "string", "required": True}],
            }
        )
        assert edit.propose_edit_plan(model, {"references": True}, graph) is not None
    first, second = model.prompts
    assert '"name": "order_id"' in first
    assert "customer_email" not in first
    assert '"name": "customer_email"' in second
    assert "order_id" not in second
    for prompt in model.prompts:
        for token in ("post", "application/json", "X-Event", "tenant", '"required": true'):
            assert token in prompt


def test_multiple_input_types_and_outputs_are_present_without_secrets_or_graph_mutation() -> None:
    graph = workflow(
        {"type": "start", "variables": [{"variable": "question", "label": "Question", "type": "text-input"}]},
        {
            "type": TRIGGER_SCHEDULE_NODE_TYPE,
            "mode": "cron",
            "cron_expression": "0 9 * * 1",
            "timezone": "Asia/Shanghai",
        },
        {
            "type": TRIGGER_SCHEDULE_NODE_TYPE,
            "mode": "visual",
            "frequency": "weekly",
            "visual_config": {"time": "2:30 PM", "weekdays": ["mon"]},
        },
        {
            "type": TRIGGER_PLUGIN_NODE_TYPE,
            "plugin_id": "calendar",
            "provider_id": "events",
            "event_name": "meeting_created",
            "event_parameters": {"calendar_id": {"type": "constant", "value": "PRIVATE-PARAMETER"}},
            "subscription_id": "PRIVATE-SUBSCRIPTION",
            "authorization": {"config": {"api_key": "PRIVATE-CREDENTIAL"}},
        },
    )
    before = deepcopy(graph)
    model = RecordingModel([json.dumps(VALID_PLAN)])
    assert edit.propose_edit_plan(model, {"references": True}, graph) is not None
    prompt = model.prompts[0]
    for token in (
        "question",
        "Question",
        "0 9 * * 1",
        "Asia/Shanghai",
        "weekly",
        "2:30 PM",
        "mon",
        "calendar",
        "events",
        "meeting_created",
        "calendar_id",
        '"value_selector": ["b", "output"]',
        "{{#b.output#}}",
    ):
        assert token in prompt
    assert "PRIVATE-" not in prompt
    assert graph == before


@pytest.mark.parametrize("value_type", ["file", "object"])
def test_end_output_types_reach_the_edit_planner(value_type: str) -> None:
    graph = workflow()
    end_node = next(node for node in graph["nodes"] if node["id"] == "end")
    outputs = [{"variable": "result", "value_type": value_type, "value_selector": ["b", "output"]}]
    end_node["data"]["outputs"] = outputs
    model = RecordingModel([json.dumps(VALID_PLAN)])

    assert edit.propose_edit_plan(model, {"references": True}, graph) is not None

    io_context = json.loads(model.prompts[0].split("WORKFLOW INPUTS AND OUTPUTS:\n", 1)[1])
    end_context = next(node for node in io_context if node["id"] == "end")
    assert end_context["outputs"] == outputs


def test_long_input_definitions_are_not_removed_by_the_generic_config_limit() -> None:
    variables = [{"variable": f"field_{index}", "type": "text-input", "label": f"Field {index}"} for index in range(50)]
    fields = [{"name": f"body_{index}", "type": "string", "required": True} for index in range(50)]
    model = RecordingModel([json.dumps(VALID_PLAN)])
    graph = workflow({"type": "start", "variables": variables}, {"type": TRIGGER_WEBHOOK_NODE_TYPE, "body": fields})
    assert edit.propose_edit_plan(model, {}, graph) is not None
    assert all(variable["variable"] in model.prompts[0] for variable in variables)
    assert all(field["name"] in model.prompts[0] for field in fields)


def test_edit_plan_uses_explicit_session_language_even_when_rules_are_english():
    model = RecordingModel([json.dumps(VALID_PLAN)])
    plan = edit.propose_edit_plan(model, {"model": "claude-fable-5-1"}, workflow(), reply_language="zh-Hans")
    assert plan is not None
    assert "zh-Hans" in model.prompts[0]
    assert "claude-fable-5-1" in model.prompts[0]
