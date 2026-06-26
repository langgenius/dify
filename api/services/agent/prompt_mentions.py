"""Prompt mention (slash-reference) serialization contract — ENG-616.

Slash-menu insertions are stored inline in the plain-string prompt as tokens:

    [§<kind>:<id>[:<label>]§]

Workflow-node prompts also carry prompt-editor workflow variables as plain Dify
template markers:

    {{#<node-id>.<output>[.<child>...]#}}

``kind`` is a fixed lowercase word; ``id`` points at an item in the Agent
runtime context. For prompt-owned entities that means Agent Soul lists such as
``tools`` / ``knowledge.sets`` / ``human.contacts`` and workflow job lists
such as ``previous_node_output_refs`` / ``declared_outputs``. For drive-backed
``skill`` / ``file`` mentions the field stores a URL-encoded drive key and is
resolved against ``agent_drive_files`` at runtime. ``label`` is an optional
plain-text fallback only. A single ``:`` separates all three fields; ``label``
is the trailing remainder and may itself contain ``:``.

The ``[§…§]`` wrapper uses the section sign ``§`` (U+00A7), which never appears
in Dify template syntax (``{{var}}`` / ``{{#a.b#}}``) nor in normal prompt text,
so these tokens can never collide with the existing template parsers. Runtime
expansion (and the final scrub that guarantees no internal marker ever reaches
the model) is owned by the run-request builders. Frontend output blocks still
accept a legacy bare ``§output:...§`` form during migrations, so the runtime
parser accepts that alias too.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum

from models.agent_config_entities import (
    AgentHumanContactConfig,
    AgentSoulConfig,
    WorkflowNodeJobConfig,
    WorkflowPreviousNodeOutputRef,
)


class MentionKind(StrEnum):
    SKILL = "skill"
    FILE = "file"
    TOOL = "tool"
    CLI_TOOL = "cli_tool"
    KNOWLEDGE = "knowledge"
    HUMAN = "human"
    NODE_OUTPUT = "node_output"
    OUTPUT = "output"


MENTION_PATTERN = re.compile(
    r"(?:\[§(?P<bracket_kind>skill|file|tool|cli_tool|knowledge|human|node_output|output):"
    r"(?P<bracket_id>[^:§]+?)(?::(?P<bracket_label>[^§]*?))?§\])"
    r"|(?:§(?P<legacy_kind>output):(?P<legacy_id>[^:§]+?)(?::(?P<legacy_label>[^§]*?))?§)"
)
# Anything mention-shaped (``[§word:…§]``) that the strict pattern did not consume
# — unknown kinds, malformed bodies. The ``§`` wrapper + a kind-word + ``:``
# requirement keeps legacy ``{{#histories#}}`` / ``{{var}}`` template forms and
# ordinary bracketed text out of scope.
_RESIDUAL_MENTION_PATTERN = re.compile(r"\[§([A-Za-z_][A-Za-z0-9_]*:[^§]*?)§\]")
WORKFLOW_VARIABLE_PATTERN = re.compile(r"\{\{#([^{}#]+?\.[^{}#]+?)#\}\}")

MAX_MENTIONS_PER_PROMPT = 200
# Drive keys are validated up to 512 Unicode code points before URL encoding.
# Worst case, one code point becomes 4 UTF-8 bytes and each byte becomes a
# 3-character ``%XX`` escape, so a valid encoded drive key can reach 6144 chars.
MAX_MENTION_REF_ID_LENGTH = 6144
MAX_MENTION_LABEL_LENGTH = 255

# Reserved ``tool`` mention id suffix: ``<provider>/*`` means "every tool of this
# provider" (a provider hosts many tools, like an MCP server). Single tools use
# ``<provider>/<tool_name>``, so ``*`` can never collide with a real tool name.
# The mention points at a provider-level config entry (``tool_name`` omitted in
# ``tools.dify_tools``); the runtime expands that entry into all of the
# provider's tools.
ALL_PROVIDER_TOOLS_SUFFIX = "*"

# Per-surface allowlists (design §2.4): the soul prompt may only reference
# soul-owned entities; the workflow job prompt may only reference run-scoped ones.
SOUL_PROMPT_ALLOWED_KINDS = frozenset(
    {
        MentionKind.SKILL,
        MentionKind.FILE,
        MentionKind.TOOL,
        MentionKind.CLI_TOOL,
        MentionKind.KNOWLEDGE,
        MentionKind.HUMAN,
    }
)
NODE_JOB_PROMPT_ALLOWED_KINDS = frozenset({MentionKind.NODE_OUTPUT, MentionKind.OUTPUT, MentionKind.HUMAN})


@dataclass(frozen=True, slots=True)
class PromptMention:
    kind: MentionKind
    ref_id: str
    label: str | None
    start: int
    end: int
    raw: str


# Returns the model-readable replacement for a mention, or None when the id does
# not resolve (the expander then degrades to label/id).
MentionResolver = Callable[[PromptMention], str | None]
WorkflowVariableResolver = Callable[[tuple[str, ...]], str | None]


def _mention_groups(match: re.Match[str]) -> tuple[str, str, str | None]:
    kind = match.group("bracket_kind") or match.group("legacy_kind")
    ref_id = match.group("bracket_id") or match.group("legacy_id")
    label = match.group("bracket_label") or match.group("legacy_label")
    return kind, ref_id, label


def parse_prompt_mentions(prompt: str) -> list[PromptMention]:
    """Extract well-formed mentions. Oversized id/label tokens are skipped here
    (treated as malformed) — the runtime scrub still degrades them safely."""
    mentions: list[PromptMention] = []
    for match in MENTION_PATTERN.finditer(prompt or ""):
        kind, ref_id, label = _mention_groups(match)
        if len(ref_id) > MAX_MENTION_REF_ID_LENGTH or (label is not None and len(label) > MAX_MENTION_LABEL_LENGTH):
            continue
        mentions.append(
            PromptMention(
                kind=MentionKind(kind),
                ref_id=ref_id,
                label=label or None,
                start=match.start(),
                end=match.end(),
                raw=match.group(0),
            )
        )
    return mentions


def expand_prompt_mentions(prompt: str, resolver: MentionResolver) -> str:
    """Replace every mention with resolver output, degrading unresolved ones to
    their label (then id), and scrub any residual mention-shaped marker so no
    frontend-internal token ever reaches the model."""
    if not prompt:
        return prompt

    def _replace(match: re.Match[str]) -> str:
        kind, ref_id, label = _mention_groups(match)
        label = label or None
        fallback = (label or ref_id)[:MAX_MENTION_LABEL_LENGTH]
        if len(ref_id) > MAX_MENTION_REF_ID_LENGTH or (label is not None and len(label) > MAX_MENTION_LABEL_LENGTH):
            return fallback
        mention = PromptMention(
            kind=MentionKind(kind),
            ref_id=ref_id,
            label=label,
            start=match.start(),
            end=match.end(),
            raw=match.group(0),
        )
        resolved = resolver(mention)
        if resolved is None or not resolved.strip():
            return fallback
        return resolved[:MAX_MENTION_LABEL_LENGTH]

    return scrub_mention_markers(MENTION_PATTERN.sub(_replace, prompt))


def find_malformed_mention_markers(prompt: str) -> list[str]:
    """Mention-shaped markers the strict grammar does not accept (unknown kind,
    oversized id/label, broken body). Soft-flagged at validate; the runtime
    scrub still degrades them safely."""
    if not prompt:
        return []
    parsed_spans = {(mention.start, mention.end) for mention in parse_prompt_mentions(prompt)}
    return [match.group(0) for match in _RESIDUAL_MENTION_PATTERN.finditer(prompt) if match.span() not in parsed_spans]


def extract_workflow_variable_selectors(prompt: str) -> list[tuple[str, ...]]:
    """Extract ``{{#node.output#}}``-style selectors from workflow prompts."""
    selectors: list[tuple[str, ...]] = []
    for match in WORKFLOW_VARIABLE_PATTERN.finditer(prompt or ""):
        parts = tuple(part.strip() for part in match.group(1).split(".") if part.strip())
        if len(parts) >= 2:
            selectors.append(parts)
    return selectors


def expand_workflow_variable_markers(prompt: str, resolver: WorkflowVariableResolver) -> str:
    """Replace ``{{#node.output#}}`` markers with resolved plain text."""
    if not prompt:
        return prompt

    def _replace(match: re.Match[str]) -> str:
        parts = tuple(part.strip() for part in match.group(1).split(".") if part.strip())
        if len(parts) < 2:
            return match.group(0)
        resolved = resolver(parts)
        if resolved is None or not resolved.strip():
            return ".".join(parts)
        return resolved

    return WORKFLOW_VARIABLE_PATTERN.sub(_replace, prompt)


def scrub_mention_markers(text: str) -> str:
    """Degrade any residual mention-shaped ``[§kind:…§]`` marker to readable text."""

    def _degrade(match: re.Match[str]) -> str:
        # inner is ``kind:id[:label]``; prefer the label, else the id.
        parts = match.group(1).split(":", 2)
        if len(parts) >= 3 and parts[2].strip():
            return parts[2].strip()[:MAX_MENTION_LABEL_LENGTH]
        if len(parts) >= 2 and parts[1].strip():
            return parts[1].strip()[:MAX_MENTION_LABEL_LENGTH]
        return match.group(1)[:MAX_MENTION_LABEL_LENGTH]

    return _RESIDUAL_MENTION_PATTERN.sub(_degrade, text)


def build_soul_mention_resolver(agent_soul: AgentSoulConfig) -> MentionResolver:
    """Resolve non-drive soul-surface mentions to canonical display names."""

    def _resolve(mention: PromptMention) -> str | None:
        match mention.kind:
            case MentionKind.TOOL:
                for tool in agent_soul.tools.dify_tools:
                    prefixes = {prefix for prefix in (tool.provider, tool.provider_id, tool.plugin_id) if prefix}
                    if tool.plugin_id and tool.provider:
                        prefixes.add(f"{tool.plugin_id}/{tool.provider}")
                    if tool.tool_name is None:
                        # Provider-level entry = all tools of this provider.
                        # ``[§tool:<provider>/*§]`` names the whole provider;
                        # ``[§tool:<provider>/<tool>§]`` names one tool offered
                        # through it.
                        display = tool.provider or tool.provider_id or tool.plugin_id
                        if any(mention.ref_id == f"{prefix}/{ALL_PROVIDER_TOOLS_SUFFIX}" for prefix in prefixes):
                            return f"all {display} tools"
                        # longest prefix first — shorter prefixes can be proper
                        # prefixes of longer ones and would mis-split the ref.
                        for prefix in sorted(prefixes, key=len, reverse=True):
                            single = mention.ref_id.removeprefix(f"{prefix}/")
                            if single != mention.ref_id and single and "/" not in single:
                                return single
                        continue
                    aliases = {tool.tool_name} | {f"{prefix}/{tool.tool_name}" for prefix in prefixes}
                    if mention.ref_id in aliases:
                        return tool.name or tool.tool_name
            case MentionKind.CLI_TOOL:
                for cli_tool in agent_soul.tools.cli_tools:
                    # id is the stable reference; name stays as an alias so tokens
                    # minted before ids existed (or hand-written ones) keep working.
                    if mention.ref_id in (cli_tool.id, cli_tool.name):
                        return cli_tool.name or cli_tool.id
            case MentionKind.KNOWLEDGE:
                for knowledge_set in agent_soul.knowledge.sets:
                    if mention.ref_id == knowledge_set.id:
                        return knowledge_set.name or knowledge_set.id
            case MentionKind.HUMAN:
                return _resolve_human_contact(agent_soul.human.contacts, mention.ref_id)
            case _:
                return None
        return None

    return _resolve


def build_node_job_mention_resolver(node_job: WorkflowNodeJobConfig) -> MentionResolver:
    """Resolve job-surface mentions. ``node_output`` expands to the stored
    reference name only — values stay in the Workflow context block (design §4.2)."""

    def _resolve(mention: PromptMention) -> str | None:
        match mention.kind:
            case MentionKind.NODE_OUTPUT:
                for ref in node_job.previous_node_output_refs:
                    selector = _selector_from_ref(ref)
                    if selector and f"{selector[0]}.{selector[1]}" == mention.ref_id:
                        return ref.name or mention.label or mention.ref_id
            case MentionKind.OUTPUT:
                for output in node_job.declared_outputs:
                    if output.name == mention.ref_id:
                        return f"{output.name} ({output.type.value})"
            case MentionKind.HUMAN:
                return _resolve_human_contact(node_job.human_contacts, mention.ref_id)
            case _:
                return None
        return None

    return _resolve


def _resolve_human_contact(contacts: list[AgentHumanContactConfig], ref_id: str) -> str | None:
    for contact in contacts:
        if ref_id in (contact.id, contact.contact_id, contact.human_id):
            channel = contact.channel or contact.method or contact.contact_method
            who = contact.name or contact.email or ref_id
            return f"{channel.upper()} · {who}" if channel else who
    return None


def _selector_from_ref(ref: WorkflowPreviousNodeOutputRef) -> tuple[str, str] | None:
    for candidate in (ref.selector, ref.variable_selector, ref.value_selector):
        if isinstance(candidate, list) and len(candidate) >= 2:
            return str(candidate[0]), str(candidate[1])
    if ref.node_id:
        output = ref.output or ref.variable or ref.key
        if output:
            return ref.node_id, output
    return None


__all__ = [
    "ALL_PROVIDER_TOOLS_SUFFIX",
    "MAX_MENTIONS_PER_PROMPT",
    "MAX_MENTION_LABEL_LENGTH",
    "MAX_MENTION_REF_ID_LENGTH",
    "MENTION_PATTERN",
    "NODE_JOB_PROMPT_ALLOWED_KINDS",
    "SOUL_PROMPT_ALLOWED_KINDS",
    "MentionKind",
    "MentionResolver",
    "PromptMention",
    "build_node_job_mention_resolver",
    "build_soul_mention_resolver",
    "expand_workflow_variable_markers",
    "expand_prompt_mentions",
    "extract_workflow_variable_selectors",
    "find_malformed_mention_markers",
    "parse_prompt_mentions",
    "scrub_mention_markers",
]
