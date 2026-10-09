"""Opt-in fixtures for production agent configuration, queues and SQLite records."""

from collections.abc import Iterator
from datetime import datetime

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.agent.entities import AgentEntity, AgentPromptEntity
from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom, ModelConfigEntity, PromptTemplateEntity
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, InvokeFrom
from core.entities.provider_entities import CustomProviderConfiguration
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message
from tests.unit_tests.core.model_fixtures import make_model_config

PROVIDER = "langgenius/openai/openai"


@pytest.fixture
def agent_queue_manager(monkeypatch: pytest.MonkeyPatch) -> Iterator[MessageBasedAppQueueManager]:
    """Use the production queue and Redis wrapper; isolate only Redis commands."""
    with Redis() as client:
        monkeypatch.setattr(client, "execute_command", lambda *_args, **_kwargs: None)
        redis = RedisClientWrapper()
        redis.initialize(client)
        monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", redis)
        monkeypatch.setattr("core.plugin.impl.model_runtime.redis_client", redis)
        yield MessageBasedAppQueueManager(
            task_id="task",
            user_id="user",
            invoke_from=InvokeFrom.SERVICE_API,
            conversation_id="conv",
            app_mode=AppMode.AGENT_CHAT,
            message_id="msg",
        )


@pytest.fixture
def agent_runtime_app(sqlite_engine: Engine) -> Iterator[Flask]:
    """Bind production agent-thought writes to the same SQLite database as setup reads."""
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = sqlite_engine.url
    db.init_app(app)
    with app.app_context():
        try:
            yield app
        finally:
            db.engine.dispose()


@pytest.fixture
def agent_generate_entity(monkeypatch: pytest.MonkeyPatch) -> AgentChatAppGenerateEntity:
    model_config = make_model_config(provider=PROVIDER, model="m", mode=LLMMode.CHAT)
    model_config.credentials = {"api_key": "token"}
    model_config.model_schema.model_properties = {ModelPropertyKey.MODE: LLMMode.CHAT}
    bundle = model_config.provider_model_bundle
    bundle.configuration.tenant_id = "tenant"
    bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials=model_config.credentials
    )
    bundle.model_type_instance = LargeLanguageModel(
        provider_schema=bundle.configuration.provider, model_runtime=create_plugin_model_runtime(tenant_id="tenant")
    )
    monkeypatch.setattr(PluginModelClient, "get_model_schema", lambda *_args, **_kwargs: model_config.model_schema)
    return AgentChatAppGenerateEntity(
        task_id="task",
        app_config=AgentChatAppConfig(
            app_id="app1",
            tenant_id="tenant",
            app_mode=AppMode.AGENT_CHAT,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_dict={},
            model=ModelConfigEntity(provider=PROVIDER, model="m", mode=LLMMode.CHAT),
            prompt_template=PromptTemplateEntity(
                prompt_type=PromptTemplateEntity.PromptType.SIMPLE, simple_prompt_template="Help the user."
            ),
            agent=AgentEntity(
                provider=PROVIDER,
                model="m",
                strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
                prompt=AgentPromptEntity(
                    first_prompt=(
                        "{{instruction}} {{tools}} {{tool_names}} {{historic_messages}} {{query}} {{agent_scratchpad}}"
                    ),
                    next_iteration="continue",
                ),
            ),
        ),
        model_conf=model_config,
        inputs={},
        query="q",
        files=[],
        stream=True,
        user_id="user",
        invoke_from=InvokeFrom.SERVICE_API,
    )


@pytest.fixture
def agent_records(sqlite_session: Session) -> tuple[Conversation, Message]:
    app = App(
        id="app1",
        tenant_id="tenant",
        name="Agent chat app",
        description="",
        mode=AppMode.AGENT_CHAT,
        enable_site=False,
        enable_api=False,
    )
    conversation = Conversation(
        id="conv",
        app_id=app.id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.AGENT_CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=None,
        from_account_id="user",
    )
    message = Message(
        id="msg",
        app_id=app.id,
        conversation_id=conversation.id,
        inputs={},
        query="q",
        message={},
        message_tokens=0,
        message_unit_price=0,
        message_price_unit=0,
        answer="",
        answer_tokens=0,
        answer_unit_price=0,
        answer_price_unit=0,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=None,
        from_account_id="user",
        app_mode=AppMode.AGENT_CHAT,
        created_at=datetime(2025, 1, 1),
    )
    sqlite_session.add_all([app, conversation, message])
    sqlite_session.commit()
    return conversation, message
