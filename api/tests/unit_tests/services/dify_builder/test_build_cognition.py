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
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from graphon.model_runtime.entities.message_entities import PromptMessage
from services.dify_builder.agent import build, resources
from tests.unit_tests.config_override import apply_config_overrides
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
from tests.unit_tests.services.dify_builder.test_dify_port import PortDatabase


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
        self.calls = []

    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        **_kw: object,
    ) -> _Result:
        self.calls.append((prompt_messages, model_parameters, stop, stream))
        return _Result(self._r.pop(0))


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


def test_analyze_goal_returns_fields_and_values() -> None:
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "categories", "label": "Categories", "type": "text"}],
                    "values": {"categories": "billing"},
                }
            )
        ]
    )
    out = build.analyze_goal(m, "triage tickets")
    assert out["fields"][0]["key"] == "categories"
    assert out["values"] == {"categories": "billing"}


_ALERT_GOAL = (
    "Create an alert grading Workflow using numeric error_rate_pct, p95_ms, requests. "
    "Invalid negatives or rate>100 ->invalid_input; requests=0 ->no_data; "
    "rate>=5 or latency>=2000 ->critical; rate>=1 or latency>=800 ->warning; otherwise healthy. "
    "Deterministic logic, no runtime LLM/external calls."
)


def test_analyze_goal_requests_only_necessary_unanswered_business_requirements() -> None:
    model = _FakeInstance([json.dumps({"fields": [], "values": {}})])

    build.analyze_goal(model, _ALERT_GOAL)

    system = model.calls[0][0][0].content
    assert "3-6" not in system
    assert "0-6" in system
    assert "unanswered business requirements" in system
    assert '"fields": []' in system
    assert "implementation choices" in system
    assert "thresholds" in system
    assert "explicitly requested technical choices" in system
    assert len(model.calls) == 1


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


def test_analyze_goal_degrades_to_generic_field_on_none() -> None:
    out = build.analyze_goal(None, "some goal")
    assert out["fields"]
    assert out["fields"][0]["type"] == "textarea"
    assert out["values"].get(out["fields"][0]["key"]) == "some goal"


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


def test_scrub_invented_defaults_blanks_a_plausible_invented_host() -> None:
    values = {"render_api_url": "https://api.pptrender.io/v1/render"}

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out["render_api_url"] == ""


def test_scrub_invented_defaults_keeps_a_url_whose_host_the_goal_names() -> None:
    goal = "POST the finished slides to https://render.acme.internal/v2 and return the link"
    values = {"render_api_url": "https://render.acme.internal/v2/pptx"}

    out = build._scrub_invented_defaults(values, goal)

    assert out["render_api_url"] == "https://render.acme.internal/v2/pptx"


def test_scrub_invented_defaults_keeps_a_credential_the_goal_states() -> None:
    goal = "Authenticate with the API key sk-live-abc123"
    values = {"api_key": "sk-live-abc123"}

    out = build._scrub_invented_defaults(values, goal)

    assert out["api_key"] == "sk-live-abc123"


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


def test_scrub_invented_defaults_keeps_a_non_credential_placeholder_looking_string() -> None:
    # ESQ1-302 fix round 1: CREDENTIAL_PLACEHOLDER_RE's "<...>" shape must
    # not blank an ordinary templated-greeting default that happens to use
    # angle brackets.
    values = {"greeting_template": "Dear <customer_name>,"}

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
    assert out["values"]["api_auth_header"] == ""
    assert out["values"]["tone"] == "Professional"
    assert out["values"]["slide_count"] == 10
    assert out["values"]["include_speaker_notes"] is True
    assert (
        "Never invent a URL/endpoint, API key, token, password, or account/resource id the goal does not state"
        in captured["system"]
    )


def test_propose_plan_v1_returns_overview_and_steps_in_one_call() -> None:
    m = _FakeInstance([_plan_reply(["Ingest", "Summarize", "Emit"])])
    out = build.propose_plan_v1(m, {"x": 1})
    assert out is not None
    assert out.title == "Build a document summary workflow"
    assert out.input_summary == "Source documents to summarize."
    assert out.output_summary == "A summary report."
    assert out.items == ["Ingest", "Summarize", "Emit"]
    assert len(m.calls) == 1


def test_propose_plan_v1_reports_no_plan_without_a_model() -> None:
    out = build.propose_plan_v1(None, {})
    assert out is None


def test_propose_plan_v1_reports_no_plan_on_provider_failure() -> None:
    m = _BoomInstance()
    out = build.propose_plan_v1(m, {})
    assert out is None


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

    assert out is not None
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


def test_propose_plan_v1_preserves_valid_plan_strings_without_content_thresholds() -> None:
    model = _FakeInstance([_plan_reply(["start node: collect input", "llm node: draft", "end node: return"])])

    out = build.propose_plan_v1(model, {})
    assert out is not None
    assert out.items == ["start node: collect input", "llm node: draft", "end node: return"]
    assert len(model.calls) == 1


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


