"""Unit tests for AgentAppGenerator._run_input_guards.

The guards apply content moderation + annotation reply before the Agent backend
call, mirroring the EasyUI chat runners. They can short-circuit the turn (a
blocked/preset moderation answer or a matched annotation) and publish a direct
answer, or pass through a possibly moderation-sanitized query.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

import core.app.features.annotation_reply.annotation_reply as annotation_mod
import core.moderation.input_moderation as input_moderation_mod
from core.app.apps.agent_app.app_generator import AgentAppGenerator
from core.app.entities.queue_entities import (
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
)
from core.moderation.base import ModerationError


class _FakeQueueManager:
    def __init__(self) -> None:
        self.events: list[Any] = []

    def publish(self, event: Any, _from: Any) -> None:
        self.events.append(event)


def _make_entity(query: str = "hello") -> SimpleNamespace:
    return SimpleNamespace(
        app_config=SimpleNamespace(app_id="app-1", tenant_id="tenant-1"),
        model_conf=SimpleNamespace(model="gpt-4o-mini"),
        inputs={},
        query=query,
        trace_manager=None,
        user_id="user-1",
        invoke_from=SimpleNamespace(),
    )


def _patch_moderation(monkeypatch: pytest.MonkeyPatch, *, returns=None, raises: Exception | None = None) -> None:
    class _FakeModeration:
        def check(self, **kwargs: Any):
            if raises is not None:
                raise raises
            return returns

    monkeypatch.setattr(input_moderation_mod, "InputModeration", _FakeModeration)


def _patch_annotation(monkeypatch: pytest.MonkeyPatch, *, reply=None) -> None:
    class _FakeAnnotation:
        def query(self, **kwargs: Any):
            return reply

    monkeypatch.setattr(annotation_mod, "AnnotationReplyFeature", _FakeAnnotation)


def _answer_text(events: list[Any]) -> str:
    end = next(e for e in events if isinstance(e, QueueMessageEndEvent))
    return end.llm_result.message.content


def _saved_user_query(events: list[Any]) -> str:
    end = next(e for e in events if isinstance(e, QueueMessageEndEvent))
    prompt_messages = end.llm_result.prompt_messages
    assert len(prompt_messages) == 1
    return prompt_messages[0].content


class TestRunInputGuards:
    def test_no_guards_passes_through(self, monkeypatch: pytest.MonkeyPatch):
        _patch_moderation(monkeypatch, returns=(False, {}, "hello"))
        _patch_annotation(monkeypatch, reply=None)
        qm = _FakeQueueManager()

        handled, query, annotation_reply = AgentAppGenerator()._run_input_guards(
            session=MagicMock(),
            application_generate_entity=_make_entity("hello"),
            app_model=SimpleNamespace(id="app-1"),
            message=SimpleNamespace(id="msg-1"),
            queue_manager=qm,
        )

        assert handled is False
        assert query == "hello"
        assert annotation_reply is None
        assert qm.events == []

    def test_moderation_override_sanitizes_query(self, monkeypatch: pytest.MonkeyPatch):
        _patch_moderation(monkeypatch, returns=(True, {}, "[redacted]"))
        _patch_annotation(monkeypatch, reply=None)
        qm = _FakeQueueManager()

        handled, query, annotation_reply = AgentAppGenerator()._run_input_guards(
            session=MagicMock(),
            application_generate_entity=_make_entity("leak my secret"),
            app_model=SimpleNamespace(id="app-1"),
            message=SimpleNamespace(id="msg-1"),
            queue_manager=qm,
        )

        assert handled is False
        assert query == "[redacted]"
        assert annotation_reply is None
        assert qm.events == []

    def test_moderation_block_short_circuits(self, monkeypatch: pytest.MonkeyPatch):
        _patch_moderation(monkeypatch, raises=ModerationError("blocked preset answer"))
        _patch_annotation(monkeypatch, reply=None)
        qm = _FakeQueueManager()

        handled, _, annotation_reply = AgentAppGenerator()._run_input_guards(
            session=MagicMock(),
            application_generate_entity=_make_entity("forbidden"),
            app_model=SimpleNamespace(id="app-1"),
            message=SimpleNamespace(id="msg-1"),
            queue_manager=qm,
        )

        assert handled is True
        assert annotation_reply is None
        assert any(isinstance(e, QueueLLMChunkEvent) for e in qm.events)
        assert _answer_text(qm.events) == "blocked preset answer"
        assert _saved_user_query(qm.events) == "forbidden"

    def test_annotation_hit_short_circuits(self, monkeypatch: pytest.MonkeyPatch):
        _patch_moderation(monkeypatch, returns=(False, {}, "what is your name"))
        _patch_annotation(monkeypatch, reply=SimpleNamespace(id="anno-1", content="I am the annotated Iris."))
        qm = _FakeQueueManager()

        handled, _, annotation_reply = AgentAppGenerator()._run_input_guards(
            session=MagicMock(),
            application_generate_entity=_make_entity("what is your name"),
            app_model=SimpleNamespace(id="app-1"),
            message=SimpleNamespace(id="msg-1"),
            queue_manager=qm,
        )

        assert handled is True
        assert annotation_reply.id == "anno-1"
        assert qm.events == []
