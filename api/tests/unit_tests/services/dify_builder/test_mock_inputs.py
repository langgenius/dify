import json
from datetime import datetime
from typing import Never

import pytest

from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState
from graphon.model_runtime.entities.message_entities import PromptMessage
from services.dify_builder.agent import mock_inputs


class _Msg:
    def __init__(self, t: str) -> None:
        self._t = t

    def get_text_content(self) -> str:
        return self._t


class _Result:
    def __init__(self, t: str) -> None:
        self.message = _Msg(t)


class _FakeInstance:
    def __init__(self, replies: list[str]) -> None:
        self._r = list(replies)
        self.prompts: list[list[PromptMessage]] = []

    def invoke_llm(self, *, prompt_messages: list[PromptMessage], **_kwargs: object) -> _Result:
        self.prompts.append(prompt_messages)
        return _Result(self._r.pop(0))


class _BoomInstance:
    def invoke_llm(self, **_kwargs: object) -> Never:
        raise RuntimeError("provider down")


_SCHEMA = {
    "variables": [
        {"variable": "query", "type": "text-input"},
        {"variable": "count", "type": "number"},
    ]
}


def test_generate_uses_llm_values_keyed_by_variable() -> None:
    m = _FakeInstance([json.dumps({"inputs": {"query": "hello", "count": 3}})])
    assert mock_inputs.generate(m, _SCHEMA, {}) == {"query": "hello", "count": 3}


def test_generate_degrades_to_typed_defaults_on_boom() -> None:
    out = mock_inputs.generate(_BoomInstance(), _SCHEMA, {})
    assert set(out.keys()) == {"query", "count"}
    assert isinstance(out["query"], str)
    assert isinstance(out["count"], int | float)


def test_generate_degrades_on_none_model() -> None:
    out = mock_inputs.generate(None, _SCHEMA, {})
    assert set(out.keys()) == {"query", "count"}


def test_generate_empty_schema_is_empty_inputs() -> None:
    assert mock_inputs.generate(None, {"variables": []}, {}) == {}


@pytest.mark.parametrize(
    ("flow", "step"),
    [
        ("build", "prefill"),
        ("build", "mock"),
        ("build", "defensive"),
        ("edit", "mock"),
        ("edit", "defensive"),
        ("fix", "mock"),
    ],
)
def test_all_mock_input_paths_ground_prompt_in_current_business_context(
    monkeypatch: pytest.MonkeyPatch, flow: str, step: str
) -> None:
    """Dropping context at any caller must fail before a plausible but wrong sample is offered."""
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, FixtureEnv, InMemoryRepository

    sample = '[{"status":"paid","amount":"12.30"},{"status":"cancelled","amount":"7.00"}]'
    model = _FakeInstance([json.dumps({"inputs": {"order_json": sample, "undeclared": "discard"}})])
    agent = LlmBuilderAgent("tenant-1")
    monkeypatch.setattr(agent, "model_or_none", lambda: model)
    dify = FakeBuildDifyPort()
    dify.graph = {
        "nodes": [
            {
                "id": "start",
                "data": {
                    "type": "start",
                    "variables": [
                        {
                            "variable": "order_json",
                            "type": "paragraph",
                            "label": "Daily orders",
                            "hint": "Paste the order array",
                            "required": True,
                            "rawCode": "private-start-metadata",
                        }
                    ],
                },
            }
        ],
        "edges": [],
        "rawCode": "private-graph-code",
        "environment_variables": ["private-env"],
    }
    repo = InMemoryRepository()
    env = FixtureEnv(dify=dify, agent=agent, repo=repo, now=lambda: datetime.min)
    fc = DifyBuilderContext(
        goal_text="Summarize paid and cancelled orders using Decimal amounts",
        requirements={"order_json_sample": sample},
        plan_title="Daily order report",
        plan_input_summary="Receive a JSON array of orders",
        plan_output_summary="Return paid count and exact total",
        plan_items=["Reject non-array JSON; sum paid amount and count cancelled orders"],
        model_config={"credentials": "private-provider-credential"},
        resource_selection={"secret": "private-resource"},
    )
    actor = Actor(account_id="account-1", tenant_id="tenant-1")
    s = Session(
        app_id="app",
        tenant_id="tenant-1",
        owner_account_id="account-1",
        entry_mode=EntryMode(flow),
        current_state=PcState.BUILD_EXECUTION,
    )
    handler = {
        ("build", "prefill"): handlers_build.handle_execution,
        ("build", "mock"): handlers_build.handle_await_testdata,
        ("build", "defensive"): handlers_build.handle_test_and_repair,
        ("edit", "mock"): handlers_edit.handle_await_testdata,
        ("edit", "defensive"): handlers_edit.handle_test_affected_paths,
        ("fix", "mock"): handlers_fix.handle_await_testdata,
    }[flow, step]
    s.current_state = {
        ("build", "prefill"): PcState.BUILD_EXECUTION,
        ("build", "mock"): PcState.BUILD_AWAIT_TESTDATA,
        ("build", "defensive"): PcState.BUILD_TEST_AND_REPAIR,
        ("edit", "mock"): PcState.EDIT_AWAIT_TESTDATA,
        ("edit", "defensive"): PcState.EDIT_TEST_AFFECTED_PATHS,
        ("fix", "mock"): PcState.FIX_AWAIT_TESTDATA,
    }[flow, step]
    action = Action(kind="run_test" if step == "prefill" else "provide_testdata", payload={"mode": "mock"})
    result = handler(env, Turn(actor=actor, action=action), s, fc)

    prompt = str(model.prompts[0][1].content)
    assert fc.goal_text in prompt
    assert (
        sample == json.loads(prompt.split("BUSINESS CONTEXT:\n", 1)[1])["confirmed_requirements"]["order_json_sample"]
    )
    for text in (
        fc.plan_title,
        fc.plan_input_summary,
        fc.plan_output_summary,
        fc.plan_items[0],
        "Daily orders",
        "Paste the order array",
    ):
        assert text in prompt
    assert "private-" not in prompt
    if step == "prefill":
        values = next(item.payload["values"] for item in result.items if item.kind == "form")
    else:
        values = repo.get_test_input(fc.test_input_ref).inputs
    assert values == {"order_json": sample}
    assert json.loads(values["order_json"]) == [
        {"status": "paid", "amount": "12.30"},
        {"status": "cancelled", "amount": "7.00"},
    ]


@pytest.mark.parametrize("reply", [None, "{}", '{"inputs": []}', '{"inputs": {"extra": "discard"}}', "unparseable"])
def test_business_context_preserves_existing_type_fallbacks(reply: str | None) -> None:
    schema = {
        "variables": [
            {"variable": "count", "type": "number"},
            {"variable": "approved", "type": "checkbox"},
            {"variable": "category", "type": "select", "options": ["paid", "cancelled"]},
            {"variable": "note", "type": "paragraph"},
        ]
    }
    model = _FakeInstance([reply, reply]) if reply is not None else None
    assert mock_inputs.generate(model, schema, {}, business_context="Daily orders") == {
        "count": 1,
        "approved": True,
        "category": "paid",
        "note": "test",
    }
