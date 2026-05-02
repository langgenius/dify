from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from graphon.variables import FloatVariable, IntegerVariable, StringVariable
from models.account import Account, Tenant, TenantAccountJoin
from models.enums import ConversationFromSource
from models.model import App, Conversation, EndUser
from models.workflow import ConversationVariable
from services.conversation_service import ConversationService
from services.errors.conversation import (
    ConversationVariableNotExistsError,
    ConversationVariableTypeMismatchError,
    LastConversationNotExistsError,
)


class ConversationServiceVariableIntegrationFactory:
    @staticmethod
    def create_app_and_account(db_session_with_containers):
        tenant = Tenant(name=f"Tenant {uuid4()}")
        db_session_with_containers.add(tenant)
        db_session_with_containers.flush()

        account = Account(
            name=f"Account {uuid4()}",
            email=f"conversation-variable-{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.flush()

        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role="owner",
            current=True,
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.flush()

        app = App(
            tenant_id=tenant.id,
            name=f"App {uuid4()}",
            description="",
            mode="chat",
            icon_type="emoji",
            icon="bot",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=True,
            api_rpm=100,
            api_rph=100,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=account.id,
            updated_by=account.id,
        )
        db_session_with_containers.add(app)
        db_session_with_containers.commit()

        return app, account

    @staticmethod
    def create_end_user(db_session_with_containers, app: App):
        end_user = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=InvokeFrom.SERVICE_API.value,
            external_user_id=f"external-{uuid4()}",
            name=f"End User {uuid4()}",
            is_anonymous=False,
            session_id=f"session-{uuid4()}",
        )
        db_session_with_containers.add(end_user)
        db_session_with_containers.commit()
        return end_user

    @staticmethod
    def create_conversation(
        db_session_with_containers,
        app: App,
        user: Account | EndUser,
        *,
        name: str | None = None,
        invoke_from: InvokeFrom = InvokeFrom.WEB_APP,
        created_at: datetime | None = None,
        updated_at: datetime | None = None,
    ) -> Conversation:
        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=None,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            mode=app.mode,
            name=name or f"Conversation {uuid4()}",
            summary="",
            inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status="normal",
            invoke_from=invoke_from.value,
            from_source=ConversationFromSource.API if isinstance(user, EndUser) else ConversationFromSource.CONSOLE,
            from_end_user_id=user.id if isinstance(user, EndUser) else None,
            from_account_id=user.id if isinstance(user, Account) else None,
            dialogue_count=0,
            is_deleted=False,
        )
        conversation.inputs = {}
        if created_at is not None:
            conversation.created_at = created_at
        if updated_at is not None:
            conversation.updated_at = updated_at

        db_session_with_containers.add(conversation)
        db_session_with_containers.commit()
        return conversation

    @staticmethod
    def create_variable(
        db_session_with_containers,
        *,
        app: App,
        conversation: Conversation,
        variable: StringVariable | FloatVariable | IntegerVariable,
        created_at: datetime | None = None,
    ) -> ConversationVariable:
        row = ConversationVariable.from_variable(app_id=app.id, conversation_id=conversation.id, variable=variable)
        if created_at is not None:
            row.created_at = created_at
            row.updated_at = created_at

        db_session_with_containers.add(row)
        db_session_with_containers.commit()
        return row


@pytest.fixture
def real_conversation_service_session_factory(flask_app_with_containers: Flask):
    del flask_app_with_containers
    real_session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)

    with (
        patch("services.conversation_service.session_factory.create_session", side_effect=lambda: real_session_maker()),
        patch("services.conversation_service.session_factory.get_session_maker", return_value=real_session_maker),
    ):
        yield


