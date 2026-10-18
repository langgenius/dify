"""Workflow comment use cases, isolated from persistence by an in-memory store of aggregates."""

import datetime
from collections.abc import Callable, Sequence

import pytest

from machinery.context import RequestContext
from services.app.workflow_comment_agg import WorkflowCommentAgg
from services.app.workflow_comment_errors import (
    InvalidMentionedUserIdError,
    InvalidWorkflowCommentContentError,
    WorkflowCommentAppNotFoundError,
    WorkflowCommentNotFoundError,
    WorkflowCommentPermissionError,
    WorkflowCommentReplyNotFoundError,
)
from services.app.workflow_comment_service import (
    MentionContext,
    MentionRecipient,
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
    format_comment_excerpt,
)

ACTOR = "33333333-3333-3333-3333-333333333333"
OTHER = "33333333-3333-3333-3333-333333333334"
USER_A = "33333333-3333-3333-3333-333333333335"
USER_B = "33333333-3333-3333-3333-333333333336"
CONTEXT = RequestContext("request", None, ACTOR, "workspace-1")
APP_ID = "app-1"
COMMENT_ID = "comment-1"
STARTED_AT = datetime.datetime(2024, 1, 1, 12, 0, 0)
NOW = datetime.datetime(2024, 1, 2, 12, 0, 0)


class InMemoryStore(WorkflowCommentStore):
    """Keeps threads by ID, asserts the owner scope of every call, and reports mentions of `members`."""

    def __init__(self) -> None:
        self.app_visible = True
        self.members: dict[str, MentionRecipient] = {}
        self.app_name: str | None = "Canvas"
        self.commenter_name: str | None = "Actor"
        self.threads: dict[str, WorkflowCommentAgg] = {}
        self.calls: list[str] = []
        self.notify_requests: list[tuple[str, ...]] = []

    def seed(self, comment: WorkflowCommentAgg) -> WorkflowCommentAgg:
        self.threads[comment.id] = comment
        return comment

    def app_exists(self, *, workspace_id: str, app_id: str) -> bool:
        assert (workspace_id, app_id) == (CONTEXT.active_workspace_id, APP_ID)
        return self.app_visible

    def list_comments(self, *, workspace_id: str, app_id: str) -> Sequence[WorkflowCommentSummary]:
        assert (workspace_id, app_id) == (CONTEXT.active_workspace_id, APP_ID)
        self.calls.append("list_comments")
        return []

    def get_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentDetail:
        assert (workspace_id, app_id) == (CONTEXT.active_workspace_id, APP_ID)
        assert comment_id == COMMENT_ID
        self.calls.append("get_comment")
        raise WorkflowCommentNotFoundError

    def load_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentAgg:
        assert (workspace_id, app_id) == (CONTEXT.active_workspace_id, APP_ID)
        self.calls.append("load_comment")
        if comment_id not in self.threads:
            raise WorkflowCommentNotFoundError
        return self.threads[comment_id]

    def add_comment(self, *, comment: WorkflowCommentAgg, notify_user_ids: Sequence[str]) -> MentionContext:
        self._assert_scope(comment)
        self.calls.append("add_comment")
        self.threads[comment.id] = comment
        return self._mentions(comment.created_by, notify_user_ids)

    def save_comment(
        self, *, loaded: WorkflowCommentAgg, changed: WorkflowCommentAgg, actor_id: str, notify_user_ids: Sequence[str]
    ) -> MentionContext:
        self._assert_scope(changed)
        # The service saves the very state it loaded, so the adapter can write only the difference.
        assert self.threads[changed.id] is loaded
        self.calls.append("save_comment")
        self.threads[changed.id] = changed
        return self._mentions(actor_id, notify_user_ids)

    def delete_comment(self, *, comment: WorkflowCommentAgg) -> None:
        self._assert_scope(comment)
        self.calls.append("delete_comment")
        del self.threads[comment.id]

    def _mentions(self, actor_id: str, notify_user_ids: Sequence[str]) -> MentionContext:
        assert actor_id == CONTEXT.account_id
        self.notify_requests.append(tuple(notify_user_ids))
        recipients = tuple(self.members[user_id] for user_id in notify_user_ids if user_id in self.members)
        return MentionContext(app_name=self.app_name, commenter_name=self.commenter_name, recipients=recipients)

    @staticmethod
    def _assert_scope(comment: WorkflowCommentAgg) -> None:
        assert (comment.workspace_id, comment.app_id) == (CONTEXT.active_workspace_id, APP_ID)


