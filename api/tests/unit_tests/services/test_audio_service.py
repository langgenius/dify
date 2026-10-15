"""Audio configuration preparation policy exercised against SQLite."""

import json
from decimal import Decimal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource, MessageStatus
from models.model import App, AppMode, AppModelConfig, Message
from models.workflow import Workflow, WorkflowType
from services.app_ref_service import AppRef, MessageRef
from services.audio_service import AudioService, PreparedTextToAudio
from services.errors.audio import SpeechToTextDisabledServiceError
from tests.unit_tests.model_factories import make_message

APP_ID = "11111111-1111-1111-1111-111111111111"
TENANT_ID = "22222222-2222-2222-2222-222222222222"
MESSAGE_ID = "33333333-3333-3333-3333-333333333333"
CONVERSATION_ID = "44444444-4444-4444-4444-444444444444"
END_USER_ID = "55555555-5555-5555-5555-555555555555"
ACCOUNT_ID = "66666666-6666-6666-6666-666666666666"
OTHER_ID = "77777777-7777-7777-7777-777777777777"


def _message(*, answer: str = "Message answer") -> Message:
    return make_message(
        message_id=MESSAGE_ID,
        app_id=APP_ID,
        conversation_id=CONVERSATION_ID,
        inputs={},
        query="Question",
        message={"role": "user", "content": "Question"},
        answer=answer,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        status=MessageStatus.NORMAL,
        from_source=ConversationFromSource.API,
        from_end_user_id=END_USER_ID,
        from_account_id=ACCOUNT_ID,
    )


class AudioServiceTestDataFactory:
    """
    Create real app configuration rows for preparation policy tests.
    """

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_app(
        self,
        app_id: str = APP_ID,
        mode: AppMode = AppMode.CHAT,
        tenant_id: str = TENANT_ID,
        *,
        workflow: Workflow | None = None,
        app_model_config: AppModelConfig | None = None,
        **kwargs: object,
    ) -> App:
        """
        Create and persist an App model.

        Args:
            app_id: Unique identifier for the app
            mode: App mode (CHAT, ADVANCED_CHAT, WORKFLOW, etc.)
            tenant_id: Tenant identifier
            **kwargs: Additional persisted model attributes

        Returns:
            Persisted App model with specified attributes
        """
        app = App(
            id=app_id,
            tenant_id=tenant_id,
            name="Audio test app",
            description="",
            mode=mode,
            icon_type=None,
            icon=None,
            icon_background=None,
            enable_site=False,
            enable_api=False,
            workflow_id=workflow.id if workflow else None,
            app_model_config_id=app_model_config.id if app_model_config else None,
        )
        for key, value in kwargs.items():
            setattr(app, key, value)
        self.session.add(app)
        self.session.commit()
        return app

    def create_workflow(self, features_dict: dict[str, object] | None = None, **kwargs: object) -> Workflow:
        """
        Create and persist a Workflow model.

        Args:
            features_dict: Dictionary of workflow features
            **kwargs: Additional persisted model attributes

        Returns:
            Persisted Workflow model with specified attributes
        """
        workflow = Workflow(
            id=kwargs.pop("id", str(uuid4())),
            tenant_id=kwargs.pop("tenant_id", TENANT_ID),
            app_id=kwargs.pop("app_id", APP_ID),
            type=kwargs.pop("type", WorkflowType.CHAT),
            version=kwargs.pop("version", Workflow.VERSION_DRAFT),
            graph=kwargs.pop("graph", "{}"),
            _features=json.dumps(features_dict or {}),
            created_by=kwargs.pop("created_by", ACCOUNT_ID),
        )
        for key, value in kwargs.items():
            setattr(workflow, key, value)
        self.session.add(workflow)
        self.session.commit()
        return workflow

    def create_app_model_config(
        self,
        speech_to_text_dict: dict[str, object] | None = None,
        text_to_speech_dict: dict[str, object] | None = None,
        *,
        app_id: str = APP_ID,
        **kwargs: object,
    ) -> AppModelConfig:
        """
        Create and persist an AppModelConfig model.

        Args:
            speech_to_text_dict: Speech-to-text configuration
            text_to_speech_dict: Text-to-speech configuration
            **kwargs: Additional persisted model attributes

        Returns:
            Persisted AppModelConfig model with specified attributes
        """
        config = AppModelConfig(
            app_id=app_id,
            speech_to_text=json.dumps(speech_to_text_dict or {"enabled": False}),
            text_to_speech=json.dumps(text_to_speech_dict or {"enabled": False}),
        )
        for key, value in kwargs.items():
            setattr(config, key, value)
        self.session.add(config)
        self.session.commit()
        return config


