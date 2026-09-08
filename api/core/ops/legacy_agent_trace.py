"""Legacy agent-chat message results and thought records; removable with agent-chat."""

import logging
from collections.abc import Mapping
from datetime import timedelta
from typing import Any

from core.ops.message_trace import MessageTraceRecorder


def record_legacy_agent_result(message_trace: MessageTraceRecorder, message_fields: Mapping[str, Any]) -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.model import App, Message, MessageAgentThought

    try:
        with Session(db.engine) as session:
            thoughts = session.scalars(
                select(MessageAgentThought)
                .join(
                    Message,
                    Message.id == MessageAgentThought.message_id,
                )
                .join(App, App.id == Message.app_id)
                .where(
                    App.tenant_id == message_trace.source.tenant_id,
                    App.id == message_trace.source.app_id,
                    Message.id == message_fields["message_id"],
                )
                .order_by(MessageAgentThought.position)
                .limit(10001)
                .execution_options(yield_per=100)
            )
            for index, thought in enumerate(thoughts):
                if index == 10000:
                    message_trace.mark_incomplete("agent_thought_limit")
                    break
                message_trace.record_operation(
                    f"Agent round {thought.position}",
                    span_type="llm",
                    inputs=thought.message,
                    outputs={"thought": thought.thought, "answer": thought.answer, "tools": thought.tools},
                    timer={
                        "start": thought.created_at,
                        "end": thought.created_at + timedelta(seconds=thought.latency or 0),
                    },
                    attributes={
                        "operation_type": "llm",
                        "metrics_from_parent": True,
                        "agent_round": thought.position,
                        "model_name": message_fields.get("model_name"),
                    },
                    usage={
                        "prompt_tokens": thought.message_token,
                        "completion_tokens": thought.answer_token,
                        "total_tokens": thought.tokens,
                        "total_price": thought.total_price,
                        "currency": thought.currency,
                    },
                )
    except Exception:
        message_trace.mark_incomplete("agent_thoughts_unavailable")
        logging.getLogger(__name__).warning(
            "Cannot read agent thoughts tenant_id=%s message_id=%s",
            message_trace.source.tenant_id,
            message_fields["message_id"],
        )
    message_trace.finish_message_trace(message_fields, span_name="Legacy Agent")
