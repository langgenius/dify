"""Unit tests for feedback exports using SQLite-backed ORM rows.

The export query joins five tables and applies its filters in SQL, so these tests
use a real SQLite session instead of stubbing ``Session.execute`` results.
"""

import json
from datetime import datetime
from decimal import Decimal
from typing import TypedDict

import pytest
from sqlalchemy.orm import Session

from models.account import Account
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, Conversation, ConversationFromSource, IconType, Message, MessageFeedback
from services.feedback_service import FeedbackService

APP_ID = "11111111-1111-1111-1111-111111111111"
TENANT_ID = "22222222-2222-2222-2222-222222222222"
CONVERSATION_ID = "33333333-3333-3333-3333-333333333333"
MESSAGE_ID = "44444444-4444-4444-4444-444444444444"
ACCOUNT_ID = "55555555-5555-5555-5555-555555555555"
END_USER_ID = "66666666-6666-6666-6666-666666666666"


class FeedbackSample(TypedDict):
    app: App
    conversation: Conversation
    message: Message
    user_feedback: MessageFeedback
    admin_feedback: MessageFeedback


@pytest.fixture
def sample_data(sqlite_session: Session) -> FeedbackSample:
    """Persist a complete user/admin feedback graph for export queries."""

    app = App(
        tenant_id=TENANT_ID,
        name="Test App",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="🤖",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    app.id = APP_ID
    conversation = Conversation(
        app_id=APP_ID,
        mode=AppMode.CHAT,
        name="Test Conversation",
        from_source=ConversationFromSource.API,
        from_end_user_id=END_USER_ID,
    )
    conversation.id = CONVERSATION_ID
    conversation._inputs = {}
    message = Message(
        app_id=APP_ID,
        conversation_id=CONVERSATION_ID,
        query="What is AI?",
        message={"role": "user", "content": "What is AI?"},
        answer="AI is artificial intelligence.",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=END_USER_ID,
        created_at=datetime(2024, 1, 1, 10, 0, 0),
    )
    message.id = MESSAGE_ID
    message._inputs = {"query": "What is AI?"}
    account = Account(name="Admin User", email="admin@example.com")
    account.id = ACCOUNT_ID
    user_feedback = MessageFeedback(
        app_id=APP_ID,
        conversation_id=CONVERSATION_ID,
        message_id=MESSAGE_ID,
        rating=FeedbackRating.LIKE,
        from_source=FeedbackFromSource.USER,
        content="Great answer!",
        from_end_user_id=END_USER_ID,
    )
    user_feedback.created_at = datetime(2024, 1, 1, 10, 5, 0)
    admin_feedback = MessageFeedback(
        app_id=APP_ID,
        conversation_id=CONVERSATION_ID,
        message_id=MESSAGE_ID,
        rating=FeedbackRating.DISLIKE,
        from_source=FeedbackFromSource.ADMIN,
        content="Could be more detailed",
        from_account_id=ACCOUNT_ID,
    )
    admin_feedback.created_at = datetime(2024, 1, 1, 10, 10, 0)
    sqlite_session.add_all([app, conversation, message, account, user_feedback, admin_feedback])
    sqlite_session.commit()
    return {
        "app": app,
        "conversation": conversation,
        "message": message,
        "user_feedback": user_feedback,
        "admin_feedback": admin_feedback,
    }


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Conversation, Message, MessageFeedback, Account)],
    indirect=True,
)
class TestFeedbackService:
    """Exercise feedback export formatting and its database-side filters."""

    def test_export_feedbacks_csv_format(self, sqlite_session: Session, sample_data: FeedbackSample) -> None:
        result = FeedbackService.export_feedbacks(
            app_id=APP_ID,
            session=sqlite_session,
            from_source=FeedbackFromSource.USER,
            format_type="csv",
        )

        assert "text/csv" in result.headers["Content-Type"]
        assert "attachment" in result.headers["Content-Disposition"]
        csv_content = result.get_data(as_text=True)
        assert "feedback_id" in csv_content
        assert "app_name" in csv_content
        assert "conversation_id" in csv_content
        assert sample_data["app"].name in csv_content
        assert sample_data["message"].query in csv_content
        assert sample_data["user_feedback"].content in csv_content
        assert sample_data["admin_feedback"].content not in csv_content

    def test_export_feedbacks_json_format(self, sqlite_session: Session, sample_data: FeedbackSample) -> None:
        result = FeedbackService.export_feedbacks(
            app_id=APP_ID,
            session=sqlite_session,
            from_source=FeedbackFromSource.ADMIN,
            format_type="json",
        )

        assert "application/json" in result.headers["Content-Type"]
        assert "attachment" in result.headers["Content-Disposition"]
        json_content = json.loads(result.get_data(as_text=True))
        assert json_content["export_info"]["app_id"] == APP_ID
        assert json_content["export_info"]["total_records"] == 1
        assert json_content["feedback_data"][0]["from_account_name"] == "Admin User"

    def test_export_feedbacks_with_filters(self, sqlite_session: Session, sample_data: FeedbackSample) -> None:
        result = FeedbackService.export_feedbacks(
            app_id=APP_ID,
            session=sqlite_session,
            from_source=FeedbackFromSource.ADMIN,
            rating=FeedbackRating.DISLIKE,
            has_comment=True,
            start_date="2024-01-01",
            end_date="2024-12-31",
            format_type="csv",
        )

        csv_content = result.get_data(as_text=True)
        assert sample_data["admin_feedback"].content in csv_content
        assert sample_data["user_feedback"].content not in csv_content
        assert len([line for line in csv_content.strip().splitlines() if line.strip()]) == 2

    def test_export_feedbacks_no_data(self, sqlite_session: Session, sample_data: FeedbackSample) -> None:
        result = FeedbackService.export_feedbacks(
            app_id="77777777-7777-7777-7777-777777777777",
            session=sqlite_session,
            format_type="csv",
        )

        csv_content = result.get_data(as_text=True)
        assert "text/csv" in result.headers["Content-Type"]
        assert "feedback_id" in csv_content
        assert "app_name" in csv_content
        assert "conversation_id" in csv_content
        assert len([line for line in csv_content.strip().splitlines() if line.strip()]) == 1

    def test_export_feedbacks_invalid_date_format(
        self, sqlite_session: Session, sample_data: FeedbackSample
    ) -> None:
        with pytest.raises(ValueError, match="Invalid start_date format"):
            FeedbackService.export_feedbacks(
                app_id=APP_ID,
                session=sqlite_session,
                start_date="invalid-date-format",
            )

        with pytest.raises(ValueError, match="Invalid end_date format"):
            FeedbackService.export_feedbacks(
                app_id=APP_ID,
                session=sqlite_session,
                end_date="invalid-date-format",
            )

    def test_export_feedbacks_invalid_format(self, sqlite_session: Session, sample_data: FeedbackSample) -> None:
        with pytest.raises(ValueError, match="Unsupported format"):
            FeedbackService.export_feedbacks(app_id=APP_ID, session=sqlite_session, format_type="xml")

    def test_export_feedbacks_long_response_truncation(
        self, sqlite_session: Session, sample_data: FeedbackSample
    ) -> None:
        sample_data["message"].answer = "A" * 600
        sqlite_session.commit()

        result = FeedbackService.export_feedbacks(
            app_id=APP_ID,
            session=sqlite_session,
            from_source=FeedbackFromSource.USER,
            format_type="json",
        )

        exported_answer = json.loads(result.get_data(as_text=True))["feedback_data"][0]["ai_response"]
        assert exported_answer == "A" * 500 + "..."

    def test_export_feedbacks_unicode_content(self, sqlite_session: Session, sample_data: FeedbackSample) -> None:
        sample_data["message"].query = "什么是人工智能？"
        sample_data["message"].answer = "人工智能是模拟人类智能的技术。"
        sample_data["user_feedback"].content = "回答不够详细，需要更多信息"
        sqlite_session.commit()

        result = FeedbackService.export_feedbacks(
            app_id=APP_ID,
            session=sqlite_session,
            from_source=FeedbackFromSource.USER,
            format_type="csv",
        )

        csv_content = result.get_data(as_text=True)
        assert "什么是人工智能？" in csv_content
        assert "回答不够详细，需要更多信息" in csv_content
        assert "人工智能是模拟人类智能的技术" in csv_content

    def test_export_feedbacks_emoji_ratings(self, sqlite_session: Session, sample_data: FeedbackSample) -> None:
        result = FeedbackService.export_feedbacks(app_id=APP_ID, session=sqlite_session, format_type="json")

        feedback_data = json.loads(result.get_data(as_text=True))["feedback_data"]
        assert len(feedback_data) == 2
        like_feedback = next(item for item in feedback_data if item["feedback_rating_raw"] == "like")
        dislike_feedback = next(item for item in feedback_data if item["feedback_rating_raw"] == "dislike")
        assert like_feedback["feedback_rating"] == "👍"
        assert dislike_feedback["feedback_rating"] == "👎"
