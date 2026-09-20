import logging
from unittest.mock import patch


def test_list_tenant_resources_normalizes_all_three_kinds():
    from services.dify_builder.agent import resources

    class _Model:
        def __init__(self, m): self.model = m

    class _ProvResp:
        def __init__(self, p, ms): self.provider, self.models = p, [_Model(m) for m in ms]

    class _DS:
        def __init__(self, i, n): self.id, self.name = i, n

    tool_record = {
        "provider_name": "google", "tool_name": "search",
        "tool_label": "Google Search", "description": "",
    }
    with patch.object(resources, "_list_models", return_value=[_ProvResp("anthropic", ["claude-opus-4-8"])]), \
         patch.object(resources, "_list_datasets", return_value=[_DS("kb-1", "Company KB")]), \
         patch.object(resources, "_list_tools", return_value=[tool_record]):
        out = resources.list_tenant_resources("t1")

    assert out.models[0].id == "anthropic/claude-opus-4-8"
    assert out.datasets[0].id == "kb-1"
    assert out.datasets[0].label == "Company KB"
    assert out.tools[0].id == "google/search"
    assert out.tools[0].label == "Google Search"


def test_each_source_degrades_to_empty():
    from services.dify_builder.agent import resources
    with patch.object(resources, "_list_models", side_effect=RuntimeError("boom")), \
         patch.object(resources, "_list_datasets", side_effect=RuntimeError("boom")), \
         patch.object(resources, "_list_tools", side_effect=RuntimeError("boom")):
        out = resources.list_tenant_resources("t1")
    assert out == resources.TenantResources(models=[], datasets=[], tools=[])


def test_mixed_failure_partial_success():
    from services.dify_builder.agent import resources

    class _DS:
        def __init__(self, i, n): self.id, self.name = i, n

    tool_record = {
        "provider_name": "google", "tool_name": "search",
        "tool_label": "Google Search", "description": "",
    }
    with patch.object(resources, "_list_models", side_effect=RuntimeError("boom")), \
         patch.object(resources, "_list_datasets", return_value=[_DS("kb-1", "Company KB")]), \
         patch.object(resources, "_list_tools", return_value=[tool_record]):
        out = resources.list_tenant_resources("t1")

    assert out.models == []
    assert len(out.datasets) == 1
    assert out.datasets[0].id == "kb-1"
    assert len(out.tools) == 1
    assert out.tools[0].id == "google/search"


def test_malformed_tool_record_degrades():
    from services.dify_builder.agent import resources

    with patch.object(resources, "_list_models", return_value=[]), \
         patch.object(resources, "_list_datasets", return_value=[]), \
         patch.object(resources, "_list_tools", return_value=[{"provider_name": "g"}]):  # missing tool_name
        out = resources.list_tenant_resources("t1")

    assert out.tools == []
    assert out.models == []
    assert out.datasets == []


def test_an_unauthorized_tool_is_reported_as_missing_config(monkeypatch):
    """Recommending an unusable tool is how a build fails at test time."""
    from services.dify_builder.agent import resources

    monkeypatch.setattr(
        resources,
        "_list_tools",
        lambda _t: [
            {
                "provider_name": "gmail",
                "tool_name": "send",
                "tool_label": "Send",
                "description": "",
                "needs_credentials": True,
            }
        ],
    )
    monkeypatch.setattr(resources, "_authorized_providers", lambda _t: set())
    inv = resources.list_tenant_resources("t1")
    assert inv.tools[0].readiness == "missing_config"


def test_a_tool_needing_no_credentials_is_ready(monkeypatch):
    from services.dify_builder.agent import resources

    monkeypatch.setattr(
        resources,
        "_list_tools",
        lambda _t: [
            {
                "provider_name": "time",
                "tool_name": "now",
                "tool_label": "Now",
                "description": "",
                "needs_credentials": False,
            }
        ],
    )
    monkeypatch.setattr(resources, "_authorized_providers", lambda _t: set())
    assert resources.list_tenant_resources("t1").tools[0].readiness == "ready"


def test_an_authorized_tool_is_ready(monkeypatch):
    from services.dify_builder.agent import resources

    monkeypatch.setattr(
        resources,
        "_list_tools",
        lambda _t: [
            {
                "provider_name": "gmail",
                "tool_name": "send",
                "tool_label": "Send",
                "description": "",
                "needs_credentials": True,
            }
        ],
    )
    monkeypatch.setattr(resources, "_authorized_providers", lambda _t: {"gmail"})
    assert resources.list_tenant_resources("t1").tools[0].readiness == "ready"


def test_authorization_lookup_failure_fails_open_to_ready(caplog):
    """A transient failure of the credential query must not mass-label every
    credentialed tool "missing_config" -- that would hide tools the tenant
    genuinely has configured. It degrades to "ready" (unchecked), same as
    before this readiness check existed.
    """
    from services.dify_builder.agent import resources

    def _boom(_t):
        raise RuntimeError("db down")

    with patch.object(resources, "_list_models", return_value=[]), \
         patch.object(resources, "_list_datasets", return_value=[]), \
         patch.object(
             resources,
             "_list_tools",
             return_value=[
                 {
                     "provider_name": "gmail",
                     "tool_name": "send",
                     "tool_label": "Send",
                     "description": "",
                     "needs_credentials": True,
                 }
             ],
         ), \
         patch.object(resources, "_authorized_providers", _boom), \
         caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.resources"):
        out = resources.list_tenant_resources("t1")

    assert out.tools[0].readiness == "ready"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "authorization" in warnings[0].getMessage()


def test_list_tenant_resources_logs_when_a_source_fails(caplog):
    from services.dify_builder.agent import resources

    class _Model:
        def __init__(self, m):
            self.model = m

    class _ProvResp:
        def __init__(self, p, ms):
            self.provider, self.models = p, [_Model(m) for m in ms]

    with patch.object(resources, "_list_models", return_value=[_ProvResp("anthropic", ["claude-opus-4-8"])]), \
         patch.object(resources, "_list_datasets", side_effect=RuntimeError("db down")), \
         patch.object(resources, "_list_tools", return_value=[]), \
         caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.resources"):
        out = resources.list_tenant_resources("t1")

    assert out.datasets == []
    assert out.models[0].id == "anthropic/claude-opus-4-8"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "datasets" in warnings[0].getMessage()
    assert warnings[0].exc_info is not None