@pytest.fixture
def factory(sqlite_session: Session) -> AudioServiceTestDataFactory:
    """Provide the test data factory to all tests."""
    return AudioServiceTestDataFactory(sqlite_session)


class TestAudioServiceASRPreparation:
    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.WORKFLOW, AppMode.AGENT])
    @pytest.mark.parametrize("enabled", [False, True])
    def test_prepare_asr_uses_persisted_feature_configuration(
        self, factory: AudioServiceTestDataFactory, mode: AppMode, enabled: bool
    ) -> None:
        if mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = factory.create_workflow(features_dict={"speech_to_text": {"enabled": enabled}})
            app = factory.create_app(mode=mode, workflow=workflow)
        else:
            config = factory.create_app_model_config(speech_to_text_dict={"enabled": enabled})
            app = factory.create_app(mode=mode, app_model_config=config)

        if enabled:
            assert AudioService.prepare_asr(app, session=factory.session) is None
        else:
            with pytest.raises(SpeechToTextDisabledServiceError):
                AudioService.prepare_asr(app, session=factory.session)

    @pytest.mark.parametrize("enabled", [False, True])
    def test_prepare_asr_uses_published_agent_soul(self, factory: AudioServiceTestDataFactory, enabled: bool) -> None:
        app = factory.create_app(mode=AppMode.AGENT)
        agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": enabled}}})
        agent = Agent(
            tenant_id=app.tenant_id,
            app_id=app.id,
            name="Audio agent",
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
        )
        factory.session.add(agent)
        factory.session.flush()
        snapshot = AgentConfigSnapshot(
            tenant_id=app.tenant_id, agent_id=agent.id, version=1, config_snapshot=agent_soul
        )
        factory.session.add(snapshot)
        factory.session.flush()
        agent.active_config_snapshot_id = snapshot.id
        factory.session.commit()

        if enabled:
            assert AudioService.prepare_asr(app, session=factory.session) is None
        else:
            with pytest.raises(SpeechToTextDisabledServiceError):
                AudioService.prepare_asr(app, session=factory.session)

    @pytest.mark.parametrize(
        ("legacy_enabled", "soul_enabled", "allowed"),
        [(False, True, True), (True, None, True), (True, False, False), (False, None, False), (False, False, False)],
    )
    def test_prepare_agent_asr_applies_soul_override_and_legacy_fallback(
        self,
        factory: AudioServiceTestDataFactory,
        legacy_enabled: bool,
        soul_enabled: bool | None,
        allowed: bool,
    ) -> None:
        config = factory.create_app_model_config(speech_to_text_dict={"enabled": legacy_enabled})
        app = factory.create_app(mode=AppMode.AGENT, app_model_config=config)
        soul = (
            AgentSoulConfig()
            if soul_enabled is None
            else AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": soul_enabled}}})
        )

        if allowed:
            assert AudioService.prepare_agent_asr(app, soul, session=factory.session) is None
        else:
            with pytest.raises(SpeechToTextDisabledServiceError):
                AudioService.prepare_agent_asr(app, soul, session=factory.session)

    def test_prepare_asr_rejects_missing_workflow(self, factory: AudioServiceTestDataFactory) -> None:
        app = factory.create_app(mode=AppMode.WORKFLOW)
        with pytest.raises(SpeechToTextDisabledServiceError):
            AudioService.prepare_asr(app, session=factory.session)


