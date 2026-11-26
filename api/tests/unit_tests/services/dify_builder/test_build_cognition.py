import json
from collections.abc import Callable, Sequence
from typing import Never

import pytest
import sqlalchemy.orm
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session as OrmSession

from core.app.app_config.entities import ModelConfig
from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import BuildNodesResult, Graph, Inputs
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.model_runtime.entities.message_entities import PromptMessage
from services.dify_builder.agent import build, resources
from services.dify_builder.plan import WorkflowPlan
from tests.helpers.unit.config_override import apply_config_overrides
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    ACCOUNT_A,
    ACCOUNT_B,
    TENANT_ID,
    FakeTool,
    FakeToolDaemon,
    add_credential,
    bind_database,
    filler_providers,
    forbid_secret_and_business_calls,
    install_fake_daemon,
    provider_payload,
)
from tests.unit_tests.services.dify_builder.model_responses import text_result
from tests.unit_tests.services.dify_builder.test_dify_port import PortDatabase


class _FakeInstance:
    def __init__(self, replies: Sequence[str | Exception]) -> None:
        self._r = list(replies)
        self.calls = []

    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        **_kw: object,
    ) -> LLMResult:
        self.calls.append((prompt_messages, model_parameters, stop, stream))
        reply = self._r.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return text_result(reply)


class _BoomInstance:
    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],  # noqa: ARG002
        model_parameters: dict[str, object] | None = None,  # noqa: ARG002
        stop: list[str] | None = None,  # noqa: ARG002
        stream: bool = True,  # noqa: ARG002
        **_kw: object,
    ) -> Never:
        raise RuntimeError("provider down")


def _plan_reply(items: list[str]) -> str:
    return json.dumps(
        {
            "title": "Build a document summary workflow",
            "input_summary": "Source documents to summarize.",
            "output_summary": "A summary report.",
            "plan": items,
        }
    )


_ALERT_GOAL = (
    "Create an alert grading Workflow using numeric error_rate_pct, p95_ms, requests. "
    "Invalid negatives or rate>100 ->invalid_input; requests=0 ->no_data; "
    "rate>=5 or latency>=2000 ->critical; rate>=1 or latency>=800 ->warning; otherwise healthy. "
    "Deterministic logic, no runtime LLM/external calls."
)


def test_analyze_goal_empty_clarification_preserves_fixed_values_for_planning() -> None:
    fixed_values = {
        "grading_rules": "rate>=5 or latency>=2000 ->critical; rate>=1 or latency>=800 ->warning",
        "runtime_constraints": "Deterministic logic, no runtime LLM/external calls.",
    }
    model = _FakeInstance(
        [json.dumps({"fields": [], "values": fixed_values}), _plan_reply(["code node grades the alert"])]
    )

    analysis = build.analyze_goal(model, _ALERT_GOAL)
    plan = build.propose_plan_v1(model, analysis["values"], goal_text=_ALERT_GOAL)

    assert analysis["fields"] == []
    assert analysis["values"] == fixed_values
    assert plan is not None
    planner_source = model.calls[1][0][1].content
    assert _ALERT_GOAL in planner_source
    assert json.dumps(fixed_values, ensure_ascii=False) in planner_source
    assert len(model.calls) == 2


def test_analyze_goal_keeps_a_necessary_unanswered_business_question() -> None:
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "alert_recipient", "label": "Who should receive alerts?", "type": "text"}],
                    "values": {"alert_recipient": ""},
                }
            )
        ]
    )

    analysis = build.analyze_goal(model, "Grade service alerts and notify the responsible team.")

    assert len(analysis["fields"]) == 1
    assert analysis["fields"][0]["key"] == "alert_recipient"
    assert analysis["values"]["alert_recipient"] == ""
    assert "hint_copy" in analysis["fields"][0]


def test_analyze_goal_reconciles_field_type_with_value() -> None:
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "max_results", "label": "Max results", "type": "text"}],
                    "values": {"max_results": 5},
                }
            )
        ]
    )

    out = build.analyze_goal(m, "limit search results")

    assert out["fields"][0]["type"] == "number"
    assert out["values"]["max_results"] == 5


def test_analyze_goal_degrades_to_generic_field_on_boom() -> None:
    m = _BoomInstance()
    out = build.analyze_goal(m, "some goal")
    assert out["fields"]
    assert out["fields"][0]["type"] == "textarea"
    assert out["values"].get(out["fields"][0]["key"]) == "some goal"


# The real S5b goal (ESQ1-302 / F2): no URL, no credential anywhere in it.
_S5B_GOAL = (
    "Generate a PowerPoint presentation from a topic the user provides: an LLM writes the "
    "slide content, then the workflow POSTs the slides as JSON to our company's PPT rendering "
    "HTTP API, which returns the .pptx download link."
)


def test_scrub_invented_defaults_blanks_the_real_s5b_invented_endpoint_and_credential() -> None:
    values = {
        "tone": "Professional",
        "slide_count": 10,
        "render_api_url": "https://api.yourcompany.com/v1/ppt/render",
        "api_auth_header": {
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_API_KEY",
        },
        "include_speaker_notes": True,
    }

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out["render_api_url"] == ""
    assert out["api_auth_header"] == ""
    assert out["tone"] == "Professional"
    assert out["slide_count"] == 10
    assert out["include_speaker_notes"] is True


def test_scrub_invented_defaults_blanks_a_credential_the_goal_does_not_state() -> None:
    values = {"api_key": "sk-live-abc123"}

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out["api_key"] == ""


def test_scrub_invented_defaults_keeps_lookalike_keys_that_are_not_credentials() -> None:
    # ESQ1-302 fix round 1: an unanchored credential-key regex blanked these
    # (token_limit contains "token", password_policy contains "password",
    # session_token_expiry contains "token") even though none of them holds
    # a secret. Credential-ness is decided by the key's LAST segment.
    values = {
        "password_policy": "strong",
        "token_limit": "unlimited",
        "session_token_expiry": "30 minutes",
    }

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out == values


def test_scrub_invented_defaults_blanks_a_bearer_placeholder_under_a_non_credential_key() -> None:
    values = {"x": "Bearer YOUR_API_KEY"}

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out["x"] == ""


def test_scrub_invented_defaults_blanks_a_placeholder_under_a_credential_key() -> None:
    values = {"api_key": "<your key>"}

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out["api_key"] == ""


def test_analyze_goal_scrubs_invented_defaults_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}
    raw = {
        "fields": [
            {"key": "tone", "label": "Tone", "type": "text"},
            {"key": "slide_count", "label": "Slide count", "type": "number"},
            {"key": "render_api_url", "label": "Render API URL", "type": "text"},
            {"key": "api_auth_header", "label": "Auth header", "type": "json_object"},
            {"key": "include_speaker_notes", "label": "Include speaker notes", "type": "bool"},
        ],
        "values": {
            "tone": "Professional",
            "slide_count": 10,
            "render_api_url": "https://api.yourcompany.com/v1/ppt/render",
            "api_auth_header": {
                "Content-Type": "application/json",
                "Authorization": "Bearer YOUR_API_KEY",
            },
            "include_speaker_notes": True,
        },
    }

    def fake_invoke_json(
        _model: object,
        *,
        system: str,
        user: str,  # noqa: ARG001
        on_reasoning: Callable[[str], None] | None = None,  # noqa: ARG001
    ) -> dict[str, list[dict[str, str]] | dict[str, bool | int | str | dict[str, str]]]:
        captured["system"] = system
        return raw

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)

    out = build.analyze_goal(object(), _S5B_GOAL)

    assert out["values"]["render_api_url"] == ""
    assert "api_auth_header" not in out["values"]
    assert all(field["key"] != "api_auth_header" for field in out["fields"])
    assert out["values"]["tone"] == "Professional"
    assert out["values"]["slide_count"] == 10
    assert out["values"]["include_speaker_notes"] is True
    assert (
        "Never invent a URL/endpoint, API key, token, password, or account/resource id the goal does not state"
        in captured["system"]
    )


