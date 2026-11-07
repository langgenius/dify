"""Unit tests for the tool catalogue helpers."""

import pytest

from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.providers.time.time import WikiPediaProvider
from core.tools.builtin_tool.providers.time.tools.current_time import CurrentTimeTool
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolProviderEntity,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
)
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from core.workflow.generator.tool_catalogue import (
    MAX_ROUTED_TOOL_CANDIDATES,
    MAX_ROUTED_TOOLS_PER_PROVIDER,
    ToolCapabilityQuery,
    ToolCatalogueEntry,
    _i18n_text,
    _tool_description,
    build_tool_catalogue,
    find_tool_entry,
    format_tool_builder_context,
    format_tool_catalogue,
    installed_tool_keys,
    select_legacy_fallback_selection,
    select_legacy_fallback_tools,
    select_tool_candidates,
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

    def test_empty_input_returns_empty_set(self) -> None:
        assert installed_tool_keys([]) == set()

    def test_returns_provider_tool_tuples(self) -> None:
        keys = installed_tool_keys(
            [
                _entry("google", "search"),
                _entry("github", "list_issues"),
            ]
        )
        assert keys == {("google", "search"), ("github", "list_issues")}

    def test_dedupes_duplicate_entries(self) -> None:
        # Defensive — the catalogue builder dedupes on read, but a duplicate
        # entry slipping through should collapse rather than break the set
        # type contract.
        keys = installed_tool_keys([_entry("x", "y"), _entry("x", "y")])
        assert keys == {("x", "y")}


class TestFormatToolCatalogue:
    def test_empty_input_returns_empty_string(self) -> None:
        assert format_tool_catalogue([]) == ""

    def test_renders_provider_slash_tool_per_line(self) -> None:
        out = format_tool_catalogue(
            [
                _entry("google", "search", description="Search the web with Google."),
                _entry("time", "current_time", description="Return the current time."),
            ]
        )
        lines = out.split("\n")
        assert lines == [
            '- google/search [provider_id="google"; tool_name="search"] — Search the web with Google.',
            '- time/current_time [provider_id="time"; tool_name="current_time"] — Return the current time.',
        ]

    def test_includes_label_when_different_from_tool_name(self) -> None:
        out = format_tool_catalogue(
            [
                _entry("google", "search", label="Google Search", description="Search."),
            ]
        )
        assert out == '- google/search (Google Search) [provider_id="google"; tool_name="search"] — Search.'

    def test_omits_label_when_identical_to_tool_name(self) -> None:
        out = format_tool_catalogue(
            [
                _entry("time", "current_time", label="current_time", description="Now."),
            ]
        )
        assert out == '- time/current_time [provider_id="time"; tool_name="current_time"] — Now.'

    def test_caps_only_prompt_text_while_full_inventory_remains_available(self) -> None:
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        out = format_tool_catalogue(entries)

        assert len(out.splitlines()) == 80
        assert "tool_079" in out
        assert "tool_080" not in out
        assert ("provider", "tool_099") in installed_tool_keys(entries)

    def test_can_disable_prompt_cap_for_an_already_selected_catalogue(self) -> None:
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        out = format_tool_catalogue(entries, max_tools=None)

        assert len(out.splitlines()) == 100
        assert "tool_099" in out

    def test_truncates_long_descriptions(self) -> None:
        long_desc = "x" * 200
        out = format_tool_catalogue([_entry("p", "t", description=long_desc)])
        # Truncated to 117 chars + "..."
        assert out.endswith("...")
        assert len(out.split(" — ", 1)[1]) == 120

    def test_strips_newlines_from_descriptions(self) -> None:
        out = format_tool_catalogue([_entry("p", "t", description="line1\nline2\nline3")])
        assert "\n" not in out.split(" — ", 1)[1]
        assert "line1 line2 line3" in out


class TestSelectToolCandidates:
    def test_routes_english_capability_query_to_relevant_tool_description(self) -> None:
        entries = [
            *[_entry(f"provider_{index}", "generic", description="Manage generic records.") for index in range(30)],
            _entry(
                "langgenius/google/google",
                "search",
                label="Google Search",
                description="Search the current web and return internet results.",
            ),
        ]

        selection = select_tool_candidates(
            entries,
            [ToolCapabilityQuery(capability="web search", keywords=["internet", "current", "results"])],
        )

        assert [(entry["provider_name"], entry["tool_name"]) for entry in selection.entries] == [
            ("langgenius/google/google", "search")
        ]
        assert selection.unmatched_queries == []

    def test_pins_explicit_identifier_and_existing_refine_tool_without_queries(self) -> None:
        entries = [
            _entry("langgenius/google/google", "search"),
            _entry("langgenius/time/time", "current_time"),
            _entry("other", "tool"),
        ]
        current_graph = {
            "nodes": [
                {
                    "id": "time-node",
                    "data": {
                        "type": "tool",
                        "provider_id": "langgenius/time/time",
                        "tool_name": "current_time",
                    },
                }
            ]
        }

        selection = select_tool_candidates(
            entries,
            [],
            explicit_text="Use langgenius/google/google/search for this step.",
            current_graph=current_graph,
        )

        assert [(entry["provider_name"], entry["tool_name"]) for entry in selection.entries] == [
            ("langgenius/google/google", "search"),
            ("langgenius/time/time", "current_time"),
        ]
        assert selection.pinned_count == 2

    def test_explicit_identifier_does_not_also_pin_a_hyphenated_prefix(self) -> None:
        entries = [
            _entry("provider", "search"),
            _entry("provider", "search-web"),
        ]

        selection = select_tool_candidates(
            entries,
            [],
            explicit_text="Use provider/search-web exactly.",
        )

        assert selection.entries == [entries[1]]
        assert selection.pinned_count == 1

    def test_reports_unmatched_capability_for_legacy_fallback(self) -> None:
        selection = select_tool_candidates(
            [_entry("records", "list", description="List stored database records.")],
            [ToolCapabilityQuery(capability="synthesize quantum music", keywords=["qubits", "melody"])],
        )

        assert selection.entries == []
        assert selection.unmatched_queries == ["synthesize quantum music"]

    def test_deduplicates_one_tool_selected_by_multiple_queries(self) -> None:
        entries = [
            _entry(
                "langgenius/google/google",
                "search",
                label="Google Search",
                description="Search the current web and return internet results.",
            )
        ]
        queries = [
            ToolCapabilityQuery(capability="web search", keywords=["internet"]),
            ToolCapabilityQuery(capability="internet lookup", keywords=["web"]),
        ]

        selection = select_tool_candidates(entries, queries)

        assert selection.entries == entries

    def test_enforces_provider_diversity(self) -> None:
        words = ["alpha", "bravo", "charlie", "delta", "echo"]
        entries = [
            _entry("large_provider", f"{word}_action", description=f"Perform the {word} capability.") for word in words
        ]
        queries = [ToolCapabilityQuery(capability=word, keywords=[word]) for word in words]

        selection = select_tool_candidates(entries, queries)

        assert sum(entry["provider_name"] == "large_provider" for entry in selection.entries) == (
            MAX_ROUTED_TOOLS_PER_PROVIDER
        )
        assert selection.entries == select_tool_candidates(entries, queries).entries

    def test_500_tool_catalogue_never_exceeds_global_candidate_limit(self) -> None:
        words = ["alpha", "bravo", "charlie", "delta", "echo"]
        entries = [
            _entry(
                f"provider_{index:03d}",
                f"tool_{index:03d}",
                description=f"Handle {words[index % len(words)]} operations.",
            )
            for index in range(500)
        ]
        queries = [ToolCapabilityQuery(capability=word, keywords=[word]) for word in words]

        selection = select_tool_candidates(entries, queries)

        assert len(selection.entries) == 15
        assert len(selection.entries) <= MAX_ROUTED_TOOL_CANDIDATES

    def test_legacy_fallback_keeps_explicit_tool_beyond_first_80(self) -> None:
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        selected = select_legacy_fallback_tools(
            entries,
            explicit_text="Use provider/tool_099 exactly.",
        )

        assert len(selected) == 80
        assert selected[0]["tool_name"] == "tool_099"
        assert any(entry["tool_name"] == "tool_078" for entry in selected)
        assert all(entry["tool_name"] != "tool_079" for entry in selected)


class TestLegacyFallbackSelection:
    def test_returns_selected_and_omitted_tools(self) -> None:
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        selection = select_legacy_fallback_selection(entries)

        assert selection.entries == entries[:80]
        assert selection.omitted_entries == entries[80:]
        assert selection.pinned_count == 0
        assert selection.limit == 80
        assert selection.overflow_count == 0

    def test_keeps_legacy_fallback_tools_compatible(self) -> None:
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        assert select_legacy_fallback_tools(entries) == select_legacy_fallback_selection(entries).entries

    def test_reports_pinned_overflow_without_fabricated_omissions(self) -> None:
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(85)]
        explicit_text = "Use " + ", ".join(f"provider/{entry['tool_name']}" for entry in entries) + " exactly."

        selection = select_legacy_fallback_selection(entries, explicit_text=explicit_text)

        assert selection.entries == entries
        assert selection.omitted_entries == []
        assert selection.pinned_count == 85
        assert selection.limit == 80
        assert selection.overflow_count == 5

    def test_empty_catalogue_has_no_omissions_or_overflow(self) -> None:
        selection = select_legacy_fallback_selection([])

        assert selection.entries == []
        assert selection.omitted_entries == []
        assert selection.pinned_count == 0
        assert selection.limit == 80
        assert selection.overflow_count == 0


