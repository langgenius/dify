"""Unit tests for AgentAppGenerator._run_input_guards.

The guards apply content moderation + annotation reply before the Agent backend
call, mirroring the EasyUI chat runners. They can short-circuit the turn (a
blocked/preset moderation answer or a matched annotation) and publish a direct
answer, or pass through a possibly moderation-sanitized query.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import override
from unittest.mock import create_autospec

import pytest

import core.moderation.input_moderation as input_moderation_mod
from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import AgentAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
)
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from models.annotation_reply import AnnotationReplies, AnnotationReply
from models.model import App, AppMode, Message
from models.tool_runtime_contracts import WorkflowToolQueries
from repositories.app.generation_repository import AppGenerationRepository
from repositories.tools.provider_repository import ToolProviderRepository
from services.app.generation.adapters.agent_app import AgentAppGenerator
from services.app.generation.agent_config import AgentAppConfigurations
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.model_factories import make_app, make_message


class _FakeQueueManager(AppQueueManager):
    def __init__(self) -> None:
        self.events: list[AppQueueEvent] = []

    @override
    def publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        del pub_from
        self.events.append(event)

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        del pub_from
        self.events.append(event)


def _app_config() -> EasyUIBasedAppConfig:
    return EasyUIBasedAppConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        app_mode=AppMode.AGENT,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_id=None,
        app_model_config_dict={},
        model=ModelConfigEntity(provider="test-provider", model="gpt-4o-mini", mode="chat"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="Hello",
        ),
        additional_features=AppAdditionalFeatures(),
        variables=[],
    )


def _make_entity(query: str = "hello") -> AgentAppGenerateEntity:
    return AgentAppGenerateEntity(
        task_id="task-1",
        app_config=_app_config(),
        model_conf=make_model_config(provider="test-provider", model="gpt-4o-mini", mode="chat"),
        file_upload_config=None,
        conversation_id=None,
        inputs={},
        query=query,
        files=[],
        parent_message_id=None,
        trace_manager=None,
        user_id="user-1",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        call_depth=0,
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
        agent_config_version_kind="snapshot",
        agent_session_scope_config_version_id="snapshot-1",
        agent_llm_gateway_enabled=True,
    )


def _app() -> App:
    return make_app(
        app_id="app-1",
        tenant_id="tenant-1",
        name="Agent App",
        mode=AppMode.AGENT,
        icon_type=None,
    )


def _message() -> Message:
    return make_message(message_id="msg-1")


ModerationResult = tuple[bool, Mapping[str, object], str]


def _patch_moderation(
    monkeypatch: pytest.MonkeyPatch,
    *,
    returns: ModerationResult | None = None,
    raises: Exception | None = None,
) -> None:
    def check(_moderation: InputModeration, **_kwargs: object) -> ModerationResult:
        if raises is not None:
            raise raises
        if returns is None:
            raise AssertionError("a moderation result is required when no exception is configured")
        return returns

    monkeypatch.setattr(input_moderation_mod.InputModeration, "check", check)


def _patch_annotation(
    monkeypatch: pytest.MonkeyPatch,
    annotations: AnnotationReplies,
    *,
    reply: AnnotationReply | None,
) -> None:
    def query(**_kwargs: object) -> AnnotationReply | None:
        return reply

    monkeypatch.setattr(annotations, "query", query)


def _answer_text(events: list[AppQueueEvent]) -> str:
    end = next(e for e in events if isinstance(e, QueueMessageEndEvent))
    assert end.llm_result is not None
    content = end.llm_result.message.content
    assert isinstance(content, str)
    return content


def _saved_user_query(events: list[AppQueueEvent]) -> str:
    end = next(e for e in events if isinstance(e, QueueMessageEndEvent))
    assert end.llm_result is not None
    prompt_messages = end.llm_result.prompt_messages
    assert len(prompt_messages) == 1
    content = prompt_messages[0].content
    assert isinstance(content, str)
    return content


class TestRunInputGuards:
    def test_no_guards_passes_through(
        self,
        tool_providers: ToolProviderRepository,
        monkeypatch: pytest.MonkeyPatch,
        *,
        annotation_replies: AnnotationReplies,
        app_records: AppGenerationRepository,
    ) -> None:
        _patch_moderation(monkeypatch, returns=(False, {}, "hello"))
        _patch_annotation(monkeypatch, annotation_replies, reply=None)
        qm = _FakeQueueManager()

        handled, query, annotation_reply = AgentAppGenerator(
            agent_configs=create_autospec(AgentAppConfigurations, instance=True, spec_set=True),
            annotations=annotation_replies,
            records=app_records,
            tool_providers=tool_providers,
            workflow_queries=create_autospec(WorkflowToolQueries, instance=True, spec_set=True),
        )._run_input_guards(
            application_generate_entity=_make_entity("hello"),
            app_model=_app(),
            message=_message(),
            queue_manager=qm,
        )

        assert handled is False
        assert query == "hello"
        assert annotation_reply is None
        assert qm.events == []

    def test_moderation_override_sanitizes_query(
        self,
        tool_providers: ToolProviderRepository,
        monkeypatch: pytest.MonkeyPatch,
        *,
        annotation_replies: AnnotationReplies,
        app_records: AppGenerationRepository,
    ) -> None:
        _patch_moderation(monkeypatch, returns=(True, {}, "[redacted]"))
        _patch_annotation(monkeypatch, annotation_replies, reply=None)
        qm = _FakeQueueManager()

        handled, query, annotation_reply = AgentAppGenerator(
            agent_configs=create_autospec(AgentAppConfigurations, instance=True, spec_set=True),
            annotations=annotation_replies,
            records=app_records,
            tool_providers=tool_providers,
            workflow_queries=create_autospec(WorkflowToolQueries, instance=True, spec_set=True),
        )._run_input_guards(
            application_generate_entity=_make_entity("leak my secret"),
            app_model=_app(),
            message=_message(),
            queue_manager=qm,
        )

        assert handled is False
        assert query == "[redacted]"
        assert annotation_reply is None
        assert qm.events == []

    def test_moderation_block_short_circuits(
        self,
        tool_providers: ToolProviderRepository,
        monkeypatch: pytest.MonkeyPatch,
        *,
        annotation_replies: AnnotationReplies,
        app_records: AppGenerationRepository,
    ) -> None:
        _patch_moderation(monkeypatch, raises=ModerationError("blocked preset answer"))
        _patch_annotation(monkeypatch, annotation_replies, reply=None)
        qm = _FakeQueueManager()

        handled, _, annotation_reply = AgentAppGenerator(
            agent_configs=create_autospec(AgentAppConfigurations, instance=True, spec_set=True),
            annotations=annotation_replies,
            records=app_records,
            tool_providers=tool_providers,
            workflow_queries=create_autospec(WorkflowToolQueries, instance=True, spec_set=True),
        )._run_input_guards(
            application_generate_entity=_make_entity("forbidden"),
            app_model=_app(),
            message=_message(),
            queue_manager=qm,
        )

        assert handled is True
        assert annotation_reply is None
        assert any(isinstance(e, QueueLLMChunkEvent) for e in qm.events)
        assert _answer_text(qm.events) == "blocked preset answer"
        assert _saved_user_query(qm.events) == "forbidden"

    def test_annotation_hit_short_circuits(
        self,
        tool_providers: ToolProviderRepository,
        monkeypatch: pytest.MonkeyPatch,
        *,
        annotation_replies: AnnotationReplies,
        app_records: AppGenerationRepository,
    ) -> None:
        _patch_moderation(monkeypatch, returns=(False, {}, "what is your name"))
        annotation = AnnotationReply(
            id="anno-1",
            content="I am the annotated Iris.",
        )
        _patch_annotation(monkeypatch, annotation_replies, reply=annotation)
        qm = _FakeQueueManager()

        handled, _, annotation_reply = AgentAppGenerator(
            agent_configs=create_autospec(AgentAppConfigurations, instance=True, spec_set=True),
            annotations=annotation_replies,
            records=app_records,
            tool_providers=tool_providers,
            workflow_queries=create_autospec(WorkflowToolQueries, instance=True, spec_set=True),
        )._run_input_guards(
            application_generate_entity=_make_entity("what is your name"),
            app_model=_app(),
            message=_message(),
            queue_manager=qm,
        )

        assert handled is True
        assert annotation_reply is not None
        assert annotation_reply.id == "anno-1"
        assert qm.events == []