@pytest.mark.parametrize(
    "reply",
    [
        "not JSON",
        "[]",
        "{}",
        '{"plan": []}',
        '{"plan": "step"}',
        '{"plan": {"step": "work"}}',
        '{"plan": ["valid", null]}',
        '{"plan": ["valid", ""]}',
        '{"plan": ["valid", "  "]}',
        '{"plan": ["valid", 7]}',
        '{"plan": ["valid", true]}',
        '{"plan": ["valid", ["nested"]]}',
        '{"plan": ["valid", {"step": "nested"}]}',
    ],
)
def test_propose_plan_v1_rejects_the_entire_invalid_plan_with_one_correction(reply: str) -> None:
    model = _FakeInstance([reply, reply])

    assert build.propose_plan_v1(model, {"count": 2}) is None
    assert len(model.calls) == 2


def test_propose_plan_v1_corrects_schema_once_with_full_source_and_same_provider_parameters() -> None:
    goal = "Produce a 文件 " + ("original source " * 300) + "UNTRUNCATED_END"
    requirements = {"title": "报告", "render_api_url": "", "count": 2}
    model = _FakeInstance(['{"plan": ["valid", 7]}', _plan_reply(["start node reads input", "end node returns link"])])
    reasoning = []

    out = build.propose_plan_v1(model, requirements, reasoning.append, goal_text=goal)

    assert isinstance(out, WorkflowPlan)
    assert out.items == ["start node reads input", "end node returns link"]
    assert len(model.calls) == 2
    source = f"ORIGINAL GOAL:\n{goal}\n\nCONFIRMED REQUIREMENTS:\n" + json.dumps(requirements, ensure_ascii=False)
    assert model.calls[0][0][1].get_text_content() == source
    assert model.calls[1][0][1].get_text_content().startswith(source + "\n\n")
    assert model.calls[0][0][0].get_text_content() == model.calls[1][0][0].get_text_content()
    assert model.calls[0][1:] == model.calls[1][1:]


def test_propose_plan_v1_does_not_retry_a_provider_failure() -> None:
    class FailingProvider:
        calls = 0

        def invoke_llm(self, **kwargs: object) -> Never:  # noqa: ARG002
            self.calls += 1
            raise RuntimeError("provider unavailable")

    model = FailingProvider()

    assert build.propose_plan_v1(model, {}) is None
    assert model.calls == 1


def test_discover_resources_retains_full_source_in_model_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    goal = "Use only the company knowledge base; optionally consider exports. " * 200
    requirements = {"answer_language": "中文", "approved_dataset": "kb-1"}
    _stub_inventory(monkeypatch, tools=[resources.ResourceRef(id="tool/run", label="Export")])
    model = _FakeInstance(['{"resource_ids": ["tool/run"]}'])

    options = build.discover_resources(model, "t1", ["retrieve knowledge"], goal_text=goal, requirements=requirements)

    assert [option.id for option in options] == ["tool/run"]
    payload = model.calls[0][0][1].get_text_content()
    source = f"ORIGINAL GOAL:\n{goal}\n\nCONFIRMED REQUIREMENTS:\n" + json.dumps(requirements, ensure_ascii=False)
    assert payload.startswith(source + "\n\nPLAN:\nretrieve knowledge\n\nAVAILABLE:\n")
    assert payload.endswith(
        "- tool/run (plugin, ready): Export\n  Action parameter declarations: unknown\n  Action output schema: unknown"
    )


def test_assess_capability_gap_retains_source_and_distinguishes_same_label_resource_ids() -> None:
    from core.dify_builder.contract import ResourceOption

    goal = "A company endpoint returns the requested 文件 link. " * 200
    requirements = {"render_api_url": "", "artifact": "pptx"}
    options = [
        ResourceOption(id="provider/send", label="Send", meta="", kind="plugin", readiness="ready"),
        ResourceOption(id="other/send", label="Send", meta="", kind="plugin", readiness="missing_config"),
    ]
    model = _FakeInstance(['{"gap": ""}'])

    assert (
        build.assess_capability_gap(
            model, ["http-request node sends slides"], options, goal_text=goal, requirements=requirements
        )
        == ""
    )
    payload = model.calls[0][0][1].get_text_content()
    source = f"ORIGINAL GOAL:\n{goal}\n\nCONFIRMED REQUIREMENTS:\n" + json.dumps(requirements, ensure_ascii=False)
    assert payload == (
        source + "\n\nPLAN:\nhttp-request node sends slides\n\nAVAILABLE:\n"
        "- provider/send (plugin, ready): Send\n- other/send (plugin, missing_config): Send"
    )


def test_discover_resources_refuses_dataset_recommendations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[], datasets=[resources.ResourceRef(id="kb-1", label="Company KB")], tools=[]
        ),
    )
    m = _FakeInstance([json.dumps({"resource_ids": ["kb-1"]})])
    opts = build.discover_resources(m, "t1", ["Retrieve knowledge"])
    assert opts == []


def _stub_inventory(
    monkeypatch: pytest.MonkeyPatch,
    *,
    datasets: Sequence[resources.ResourceRef] = (),
    models: Sequence[resources.ResourceRef] = (),
    tools: Sequence[resources.ResourceRef] = (),
) -> None:
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda _t, **_kw: resources.TenantResources(models=list(models), datasets=list(datasets), tools=list(tools)),
    )


def test_discover_resources_never_falls_back_to_the_whole_inventory(monkeypatch: pytest.MonkeyPatch) -> None:
    # The regression that made this visible: a large workspace whose model picks
    # nothing. The old single-resource test could not tell "all" from "none".
    _stub_inventory(
        monkeypatch,
        datasets=[resources.ResourceRef(id=f"kb-{i}", label=f"KB {i}") for i in range(20)],
        models=[resources.ResourceRef(id=f"prov/model-{i}", label=f"Model {i}") for i in range(30)],
        tools=[resources.ResourceRef(id=f"tool-{i}/run", label=f"Tool {i}") for i in range(7)],
    )
    picked_none = _FakeInstance([json.dumps({"resource_ids": []})])

    assert build.discover_resources(picked_none, "t1", ["Send a notification"]) == []


def test_discover_resources_keeps_only_ids_the_model_actually_picked(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_inventory(
        monkeypatch,
        tools=[resources.ResourceRef(id=f"tool-{i}/run", label=f"Tool {i}") for i in range(20)],
    )
    m = _FakeInstance([json.dumps({"resource_ids": ["tool-3/run", "not-in-catalog"]})])

    opts = build.discover_resources(m, "t1", ["Retrieve knowledge"])

    assert [o.id for o in opts] == ["tool-3/run"]


def test_assess_capability_gap_reports_no_gap_when_the_plan_is_covered() -> None:
    m = _FakeInstance([json.dumps({"gap": ""})])
    assert build.assess_capability_gap(m, ["Summarize text"], []) == ""


def test_assess_capability_gap_reports_unknown_on_unparseable_reply() -> None:
    m = _FakeInstance([json.dumps({"gap": 42})])
    assert build.assess_capability_gap(m, ["Email the manager"], []) is None


def test_bind_resources_refuses_dataset_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[], datasets=[resources.ResourceRef(id="kb-1", label="Company KB")], tools=[]
        ),
    )
    out = build.bind_resources(None, "t1", ["Retrieve knowledge"], ["kb-1"])
    assert out == ["Retrieve knowledge"]


