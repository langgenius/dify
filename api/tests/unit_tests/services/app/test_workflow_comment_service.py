"""Workflow comment rules, isolated from persistence by an in-memory store."""

import datetime
from collections.abc import Callable, Sequence

import pytest

from machinery.context import RequestContext
from services.app.workflow_comment_service import (
    InvalidMentionedUserIdError,
    InvalidWorkflowCommentContentError,
    MentionContext,
    MentionRecipient,
    WorkflowCommentAppNotFoundError,
    WorkflowCommentCreated,
    WorkflowCommentDetail,
    WorkflowCommentDraft,
    WorkflowCommentEdit,
    WorkflowCommentMentionNotification,
    WorkflowCommentMentionNotifier,
    WorkflowCommentReplyDraft,
    WorkflowCommentResolved,
    WorkflowCommentService,
    WorkflowCommentStore,
    WorkflowCommentSummary,
    WorkflowCommentUpdated,
    WorkflowCommentWrite,
    format_comment_excerpt,
)

CONTEXT = RequestContext("request", None, "account-1", "workspace-1")
APP_ID = "app-1"
NOW = datetime.datetime(2024, 1, 1, 12, 0, 0)
USER_A = "33333333-3333-3333-3333-333333333333"
USER_B = "33333333-3333-3333-3333-333333333334"
NO_MENTIONS = MentionContext(app_name=None, commenter_name=None, recipients=())


class InMemoryStore(WorkflowCommentStore):
    """Records every scoped call and returns canned writes."""

    def __init__(self, *, app_visible: bool = True, mentions: MentionContext = NO_MENTIONS) -> None:
        self.app_visible = app_visible
        self.mentions = mentions
        self.calls: list[tuple[str, dict[str, object]]] = []

    def _record(self, name: str, **kwargs: object) -> None:
        assert kwargs.pop("workspace_id") == CONTEXT.active_workspace_id
        assert kwargs.pop("app_id") == APP_ID
        if "actor_id" in kwargs:
            assert kwargs.pop("actor_id") == CONTEXT.account_id
        self.calls.append((name, kwargs))

    def app_exists(self, *, workspace_id: str, app_id: str) -> bool:
        assert (workspace_id, app_id) == (CONTEXT.active_workspace_id, APP_ID)
        return self.app_visible

    def list_comments(self, *, workspace_id: str, app_id: str) -> Sequence[WorkflowCommentSummary]:
        self._record("list_comments", workspace_id=workspace_id, app_id=app_id)
        return []

    def get_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentDetail:
        self._record("get_comment", workspace_id=workspace_id, app_id=app_id, comment_id=comment_id)
        raise NotImplementedError

    def insert_comment(
        self, *, workspace_id: str, app_id: str, actor_id: str, draft: WorkflowCommentDraft
    ) -> WorkflowCommentWrite[WorkflowCommentCreated]:
        self._record("insert_comment", workspace_id=workspace_id, app_id=app_id, actor_id=actor_id, draft=draft)
        return WorkflowCommentWrite(WorkflowCommentCreated(id="comment-1", created_at=NOW), self.mentions)

    def update_comment(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str, edit: WorkflowCommentEdit
    ) -> WorkflowCommentWrite[WorkflowCommentUpdated]:
        self._record(
            "update_comment",
            workspace_id=workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            actor_id=actor_id,
            edit=edit,
        )
        return WorkflowCommentWrite(WorkflowCommentUpdated(id=comment_id, updated_at=NOW), self.mentions)

    def delete_comment(self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str) -> None:
        self._record(
            "delete_comment", workspace_id=workspace_id, app_id=app_id, comment_id=comment_id, actor_id=actor_id
        )

    def resolve_comment(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str
    ) -> WorkflowCommentResolved:
        self._record(
            "resolve_comment", workspace_id=workspace_id, app_id=app_id, comment_id=comment_id, actor_id=actor_id
        )
        return WorkflowCommentResolved(id=comment_id, resolved=True, resolved_at=NOW, resolved_by=actor_id)

    def insert_reply(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str, draft: WorkflowCommentReplyDraft
    ) -> WorkflowCommentWrite[WorkflowCommentCreated]:
        self._record(
            "insert_reply",
            workspace_id=workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            actor_id=actor_id,
            draft=draft,
        )
        return WorkflowCommentWrite(WorkflowCommentCreated(id="reply-1", created_at=NOW), self.mentions)

    def update_reply(
        self,
        *,
        workspace_id: str,
        app_id: str,
        comment_id: str,
        reply_id: str,
        actor_id: str,
        draft: WorkflowCommentReplyDraft,
    ) -> WorkflowCommentWrite[WorkflowCommentUpdated]:
        self._record(
            "update_reply",
            workspace_id=workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            reply_id=reply_id,
            actor_id=actor_id,
            draft=draft,
        )
        return WorkflowCommentWrite(WorkflowCommentUpdated(id=reply_id, updated_at=NOW), self.mentions)

    def delete_reply(self, *, workspace_id: str, app_id: str, comment_id: str, reply_id: str, actor_id: str) -> None:
        self._record(
            "delete_reply",
            workspace_id=workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            reply_id=reply_id,
            actor_id=actor_id,
        )


