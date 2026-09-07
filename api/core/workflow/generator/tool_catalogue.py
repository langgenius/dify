"""
Tool catalogue for the workflow generator.

Returns a compact, LLM-readable inventory of the tools currently installed for
a tenant (both hardcoded built-in providers and plugin providers). The planner
uses this to recommend ``tool`` nodes by exact ``provider/tool`` identifier;
the builder consumes the same list so it can emit a syntactically correct
``tool`` node ``data`` block (provider_id, provider_type, tool_name,
tool_label).

Format: one tool per line, ``- <provider>/<tool> — <one-line description>``.

The prompt representation is intentionally capped — if a tenant has hundreds
of plugin tools, sending the full catalogue blows past LLM context windows.
``build_tool_catalogue`` still returns the COMPLETE installed inventory because
the validator and node hydrator must never mistake an installed tool beyond the
prompt cap for a missing one. ``format_tool_catalogue`` alone truncates the
sorted inventory to ``_MAX_PROMPT_TOOLS`` lines.
"""

import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from operator import itemgetter
from typing import Any, NotRequired, TypedDict

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolDescription
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager

logger = logging.getLogger(__name__)


_MAX_PROMPT_TOOLS = 80
DIRECT_TOOL_INJECTION_LIMIT = 24
MAX_ROUTED_TOOL_CANDIDATES = 16
MAX_ROUTED_TOOLS_PER_QUERY = 3
MAX_ROUTED_TOOLS_PER_PROVIDER = 4

_MAX_FUZZY_TEXT_LENGTH = 160
_MIN_NAME_FUZZY_RATIO = 0.72
_TOKEN_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)
_CAMEL_BOUNDARY_PATTERN = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_TOOL_IDENTIFIER_LEFT_BOUNDARY = r"(?<![\w/.:@-])"
_TOOL_IDENTIFIER_RIGHT_BOUNDARY = r"(?![\w/@-]|[.:][\w])"
_QUERY_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "for",
        "from",
        "in",
        "of",
        "on",
        "or",
        "the",
        "to",
        "tool",
        "using",
        "with",
    }
)


class ToolCatalogueEntry(TypedDict):
    provider_name: str
    provider_type: str  # "builtin" | "api" | "workflow" | "mcp" — workflow node value
    plugin_id: str  # empty string for hardcoded built-ins
    plugin_unique_identifier: NotRequired[str]
    tool_name: str
    tool_label: str
    description: str  # one-line LLM-friendly description
    parameters: NotRequired[list[dict[str, Any]]]
    output_schema: NotRequired[dict[str, Any]]


class ToolCapabilityQuery(TypedDict):
    capability: str
    keywords: list[str]


@dataclass(frozen=True)
class ToolCandidateSelection:
    entries: list[ToolCatalogueEntry]
    unmatched_queries: list[str]
    pinned_count: int


def build_tool_catalogue(tenant_id: str) -> list[ToolCatalogueEntry]:
    """
    Enumerate installed tools for the given tenant.

    Failures inside a single provider (mis-declared tool, plugin runtime
    error) are logged and skipped — one bad provider must not break the
    whole generator. Returns the complete installed inventory; prompt-specific
    truncation belongs to ``format_tool_catalogue``.
    """
    entries: list[ToolCatalogueEntry] = []

    for provider in ToolManager.list_builtin_providers(tenant_id):
        provider_name = provider.entity.identity.name
        plugin_id = ""
        # The tool-provider domain distinguishes hardcoded providers from
        # plugin providers ("builtin" vs "plugin"), while workflow tool nodes
        # deliberately group BOTH under provider_type="builtin". This mirrors
        # ToolTransformService.builtin_provider_to_user_provider and the web
        # CollectionType contract; leaking "plugin" here makes generated nodes
        # invisible to the canvas' installed-tool collection.
        provider_type = "builtin"
        plugin_unique_identifier = ""
        if isinstance(provider, PluginToolProviderController):
            plugin_id = provider.plugin_id or ""
            plugin_unique_identifier = provider.plugin_unique_identifier or ""
        elif not isinstance(provider, BuiltinToolProviderController):
            # Unknown provider class — skip rather than guess.
            continue

        try:
            tools = list(provider.get_tools())
        except Exception:
            logger.exception(
                "Workflow generator: failed to list tools for provider %s",
                provider_name,
            )
            continue

        for tool in tools:
            try:
                tool_name = tool.entity.identity.name
                tool_label = _i18n_text(tool.entity.identity.label)
                description = _tool_description(tool.entity.description)
                entries.append(
                    ToolCatalogueEntry(
                        provider_name=provider_name,
                        provider_type=provider_type,
                        plugin_id=plugin_id,
                        plugin_unique_identifier=plugin_unique_identifier,
                        tool_name=tool_name,
                        tool_label=tool_label,
                        description=description,
                        parameters=[parameter.model_dump(mode="json") for parameter in tool.entity.parameters],
                        output_schema=dict(tool.entity.output_schema),
                    )
                )
            except Exception:
                logger.exception(
                    "Workflow generator: failed to describe a tool in provider %s",
                    provider_name,
                )
                continue

    entries.sort(key=itemgetter("provider_name", "tool_name"))
    return entries