def test_bind_resources_binds_each_resource_to_the_step_it_covers(monkeypatch: pytest.MonkeyPatch) -> None:
    """bind_resources appended "(using ...)" to the LAST plan item -- in the
    ESQ1-302 session that was the end node step. Each resource now lands on
    the step it covers; the last step is only the fallback. A model's label is
    its full ``provider/model`` id (``resources.list_tenant_resources``)."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[
                resources.ResourceRef(
                    id="langgenius/tokener/tokener/deepseek-v4-flash",
                    label="langgenius/tokener/tokener/deepseek-v4-flash",
                )
            ],
            datasets=[resources.ResourceRef(id="kb-1", label="Company KB")],
            tools=[
                resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")
            ],
        ),
    )
    plan = [
        "start节点：定义输入变量",
        "llm节点：根据主题生成大纲",
        "knowledge-retrieval node: fetch the style guide",
        "tool节点：把 Markdown 转成 PPTX 文件",
        "end节点：返回生成的PPT文件",
    ]

    out = build.bind_resources(
        None,
        "t1",
        plan,
        ["langgenius/tokener/tokener/deepseek-v4-flash", "kb-1", "bowenliang123/md_exporter/md_exporter/md_to_pptx"],
    )

    assert out[0] == plan[0]
    assert out[1] == plan[1] + " (using langgenius/tokener/tokener/deepseek-v4-flash)"
    assert out[2] == plan[2]
    assert out[3] == plan[3] + " (using Markdown ⮕ PPTX [bowenliang123/md_exporter/md_exporter/md_to_pptx])"
    assert out[4] == plan[4]


def test_bind_resources_rebind_with_the_same_selection_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """A loop-back re-bind must strip the previous suffix, bracketed tool id
    and all (``_TRAILING_USING_SUFFIX`` excludes only parentheses, so the
    ``[provider/tool]`` part is stripped with it) -- not pile a second one on."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[
                resources.ResourceRef(
                    id="langgenius/tokener/tokener/deepseek-v4-flash",
                    label="langgenius/tokener/tokener/deepseek-v4-flash",
                )
            ],
            datasets=[],
            tools=[
                resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")
            ],
        ),
    )
    plan = ["llm节点：根据主题生成大纲", "tool节点：把 Markdown 转成 PPTX 文件"]
    selection = ["langgenius/tokener/tokener/deepseek-v4-flash", "bowenliang123/md_exporter/md_exporter/md_to_pptx"]

    first = build.bind_resources(None, "t1", plan, selection)
    second = build.bind_resources(None, "t1", first, selection)

    assert first[1] == plan[1] + " (using Markdown ⮕ PPTX [bowenliang123/md_exporter/md_exporter/md_to_pptx])"
    assert second == first
    assert second[1].count("(using") == 1
    assert second[1].count("[bowenliang123/md_exporter/md_exporter/md_to_pptx]") == 1


def test_bind_resources_rebind_with_a_changed_selection_drops_the_deselected_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A loop-back (build.review / build.reverted -> re-walk resources ->
    approve_plan) feeds the already-bound plan back into bind_resources. The
    old, purely-additive binder kept a deselected resource's suffix and piled
    the new one on top of it -- that accumulated text is what the generator
    is handed."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[resources.ResourceRef(id="model-a", label="Model A")],
            datasets=[],
            tools=[
                resources.ResourceRef(id="tool-b", label="Code Interpreter"),
                resources.ResourceRef(id="tool-c", label="Markdown Exporter"),
            ],
        ),
    )
    plan = ["llm node: draft", "tool node: run something"]

    first = build.bind_resources(None, "t1", plan, ["model-a", "tool-b"])
    second = build.bind_resources(None, "t1", first, ["model-a", "tool-c"])

    assert second[1] == "tool node: run something (using Markdown Exporter [tool-c])"
    assert "Code Interpreter" not in second[1]
    assert second[1].count("(using") == 1


# ---- ESQ1-302: tool grounding ------------------------------------------------


def test_planner_catalogue_includes_setup_tools_and_remains_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    tools = [resources.ResourceRef(id=f"p/t{i}", label=f"Tool {i}") for i in range(60)]
    tools.append(resources.ResourceRef(id="p/nope", label="Nope", readiness="missing_config"))
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(models=[], datasets=[], tools=tools),  # noqa: ARG005
    )

    out = build.ready_tool_catalogue("t1")

    assert len(out) == build._MAX_PLANNER_TOOLS
    assert any(t.id == "p/nope" and t.readiness == "missing_config" for t in out)


def test_ready_tool_catalogue_degrades_to_empty_when_the_listing_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_tenant_id: str, **_kwargs: object) -> Never:
        raise RuntimeError("plugin daemon down")

    monkeypatch.setattr(build.resources, "list_tenant_resources", boom)

    assert build.ready_tool_catalogue("t1") == []


@pytest.mark.parametrize("with_actor", [True, False])
def test_initial_plan_defers_actor_eligible_published_agent_metadata_to_discovery(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch, with_actor: bool
) -> None:
    from services.dify_builder import agent_access as access_service
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from tests.builder_agent_fixtures import add_agent, make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    foreign_case = make_case(sqlite_session)
    case.snapshot.summary = "Review report evidence"
    unpublished, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Unpublished", published=False)
    hidden, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Hidden")
    sqlite_session.commit()
    monkeypatch.setattr(
        access_service,
        "resolve_current_agent_access_filter",
        lambda **_kwargs: access_service.AgentAccessFilter(
            accessible_agent_ids={case.agent.id, unpublished.id, foreign_case.agent.id}
        ),
    )
    monkeypatch.setattr(resources, "db", PortDatabase(sqlite_session.get_bind()))
    inventory_reads: list[str] = []
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: inventory_reads.append("models") or [])
    monkeypatch.setattr(
        resources, "_list_datasets", lambda _tenant_id, _account_id=None: inventory_reads.append("datasets") or []
    )
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant_id: inventory_reads.append("tools") or [])
    steps = ["start node receives report", "New Agent v2 node reviews the report", "end node returns summary"]
    model = _FakeInstance([_plan_reply(steps), json.dumps({"resource_ids": [f"agent:{case.agent.id}"]})])
    agent = LlmBuilderAgent(
        case.actor.tenant_id,
        {},
        account_id=case.actor.account_id if with_actor else None,
        model_resolver_fn=lambda: model,
    )
    requirements = {"result": "summary"}
    goal = "Use a Workspace Agent to review a report"

    result = agent.propose_plan_v1(requirements, goal_text=goal)

    assert result is not None
    assert result.items == steps
    assert inventory_reads == []
    system = model.calls[0][0][0].get_text_content()
    assert "New Agent v2" in system
    assert "version=2" in system
    assert "agent_node_kind=dify_agent" in system
    assert "legacy" in system.lower()
    for candidate in (case.agent, unpublished, hidden, foreign_case.agent):
        assert candidate.id not in system
    assert "# Published Workspace Agents" not in system
    assert "Review report evidence" not in system
    assert "published_soul.app_variables" not in system
    assert "tool:plugin/provider/read" not in system
    assert "HIDDEN" not in system

    options = agent.discover_resources(result.items, goal_text=goal, requirements=requirements)

    assert inventory_reads == ["models", "datasets", "tools"]
    if with_actor:
        assert len(options) == 1
        assert options[0].id.startswith(f"agent:{case.agent.id}:{case.snapshot.id}:")
        assert options[0].kind == "agent"
        user = model.calls[1][0][1].get_text_content()
        assert goal in user
        assert '"result": "summary"' in user
        assert "Review report evidence" in user
        assert '"report": {"required": true, "type": "string"}' in user
        assert "published_soul.app_variables" in user
        assert "node_job_required" in user
        assert "tool:plugin/provider/read" in user
        for candidate in (unpublished, hidden, foreign_case.agent):
            assert candidate.id not in user
        assert "HIDDEN" not in user
    else:
        assert options == []
        assert len(model.calls) == 1