def test_discover_resources_recommends_nothing_when_the_call_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    # Previously degraded to the whole inventory, which the client pre-checks
    # and submits by default -- binding resources nobody chose.
    _stub_inventory(monkeypatch, datasets=[resources.ResourceRef(id="kb-1", label="Company KB")])

    assert build.discover_resources(_BoomInstance(), "t1", ["Retrieve knowledge"]) == []


def test_discover_resources_recommends_nothing_without_a_model(monkeypatch: pytest.MonkeyPatch) -> None:
    # A degraded agent has no signal at all, so it must not claim a recommendation.
    _stub_inventory(monkeypatch, datasets=[resources.ResourceRef(id="kb-1", label="Company KB")])

    assert build.discover_resources(None, "t1", ["Retrieve knowledge"]) == []


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


def test_discover_resources_shows_the_model_each_options_readiness(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def fake_invoke_json(model: object, *, system: str, user: str, **kw: object) -> Graph:  # noqa: ARG001
        captured["system"] = system
        captured["user"] = user
        return {"resource_ids": []}

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)
    _stub_inventory(
        monkeypatch,
        tools=[resources.ResourceRef(id="tool-slack/send", label="Slack", readiness="missing_config")],
    )

    build.discover_resources(_FakeInstance([]), "t1", ["Notify on Slack"])

    # The recommender must see readiness, not just ids/labels -- otherwise it
    # has no signal to avoid recommending an unauthorized tool (the bug this
    # guards: a missing_config tool recommended anyway).
    assert "missing_config" in captured["user"]
    assert "missing_config" in captured["system"]


def test_gap_system_defines_missing_config() -> None:
    # The gap-checker's system prompt must define what missing_config means --
    # installed but not authorized, i.e. not usable -- not just show the raw
    # label with no basis for the model to treat it as unavailable.
    assert "missing_config" in build._GAP_SYSTEM


def test_assess_capability_gap_names_the_gap_in_plain_words() -> None:
    m = _FakeInstance([json.dumps({"gap": "Nothing installed can send email."})])
    assert build.assess_capability_gap(m, ["Email the manager"], []) == "Nothing installed can send email."


def test_assess_capability_gap_reports_no_gap_when_the_plan_is_covered() -> None:
    m = _FakeInstance([json.dumps({"gap": ""})])
    assert build.assess_capability_gap(m, ["Summarize text"], []) == ""


def test_assess_capability_gap_reports_no_gap_without_a_model() -> None:
    # A gap we cannot assess is not a gap -- inventing one would block a build
    # that might be fine.
    assert build.assess_capability_gap(None, ["Email the manager"], []) == ""


def test_assess_capability_gap_reports_no_gap_on_model_failure() -> None:
    m = _BoomInstance()
    assert build.assess_capability_gap(m, ["Email the manager"], []) == ""


def test_assess_capability_gap_reports_no_gap_for_an_empty_plan() -> None:
    m = _FakeInstance([json.dumps({"gap": "should never be read"})])
    assert build.assess_capability_gap(m, [], []) == ""


def test_assess_capability_gap_reports_no_gap_on_unparseable_reply() -> None:
    m = _FakeInstance([json.dumps({"gap": 42})])
    assert build.assess_capability_gap(m, ["Email the manager"], []) == ""


def test_assess_capability_gap_shows_the_model_each_option_and_its_readiness(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.dify_builder.contract import ResourceOption

    captured = {}

    def fake_invoke_json(model: object, *, system: str, user: str, **kw: object) -> dict[str, str]:  # noqa: ARG001
        captured["user"] = user
        return {"gap": ""}

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)
    option = ResourceOption(id="tool-slack", label="Slack", meta="", kind="plugin", readiness="missing_config")

    build.assess_capability_gap(_FakeInstance([]), ["Notify on Slack"], [option])

    # A missing_config tool is installed but unauthorized -- the assessment
    # must see that distinction, not just that "Slack" is present, or an
    # unauthorized tool would look like real coverage.
    assert "missing_config" in captured["user"]
    assert "Slack" in captured["user"]


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


