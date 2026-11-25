from collections.abc import Callable, Sequence
from typing import Never

import pytest

from core.dify_builder.models import ConversationItem, Diagnosis, DifyBuilderContext, Graph, Inputs
from core.dify_builder.state import PcState
from services.dify_builder.agent import build as build_mod
from services.dify_builder.agent import chat as chat_mod
from services.dify_builder.agent import fix as fix_mod
from services.dify_builder.agent import resources
from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from services.dify_builder.agent.resources import TenantResources


def test_fix_methods_degrade_without_model() -> None:
    """Fix methods call fix.* which degrades gracefully when model_config is None."""
    agent = LlmBuilderAgent("t1", None, model_resolver_fn=lambda: None)
    diag = Diagnosis(culprit_node_id="llm", root_cause="x", severity="high")
    intents, risk = agent.propose_repair(diag, {})
    assert intents == []  # degraded response: no fix
    assert risk.level == "high"  # degraded response: high risk


def test_model_is_resolved_lazily_and_memoized() -> None:
    calls = {"n": 0}

    def fake_resolve(tenant_id: str, model_config: Inputs | None) -> str:  # noqa: ARG001
        calls["n"] += 1
        return "INSTANCE"

    agent = LlmBuilderAgent(
        "t1",
        {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
        model_resolver_fn=lambda: fake_resolve("t1", None),
    )
    assert calls["n"] == 0  # not resolved at construction
    assert agent._model() == "INSTANCE"
    assert agent._model() == "INSTANCE"
    assert calls["n"] == 1  # memoized


def test_model_or_none_swallows_resolution_error(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: Graph = {}
    monkeypatch.setattr(
        fix_mod,
        "propose_repair",
        lambda model, d, g, _reasoning=None, *, reply_language=None: seen.setdefault("m", model) or ([], None),  # noqa: ARG005
    )
    agent = LlmBuilderAgent("t1", None, model_resolver_fn=lambda: None)

    def boom() -> Never:
        raise RuntimeError("no default model")

    monkeypatch.setattr(agent, "_model", boom)
    agent.propose_repair("diag", {"nodes": []})
    assert seen["m"] is None  # a resolution error -> None passed to fix (degrade path)


def test_message_reply_delegates_stream_callback(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def mock_respond(
        model: object,
        model_config: Inputs | None,
        state: PcState,
        context: DifyBuilderContext,
        history: list[ConversationItem],
        graph: Graph,
        text: str,
        on_delta: Callable[[str], None],
        on_reasoning: Callable[[str], None] | None,
    ) -> str:
        seen["args"] = (model, model_config, state, context, history, graph, text)
        assert on_reasoning is None
        on_delta("first ")
        on_delta("second")
        return "first second"

    monkeypatch.setattr(chat_mod, "respond", mock_respond)
    model_config: Graph = {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}}
    agent = LlmBuilderAgent("t1", model_config)
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")
    deltas: list[str] = []

    reply = agent.respond_to_message(
        PcState.FIX_AWAIT_APPROVAL,
        DifyBuilderContext(),
        [ConversationItem(kind="user", payload={"text": "history"})],
        {"nodes": [], "edges": []},
        "question",
        deltas.append,
    )

    assert reply == "first second"
    assert deltas == ["first ", "second"]
    assert seen["args"] == (
        "MODEL",
        model_config,
        PcState.FIX_AWAIT_APPROVAL,
        DifyBuilderContext(),
        [ConversationItem(kind="user", payload={"text": "history"})],
        {"nodes": [], "edges": []},
        "question",
    )


# ---- ENG-1191: the acting account and the request reach tool readiness -------


def _capture_tool_owners(monkeypatch: pytest.MonkeyPatch) -> Graph:
    seen: Graph = {}

    def planning_catalogue(tenant_id: str, **kwargs: object) -> TenantResources:
        seen["planning_catalogue"] = (tenant_id, kwargs)
        return resources.TenantResources(models=[], datasets=[], tools=[])

    def discover_resources(
        model: object,  # noqa: ARG001
        tenant_id: str,
        plan_items: list[str],  # noqa: ARG001
        _reasoning: Callable[[str], None] | None = None,
        **kwargs: object,
    ) -> list[object]:
        seen["discover_resources"] = (tenant_id, kwargs)
        return []

    def bind_resources(
        _model: object,
        tenant_id: str,
        _plan_items: list[str],
        _resource_ids: Sequence[str],
        **kwargs: object,
    ) -> list[object]:
        seen["bind_resources"] = (tenant_id, kwargs)
        return []

    def build_nodes(
        tenant_id: str,
        model_config: Inputs | None,  # noqa: ARG001
        plan_items: list[str],  # noqa: ARG001
        resource_ids: Sequence[str] = (),  # noqa: ARG001
        **kwargs: object,
    ) -> list[object]:
        seen["build_nodes"] = (tenant_id, kwargs)
        return []

    monkeypatch.setattr(build_mod, "propose_plan_v1", lambda *_a, **_k: [])
    monkeypatch.setattr(build_mod, "planning_catalogue", planning_catalogue)
    monkeypatch.setattr(build_mod, "discover_resources", discover_resources)
    monkeypatch.setattr(build_mod, "bind_resources", bind_resources)
    monkeypatch.setattr(build_mod, "build_nodes", build_nodes)
    return seen


def test_every_tool_owner_receives_the_acting_account(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_tool_owners(monkeypatch)
    agent = LlmBuilderAgent("t1", {}, account_id="acct-a", app_mode="advanced-chat")
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    agent.propose_plan_v1({}, goal_text="goal")
    agent.discover_resources(["step"], goal_text="goal", requirements={}, reply_language="en")
    agent.bind_resources(["step"], ["rid"])
    agent.build_nodes(["step"], plan_approved=True)

    assert "planning_catalogue" not in seen
    for owner in ("discover_resources", "bind_resources", "build_nodes"):
        assert seen[owner][0] == "t1"
        assert seen[owner][1].get("account_id") == "acct-a", owner

    assert seen["build_nodes"][1].get("plan_approved") is True
    assert seen["discover_resources"][1].get("mode") == "advanced-chat"
    assert seen["discover_resources"][1].get("reply_language") == "en"


@pytest.mark.parametrize(
    ("schema", "state"),
    [
        ({"type": "object", "properties": {"records": {"type": "array"}}}, "declared"),
        ({}, "absent"),
        ({"description": "x" * 20000}, "oversized"),
    ],
)
def test_repair_public_output_declaration_uses_exact_existing_catalogue_read(
    monkeypatch: pytest.MonkeyPatch, schema: dict[str, object], state: str
) -> None:
    import json

    from tests.unit_tests.services.dify_builder.test_api_tool_output_context import CapturingModel
    from tests.unit_tests.services.dify_builder.test_tool_parameter_semantics import _ENTRY

    entry: resources.ToolCatalogueEntry = {**_ENTRY, "output_schema": schema}
    reads: list[str] = []

    def catalogue(tenant: str) -> list[resources.ToolCatalogueEntry]:
        reads.append(tenant)
        return [entry, {**entry, "provider_name": "unrelated/provider"}]

    monkeypatch.setattr(resources, "_list_tools", catalogue)
    graph: Graph = {
        "nodes": [
            {
                "id": "actual-tool",
                "data": {
                    "type": "tool",
                    "provider_id": entry["provider_name"],
                    "provider_type": entry["provider_type"],
                    "tool_name": entry["tool_name"],
                },
            }
        ],
        "edges": [],
    }
    capture = CapturingModel()
    agent = LlmBuilderAgent("tenant", model_resolver_fn=lambda: capture)
    agent.propose_repair(Diagnosis(culprit_node_id="actual-tool", root_cause="missing field"), graph)
    assert len(capture.prompts) == 1
    context = capture.prompts[0]
    marker = "# Upstream plugin output contracts and native Tool message channels\n\n"
    assert marker in context
    payload = json.loads(context.split(marker)[1].splitlines()[0])
    assert len(payload["tools"]) == 1
    assert payload["tools"][0]["node_id"] == "actual-tool"
    assert payload["tools"][0]["output_schema_state"] == state
    assert payload["tools"][0]["output_schema"] == (schema if state == "declared" else {})
    assert reads == ["tenant"]
    assert "unrelated/provider" not in context
