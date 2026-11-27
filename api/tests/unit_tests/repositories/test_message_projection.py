import json

import pytest
from dify_agent.protocol.tool_call_limits import AGENT_TOOL_ACTIVITY_META_KEY, AgentToolActivity, ToolCallLimitMetadata
from pydantic import JsonValue
from sqlalchemy.orm import Session

from fields.conversation_fields import AgentThought
from models.enums import CreatorUserRole
from models.model import MessageAgentThought
from repositories.message_projection import snapshot_agent_thought


def test_thought_snapshot_preserves_only_authoritative_activity_after_sql_round_trip(sqlite_session: Session) -> None:
    activity = AgentToolActivity(
        id="run-1:call-4",
        run_id="run-1",
        tool_call_id="call-4",
        tool_name="search",
        status="not_executed",
        error="Call limit reached (3 per run). This request was not executed.",
        call_limit=ToolCallLimitMetadata(
            tool_identity="provider-operation",
            limit=3,
            used=3,
            execution_status="not_executed",
            reason="call_limit_reached",
        ),
    )
    thought = MessageAgentThought(
        message_id="message-1",
        position=4,
        tool="search",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        tool_meta_str=json.dumps(
            {
                AGENT_TOOL_ACTIVITY_META_KEY: activity.model_dump(mode="json"),
                "legacy_tool_config": {"credential": "private-config"},
            }
        ),
        observation="The model may describe a different outcome.",
    )
    sqlite_session.add(thought)
    sqlite_session.flush()
    sqlite_session.expunge(thought)

    detached = snapshot_agent_thought(thought)
    response = AgentThought.model_validate(detached).model_dump(mode="json")

    assert detached.tool_activity == activity
    assert response["tool_activity"] == activity.model_dump(mode="json")
    assert "private-config" not in json.dumps(response)
    assert "tool_meta" not in response


@pytest.mark.parametrize(
    "metadata",
    [
        {},
        [],
        {"search": {"used": 3, "limit": 3}},
        {AGENT_TOOL_ACTIVITY_META_KEY: "not structured"},
        {AGENT_TOOL_ACTIVITY_META_KEY: {"id": "invalid", "status": "not_executed"}},
    ],
)
def test_legacy_or_invalid_activity_keeps_the_thought_readable(sqlite_session: Session, metadata: JsonValue) -> None:
    thought = MessageAgentThought(
        message_id="message-1",
        position=1,
        tool="search",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        tool_meta_str=json.dumps(metadata),
        observation="3/3 calls, not executed",
    )
    sqlite_session.add(thought)
    sqlite_session.flush()
    sqlite_session.expunge(thought)

    record = snapshot_agent_thought(thought)
    response = AgentThought.model_validate(record).model_dump(mode="json")

    assert record.tool_activity is None
    assert "tool_activity" not in response
    assert response["observation"] == "3/3 calls, not executed"