@pytest.mark.parametrize("source_error", [None, "Published Agent catalog unavailable"])
def test_initial_plan_defers_agent_catalogue_failure_and_discovery_distinguishes_empty(
    monkeypatch: pytest.MonkeyPatch, source_error: str | None
) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    inventory_reads: list[str] = []
    monkeypatch.setattr(
        resources,
        "list_tenant_resources",
        lambda tenant_id, **_kwargs: (
            inventory_reads.append(tenant_id)
            or resources.TenantResources(
                models=[],
                datasets=[],
                tools=[resources.ResourceRef(id="plugin/read", label="Read report")],
                agent_source_error=source_error,
            )
        ),
    )
    model = _FakeInstance(
        [
            _plan_reply(["start node receives report", "end node returns report"]),
            json.dumps({"resource_ids": []}),
        ]
    )
    agent = LlmBuilderAgent("tenant-1", {}, account_id="actor-1", model_resolver_fn=lambda: model)

    plan = agent.propose_plan_v1({}, goal_text="Review a report")

    assert plan is not None
    assert inventory_reads == []
    system = model.calls[0][0][0].get_text_content()
    assert "Agent catalog is unavailable" not in system
    assert "plugin/read" not in system

    assert agent.discover_resources(plan.items, goal_text="Review a report", requirements={}) == []

    assert inventory_reads == ["tenant-1"]
    discovery_system = model.calls[1][0][0].get_text_content()
    if source_error:
        assert "Agent catalog is unavailable" in discovery_system
        assert "do not infer that the workspace has no Agents" in discovery_system
    else:
        assert "Agent catalog is unavailable" not in discovery_system


# ---- Final review F2: a host the goal names without a scheme is not invented --


def test_scrub_invented_defaults_keeps_a_url_whose_host_the_goal_names_without_a_scheme() -> None:
    goal = "Our renderer is at api.pptrender.io/v1/render -- send it the slides."
    values = {"render_api_url": "https://api.pptrender.io/v1/render"}

    out = build._scrub_invented_defaults(values, goal)

    assert out["render_api_url"] == "https://api.pptrender.io/v1/render"


def test_scrub_invented_defaults_still_blanks_a_single_label_host_named_as_a_stray_word() -> None:
    values = {"render_api_url": "http://renderer:8080/v1"}

    out = build._scrub_invented_defaults(values, "send the slides to the renderer")

    assert out["render_api_url"] == ""


# ---- The requirements form never asks the user to restate the goal ----------
#
# PM report 2026-09-29: the requirements card asked the user to fill in
# 需求描述 -- the requirement they had already typed as their opening message --
# and shipped it BLANK, so there was nothing to write. ``_degraded_form`` has
# always answered that question with ``goal_text``; the LLM path lost that.

_PM_GOAL = "构建一个需求调用工作流, 用户输入需求, 最终输出一个pdf格式的需求调用报告"


def test_analyze_goal_never_asks_for_a_credential_in_a_text_field() -> None:
    """Secrets belong to the existing resource setup, not a Builder form."""
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "bocha_api_key", "label": "博查 API 密钥", "type": "text"}],
                    "values": {"bocha_api_key": "YOUR_API_KEY"},
                }
            )
        ]
    )

    out = build.analyze_goal(m, _PM_GOAL)

    assert not out["fields"]
    assert "bocha_api_key" not in out["values"]


def test_analyze_goal_keeps_business_fields_but_removes_secret_requests() -> None:
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [
                        {"key": "search_api_key", "label": "搜索服务的 API Key", "type": "text"},
                        {"key": "search_code", "label": "访问令牌", "type": "text"},
                        {"key": "report_language", "label": "报告语言", "type": "select", "options": ["中文", "英文"]},
                        {"key": "max_tokens", "label": "输出长度", "type": "number"},
                        {"key": "credential_name", "label": "凭据名称", "type": "text"},
                    ],
                    "values": {
                        "search_api_key": "synthetic-secret",
                        "search_code": "synthetic-token",
                        "report_language": "中文",
                        "max_tokens": 1000,
                        "credential_name": "team credential",
                        "access_token": "another-secret",
                    },
                },
                ensure_ascii=False,
            )
        ]
    )

    out = build.analyze_goal(m, "联网调研并输出中文报告")

    assert {field["key"] for field in out["fields"]} == {"report_language", "max_tokens", "credential_name"}
    assert out["values"] == {"report_language": "中文", "max_tokens": 1000, "credential_name": "team credential"}


def test_analyze_goal_removes_nested_secret_values_without_losing_business_booleans() -> None:
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [
                        {"key": "requires_password", "label": "是否要求密码", "type": "bool"},
                        {"key": "search_code", "label": "访问令牌", "type": "text"},
                    ],
                    "values": {
                        "requires_password": False,
                        "search_code": "synthetic-secret",
                        "metadata": {"access_token": 9876, "token_limit": 42, "search_code": "business category"},
                    },
                },
                ensure_ascii=False,
            )
        ]
    )

    out = build.analyze_goal(m, "生成报告")

    assert [field["key"] for field in out["fields"]] == ["requires_password"]
    assert out["values"] == {
        "requires_password": False,
        "metadata": {"token_limit": 42, "search_code": "business category"},
    }


def test_analyze_goal_rejects_secret_text_mislabeled_as_boolean() -> None:
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "provider_input", "label": "API Key", "type": "bool"}],
                    "values": {"provider_input": "synthetic-credential-value"},
                }
            )
        ]
    )

    out = build.analyze_goal(m, "联网调研")

    assert not out["fields"]
    assert "provider_input" not in out["values"]