def test_bind_resources_binds_each_tool_to_the_step_naming_its_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """The planner is told to name a tool by its id (``_planner_tool_section``),
    but binding matched only the LABEL, then the "tool" keyword -- so with two
    tool steps naming ids, BOTH tools bound to the first tool step."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[],
            datasets=[],
            tools=[
                resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX"),
                resources.ResourceRef(id="langgenius/google/google/google_search", label="Google Search"),
            ],
        ),
    )
    plan = [
        "start节点：定义输入变量 topic",
        "tool节点：使用 bowenliang123/md_exporter/md_exporter/md_to_pptx 把大纲转换成 PPTX 文件",
        "tool节点：使用 langgenius/google/google/google_search 搜索主题相关资料",
        "end节点：返回生成的PPT文件",
    ]

    out = build.bind_resources(
        None,
        "t1",
        plan,
        ["bowenliang123/md_exporter/md_exporter/md_to_pptx", "langgenius/google/google/google_search"],
    )

    assert out[0] == plan[0]
    assert out[1] == plan[1] + " (using Markdown ⮕ PPTX [bowenliang123/md_exporter/md_exporter/md_to_pptx])"
    assert out[2] == plan[2] + " (using Google Search [langgenius/google/google/google_search])"
    assert out[3] == plan[3]


@pytest.mark.parametrize(
    "tool_step",
    [
        # names neither the id nor the label -- bound by the "tool" keyword
        "tool节点：把 Markdown 转成 PPTX 文件",
        # names the id glued to CJK text -- the generator's identifier
        # boundary treats CJK as a word character, so this alone never pins
        "tool节点：使用bowenliang123/md_exporter/md_exporter/md_to_pptx转换",
    ],
)
def test_bind_resources_tool_suffix_carries_the_id_the_generator_pins_on(
    monkeypatch: pytest.MonkeyPatch, tool_step: str
) -> None:
    """The shared generator pins a tool deterministically only through
    ``tool_catalogue._find_explicit_tool_keys``, which looks for the
    ``provider/tool`` IDENTIFIER in the instruction text between
    ``_TOOL_IDENTIFIER_LEFT_BOUNDARY`` = ``(?<![\\w/.:@-])`` and
    ``_TOOL_IDENTIFIER_RIGHT_BOUNDARY`` = ``(?![\\w/@-]|[.:][\\w])`` -- never
    the label. A label-only suffix therefore pinned nothing; the id in ASCII
    brackets does ('[' and ']' are outside both boundary classes)."""
    from core.workflow.generator.tool_catalogue import _find_explicit_tool_keys

    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[],
            datasets=[],
            tools=[
                resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")
            ],
        ),
    )
    entries: list[ToolCatalogueEntry] = [
        {
            "provider_name": "bowenliang123/md_exporter/md_exporter",
            "provider_type": "builtin",
            "plugin_id": "bowenliang123/md_exporter",
            "tool_name": "md_to_pptx",
            "tool_label": "Markdown ⮕ PPTX",
            "description": "Convert Markdown to a PPTX file",
            "needs_credentials": False,
        },
        {
            "provider_name": "langgenius/google/google",
            "provider_type": "builtin",
            "plugin_id": "langgenius/google",
            "tool_name": "google_search",
            "tool_label": "Google Search",
            "description": "Search the web with Google",
            "needs_credentials": True,
        },
    ]
    plan = ["start节点：输入主题", "llm节点：写出 Markdown 大纲", tool_step, "end节点：返回PPT文件"]

    out = build.bind_resources(None, "t1", plan, ["bowenliang123/md_exporter/md_exporter/md_to_pptx"])

    assert out[2] == tool_step + " (using Markdown ⮕ PPTX [bowenliang123/md_exporter/md_exporter/md_to_pptx])"
    assert _find_explicit_tool_keys(entries, "\n".join(plan)) == set()
    assert _find_explicit_tool_keys(entries, "\n".join(out)) == {
        ("bowenliang123/md_exporter/md_exporter", "md_to_pptx")
    }


def test_bind_resources_names_the_tool_id_on_an_empty_plan_too(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[],
            datasets=[],
            tools=[
                resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")
            ],
        ),
    )

    out = build.bind_resources(None, "t1", [], ["bowenliang123/md_exporter/md_exporter/md_to_pptx"])

    assert out == ["Use Markdown ⮕ PPTX [bowenliang123/md_exporter/md_exporter/md_to_pptx]"]


def test_bind_resources_keeps_model_label_and_ignores_selected_dataset(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only a tool is pinned by id; a model's label already IS its full id and
    datasets are unavailable in this Builder phase."""
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
            datasets=[resources.ResourceRef(id="9f1c2b7e-kb", label="Company KB")],
            tools=[],
        ),
    )
    plan = ["llm node: draft the outline", "knowledge-retrieval node: fetch the style guide"]

    out = build.bind_resources(None, "t1", plan, ["langgenius/tokener/tokener/deepseek-v4-flash", "9f1c2b7e-kb"])

    assert out[0] == plan[0] + " (using langgenius/tokener/tokener/deepseek-v4-flash)"
    assert out[1] == plan[1]
    assert "[" not in out[0]
    assert "[" not in out[1]


def test_bind_resources_falls_back_to_the_last_step_when_nothing_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t, **_kw: resources.TenantResources(  # noqa: ARG005
            models=[], datasets=[], tools=[resources.ResourceRef(id="p/t", label="Some Tool")]
        ),
    )

    out = build.bind_resources(None, "t1", ["start node: inputs", "end node: output"], ["p/t"])

    assert out == ["start node: inputs", "end node: output (using Some Tool [p/t])"]


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


def test_bind_resources_cleans_an_old_aggregate_suffix_before_rebinding(monkeypatch: pytest.MonkeyPatch) -> None:
    """A plan bound by the pre-Task-4 binder (every label appended to the
    LAST step) loops back in; its stale aggregate suffix must not survive
    into the re-bind, and must not be mistaken for the step's own content."""
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
            tools=[resources.ResourceRef(id="code/simple_code", label="Code Interpreter")],
        ),
    )
    plan = [
        "llm node: draft",
        "tool node: run something",
        "end node: return output (using langgenius/tokener/tokener/deepseek-v4-flash, Code Interpreter)",
    ]

    out = build.bind_resources(None, "t1", plan, ["langgenius/tokener/tokener/deepseek-v4-flash", "code/simple_code"])

    assert out[0] == "llm node: draft (using langgenius/tokener/tokener/deepseek-v4-flash)"
    assert out[1] == "tool node: run something (using Code Interpreter [code/simple_code])"
    assert out[2] == "end node: return output"