class RecordingNotifier(WorkflowCommentMentionNotifier):
    def __init__(self) -> None:
        self.sent: list[WorkflowCommentMentionNotification] = []

    def notify(self, notifications: Sequence[WorkflowCommentMentionNotification]) -> None:
        self.sent.extend(notifications)


def _service(store: InMemoryStore, notifier: RecordingNotifier | None = None) -> WorkflowCommentService:
    return WorkflowCommentService(
        comments=store,
        notifier=notifier or RecordingNotifier(),
        console_web_url="https://console.example.com/",
        now=lambda: NOW,
    )


def _store_with_member() -> InMemoryStore:
    store = InMemoryStore()
    store.members[USER_A] = MentionRecipient(email="alice@example.com", name="Alice", interface_language="ja-JP")
    return store


def _thread(*, created_by: str = ACTOR, mentioned_user_ids: tuple[str, ...] = ()) -> WorkflowCommentAgg:
    return WorkflowCommentAgg.start(
        comment_id=COMMENT_ID,
        workspace_id=CONTEXT.active_workspace_id,
        app_id=APP_ID,
        actor_id=created_by,
        content="hello",
        position_x=1.0,
        position_y=2.0,
        mentioned_user_ids=mentioned_user_ids,
        now=STARTED_AT,
    )


def _thread_with_reply(*, replied_by: str = ACTOR, mentioned_user_ids: tuple[str, ...] = ()) -> WorkflowCommentAgg:
    return _thread(created_by=OTHER).add_reply(
        reply_id="reply-1", actor_id=replied_by, content="reply", mentioned_user_ids=mentioned_user_ids, now=STARTED_AT
    )


COMMENT_DRAFT = WorkflowCommentDraft(content="hello", position_x=1.0, position_y=2.0, mentioned_user_ids=())
REPLY_DRAFT = WorkflowCommentReplyDraft(content="hello", mentioned_user_ids=())
COMMENT_EDIT = WorkflowCommentEdit(content="hello", position_x=None, position_y=None, mentioned_user_ids=None)

type Operation = Callable[[WorkflowCommentService], object]

OPERATIONS: list[Operation] = [
    lambda service: service.ensure_app(CONTEXT, APP_ID),
    lambda service: service.list_comments(CONTEXT, APP_ID),
    lambda service: service.get_comment(CONTEXT, APP_ID, COMMENT_ID),
    lambda service: service.create_comment(CONTEXT, APP_ID, COMMENT_DRAFT),
    lambda service: service.update_comment(CONTEXT, APP_ID, COMMENT_ID, COMMENT_EDIT),
    lambda service: service.delete_comment(CONTEXT, APP_ID, COMMENT_ID),
    lambda service: service.resolve_comment(CONTEXT, APP_ID, COMMENT_ID),
    lambda service: service.create_reply(CONTEXT, APP_ID, COMMENT_ID, REPLY_DRAFT),
    lambda service: service.update_reply(CONTEXT, APP_ID, COMMENT_ID, "reply-1", REPLY_DRAFT),
    lambda service: service.delete_reply(CONTEXT, APP_ID, COMMENT_ID, "reply-1"),
]


