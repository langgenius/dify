"""Persist and resolve the exact participant owned by an Agent App caller."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID
from dify_agent.protocol.snapshot import SessionSnapshot
from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, ModelResponse, TextPart
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.model import App, AppAnnotationHitHistory, Conversation, Message
from services.agent.workspace_service import (
    AgentWorkspaceNotFoundError,
    AgentWorkspaceService,
    WorkspaceOwnerScope,
)


@dataclass(frozen=True, slots=True)
class AgentAppSessionScope:
    tenant_id: str
    app_id: str
    conversation_id: str
    agent_id: str
    agent_config_snapshot_id: str
    home_snapshot_id: str | None
    agent_config_version_kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT
    build_draft_id: str | None = None

    @property
    def workspace_owner(self) -> WorkspaceOwnerScope:
        owner_type = (
            AgentWorkspaceOwnerType.BUILD_DRAFT if self.build_draft_id else AgentWorkspaceOwnerType.CONVERSATION
        )
        return WorkspaceOwnerScope(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            owner_type=owner_type,
            owner_id=self.build_draft_id or self.conversation_id,
        )


@dataclass(frozen=True, slots=True)
class AgentAppDirectReplyTurn:
    """One chat turn answered before the Agent backend ran, such as an annotation reply.

    ``query`` is the user text the input guards matched, after input moderation.
    ``answer`` is the reply exactly as published; no model rewrote it.
    """

    query: str
    answer: str


def append_direct_reply_turns(
    snapshot: SessionSnapshot | None, turns: Sequence[AgentAppDirectReplyTurn]
) -> SessionSnapshot:
    """Return ``snapshot`` with ``turns`` appended to its Agent ``history`` state.

    Each turn becomes one user request and one plain text response in the
    Pydantic AI message schema that the ``history`` module restores, so the next
    backend run sees the turn as ordinary conversation history. Stored layer
    state, including earlier messages, is copied as stored JSON and never
    re-encoded here, because the Agent backend owns that data. A tool call left
    unanswered by an interrupted run is no longer the history tail after this
    append; Pydantic AI closes such calls before every model request.

    Preconditions: the stored history ``messages`` value is absent or a list.
    Postconditions: the input snapshot is unchanged; the result keeps every
    other layer and ends with ``turns`` in order. Raises ``ValueError`` when the
    stored history is not a message list.
    """
    layers = dict(snapshot.layers) if snapshot is not None else {}
    history_state = dict(layers.get(DIFY_AGENT_HISTORY_LAYER_ID, {}))
    stored_messages = history_state.get("messages", [])
    if not isinstance(stored_messages, list):
        raise ValueError("Agent session history messages must be a list")
    new_messages = ModelMessagesTypeAdapter.dump_python(
        [
            message
            for turn in turns
            for message in (
                ModelRequest.user_text_prompt(turn.query),
                ModelResponse(parts=[TextPart(content=turn.answer)]),
            )
        ],
        mode="json",
    )
    history_state["messages"] = [*stored_messages, *new_messages]
    layers[DIFY_AGENT_HISTORY_LAYER_ID] = history_state
    return SessionSnapshot(layers=layers)


@dataclass(frozen=True, slots=True)
class StoredAgentAppSession:
    scope: AgentAppSessionScope
    binding_id: str
    workspace_id: str
    backend_binding_ref: str
    session_snapshot: SessionSnapshot | None


class AgentAppWorkspaceStore:
    """Resolve Agent App sessions through a caller-owned Binding pointer."""

    def load_or_create(self, scope: AgentAppSessionScope) -> StoredAgentAppSession:
        """Resolve the caller's participant, allocating the first one when missing.

        A conversation's first participant starts with the turns that annotation
        replies answered before it existed (see ``_first_participant_turns``);
        without such turns it starts with no snapshot, as before.
        """
        with session_factory.create_session() as session:
            caller = self._load_caller(session=session, scope=scope)
            binding_id = caller.agent_workspace_binding_id
            if binding_id is None:
                earlier_turns = self._first_participant_turns(session=session, scope=scope, caller=caller)
                binding = AgentWorkspaceService.create_binding(
                    session=session,
                    scope=scope.workspace_owner,
                    agent_id=scope.agent_id,
                    base_home_snapshot_id=scope.home_snapshot_id,
                    agent_config_version_id=scope.agent_config_snapshot_id,
                    agent_config_version_kind=scope.agent_config_version_kind,
                )
                if earlier_turns:
                    binding.session_snapshot = append_direct_reply_turns(None, earlier_turns).model_dump_json()
                caller.agent_workspace_binding_id = binding.id
                session.commit()
            else:
                binding = self._get_binding(session=session, scope=scope, binding_id=binding_id)
            return self._stored(scope, binding)

    def append_direct_reply(self, scope: AgentAppSessionScope, turn: AgentAppDirectReplyTurn) -> bool:
        """Append a turn answered before reaching the Agent backend to the caller's history.

        Preconditions: ``scope`` is the scope the runner resolves for the same
        caller and generation.
        Postconditions: when the caller owns an ACTIVE participant, its snapshot
        history ends with ``turn`` and True is returned. When the caller has no
        participant yet, nothing is written and False is returned: allocating one
        needs the Agent backend, so ``load_or_create`` seeds a conversation's
        first participant from the recorded annotation hits instead.
        Raises the same caller and Binding errors as ``load_or_create``; nothing
        is committed then.

        Concurrency: the Binding row stays locked (``SELECT ... FOR UPDATE``)
        from the read to the commit, so two appends to the same participant, or
        an append and ``AgentWorkspaceService.retire_binding`` (which locks the
        row too), run one after the other and neither is lost. This lock does
        not cover the snapshot a backend run saves when it ends
        (``save_active_snapshot``): that run read the history before this turn
        and replaces the whole snapshot, so a backend turn of the same caller
        still running, or still being cancelled after a stop, drops this turn.
        """
        with session_factory.create_session() as session:
            caller = self._load_caller(session=session, scope=scope)
            binding_id = caller.agent_workspace_binding_id
            if binding_id is None:
                return False
            # Lock before validating, in the order retire_binding takes its locks;
            # select only the id so the snapshot is read once, by _get_binding.
            session.execute(
                select(AgentWorkspaceBinding.id).where(AgentWorkspaceBinding.id == binding_id).with_for_update()
            )
            binding = self._get_binding(session=session, scope=scope, binding_id=binding_id)
            stored = SessionSnapshot.model_validate_json(binding.session_snapshot) if binding.session_snapshot else None
            binding.session_snapshot = append_direct_reply_turns(stored, (turn,)).model_dump_json()
            session.commit()
            return True

    @staticmethod
    def _first_participant_turns(
        *, session: Session, scope: AgentAppSessionScope, caller: Conversation | AgentConfigDraft
    ) -> tuple[AgentAppDirectReplyTurn, ...]:
        """Return annotation-answered turns a conversation's first participant must remember.

        Annotation hit history records the matched query and published content
        per message, in conversation order. Only a conversation that never had
        a Workspace is seeded: a retired one means an earlier participant
        already held these turns and its context was reset on purpose, such as
        console preview after Build Apply. Build-draft callers are never seeded.
        """
        if not isinstance(caller, Conversation):
            return ()
        rows = session.execute(
            select(AppAnnotationHitHistory.question, AppAnnotationHitHistory.annotation_content)
            .join(Message, Message.id == AppAnnotationHitHistory.message_id)
            .where(
                AppAnnotationHitHistory.app_id == scope.app_id,
                Message.app_id == scope.app_id,
                Message.conversation_id == scope.conversation_id,
            )
            .order_by(Message.created_at, Message.id)
        ).all()
        if not rows:
            return ()
        owner = scope.workspace_owner
        earlier_workspace_id = session.scalar(
            select(AgentWorkspace.id)
            .where(
                AgentWorkspace.tenant_id == owner.tenant_id,
                AgentWorkspace.app_id == owner.app_id,
                AgentWorkspace.owner_type == owner.owner_type,
                AgentWorkspace.owner_id == owner.owner_id,
                AgentWorkspace.owner_scope_key == owner.owner_scope_key,
            )
            .limit(1)
        )
        if earlier_workspace_id is not None:
            return ()
        return tuple(AgentAppDirectReplyTurn(query=query, answer=answer) for query, answer in rows)

    @staticmethod
    def _load_caller(*, session: Session, scope: AgentAppSessionScope) -> Conversation | AgentConfigDraft:
        if scope.build_draft_id is not None:
            if scope.agent_config_version_kind != AgentConfigVersionKind.BUILD_DRAFT:
                raise AgentWorkspaceNotFoundError("Build Draft caller requires build_draft generation")
            draft = session.scalar(
                select(AgentConfigDraft).where(
                    AgentConfigDraft.id == scope.build_draft_id,
                    AgentConfigDraft.tenant_id == scope.tenant_id,
                    AgentConfigDraft.agent_id == scope.agent_id,
                    AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                )
            )
            if draft is None:
                raise AgentWorkspaceNotFoundError("Build Draft caller is unavailable")
            return draft
        if scope.agent_config_version_kind == AgentConfigVersionKind.BUILD_DRAFT:
            raise AgentWorkspaceNotFoundError("Build Draft caller ID is required")
        conversation = session.scalar(
            select(Conversation)
            .join(App, App.id == Conversation.app_id)
            .where(
                App.tenant_id == scope.tenant_id,
                Conversation.id == scope.conversation_id,
                Conversation.app_id == scope.app_id,
                Conversation.is_deleted.is_(False),
            )
        )
        if conversation is None:
            raise AgentWorkspaceNotFoundError("Conversation caller is unavailable")
        return conversation

    @staticmethod
    def _get_binding(
        *,
        session: Session,
        scope: AgentAppSessionScope,
        binding_id: str,
    ) -> AgentWorkspaceBinding:
        binding = AgentWorkspaceService.get_active_binding(
            session=session,
            tenant_id=scope.tenant_id,
            binding_id=binding_id,
            expected_owner_scope=scope.workspace_owner,
        )
        if binding is None or binding.agent_id != scope.agent_id:
            raise AgentWorkspaceNotFoundError("Caller participant Binding is unavailable")
        AgentWorkspaceService.validate_binding_generation(
            binding,
            base_home_snapshot_id=scope.home_snapshot_id,
            agent_config_version_id=scope.agent_config_snapshot_id,
            agent_config_version_kind=scope.agent_config_version_kind,
        )
        return binding

    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        binding_id: str,
        snapshot: SessionSnapshot | None,
    ) -> None:
        if snapshot is None:
            return
        AgentWorkspaceService.save_binding_session_snapshot(
            tenant_id=scope.tenant_id,
            binding_id=binding_id,
            session_snapshot=snapshot.model_dump_json(),
        )

    @staticmethod
    def _stored(scope: AgentAppSessionScope, binding: AgentWorkspaceBinding) -> StoredAgentAppSession:
        snapshot = SessionSnapshot.model_validate_json(binding.session_snapshot) if binding.session_snapshot else None
        return StoredAgentAppSession(
            scope=scope,
            binding_id=binding.id,
            workspace_id=binding.workspace_id,
            backend_binding_ref=binding.backend_binding_ref,
            session_snapshot=snapshot,
        )


__all__ = [
    "AgentAppDirectReplyTurn",
    "AgentAppSessionScope",
    "AgentAppWorkspaceStore",
    "StoredAgentAppSession",
    "append_direct_reply_turns",
]
