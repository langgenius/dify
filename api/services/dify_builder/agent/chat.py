"""State-aware multi-turn replies for an active Dify Builder session."""

import json
import logging
from collections.abc import Callable

from core.dify_builder.models import ConversationItem, DifyBuilderContext, Graph
from core.dify_builder.state import PcState
from services.dify_builder.agent import llm
from services.dify_builder.agent.model_resolver import normalize_completion_params

logger = logging.getLogger(__name__)

_MAX_HISTORY_ITEMS = 24
_MAX_CONTEXT_CHARS = 12_000


def _history_text(history: list[ConversationItem]) -> str:
    lines: list[str] = []
    for item in history[-_MAX_HISTORY_ITEMS:]:
        if item.kind == "user":
            text = item.payload.get("text")
            if isinstance(text, str):
                lines.append(f"user: {text}")
        elif item.kind == "assistant_turn":
            text = item.payload.get("reply_text")
            if isinstance(text, str) and text:
                lines.append(f"assistant: {text}")
        elif item.kind in {"notice", "decision", "summary", "error"}:
            lines.append(f"session-{item.kind}: {json.dumps(item.payload, ensure_ascii=False)}")
    return "\n".join(lines)[-_MAX_CONTEXT_CHARS:]


def respond(
    model,
    model_config: dict,
    state: PcState,
    context: DifyBuilderContext,
    history: list[ConversationItem],
    graph: Graph,
    text: str,
    on_delta: Callable[[str], None] | None = None,
    on_reasoning: Callable[[str], None] | None = None,
) -> str:
    fallback = (
        f'I understand your note: "{text}". The Builder is currently at {state}. '
        "I have not changed the workflow; use one of the available actions when you want to continue."
    )
    if model is None:
        if on_delta is not None:
            on_delta(fallback)
        return fallback

    system = (
        "You are Dify Builder, helping a user build, edit, or repair the workflow shown in this session. "
        "Answer the latest message using the conversation and current workflow context. Be concise and concrete. "
        "A chat reply must never approve, publish, revert, run, or mutate the workflow. Do not claim an action "
        "was performed. When an explicit UI action is required, explain which available action the user should use."
    )
    context_payload = {
        "state": str(state),
        "entry_goal": context.goal_text,
        "requirements": context.requirements,
        "plan": context.plan_items,
        "diagnosis": context.diagnosis,
        "risk": context.risk,
        "change_set": context.change_set,
        "workflow": {
            "node_count": len(graph.get("nodes", [])),
            "edge_count": len(graph.get("edges", [])),
            "node_ids": [node.get("id") for node in graph.get("nodes", [])[:50]],
        },
    }
    user = (
        f"SESSION CONTEXT:\n{json.dumps(context_payload, default=str, ensure_ascii=False)}\n\n"
        f"CONVERSATION:\n{_history_text(history)}\n\nLATEST USER MESSAGE:\n{text}"
    )
    params, stop = normalize_completion_params(model_config.get("completion_params", {}))
    chunks: list[str] = []
    try:
        for delta in llm.invoke_text_stream(
            model,
            system=system,
            user=user,
            model_parameters=params,
            stop=stop,
            on_reasoning=on_reasoning,
        ):
            chunks.append(delta)
            if on_delta is not None:
                on_delta(delta)
        reply = "".join(chunks)
        if reply.strip():
            return reply
    except Exception:
        if chunks:
            logger.exception("Dify Builder: multi-turn reply generation failed after a partial response")
            raise
        logger.exception("Dify Builder: multi-turn reply generation failed; using fallback")
    if on_delta is not None:
        on_delta(fallback)
    return fallback