def test_grounding_preserves_retrieval_config_without_dataset_assignment(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.app.app_config.entities import ModelConfig
    from core.dify_builder.models import MutationIntent

    _stub_inventory(monkeypatch, datasets=[resources.ResourceRef(id="kb-real", label="Company KB")])
    intent = MutationIntent(
        op="create_node",
        args={
            "node_type": "knowledge-retrieval",
            "node_id": "r",
            "config": {"dataset_ids": ["original"], "retrieval_mode": "multiple"},
        },
    )
    mc = ModelConfig.model_validate({"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}})

    build._ground([intent], mc)

    assert intent.args["config"]["dataset_ids"] == ["original"]


# ---- ENG-1191: installed tool discovery vs executable planning ---------------
#
# Real inventory owners (PluginToolManager -> ToolManager -> tool catalogue ->
# resources) over a faked plugin daemon and real SQLite credential rows. The
# LLM is the other faked boundary.


_HUDDLE_POST = "acme/huddle/huddle/post"
_FREE_ECHO = "acme/free/free/echo"
_PAGER_OPEN = "zeta/pager/pager/open_incident"
_PAGER_PLUS = "zeta/pagerplus/pagerplus/page_oncall"
_ONLYME_RUN = "acme/onlyme/onlyme/run"
_FILLER_COUNT = 120


@pytest.fixture
def installed_tools(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> tuple[FakeToolDaemon, list[str]]:
    bind_database(monkeypatch, sqlite_engine)
    daemon = install_fake_daemon(
        monkeypatch,
        FakeToolDaemon(
            providers_by_tenant={
                TENANT_ID: [
                    *filler_providers(_FILLER_COUNT),
                    provider_payload(
                        "acme/huddle",
                        "huddle",
                        [FakeTool(name="post", label="Post", description="Send text to a channel.")],
                        needs_credentials=True,
                        label="Huddle",
                        description="Notify teammates in shared chat channels.",
                        tags=["social"],
                    ),
                    provider_payload(
                        "acme/free", "free", [FakeTool(name="echo", label="Echo", description="Echo the input.")]
                    ),
                    provider_payload(
                        "acme/onlyme",
                        "onlyme",
                        [FakeTool(name="run", label="Run", description="Private teammate tool.")],
                        needs_credentials=True,
                    ),
                    provider_payload(
                        "zeta/pager",
                        "pager",
                        [
                            FakeTool(
                                name="open_incident",
                                label="Open incident",
                                description="Page the on-call responders about an incident.",
                            )
                        ],
                    ),
                    provider_payload(
                        "zeta/pagerplus",
                        "pagerplus",
                        [
                            FakeTool(
                                name="page_oncall",
                                label="Page on-call",
                                description="Page the on-call responders about an incident.",
                            )
                        ],
                        needs_credentials=True,
                    ),
                ]
            }
        ),
    )
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id, _account_id=None: [])
    return daemon, forbid_secret_and_business_calls(monkeypatch)


def test_discovery_recommends_an_unauthenticated_installed_tool_as_requiring_setup(
    installed_tools: tuple[FakeToolDaemon, list[str]],
) -> None:
    """The full path: an installed tool with no credential, matched by its
    description/provider capability (not its bare label "Post"), reaches the
    recommender beyond the old name-sorted window and comes back
    missing_config with a setup note -- without any secret/invoke call."""
    _daemon, forbidden = installed_tools
    model = _FakeInstance([json.dumps({"resource_ids": [_HUDDLE_POST]})])

    options = build.discover_resources(
        model,
        TENANT_ID,
        ["start node: ticket closed", "tool node notifies teammates in the shared chat channel", "end node"],
        goal_text="When a ticket closes, notify teammates in our chat channel.",
        requirements={"channel": "#support"},
    )

    assert [(o.id, o.kind, o.readiness) for o in options] == [(_HUDDLE_POST, "plugin", "missing_config")]
    assert "requires setup" in options[0].meta
    system = model.calls[0][0][0].get_text_content()
    user = model.calls[0][0][1].get_text_content()
    # the recommender may now surface setup-required tools...
    assert "never recommend a missing_config" not in system
    assert "missing_config" in system
    # ...sees what the tool does, not only its label...
    huddle_lines = [line for line in user.splitlines() if _HUDDLE_POST in line]
    assert len(huddle_lines) == 1
    assert "missing_config" in huddle_lines[0]
    assert "Send text to a channel." in huddle_lines[0] or "Notify teammates" in huddle_lines[0]
    # ...and is given a bounded, relevance-ranked candidate list
    plugin_lines = [line for line in user.splitlines() if "(plugin," in line]
    assert len(plugin_lines) < _FILLER_COUNT
    assert forbidden == []


def test_initial_plan_defers_installed_tools_and_discovery_ranks_delayed_setup_beyond_the_old_name_cap(
    installed_tools: tuple[FakeToolDaemon, list[str]],
) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    daemon, forbidden = installed_tools
    model = _FakeInstance(
        [
            _plan_reply(["tool node pages the on-call responders"]),
            json.dumps({"resource_ids": [_PAGER_OPEN, _PAGER_PLUS]}),
        ]
    )
    agent = LlmBuilderAgent(TENANT_ID, {}, model_resolver_fn=lambda: model)
    requirements = {"severity": "high"}
    goal = "Page the on-call responders when an incident opens."

    plan = agent.propose_plan_v1(requirements, goal_text=goal)

    assert plan is not None
    assert daemon.requests == []
    system = model.calls[0][0][0].get_text_content()
    assert _PAGER_OPEN not in system
    assert _PAGER_PLUS not in system
    assert "# Installed tools you may name" not in system

    options = agent.discover_resources(plan.items, goal_text=goal, requirements=requirements)

    section = model.calls[1][0][1].get_text_content().split("AVAILABLE:\n", 1)[1]
    listed = [line for line in section.splitlines() if line.startswith("- ")]
    assert _PAGER_OPEN in section
    assert _PAGER_PLUS in section
    assert _HUDDLE_POST not in section
    assert 0 < len(listed) <= build._MAX_DISCOVERY_TOOLS
    assert [(o.id, o.readiness) for o in options] == [(_PAGER_OPEN, "ready"), (_PAGER_PLUS, "missing_config")]
    assert "setup" in next(o.meta for o in options if o.id == _PAGER_PLUS).lower()
    assert daemon.requests
    assert forbidden == []


@pytest.mark.usefixtures("installed_tools")
def test_bind_resources_retains_installed_tools_requiring_setup() -> None:
    plan = ["tool node echoes the ticket", "tool node posts to the team chat"]

    bound = build.bind_resources(None, TENANT_ID, plan, [_FREE_ECHO, _HUDDLE_POST])

    joined = "\n".join(bound)
    assert f"[{_FREE_ECHO}]" in joined
    assert f"[{_HUDDLE_POST}]" in joined


@pytest.mark.usefixtures("installed_tools")
def test_bind_resources_allows_schema_binding_without_borrowing_a_private_credential(
    sqlite_session: OrmSession,
) -> None:
    from models.enums import PermissionEnum

    add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="acme/onlyme/onlyme",
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    plan = ["tool node runs the private step"]

    owner = build.bind_resources(None, TENANT_ID, plan, [_ONLYME_RUN], account_id=ACCOUNT_B)
    teammate = build.bind_resources(None, TENANT_ID, plan, [_ONLYME_RUN], account_id=ACCOUNT_A)

    assert _ONLYME_RUN in "\n".join(owner)
    assert _ONLYME_RUN in "\n".join(teammate)
    assert ACCOUNT_B not in "\n".join(teammate)


def _session_model_config() -> ModelConfig:
    from core.app.app_config.entities import ModelConfig

    return ModelConfig.model_validate({"provider": "anthropic", "name": "x", "mode": "chat", "completion_params": {}})


class _CapturingGenerator:
    def __init__(self, graph: Graph | None = None) -> None:
        self.calls: list[Graph] = []
        self._graph = graph or {"nodes": [{"id": "s", "data": {"type": "start", "title": "Start"}}], "edges": []}

    def generate_workflow_graph(self, **kwargs: object) -> Graph:
        self.calls.append(kwargs)
        return {"graph": self._graph, "error": "", "errors": []}


def _tool_graph(provider_id: str, tool_name: str) -> Graph:
    return {
        "nodes": [
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "t",
                "type": "custom",
                "data": {
                    "type": "tool",
                    "title": tool_name,
                    "provider_id": provider_id,
                    "provider_name": provider_id,
                    "provider_type": "builtin",
                    "tool_name": tool_name,
                    "tool_label": tool_name,
                    "tool_parameters": {},
                    "tool_configurations": {},
                },
            },
            {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [{"id": "e1", "source": "s", "target": "t"}, {"id": "e2", "source": "t", "target": "e"}],
    }


def _tool_intents(result: BuildNodesResult) -> list[tuple[str, str]]:
    return [
        (intent.args["config"].get("provider_id"), intent.args["config"].get("tool_name"))
        for intent in result.intents
        if intent.op == "create_node" and intent.args.get("node_type") == "tool"
    ]


@pytest.mark.usefixtures("installed_tools")
def test_build_nodes_restricts_generation_to_the_uncapped_installed_inventory(monkeypatch: pytest.MonkeyPatch) -> None:
    generator = _CapturingGenerator()
    monkeypatch.setattr(build, "WorkflowGeneratorService", generator)
    monkeypatch.setattr(build, "_generator_model_config", lambda *a, **k: _session_model_config())  # noqa: ARG005

    build.build_nodes(TENANT_ID, {}, ["tool node posts to the team chat"])

    ready = generator.calls[0].get("ready_tool_keys")
    assert ready is not None
    assert ("acme/free/free", "echo") in ready
    assert ("time", "current_time") in ready
    # every ready filler, not a name-sorted planner window
    assert sum(1 for provider, _tool in ready if provider.startswith("aaa/filler_")) == _FILLER_COUNT
    assert ("acme/huddle/huddle", "post") in ready
    assert ("zeta/pagerplus/pagerplus", "page_oncall") in ready


@pytest.mark.usefixtures("installed_tools")
def test_build_nodes_private_credentials_do_not_hide_the_installed_action_schema(
    sqlite_session: OrmSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.enums import PermissionEnum

    add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="acme/onlyme/onlyme",
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    generator = _CapturingGenerator()
    monkeypatch.setattr(build, "WorkflowGeneratorService", generator)
    monkeypatch.setattr(build, "_generator_model_config", lambda *a, **k: _session_model_config())  # noqa: ARG005

    build.build_nodes(TENANT_ID, {}, ["tool node runs"], account_id=ACCOUNT_B)
    build.build_nodes(TENANT_ID, {}, ["tool node runs"], account_id=ACCOUNT_A)

    assert ("acme/onlyme/onlyme", "run") in generator.calls[0]["ready_tool_keys"]
    assert ("acme/onlyme/onlyme", "run") in generator.calls[1]["ready_tool_keys"]


@pytest.mark.parametrize(
    ("provider_id", "tool_name", "admitted"),
    [
        ("acme/free/free", "echo", True),  # ready control
        ("acme/huddle/huddle", "post", True),  # installed, delayed setup
        ("acme/huddle/huddle", "not_installed", False),
        ("foreign/huddle/huddle", "post", False),
        ("acme/notinstalled/notinstalled", "post", False),
    ],
)
@pytest.mark.usefixtures("installed_tools")
def test_build_nodes_admits_only_actual_installed_action_schemas(
    monkeypatch: pytest.MonkeyPatch, provider_id: str, tool_name: str, admitted: bool
) -> None:
    """A generated draft may delay setup, but cannot invent an installed action."""
    generator = _CapturingGenerator(_tool_graph(provider_id, tool_name))
    monkeypatch.setattr(build, "WorkflowGeneratorService", generator)
    monkeypatch.setattr(build, "_generator_model_config", lambda *a, **k: _session_model_config())  # noqa: ARG005

    result = build.build_nodes(TENANT_ID, {}, [f"tool node runs {tool_name}"])

    assert ((provider_id, tool_name) in _tool_intents(result)) is admitted


# ---- review edge: the readiness reason survives a long description -----------


class TestNativeBuildCapabilityMessages:
    """Cognition receives native build facts separately from authored source and external resources."""

    _GOAL = (
        "ORIGINAL_GOAL_AUTHORITY_73: GET each supplied URL, check HTTP status_code = 200, "
        "return exactly healthy or unhealthy, and combine the branch results before End."
    )
    _REQUIREMENTS = {
        "success_literal": "healthy",
        "failure_literal": "unhealthy",
        "authored_node_id": "USER_BRANCH_ID_73",
        "authored_metadata": "USER_METADATA_ONLY_73",
    }

    @staticmethod
    def _assert_constant_rules(system: str) -> None:
        assert "assigner v2 publishes no own outputs" in system
        assert "existing declared mutable" in system
        assert "conversation or loop variable" in system
        assert "template-transform v1 publishes output:string" in system
        assert "literal" in system
        assert "variables=[]" in system

    @classmethod
    def _outline_messages(cls) -> list[PromptMessage]:
        plan = ["http-request node GETs the URL", "if-else node checks status", "end node returns the result"]
        model = _FakeInstance([_plan_reply(plan)])
        result = build.propose_plan_v1(model, cls._REQUIREMENTS, goal_text=cls._GOAL)
        assert isinstance(result, WorkflowPlan)
        assert result.items == plan
        assert len(model.calls) == 1
        return model.calls[0][0]

    @classmethod
    def _gap_messages(cls, option: ResourceOption | None = None) -> list[PromptMessage]:
        plan = ["http-request node GETs the URL", "if-else node checks status", "end node returns the result"]
        model = _FakeInstance(['{"gap":""}'])
        assert (
            build.assess_capability_gap(
                model, plan, [] if option is None else [option], goal_text=cls._GOAL, requirements=cls._REQUIREMENTS
            )
            == ""
        )
        assert len(model.calls) == 1
        return model.calls[0][0]

    def test_outline_keeps_original_goal_literals_and_metadata_in_user_message(self) -> None:
        system, user = self._outline_messages()

        assert user.get_text_content() == (
            f"ORIGINAL GOAL:\n{self._GOAL}\n\nCONFIRMED REQUIREMENTS:\n"
            + json.dumps(self._REQUIREMENTS, ensure_ascii=False)
        )
        for value in (
            "ORIGINAL_GOAL_AUTHORITY_73",
            "healthy",
            "unhealthy",
            "USER_BRANCH_ID_73",
            "USER_METADATA_ONLY_73",
        ):
            assert value in user.get_text_content()
            assert value not in system.get_text_content()


@pytest.mark.parametrize("reply_language", ["en", "zh-Hans"])
def test_discovery_grounds_minimal_dependencies_in_native_capabilities(
    monkeypatch: pytest.MonkeyPatch, reply_language: str
) -> None:
    _stub_inventory(monkeypatch, tools=[resources.ResourceRef(id="tool/run", label="Interpreter")])
    model = _FakeInstance(['{"resource_ids": [], "selection_reasons": {}}'])
    options = build.discover_resources(
        model,
        "tenant",
        ["code node validates totals", "template node formats totals"],
        goal_text="Validate totals; if an LLM is necessary prefer the configured model.",
        mode="advanced-chat",
        reply_language=reply_language,
    )
    assert options == []
    system = model.calls[0][0][0].get_text_content()
    assert build._node_vocabulary("advanced-chat") in system
    assert build.native_build_capability_system_rules() in system
    assert "smallest set" in system
    assert "Builder's own reasoning model" in system
    assert "conditional model preference" in system
    assert "explicitly required identity" in system
    assert "every selected resource" in system
    assert f"BCP-47: {reply_language}" in system
    assert len(model.calls) == 1


@pytest.mark.parametrize(("reply_language", "setup"), [("en", "requires setup"), ("zh-Hans", "需要配置")])
def test_discovery_projects_localized_business_purposes_without_tool_manuals(
    monkeypatch: pytest.MonkeyPatch, reply_language: str, setup: str
) -> None:
    _stub_inventory(
        monkeypatch,
        tools=[
            resources.ResourceRef(
                id="tool/post", label="Post", meta="Raw English action manual", readiness="missing_config"
            )
        ],
        models=[resources.ResourceRef(id="provider/model", label="Preferred model", meta="Raw model description")],
    )
    tool_reason = "将报告 发送到团队频道。" if reply_language == "zh-Hans" else "Share the report with the team."
    model_reason = "撰写业务报告。" if reply_language == "zh-Hans" else "Write the business report."
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "resource_ids": ["tool/post", "provider/model"],
                    "selection_reasons": {
                        "tool/post": "  " + tool_reason.replace(" ", "\n") + "  ",
                        "provider/model": model_reason,
                        "unknown": "wrong",
                    },
                }
            )
        ]
    )
    options = build.discover_resources(
        model,
        "tenant",
        ["llm node writes report", "tool node posts report"],
        goal_text="Use the explicitly requested Post integration to share an LLM-written report.",
        reply_language=reply_language,
    )
    assert [(o.id, o.readiness) for o in options] == [("tool/post", "missing_config"), ("provider/model", "ready")]
    assert options[0].meta.startswith(tool_reason)
    assert setup in options[0].meta
    assert "Raw English" not in options[0].meta
    assert options[1].meta == model_reason
    assert len(model.calls) == 1


@pytest.mark.parametrize("reason", [None, "", "  ", 4, [], {}, "x" * 361])
@pytest.mark.parametrize(
    ("reply_language", "fallback"), [("en", "Selection rationale unavailable"), ("zh-Hans", "推荐理由暂不可用")]
)
def test_discovery_keeps_selected_tools_with_bounded_localized_reason_fallback(
    monkeypatch: pytest.MonkeyPatch, reason: object, reply_language: str, fallback: str
) -> None:
    from services.dify_builder.trace_diagnostics import scope

    _stub_inventory(
        monkeypatch, tools=[resources.ResourceRef(id="tool/run", label="Requested interpreter", meta="Raw manual")]
    )
    model = _FakeInstance([json.dumps({"resource_ids": ["tool/run"], "selection_reasons": {"tool/run": reason}})])
    diagnostics: list[dict[str, object]] = []
    with scope(diagnostics.append, "discover-resources"):
        options = build.discover_resources(
            model, "tenant", ["Use the requested interpreter"], reply_language=reply_language
        )
    assert [o.id for o in options] == ["tool/run"]
    assert options[0].meta.startswith(fallback)
    assert len(options[0].meta) < 180
    assert [(d["code"], d["fallback_used"]) for d in diagnostics] == [("response_schema_invalid", True)]


def test_business_clarification_hides_only_marked_internal_defaults_but_keeps_them_for_planning() -> None:
    """ENG-1345-shaped defaults stay internal only after explicit presentation classification."""
    from dataclasses import replace
    from datetime import datetime

    from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.application.handlers_build import handle_capability_check, handle_goal_analysis
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, FixtureEnv, InMemoryRepository

    goal = "构建一个需求分析工作流，用户输入需求，工作流自动联网调研市场、竞品等关键信息，最终给出需求分析报告。"
    values: Inputs = {
        "report_language": "中文",
        "report_sections": ["市场规模与趋势", "竞品分析", "目标用户分析", "机会与风险", "需求可行性建议"],
        "report_layout": {"include_summary": True, "heading_levels": [1, 2]},
        "target_market_region": "",
    }
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [
                        {
                            "key": "report_language",
                            "label": "报告输出语言",
                            "type": "select",
                            "options": ["中文", "英文"],
                        },
                        {
                            "key": "report_sections",
                            "label": "报告包含的分析模块",
                            "type": "json",
                            "presentation": "internal",
                            "requires_user_decision": False,
                        },
                        {
                            "key": "report_layout",
                            "label": "报告格式",
                            "type": "json_object",
                            "presentation": "internal",
                            "requires_user_decision": False,
                        },
                        {"key": "target_market_region", "label": "调研市场范围", "type": "text"},
                    ],
                    "values": values,
                },
                ensure_ascii=False,
            ),
            _plan_reply(["Research the requested market and return the specified report"]),
        ]
    )
    agent = LlmBuilderAgent("tenant-1", {}, model_resolver_fn=lambda: model)
    env = FixtureEnv(dify=FakeDifyPort(), agent=agent, repo=InMemoryRepository(), now=lambda: datetime.min)
    actor = Actor(account_id="account-1", tenant_id="tenant-1")
    session = Session(
        app_id="app-1",
        tenant_id="tenant-1",
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_CAPABILITY_CHECK,
    )
    context = DifyBuilderContext(goal_text=goal, reply_language="zh-Hans", app_name_auto=False)

    result = handle_capability_check(env, Turn(actor=actor), session, context)

    assert result.context is not None
    assert result.context.requirements == values
    assert [f["key"] for f in result.context.form_fields] == ["report_language", "target_market_region"]
    form = next(item for item in result.items if item.kind == "form")
    assert [f["key"] for f in form.payload["fields"]] == ["report_language", "target_market_region"]
    assert form.payload["values"]["report_sections"] == values["report_sections"]
    assert form.payload["values"]["report_layout"] == values["report_layout"]

    submitted = handle_goal_analysis(
        env,
        Turn(actor=actor, action=Action(kind="submit_requirements", payload={"report_language": "英文"})),
        replace(session, current_state=PcState.BUILD_GOAL_ANALYSIS),
        result.context,
    )

    assert submitted.context is not None
    assert submitted.context.requirements == {**values, "report_language": "英文"}
    assert isinstance(submitted.context.requirements["report_sections"], list)
    assert isinstance(submitted.context.requirements["report_layout"], dict)
    assert json.dumps(submitted.context.requirements, ensure_ascii=False) in model.calls[1][0][1].get_text_content()