def test_covering_step_tool_keyword_does_not_match_a_toolkit_substring() -> None:
    # "toolkit" contains "tool" as a raw substring -- a plugin must not bind
    # there when an actual tool step exists further down the plan.
    plan = ["code node: build a toolkit summary string", "tool node: send a slack notification"]

    assert build._covering_step(plan, "plugin", resources.ResourceRef(id="p/slack", label="Slack Notifier")) == 1


def test_covering_step_llm_keyword_does_not_match_a_fulfillment_substring() -> None:
    # "fulfillment" contains "llm" as a raw substring -- a model must not
    # bind there; with no real "llm"/"question-classifier"/
    # "parameter-extractor" step present, this falls through to -1 (the
    # caller's fallback then applies).
    plan = ["step: order fulfillment notes", "end node: wrap up"]

    assert build._covering_step(plan, "model", resources.ResourceRef(id="openai/gpt-5", label="openai/gpt-5")) == -1


def test_covering_step_still_matches_llm_in_cjk_step_text() -> None:
    plan = ["start节点：输入", "llm节点：总结", "end节点：输出"]

    assert build._covering_step(plan, "model", resources.ResourceRef(id="p/some-model", label="p/some-model")) == 1


def test_covering_step_prefers_the_step_naming_the_resource_id_over_the_kind_keyword() -> None:
    plan = [
        "tool节点：使用 bowenliang123/md_exporter/md_exporter/md_to_pptx 生成PPT",
        "tool节点：使用 langgenius/google/google/google_search 搜索资料",
    ]
    ref = resources.ResourceRef(id="langgenius/google/google/google_search", label="Google Search")

    assert build._covering_step(plan, "plugin", ref) == 1


def test_learn_from_build_degrades_to_generic() -> None:
    assert isinstance(build.learn_from_build(None, "g", {}, ["p"], ["n"]), str)


def test_learn_from_build_degrades_on_boom() -> None:
    m = _BoomInstance()
    out = build.learn_from_build(m, "some goal", {}, ["plan"], ["node1"])
    assert isinstance(out, str)
    assert "1-node workflow" in out


def test_plan_prompt_carries_the_node_vocabulary(monkeypatch: pytest.MonkeyPatch) -> None:
    """ESQ1-279: the Builder's own planner had NO node vocabulary, so it
    planned in business language ("Send a Feishu notification") and the
    generator was then asked to map steps onto nodes that do not exist."""
    captured = {}

    def fake_invoke_text(model: object, *, system: str, user: str, **kw: object) -> str:  # noqa: ARG001
        captured["system"] = system
        captured["user"] = user
        return _plan_reply(["Start node collects the review list"])

    monkeypatch.setattr(build.llm, "invoke_text", fake_invoke_text)
    build.propose_plan_v1(_FakeInstance([]), {"goal": "summarise reviews"})

    system = captured["system"]
    # the vocabulary is present, and is the shared constant
    assert build._DIFY_NODE_VOCABULARY in system
    # a representative spread of node types the planner may use
    for node_type in ("start", "end", "llm", "iteration", "tool", "if-else", "document-extractor"):
        assert f'"{node_type}"' in system, f"missing node type {node_type}"
    # and it is told to plan ONLY in these terms
    assert "only" in system.lower()


def test_plan_prompt_names_capabilities_dify_lacks(monkeypatch: pytest.MonkeyPatch) -> None:
    """The failure mode is inventing steps Dify has no node for. Name the
    common ones explicitly so the model routes them instead of inventing."""
    captured = {}

    def fake_invoke_text(model: object, *, system: str, user: str, **kw: object) -> str:  # noqa: ARG001
        captured["system"] = system
        return _plan_reply(["step"])

    monkeypatch.setattr(build.llm, "invoke_text", fake_invoke_text)
    build.propose_plan_v1(_FakeInstance([]), {})

    lowered = captured["system"].lower()
    assert "schedul" in lowered  # no timer/trigger node exists
    assert "tool" in lowered  # third-party sends go through a tool node


