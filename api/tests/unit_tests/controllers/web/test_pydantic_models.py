"""Unit tests for Pydantic models defined in controllers.web modules.

Covers validation logic, field defaults, constraints, and custom validators
for all ~15 Pydantic models across the web controller layer.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

# ---------------------------------------------------------------------------
# app.py models
# ---------------------------------------------------------------------------
from controllers.web.app import AppAccessModeQuery


class TestAppAccessModeQuery:
    def test_alias_resolution(self) -> None:
        q = AppAccessModeQuery.model_validate({"appId": "abc", "appCode": "xyz"})
        assert q.app_id == "abc"
        assert q.app_code == "xyz"

    def test_defaults_to_none(self) -> None:
        q = AppAccessModeQuery.model_validate({})
        assert q.app_id is None
        assert q.app_code is None

    def test_accepts_snake_case(self) -> None:
        q = AppAccessModeQuery(app_id="id1", app_code="code1")
        assert q.app_id == "id1"
        assert q.app_code == "code1"


# ---------------------------------------------------------------------------
# audio.py models
# ---------------------------------------------------------------------------
from controllers.web.audio import TextToAudioPayload


class TestTextToAudioPayload:
    def test_defaults(self) -> None:
        p = TextToAudioPayload.model_validate({})
        assert p.message_id is None
        assert p.voice is None
        assert p.text is None
        assert p.streaming is None

    def test_valid_uuid_message_id(self) -> None:
        uid = str(uuid4())
        p = TextToAudioPayload(message_id=uid)
        assert p.message_id == uid

    def test_none_message_id_passthrough(self) -> None:
        p = TextToAudioPayload(message_id=None)
        assert p.message_id is None

    def test_invalid_uuid_message_id(self) -> None:
        with pytest.raises(ValidationError, match="not a valid uuid"):
            TextToAudioPayload(message_id="not-a-uuid")


# ---------------------------------------------------------------------------
# completion.py models
# ---------------------------------------------------------------------------
from controllers.web.completion import ChatMessagePayload, CompletionMessagePayload


class TestCompletionMessagePayload:
    def test_defaults(self) -> None:
        p = CompletionMessagePayload(inputs={})
        assert p.query == ""
        assert p.files is None
        assert p.response_mode is None
        assert p.retriever_from == "web_app"

    def test_accepts_full_payload(self) -> None:
        p = CompletionMessagePayload(
            inputs={"key": "val"},
            query="test",
            files=[{"id": "f1"}],
            response_mode="streaming",
        )
        assert p.response_mode == "streaming"
        assert p.files == [{"id": "f1"}]

    def test_invalid_response_mode(self) -> None:
        with pytest.raises(ValidationError):
            CompletionMessagePayload(inputs={}, response_mode="invalid")


class TestChatMessagePayload:
    def test_valid_uuid_fields(self) -> None:
        cid = str(uuid4())
        pid = str(uuid4())
        p = ChatMessagePayload(inputs={}, query="hi", conversation_id=cid, parent_message_id=pid)
        assert p.conversation_id == cid
        assert p.parent_message_id == pid

    def test_none_uuid_fields(self) -> None:
        p = ChatMessagePayload(inputs={}, query="hi")
        assert p.conversation_id is None
        assert p.parent_message_id is None

    def test_invalid_conversation_id(self) -> None:
        with pytest.raises(ValidationError, match="not a valid uuid"):
            ChatMessagePayload(inputs={}, query="hi", conversation_id="bad")

    def test_invalid_parent_message_id(self) -> None:
        with pytest.raises(ValidationError, match="not a valid uuid"):
            ChatMessagePayload(inputs={}, query="hi", parent_message_id="bad")

    def test_query_required(self) -> None:
        with pytest.raises(ValidationError):
            ChatMessagePayload(inputs={})


# ---------------------------------------------------------------------------
# conversation.py models
# ---------------------------------------------------------------------------
from controllers.web.conversation import ConversationListQuery, ConversationRenamePayload


class TestConversationListQuery:
    def test_defaults(self) -> None:
        q = ConversationListQuery()
        assert q.last_id is None
        assert q.limit == 20
        assert q.pinned is None
        assert q.sort_by == "-updated_at"

    def test_limit_lower_bound(self) -> None:
        with pytest.raises(ValidationError):
            ConversationListQuery(limit=0)

    def test_limit_upper_bound(self) -> None:
        with pytest.raises(ValidationError):
            ConversationListQuery(limit=101)

    def test_limit_boundaries_valid(self) -> None:
        assert ConversationListQuery(limit=1).limit == 1
        assert ConversationListQuery(limit=100).limit == 100

    def test_valid_sort_by_options(self) -> None:
        for opt in ("created_at", "-created_at", "updated_at", "-updated_at"):
            assert ConversationListQuery(sort_by=opt).sort_by == opt

    def test_invalid_sort_by(self) -> None:
        with pytest.raises(ValidationError):
            ConversationListQuery(sort_by="invalid")

    def test_valid_last_id(self) -> None:
        uid = str(uuid4())
        assert ConversationListQuery(last_id=uid).last_id == uid

    def test_invalid_last_id(self) -> None:
        with pytest.raises(ValidationError, match="not a valid uuid"):
            ConversationListQuery(last_id="not-uuid")


class TestConversationRenamePayload:
    def test_auto_generate_true_no_name_required(self) -> None:
        p = ConversationRenamePayload(auto_generate=True)
        assert p.name is None

    def test_auto_generate_false_requires_name(self) -> None:
        with pytest.raises(ValidationError, match="name is required"):
            ConversationRenamePayload(auto_generate=False)

    def test_auto_generate_false_blank_name_rejected(self) -> None:
        with pytest.raises(ValidationError, match="name is required"):
            ConversationRenamePayload(auto_generate=False, name="   ")

    def test_auto_generate_false_with_valid_name(self) -> None:
        p = ConversationRenamePayload(auto_generate=False, name="My Chat")
        assert p.name == "My Chat"

    def test_defaults(self) -> None:
        p = ConversationRenamePayload(name="test")
        assert p.auto_generate is False
        assert p.name == "test"


# ---------------------------------------------------------------------------
# message.py models
# ---------------------------------------------------------------------------
from controllers.web.message import MessageFeedbackPayload, MessageListQuery, MessageMoreLikeThisQuery


class TestMessageListQuery:
    def test_valid_query(self) -> None:
        cid = str(uuid4())
        q = MessageListQuery(conversation_id=cid)
        assert q.conversation_id == cid
        assert q.first_id is None
        assert q.limit == 20

    def test_invalid_conversation_id(self) -> None:
        with pytest.raises(ValidationError, match="not a valid uuid"):
            MessageListQuery(conversation_id="bad")

    def test_limit_bounds(self) -> None:
        cid = str(uuid4())
        with pytest.raises(ValidationError):
            MessageListQuery(conversation_id=cid, limit=0)
        with pytest.raises(ValidationError):
            MessageListQuery(conversation_id=cid, limit=101)

    def test_valid_first_id(self) -> None:
        cid = str(uuid4())
        fid = str(uuid4())
        q = MessageListQuery(conversation_id=cid, first_id=fid)
        assert q.first_id == fid

    def test_invalid_first_id(self) -> None:
        cid = str(uuid4())
        with pytest.raises(ValidationError, match="not a valid uuid"):
            MessageListQuery(conversation_id=cid, first_id="invalid")


class TestMessageFeedbackPayload:
    def test_defaults(self) -> None:
        p = MessageFeedbackPayload()
        assert p.rating is None
        assert p.content is None

    def test_valid_ratings(self) -> None:
        assert MessageFeedbackPayload(rating="like").rating == "like"
        assert MessageFeedbackPayload(rating="dislike").rating == "dislike"

    def test_invalid_rating(self) -> None:
        with pytest.raises(ValidationError):
            MessageFeedbackPayload(rating="neutral")


class TestMessageMoreLikeThisQuery:
    def test_valid_modes(self) -> None:
        assert MessageMoreLikeThisQuery(response_mode="blocking").response_mode == "blocking"
        assert MessageMoreLikeThisQuery(response_mode="streaming").response_mode == "streaming"

    def test_invalid_mode(self) -> None:
        with pytest.raises(ValidationError):
            MessageMoreLikeThisQuery(response_mode="invalid")

    def test_required(self) -> None:
        with pytest.raises(ValidationError):
            MessageMoreLikeThisQuery()


# ---------------------------------------------------------------------------
# remote_files.py models
# ---------------------------------------------------------------------------
from controllers.web.remote_files import RemoteFileUploadPayload


class TestRemoteFileUploadPayload:
    def test_valid_url(self) -> None:
        p = RemoteFileUploadPayload(url="https://example.com/file.pdf")
        assert str(p.url) == "https://example.com/file.pdf"

    def test_invalid_url(self) -> None:
        with pytest.raises(ValidationError):
            RemoteFileUploadPayload(url="not-a-url")

    def test_url_required(self) -> None:
        with pytest.raises(ValidationError):
            RemoteFileUploadPayload()


# ---------------------------------------------------------------------------
# saved_message.py models
# ---------------------------------------------------------------------------
from controllers.web.saved_message import SavedMessageCreatePayload, SavedMessageListQuery


class TestSavedMessageListQuery:
    def test_defaults(self) -> None:
        q = SavedMessageListQuery()
        assert q.last_id is None
        assert q.limit == 20

    def test_limit_bounds(self) -> None:
        with pytest.raises(ValidationError):
            SavedMessageListQuery(limit=0)
        with pytest.raises(ValidationError):
            SavedMessageListQuery(limit=101)

    def test_valid_last_id(self) -> None:
        uid = str(uuid4())
        q = SavedMessageListQuery(last_id=uid)
        assert q.last_id == uid

    def test_empty_last_id(self) -> None:
        q = SavedMessageListQuery(last_id="")
        assert q.last_id == ""


class TestSavedMessageCreatePayload:
    def test_valid_message_id(self) -> None:
        uid = str(uuid4())
        p = SavedMessageCreatePayload(message_id=uid)
        assert p.message_id == uid

    def test_required(self) -> None:
        with pytest.raises(ValidationError):
            SavedMessageCreatePayload()


# ---------------------------------------------------------------------------
# workflow.py models
# ---------------------------------------------------------------------------
from controllers.web.workflow import WorkflowRunPayload


class TestWorkflowRunPayload:
    def test_defaults(self) -> None:
        p = WorkflowRunPayload(inputs={})
        assert p.inputs == {}
        assert p.files is None

    def test_with_files(self) -> None:
        p = WorkflowRunPayload(inputs={"k": "v"}, files=[{"id": "f1"}])
        assert p.files == [{"id": "f1"}]

    def test_inputs_required(self) -> None:
        with pytest.raises(ValidationError):
            WorkflowRunPayload()


# ---------------------------------------------------------------------------
# forgot_password.py models
# ---------------------------------------------------------------------------
from controllers.web.forgot_password import (
    ForgotPasswordCheckPayload,
    ForgotPasswordResetPayload,
    ForgotPasswordSendPayload,
)


class TestForgotPasswordSendPayload:
    def test_valid_email(self) -> None:
        p = ForgotPasswordSendPayload(email="user@example.com")
        assert p.email == "user@example.com"

    def test_invalid_email(self) -> None:
        with pytest.raises(ValidationError, match="not a valid email"):
            ForgotPasswordSendPayload(email="not-an-email")

    def test_language_optional(self) -> None:
        p = ForgotPasswordSendPayload(email="a@b.com")
        assert p.language is None


class TestForgotPasswordCheckPayload:
    def test_valid(self) -> None:
        p = ForgotPasswordCheckPayload(email="a@b.com", code="1234", token="tok")
        assert p.email == "a@b.com"
        assert p.code == "1234"
        assert p.token == "tok"

    def test_empty_token_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ForgotPasswordCheckPayload(email="a@b.com", code="1234", token="")


class TestForgotPasswordResetPayload:
    def test_valid_passwords(self) -> None:
        p = ForgotPasswordResetPayload(token="tok", new_password="Valid1234", password_confirm="Valid1234")
        assert p.new_password == "Valid1234"

    def test_weak_password_rejected(self) -> None:
        with pytest.raises(ValidationError, match="Password must contain"):
            ForgotPasswordResetPayload(token="tok", new_password="short", password_confirm="short")

    def test_letters_only_password_rejected(self) -> None:
        with pytest.raises(ValidationError, match="Password must contain"):
            ForgotPasswordResetPayload(token="tok", new_password="abcdefghi", password_confirm="abcdefghi")

    def test_digits_only_password_rejected(self) -> None:
        with pytest.raises(ValidationError, match="Password must contain"):
            ForgotPasswordResetPayload(token="tok", new_password="123456789", password_confirm="123456789")


# ---------------------------------------------------------------------------
# login.py models
# ---------------------------------------------------------------------------
from controllers.web.login import EmailCodeLoginSendPayload, EmailCodeLoginVerifyPayload, LoginPayload


class TestLoginPayload:
    def test_valid(self) -> None:
        p = LoginPayload(email="a@b.com", password="Valid1234")
        assert p.email == "a@b.com"

    def test_invalid_email(self) -> None:
        with pytest.raises(ValidationError, match="not a valid email"):
            LoginPayload(email="bad", password="Valid1234")

    def test_weak_password(self) -> None:
        with pytest.raises(ValidationError, match="Password must contain"):
            LoginPayload(email="a@b.com", password="weak")


class TestEmailCodeLoginSendPayload:
    def test_valid(self) -> None:
        p = EmailCodeLoginSendPayload(email="a@b.com")
        assert p.language is None

    def test_with_language(self) -> None:
        p = EmailCodeLoginSendPayload(email="a@b.com", language="zh-Hans")
        assert p.language == "zh-Hans"


class TestEmailCodeLoginVerifyPayload:
    def test_valid(self) -> None:
        p = EmailCodeLoginVerifyPayload(email="a@b.com", code="1234", token="tok")
        assert p.code == "1234"

    def test_empty_token_rejected(self) -> None:
        with pytest.raises(ValidationError):
            EmailCodeLoginVerifyPayload(email="a@b.com", code="1234", token="")
