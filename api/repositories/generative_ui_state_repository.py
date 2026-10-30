"""Short, actor-scoped transactions for OpenUI drafts stored in message metadata."""

import json

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.generative_ui import OpenUIContentBlock
from models.account import Account
from models.model import App, EndUser, InstalledApp, Message
from services.entities.message_entities import MessageAccount, MessageActor
from services.errors.message import MessageNotExistsError
from services.generative_ui_state_service import OpenUIBlockNotReadyError
from services.installed_app_access_service import InstalledAppRef


class SQLAlchemyOpenUIStateRepository:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def save_state(
        self,
        *,
        actor: MessageActor,
        app_id: str,
        app_owner_tenant_id: str,
        message_id: str,
        block_id: str,
        form_state: dict[str, JsonValue],
        installed_app: InstalledAppRef | None,
    ) -> OpenUIContentBlock:
        # Lock the message so concurrent drafts for different blocks preserve
        # each other's metadata. A block's last completed write wins.
        statement = (
            select(Message)
            .join(App, App.id == Message.app_id)
            .where(Message.id == message_id, Message.app_id == app_id, App.tenant_id == app_owner_tenant_id)
        )
        if isinstance(actor, MessageAccount):
            statement = statement.join(Account, Account.id == Message.from_account_id).where(
                Message.from_source == "console",
                Message.from_account_id == actor.account_id,
                Message.from_end_user_id.is_(None),
            )
        else:
            statement = statement.join(EndUser, EndUser.id == Message.from_end_user_id).where(
                Message.from_source == "api",
                Message.from_end_user_id == actor.end_user_id,
                Message.from_account_id.is_(None),
                EndUser.app_id == app_id,
                EndUser.tenant_id == app_owner_tenant_id,
            )
        if installed_app is not None:
            statement = statement.join(InstalledApp, InstalledApp.app_id == App.id).where(
                InstalledApp.id == installed_app.id,
                InstalledApp.tenant_id == installed_app.tenant_id,
                InstalledApp.app_id == installed_app.app_id,
                InstalledApp.app_owner_tenant_id == installed_app.app_owner_tenant_id,
                App.tenant_id == installed_app.app_owner_tenant_id,
            )
        with self._session_factory.begin() as session:
            message = session.scalar(statement.with_for_update(of=Message))
            if message is None:
                raise MessageNotExistsError("Message not found for this app and actor")
            metadata = message.message_metadata_dict
            blocks = [OpenUIContentBlock.model_validate(block) for block in metadata.get("content_blocks", [])]
            for index, block in enumerate(blocks):
                if block.id != block_id:
                    continue
                if block.status != "completed":
                    raise OpenUIBlockNotReadyError("Only completed OpenUI blocks accept form state")
                updated = block.model_copy(update={"form_state": form_state})
                blocks[index] = updated
                metadata["content_blocks"] = [item.model_dump(mode="json") for item in blocks]
                message.message_metadata = json.dumps(metadata, ensure_ascii=False)
                return updated
            raise MessageNotExistsError("OpenUI content block not found")