class TestToolBuilderContext:
    def test_finds_exact_provider_and_tool_pair(self) -> None:
        entries = [_entry("google", "search"), _entry("google", "maps")]

        assert find_tool_entry(entries, "google", "search") == entries[0]
        assert find_tool_entry(entries, "google", "missing") is None

    def test_renders_trusted_identity_and_parameter_contract(self) -> None:
        entry = _entry("langgenius/google/google", "search", label="Google Search", description="Search the web.")
        entry["plugin_id"] = "langgenius/google"
        entry["plugin_unique_identifier"] = "langgenius/google:1.0@checksum"
        entry["parameters"] = [
            {
                "name": "",
                "type": "string",
                "form": "llm",
                "required": False,
            },
            {
                "name": "query",
                "type": "string",
                "form": "llm",
                "required": True,
                "default": None,
                "options": [],
                "llm_description": "The search query.",
            },
            {
                "name": "safe_search",
                "type": "select",
                "form": "form",
                "required": False,
                "default": "moderate",
                "options": [{"value": "moderate"}, {"value": "off"}],
            },
        ]

        out = format_tool_builder_context(entry)

        assert "Selected installed tool" in out
        assert '"provider_type":"builtin"' in out
        assert '"plugin_id":"langgenius/google"' in out
        assert "query: string, form=llm, required" in out
        assert 'safe_search: select, form=form, optional — options=["moderate","off"]; default="moderate"' in out
        assert "- : string" not in out


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_tool(name: str, label_en: str = "", description_llm: str = "") -> BuiltinTool:
    """Use a real builtin tool with optional empty display metadata."""
    return CurrentTimeTool(
        provider="time",
        runtime=ToolRuntime(tenant_id="tenant-1"),
        entity=ToolEntity(
            identity=ToolIdentity(author="test", provider="time", name=name, label=I18nObject(en_US=label_en)),
            description=ToolDescription(human=I18nObject(en_US=""), llm=description_llm),
        ),
    )