def test_plan_prompt_still_requests_json_and_language(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression guard: the JSON contract and the reply-language instruction
    must survive the rewrite -- invoke_json parses {"plan": [...]} and the
    Builder replies in the user's language."""
    captured = {}

    def fake_invoke_text(model: object, *, system: str, user: str, **kw: object) -> str:  # noqa: ARG001
        captured["system"] = system
        return _plan_reply(["step"])

    monkeypatch.setattr(build.llm, "invoke_text", fake_invoke_text)
    build.propose_plan_v1(_FakeInstance([]), {})

    assert '"plan": ["step", ...]' in captured["system"]
    assert (
        build.llm.json_language_instruction("the plan title, input and output summaries, and plan steps")
        in captured["system"]
    )


def test_topology_directive_keeps_the_workflow_rules() -> None:
    """Regression guard: the original topology contract must survive. This
    directive is why workflow mode never gets 'answer' nodes."""
    d = build._WORKFLOW_TOPOLOGY_DIRECTIVE
    assert "'start'" in d
    assert "'end'" in d
    assert "answer" in d


def test_topology_directive_carries_node_usage_guidance() -> None:
    """Meeting item 9, tier 2: usage detail rides the Builder-only prepend."""
    d = build._WORKFLOW_TOPOLOGY_DIRECTIVE
    lowered = d.lower()
    # the config mistakes that actually broke real builds
    assert "document-extractor" in lowered  # needs a file input
    assert "iteration" in lowered  # children belong inside the container
    assert "variable" in lowered  # reference only declared outputs


def test_topology_directive_does_not_restate_the_whitelist() -> None:
    """The generator's SHARED system prompt already lists every node type.
    Restating it here burns planner output budget for nothing (see ESQ1-300)."""
    assert build._DIFY_NODE_VOCABULARY not in build._WORKFLOW_TOPOLOGY_DIRECTIVE


def test_build_nodes_sends_the_directive_to_the_generator(monkeypatch: pytest.MonkeyPatch) -> None:
    """The directive is only worth anything if it actually reaches the
    generator ahead of the plan items."""
    seen = {}

    class _FakeGen:
        @staticmethod
        def generate_workflow_graph(
            *,
            tenant_id: str,  # noqa: ARG004
            mode: str,  # noqa: ARG004
            instruction: str,
            model_config: Inputs | None,  # noqa: ARG004
            current_graph: Graph | None,  # noqa: ARG004
            **_kwargs: object,
        ) -> Graph:
            seen["instruction"] = instruction
            return {
                "graph": {
                    "nodes": [{"id": "node1", "data": {"type": "start", "title": "Start"}}],
                    "edges": [],
                }
            }

    # Patch the module-level reference (build.py:21 imports the class), NOT the
    # shared class object itself.
    monkeypatch.setattr(build, "WorkflowGeneratorService", _FakeGen)
    monkeypatch.setattr(build, "_generator_model_config", lambda *a, **k: {})  # noqa: ARG005
    _stub_inventory(monkeypatch)

    build.build_nodes(tenant_id="t1", model_config={}, plan_items=["llm node drafts a reply"])

    instruction = seen["instruction"]
    assert instruction.startswith(build._WORKFLOW_TOPOLOGY_DIRECTIVE)
    assert "llm node drafts a reply" in instruction


# ---- ESQ1-302: tool grounding ------------------------------------------------


def test_topology_directive_no_longer_steers_away_from_installed_tools() -> None:
    """fe3f8154b5 added "use a 'tool' node ... only when the plan names an
    installed tool; otherwise use 'http-request'". That contradicts the SHARED
    planner prompt (INSTALLED-TOOL-FIRST) and the Builder's own planner cannot
    name tools it was never shown -- so every third-party step fell through to
    an http-request with an invented endpoint (api.example.com, ESQ1-302)."""
    lowered = build._WORKFLOW_TOPOLOGY_DIRECTIVE.lower()

    assert "only when the plan names an installed tool" not in lowered
    assert "otherwise use 'http-request'" not in lowered
    # the half that earned its place (ESQ1-286) stays
    assert "start-node variables" in lowered
    # tool-first, in agreement with the shared planner prompt
    assert "installed tool" in lowered
    # and an invented / placeholder endpoint is forbidden outright
    assert "never invent" in lowered
    assert "example.com" in lowered


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


def test_plan_prompt_names_the_ready_tools_it_may_use(monkeypatch: pytest.MonkeyPatch) -> None:
    """The ESQ1-302 tenant had a ready 'Markdown ⮕ PPTX' tool. Its plan still
    said "http-request节点：调用外部PPT生成API" because propose_plan_v1 was shown
    REQUIREMENTS only -- it could not name a tool it had never seen."""
    captured = {}

    def fake_invoke_text(model: object, *, system: str, user: str, **kw: object) -> str:  # noqa: ARG001
        captured["system"] = system
        return _plan_reply(["tool node converts the outline to a PPTX"])

    monkeypatch.setattr(build.llm, "invoke_text", fake_invoke_text)
    tools = [resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")]

    build.propose_plan_v1(_FakeInstance([]), {"goal": "make a deck"}, tools=tools)

    system = captured["system"]
    assert "bowenliang123/md_exporter/md_exporter/md_to_pptx" in system
    assert "Markdown ⮕ PPTX" in system
    assert "installed tools" in system.lower()
    # HTTP remains available without authorizing an invented endpoint.
    assert "http-request" in system
    assert "invent" in system.lower()
    # the generator pins a tool only on its id as a whole word -- an id glued
    # to CJK text ("使用bowenliang123/...") does not pin
    assert "exactly as listed" in system
    assert "separate word" in system


@pytest.mark.parametrize("with_actor", [True, False])
def test_initial_plan_uses_only_current_actor_eligible_published_agent_metadata(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch, with_actor: bool
) -> None:

    from services.agent import access_service
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from tests.builder_agent_fixtures import add_agent, make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    case.snapshot.summary = "Review report evidence"
    unpublished, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Unpublished", published=False)
    hidden, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Hidden")
    sqlite_session.commit()
    monkeypatch.setattr(
        access_service,
        "resolve_current_agent_access_filter",
        lambda **_kwargs: access_service.AgentAccessFilter(accessible_agent_ids={case.agent.id, unpublished.id}),
    )
    monkeypatch.setattr(resources, "db", PortDatabase(sqlite_session.get_bind()))
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant_id: [])
    captured = {}
    steps = ["start node receives report", "New Agent v2 node reviews the report", "end node returns summary"]

    def propose(_model: object, *, system: str, user: str, **_kwargs: object) -> str:
        captured.update(system=system, user=user)
        return _plan_reply(steps)

    monkeypatch.setattr(build.llm, "invoke_text", propose)
    agent = LlmBuilderAgent(case.actor.tenant_id, {}, account_id=case.actor.account_id if with_actor else None)
    monkeypatch.setattr(agent, "_model", lambda: object())

    result = agent.propose_plan_v1({"result": "summary"}, goal_text="Use a Workspace Agent to review a report")

    assert result is not None
    assert result.items == steps
    system = captured["system"]
    assert "New Agent v2" in system
    assert "version=2" in system
    assert "agent_node_kind=dify_agent" in system
    assert "legacy" in system.lower()
    assert unpublished.id not in system
    assert hidden.id not in system
    if with_actor:
        assert case.agent.id in system
        assert "Review report evidence" in system
        assert '"report": {"required": true, "type": "string"}' in system
        assert "published_soul.app_variables" in system
        assert "node_job_required" in system
        assert "tool:plugin/provider/read" in system
    else:
        assert case.agent.id not in system
        assert "# Published Workspace Agents" not in system
    assert "HIDDEN" not in system


def test_initial_plan_keeps_agent_catalogue_failure_distinct_from_no_agents(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    monkeypatch.setattr(
        resources,
        "list_tenant_resources",
        lambda *_args, **_kwargs: resources.TenantResources(
            models=[], datasets=[], tools=[], agent_source_error="Published Agent catalog unavailable"
        ),
    )
    model = _FakeInstance([_plan_reply(["start node receives report", "end node returns report"])])
    agent = LlmBuilderAgent("tenant-1", {}, account_id="actor-1")
    monkeypatch.setattr(agent, "_model", lambda: model)

    assert agent.propose_plan_v1({}, goal_text="Review a report") is not None

    system = model.calls[0][0][0].get_text_content()
    assert "Agent catalog is unavailable" in system
    assert "do not infer" in system


def test_agent_binding_names_new_agent_step_instead_of_end(monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = "agent:agent-1:snapshot-1:" + "a" * 64
    monkeypatch.setattr(
        resources,
        "list_tenant_resources",
        lambda *_args, **_kwargs: resources.TenantResources(
            models=[], datasets=[], tools=[], agents=[resources.ResourceRef(id=agent_id, label="Reviewer")]
        ),
    )

    result = build.bind_resources(
        None,
        "tenant-1",
        ["start node receives report", "New Agent v2 node reviews the report", "end node returns summary"],
        [agent_id],
        account_id="actor-1",
    )

    assert result[1] == "New Agent v2 node reviews the report (using Reviewer [" + agent_id + "])"
    assert result[2] == "end node returns summary"


def test_plan_prompt_without_tools_has_no_tool_section(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def fake_invoke_text(model: object, *, system: str, user: str, **kw: object) -> str:  # noqa: ARG001
        captured["system"] = system
        return _plan_reply(["step"])

    monkeypatch.setattr(build.llm, "invoke_text", fake_invoke_text)

    build.propose_plan_v1(_FakeInstance([]), {})

    assert "# Installed tools" not in captured["system"]


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


def test_analyze_goal_answers_a_blank_goal_restating_field_with_the_goal() -> None:
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [
                        {"key": "requirement_description", "label": "需求描述", "type": "textarea"},
                        {"key": "report_title", "label": "报告标题", "type": "text"},
                    ],
                    "values": {"report_title": "需求调研报告"},
                }
            )
        ]
    )

    out = build.analyze_goal(m, _PM_GOAL)

    assert out["values"]["requirement_description"] == _PM_GOAL


