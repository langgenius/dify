"""Unit tests for the tool catalogue helpers."""

from types import SimpleNamespace
from unittest.mock import patch

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolDescription
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
            '- google/search [provider_id="google"; tool_name="search"] — Search the web with Google.',
            '- time/current_time [provider_id="time"; tool_name="current_time"] — Return the current time.',
        ]

    def test_includes_label_when_different_from_tool_name(self):
        out = format_tool_catalogue(
            [
                _entry("google", "search", label="Google Search", description="Search."),
            ]
        )
        assert out == '- google/search (Google Search) [provider_id="google"; tool_name="search"] — Search.'

    def test_omits_label_when_identical_to_tool_name(self):
        out = format_tool_catalogue(
            [
                _entry("time", "current_time", label="current_time", description="Now."),
            ]
        )
        assert out == '- time/current_time [provider_id="time"; tool_name="current_time"] — Now.'

    def test_caps_only_prompt_text_while_full_inventory_remains_available(self):
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        out = format_tool_catalogue(entries)

        assert len(out.splitlines()) == 80
        assert "tool_079" in out
        assert "tool_080" not in out
        assert ("provider", "tool_099") in installed_tool_keys(entries)

    def test_can_disable_prompt_cap_for_an_already_selected_catalogue(self):
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        out = format_tool_catalogue(entries, max_tools=None)

        assert len(out.splitlines()) == 100
        assert "tool_099" in out

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


class TestSelectToolCandidates:
    def test_routes_english_capability_query_to_relevant_tool_description(self):
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

    def test_pins_explicit_identifier_and_existing_refine_tool_without_queries(self):
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

    def test_explicit_identifier_does_not_also_pin_a_hyphenated_prefix(self):
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

    def test_reports_unmatched_capability_for_legacy_fallback(self):
        selection = select_tool_candidates(
            [_entry("records", "list", description="List stored database records.")],
            [ToolCapabilityQuery(capability="synthesize quantum music", keywords=["qubits", "melody"])],
        )

        assert selection.entries == []
        assert selection.unmatched_queries == ["synthesize quantum music"]

    def test_deduplicates_one_tool_selected_by_multiple_queries(self):
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

    def test_enforces_provider_diversity(self):
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

    def test_500_tool_catalogue_never_exceeds_global_candidate_limit(self):
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

    def test_legacy_fallback_keeps_explicit_tool_beyond_first_80(self):
        entries = [_entry("provider", f"tool_{index:03d}") for index in range(100)]

        selected = select_legacy_fallback_tools(
            entries,
            explicit_text="Use provider/tool_099 exactly.",
        )

        assert len(selected) == 80
        assert selected[0]["tool_name"] == "tool_099"
        assert any(entry["tool_name"] == "tool_078" for entry in selected)
        assert all(entry["tool_name"] != "tool_079" for entry in selected)


class TestToolBuilderContext:
    def test_finds_exact_provider_and_tool_pair(self):
        entries = [_entry("google", "search"), _entry("google", "maps")]

        assert find_tool_entry(entries, "google", "search") == entries[0]
        assert find_tool_entry(entries, "google", "missing") is None

    def test_renders_trusted_identity_and_parameter_contract(self):
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


class _FakeToolEntity(SimpleNamespace):
    """Tool entity exposing ``identity`` + ``description`` like the real thing."""


class _FakeToolIdentity(SimpleNamespace):
    """Identity holding ``name`` + ``label`` like ``ToolIdentity``."""


class _FakeTool:
    """Tool stand-in: ``.entity`` is the only attribute the catalogue reads."""

    def __init__(self, entity):
        self.entity = entity


def _make_tool(name: str, label_en: str = "", description_llm: str = "") -> _FakeTool:
    return _FakeTool(
        entity=_FakeToolEntity(
            identity=_FakeToolIdentity(
                name=name,
                label=I18nObject(en_US=label_en),
            ),
            description=ToolDescription(human=I18nObject(en_US=""), llm=description_llm),
            parameters=[],
            output_schema={},
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


def _make_plugin_provider(name: str, plugin_id: str | None, tools: list):
    provider = SimpleNamespace(
        entity=SimpleNamespace(identity=SimpleNamespace(name=name)),
        provider_type=_FakeProviderType(value="plugin"),
        plugin_id=plugin_id,
        plugin_unique_identifier=f"{plugin_id}:1.0@checksum" if plugin_id else "",
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
    Reroute the isinstance checks ``build_tool_catalogue`` makes onto the fake
    providers built above.

    Match the provider classes by ``__name__`` rather than by identity (``is``).
    In the full test suite a sibling test that reloads or stubs
    ``core.tools.*.provider`` (e.g. via ``sys.modules``) gives the catalogue a
    DIFFERENT class object than a fresh ``import`` here would; an ``is`` check
    would then miss, every fake provider would fall through to the real
    ``isinstance`` and fail it, and the catalogue would come back empty — which
    is exactly how this test flaked in CI under parallel execution. A name match
    is immune to those reloads. Anything we don't recognise (including tuple
    ``cls`` args) defers to the real ``isinstance``.
    """
    cls_name = getattr(cls, "__name__", "")
    if cls_name == "BuiltinToolProviderController":
        return bool(getattr(obj, "_is_builtin", False))
    if cls_name == "PluginToolProviderController":
        return bool(getattr(obj, "_is_plugin", False))
    import builtins as _b

    return _b.isinstance(obj, cls)


# ── _i18n_text / _tool_description ───────────────────────────────────────────


class TestI18nText:
    def test_returns_empty_string_when_label_is_none(self):
        assert _i18n_text(None) == ""

    def test_returns_en_us_when_present(self):
        assert _i18n_text(I18nObject(en_US="Search", zh_Hans="搜索")) == "Search"

    def test_falls_back_to_zh_hans_when_en_us_blank(self):
        # Some plugins ship only Chinese metadata; falling back keeps the
        # planner aware of those tools instead of dropping them silently.
        assert _i18n_text(I18nObject(en_US="", zh_Hans="搜索")) == "搜索"

    def test_returns_empty_when_both_locales_are_blank(self):
        assert _i18n_text(I18nObject(en_US="", zh_Hans="")) == ""


class TestToolDescription:
    def test_returns_empty_string_for_none_description(self):
        # ToolEntity.description is Optional — must not raise on absent.
        assert _tool_description(None) == ""

    def test_returns_llm_attribute(self):
        description = ToolDescription(human=I18nObject(en_US=""), llm="Web search")

        assert _tool_description(description) == "Web search"

    def test_returns_empty_when_llm_is_blank(self):
        description = ToolDescription(human=I18nObject(en_US=""), llm="")

        assert _tool_description(description) == ""


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
    def test_keeps_complete_inventory_for_validation_beyond_prompt_cap(self, mock_list, mock_isinstance):
        # Prompt formatting is capped separately. Dropping entries here would
        # make the validator falsely report installed tools after the cap as
        # missing from the workspace.
        big_provider = _make_builtin_provider(
            "p",
            [_make_tool(f"t{i:03d}") for i in range(200)],
        )
        mock_list.return_value = iter([big_provider])

        entries = build_tool_catalogue("tenant-1")

        assert len(entries) == 200
        assert ("p", "t199") in installed_tool_keys(entries)

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
