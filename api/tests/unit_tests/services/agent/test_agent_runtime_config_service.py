from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App, Conversation
from services.agent.runtime_config_service import AgentRuntimeConfigService


def _app() -> MagicMock:
    app = MagicMock(spec=App)
    app.id = "app-1"
    app.tenant_id = "tenant-1"
    return app


def _conversation(*, binding_id: str | None = None) -> MagicMock:
    conversation = MagicMock(spec=Conversation)
    conversation.id = "conversation-1"
    conversation.agent_workspace_binding_id = binding_id
    return conversation


def _soul(prompt: str) -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "prompt": {"system_prompt": prompt},
            "app_features": {"suggested_questions_after_answer": {"enabled": True}},
        }
    )


def _patch_published_soul(monkeypatch: pytest.MonkeyPatch, soul: AgentSoulConfig) -> MagicMock:
    roster_service = MagicMock()
    roster_service.return_value.get_published_agent_soul_for_app.return_value = soul
    monkeypatch.setattr("services.agent.roster_service.AgentRosterService", roster_service)
    return roster_service


def test_debug_without_mapping_falls_back_to_published_soul(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    published = _soul("published")
    roster_service = _patch_published_soul(monkeypatch, published)

    result = AgentRuntimeConfigService(session).resolve_conversation_soul(
        app_model=_app(),
        conversation=_conversation(),
        account_id="account-1",
        use_debug_draft=True,
    )

    assert result == published
    roster_service.return_value.get_published_agent_soul_for_app.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
    )


def test_debug_without_draft_falls_back_to_published_soul(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock(spec=Session)
    debug_conversation = MagicMock(spec=AgentDebugConversation)
    debug_conversation.agent_id = "agent-1"
    debug_conversation.draft_type = AgentConfigDraftType.DRAFT
    session.scalar.side_effect = [debug_conversation, None]
    published = _soul("published")
    _patch_published_soul(monkeypatch, published)

    result = AgentRuntimeConfigService(session).resolve_conversation_soul(
        app_model=_app(),
        conversation=_conversation(),
        account_id="account-1",
        use_debug_draft=True,
    )

    assert result == published


def test_missing_binding_falls_back_to_published_soul(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    published = _soul("published")
    _patch_published_soul(monkeypatch, published)

    result = AgentRuntimeConfigService(session).resolve_conversation_soul(
        app_model=_app(),
        conversation=_conversation(binding_id="binding-1"),
        account_id=None,
        use_debug_draft=False,
    )

    assert result == published


@pytest.mark.parametrize("version_kind", [AgentConfigVersionKind.SNAPSHOT, AgentConfigVersionKind.DRAFT])
def test_missing_bound_version_falls_back_to_published_soul(
    version_kind: AgentConfigVersionKind,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock(spec=Session)
    binding = MagicMock(spec=AgentWorkspaceBinding)
    binding.agent_id = "agent-1"
    binding.agent_config_version_id = "version-1"
    binding.agent_config_version_kind = version_kind
    session.scalar.side_effect = [binding, None]
    published = _soul("published")
    _patch_published_soul(monkeypatch, published)

    result = AgentRuntimeConfigService(session).resolve_conversation_soul(
        app_model=_app(),
        conversation=_conversation(binding_id="binding-1"),
        account_id=None,
        use_debug_draft=False,
    )

    assert result == published


def test_bound_draft_returns_its_soul(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock(spec=Session)
    binding = MagicMock(spec=AgentWorkspaceBinding)
    binding.agent_id = "agent-1"
    binding.agent_config_version_id = "draft-1"
    binding.agent_config_version_kind = AgentConfigVersionKind.DRAFT
    draft = MagicMock(spec=AgentConfigDraft)
    bound = _soul("bound draft")
    draft.config_snapshot_dict = bound.model_dump(mode="json")
    session.scalar.side_effect = [binding, draft]
    roster_service = _patch_published_soul(monkeypatch, _soul("published"))

    result = AgentRuntimeConfigService(session).resolve_conversation_soul(
        app_model=_app(),
        conversation=_conversation(binding_id="binding-1"),
        account_id=None,
        use_debug_draft=False,
    )

    assert result == bound
    roster_service.assert_not_called()