class RecordingNotifier(WorkflowCommentMentionNotifier):
    def __init__(self) -> None:
        self.sent: list[WorkflowCommentMentionNotification] = []

    def notify(self, notifications: Sequence[WorkflowCommentMentionNotification]) -> None:
        self.sent.extend(notifications)


def _service(store: InMemoryStore, notifier: RecordingNotifier | None = None) -> WorkflowCommentService:
    return WorkflowCommentService(
        comments=store, notifier=notifier or RecordingNotifier(), console_web_url="https://console.example.com/"
    )


COMMENT_DRAFT = WorkflowCommentDraft(content="hello", position_x=1.0, position_y=2.0, mentioned_user_ids=())
REPLY_DRAFT = WorkflowCommentReplyDraft(content="hello", mentioned_user_ids=())
COMMENT_EDIT = WorkflowCommentEdit(content="hello", position_x=None, position_y=None, mentioned_user_ids=None)

type Operation = Callable[[WorkflowCommentService], object]

OPERATIONS: list[Operation] = [
    lambda service: service.ensure_app(CONTEXT, APP_ID),
    lambda service: service.list_comments(CONTEXT, APP_ID),
    lambda service: service.get_comment(CONTEXT, APP_ID, "comment-1"),
    lambda service: service.create_comment(CONTEXT, APP_ID, COMMENT_DRAFT),
    lambda service: service.update_comment(CONTEXT, APP_ID, "comment-1", COMMENT_EDIT),
    lambda service: service.delete_comment(CONTEXT, APP_ID, "comment-1"),
    lambda service: service.resolve_comment(CONTEXT, APP_ID, "comment-1"),
    lambda service: service.create_reply(CONTEXT, APP_ID, "comment-1", REPLY_DRAFT),
    lambda service: service.update_reply(CONTEXT, APP_ID, "comment-1", "reply-1", REPLY_DRAFT),
    lambda service: service.delete_reply(CONTEXT, APP_ID, "comment-1", "reply-1"),
]


@pytest.mark.parametrize("operation", OPERATIONS)
def test_every_operation_requires_an_addressable_app(operation: Operation) -> None:
    store = InMemoryStore(app_visible=False)

    with pytest.raises(WorkflowCommentAppNotFoundError):
        operation(_service(store))

    assert store.calls == []


CONTENT_WRITES: list[Callable[[WorkflowCommentService, str], object]] = [
    lambda service, content: service.create_comment(
        CONTEXT, APP_ID, WorkflowCommentDraft(content=content, position_x=0, position_y=0, mentioned_user_ids=())
    ),
    lambda service, content: service.update_comment(
        CONTEXT,
        APP_ID,
        "comment-1",
        WorkflowCommentEdit(content=content, position_x=None, position_y=None, mentioned_user_ids=None),
    ),
    lambda service, content: service.create_reply(
        CONTEXT, APP_ID, "comment-1", WorkflowCommentReplyDraft(content=content, mentioned_user_ids=())
    ),
    lambda service, content: service.update_reply(
        CONTEXT, APP_ID, "comment-1", "reply-1", WorkflowCommentReplyDraft(content=content, mentioned_user_ids=())
    ),
]