@pytest.mark.parametrize("field_type", ["json", "json_object"])
@pytest.mark.parametrize("default", [None, ""])
def test_business_clarification_keeps_required_unanswered_structured_questions(
    field_type: str, default: object
) -> None:
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [
                        {
                            "key": "business_rules",
                            "label": "Which rules are required?",
                            "type": field_type,
                            "required": True,
                        }
                    ],
                    "values": {"business_rules": default},
                }
            )
        ]
    )

    analysis = build.analyze_goal(model, "Apply the required business rules once the user supplies them.")

    assert [f["key"] for f in analysis["fields"]] == ["business_rules"]
    assert analysis["fields"][0]["required"] is True
    assert analysis["values"] == {"business_rules": default}


def test_business_clarification_preserves_explicit_required_technical_structure() -> None:
    values = {"schema": {"type": "object", "properties": {"amount": {"type": "number"}}}}
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "schema", "label": "JSON schema", "type": "json_object", "required": True}],
                    "values": values,
                }
            )
        ]
    )

    analysis = build.analyze_goal(
        model, 'Use this explicit JSON schema: {"type":"object","properties":{"amount":{"type":"number"}}}.'
    )

    assert analysis["fields"][0]["type"] == "json_object"
    assert analysis["values"] == values


def test_business_clarification_keeps_explicit_optional_json_editable_through_real_handlers() -> None:
    """Optional controls are still user-owned when the goal explicitly asks to edit them."""
    from dataclasses import replace
    from datetime import datetime

    from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.application.handlers_build import handle_capability_check, handle_goal_analysis
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, FixtureEnv, InMemoryRepository

    original_options = {"include_summary": True, "sections": ["market", "competitors"]}
    edited_options = {"include_summary": False, "sections": ["competitors", "risks"]}
    goal = (
        "Build a report workflow. Keep a user-editable optional JSON configuration named report_options "
        "with the default object supplied below; do not remove its JSON editor. Also ask for output language. "
        f"DEFAULT: {json.dumps(original_options)}"
    )
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [
                        {
                            "key": "report_options",
                            "label": "Optional JSON configuration",
                            "type": "json_object",
                            "required": False,
                        },
                        {"key": "language", "label": "Output language", "type": "text"},
                    ],
                    "values": {"report_options": original_options, "language": "English"},
                }
            ),
            _plan_reply(["Build the report using the accepted JSON configuration"]),
        ]
    )
    agent = LlmBuilderAgent("tenant-1", {}, model_resolver_fn=lambda: model)
    env = FixtureEnv(dify=FakeDifyPort(), agent=agent, repo=InMemoryRepository(), now=lambda: datetime.min)
    actor = Actor(account_id="account-1", tenant_id="tenant-1")
    session = Session(
        app_id="app-1",
        tenant_id="tenant-1",
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_CAPABILITY_CHECK,
    )
    context = DifyBuilderContext(goal_text=goal, app_name_auto=False)

    analyzed = handle_capability_check(env, Turn(actor=actor), session, context)

    assert analyzed.context is not None
    form = next(item for item in analyzed.items if item.kind == "form")
    assert [field["key"] for field in form.payload["fields"]] == ["report_options", "language"]
    optional_json = next(field for field in form.payload["fields"] if field["key"] == "report_options")
    assert optional_json["type"] == "json_object"
    assert optional_json["required"] is False
    assert form.payload["values"]["report_options"] == original_options

    submitted = handle_goal_analysis(
        env,
        Turn(actor=actor, action=Action(kind="submit_requirements", payload={"report_options": edited_options})),
        replace(session, current_state=PcState.BUILD_GOAL_ANALYSIS),
        analyzed.context,
    )

    assert submitted.context is not None
    assert submitted.context.requirements["report_options"] == edited_options
    assert json.dumps(edited_options) in model.calls[1][0][1].get_text_content()