def installed_tool_keys(entries: list[ToolCatalogueEntry]) -> set[tuple[str, str]]:
    """
    Return the set of ``(provider_name, tool_name)`` pairs available for the
    tenant. The validator in ``runner.py`` consults this set so a planner /
    builder that hallucinates a tool name fails loudly at generation time
    instead of producing a runtime-broken graph.

    The set is keyed on ``provider_name`` (not ``provider_id``) because the
    builder prompt is instructed to put the provider's catalogue name into
    BOTH ``data.provider_id`` and ``data.provider_name`` on tool nodes —
    they are the same value for both built-in and plugin providers.
    """
    return {(e["provider_name"], e["tool_name"]) for e in entries}


def format_tool_catalogue(entries: list[ToolCatalogueEntry], *, max_tools: int | None = _MAX_PROMPT_TOOLS) -> str:
    """
    Render a compact multi-line catalogue for prompt
    injection. Returns an empty string when no tools are installed — callers
    should skip the section entirely in that case. The default preserves the
    legacy cap; routed callers pass ``max_tools=None`` for their selected set.
    """
    if not entries:
        return ""
    lines = []
    prompt_entries = entries if max_tools is None else entries[:max_tools]
    for e in prompt_entries:
        desc = e["description"].replace("\n", " ").strip()
        if len(desc) > 120:
            desc = desc[:117] + "..."
        line = f"- {e['provider_name']}/{e['tool_name']}"
        if e["tool_label"] and e["tool_label"] != e["tool_name"]:
            line += f" ({e['tool_label']})"
        # provider names for plugin tools commonly contain slashes themselves
        # (for example ``langgenius/google/google``). Explicit JSON-quoted
        # fields remove the ambiguous "split on the last slash" guess while
        # retaining the readable provider/tool display id.
        line += (
            f" [provider_id={json.dumps(e['provider_name'], ensure_ascii=False)}; "
            f"tool_name={json.dumps(e['tool_name'], ensure_ascii=False)}]"
        )
        if desc:
            line += f" — {desc}"
        lines.append(line)
    return "\n".join(lines)


def find_tool_entry(entries: list[ToolCatalogueEntry], provider_name: str, tool_name: str) -> ToolCatalogueEntry | None:
    """Return one exact installed-tool entry, or ``None`` when unavailable."""
    provider_name = provider_name.strip()
    tool_name = tool_name.strip()
    for entry in entries:
        if entry["provider_name"] == provider_name and entry["tool_name"] == tool_name:
            return entry
    return None


def text_mentions_tool_identifier(
    text: str,
    provider_name: str,
    tool_name: str,
    *,
    ignore_case: bool = False,
) -> bool:
    """Return whether text contains one complete ``provider/tool`` identifier."""
    identifier = f"{provider_name}/{tool_name}"
    flags = re.IGNORECASE if ignore_case else 0
    return bool(
        re.search(
            rf"{_TOOL_IDENTIFIER_LEFT_BOUNDARY}{re.escape(identifier)}{_TOOL_IDENTIFIER_RIGHT_BOUNDARY}",
            text,
            flags=flags,
        )
    )


