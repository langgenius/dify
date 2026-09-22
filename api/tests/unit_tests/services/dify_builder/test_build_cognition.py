import json

import pytest

from services.dify_builder.agent import build, resources


class _Msg:
    def __init__(self, t):
        self._t = t

    def get_text_content(self):
        return self._t


class _Result:
    def __init__(self, t):
        self.message = _Msg(t)


class _FakeInstance:
    def __init__(self, replies):
        self._r = list(replies)

    def invoke_llm(self, *, prompt_messages, model_parameters=None, stop=None, stream=True, **kw):  # noqa: ARG002
        return _Result(self._r.pop(0))


class _BoomInstance:
    def invoke_llm(self, *, prompt_messages, model_parameters=None, stop=None, stream=True, **kw):  # noqa: ARG002
        raise RuntimeError("provider down")


def test_analyze_goal_returns_fields_and_values():
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


def test_analyze_goal_reconciles_field_type_with_value():
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


def test_analyze_goal_degrades_to_generic_field_on_none():
    out = build.analyze_goal(None, "some goal")
    assert out["fields"]
    assert out["fields"][0]["type"] == "textarea"
    assert out["values"].get(out["fields"][0]["key"]) == "some goal"


def test_analyze_goal_degrades_to_generic_field_on_boom():
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


def test_scrub_invented_defaults_blanks_the_real_s5b_invented_endpoint_and_credential():
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


def test_scrub_invented_defaults_blanks_a_plausible_invented_host():
    values = {"render_api_url": "https://api.pptrender.io/v1/render"}

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out["render_api_url"] == ""


def test_scrub_invented_defaults_keeps_a_url_whose_host_the_goal_names():
    goal = "POST the finished slides to https://render.acme.internal/v2 and return the link"
    values = {"render_api_url": "https://render.acme.internal/v2/pptx"}

    out = build._scrub_invented_defaults(values, goal)

    assert out["render_api_url"] == "https://render.acme.internal/v2/pptx"


def test_scrub_invented_defaults_keeps_a_credential_the_goal_states():
    goal = "Authenticate with the API key sk-live-abc123"
    values = {"api_key": "sk-live-abc123"}

    out = build._scrub_invented_defaults(values, goal)

    assert out["api_key"] == "sk-live-abc123"


def test_scrub_invented_defaults_blanks_a_credential_the_goal_does_not_state():
    values = {"api_key": "sk-live-abc123"}

    out = build._scrub_invented_defaults(values, _S5B_GOAL)

    assert out["api_key"] == ""


def test_analyze_goal_scrubs_invented_defaults_end_to_end(monkeypatch):
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

    def fake_invoke_json(model, *, system, user, on_reasoning=None):  # noqa: ARG001
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


def test_propose_plan_v1_returns_bullets():
    m = _FakeInstance([json.dumps({"plan": ["Ingest", "Summarize", "Emit"]})])
    assert build.propose_plan_v1(m, {"x": 1}) == ["Ingest", "Summarize", "Emit"]


def test_propose_plan_v1_degrades_on_none():
    out = build.propose_plan_v1(None, {})
    assert out == ["Ingest the input", "Process with an LLM", "Emit the result"]


def test_propose_plan_v1_degrades_on_boom():
    m = _BoomInstance()
    out = build.propose_plan_v1(m, {})
    assert out == ["Ingest the input", "Process with an LLM", "Emit the result"]


def test_discover_resources_grounds_real_ids(monkeypatch):
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
            models=[], datasets=[resources.ResourceRef(id="kb-1", label="Company KB")], tools=[]
        ),
    )
    m = _FakeInstance([json.dumps({"resource_ids": ["kb-1"]})])
    opts = build.discover_resources(m, "t1", ["Retrieve knowledge"])
    assert opts[0].id == "kb-1"
    assert opts[0].kind == "knowledge"


def _stub_inventory(monkeypatch, *, datasets=(), models=(), tools=()):
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda _t: resources.TenantResources(models=list(models), datasets=list(datasets), tools=list(tools)),
    )


