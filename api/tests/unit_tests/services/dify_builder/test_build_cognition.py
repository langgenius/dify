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
    m = _FakeInstance([json.dumps({
        "fields": [{"key": "categories", "label": "Categories", "type": "text"}],
        "values": {"categories": "billing"},
    })])
    out = build.analyze_goal(m, "triage tickets")
    assert out["fields"][0]["key"] == "categories"
    assert out["values"] == {"categories": "billing"}


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
    monkeypatch.setattr(build.resources, "list_tenant_resources", lambda t: resources.TenantResources(  # noqa: ARG005
        models=[], datasets=[resources.ResourceRef(id="kb-1", label="Company KB")], tools=[]))
    m = _FakeInstance([json.dumps({"resource_ids": ["kb-1"]})])
    opts = build.discover_resources(m, "t1", ["Retrieve knowledge"])
    assert opts[0].id == "kb-1"
    assert opts[0].kind == "knowledge"


def test_discover_resources_degrades_on_boom(monkeypatch):
    monkeypatch.setattr(build.resources, "list_tenant_resources", lambda t: resources.TenantResources(  # noqa: ARG005
        models=[], datasets=[resources.ResourceRef(id="kb-1", label="Company KB")], tools=[]))
    m = _BoomInstance()
    opts = build.discover_resources(m, "t1", ["Retrieve knowledge"])
    assert len(opts) == 1
    assert opts[0].id == "kb-1"
    assert opts[0].kind == "knowledge"


def test_bind_resources_names_bound_label(monkeypatch):
    monkeypatch.setattr(build.resources, "list_tenant_resources", lambda t: resources.TenantResources(  # noqa: ARG005
        models=[], datasets=[resources.ResourceRef(id="kb-1", label="Company KB")], tools=[]))
    out = build.bind_resources(None, "t1", ["Retrieve knowledge"], ["kb-1"], "audited")
    assert any("Company KB" in item for item in out)


def test_learn_from_build_degrades_to_generic():
    assert isinstance(build.learn_from_build(None, "g", {}, ["p"], ["n"]), str)


def test_learn_from_build_degrades_on_boom():
    m = _BoomInstance()
    out = build.learn_from_build(m, "some goal", {}, ["plan"], ["node1"])
    assert isinstance(out, str)
    assert "1-node workflow" in out