def select_tool_candidates(
    entries: list[ToolCatalogueEntry],
    queries: list[ToolCapabilityQuery],
    *,
    explicit_text: str = "",
    current_graph: dict[str, Any] | None = None,
) -> ToolCandidateSelection:
    """Select a small, deterministic prompt catalogue from the full inventory.

    Exact identifiers in the request and tools already present in a refine
    graph are pinned. Routed candidates are ranked independently per capability
    and then merged under global and per-provider diversity caps. Pinned tools
    are never dropped by those caps.
    """
    pinned_keys = _find_explicit_tool_keys(entries, explicit_text)
    pinned_keys.update(_find_current_graph_tool_keys(entries, current_graph))
    entries_by_key = {(entry["provider_name"], entry["tool_name"]): entry for entry in entries}
    pinned = [entry for entry in entries if (entry["provider_name"], entry["tool_name"]) in pinned_keys]

    candidate_scores: dict[tuple[str, str], float] = {}
    unmatched_queries: list[str] = []
    for query in queries[:5]:
        ranked = _rank_tools_for_query(entries, query)
        confident = [(score, entry) for score, entry, is_confident in ranked if is_confident]
        if not confident:
            capability = str(query.get("capability") or "").strip()
            if capability:
                unmatched_queries.append(capability)
            continue
        for score, entry in confident[:MAX_ROUTED_TOOLS_PER_QUERY]:
            key = (entry["provider_name"], entry["tool_name"])
            candidate_scores[key] = max(score, candidate_scores.get(key, 0.0))

    ranked_keys = sorted(
        candidate_scores,
        key=lambda key: (-candidate_scores[key], key[0], key[1]),
    )
    provider_counts: dict[str, int] = {}
    routed: list[ToolCatalogueEntry] = []
    for key in ranked_keys:
        if key in pinned_keys:
            continue
        provider_name = key[0]
        if provider_counts.get(provider_name, 0) >= MAX_ROUTED_TOOLS_PER_PROVIDER:
            continue
        routed.append(entries_by_key[key])
        provider_counts[provider_name] = provider_counts.get(provider_name, 0) + 1
        if len(routed) >= MAX_ROUTED_TOOL_CANDIDATES:
            break

    return ToolCandidateSelection(
        entries=[*pinned, *routed],
        unmatched_queries=unmatched_queries,
        pinned_count=len(pinned),
    )


def select_legacy_fallback_tools(
    entries: list[ToolCatalogueEntry],
    *,
    explicit_text: str = "",
    current_graph: dict[str, Any] | None = None,
) -> list[ToolCatalogueEntry]:
    """Keep pinned tools while reproducing the legacy bounded prompt fallback."""
    pinned = select_tool_candidates(
        entries,
        [],
        explicit_text=explicit_text,
        current_graph=current_graph,
    ).entries
    pinned_keys = {(entry["provider_name"], entry["tool_name"]) for entry in pinned}
    regular_limit = max(0, _MAX_PROMPT_TOOLS - len(pinned))
    regular = [entry for entry in entries if (entry["provider_name"], entry["tool_name"]) not in pinned_keys][
        :regular_limit
    ]
    return [*pinned, *regular]


def _find_explicit_tool_keys(
    entries: list[ToolCatalogueEntry],
    text: str,
) -> set[tuple[str, str]]:
    if not text.strip():
        return set()
    keys: set[tuple[str, str]] = set()
    for entry in entries:
        if text_mentions_tool_identifier(
            text,
            entry["provider_name"],
            entry["tool_name"],
            ignore_case=True,
        ):
            keys.add((entry["provider_name"], entry["tool_name"]))
    return keys


def _find_current_graph_tool_keys(
    entries: list[ToolCatalogueEntry],
    current_graph: dict[str, Any] | None,
) -> set[tuple[str, str]]:
    if not current_graph:
        return set()
    installed = {(entry["provider_name"], entry["tool_name"]) for entry in entries}
    keys: set[tuple[str, str]] = set()
    for node in current_graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        data = node.get("data")
        if not isinstance(data, dict) or data.get("type") != "tool":
            continue
        key = (
            str(data.get("provider_id") or data.get("provider_name") or "").strip(),
            str(data.get("tool_name") or "").strip(),
        )
        if key in installed:
            keys.add(key)
    return keys


def _rank_tools_for_query(
    entries: list[ToolCatalogueEntry], query: ToolCapabilityQuery
) -> list[tuple[float, ToolCatalogueEntry, bool]]:
    capability = str(query.get("capability") or "").strip()
    keywords = [str(keyword).strip() for keyword in (query.get("keywords") or []) if str(keyword).strip()]
    query_text = " ".join([capability, *keywords]).strip()
    query_normalized = _normalize_search_text(query_text)
    query_tokens = _search_tokens(query_text)
    ranked: list[tuple[float, ToolCatalogueEntry, bool]] = []

    for entry in entries:
        identifier = f"{entry['provider_name']}/{entry['tool_name']}"
        name_text = f"{entry['provider_name']} {entry['tool_name']}"
        label_text = entry["tool_label"]
        description_text = entry["description"]
        name_tokens = _search_tokens(name_text)
        label_tokens = _search_tokens(label_text)
        description_tokens = _search_tokens(description_text)
        name_overlap = len(query_tokens & name_tokens)
        label_overlap = len(query_tokens & label_tokens)
        description_overlap = len(query_tokens & description_tokens)

        normalized_identifier = _normalize_search_text(identifier)
        normalized_name = _normalize_search_text(entry["tool_name"])
        normalized_label = _normalize_search_text(label_text)
        normalized_description = _normalize_search_text(description_text)
        phrase_bonus = 0.0
        if query_normalized and query_normalized in normalized_identifier:
            phrase_bonus = 8.0
        elif query_normalized and query_normalized in normalized_label:
            phrase_bonus = 6.0
        elif query_normalized and query_normalized in normalized_description:
            phrase_bonus = 2.0

        fuzzy_ratio = max(
            _fuzzy_ratio(query_normalized, normalized_name),
            _fuzzy_ratio(query_normalized, normalized_label),
        )
        score = phrase_bonus + name_overlap * 5.0 + label_overlap * 3.0 + description_overlap + fuzzy_ratio
        is_confident = bool(
            name_overlap or label_overlap or description_overlap or fuzzy_ratio >= _MIN_NAME_FUZZY_RATIO
        )
        ranked.append((score, entry, is_confident))

    ranked.sort(key=lambda item: (-item[0], item[1]["provider_name"], item[1]["tool_name"]))
    return ranked