def test_discover_resources_recommends_nothing_when_the_call_fails(monkeypatch):
    # Previously degraded to the whole inventory, which the client pre-checks
    # and submits by default -- binding resources nobody chose.
    _stub_inventory(monkeypatch, datasets=[resources.ResourceRef(id="kb-1", label="Company KB")])

    assert build.discover_resources(_BoomInstance(), "t1", ["Retrieve knowledge"]) == []


def test_discover_resources_recommends_nothing_without_a_model(monkeypatch):
    # A degraded agent has no signal at all, so it must not claim a recommendation.
    _stub_inventory(monkeypatch, datasets=[resources.ResourceRef(id="kb-1", label="Company KB")])

    assert build.discover_resources(None, "t1", ["Retrieve knowledge"]) == []


def test_discover_resources_never_falls_back_to_the_whole_inventory(monkeypatch):
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


def test_discover_resources_keeps_only_ids_the_model_actually_picked(monkeypatch):
    _stub_inventory(
        monkeypatch,
        datasets=[resources.ResourceRef(id=f"kb-{i}", label=f"KB {i}") for i in range(20)],
    )
    m = _FakeInstance([json.dumps({"resource_ids": ["kb-3", "not-in-catalog"]})])

    opts = build.discover_resources(m, "t1", ["Retrieve knowledge"])

    assert [o.id for o in opts] == ["kb-3"]


def test_discover_resources_shows_the_model_each_options_readiness(monkeypatch):
    captured = {}

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
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


def test_gap_system_defines_missing_config():
    # The gap-checker's system prompt must define what missing_config means --
    # installed but not authorized, i.e. not usable -- not just show the raw
    # label with no basis for the model to treat it as unavailable.
    assert "missing_config" in build._GAP_SYSTEM


def test_assess_capability_gap_names_the_gap_in_plain_words():
    m = _FakeInstance([json.dumps({"gap": "Nothing installed can send email."})])
    assert build.assess_capability_gap(m, ["Email the manager"], []) == "Nothing installed can send email."


def test_assess_capability_gap_reports_no_gap_when_the_plan_is_covered():
    m = _FakeInstance([json.dumps({"gap": ""})])
    assert build.assess_capability_gap(m, ["Summarize text"], []) == ""


def test_assess_capability_gap_reports_no_gap_without_a_model():
    # A gap we cannot assess is not a gap -- inventing one would block a build
    # that might be fine.
    assert build.assess_capability_gap(None, ["Email the manager"], []) == ""


def test_assess_capability_gap_reports_no_gap_on_model_failure():
    m = _BoomInstance()
    assert build.assess_capability_gap(m, ["Email the manager"], []) == ""


def test_assess_capability_gap_reports_no_gap_for_an_empty_plan():
    m = _FakeInstance([json.dumps({"gap": "should never be read"})])
    assert build.assess_capability_gap(m, [], []) == ""


def test_assess_capability_gap_reports_no_gap_on_unparseable_reply():
    m = _FakeInstance([json.dumps({"gap": 42})])
    assert build.assess_capability_gap(m, ["Email the manager"], []) == ""


def test_assess_capability_gap_shows_the_model_each_option_and_its_readiness(monkeypatch):
    from core.dify_builder.contract import ResourceOption

    captured = {}

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
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


def test_bind_resources_names_bound_label(monkeypatch):
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
            models=[], datasets=[resources.ResourceRef(id="kb-1", label="Company KB")], tools=[]
        ),
    )
    out = build.bind_resources(None, "t1", ["Retrieve knowledge"], ["kb-1"])
    assert any("Company KB" in item for item in out)


