import json

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