def _normalize_search_text(text: str) -> str:
    camel_spaced = _CAMEL_BOUNDARY_PATTERN.sub(" ", unicodedata.normalize("NFKC", text))
    return " ".join(_TOKEN_PATTERN.findall(camel_spaced.replace("_", " ").replace("-", " "))).casefold()


def _search_tokens(text: str) -> set[str]:
    return {
        token for token in _normalize_search_text(text).split() if len(token) > 1 and token not in _QUERY_STOP_WORDS
    }


def _fuzzy_ratio(query: str, candidate: str) -> float:
    if not query or not candidate:
        return 0.0
    return SequenceMatcher(
        None,
        query[:_MAX_FUZZY_TEXT_LENGTH],
        candidate[:_MAX_FUZZY_TEXT_LENGTH],
        autojunk=False,
    ).ratio()


def format_tool_builder_context(entry: ToolCatalogueEntry) -> str:
    """Render the exact node identity and parameter contract for one tool.

    The planner sees the compact multi-tool catalogue; a tool node builder only
    needs the selected entry. Keeping this context focused both reduces tokens
    and prevents the builder from silently switching to another installed tool.
    """
    identity = {
        "provider_id": entry["provider_name"],
        "provider_name": entry["provider_name"],
        "provider_type": entry["provider_type"],
        "plugin_id": entry.get("plugin_id", ""),
        "plugin_unique_identifier": entry.get("plugin_unique_identifier", ""),
        "tool_name": entry["tool_name"],
        "tool_label": entry["tool_label"] or entry["tool_name"],
    }
    lines = [
        "# Selected installed tool",
        "",
        "Copy these identity fields EXACTLY; do not switch tools or invent identifiers:",
        json.dumps(identity, ensure_ascii=False, separators=(",", ":")),
    ]

    description = entry.get("description", "").replace("\n", " ").strip()
    if description:
        lines.extend(["", f"Capability: {description}"])

    parameters = entry.get("parameters") or []
    if parameters:
        lines.extend(
            [
                "",
                "Parameters (form=llm -> tool_parameters; form=form -> tool_configurations):",
            ]
        )
        for parameter in parameters:
            name = str(parameter.get("name") or "").strip()
            if not name:
                continue
            form = str(parameter.get("form") or "llm")
            type_ = str(parameter.get("type") or "string")
            requirement = "required" if parameter.get("required") else "optional"
            detail = str(parameter.get("llm_description") or "").replace("\n", " ").strip()
            options = parameter.get("options") or []
            option_values = [str(option.get("value")) for option in options if isinstance(option, dict)]
            suffixes = []
            if option_values:
                suffixes.append("options=" + json.dumps(option_values, ensure_ascii=False, separators=(",", ":")))
            if parameter.get("default") is not None:
                suffixes.append(
                    "default=" + json.dumps(parameter["default"], ensure_ascii=False, separators=(",", ":"))
                )
            if detail:
                suffixes.append(detail[:160])
            suffix = " — " + "; ".join(suffixes) if suffixes else ""
            lines.append(f"- {name}: {type_}, form={form}, {requirement}{suffix}")

    lines.extend(
        [
            "",
            "Use upstream variables for required LLM parameters whenever possible. "
            "Keep declared defaults for form parameters and omit undeclared parameter names.",
            "",
        ]
    )
    return "\n".join(lines)


def _i18n_text(label: I18nObject | None) -> str:
    """Pull the English label out of an I18nObject, falling back to Chinese."""
    if label is None:
        return ""
    return label.en_US or label.zh_Hans or ""


def _tool_description(description: ToolDescription | None) -> str:
    """Pull the LLM-facing description (``.llm``) from a ToolDescription."""
    if description is None:
        return ""
    return description.llm or ""