def test_bind_resources_binds_each_resource_to_the_step_it_covers(monkeypatch):
    """bind_resources appended "(using ...)" to the LAST plan item -- in the
    ESQ1-302 session that was the end node step. Each resource now lands on
    the step it covers; the last step is only the fallback. A model's label is
    its full ``provider/model`` id (``resources.list_tenant_resources``)."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
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
    assert out[2] == plan[2] + " (using Company KB)"
    assert out[3] == plan[3] + " (using Markdown ⮕ PPTX [bowenliang123/md_exporter/md_exporter/md_to_pptx])"
    assert out[4] == plan[4]


def test_bind_resources_binds_each_tool_to_the_step_naming_its_id(monkeypatch):
    """The planner is told to name a tool by its id (``_planner_tool_section``),
    but binding matched only the LABEL, then the "tool" keyword -- so with two
    tool steps naming ids, BOTH tools bound to the first tool step."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
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
def test_bind_resources_tool_suffix_carries_the_id_the_generator_pins_on(monkeypatch, tool_step):
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
        lambda t: resources.TenantResources(  # noqa: ARG005
            models=[],
            datasets=[],
            tools=[
                resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")
            ],
        ),
    )
    entries = [
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


def test_bind_resources_names_the_tool_id_on_an_empty_plan_too(monkeypatch):
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
            models=[],
            datasets=[],
            tools=[
                resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")
            ],
        ),
    )

    out = build.bind_resources(None, "t1", [], ["bowenliang123/md_exporter/md_exporter/md_to_pptx"])

    assert out == ["Use Markdown ⮕ PPTX [bowenliang123/md_exporter/md_exporter/md_to_pptx]"]


def test_bind_resources_keeps_models_and_knowledge_label_only(monkeypatch):
    """Only a tool is pinned by id; a model's label already IS its full id and
    a dataset is grounded by its name (``_ground``), so neither gets brackets."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
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
    assert out[1] == plan[1] + " (using Company KB)"
    assert "[" not in out[0]
    assert "[" not in out[1]


def test_bind_resources_falls_back_to_the_last_step_when_nothing_matches(monkeypatch):
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
            models=[], datasets=[], tools=[resources.ResourceRef(id="p/t", label="Some Tool")]
        ),
    )

    out = build.bind_resources(None, "t1", ["start node: inputs", "end node: output"], ["p/t"])

    assert out == ["start node: inputs", "end node: output (using Some Tool [p/t])"]


def test_bind_resources_rebind_with_the_same_selection_is_idempotent(monkeypatch):
    """A loop-back re-bind must strip the previous suffix, bracketed tool id
    and all (``_TRAILING_USING_SUFFIX`` excludes only parentheses, so the
    ``[provider/tool]`` part is stripped with it) -- not pile a second one on."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
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


def test_bind_resources_rebind_with_a_changed_selection_drops_the_deselected_label(monkeypatch):
    """A loop-back (build.review / build.reverted -> re-walk resources ->
    approve_plan) feeds the already-bound plan back into bind_resources. The
    old, purely-additive binder kept a deselected resource's suffix and piled
    the new one on top of it -- that accumulated text is what the generator
    is handed."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
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


def test_bind_resources_cleans_an_old_aggregate_suffix_before_rebinding(monkeypatch):
    """A plan bound by the pre-Task-4 binder (every label appended to the
    LAST step) loops back in; its stale aggregate suffix must not survive
    into the re-bind, and must not be mistaken for the step's own content."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(  # noqa: ARG005
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


def test_covering_step_tool_keyword_does_not_match_a_toolkit_substring():
    # "toolkit" contains "tool" as a raw substring -- a plugin must not bind
    # there when an actual tool step exists further down the plan.
    plan = ["code node: build a toolkit summary string", "tool node: send a slack notification"]

    assert build._covering_step(plan, "plugin", resources.ResourceRef(id="p/slack", label="Slack Notifier")) == 1


def test_covering_step_llm_keyword_does_not_match_a_fulfillment_substring():
    # "fulfillment" contains "llm" as a raw substring -- a model must not
    # bind there; with no real "llm"/"question-classifier"/
    # "parameter-extractor" step present, this falls through to -1 (the
    # caller's fallback then applies).
    plan = ["step: order fulfillment notes", "end node: wrap up"]

    assert build._covering_step(plan, "model", resources.ResourceRef(id="openai/gpt-5", label="openai/gpt-5")) == -1


