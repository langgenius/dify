import datetime
import uuid

import pytest
from sqlalchemy import delete

from core.db.session_factory import session_factory
from models import Tenant
from models.model import (
    App,
    Conversation,
    Message,
    MessageAnnotation,
    MessageFeedback,
)
from services.retention.conversation.messages_clean_policy import BillingDisabledPolicy
from services.retention.conversation.messages_clean_service import MessagesCleanService

_NOW = datetime.datetime(2026, 1, 15, 12, 0, 0)
_OLD = _NOW - datetime.timedelta(days=60)
_VERY_OLD = _NOW - datetime.timedelta(days=90)
_RECENT = _NOW - datetime.timedelta(days=5)


@pytest.fixture
def tenant_and_app(flask_req_ctx):
    with session_factory.create_session() as session:
        tenant = Tenant(name="retention_it_tenant")
        session.add(tenant)
        session.flush()

        app = App(
            tenant_id=tenant.id,
            name="Retention IT App",
            mode="chat",
            enable_site=True,
            enable_api=True,
        )
        session.add(app)
        session.flush()

        conv = Conversation(
            app_id=app.id,
            mode="chat",
            name="test_conv",
            status="normal",
            from_source="console",
            _inputs={},
        )
        session.add(conv)
        session.commit()

    yield {"tenant": tenant, "app": app, "conversation": conv}

    with session_factory.create_session() as session:
        session.execute(delete(Conversation).where(Conversation.id == conv.id))
        session.execute(delete(App).where(App.id == app.id))
        session.execute(delete(Tenant).where(Tenant.id == tenant.id))
        session.commit()


def _make_message(app_id: str, conversation_id: str, created_at: datetime.datetime) -> Message:
    return Message(
        app_id=app_id,
        conversation_id=conversation_id,
        query="test",
        message=[{"text": "hello"}],
        answer="world",
        message_tokens=1,
        message_unit_price=0,
        answer_tokens=1,
        answer_unit_price=0,
        from_source="console",
        currency="USD",
        _inputs={},
        created_at=created_at,
    )


