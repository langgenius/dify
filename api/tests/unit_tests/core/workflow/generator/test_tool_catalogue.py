"""Unit tests for the tool catalogue helpers."""

from types import SimpleNamespace
from unittest.mock import patch

from core.workflow.generator.tool_catalogue import (
    ToolCatalogueEntry,
    _i18n_text,
    _tool_description,
    build_tool_catalogue,
    format_tool_catalogue,
    installed_tool_keys,
)


def _entry(provider: str, tool: str, *, label: str = "", description: str = "") -> ToolCatalogueEntry:
    return ToolCatalogueEntry(
        provider_name=provider,
        provider_type="builtin",
        plugin_id="",
        tool_name=tool,
        tool_label=label,
        description=description,
    )


class TestInstalledToolKeys:
    """The validator in ``runner.py`` looks up tool nodes against this set.

    Keys MUST be ``(provider_name, tool_name)`` tuples — the builder prompt
    is instructed to put ``provider_name`` into both ``data.provider_id``
    and ``data.provider_name`` on tool nodes, so the runner's check accepts
    either field. The set therefore keys on ``provider_name``, not
    ``plugin_id`` or any other identifier.
    """

    def test_empty_input_returns_empty_set(self):
        assert installed_tool_keys([]) == set()

    def test_returns_provider_tool_tuples(self):
        keys = installed_tool_keys(
            [
                _entry("google", "search"),
                _entry("github", "list_issues"),
            ]
        )
        assert keys == {("google", "search"), ("github", "list_issues")}

    def test_dedupes_duplicate_entries(self):
        # Defensive — the catalogue builder dedupes on read, but a duplicate
        # entry slipping through should collapse rather than break the set
        # type contract.
        keys = installed_tool_keys([_entry("x", "y"), _entry("x", "y")])
        assert keys == {("x", "y")}


class TestFormatToolCatalogue:
    def test_empty_input_returns_empty_string(self):
        assert format_tool_catalogue([]) == ""

    def test_renders_provider_slash_tool_per_line(self):
        out = format_tool_catalogue(
            [
                _entry("google", "search", description="Search the web with Google."),
                _entry("time", "current_time", description="Return the current time."),
            ]
        )
        lines = out.split("\n")
        assert lines == [
            "- google/search — Search the web with Google.",
            "- time/current_time — Return the current time.",
        ]

    def test_includes_label_when_different_from_tool_name(self):
        out = format_tool_catalogue(
            [
                _entry("google", "search", label="Google Search", description="Search."),
            ]
        )
        assert out == "- google/search (Google Search) — Search."

    def test_omits_label_when_identical_to_tool_name(self):
        out = format_tool_catalogue(
            [
                _entry("time", "current_time", label="current_time", description="Now."),
            ]
        )
        assert out == "- time/current_time — Now."

    def test_truncates_long_descriptions(self):
        long_desc = "x" * 200
        out = format_tool_catalogue([_entry("p", "t", description=long_desc)])
        # Truncated to 117 chars + "..."
        assert out.endswith("...")
        assert len(out.split(" — ", 1)[1]) == 120

    def test_strips_newlines_from_descriptions(self):
        out = format_tool_catalogue([_entry("p", "t", description="line1\nline2\nline3")])
        assert "\n" not in out.split(" — ", 1)[1]
        assert "line1 line2 line3" in out


# ── Helpers ──────────────────────────────────────────────────────────────────


class _FakeI18n(SimpleNamespace):
    """Minimal stand-in for ``I18nObject`` — only the attrs we read."""


class _FakeToolEntity(SimpleNamespace):
    """Tool entity exposing ``identity`` + ``description`` like the real thing."""


class _FakeToolIdentity(SimpleNamespace):
    """Identity holding ``name`` + ``label`` like ``ToolIdentity``."""


class _FakeToolDescription(SimpleNamespace):
    """Description with the ``llm`` attribute we read for prompts."""


class _FakeTool:
    """Tool stand-in: ``.entity`` is the only attribute the catalogue reads."""

    def __init__(self, entity):
        self.entity = entity


def _make_tool(name: str, label_en: str = "", description_llm: str = "") -> _FakeTool:
    return _FakeTool(
        entity=_FakeToolEntity(
            identity=_FakeToolIdentity(
                name=name,
                label=_FakeI18n(en_US=label_en, zh_Hans=""),
            ),
            description=_FakeToolDescription(llm=description_llm),
        )
    )


class _FakeProviderType(SimpleNamespace):
    """Stand-in for ``ToolProviderType`` — only ``.value`` is read."""