def test_covering_step_still_matches_llm_in_cjk_step_text():
    plan = ["start节点：输入", "llm节点：总结", "end节点：输出"]

    assert build._covering_step(plan, "model", resources.ResourceRef(id="p/some-model", label="p/some-model")) == 1


def test_covering_step_prefers_the_step_naming_the_resource_id_over_the_kind_keyword():
    plan = [
        "tool节点：使用 bowenliang123/md_exporter/md_exporter/md_to_pptx 生成PPT",
        "tool节点：使用 langgenius/google/google/google_search 搜索资料",
    ]
    ref = resources.ResourceRef(id="langgenius/google/google/google_search", label="Google Search")

    assert build._covering_step(plan, "plugin", ref) == 1


def test_learn_from_build_degrades_to_generic():
    assert isinstance(build.learn_from_build(None, "g", {}, ["p"], ["n"]), str)


def test_learn_from_build_degrades_on_boom():
    m = _BoomInstance()
    out = build.learn_from_build(m, "some goal", {}, ["plan"], ["node1"])
    assert isinstance(out, str)
    assert "1-node workflow" in out


def test_plan_prompt_carries_the_node_vocabulary(monkeypatch):
    """ESQ1-279: the Builder's own planner had NO node vocabulary, so it
    planned in business language ("Send a Feishu notification") and the
    generator was then asked to map steps onto nodes that do not exist."""
    captured = {}

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        captured["system"] = system
        captured["user"] = user
        return {"plan": ["Start node collects the review list"]}

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)
    build.propose_plan_v1(_FakeInstance([]), {"goal": "summarise reviews"})

    system = captured["system"]
    # the vocabulary is present, and is the shared constant
    assert build._DIFY_NODE_VOCABULARY in system
    # a representative spread of node types the planner may use
    for node_type in ("start", "end", "llm", "iteration", "tool", "if-else", "document-extractor"):
        assert f'"{node_type}"' in system, f"missing node type {node_type}"
    # and it is told to plan ONLY in these terms
    assert "only" in system.lower()


def test_plan_prompt_names_capabilities_dify_lacks(monkeypatch):
    """The failure mode is inventing steps Dify has no node for. Name the
    common ones explicitly so the model routes them instead of inventing."""
    captured = {}

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        captured["system"] = system
        return {"plan": ["step"]}

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)
    build.propose_plan_v1(_FakeInstance([]), {})

    lowered = captured["system"].lower()
    assert "schedul" in lowered  # no timer/trigger node exists
    assert "tool" in lowered  # third-party sends go through a tool node


def test_plan_prompt_still_requests_json_and_language(monkeypatch):
    """Regression guard: the JSON contract and the reply-language instruction
    must survive the rewrite -- invoke_json parses {"plan": [...]} and the
    Builder replies in the user's language."""
    captured = {}

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        captured["system"] = system
        return {"plan": ["step"]}

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)
    build.propose_plan_v1(_FakeInstance([]), {})

    assert '{"plan": ["step", ...]}' in captured["system"]
    assert build.llm.json_language_instruction("plan steps") in captured["system"]


def test_topology_directive_keeps_the_workflow_rules():
    """Regression guard: the original topology contract must survive. This
    directive is why workflow mode never gets 'answer' nodes."""
    d = build._WORKFLOW_TOPOLOGY_DIRECTIVE
    assert "'start'" in d
    assert "'end'" in d
    assert "answer" in d


def test_topology_directive_carries_node_usage_guidance():
    """Meeting item 9, tier 2: usage detail rides the Builder-only prepend."""
    d = build._WORKFLOW_TOPOLOGY_DIRECTIVE
    lowered = d.lower()
    # the config mistakes that actually broke real builds
    assert "document-extractor" in lowered  # needs a file input
    assert "iteration" in lowered  # children belong inside the container
    assert "variable" in lowered  # reference only declared outputs