def test_analyze_goal_keeps_the_answer_the_model_gave_a_goal_restating_field() -> None:
    """The backstop repairs a blank, it does not overwrite. A model that wrote
    something narrower than the goal there knew more than we do."""
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "requirement", "label": "需求", "type": "textarea"}],
                    "values": {"requirement": "只看退款工单"},
                }
            )
        ]
    )

    out = build.analyze_goal(m, "triage inbound tickets")

    assert out["values"]["requirement"] == "只看退款工单"


def test_analyze_goal_leaves_a_deliberately_blanked_credential_blank() -> None:
    """``_scrub_invented_defaults`` blanks an invented credential ON PURPOSE so
    the user supplies it. Writing the goal sentence into an API-key box would be
    worse than the bug being fixed."""
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

    assert out["values"]["bocha_api_key"] == ""


def test_analyze_goal_does_not_answer_a_goal_restating_select() -> None:
    """A select gains a value none of its options offer, which the form cannot
    render honestly."""
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "goal", "label": "Goal", "type": "select", "options": ["a", "b"]}],
                    "values": {},
                }
            )
        ]
    )

    out = build.analyze_goal(m, "triage inbound tickets")

    assert "goal" not in out["values"]


def test_analyze_goal_explains_a_field_it_leaves_blank() -> None:
    """A blank box with no explanation reads as one the user forgot to fill.
    The hint must also be a CATALOG string, or it ships in English on a Chinese
    form -- the ESQ1-259 failure."""
    from dataclasses import asdict

    from runtime_contracts.builder.copy_ids import BuilderCopyId
    from runtime_contracts.builder.presentation import copy_text

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

    assert out["values"]["bocha_api_key"] == ""
    assert out["fields"][0]["hint_copy"]
    assert out["fields"][0]["hint_copy"] == asdict(
        copy_text(BuilderCopyId.REPLIES_NOT_STATED_IN_YOUR_REQUEST_ADD_IT_IF_YOU_HAVE_ONE)
    )


