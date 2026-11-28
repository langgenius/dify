import subprocess
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from celery.app.task import Context
from celery.exceptions import Reject
from kombu.exceptions import OperationalError
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.human_input_adapter import DeliveryMethodType
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from graphon.file import FileTransferMethod, FileType
from models import (
    AgentDebugConversation,
    Conversation,
    ConversationVariable,
    HumanInputForm,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
    PinnedConversation,
    SavedMessage,
)
from models.agent import (
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import (
    ConversationFromSource,
    ConversationStatus,
    CreatorUserRole,
    FeedbackFromSource,
    FeedbackRating,
    InvokeFrom,
    MessageChainType,
)
from models.human_input import HumanInputDelivery, HumanInputFormRecipient, RecipientType
from models.tools import ToolConversationVariables, ToolFile
from services.agent.workspace_service import AgentWorkspaceService
from tasks.collect_agent_resources_task import collect_agent_resources
from tasks.delete_conversation_task import (
    _cleanup_conversation_related_data,
    delete_conversation_related_data,
    sweep_deleted_conversations,
)
from tests.helpers.unit.model_factories import make_conversation, make_message

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
CONVERSATION_ID = "44444444-4444-4444-4444-444444444444"
OTHER_CONVERSATION_ID = "55555555-5555-5555-5555-555555555555"
MESSAGE_ID = "66666666-6666-6666-6666-666666666666"
AGENT_ID = "77777777-7777-7777-7777-777777777777"


def _conversation(conversation_id: str, *, deleted: bool) -> Conversation:
    return make_conversation(
        conversation_id=conversation_id,
        app_id=APP_ID,
        name="Test conversation",
        inputs={},
        status=ConversationStatus.NORMAL,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=ACCOUNT_ID,
        is_deleted=deleted,
    )


def _message() -> Message:
    return make_message(
        message_id=MESSAGE_ID,
        app_id=APP_ID,
        conversation_id=CONVERSATION_ID,
        inputs={},
        query="hello",
        message={"role": "user", "content": "hello"},
        answer="world",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=ACCOUNT_ID,
    )


def _tool_file(*, name: str, conversation_id: str | None = CONVERSATION_ID) -> ToolFile:
    return ToolFile(
        user_id=ACCOUNT_ID,
        tenant_id=TENANT_ID,
        conversation_id=conversation_id,
        file_key=f"tools/{TENANT_ID}/{name}",
        mimetype="text/plain",
        name=name,
        size=5,
    )


def test_cleanup_removes_owned_resources(sqlite_session: Session) -> None:
    conversation = _conversation(CONVERSATION_ID, deleted=True)
    other_conversation = _conversation(OTHER_CONVERSATION_ID, deleted=False)
    message = _message()
    owned_file = _tool_file(name="owned.txt")
    other_file = _tool_file(name="other.txt", conversation_id=OTHER_CONVERSATION_ID)
    sqlite_session.add_all([conversation, other_conversation, message, owned_file, other_file])
    sqlite_session.flush()

    message_chain = MessageChain(message_id=MESSAGE_ID, type=MessageChainType.SYSTEM, input=None, output=None)
    form = HumanInputForm(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        workflow_run_id=None,
        conversation_id=CONVERSATION_ID,
        form_kind=HumanInputFormKind.RUNTIME,
        node_id="ask-human",
        form_definition="{}",
        rendered_content="form",
        status=HumanInputFormStatus.WAITING,
        expiration_time=datetime.now(UTC) + timedelta(hours=1),
    )
    sqlite_session.add_all([message_chain, form])
    sqlite_session.flush()

    delivery = HumanInputDelivery(
        form_id=form.id,
        delivery_method_type=DeliveryMethodType.WEBAPP,
        delivery_config_id=None,
        channel_payload="{}",
    )
    sqlite_session.add(delivery)
    sqlite_session.flush()

    upload_token = HumanInputFormUploadToken(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        form_id=form.id,
        recipient_id="88888888-8888-8888-8888-888888888888",
        token="upload-token",
    )
    sqlite_session.add(upload_token)
    sqlite_session.flush()

    related_rows = [
        MessageAgentThought(
            message_id=MESSAGE_ID,
            position=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=ACCOUNT_ID,
            message_chain_id=message_chain.id,
        ),
        MessageFile(
            message_id=MESSAGE_ID,
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=ACCOUNT_ID,
            url="https://example.com/file.txt",
        ),
        SavedMessage(
            app_id=APP_ID,
            message_id=MESSAGE_ID,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=ACCOUNT_ID,
        ),
        MessageAnnotation(
            app_id=APP_ID,
            question="hello",
            content="world",
            account_id=ACCOUNT_ID,
            conversation_id=CONVERSATION_ID,
            message_id=MESSAGE_ID,
        ),
        MessageFeedback(
            app_id=APP_ID,
            conversation_id=CONVERSATION_ID,
            message_id=MESSAGE_ID,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.ADMIN,
            from_account_id=ACCOUNT_ID,
        ),
        ToolConversationVariables(
            user_id=ACCOUNT_ID,
            tenant_id=TENANT_ID,
            conversation_id=CONVERSATION_ID,
            variables_str="{}",
        ),
        ConversationVariable(
            id="99999999-9999-9999-9999-999999999999",
            conversation_id=CONVERSATION_ID,
            app_id=APP_ID,
            data="{}",
        ),
        PinnedConversation(
            app_id=APP_ID,
            conversation_id=CONVERSATION_ID,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=ACCOUNT_ID,
        ),
        AgentDebugConversation(
            tenant_id=TENANT_ID,
            agent_id=AGENT_ID,
            app_id=APP_ID,
            account_id=ACCOUNT_ID,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            conversation_id=CONVERSATION_ID,
        ),
        HumanInputFormRecipient(
            form_id=form.id,
            delivery_id=delivery.id,
            recipient_type=RecipientType.CONSOLE,
            recipient_payload="{}",
        ),
        HumanInputFormUploadFile(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            form_id=form.id,
            upload_file_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            upload_token_id=upload_token.id,
        ),
    ]
    sqlite_session.add_all(related_rows)
    sqlite_session.commit()
    form_id = form.id
    owned_file_id = owned_file.id
    owned_file_key = owned_file.file_key
    other_file_id = other_file.id

    with patch("tasks.delete_conversation_task.storage") as storage_mock:
        assert _cleanup_conversation_related_data(CONVERSATION_ID) is True

    storage_mock.delete.assert_called_once_with(owned_file_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(Conversation, CONVERSATION_ID) is None
    assert sqlite_session.get(Message, MESSAGE_ID) is None
    assert (
        sqlite_session.scalar(select(MessageAgentThought).where(MessageAgentThought.message_id == MESSAGE_ID)) is None
    )
    assert sqlite_session.scalar(select(HumanInputForm).where(HumanInputForm.id == form_id)) is None
    assert sqlite_session.get(ToolFile, owned_file_id) is None
    assert sqlite_session.get(ToolFile, other_file_id) is not None
    assert sqlite_session.get(Conversation, OTHER_CONVERSATION_ID) is not None


def test_cleanup_storage_failure_retains_marker_and_file_key(sqlite_session: Session) -> None:
    conversation = _conversation(CONVERSATION_ID, deleted=True)
    tool_file = _tool_file(name="retry.txt")
    sqlite_session.add_all([conversation, tool_file])
    sqlite_session.commit()

    with patch("tasks.delete_conversation_task.storage") as storage_mock:
        storage_mock.delete.side_effect = RuntimeError("storage unavailable")
        storage_mock.exists.return_value = True
        with pytest.raises(RuntimeError, match="storage unavailable"):
            _cleanup_conversation_related_data(CONVERSATION_ID)

    sqlite_session.expire_all()
    persisted_conversation = sqlite_session.get(Conversation, CONVERSATION_ID)
    assert persisted_conversation is not None
    assert persisted_conversation.is_deleted is True
    assert sqlite_session.get(ToolFile, tool_file.id) is not None


def test_sweeper_recovers_retired_workspace_after_broker_outage(sqlite_session: Session) -> None:
    workspace = AgentWorkspace(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id=CONVERSATION_ID,
        owner_scope_key="agent",
        backend_workspace_ref="sbx-0123456789abcdef",
        status=AgentWorkingResourceStatus.RETIRED,
        active_guard=None,
    )
    sqlite_session.add_all([_conversation(CONVERSATION_ID, deleted=True), workspace])
    sqlite_session.flush()
    binding = AgentWorkspaceBinding(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        workspace_id=workspace.id,
        agent_id=AGENT_ID,
        agent_config_version_id=AGENT_ID,
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref=workspace.backend_workspace_ref,
        status=AgentWorkingResourceStatus.RETIRED,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    workspace_id, binding_id = workspace.id, binding.id

    with patch.object(
        delete_conversation_related_data.app, "send_task", side_effect=OperationalError("broker unavailable")
    ) as send_task:
        _ = delete_conversation_related_data.request_stack.push(
            Context(
                args=(CONVERSATION_ID,), kwargs={}, id="cleanup-task", called_directly=False, is_eager=False, retries=0
            )
        )
        try:
            with pytest.raises(Reject, match="broker unavailable"):
                delete_conversation_related_data.run(CONVERSATION_ID)
        finally:
            delete_conversation_related_data.pop_request()

    assert [call.args[0] for call in send_task.call_args_list] == [
        collect_agent_resources.name,
        delete_conversation_related_data.name,
    ]
    sqlite_session.expire_all()
    assert sqlite_session.get(Conversation, CONVERSATION_ID) is None
    retained_workspace = sqlite_session.get(AgentWorkspace, workspace_id)
    assert retained_workspace is not None
    assert retained_workspace.status == AgentWorkingResourceStatus.RETIRED

    with (
        patch.object(
            collect_agent_resources,
            "apply_async",
            side_effect=lambda args, kwargs: collect_agent_resources.apply(args=args, kwargs=kwargs, throw=True),
        ),
        patch.object(AgentWorkspaceService, "_client") as client_context,
    ):
        assert sweep_deleted_conversations.run() == 1

    destroy = client_context.return_value.__enter__.return_value.destroy_execution_binding_sync
    destroy.assert_called_once()
    request = destroy.call_args.args[0]
    assert request.binding_ref == request.workspace_ref == "sbx-0123456789abcdef"
    assert request.destroy_workspace is True
    sqlite_session.expire_all()
    assert sqlite_session.get(AgentWorkspaceBinding, binding_id) is None
    assert sqlite_session.get(AgentWorkspace, workspace_id) is None


@pytest.mark.parametrize("first_import", ["tasks.delete_conversation_task", "tasks.collect_agent_resources_task"])
def test_cleanup_tasks_import_and_register_in_fresh_process(first_import: str) -> None:
    script = """
import os
import sys
from importlib import import_module

modules = ["tasks.delete_conversation_task", "tasks.collect_agent_resources_task"]
os.environ["ENABLE_CONVERSATION_CLEANUP_TASK"] = "true"
import_module(sys.argv[1])
from dify_app import DifyApp
from extensions.ext_celery import init_app

app = init_app(DifyApp("cleanup-import-test"))
app.loader.import_default_modules()
assert modules[0] + ".delete_conversation_related_data" in app.tasks
assert modules[0] + ".sweep_deleted_conversations" in app.tasks
assert modules[1] + ".collect_agent_resources" in app.tasks
"""
    result = subprocess.run(
        [sys.executable, "-c", script, first_import],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr


def test_cleanup_skips_active_conversation(sqlite_session: Session) -> None:
    conversation = _conversation(CONVERSATION_ID, deleted=False)
    tool_file = _tool_file(name="active.txt")
    sqlite_session.add_all([conversation, tool_file])
    sqlite_session.commit()

    with patch("tasks.delete_conversation_task.storage") as storage_mock:
        assert _cleanup_conversation_related_data(CONVERSATION_ID) is False
        storage_mock.delete.assert_not_called()

    assert sqlite_session.get(Conversation, CONVERSATION_ID) is not None
    assert sqlite_session.get(ToolFile, tool_file.id) is not None


def test_sweeper_dispatches_only_soft_deleted_conversations(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            _conversation(CONVERSATION_ID, deleted=True),
            _conversation(OTHER_CONVERSATION_ID, deleted=False),
        ]
    )
    sqlite_session.commit()

    with patch("tasks.delete_conversation_task.delete_conversation_related_data.delay", MagicMock()) as delay:
        assert sweep_deleted_conversations.run() == 1

    delay.assert_called_once_with(CONVERSATION_ID)


def test_sweeper_advances_past_failed_retired_workspaces_and_wraps(sqlite_session: Session) -> None:
    retired_at = datetime(2026, 1, 1)
    workspace_ids = [f"88888888-8888-8888-8888-{index:012d}" for index in range(3)]
    for index, workspace_id in enumerate(workspace_ids):
        sqlite_session.add(
            AgentWorkspace(
                id=workspace_id,
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                owner_id=f"99999999-9999-9999-9999-{index:012d}",
                owner_scope_key="agent",
                backend_workspace_ref=f"sbx-{index:016x}",
                status=AgentWorkingResourceStatus.RETIRED,
                active_guard=None,
                retired_at=retired_at + timedelta(seconds=index // 2),
            )
        )
    sqlite_session.commit()

    def enqueue(*, tenant_id: str, workspace_ids: list[str]) -> None:
        assert tenant_id == TENANT_ID
        if workspace_ids == [oldest]:
            raise OperationalError("failed to enqueue oldest workspace")

    oldest = workspace_ids[0]
    cursor: dict[str, str] = {}
    module = "tasks.delete_conversation_task"
    with (
        patch(f"{module}.dify_config.CONVERSATION_CLEANUP_BATCH_SIZE", 1),
        patch(f"{module}.redis_client.get", side_effect=cursor.get) as read_cursor,
        patch(f"{module}.redis_client.set", side_effect=cursor.__setitem__) as write_cursor,
        patch(f"{module}.enqueue_agent_resource_collection", side_effect=enqueue) as dispatch,
    ):
        assert [sweep_deleted_conversations.run() for _ in range(4)] == [0, 1, 1, 0]
        assert [call.kwargs["workspace_ids"] for call in dispatch.call_args_list] == [
            [workspace_id] for workspace_id in [*workspace_ids, oldest]
        ]

        read_cursor.side_effect = RedisConnectionError("Redis unavailable")
        write_cursor.side_effect = RedisConnectionError("Redis unavailable")
        assert sweep_deleted_conversations.run() == 0
        dispatch.assert_called_with(tenant_id=TENANT_ID, workspace_ids=[oldest])

    remaining = sqlite_session.get(AgentWorkspace, oldest)
    assert remaining is not None
    assert remaining.status == AgentWorkingResourceStatus.RETIRED