@pytest.mark.parametrize(
    "metadata",
    [
        {},
        {"presentation": "user_input", "requires_user_decision": False},
        {"presentation": "unknown", "requires_user_decision": False},
        {"presentation": "internal"},
        {"presentation": "internal", "requires_user_decision": True},
        {"presentation": "internal", "requires_user_decision": "false"},
        {"presentation": "internal", "requires_user_decision": False, "required": True},
    ],
)
def test_business_clarification_protects_unmarked_or_editable_complex_defaults(metadata: dict[str, object]) -> None:
    values = {"sections": ["market", "competitors"], "options": {"summary": True}}
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [
                        {"key": "sections", "label": "Sections", "type": "json", **metadata},
                        {"key": "options", "label": "Options", "type": "json_object", **metadata},
                    ],
                    "values": values,
                }
            )
        ]
    )

    analysis = build.analyze_goal(model, "Build a report workflow with editable report settings.")

    assert [field["key"] for field in analysis["fields"]] == ["sections", "options"]
    assert [field["type"] for field in analysis["fields"]] == ["json", "json_object"]
    assert analysis["values"] == values


def test_planner_returns_later_discovered_business_questions_with_editable_defaults() -> None:
    from dataclasses import asdict

    reply = {
        "kind": "clarification",
        "fields": [
            {
                "key": "missing_rate",
                "label": "Missing rate",
                "hint": "Recommended: reject missing rates to avoid inaccurate totals.",
                "type": "select",
                "options": ["Reject", "Skip"],
                "required": True,
            }
        ],
        "values": {"missing_rate": "Reject"},
    }
    model = _FakeInstance([json.dumps(reply)])

    outcome = build.propose_plan_v1(model, {"currency": "USD"}, goal_text="Settle orders after rule approval.")

    assert outcome is not None
    assert asdict(outcome) == {**reply, "knowledge_source_intent": None}
    assert len(model.calls) == 1
    system = model.calls[0][0][0].content
    assert "unanswered business" in system
    assert "recommended" in system
    assert "submission" in system


