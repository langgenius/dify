"""Persist prepared completions and roll back invalid payloads through real SQL.

The container generation suite checks that the write session closes before the
actual worker and provider requests; no thread scheduler is replaced here.
"""

import json
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import Session, sessionmaker

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


def _entity(invoke_from: InvokeFrom) -> CompletionAppGenerateEntity:
    return CompletionAppGenerateEntity(
        task_id=str(uuid4()),
        app_config=CompletionAppConfig(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            app_mode=AppMode.COMPLETION,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.ARGS,
            app_model_config_id=str(uuid4()),
            app_model_config_dict={"pre_prompt": "Historical prompt"},
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
        invoke_from=invoke_from,
        extras={},
    )


@pytest.mark.parametrize("invoke_from", [InvokeFrom.WEB_APP, InvokeFrom.EXPLORE])
def test_prepared_records_preserve_input_and_actor_ownership(
    sqlite_session_factory: sessionmaker[Session], invoke_from: InvokeFrom
) -> None:
    entity = _entity(invoke_from)
    with sqlite_session_factory(expire_on_commit=False) as session:
        conversation, message = CompletionAppGenerator()._init_generate_records(entity, session=session)
    with sqlite_session_factory() as verification:
        saved = verification.get(Message, message.id)
        saved_conversation = verification.get(Conversation, conversation.id)
        assert saved is not None
        assert saved_conversation is not None
        assert saved.query == entity.query
        assert saved._inputs == entity.inputs
        assert saved_conversation.app_model_config_id == entity.app_config.app_model_config_id
        assert saved_conversation.override_model_configs is not None
        assert json.loads(saved_conversation.override_model_configs) == {"pre_prompt": "Historical prompt"}
        if invoke_from == InvokeFrom.WEB_APP:
            assert saved.from_end_user_id == entity.user_id
            assert saved.from_account_id is None
        else:
            assert saved.from_account_id == entity.user_id
            assert saved.from_end_user_id is None
        assert verification.scalar(select(func.count()).select_from(Message)) == 1
        assert verification.scalar(select(func.count()).select_from(Conversation)) == 1
    assert entity.trace_manager is None
    assert entity.file_upload_config is None


def test_invalid_prepared_input_rolls_back_without_starting_a_worker(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    entity = _entity(InvokeFrom.WEB_APP)
    entity.inputs = {**entity.inputs, "invalid_json": object()}
    with pytest.raises(StatementError) as error:
        CompletionAppGenerator().generate_from_entity(entity, session_factory=sqlite_session_factory)
    assert isinstance(error.value.orig, TypeError)
    with sqlite_session_factory() as verification:
        assert verification.scalar(select(func.count()).select_from(Message)) == 0
        assert verification.scalar(select(func.count()).select_from(Conversation)) == 0