def _make_builtin_provider(name: str, tools: list[BuiltinTool]) -> BuiltinToolProviderController:
    """Load the shipped time provider, then configure its real tool inventory."""
    provider = WikiPediaProvider()
    provider.entity.identity.name = name
    provider.tools = tools
    return provider


def _provider_identity(name: str) -> ToolProviderIdentity:
    return ToolProviderIdentity(
        author="test", name=name, description=I18nObject(en_US=name), icon="", label=I18nObject(en_US=name)
    )


def _make_plugin_provider(name: str, plugin_id: str, tools: list[BuiltinTool]) -> PluginToolProviderController:
    return PluginToolProviderController(
        entity=ToolProviderEntityWithPlugin(identity=_provider_identity(name), tools=[tool.entity for tool in tools]),
        plugin_id=plugin_id,
        plugin_unique_identifier=f"{plugin_id}:1.0@checksum" if plugin_id else "",
        tenant_id="tenant-1",
    )


# ── _i18n_text / _tool_description ───────────────────────────────────────────


class TestI18nText:
    def test_returns_empty_string_when_label_is_none(self) -> None:
        assert _i18n_text(None) == ""

    def test_returns_en_us_when_present(self) -> None:
        assert _i18n_text(I18nObject(en_US="Search", zh_Hans="搜索")) == "Search"

    def test_falls_back_to_zh_hans_when_en_us_blank(self) -> None:
        # Some plugins ship only Chinese metadata; falling back keeps the
        # planner aware of those tools instead of dropping them silently.
        assert _i18n_text(I18nObject(en_US="", zh_Hans="搜索")) == "搜索"

    def test_returns_empty_when_both_locales_are_blank(self) -> None:
        assert _i18n_text(I18nObject(en_US="", zh_Hans="")) == ""


class TestToolDescription:
    def test_returns_empty_string_for_none_description(self) -> None:
        # ToolEntity.description is Optional — must not raise on absent.
        assert _tool_description(None) == ""

    def test_returns_llm_attribute(self) -> None:
        description = ToolDescription(human=I18nObject(en_US=""), llm="Web search")

        assert _tool_description(description) == "Web search"

    def test_returns_empty_when_llm_is_blank(self) -> None:
        description = ToolDescription(human=I18nObject(en_US=""), llm="")

        assert _tool_description(description) == ""


# ── build_tool_catalogue ─────────────────────────────────────────────────────