class TestAudioServiceTTSPreparation:
    def test_prepare_tts_preserves_the_callers_uncommitted_transaction(
        self, factory: AudioServiceTestDataFactory, sqlite_session: Session
    ) -> None:
        app = factory.create_app()
        sqlite_session.add(_message())
        sqlite_session.flush()
        transaction = sqlite_session.get_transaction()

        result = AudioService.prepare_tts(
            app,
            session=sqlite_session,
            message_ref=MessageRef(
                app=AppRef(tenant_id=TENANT_ID, app_id=APP_ID), message_id=MESSAGE_ID, account_id=ACCOUNT_ID
            ),
            voice="pending-voice",
        )

        assert result == PreparedTextToAudio(text="Message answer", voice="pending-voice")
        assert sqlite_session.get_transaction() is transaction
        sqlite_session.rollback()
        assert sqlite_session.get(Message, MESSAGE_ID) is None

    @pytest.mark.parametrize("voice", ["default-voice", None])
    def test_prepare_tts_resolves_configured_voice(
        self, factory: AudioServiceTestDataFactory, voice: str | None
    ) -> None:
        config = factory.create_app_model_config(text_to_speech_dict={"enabled": True, "voice": voice})
        app = factory.create_app(app_model_config=config)

        result = AudioService.prepare_tts(app, session=factory.session, text="Test")

        assert result == PreparedTextToAudio(text="Test", voice=voice)

    def test_prepare_tts_reads_draft_workflow_from_the_provided_session(
        self, factory: AudioServiceTestDataFactory
    ) -> None:
        factory.create_workflow(features_dict={"text_to_speech": {"enabled": True, "voice": "draft-voice"}})
        app = factory.create_app(mode=AppMode.WORKFLOW)
        # WorkflowService constructs its default repository from db.engine. Keep
        # that database empty so the draft must come from the provided session.
        flask_app = Flask(__name__)
        flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
        db.init_app(flask_app)
        with flask_app.app_context():
            try:
                result = AudioService.prepare_tts(app, session=factory.session, text="Draft test", is_draft=True)
            finally:
                db.session.remove()
                db.engine.dispose()

        assert result == PreparedTextToAudio(text="Draft test", voice="draft-voice")

    def test_prepare_tts_applies_message_ownership_in_the_provided_session(
        self, factory: AudioServiceTestDataFactory
    ) -> None:
        app = factory.create_app()
        factory.session.add(_message())
        factory.session.commit()
        for app_id, end_user_id, account_id in (
            (OTHER_ID, END_USER_ID, ACCOUNT_ID),
            (APP_ID, OTHER_ID, ACCOUNT_ID),
            (APP_ID, END_USER_ID, OTHER_ID),
        ):
            assert (
                AudioService.prepare_tts(
                    app,
                    session=factory.session,
                    message_ref=MessageRef(
                        app=AppRef(tenant_id=TENANT_ID, app_id=app_id),
                        message_id=MESSAGE_ID,
                        end_user_id=end_user_id,
                        account_id=account_id,
                    ),
                    voice="message-voice",
                )
                is None
            )

        result = AudioService.prepare_tts(
            app,
            session=factory.session,
            message_ref=MessageRef(
                app=AppRef(tenant_id=TENANT_ID, app_id=APP_ID),
                message_id=MESSAGE_ID,
                end_user_id=END_USER_ID,
                account_id=ACCOUNT_ID,
            ),
            voice="message-voice",
        )

        assert result == PreparedTextToAudio(text="Message answer", voice="message-voice")

    def test_prepare_tts_rejects_missing_text(self, factory: AudioServiceTestDataFactory) -> None:
        app = factory.create_app()
        with pytest.raises(ValueError, match="Text is required"):
            AudioService.prepare_tts(app, session=factory.session)