class TestMessagesCleanServiceIntegration:
    @pytest.fixture
    def seed_messages(self, tenant_and_app):
        data = tenant_and_app
        app_id = data["app"].id
        conv_id = data["conversation"].id
        msg_ids: list[str] = []

        with session_factory.create_session() as session:
            for ts in [_VERY_OLD, _OLD, _RECENT]:
                msg = _make_message(app_id, conv_id, ts)
                session.add(msg)
                session.flush()
                msg_ids.append(msg.id)
            session.commit()

        yield {"msg_ids": msg_ids, **data}

        with session_factory.create_session() as session:
            session.execute(delete(Message).where(Message.id.in_(msg_ids)).execution_options(synchronize_session=False))
            session.commit()

    def test_dry_run_does_not_delete(self, seed_messages):
        data = seed_messages
        app_id = data["app"].id
        msg_ids = data["msg_ids"]

        svc = MessagesCleanService(
            policy=BillingDisabledPolicy(),
            end_before=_NOW,
            batch_size=100,
            dry_run=True,
        )
        stats = svc.run()

        assert stats["filtered_messages"] >= len(msg_ids)
        assert stats["total_deleted"] == 0

        with session_factory.create_session() as session:
            remaining = session.query(Message).where(Message.id.in_(msg_ids)).count()
        assert remaining == len(msg_ids)

    def test_billing_disabled_deletes_all_in_range(self, seed_messages):
        data = seed_messages
        msg_ids = data["msg_ids"]

        svc = MessagesCleanService(
            policy=BillingDisabledPolicy(),
            end_before=_NOW,
            batch_size=100,
            dry_run=False,
        )
        stats = svc.run()

        assert stats["total_deleted"] >= len(msg_ids)

        with session_factory.create_session() as session:
            remaining = session.query(Message).where(Message.id.in_(msg_ids)).count()
        assert remaining == 0

    def test_start_from_filters_correctly(self, seed_messages):
        data = seed_messages
        msg_ids = data["msg_ids"]

        start = _OLD - datetime.timedelta(hours=1)
        end = _OLD + datetime.timedelta(hours=1)

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=start,
            end_before=end,
            batch_size=100,
        )
        stats = svc.run()

        assert stats["total_deleted"] == 1

        with session_factory.create_session() as session:
            remaining_ids = {r[0] for r in session.query(Message.id).where(Message.id.in_(msg_ids)).all()}
        assert msg_ids[1] not in remaining_ids
        assert msg_ids[0] in remaining_ids
        assert msg_ids[2] in remaining_ids

    def test_cursor_pagination_across_batches(self, tenant_and_app):
        data = tenant_and_app
        app_id = data["app"].id
        conv_id = data["conversation"].id
        msg_ids: list[str] = []

        with session_factory.create_session() as session:
            for i in range(25):
                ts = _OLD + datetime.timedelta(seconds=i)
                msg = _make_message(app_id, conv_id, ts)
                session.add(msg)
                session.flush()
                msg_ids.append(msg.id)
            session.commit()

        try:
            svc = MessagesCleanService(
                policy=BillingDisabledPolicy(),
                end_before=_NOW,
                start_from=_OLD - datetime.timedelta(seconds=1),
                batch_size=8,
                dry_run=False,
            )
            stats = svc.run()

            assert stats["total_deleted"] == 25
            assert stats["batches"] >= 4

            with session_factory.create_session() as session:
                remaining = session.query(Message).where(Message.id.in_(msg_ids)).count()
            assert remaining == 0
        finally:
            with session_factory.create_session() as session:
                session.execute(
                    delete(Message).where(Message.id.in_(msg_ids)).execution_options(synchronize_session=False)
                )
                session.commit()

    def test_no_messages_in_range_returns_empty_stats(self, seed_messages):
        far_future = _NOW + datetime.timedelta(days=365)
        even_further = far_future + datetime.timedelta(days=1)

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=far_future,
            end_before=even_further,
            batch_size=100,
        )
        stats = svc.run()

        assert stats["total_messages"] == 0
        assert stats["total_deleted"] == 0

    def test_relation_cascade_deletes(self, tenant_and_app):
        data = tenant_and_app
        app_id = data["app"].id
        conv_id = data["conversation"].id

        with session_factory.create_session() as session:
            msg = _make_message(app_id, conv_id, _OLD)
            session.add(msg)
            session.flush()

            feedback = MessageFeedback(
                app_id=app_id,
                conversation_id=conv_id,
                message_id=msg.id,
                rating="like",
                from_source="user",
            )
            annotation = MessageAnnotation(
                app_id=app_id,
                conversation_id=conv_id,
                message_id=msg.id,
                question="q",
                content="a",
                account_id=str(uuid.uuid4()),
            )
            session.add_all([feedback, annotation])
            session.commit()
            msg_id = msg.id
            fb_id = feedback.id
            ann_id = annotation.id

        try:
            svc = MessagesCleanService(
                policy=BillingDisabledPolicy(),
                end_before=_NOW,
                start_from=_OLD - datetime.timedelta(hours=1),
                batch_size=100,
                dry_run=False,
            )
            stats = svc.run()

            assert stats["total_deleted"] == 1

            with session_factory.create_session() as session:
                assert session.query(Message).where(Message.id == msg_id).count() == 0
                assert session.query(MessageFeedback).where(MessageFeedback.id == fb_id).count() == 0
                assert session.query(MessageAnnotation).where(MessageAnnotation.id == ann_id).count() == 0
        finally:
            with session_factory.create_session() as session:
                session.execute(delete(MessageAnnotation).where(MessageAnnotation.id == ann_id))
                session.execute(delete(MessageFeedback).where(MessageFeedback.id == fb_id))
                session.execute(delete(Message).where(Message.id == msg_id))
                session.commit()

    def test_factory_from_time_range_validation(self):
        with pytest.raises(ValueError, match="start_from"):
            MessagesCleanService.from_time_range(
                policy=BillingDisabledPolicy(),
                start_from=_NOW,
                end_before=_OLD,
            )

    def test_factory_from_days_validation(self):
        with pytest.raises(ValueError, match="days"):
            MessagesCleanService.from_days(
                policy=BillingDisabledPolicy(),
                days=-1,
            )

    def test_factory_batch_size_validation(self):
        with pytest.raises(ValueError, match="batch_size"):
            MessagesCleanService.from_time_range(
                policy=BillingDisabledPolicy(),
                start_from=_OLD,
                end_before=_NOW,
                batch_size=0,
            )