def test_analyze_goal_does_not_explain_a_field_that_has_a_value() -> None:
    """Only a blank needs explaining; hinting every field is noise."""
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "report_title", "label": "报告标题", "type": "text"}],
                    "values": {"report_title": "需求调研报告"},
                }
            )
        ]
    )

    out = build.analyze_goal(m, _PM_GOAL)

    assert not out["fields"][0].get("hint")


def test_planner_describes_only_first_phase_nodes_to_the_model() -> None:
    model = _FakeInstance([_plan_reply(["code node: process", "end node: return"])])

    assert build.propose_plan_v1(model, {})

    system = model.calls[0][0][0].get_text_content()
    assert '"knowledge-retrieval"' not in system
    assert '"human-input"' not in system
    assert '"code"' in system
    assert '"list-operator"' in system


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
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
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


@pytest.mark.usefixtures("installed_tools")
def test_discovery_with_no_model_signal_still_recommends_nothing() -> None:
    model = _FakeInstance([json.dumps({"resource_ids": []})])

    assert build.discover_resources(model, TENANT_ID, ["tool node posts to chat"]) == []


def test_planner_sees_relevant_installed_tools_including_delayed_setup_beyond_the_old_name_cap(
    installed_tools: tuple[FakeToolDaemon, list[str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    _daemon, forbidden = installed_tools
    captured = {}

    def fake_invoke_text(model: object, *, system: str, user: str, **kw: object) -> str:  # noqa: ARG001
        captured["system"] = system
        return _plan_reply(["tool node pages the on-call responders"])

    monkeypatch.setattr(build.llm, "invoke_text", fake_invoke_text)
    agent = LlmBuilderAgent(TENANT_ID, {})
    monkeypatch.setattr(agent, "_model", lambda: _FakeInstance([]))

    agent.propose_plan_v1({"severity": "high"}, goal_text="Page the on-call responders when an incident opens.")

    system = captured["system"]
    section = system.split("# Installed tools you may name", 1)[1]
    listed = [line for line in section.splitlines() if line.startswith("- ")]
    assert _PAGER_OPEN in section
    # Installation is enough to plan a draft; setup remains a later admission check.
    assert _PAGER_PLUS in section
    assert "setup" in section.lower()
    assert _HUDDLE_POST not in section
    assert 0 < len(listed) <= build._MAX_PLANNER_TOOLS
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

_LONG_DESCRIPTION = "Send a richly formatted message to a team chat channel. " * 12


@pytest.mark.parametrize(
    ("drop_credential_table", "expected_note"),
    [
        (False, resources.SETUP_REQUIRED_NOTE),
        (True, resources.AUTHORIZATION_UNVERIFIED_NOTE),
    ],
)
def test_discovery_prompt_keeps_the_readiness_reason_for_a_long_description(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, drop_credential_table: bool, expected_note: object
) -> None:
    from sqlalchemy import text

    bind_database(monkeypatch, sqlite_engine)
    install_fake_daemon(
        monkeypatch,
        FakeToolDaemon(
            providers_by_tenant={
                TENANT_ID: [
                    provider_payload(
                        "acme/huddle",
                        "huddle",
                        [FakeTool(name="post", label="Post", description=_LONG_DESCRIPTION)],
                        needs_credentials=True,
                    )
                ]
            }
        ),
    )
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    if drop_credential_table:
        with sqlite_engine.begin() as connection:
            connection.execute(text("DROP TABLE tool_builtin_providers"))
    model = _FakeInstance([json.dumps({"resource_ids": [_HUDDLE_POST]})])

    build.discover_resources(model, TENANT_ID, ["tool node posts to the team chat channel"], account_id=ACCOUNT_A)

    user = model.calls[0][0][1].get_text_content()
    huddle_lines = [line for line in user.splitlines() if _HUDDLE_POST in line]
    assert len(huddle_lines) == 1
    assert "missing_config" in huddle_lines[0]
    assert expected_note in huddle_lines[0]


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
        assert result is not None
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

    def test_outline_system_distinguishes_mutation_from_a_published_constant(self) -> None:
        messages = self._outline_messages()

        self._assert_constant_rules(messages[0].get_text_content())

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

    def test_gap_system_receives_native_workflow_vocabulary_with_no_selected_external_resources(self) -> None:
        system, user = self._gap_messages()

        for node_type in ("start", "http-request", "if-else", "template-transform", "assigner", "end"):
            assert f'"{node_type}"' in system.get_text_content()
        assert "selected external resources" in system.get_text_content().lower()
        assert "native" in system.get_text_content().lower()
        assert "- (none)" in user.get_text_content()

    def test_gap_system_distinguishes_mutation_from_a_published_constant(self) -> None:
        messages = self._gap_messages()

        self._assert_constant_rules(messages[0].get_text_content())

    @pytest.mark.parametrize("readiness", [None, "ready", "missing_config"])
    def test_gap_keeps_source_and_external_resource_readiness_in_user_message(self, readiness: None | str) -> None:
        from core.dify_builder.contract import ResourceOption

        option = (
            None
            if readiness is None
            else ResourceOption(
                id="USER_SELECTED_TOOL_73", label="USER_SELECTED_LABEL_73", meta="", kind="plugin", readiness=readiness
            )
        )
        system, user = self._gap_messages(option)

        assert user.get_text_content().startswith(
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
        if option is not None:
            assert f"{option.id} (plugin, {readiness}): {option.label}" in user.get_text_content()
            assert option.id not in system.get_text_content()
            assert option.label not in system.get_text_content()

    def test_gap_system_preserves_explicit_named_tool_model_and_new_agent_constraints(self) -> None:
        goal = (
            "Use Tool USER_NAMED_TOOL_91 with model USER_NAMED_MODEL_91 and NewAgent USER_NAMED_AGENT_91. "
            "Preserve these exact identities; do not replace them with an HTTP fallback."
        )
        model = _FakeInstance(['{"gap":"The explicitly requested identities still require matching resources."}'])
        result = build.assess_capability_gap(
            model,
            ["Tool USER_NAMED_TOOL_91 executes through NewAgent USER_NAMED_AGENT_91"],
            [],
            goal_text=goal,
            requirements={"model_id": "USER_NAMED_MODEL_91"},
        )
        assert result == "The explicitly requested identities still require matching resources."
        assert len(model.calls) == 1
        system, user = model.calls[0][0]
        for value in ("USER_NAMED_TOOL_91", "USER_NAMED_MODEL_91", "USER_NAMED_AGENT_91"):
            assert value in user.get_text_content()
            assert value not in system.get_text_content()
        assert "explicitly requested named Tool, model, or NewAgent" in system.get_text_content()
        assert "do not silently substitute" in system.get_text_content()

    def test_gap_system_separates_native_draft_coverage_from_runtime_admission(self) -> None:
        system, _ = self._gap_messages()

        assert "does not grant runtime admission" in system.get_text_content()
        assert "network access" in system.get_text_content()
        assert "authorization" in system.get_text_content()
        assert "credential readiness" in system.get_text_content()

    def test_gap_system_treats_absent_named_candidates_as_unconfirmed_external_inventory(self) -> None:
        goal = (
            "Use Tool USER_NAMED_TOOL_104 through NewAgent USER_NAMED_AGENT_104 "
            "with model USER_NAMED_MODEL_104. Preserve the requested identities."
        )
        gap = "Recommendation coverage for the selected binding is unconfirmed."
        model = _FakeInstance([json.dumps({"gap": gap})])

        result = build.assess_capability_gap(
            model,
            ["Tool USER_NAMED_TOOL_104 executes through NewAgent USER_NAMED_AGENT_104"],
            [],
            goal_text=goal,
            requirements={"model_id": "USER_NAMED_MODEL_104"},
        )

        assert result == gap
        assert len(model.calls) == 1
        system, user = model.calls[0][0]
        assert "- (none)" in user.get_text_content()
        for value in ("USER_NAMED_TOOL_104", "USER_NAMED_MODEL_104", "USER_NAMED_AGENT_104"):
            assert value in user.get_text_content()
            assert value not in system.get_text_content()
        assert "non-exhaustive subset" in system.get_text_content()
        assert "not the complete workspace inventory" in system.get_text_content()
        assert "recommendation/binding coverage is unconfirmed" in system.get_text_content()
        assert (
            "does not establish that the resource is uninstalled, unavailable, or permission denied"
            in system.get_text_content()
        )


def test_plan_distinguishes_stop_on_error_from_diagnostic_output() -> None:
    """Removing the native-failure rule must not leave a marker-only plan contract."""
    model = _FakeInstance([_plan_reply(["code node sends the POST and stops on failure"])])
    requirements = {"error_status_value": 0, "continue_on_post_failure": False, "health_success_status": 404}

    plan = build.propose_plan_v1(model, requirements, goal_text="POST the receipt, then fetch health")

    assert plan is not None
    messages = model.calls[0][0]
    user = messages[1].get_text_content()
    assert json.loads(user.split("CONFIRMED REQUIREMENTS:\n", 1)[1]) == requirements
    system = messages[0].get_text_content()
    assert "stop-on-error" in system
    assert "raise" in system
    assert "diagnostic" in system
    assert "error_strategy" in system
