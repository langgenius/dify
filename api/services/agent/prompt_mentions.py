"""Prompt mention (slash-reference) serialization contract — ENG-616.

Slash-menu insertions are stored inline in the plain-string prompt as tokens:

    {{#<kind>:<id>[|<label>]#}}

``kind`` is a fixed lowercase word; ``id`` points at an item in the Agent config
lists (mentions are pointers — the entity itself lives in ``skills_files`` /
``tools`` / ``knowledge.datasets`` / ``human.contacts`` /
``previous_node_output_refs`` / ``declared_outputs``); ``label`` is an optional
plain-text fallback only (the backend always re-resolves by id, so renames never
break references).

The colon form is invisible to the legacy prompt-template parsers
(``core/prompt/utils/prompt_template_parser.py`` only matches ``{{var}}`` /
``{{#a.b#}}`` dot forms), so these tokens never collide with existing Dify
template syntax. Runtime expansion (and the final scrub that guarantees no
internal marker ever reaches the model) is owned by the run-request builders.
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
    r"\{\{#(skill|file|tool|cli_tool|knowledge|human|node_output|output):([^#|{}]+?)(?:\|([^#{}]*?))?#\}\}"
)
# Anything mention-shaped (a kind-ish word followed by ``:``) that the strict
# pattern did not consume — unknown kinds, malformed bodies. The colon
# requirement keeps legacy ``{{#histories#}}`` / ``{{#node.var#}}`` forms (which
# never contain a colon) out of scope.
_RESIDUAL_MENTION_PATTERN = re.compile(r"\{\{#([A-Za-z_][A-Za-z0-9_]*:[^{}]*?)#\}\}")

MAX_MENTIONS_PER_PROMPT = 200
MAX_MENTION_FIELD_LENGTH = 255

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


def parse_prompt_mentions(prompt: str) -> list[PromptMention]:
    """Extract well-formed mentions. Oversized id/label tokens are skipped here
    (treated as malformed) — the runtime scrub still degrades them safely."""
    mentions: list[PromptMention] = []
    for match in MENTION_PATTERN.finditer(prompt or ""):
        ref_id = match.group(2)
        label = match.group(3)
        if len(ref_id) > MAX_MENTION_FIELD_LENGTH or (label is not None and len(label) > MAX_MENTION_FIELD_LENGTH):
            continue
        mentions.append(
            PromptMention(
                kind=MentionKind(match.group(1)),
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
        ref_id = match.group(2)
        label = match.group(3) or None
        fallback = (label or ref_id)[:MAX_MENTION_FIELD_LENGTH]
        if len(ref_id) > MAX_MENTION_FIELD_LENGTH or (label is not None and len(label) > MAX_MENTION_FIELD_LENGTH):
            return fallback
        mention = PromptMention(
            kind=MentionKind(match.group(1)),
            ref_id=ref_id,
            label=label,
            start=match.start(),
            end=match.end(),
            raw=match.group(0),
        )
        resolved = resolver(mention)
        if resolved is None or not resolved.strip():
            return fallback
        return resolved[:MAX_MENTION_FIELD_LENGTH]

    return scrub_mention_markers(MENTION_PATTERN.sub(_replace, prompt))


def find_malformed_mention_markers(prompt: str) -> list[str]:
    """Mention-shaped markers the strict grammar does not accept (unknown kind,
    oversized id/label, broken body). Soft-flagged at validate; the runtime
    scrub still degrades them safely."""
    if not prompt:
        return []
    parsed_spans = {(mention.start, mention.end) for mention in parse_prompt_mentions(prompt)}
    return [match.group(0) for match in _RESIDUAL_MENTION_PATTERN.finditer(prompt) if match.span() not in parsed_spans]


def scrub_mention_markers(text: str) -> str:
    """Degrade any residual mention-shaped ``{{#kind:…#}}`` marker to readable text."""

    def _degrade(match: re.Match[str]) -> str:
        inner = match.group(1)
        if "|" in inner:
            label = inner.rsplit("|", 1)[1].strip()
            if label:
                return label[:MAX_MENTION_FIELD_LENGTH]
        return inner.split(":", 1)[1].strip()[:MAX_MENTION_FIELD_LENGTH] or inner[:MAX_MENTION_FIELD_LENGTH]

    return _RESIDUAL_MENTION_PATTERN.sub(_degrade, text)


def build_soul_mention_resolver(agent_soul: AgentSoulConfig) -> MentionResolver:
    """Resolve soul-surface mentions to canonical display names from the soul config."""

    def _resolve(mention: PromptMention) -> str | None:
        match mention.kind:
            case MentionKind.SKILL:
                for skill in agent_soul.skills_files.skills:
                    if mention.ref_id in (skill.id, skill.name):
                        return skill.name or skill.id
            case MentionKind.FILE:
                for file in agent_soul.skills_files.files:
                    if mention.ref_id in (file.id, file.name):
                        return file.name or file.id
            case MentionKind.TOOL:
                for tool in agent_soul.tools.dify_tools:
                    aliases = {tool.tool_name} | {
                        f"{prefix}/{tool.tool_name}"
                        for prefix in (tool.provider, tool.provider_id, tool.plugin_id)
                        if prefix
                    }
                    if mention.ref_id in aliases:
                        return tool.name or tool.tool_name
            case MentionKind.CLI_TOOL:
                for cli_tool in agent_soul.tools.cli_tools:
                    if cli_tool.name and mention.ref_id == cli_tool.name:
                        return cli_tool.name
            case MentionKind.KNOWLEDGE:
                for dataset in agent_soul.knowledge.datasets:
                    if mention.ref_id == dataset.id:
                        return dataset.name or dataset.id
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
    "MAX_MENTIONS_PER_PROMPT",
    "MAX_MENTION_FIELD_LENGTH",
    "MENTION_PATTERN",
    "NODE_JOB_PROMPT_ALLOWED_KINDS",
    "SOUL_PROMPT_ALLOWED_KINDS",
    "MentionKind",
    "MentionResolver",
    "PromptMention",
    "build_node_job_mention_resolver",
    "build_soul_mention_resolver",
    "expand_prompt_mentions",
    "find_malformed_mention_markers",
    "parse_prompt_mentions",
    "scrub_mention_markers",
]