@pytest.mark.parametrize("write", CONTENT_WRITES)
@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("   ", "Comment content cannot be empty"),
        ("a" * 1001, "Comment content cannot exceed 1000 characters"),
    ],
    ids=["blank", "too-long"],
)
def test_invalid_content_is_rejected_before_persistence(
    write: Callable[[WorkflowCommentService, str], object], content: str, message: str
) -> None:
    store = InMemoryStore()

    with pytest.raises(InvalidWorkflowCommentContentError, match=message):
        write(_service(store), content)

    assert store.calls == []


def test_mentions_are_deduplicated_and_empty_ids_skipped() -> None:
    store = InMemoryStore()

    _service(store).create_comment(
        CONTEXT,
        APP_ID,
        WorkflowCommentDraft(
            content="hello", position_x=0, position_y=0, mentioned_user_ids=(USER_A, "", USER_B, USER_A)
        ),
    )

    [(_, kwargs)] = store.calls
    draft = kwargs["draft"]
    assert isinstance(draft, WorkflowCommentDraft)
    assert draft.mentioned_user_ids == (USER_A, USER_B)


def test_malformed_mention_id_is_rejected() -> None:
    store = InMemoryStore()

    with pytest.raises(InvalidMentionedUserIdError, match="not-a-uuid is not a valid uuid."):
        _service(store).create_reply(
            CONTEXT, APP_ID, "comment-1", WorkflowCommentReplyDraft(content="hi", mentioned_user_ids=("not-a-uuid",))
        )

    assert store.calls == []


def test_omitted_comment_mentions_stay_omitted() -> None:
    store = InMemoryStore()

    _service(store).update_comment(CONTEXT, APP_ID, "comment-1", COMMENT_EDIT)

    [(_, kwargs)] = store.calls
    edit = kwargs["edit"]
    assert isinstance(edit, WorkflowCommentEdit)
    assert edit.mentioned_user_ids is None


def test_notifications_are_built_from_committed_mentions_with_fallbacks() -> None:
    store = InMemoryStore(
        mentions=MentionContext(
            app_name=None,
            commenter_name=None,
            recipients=(
                MentionRecipient(email="ja@example.com", name="Hanako", interface_language="ja-JP"),
                MentionRecipient(email="anon@example.com", name=None, interface_language=None),
            ),
        )
    )
    notifier = RecordingNotifier()

    _service(store, notifier).create_comment(
        CONTEXT,
        APP_ID,
        WorkflowCommentDraft(content="  " + "x" * 250 + "  ", position_x=0, position_y=0, mentioned_user_ids=()),
    )

    excerpt = "x" * 197 + "..."
    app_url = "https://console.example.com/app/app-1/workflow"
    assert notifier.sent == [
        WorkflowCommentMentionNotification(
            language="ja-JP",
            to="ja@example.com",
            mentioned_name="Hanako",
            commenter_name="Dify user",
            app_name="Dify app",
            comment_content=excerpt,
            app_url=app_url,
        ),
        WorkflowCommentMentionNotification(
            language="en-US",
            to="anon@example.com",
            mentioned_name="anon@example.com",
            commenter_name="Dify user",
            app_name="Dify app",
            comment_content=excerpt,
            app_url=app_url,
        ),
    ]


def test_no_notification_is_sent_without_recipients() -> None:
    notifier = RecordingNotifier()

    _service(InMemoryStore(), notifier).create_reply(CONTEXT, APP_ID, "comment-1", REPLY_DRAFT)

    assert notifier.sent == []


def test_format_comment_excerpt_handles_short_and_long_limits() -> None:
    assert format_comment_excerpt("  hello  ", max_length=10) == "hello"
    assert format_comment_excerpt("abcdefghijk", max_length=3) == "abc"
    assert format_comment_excerpt("  abcdefghijk  ", max_length=8) == "abcde..."