class TestConversationServiceVariables:
    def test_get_conversational_variable_success(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)
        older_time = datetime(2024, 1, 1, 12, 0, 0)
        newer_time = older_time + timedelta(minutes=5)

        first_variable = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=StringVariable(id=str(uuid4()), name="topic", value="billing"),
            created_at=older_time,
        )
        second_variable = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=StringVariable(id=str(uuid4()), name="priority", value="high"),
            created_at=newer_time,
        )

        result = ConversationService.get_conversational_variable(
            app_model=app,
            conversation_id=conversation.id,
            user=account,
            limit=10,
            last_id=None,
        )

        assert [item["id"] for item in result.data] == [first_variable.id, second_variable.id]
        assert [item["name"] for item in result.data] == ["topic", "priority"]
        assert result.limit == 10
        assert result.has_more is False

    def test_get_conversational_variable_with_last_id(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)
        base_time = datetime(2024, 1, 1, 9, 0, 0)

        first_variable = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=StringVariable(id=str(uuid4()), name="topic", value="billing"),
            created_at=base_time,
        )
        second_variable = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=StringVariable(id=str(uuid4()), name="priority", value="high"),
            created_at=base_time + timedelta(minutes=1),
        )
        third_variable = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=StringVariable(id=str(uuid4()), name="owner", value="alice"),
            created_at=base_time + timedelta(minutes=2),
        )

        result = ConversationService.get_conversational_variable(
            app_model=app,
            conversation_id=conversation.id,
            user=account,
            limit=10,
            last_id=first_variable.id,
        )

        assert [item["id"] for item in result.data] == [second_variable.id, third_variable.id]
        assert result.has_more is False

    def test_get_conversational_variable_last_id_not_found_raises_error(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)

        with pytest.raises(ConversationVariableNotExistsError):
            ConversationService.get_conversational_variable(
                app_model=app,
                conversation_id=conversation.id,
                user=account,
                limit=10,
                last_id=str(uuid4()),
            )

    def test_get_conversational_variable_sets_has_more(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)

        for index in range(3):
            factory.create_variable(
                db_session_with_containers,
                app=app,
                conversation=conversation,
                variable=StringVariable(id=str(uuid4()), name=f"var_{index}", value=f"value_{index}"),
                created_at=datetime(2024, 1, 1, 10, 0, index),
            )

        result = ConversationService.get_conversational_variable(
            app_model=app,
            conversation_id=conversation.id,
            user=account,
            limit=2,
            last_id=None,
        )

        assert len(result.data) == 2
        assert result.has_more is True

    def test_update_conversation_variable_success(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)
        existing = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=StringVariable(id=str(uuid4()), name="topic", value="billing"),
        )
        updated_at = datetime(2024, 1, 1, 15, 0, 0)

        with patch("services.conversation_service.naive_utc_now", return_value=updated_at):
            result = ConversationService.update_conversation_variable(
                app_model=app,
                conversation_id=conversation.id,
                variable_id=existing.id,
                user=account,
                new_value="support",
            )

        db_session_with_containers.expire_all()
        persisted = db_session_with_containers.get(ConversationVariable, (existing.id, conversation.id))

        assert persisted is not None
        assert persisted.to_variable().value == "support"
        assert result["id"] == existing.id
        assert result["value"] == "support"
        assert result["updated_at"] == updated_at

    def test_update_conversation_variable_not_found_raises_error(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)

        with pytest.raises(ConversationVariableNotExistsError):
            ConversationService.update_conversation_variable(
                app_model=app,
                conversation_id=conversation.id,
                variable_id=str(uuid4()),
                user=account,
                new_value="support",
            )

    def test_update_conversation_variable_type_mismatch_raises_error(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)
        existing = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=FloatVariable(id=str(uuid4()), name="score", value=1.5),
        )

        with pytest.raises(ConversationVariableTypeMismatchError, match="expects float"):
            ConversationService.update_conversation_variable(
                app_model=app,
                conversation_id=conversation.id,
                variable_id=existing.id,
                user=account,
                new_value="wrong-type",
            )

    def test_update_conversation_variable_integer_number_compatibility(
        self, db_session_with_containers: Session, real_conversation_service_session_factory
    ):
        del real_conversation_service_session_factory
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        conversation = factory.create_conversation(db_session_with_containers, app, account)
        existing = factory.create_variable(
            db_session_with_containers,
            app=app,
            conversation=conversation,
            variable=IntegerVariable(id=str(uuid4()), name="attempts", value=1),
        )

        result = ConversationService.update_conversation_variable(
            app_model=app,
            conversation_id=conversation.id,
            variable_id=existing.id,
            user=account,
            new_value=42,
        )

        db_session_with_containers.expire_all()
        persisted = db_session_with_containers.get(ConversationVariable, (existing.id, conversation.id))

        assert persisted is not None
        assert persisted.to_variable().value == 42
        assert result["value"] == 42