def _make_builtin_provider(name: str, tools: list, raises_on_get_tools: bool = False):
    """
    Build something ``isinstance(..., BuiltinToolProviderController)`` will
    answer True to without actually constructing one (those require real
    on-disk plugin metadata). We patch the isinstance call sites instead.
    """
    provider = SimpleNamespace(
        entity=SimpleNamespace(identity=SimpleNamespace(name=name)),
        provider_type=_FakeProviderType(value="builtin"),
        get_tools=((lambda: (_ for _ in ()).throw(RuntimeError("boom"))) if raises_on_get_tools else (lambda: tools)),
    )
    provider._is_builtin = True
    return provider


def _make_plugin_provider(name: str, plugin_id: str, tools: list):
    provider = SimpleNamespace(
        entity=SimpleNamespace(identity=SimpleNamespace(name=name)),
        provider_type=_FakeProviderType(value="plugin"),
        plugin_id=plugin_id,
        get_tools=lambda: tools,
    )
    provider._is_plugin = True
    return provider


def _make_unknown_provider(name: str):
    """A provider matching neither class — must be skipped."""
    return SimpleNamespace(
        entity=SimpleNamespace(identity=SimpleNamespace(name=name)),
        provider_type=_FakeProviderType(value="weird"),
        get_tools=lambda: [_make_tool("ghost")],
    )


def _patched_isinstance(obj, cls):
    """
    Reroute isinstance checks the catalogue uses to the fake providers built
    above. Anything else falls through to the real isinstance.
    """
    from core.tools.builtin_tool.provider import BuiltinToolProviderController
    from core.tools.plugin_tool.provider import PluginToolProviderController

    if cls is BuiltinToolProviderController:
        return bool(getattr(obj, "_is_builtin", False))
    if cls is PluginToolProviderController:
        return bool(getattr(obj, "_is_plugin", False))
    import builtins as _b

    return _b.isinstance(obj, cls)


# ── _i18n_text / _tool_description ───────────────────────────────────────────


class TestI18nText:
    def test_returns_empty_string_when_label_is_none(self):
        assert _i18n_text(None) == ""

    def test_returns_en_us_when_present(self):
        assert _i18n_text(_FakeI18n(en_US="Search", zh_Hans="搜索")) == "Search"

    def test_falls_back_to_zh_hans_when_en_us_blank(self):
        # Some plugins ship only Chinese metadata; falling back keeps the
        # planner aware of those tools instead of dropping them silently.
        assert _i18n_text(_FakeI18n(en_US="", zh_Hans="搜索")) == "搜索"

    def test_returns_empty_when_both_locales_missing(self):
        assert _i18n_text(_FakeI18n()) == ""


class TestToolDescription:
    def test_returns_empty_string_for_none_description(self):
        # ToolEntity.description is Optional — must not raise on absent.
        assert _tool_description(None) == ""

    def test_returns_llm_attribute(self):
        assert _tool_description(_FakeToolDescription(llm="Web search")) == "Web search"

    def test_returns_empty_when_llm_missing(self):
        assert _tool_description(SimpleNamespace()) == ""


# ── build_tool_catalogue ─────────────────────────────────────────────────────