@pytest.mark.parametrize(
    "invalid",
    [
        {"kind": "clarification", "fields": [], "values": {}},
        {"kind": "clarification", "fields": [{"key": "x", "label": "X", "type": "json"}], "values": {"x": {}}},
        {
            "kind": "clarification",
            "fields": [{"key": "x", "label": "X", "type": "select", "options": ["A"]}],
            "values": {"x": "B"},
        },
        {"kind": "clarification", "fields": [{"key": "x", "label": "X", "type": "text"}], "values": {"x": []}},
    ],
)
def test_planner_never_approves_a_malformed_clarification(invalid: dict[str, object]) -> None:
    model = _FakeInstance([json.dumps(invalid), json.dumps(invalid)])
    assert build.propose_plan_v1(model, {}, goal_text="Settle orders") is None


def test_planner_can_ask_a_required_select_without_inventing_a_recommendation() -> None:
    from services.dify_builder.plan import BuildClarification

    model = _FakeInstance(
        [
            json.dumps(
                {
                    "kind": "clarification",
                    "fields": [
                        {"key": "recipient", "label": "Recipient", "type": "select", "options": ["Owner", "Reviewer"]}
                    ],
                    "values": {"recipient": ""},
                }
            )
        ]
    )
    outcome = build.propose_plan_v1(model, {}, goal_text="Notify the responsible person")
    assert isinstance(outcome, BuildClarification)
    assert outcome.values == {"recipient": ""}
    assert outcome.fields[0]["options"] == ["Owner", "Reviewer"]
    assert outcome.fields[0]["required"] is True


@pytest.mark.parametrize("reply_language", ["en", "zh-Hans"])
@pytest.mark.parametrize(
    ("outcome", "replies", "expected_calls", "schema_reason"),
    [
        ("provider_failure", [RuntimeError("PRIVATE_PROVIDER_VALUE")], 2, None),
        ("absent_model", [], 0, None),
        ("missing_gap", ['{"PRIVATE_SCHEMA_KEY":"PRIVATE_SCHEMA_VALUE"}'], 2, "missing"),
        ("wrong_type", ['{"gap":{"PRIVATE_SCHEMA_KEY":"PRIVATE_SCHEMA_VALUE"}}'], 2, "type"),
        ("invalid_json", ["[]", "[]"], 3, None),
        ("covered", ['{"gap":""}'], 2, None),
        ("explained", ['{"gap":"The requested external binding remains unconfirmed."}'], 2, None),
    ],
)
def test_preapproval_feasibility_unknown_is_disclosed_without_changing_approval(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    reply_language: str,
    outcome: str,
    replies: list[str | Exception],
    expected_calls: int,
    schema_reason: str | None,
) -> None:
    """Catches silent unknown, fabricated bindings and extra assessment retries."""
    from core.dify_builder.models import Action, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.application.handlers_build import handle_initial_plan, handle_resource_recommendation
    from tests.unit_tests.core.dify_builder.test_handlers_build import _actor, _new_env, _seed_build_session
    from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

    provider = _FakeInstance(['{"resource_ids":[]}'] + replies)
    agent = LlmBuilderAgent(
        "tenant-1", account_id="acc-1", model_resolver_fn=lambda: None if outcome == "absent_model" else provider
    )
    env, repo = _new_env(agent=agent)
    agent.set_diagnostic_callback(env.record_diagnostic)
    goal = "Translate source_text to English without external tools; return translation."
    requirements: dict[str, object] = {"target_language": "English", "output": "translation", "external_tools": False}
    items = ["start collects source_text", "llm translates to English", "end returns translation"]
    session = _seed_build_session(
        repo,
        PcState.BUILD_INITIAL_PLAN,
        goal_text=goal,
        requirements=requirements,
        plan_items=items,
        reply_language=reply_language,
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: resources.TenantResources([], [], []))
    result = handle_initial_plan(env, Turn(actor=_actor()), *repo.get_session(session.id))
    assert result.next == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert result.context is not None
    reply = english_text(next(item.payload["reply_text"] for item in result.items if item.kind == "assistant_turn"))
    unknown = outcome not in {"covered", "explained"}
    disclosure = "计划可行性检查暂不可用" if reply_language == "zh-Hans" else "plan feasibility check is unavailable"
    assert (disclosure in reply) is unknown
    assert ("external binding remains unconfirmed" in reply) is (outcome == "explained")
    assert "unsupported" not in reply.lower()
    assert "PRIVATE" not in reply + json.dumps(env.diagnostics) + caplog.text
    assert not any(item.kind == "notice" for item in result.items)
    assert len(provider.calls) == expected_calls
    for messages, parameters, stop, stream in provider.calls:
        assert goal in messages[1].content
        assert '"external_tools": false' in messages[1].content
        assert parameters == {}
        assert stop is None
        assert stream is False
    schema_records = [record for record in env.diagnostics if record["code"] == "response_schema_invalid"]
    if schema_reason:
        assert len(schema_records) == 1
        assert schema_records[0]["span_id"] == "assess-capability-gap"
        assert schema_records[0]["validation_details"] == [
            {"stage": "plan", "reason_code": schema_reason, "path": ["gap"]}
        ]
    before_confirm = len(provider.calls)
    confirmed = handle_resource_recommendation(
        env,
        Turn(actor=_actor(), action=Action(kind="confirm_resources", payload={"resource_ids": []})),
        session,
        result.context,
    )
    assert confirmed.next == PcState.BUILD_PLAN_APPROVAL
    assert confirmed.context is not None
    assert confirmed.context.goal_text == goal
    assert confirmed.context.requirements == requirements
    assert confirmed.context.plan_items == items
    assert confirmed.context.resource_selection == {"resource_ids": []}
    assert len(provider.calls) == before_confirm
    assert not env.fake_dify.applied


def test_feasibility_policy_denial_is_not_an_unknown_assessment() -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError

    provider = _FakeInstance([CognitionPolicyDeniedError("model_not_admitted")])
    agent = LlmBuilderAgent("tenant", model_resolver_fn=lambda: provider)
    with pytest.raises(CognitionPolicyDeniedError, match="model_not_admitted"):
        agent.assess_capability_gap(["code transforms input"], [], goal_text="Preserve input", requirements={})
    assert len(provider.calls) == 1