class TestBuildToolCatalogue:
    """
    The builder iterates the ``ToolManager.list_builtin_providers`` generator
    (which already covers both hardcoded and plugin providers in production).
    Real builtin and plugin controllers retain their constructors and type checks.
    Only provider discovery and intentional failure injection are isolated.
    """

    def test_returns_empty_list_for_tenant_with_no_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(ToolManager, "list_builtin_providers", lambda _tenant: iter([]))

        assert build_tool_catalogue("tenant-1") == []

    def test_collects_hardcoded_and_plugin_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
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
        monkeypatch.setattr(ToolManager, "list_builtin_providers", lambda _tenant: iter([hardcoded, plugin]))

        entries = build_tool_catalogue("tenant-1")

        # Sorted alphabetically by provider_name.
        assert [(e["provider_name"], e["tool_name"]) for e in entries] == [
            ("google", "search"),
            ("time", "current_time"),
        ]
        google = entries[0]
        # Plugin-backed tools still use provider_type="builtin" in workflow
        # nodes; plugin identity lives in plugin_id / unique identifier.
        assert google["provider_type"] == "builtin"
        assert google["plugin_id"] == "langgenius/google"
        assert google["plugin_unique_identifier"] == "langgenius/google:1.0@checksum"
        assert google["tool_label"] == "Google Search"
        assert google["description"] == "Search the web."
        time_entry = entries[1]
        assert time_entry["provider_type"] == "builtin"
        assert time_entry["plugin_id"] == ""

    def test_skips_unknown_provider_classes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # If ToolManager ever yields a provider the catalogue doesn't know how
        # to label, we must continue (not raise) and leave it out of the
        # output rather than guessing at provider_type.
        unknown = ApiToolProviderController(
            entity=ToolProviderEntity(identity=_provider_identity("mystery")),
            provider_id="provider-id",
            tenant_id="tenant-1",
        )
        hardcoded = _make_builtin_provider("time", [_make_tool("now")])
        monkeypatch.setattr(ToolManager, "list_builtin_providers", lambda _tenant: iter([unknown, hardcoded]))

        entries = build_tool_catalogue("tenant-1")

        assert [e["provider_name"] for e in entries] == ["time"]

    def test_continues_when_a_provider_get_tools_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A buggy plugin must not break the whole catalogue. Resilient
        # per-provider try/except is what keeps generation usable in tenants
        # with broken installs.
        bad = _make_builtin_provider("broken", [])

        def unavailable() -> list[BuiltinTool]:
            raise RuntimeError("boom")

        monkeypatch.setattr(bad, "get_tools", unavailable)
        good = _make_builtin_provider("time", [_make_tool("now")])
        monkeypatch.setattr(ToolManager, "list_builtin_providers", lambda _tenant: iter([bad, good]))

        entries = build_tool_catalogue("tenant-1")

        assert [e["provider_name"] for e in entries] == ["time"]

    def test_skips_individual_tools_when_their_metadata_is_broken(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Per-tool try/except — a single mis-declared tool inside an otherwise
        # healthy provider gets dropped, the rest still surface.
        good_tool = _make_tool("ok", label_en="Ok", description_llm="Healthy tool.")
        # Inject corrupt metadata after normal construction to exercise defensive handling.
        bad_tool = _make_tool("bad")
        monkeypatch.setattr(bad_tool, "entity", None)
        hardcoded = _make_builtin_provider("p", [bad_tool, good_tool])
        monkeypatch.setattr(ToolManager, "list_builtin_providers", lambda _tenant: iter([hardcoded]))

        entries = build_tool_catalogue("tenant-1")

        assert [e["tool_name"] for e in entries] == ["ok"]

    def test_keeps_complete_inventory_for_validation_beyond_prompt_cap(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Prompt formatting is capped separately. Dropping entries here would
        # make the validator falsely report installed tools after the cap as
        # missing from the workspace.
        big_provider = _make_builtin_provider(
            "p",
            [_make_tool(f"t{i:03d}") for i in range(200)],
        )
        monkeypatch.setattr(ToolManager, "list_builtin_providers", lambda _tenant: iter([big_provider]))

        entries = build_tool_catalogue("tenant-1")

        assert len(entries) == 200
        assert ("p", "t199") in installed_tool_keys(entries)

    def test_defaults_plugin_id_to_empty_string_when_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Plugin provider whose plugin_id is None should serialise to "" so
        # the consumer can safely index ``e["plugin_id"]`` without a None
        # check at every callsite.
        plugin = _make_plugin_provider("p", plugin_id="", tools=[_make_tool("t")])
        monkeypatch.setattr(plugin, "plugin_id", None)
        monkeypatch.setattr(ToolManager, "list_builtin_providers", lambda _tenant: iter([plugin]))

        entries = build_tool_catalogue("tenant-1")

        assert entries[0]["plugin_id"] == ""
