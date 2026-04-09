import datetime
import math
import uuid

import pytest
from sqlalchemy import delete

from core.db.session_factory import session_factory
from models import Tenant
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import (
    App,
    Conversation,
    Message,
    MessageAnnotation,
    MessageFeedback,
)
from services.retention.conversation.messages_clean_policy import BillingDisabledPolicy
from services.retention.conversation.messages_clean_service import MessagesCleanService

_NOW = datetime.datetime(2026, 1, 15, 12, 0, 0, tzinfo=datetime.UTC)
_OLD = _NOW - datetime.timedelta(days=60)
_VERY_OLD = _NOW - datetime.timedelta(days=90)
_RECENT = _NOW - datetime.timedelta(days=5)

_WINDOW_START = _VERY_OLD - datetime.timedelta(hours=1)
_WINDOW_END = _RECENT + datetime.timedelta(hours=1)

_DEFAULT_BATCH_SIZE = 100
_PAGINATION_MESSAGE_COUNT = 25
_PAGINATION_BATCH_SIZE = 8


@pytest.fixture
def tenant_and_app(flask_req_ctx):
    """Creates a Tenant, App and Conversation for the test and cleans up after."""
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

        tenant_id = tenant.id
        app_id = app.id
        conv_id = conv.id

    yield {"tenant_id": tenant_id, "app_id": app_id, "conversation_id": conv_id}

    with session_factory.create_session() as session:
        session.execute(delete(Conversation).where(Conversation.id == conv_id))
        session.execute(delete(App).where(App.id == app_id))
        session.execute(delete(Tenant).where(Tenant.id == tenant_id))
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
        """Seeds one message at each of _VERY_OLD, _OLD, and _RECENT.
        Yields a semantic mapping keyed by age label.
        """
        data = tenant_and_app
        app_id = data["app_id"]
        conv_id = data["conversation_id"]
        # Ordered tuple of (label, timestamp) for deterministic seeding
        timestamps = [
            ("very_old", _VERY_OLD),
            ("old", _OLD),
            ("recent", _RECENT),
        ]
        msg_ids: dict[str, str] = {}

        with session_factory.create_session() as session:
            for label, ts in timestamps:
                msg = _make_message(app_id, conv_id, ts)
                session.add(msg)
                session.flush()
                msg_ids[label] = msg.id
            session.commit()

        yield {"msg_ids": msg_ids, **data}

        with session_factory.create_session() as session:
            session.execute(
                delete(Message)
                .where(Message.id.in_(list(msg_ids.values())))
                .execution_options(synchronize_session=False)
            )
            session.commit()

    @pytest.fixture
    def paginated_seed_messages(self, tenant_and_app):
        """Seeds multiple messages separated by 1-second increments starting at _OLD."""
        data = tenant_and_app
        app_id = data["app_id"]
        conv_id = data["conversation_id"]
        msg_ids: list[str] = []

        with session_factory.create_session() as session:
            for i in range(_PAGINATION_MESSAGE_COUNT):
                ts = _OLD + datetime.timedelta(seconds=i)
                msg = _make_message(app_id, conv_id, ts)
                session.add(msg)
                session.flush()
                msg_ids.append(msg.id)
            session.commit()

        yield {"msg_ids": msg_ids, **data}

        with session_factory.create_session() as session:
            session.execute(delete(Message).where(Message.id.in_(msg_ids)).execution_options(synchronize_session=False))
            session.commit()

    @pytest.fixture
    def cascade_test_data(self, tenant_and_app):
        """Seeds one Message with an associated Feedback and Annotation."""
        data = tenant_and_app
        app_id = data["app_id"]
        conv_id = data["conversation_id"]

        with session_factory.create_session() as session:
            msg = _make_message(app_id, conv_id, _OLD)
            session.add(msg)
            session.flush()

            feedback = MessageFeedback(
                app_id=app_id,
                conversation_id=conv_id,
                message_id=msg.id,
                rating=FeedbackRating.LIKE,
                from_source=FeedbackFromSource.USER,
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

        yield {"msg_id": msg_id, "fb_id": fb_id, "ann_id": ann_id, **data}

        with session_factory.create_session() as session:
            session.execute(delete(MessageAnnotation).where(MessageAnnotation.id == ann_id))
            session.execute(delete(MessageFeedback).where(MessageFeedback.id == fb_id))
            session.execute(delete(Message).where(Message.id == msg_id))
            session.commit()

    def test_dry_run_does_not_delete(self, seed_messages):
        """Dry-run must count eligible rows without deleting any of them."""
        data = seed_messages
        msg_ids = data["msg_ids"]
        all_ids = list(msg_ids.values())

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=_WINDOW_START,
            end_before=_WINDOW_END,
            batch_size=_DEFAULT_BATCH_SIZE,
            dry_run=True,
        )
        stats = svc.run()

        assert stats["filtered_messages"] == len(all_ids)
        assert stats["total_deleted"] == 0

        with session_factory.create_session() as session:
            remaining = session.query(Message).where(Message.id.in_(all_ids)).count()
        assert remaining == len(all_ids)

    def test_billing_disabled_deletes_all_in_range(self, seed_messages):
        """All 3 seeded messages fall within the window and must be deleted."""
        data = seed_messages
        msg_ids = data["msg_ids"]
        all_ids = list(msg_ids.values())

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=_WINDOW_START,
            end_before=_WINDOW_END,
            batch_size=_DEFAULT_BATCH_SIZE,
            dry_run=False,
        )
        stats = svc.run()

        assert stats["total_deleted"] == len(all_ids)

        with session_factory.create_session() as session:
            remaining = session.query(Message).where(Message.id.in_(all_ids)).count()
        assert remaining == 0

    def test_start_from_filters_correctly(self, seed_messages):
        """Only the message at _OLD falls within the narrow ±1 h window."""
        data = seed_messages
        msg_ids = data["msg_ids"]

        start = _OLD - datetime.timedelta(hours=1)
        end = _OLD + datetime.timedelta(hours=1)

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=start,
            end_before=end,
            batch_size=_DEFAULT_BATCH_SIZE,
        )
        stats = svc.run()

        assert stats["total_deleted"] == 1

        with session_factory.create_session() as session:
            all_ids = list(msg_ids.values())
            remaining_ids = {r[0] for r in session.query(Message.id).where(Message.id.in_(all_ids)).all()}

        assert msg_ids["old"] not in remaining_ids
        assert msg_ids["very_old"] in remaining_ids
        assert msg_ids["recent"] in remaining_ids

    def test_cursor_pagination_across_batches(self, paginated_seed_messages):
        """Messages must be deleted across multiple batches."""
        data = paginated_seed_messages
        msg_ids = data["msg_ids"]

        # _OLD is the earliest; the last one is _OLD + (_PAGINATION_MESSAGE_COUNT - 1) s.
        pagination_window_start = _OLD - datetime.timedelta(seconds=1)
        pagination_window_end = _OLD + datetime.timedelta(seconds=_PAGINATION_MESSAGE_COUNT)

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=pagination_window_start,
            end_before=pagination_window_end,
            batch_size=_PAGINATION_BATCH_SIZE,
        )
        stats = svc.run()

        assert stats["total_deleted"] == _PAGINATION_MESSAGE_COUNT
        expected_batches = math.ceil(_PAGINATION_MESSAGE_COUNT / _PAGINATION_BATCH_SIZE)
        assert stats["batches"] >= expected_batches

        with session_factory.create_session() as session:
            remaining = session.query(Message).where(Message.id.in_(msg_ids)).count()
        assert remaining == 0

    def test_no_messages_in_range_returns_empty_stats(self, seed_messages):
        """A window entirely in the future must yield zero matches."""
        far_future = _NOW + datetime.timedelta(days=365)
        even_further = far_future + datetime.timedelta(days=1)

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=far_future,
            end_before=even_further,
            batch_size=_DEFAULT_BATCH_SIZE,
        )
        stats = svc.run()

        assert stats["total_messages"] == 0
        assert stats["total_deleted"] == 0

    def test_relation_cascade_deletes(self, cascade_test_data):
        """Deleting a Message must cascade to its Feedback and Annotation rows."""
        data = cascade_test_data
        msg_id = data["msg_id"]
        fb_id = data["fb_id"]
        ann_id = data["ann_id"]

        svc = MessagesCleanService.from_time_range(
            policy=BillingDisabledPolicy(),
            start_from=_OLD - datetime.timedelta(hours=1),
            end_before=_OLD + datetime.timedelta(hours=1),
            batch_size=_DEFAULT_BATCH_SIZE,
        )
        stats = svc.run()

        assert stats["total_deleted"] == 1

        with session_factory.create_session() as session:
            assert session.query(Message).where(Message.id == msg_id).count() == 0
            assert session.query(MessageFeedback).where(MessageFeedback.id == fb_id).count() == 0
            assert session.query(MessageAnnotation).where(MessageAnnotation.id == ann_id).count() == 0

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
