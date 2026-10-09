"""Prepared completions persist once before starting the generation worker."""

from collections.abc import Callable, Generator
from typing import cast, override
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, InvokeFrom
from models import AppMode, Conversation, Message
from tests.unit_tests.core.model_fixtures import make_model_config


def _entity() -> CompletionAppGenerateEntity:
    return CompletionAppGenerateEntity(
        task_id=str(uuid4()),
        app_config=CompletionAppConfig(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            app_mode=AppMode.COMPLETION,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.ARGS,
            app_model_config_id=str(uuid4()),
            app_model_config_dict={},
            additional_features=AppAdditionalFeatures(),
            model=ModelConfigEntity(provider="test-provider", model="test-model"),
            prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
        ),
        model_conf=make_model_config(provider="test-provider", model="test-model", mode="completion"),
        inputs={"original": "  input  "},
        files=[],
        query="  original query  ",
        user_id=str(uuid4()),
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
    )


def test_prepared_records_commit_and_close_before_worker_start(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    entity = _entity()
    sessions: list[Session] = []
    closed: list[Session] = []
    started: list[Callable[[], object]] = []

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            super().close()
            closed.append(self)

    factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], class_=TrackedSession, expire_on_commit=True)

    @event.listens_for(factory, "after_transaction_create")
    def record_session(session: Session, _transaction: SessionTransaction) -> None:
        if session not in sessions:
            sessions.append(session)

    class DeferredThread:
        """Hold the external worker scheduler; the real request pipeline still runs."""

        def __init__(self, *, target: Callable[[], object]) -> None:
            self.target = target

        def start(self) -> None:
            assert sessions
            assert all(session in closed for session in sessions)
            assert all(not session.in_transaction() and not session.identity_map for session in sessions)
            with sqlite_session_factory() as session:
                saved = session.scalar(select(Message).where(Message.app_id == entity.app_config.app_id))
                assert saved is not None
                assert saved.query == entity.query
                assert saved.inputs_with_session(session=session) == entity.inputs
            started.append(self.target)

    monkeypatch.setattr("core.app.apps.completion.app_generator.threading.Thread", DeferredThread)
    app = Flask(__name__)
    with app.test_request_context():
        response = CompletionAppGenerator().generate_from_entity(
            entity, session_factory=cast(sessionmaker[Session], factory)
        )
        assert isinstance(response, Generator)
        response.close()

    assert len(started) == 1
    assert entity.trace_manager is None
    assert entity.file_upload_config is None
    with sqlite_session_factory() as session:
        conversations = session.scalars(
            select(Conversation).where(Conversation.app_id == entity.app_config.app_id)
        ).all()
        assert len(conversations) == 1
        assert conversations[0].app_model_config_id == entity.app_config.app_model_config_id