class TestConversationServicePaginationWithContainers:
    def test_pagination_by_last_id_raises_error_when_last_id_missing(self, db_session_with_containers: Session):
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)

        with pytest.raises(LastConversationNotExistsError):
            ConversationService.pagination_by_last_id(
                session=db_session_with_containers,
                app_model=app,
                user=account,
                last_id=str(uuid4()),
                limit=20,
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_pagination_by_last_id_with_default_desc_updated_at(self, db_session_with_containers: Session):
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        base_time = datetime(2024, 1, 1, 8, 0, 0)
        newest = factory.create_conversation(
            db_session_with_containers,
            app,
            account,
            name="Newest",
            updated_at=base_time + timedelta(minutes=2),
        )
        middle = factory.create_conversation(
            db_session_with_containers,
            app,
            account,
            name="Middle",
            updated_at=base_time + timedelta(minutes=1),
        )
        oldest = factory.create_conversation(
            db_session_with_containers,
            app,
            account,
            name="Oldest",
            updated_at=base_time,
        )

        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app,
            user=account,
            last_id=middle.id,
            limit=10,
            invoke_from=InvokeFrom.WEB_APP,
        )

        assert newest.id != middle.id
        assert [conversation.id for conversation in result.data] == [oldest.id]

    def test_pagination_by_last_id_with_name_sort(self, db_session_with_containers: Session):
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        alpha = factory.create_conversation(db_session_with_containers, app, account, name="Alpha")
        beta = factory.create_conversation(db_session_with_containers, app, account, name="Beta")
        gamma = factory.create_conversation(db_session_with_containers, app, account, name="Gamma")

        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app,
            user=account,
            last_id=beta.id,
            limit=10,
            invoke_from=InvokeFrom.WEB_APP,
            sort_by="name",
        )

        assert alpha.id != beta.id
        assert [conversation.id for conversation in result.data] == [gamma.id]

    def test_pagination_filters_to_end_user_api_source(self, db_session_with_containers: Session):
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        end_user = factory.create_end_user(db_session_with_containers, app)
        account_conversation = factory.create_conversation(
            db_session_with_containers,
            app,
            account,
            name="Console Conversation",
            invoke_from=InvokeFrom.WEB_APP,
        )
        end_user_conversation = factory.create_conversation(
            db_session_with_containers,
            app,
            end_user,
            name="API Conversation",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app,
            user=end_user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.SERVICE_API,
        )

        assert account_conversation.id != end_user_conversation.id
        assert [conversation.id for conversation in result.data] == [end_user_conversation.id]

    def test_pagination_filters_to_account_console_source(self, db_session_with_containers: Session):
        factory = ConversationServiceVariableIntegrationFactory
        app, account = factory.create_app_and_account(db_session_with_containers)
        end_user = factory.create_end_user(db_session_with_containers, app)
        account_conversation = factory.create_conversation(
            db_session_with_containers,
            app,
            account,
            name="Console Conversation",
            invoke_from=InvokeFrom.WEB_APP,
        )
        factory.create_conversation(
            db_session_with_containers,
            app,
            end_user,
            name="API Conversation",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app,
            user=account,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
        )

        assert [conversation.id for conversation in result.data] == [account_conversation.id]