def test_topology_directive_does_not_restate_the_whitelist():
    """The generator's SHARED system prompt already lists every node type.
    Restating it here burns planner output budget for nothing (see ESQ1-300)."""
    assert build._DIFY_NODE_VOCABULARY not in build._WORKFLOW_TOPOLOGY_DIRECTIVE


def test_build_nodes_sends_the_directive_to_the_generator(monkeypatch):
    """The directive is only worth anything if it actually reaches the
    generator ahead of the plan items."""
    seen = {}

    class _FakeGen:
        @staticmethod
        def generate_workflow_graph(
            *,
            tenant_id,  # noqa: ARG004
            mode,  # noqa: ARG004
            instruction,
            model_config,  # noqa: ARG004
            current_graph,  # noqa: ARG004
        ):
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

    build.build_nodes(tenant_id="t1", model_config={}, plan_items=["llm node drafts a reply"])

    instruction = seen["instruction"]
    assert instruction.startswith(build._WORKFLOW_TOPOLOGY_DIRECTIVE)
    assert "llm node drafts a reply" in instruction


# ---- ESQ1-302: tool grounding ------------------------------------------------


def test_topology_directive_no_longer_steers_away_from_installed_tools():
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


def test_ready_tool_catalogue_lists_only_ready_tools_and_is_capped(monkeypatch):
    tools = [resources.ResourceRef(id=f"p/t{i}", label=f"Tool {i}") for i in range(60)]
    tools.append(resources.ResourceRef(id="p/nope", label="Nope", readiness="missing_config"))
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda t: resources.TenantResources(models=[], datasets=[], tools=tools),  # noqa: ARG005
    )

    out = build.ready_tool_catalogue("t1")

    assert len(out) == build._MAX_PLANNER_TOOLS
    assert all(t.readiness == "ready" for t in out)
    assert all(t.id != "p/nope" for t in out)


def test_ready_tool_catalogue_degrades_to_empty_when_the_listing_fails(monkeypatch):
    def boom(_tenant_id):
        raise RuntimeError("plugin daemon down")

    monkeypatch.setattr(build.resources, "list_tenant_resources", boom)

    assert build.ready_tool_catalogue("t1") == []


def test_plan_prompt_names_the_ready_tools_it_may_use(monkeypatch):
    """The ESQ1-302 tenant had a ready 'Markdown ⮕ PPTX' tool. Its plan still
    said "http-request节点：调用外部PPT生成API" because propose_plan_v1 was shown
    REQUIREMENTS only -- it could not name a tool it had never seen."""
    captured = {}

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        captured["system"] = system
        return {"plan": ["tool node converts the outline to a PPTX"]}

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)
    tools = [resources.ResourceRef(id="bowenliang123/md_exporter/md_exporter/md_to_pptx", label="Markdown ⮕ PPTX")]

    build.propose_plan_v1(_FakeInstance([]), {"goal": "make a deck"}, tools=tools)

    system = captured["system"]
    assert "bowenliang123/md_exporter/md_exporter/md_to_pptx" in system
    assert "Markdown ⮕ PPTX" in system
    assert "installed tools" in system.lower()
    # http-request survives, but only for an endpoint the user actually supplied
    assert "http-request" in system
    assert "invent" in system.lower()
    # the generator pins a tool only on its id as a whole word -- an id glued
    # to CJK text ("使用bowenliang123/...") does not pin
    assert "exactly as listed" in system
    assert "separate word" in system


def test_plan_prompt_without_tools_has_no_tool_section(monkeypatch):
    captured = {}

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        captured["system"] = system
        return {"plan": ["step"]}

    monkeypatch.setattr(build.llm, "invoke_json", fake_invoke_json)

    build.propose_plan_v1(_FakeInstance([]), {})

    assert "# Installed tools" not in captured["system"]
