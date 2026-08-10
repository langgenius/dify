"""Workflow Copilot orchestration service.

Ties together conversation persistence, memory (summary + recent turns),
rolling compression, and the existing ``WorkflowGenerator`` core so the
in-editor copilot can hold a multi-turn, memory-bounded design dialogue.

Boundary: this is the only place that knows about *all* of the copilot's
moving parts. The generator core stays pure (it just receives a richer
``instruction`` that already embeds the conversation history) and the memory
service stays focused on compression. Controllers call only this service.

Flow per turn (see docs/design/workflow-copilot/memory-and-persistence.md §8):
  get/create conversation → load memory (Redis→DB) → assemble history →
  generate graph → persist user+assistant messages → compress if over
  threshold → refresh hot cache.
"""

import json
import logging
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.app.app_config.entities import ModelConfig
from core.helper.workflow_copilot_cache import CachedCopilotMessage, WorkflowCopilotMemoryCache
from core.model_manager import ModelManager
from core.workflow.generator import WorkflowGenerator
from core.workflow.generator.tool_catalogue import build_tool_catalogue, format_tool_catalogue, installed_tool_keys
from core.workflow.generator.types import WorkflowGenerateResultDict, WorkflowGenerationMode
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType
from models.workflow_copilot import WorkflowCopilotConversation, WorkflowCopilotMessage
from services.workflow_copilot_memory_service import WorkflowCopilotMemoryService

logger = logging.getLogger(__name__)


