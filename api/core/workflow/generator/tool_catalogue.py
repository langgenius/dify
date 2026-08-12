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
from operator import itemgetter
from typing import Any, NotRequired, TypedDict

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolDescription
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager

logger = logging.getLogger(__name__)


_MAX_PROMPT_TOOLS = 80


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


def format_tool_catalogue(entries: list[ToolCatalogueEntry]) -> str:
    """
    Render a bounded catalogue as a compact multi-line block for prompt
    injection. Returns an empty string when no tools are installed — callers
    should skip the section entirely in that case. The full input remains
    available to validation and node hydration; only prompt text is capped.
    """
    if not entries:
        return ""
    lines = []
    for e in entries[:_MAX_PROMPT_TOOLS]:
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