@pytest.mark.parametrize("operation", OPERATIONS)
def test_every_operation_requires_an_addressable_app(operation: Operation) -> None:
    store = InMemoryStore()
    store.app_visible = False

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
        "missing",
        WorkflowCommentEdit(content=content, position_x=None, position_y=None, mentioned_user_ids=None),
    ),
    lambda service, content: service.create_reply(
        CONTEXT, APP_ID, "missing", WorkflowCommentReplyDraft(content=content, mentioned_user_ids=())
    ),
    lambda service, content: service.update_reply(
        CONTEXT, APP_ID, "missing", "reply-1", WorkflowCommentReplyDraft(content=content, mentioned_user_ids=())
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
def test_invalid_content_is_rejected_before_loading_the_thread(
    write: Callable[[WorkflowCommentService, str], object], content: str, message: str
) -> None:
    store = InMemoryStore()

    # The targets do not exist, so reaching the store would raise not found instead.
    with pytest.raises(InvalidWorkflowCommentContentError, match=message):
        write(_service(store), content)

    assert store.calls == []


def test_malformed_mention_id_is_rejected_before_loading_the_thread() -> None:
    store = InMemoryStore()

    with pytest.raises(InvalidMentionedUserIdError, match="not-a-uuid is not a valid uuid."):
        _service(store).create_reply(
            CONTEXT, APP_ID, "missing", WorkflowCommentReplyDraft(content="hi", mentioned_user_ids=("not-a-uuid",))
        )

    assert store.calls == []


def test_create_comment_adds_a_thread_owned_by_the_actor() -> None:
    store = _store_with_member()
    notifier = RecordingNotifier()

    created = _service(store, notifier).create_comment(
        CONTEXT,
        APP_ID,
        WorkflowCommentDraft(
            content="hello", position_x=1.0, position_y=2.0, mentioned_user_ids=(USER_A, "", ACTOR, USER_A)
        ),
    )

    comment = store.threads[created.id]
    assert created == WorkflowCommentCreated(id=comment.id, created_at=NOW)
    assert (comment.created_by, comment.content, comment.mentioned_user_ids) == (ACTOR, "hello", (USER_A, ACTOR))
    # The actor's self-mention is stored but never notified.
    assert store.notify_requests == [(USER_A,)]
    assert [notification.to for notification in notifier.sent] == ["alice@example.com"]


def test_update_comment_saves_the_edit_and_notifies_only_new_mentions() -> None:
    store = _store_with_member()
    store.seed(_thread(mentioned_user_ids=(USER_B,)))
    notifier = RecordingNotifier()

    updated = _service(store, notifier).update_comment(
        CONTEXT,
        APP_ID,
        COMMENT_ID,
        WorkflowCommentEdit(content="updated", position_x=5.0, position_y=None, mentioned_user_ids=(USER_B, USER_A)),
    )

    assert updated == WorkflowCommentUpdated(id=COMMENT_ID, updated_at=NOW)
    comment = store.threads[COMMENT_ID]
    assert (comment.content, comment.position_x, comment.position_y) == ("updated", 5.0, 2.0)
    assert comment.mentioned_user_ids == (USER_B, USER_A)
    assert store.notify_requests == [(USER_A,)]
    assert [notification.comment_content for notification in notifier.sent] == ["updated"]


def test_update_comment_without_mentions_keeps_them_and_notifies_nobody() -> None:
    store = _store_with_member()
    store.seed(_thread(mentioned_user_ids=(USER_A,)))
    notifier = RecordingNotifier()

    _service(store, notifier).update_comment(CONTEXT, APP_ID, COMMENT_ID, COMMENT_EDIT)

    assert store.threads[COMMENT_ID].mentioned_user_ids == (USER_A,)
    assert store.notify_requests == [()]
    assert notifier.sent == []


def test_update_comment_by_another_account_saves_nothing() -> None:
    store = InMemoryStore()
    loaded = store.seed(_thread(created_by=OTHER))

    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can update it"):
        _service(store).update_comment(CONTEXT, APP_ID, COMMENT_ID, COMMENT_EDIT)

    assert store.calls == ["load_comment"]
    assert store.threads[COMMENT_ID] is loaded


def test_missing_comment_is_reported_by_the_store() -> None:
    with pytest.raises(WorkflowCommentNotFoundError):
        _service(InMemoryStore()).resolve_comment(CONTEXT, APP_ID, "missing")


def test_delete_comment_removes_the_thread_for_its_creator_only() -> None:
    store = InMemoryStore()
    store.seed(_thread(created_by=OTHER))

    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can delete it"):
        _service(store).delete_comment(CONTEXT, APP_ID, COMMENT_ID)
    assert COMMENT_ID in store.threads

    store.seed(_thread())
    _service(store).delete_comment(CONTEXT, APP_ID, COMMENT_ID)
    assert store.threads == {}


def test_any_member_resolves_a_comment() -> None:
    store = InMemoryStore()
    store.seed(_thread(created_by=OTHER))

    resolved = _service(store).resolve_comment(CONTEXT, APP_ID, COMMENT_ID)

    assert resolved == WorkflowCommentResolved(id=COMMENT_ID, resolved=True, resolved_at=NOW, resolved_by=ACTOR)
    assert store.threads[COMMENT_ID].resolved_by == ACTOR


def test_resolving_again_keeps_the_first_resolution() -> None:
    store = InMemoryStore()
    loaded = store.seed(_thread().resolve(actor_id=OTHER, now=STARTED_AT))

    resolved = _service(store).resolve_comment(CONTEXT, APP_ID, COMMENT_ID)

    assert resolved == WorkflowCommentResolved(id=COMMENT_ID, resolved=True, resolved_at=STARTED_AT, resolved_by=OTHER)
    assert store.threads[COMMENT_ID] is loaded


def test_create_reply_adds_a_reply_and_notifies_its_mentions() -> None:
    store = _store_with_member()
    store.seed(_thread(created_by=OTHER, mentioned_user_ids=(USER_A,)))
    notifier = RecordingNotifier()

    created = _service(store, notifier).create_reply(
        CONTEXT, APP_ID, COMMENT_ID, WorkflowCommentReplyDraft(content="reply", mentioned_user_ids=(USER_A,))
    )

    reply = store.threads[COMMENT_ID].reply(created.id)
    assert created == WorkflowCommentCreated(id=reply.id, created_at=NOW)
    assert (reply.created_by, reply.content, reply.mentioned_user_ids) == (ACTOR, "reply", (USER_A,))
    # A mention made in the reply notifies even a user the comment already mentions.
    assert [notification.comment_content for notification in notifier.sent] == ["reply"]


def test_update_reply_saves_the_edit_and_notifies_only_new_mentions() -> None:
    store = _store_with_member()
    store.seed(_thread_with_reply(mentioned_user_ids=(USER_B,)))

    updated = _service(store).update_reply(
        CONTEXT,
        APP_ID,
        COMMENT_ID,
        "reply-1",
        WorkflowCommentReplyDraft(content="new", mentioned_user_ids=(USER_B, USER_A)),
    )

    assert updated == WorkflowCommentUpdated(id="reply-1", updated_at=NOW)
    reply = store.threads[COMMENT_ID].reply("reply-1")
    assert (reply.content, reply.mentioned_user_ids) == ("new", (USER_B, USER_A))
    assert store.notify_requests == [(USER_A,)]


@pytest.mark.parametrize(
    ("operation", "message"),
    [
        (
            lambda service: service.update_reply(CONTEXT, APP_ID, COMMENT_ID, "reply-1", REPLY_DRAFT),
            "Only the reply creator can update it",
        ),
        (
            lambda service: service.delete_reply(CONTEXT, APP_ID, COMMENT_ID, "reply-1"),
            "Only the reply creator can delete it",
        ),
    ],
)
def test_reply_changes_by_another_account_save_nothing(operation: Operation, message: str) -> None:
    store = InMemoryStore()
    store.seed(_thread_with_reply(replied_by=OTHER))

    with pytest.raises(WorkflowCommentPermissionError, match=message):
        operation(_service(store))

    assert store.calls == ["load_comment"]


def test_delete_reply_removes_it_from_the_thread() -> None:
    store = InMemoryStore()
    store.seed(_thread_with_reply())

    _service(store).delete_reply(CONTEXT, APP_ID, COMMENT_ID, "reply-1")

    assert store.threads[COMMENT_ID].replies == ()


def test_unknown_reply_is_not_found() -> None:
    store = InMemoryStore()
    store.seed(_thread())

    with pytest.raises(WorkflowCommentReplyNotFoundError):
        _service(store).delete_reply(CONTEXT, APP_ID, COMMENT_ID, "missing")


def test_notifications_are_built_from_committed_mentions_with_fallbacks() -> None:
    store = InMemoryStore()
    store.members[USER_A] = MentionRecipient(email="ja@example.com", name="Hanako", interface_language="ja-JP")
    store.members[USER_B] = MentionRecipient(email="anon@example.com", name=None, interface_language=None)
    store.app_name = None
    store.commenter_name = None
    notifier = RecordingNotifier()

    _service(store, notifier).create_comment(
        CONTEXT,
        APP_ID,
        WorkflowCommentDraft(
            content="  " + "x" * 250 + "  ", position_x=0, position_y=0, mentioned_user_ids=(USER_A, USER_B)
        ),
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


def test_format_comment_excerpt_handles_short_and_long_limits() -> None:
    assert format_comment_excerpt("  hello  ", max_length=10) == "hello"
    assert format_comment_excerpt("abcdefghijk", max_length=3) == "abc"
    assert format_comment_excerpt("  abcdefghijk  ", max_length=8) == "abcde..."