class WorkflowCopilotService:
    """Stateless facade for the copilot multi-turn generation flow."""

    @classmethod
    def generate(
        cls,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str,
        conversation_id: str | None,
        mode: WorkflowGenerationMode,
        message: str,
        model_config: ModelConfig,
        current_graph: dict[str, Any] | None = None,
        context_node_ids: list[str] | None = None,
    ) -> tuple[str, WorkflowGenerateResultDict]:
        """Run one copilot turn and return ``(conversation_id, generator_result)``.

        ``conversation_id`` is ``None`` for the first turn (a new conversation is
        created and its id returned). Errors from the LLM (auth, quota, invoke)
        propagate so the controller maps them to the shared HTTP envelope.

        ``context_node_ids`` are nodes the user pinned as focus context. Their
        FULL structure is resolved from ``current_graph`` and appended to the
        generator instruction only — the persisted user message stays clean, so
        history/reload never shows the synthetic context annotation.
        """
        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.provider,
            model=model_config.name,
        )
        memory_service = WorkflowCopilotMemoryService(model_instance)

        with Session(db.engine, expire_on_commit=False) as session:
            conversation = cls._get_or_create_conversation(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                account_id=account_id,
                conversation_id=conversation_id,
            )

            # 1. Assemble prior context (summary + recent verbatim turns) plus
            #    this turn's focus-node structures, and build the instruction the
            #    generator sees. The generator core stays untouched — it just
            #    sees a richer instruction. NOTE: the focus-context block is
            #    ephemeral (generator-only); it is NEVER persisted.
            memory = memory_service.load_memory(session, conversation)
            history_text = memory_service.build_history_text(memory["summary"], memory["recent_messages"])
            focus_text = cls._build_focus_context(current_graph, context_node_ids or [])
            effective_instruction = message
            if history_text:
                effective_instruction = f"{history_text}\n\n[Current request]\n{effective_instruction}"
            if focus_text:
                effective_instruction = f"{effective_instruction}\n\n{focus_text}"

            # 2. Persist the CLEAN user turn (no synthetic context) before
            #    generating so it survives an LLM failure and history stays
            #    faithful to what the user actually typed.
            cls._append_message(
                session=session,
                conversation=conversation,
                tenant_id=tenant_id,
                role="user",
                content=message,
                token_count=memory_service.count_tokens(message),
            )
            session.commit()

            # 3. Generate (may raise; controller maps to HTTP envelope).
            result = cls._invoke_generator(
                tenant_id=tenant_id,
                model_instance=model_instance,
                model_config=model_config,
                mode=mode,
                instruction=effective_instruction,
                current_graph=current_graph,
            )

            # 4. Persist the assistant reply, then compress + refresh cache.
            reply = result.get("message") or ""
            cls._append_message(
                session=session,
                conversation=conversation,
                tenant_id=tenant_id,
                role="assistant",
                content=reply,
                token_count=memory_service.count_tokens(reply),
            )
            session.commit()

            memory_service.compress_if_needed(session, conversation)
            session.commit()

            cls._refresh_cache(session, conversation, memory_service)

            return conversation.id, result

    @classmethod
    def list_conversations(cls, *, tenant_id: str, app_id: str, account_id: str) -> list[WorkflowCopilotConversation]:
        """Return the account's copilot conversations for an app, newest first."""
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = (
                select(WorkflowCopilotConversation)
                .where(
                    WorkflowCopilotConversation.tenant_id == tenant_id,
                    WorkflowCopilotConversation.app_id == app_id,
                    WorkflowCopilotConversation.account_id == account_id,
                )
                .order_by(WorkflowCopilotConversation.updated_at.desc())
            )
            return list(session.execute(stmt).scalars().all())

    @classmethod
    def delete_conversation(cls, *, tenant_id: str, conversation_id: str) -> None:
        """Delete a conversation, its messages, and its hot cache.

        Tenant-scoped so one tenant can't delete another's conversation. A
        missing conversation is a no-op (idempotent for the frontend).
        """
        with Session(db.engine, expire_on_commit=False) as session:
            conversation = session.execute(
                select(WorkflowCopilotConversation).where(
                    WorkflowCopilotConversation.id == conversation_id,
                    WorkflowCopilotConversation.tenant_id == tenant_id,
                )
            ).scalar_one_or_none()
            if not conversation:
                return
            session.execute(
                delete(WorkflowCopilotMessage).where(WorkflowCopilotMessage.conversation_id == conversation_id)
            )
            session.delete(conversation)
            session.commit()
        WorkflowCopilotMemoryCache(conversation_id).delete()

    @classmethod
    def list_messages(cls, *, tenant_id: str, conversation_id: str) -> list[WorkflowCopilotMessage]:
        """Return all messages of a conversation, oldest first (for panel reload)."""
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = (
                select(WorkflowCopilotMessage)
                .where(
                    WorkflowCopilotMessage.conversation_id == conversation_id,
                    WorkflowCopilotMessage.tenant_id == tenant_id,
                )
                .order_by(WorkflowCopilotMessage.created_at.asc())
            )
            return list(session.execute(stmt).scalars().all())

    @classmethod
    def _build_focus_context(
        cls,
        current_graph: dict[str, Any] | None,
        context_node_ids: list[str],
    ) -> str:
        """Resolve pinned node ids to their FULL structure from ``current_graph``.

        Returns a generator-only instruction block embedding each focus node's
        complete JSON (type, title, config) plus its incident edges, so the LLM
        edits the *actual* node rather than guessing from a bare id. Returns ""
        when there's nothing to focus on. Never persisted (see ``generate``).
        """
        if not current_graph or not context_node_ids:
            return ""
        nodes = current_graph.get("nodes") or []
        edges = current_graph.get("edges") or []
        wanted = set(context_node_ids)

        focus_nodes = [n for n in nodes if isinstance(n, dict) and n.get("id") in wanted]
        if not focus_nodes:
            return ""
        focus_edges = [
            e for e in edges if isinstance(e, dict) and (e.get("source") in wanted or e.get("target") in wanted)
        ]

        payload = {"nodes": focus_nodes, "edges": focus_edges}
        try:
            structure = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            return ""
        return (
            "[Focus on these existing nodes — full structure below]\n"
            "Amend/extend these specific nodes (match them by their `id`); "
            "keep every other node in the current graph unchanged:\n"
            f"{structure}"
        )

    @classmethod
    def _get_or_create_conversation(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        account_id: str,
        conversation_id: str | None,
    ) -> WorkflowCopilotConversation:
        if conversation_id:
            stmt = select(WorkflowCopilotConversation).where(
                WorkflowCopilotConversation.id == conversation_id,
                WorkflowCopilotConversation.tenant_id == tenant_id,
            )
            existing = session.execute(stmt).scalar_one_or_none()
            if existing:
                return existing

        conversation = WorkflowCopilotConversation()
        conversation.tenant_id = tenant_id
        conversation.app_id = app_id
        conversation.account_id = account_id
        session.add(conversation)
        session.flush()
        return conversation

    @classmethod
    def _append_message(
        cls,
        *,
        session: Session,
        conversation: WorkflowCopilotConversation,
        tenant_id: str,
        role: str,
        content: str,
        token_count: int,
    ) -> None:
        row = WorkflowCopilotMessage()
        row.conversation_id = conversation.id
        row.tenant_id = tenant_id
        row.role = role
        row.content = content
        row.tokens = token_count
        session.add(row)

    @classmethod
    def _invoke_generator(
        cls,
        *,
        tenant_id: str,
        model_instance: Any,
        model_config: ModelConfig,
        mode: WorkflowGenerationMode,
        instruction: str,
        current_graph: dict[str, Any] | None,
    ) -> WorkflowGenerateResultDict:
        """Call the generator core, mirroring ``WorkflowGeneratorService``.

        Reuses the same tool-catalogue plumbing so tool nodes can be picked /
        validated. A catalogue build failure degrades to the no-tool path
        rather than blocking generation.
        """
        model_parameters: dict[str, Any] = dict(model_config.completion_params or {})

        tool_catalogue_text = ""
        installed_tools: set[tuple[str, str]] | None = None
        try:
            entries = build_tool_catalogue(tenant_id)
            tool_catalogue_text = format_tool_catalogue(entries)
            installed_tools = installed_tool_keys(entries)
        except Exception:
            logger.exception("Workflow copilot: failed to build tool catalogue for tenant %s", tenant_id)

        return WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters=model_parameters,
            provider=model_config.provider,
            model_name=model_config.name,
            model_mode=model_config.mode.value,
            mode=mode,
            instruction=instruction,
            tool_catalogue_text=tool_catalogue_text,
            installed_tools=installed_tools,
            current_graph=current_graph,
        )

    @classmethod
    def _refresh_cache(
        cls,
        session: Session,
        conversation: WorkflowCopilotConversation,
        memory_service: WorkflowCopilotMemoryService,
    ) -> None:
        """Rebuild and store the hot cache after a completed turn."""
        recent = memory_service._load_unsummarized_messages(session, conversation)
        WorkflowCopilotMemoryCache(conversation.id).set(
            {
                "summary": conversation.summary or "",
                "recent_messages": [CachedCopilotMessage(role=m.role, content=m.content) for m in recent],
            }
        )