class TestBuildToolCatalogue:
    """
    The builder iterates the ``ToolManager.list_builtin_providers`` generator
    (which already covers both hardcoded and plugin providers in production).
    We patch the generator + isinstance so the tests can exercise every branch
    without standing up real plugin daemon state.
    """

    @patch("core.workflow.generator.tool_catalogue.isinstance", side_effect=_patched_isinstance)
    @patch("core.workflow.generator.tool_catalogue.ToolManager.list_builtin_providers")
    def test_returns_empty_list_for_tenant_with_no_tools(self, mock_list, mock_isinstance):
        mock_list.return_value = iter([])

        assert build_tool_catalogue("tenant-1") == []

    @patch("core.workflow.generator.tool_catalogue.isinstance", side_effect=_patched_isinstance)
    @patch("core.workflow.generator.tool_catalogue.ToolManager.list_builtin_providers")
    def test_collects_hardcoded_and_plugin_tools(self, mock_list, mock_isinstance):
        # Mixed-tenant scenario: hardcoded provider plus a plugin provider,
        # each carrying one tool. The catalogue must include all four fields
        # the workflow tool node will need (provider_name / provider_type /
        # plugin_id / tool_name).
        hardcoded = _make_builtin_provider(
            "time",
            [_make_tool("current_time", label_en="Current Time", description_llm="Return now.")],
        )
        plugin = _make_plugin_provider(
            "google",
            plugin_id="langgenius/google",
            tools=[_make_tool("search", label_en="Google Search", description_llm="Search the web.")],
        )
        mock_list.return_value = iter([hardcoded, plugin])

        entries = build_tool_catalogue("tenant-1")

        # Sorted alphabetically by provider_name.
        assert [(e["provider_name"], e["tool_name"]) for e in entries] == [
            ("google", "search"),
            ("time", "current_time"),
        ]
        google = entries[0]
        assert google["provider_type"] == "plugin"
        assert google["plugin_id"] == "langgenius/google"
        assert google["tool_label"] == "Google Search"
        assert google["description"] == "Search the web."
        time_entry = entries[1]
        assert time_entry["provider_type"] == "builtin"
        assert time_entry["plugin_id"] == ""

    @patch("core.workflow.generator.tool_catalogue.isinstance", side_effect=_patched_isinstance)
    @patch("core.workflow.generator.tool_catalogue.ToolManager.list_builtin_providers")
    def test_skips_unknown_provider_classes(self, mock_list, mock_isinstance):
        # If ToolManager ever yields a provider the catalogue doesn't know how
        # to label, we must continue (not raise) and leave it out of the
        # output rather than guessing at provider_type.
        unknown = _make_unknown_provider("mystery")
        hardcoded = _make_builtin_provider("time", [_make_tool("now")])
        mock_list.return_value = iter([unknown, hardcoded])

        entries = build_tool_catalogue("tenant-1")

        assert [e["provider_name"] for e in entries] == ["time"]

    @patch("core.workflow.generator.tool_catalogue.isinstance", side_effect=_patched_isinstance)
    @patch("core.workflow.generator.tool_catalogue.ToolManager.list_builtin_providers")
    def test_continues_when_a_provider_get_tools_raises(self, mock_list, mock_isinstance):
        # A buggy plugin must not break the whole catalogue. Resilient
        # per-provider try/except is what keeps generation usable in tenants
        # with broken installs.
        bad = _make_builtin_provider("broken", [], raises_on_get_tools=True)
        good = _make_builtin_provider("time", [_make_tool("now")])
        mock_list.return_value = iter([bad, good])

        entries = build_tool_catalogue("tenant-1")

        assert [e["provider_name"] for e in entries] == ["time"]

    @patch("core.workflow.generator.tool_catalogue.isinstance", side_effect=_patched_isinstance)
    @patch("core.workflow.generator.tool_catalogue.ToolManager.list_builtin_providers")
    def test_skips_individual_tools_when_their_metadata_is_broken(self, mock_list, mock_isinstance):
        # Per-tool try/except — a single mis-declared tool inside an otherwise
        # healthy provider gets dropped, the rest still surface.
        good_tool = _make_tool("ok", label_en="Ok", description_llm="Healthy tool.")
        # Bad tool: accessing .entity.identity raises because entity is None.
        bad_tool = SimpleNamespace(entity=None)
        hardcoded = _make_builtin_provider("p", [bad_tool, good_tool])
        mock_list.return_value = iter([hardcoded])

        entries = build_tool_catalogue("tenant-1")

        assert [e["tool_name"] for e in entries] == ["ok"]

    @patch("core.workflow.generator.tool_catalogue.isinstance", side_effect=_patched_isinstance)
    @patch("core.workflow.generator.tool_catalogue.ToolManager.list_builtin_providers")
    def test_truncates_to_max_tools_to_keep_prompt_bounded(self, mock_list, mock_isinstance):
        # A tenant with hundreds of plugin tools would blow the LLM context
        # window. The catalogue caps the output at ``_MAX_TOOLS``.
        big_provider = _make_builtin_provider(
            "p",
            [_make_tool(f"t{i:03d}") for i in range(200)],
        )
        mock_list.return_value = iter([big_provider])

        entries = build_tool_catalogue("tenant-1")

        assert len(entries) == 80

    @patch("core.workflow.generator.tool_catalogue.isinstance", side_effect=_patched_isinstance)
    @patch("core.workflow.generator.tool_catalogue.ToolManager.list_builtin_providers")
    def test_defaults_plugin_id_to_empty_string_when_missing(self, mock_list, mock_isinstance):
        # Plugin provider whose plugin_id is None should serialise to "" so
        # the consumer can safely index ``e["plugin_id"]`` without a None
        # check at every callsite.
        plugin = _make_plugin_provider("p", plugin_id=None, tools=[_make_tool("t")])
        mock_list.return_value = iter([plugin])

        entries = build_tool_catalogue("tenant-1")

        assert entries[0]["plugin_id"] == ""
