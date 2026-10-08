"""Suggest workflow instructions with closed dataset reads before remote calls."""

import json
import logging
import re
from collections.abc import Callable, Sequence
from typing import Literal, Protocol

import json_repair

from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelManager
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType

logger = logging.getLogger(__name__)


class SuggestionDatasets(Protocol):
    def names(self, *, tenant_id: str, limit: int) -> Sequence[str]: ...


# ── Workflow instruction-suggestion tuning ────────────────────────────────
# Suggestions are a soft, pre-model-pick enhancement: short, buildable example
# instructions proposed from the tenant's DEFAULT model. Every failure path
# degrades to an empty list, never an error.
_SUGGESTION_MIN_COUNT = 1
_SUGGESTION_MAX_COUNT = 6
_SUGGESTION_MAX_TOKENS = 512
_SUGGESTION_TEMPERATURE = 0.8
# Bound the grounding context so the prompt stays small regardless of how many
# knowledge bases / tools the tenant has installed.
_SUGGESTION_KB_LIMIT = 10
_SUGGESTION_TOOL_SAMPLE_LINES = 20

_SUGGESTION_SYSTEM_PROMPT = (
    "You help a user start building a Dify app by proposing example build instructions. "
    "Each suggestion must be a SHORT (at most 8 words), concrete, and BUILDABLE instruction "
    "describing an app to generate for the given app type. Make the suggestions diverse — cover "
    "different use cases. When the listed knowledge bases or installed tools fit a suggestion, "
    "prefer them, but NEVER invent tools or knowledge bases that are not listed. "
    "Reply with ONLY a JSON array of strings and nothing else."
)


def _parse_string_list(text: str) -> list[str]:
    """Extract a JSON array of strings from a (possibly noisy) LLM response.

    Slices the first ``[...]`` span so surrounding prose / markdown fences are
    tolerated, parses it with ``json`` and falls back to ``json_repair``, then
    keeps only ``str`` items. Returns ``[]`` on any failure so callers can
    treat parsing as best-effort.
    """
    match = re.search(r"\[.*\]", text.strip(), re.DOTALL)
    if not match:
        return []
    raw = match.group(0)
    try:
        parsed = json.loads(raw)
    except Exception:
        try:
            parsed = json_repair.loads(raw)
        except Exception:
            return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, str)]


class WorkflowInstructionSuggestions:
    def __init__(self, *, datasets: SuggestionDatasets, tools: Callable[[str], str]) -> None:
        self._datasets = datasets
        self._tools = tools

    @with_credit_usage_created_by(CreditUsageCreatedBy.WORKFLOW_INSTRUCTION_SUGGESTIONS)
    def generate_workflow_instruction_suggestions(
        self,
        tenant_id: str,
        *,
        mode: Literal["workflow", "advanced-chat"],
        language: str | None = None,
        count: int = 4,
    ) -> list[str]:
        """Propose short, buildable example instructions for the workflow generator.

        Runs BEFORE the user picks a model, so it uses the tenant's DEFAULT LLM
        only. Suggestions are a soft enhancement, never a blocker: every failure
        path (no default model, KB / tool lookup error, LLM error, unparseable
        output) is swallowed and surfaced as an empty list — a valid result the
        caller renders as "no suggestions". This method NEVER raises.
        """
        count = max(_SUGGESTION_MIN_COUNT, min(count, _SUGGESTION_MAX_COUNT))

        try:
            model_instance = ModelManager.for_tenant(tenant_id=tenant_id).get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
            )
        except Exception:
            logger.info("Workflow instruction suggestions: no default model for tenant %s", tenant_id)
            return []

        context_block = self._build_suggestion_context(tenant_id)
        app_type_label = (
            "Workflow — single-shot automation" if mode == "workflow" else "Chatflow — conversational multi-turn"
        )

        user_lines = [
            f"App type: {app_type_label}",
            context_block,
            f"Return exactly {count} distinct ideas as a JSON array of strings.",
        ]
        if language:
            user_lines.append(f"Write every idea in this language: {language}.")
        user_prompt = "\n".join(line for line in user_lines if line)

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=_SUGGESTION_SYSTEM_PROMPT),
            UserPromptMessage(content=user_prompt),
        ]

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"max_tokens": _SUGGESTION_MAX_TOKENS, "temperature": _SUGGESTION_TEMPERATURE},
                stream=False,
            )
        except Exception:
            logger.exception("Workflow instruction suggestions: LLM invocation failed")
            return []

        raw_suggestions = _parse_string_list(response.message.get_text_content() or "")

        # Strip whitespace + surrounding quotes, drop empties, dedupe
        # case-insensitively (preserving first-seen casing), cap to ``count``.
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in raw_suggestions:
            idea = item.strip().strip("\"'").strip()
            if not idea:
                continue
            key = idea.casefold()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(idea)
            if len(cleaned) >= count:
                break
        return cleaned

    def _build_suggestion_context(self, tenant_id: str) -> str:
        """Assemble an optional grounding block naming the tenant's KBs and tools.

        Best-effort: each section is isolated in its own try/except so a failure
        enumerating one (DB hiccup, plugin daemon down) never blocks the other
        or the suggestion call itself. Returns "" when nothing is available.
        """
        sections: list[str] = []

        try:
            names = self._datasets.names(tenant_id=tenant_id, limit=_SUGGESTION_KB_LIMIT)
            kb_names = [name for name in names if name]
            if kb_names:
                sections.append("Knowledge bases:\n" + "\n".join(f"- {name}" for name in kb_names))
        except Exception:
            logger.info("Workflow instruction suggestions: failed to load knowledge bases", exc_info=True)

        try:
            tool_text = self._tools(tenant_id)
            if tool_text:
                sample = "\n".join(tool_text.splitlines()[:_SUGGESTION_TOOL_SAMPLE_LINES])
                sections.append("Installed tools:\n" + sample)
        except Exception:
            logger.info("Workflow instruction suggestions: failed to load tool catalogue", exc_info=True)

        if not sections:
            return ""
        return "\n\n".join(sections) + "\n\n"
