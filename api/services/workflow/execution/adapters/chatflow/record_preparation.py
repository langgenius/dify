"""Convert chatflow input into persistable conversation and message values."""

from contextlib import suppress
from decimal import Decimal

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.file_reference import resolve_file_record_id
from models.enums import (
    ConversationFromSource,
    ConversationStatus,
    CreatorUserRole,
    MessageFileBelongsTo,
)
from models.enums import InvokeFrom as ModelInvokeFrom
from models.model import AppMode
from services.app.generation.ports import ChatRecordSeed


def prepare_chat_records(entity: AdvancedChatAppGenerateEntity, features: str) -> ChatRecordSeed:
    external = entity.invoke_from in {InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API}
    actor = {
        "from_source": ConversationFromSource.API if external else ConversationFromSource.CONSOLE,
        "from_end_user_id": entity.user_id if external else None,
        "from_account_id": None if external else entity.user_id,
        "invoke_from": ModelInvokeFrom(entity.invoke_from.value),
    }
    features_config = entity.app_config.additional_features
    introduction = (features_config.opening_statement if features_config else None) or ""
    if introduction:
        template = PromptTemplateParser(template=introduction)
        with suppress(KeyError):
            introduction = template.format(
                {key: entity.inputs[key] for key in template.variable_keys if key in entity.inputs}
            )
    query = entity.query or "New conversation"
    return ChatRecordSeed(
        conversation={
            **actor,
            "mode": AppMode(entity.app_config.app_mode.value),
            "name": query[:20] + "…" if len(query) > 20 else query,
            "_inputs": dict(entity.inputs),
            "introduction": introduction,
            "override_model_configs": features,
            "system_instruction": "",
            "system_instruction_tokens": 0,
            "status": ConversationStatus.NORMAL,
        },
        message={
            **actor,
            "_inputs": dict(entity.inputs),
            "query": entity.query,
            "message": "",
            "message_tokens": 0,
            "message_unit_price": Decimal(0),
            "message_price_unit": Decimal(0),
            "answer": "",
            "answer_tokens": 0,
            "answer_unit_price": Decimal(0),
            "answer_price_unit": Decimal(0),
            "parent_message_id": entity.parent_message_id,
            "provider_response_latency": 0,
            "total_price": Decimal(0),
            "currency": "USD",
            "app_mode": AppMode(entity.app_config.app_mode.value),
        },
        files=[
            {
                "type": file.type,
                "transfer_method": file.transfer_method,
                "belongs_to": MessageFileBelongsTo.USER,
                "url": file.remote_url,
                "upload_file_id": resolve_file_record_id(file.reference),
                "created_by_role": CreatorUserRole.END_USER if external else CreatorUserRole.ACCOUNT,
                "created_by": entity.user_id,
            }
            for file in entity.files
        ],
    )
