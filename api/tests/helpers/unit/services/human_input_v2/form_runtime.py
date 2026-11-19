"""Shared form runtime context and recipient builders for Human Input service tests."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared.values import AccountId, ContactId, TenantId
from core.workflow.nodes.human_input_v2.entities import (
    Contact,
    DynamicEmail,
    HumanInputNodeData,
    Initiator,
    OnetimeEmail,
)
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from graphon.runtime import VariablePool
from models.human_input_v2 import HumanInputIMBinding, HumanInputIMIdentity
from services.human_input_v2.form_service import CreatedForm, FormExecutionContext, HumanInputFormService

TENANT_ID = TenantId("00000000-0000-0000-0000-000000000001")
APP_ID = "00000000-0000-0000-0000-000000000002"
WORKFLOW_RUN_ID = "00000000-0000-0000-0000-000000000003"
ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000004")
CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000005")
NODE_EXECUTION_ID = "00000000-0000-0000-0000-000000000006"


@dataclass
class FormRuntimeContext:
    sessions: sessionmaker[Session]
    service: HumanInputFormService
    execution: FormExecutionContext

    def prepare(self, data: HumanInputNodeData, pool: VariablePool | None = None) -> CreatedForm | PreparedForm:
        return self.service.prepare_form(
            node_execution_id=NODE_EXECUTION_ID, node_data=data, variable_pool=pool or VariablePool()
        )

    def handle_timeouts(self) -> None:
        from services.human_input_v2.form_service import handle_form_timeouts

        handle_form_timeouts(
            session_factory=self.sessions, tenant_id=TENANT_ID, app_id=APP_ID, workflow_run_id=WORKFLOW_RUN_ID
        )


def make_form_node(*recipients: Contact | DynamicEmail | Initiator | OnetimeEmail) -> HumanInputNodeData:
    return HumanInputNodeData.model_validate(
        {
            "recipients_spec": list(recipients),
            "message_template": {"subject": "Review", "body": "Open {{#url#}}"},
            "debug_mode": {"enabled": False, "channels": []},
            "title": "Frozen",
            "form_content": "Please approve",
            "user_actions": [{"id": "approve", "title": "Approve"}],
        }
    )


def add_slack_channel(context: FormRuntimeContext) -> None:
    from libs.datetime_utils import naive_utc_now
    from models.human_input_v2 import IMIdentityRawPayload
    from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
    from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
    from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter

    now = naive_utc_now()
    channel_id = IMChannelId(str(uuid4()))
    identity_id = str(uuid4())
    with context.sessions.begin() as session:
        WorkspaceIMChannelWriter(session, TENANT_ID, ACCOUNT_ID).create(
            IMChannel(
                id=channel_id,
                created_at=now,
                updated_at=now,
                provider=IMProvider.SLACK,
                provider_tenant_id="provider-team",
                encrypted_credentials=ChannelEncryptedCredentials(ciphertext="protected"),
                app_identifier="app",
                webhook_id=WebhookId(str(uuid4())),
                config_version=1,
                status=IMChannelStatus.CONNECTED,
            )
        )
        identity = HumanInputIMIdentity(
            channel_id=channel_id,
            provider_user_id="im-user",
            raw_payload=IMIdentityRawPayload({}),
            last_seen_sync_run_id=str(uuid4()),
            last_seen_at=now,
        )
        identity.id = identity_id
        session.add_all(
            [identity, HumanInputIMBinding(channel_id=channel_id, contact_id=CONTACT_ID, im_identity_id=identity_id)]
        )
