import json
from collections.abc import Generator
from typing import Any, Union

from sqlalchemy import and_

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.app_manager import EasyUIBasedAppManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.message_file_parser import MessageFileParser
from extensions.ext_database import db
from models.model import Account, App, AppMode, AppModelConfig, Conversation, EndUser, Message
from services.app_model_config_service import AppModelConfigService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationCompletedError, ConversationNotExistsError
from services.errors.message import MessageNotExistsError


class CompletionService:

    @classmethod
    def completion(cls, app_model: App, user: Union[Account, EndUser], args: Any,
                   invoke_from: InvokeFrom, streaming: bool = True,
                   is_model_config_override: bool = False) -> Union[dict, Generator]:
        # is streaming mode
        inputs = args['inputs']
        query = args['query']
        files = args['files'] if 'files' in args and args['files'] else []
        auto_generate_name = args['auto_generate_name'] \
            if 'auto_generate_name' in args else True

        if app_model.mode != AppMode.COMPLETION.value:
            if not query:
                raise ValueError('query is required')

        if query:
            if not isinstance(query, str):
                raise ValueError('query must be a string')

            query = query.replace('\x00', '')

        conversation_id = args['conversation_id'] if 'conversation_id' in args else None

        conversation = None
        app_model_config_dict = None
        if conversation_id:
            conversation_filter = [
                Conversation.id == args['conversation_id'],
                Conversation.app_id == app_model.id,
                Conversation.status == 'normal'
            ]

            if isinstance(user, Account):
                conversation_filter.append(Conversation.from_account_id == user.id)
            else:
                conversation_filter.append(Conversation.from_end_user_id == user.id if user else None)

            conversation = db.session.query(Conversation).filter(and_(*conversation_filter)).first()

            if not conversation:
                raise ConversationNotExistsError()

            if conversation.status != 'normal':
                raise ConversationCompletedError()

            app_model_config = db.session.query(AppModelConfig).filter(
                AppModelConfig.id == conversation.app_model_config_id,
                AppModelConfig.app_id == app_model.id
            ).first()

            if not app_model_config:
                raise AppModelConfigBrokenError()
        else:
            if app_model.app_model_config_id is None:
                raise AppModelConfigBrokenError()

            app_model_config = app_model.app_model_config

            if not app_model_config:
                raise AppModelConfigBrokenError()

            if is_model_config_override:
                if not isinstance(user, Account):
                    raise Exception("Only account can override model config")

                # validate config
                app_model_config_dict = AppModelConfigService.validate_configuration(
                    tenant_id=app_model.tenant_id,
                    config=args['model_config'],
                    app_mode=AppMode.value_of(app_model.mode)
                )

        # parse files
        message_file_parser = MessageFileParser(tenant_id=app_model.tenant_id, app_id=app_model.id)
        file_upload_entity = FileUploadConfigManager.convert(app_model_config_dict or app_model_config.to_dict())
        if file_upload_entity:
            file_objs = message_file_parser.validate_and_transform_files_arg(
                files,
                file_upload_entity,
                user
            )
        else:
            file_objs = []

        application_manager = EasyUIBasedAppManager()
        return application_manager.generate(
            app_model=app_model,
            app_model_config=app_model_config,
            app_model_config_dict=app_model_config_dict,
            user=user,
            invoke_from=invoke_from,
            inputs=inputs,
            query=query,
            files=file_objs,
            conversation=conversation,
            stream=streaming,
            extras={
                "auto_generate_conversation_name": auto_generate_name
            }
        )

    @classmethod
    def generate_more_like_this(cls, app_model: App, user: Union[Account, EndUser],
                                message_id: str, invoke_from: InvokeFrom, streaming: bool = True) \
            -> Union[dict, Generator]:
        if not user:
            raise ValueError('user cannot be None')

        message = db.session.query(Message).filter(
            Message.id == message_id,
            Message.app_id == app_model.id,
            Message.from_source == ('api' if isinstance(user, EndUser) else 'console'),
            Message.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
            Message.from_account_id == (user.id if isinstance(user, Account) else None),
        ).first()

        if not message:
            raise MessageNotExistsError()

        current_app_model_config = app_model.app_model_config
        more_like_this = current_app_model_config.more_like_this_dict

        if not current_app_model_config.more_like_this or more_like_this.get("enabled", False) is False:
            raise MoreLikeThisDisabledError()

        app_model_config = message.app_model_config
        model_dict = app_model_config.model_dict
        completion_params = model_dict.get('completion_params')
        completion_params['temperature'] = 0.9
        model_dict['completion_params'] = completion_params
        app_model_config.model = json.dumps(model_dict)

        # parse files
        message_file_parser = MessageFileParser(tenant_id=app_model.tenant_id, app_id=app_model.id)
        file_upload_entity = FileUploadConfigManager.convert(current_app_model_config.to_dict())
        if file_upload_entity:
            file_objs = message_file_parser.transform_message_files(
                message.files, file_upload_entity
            )
        else:
            file_objs = []

        application_manager = EasyUIBasedAppManager()
        return application_manager.generate(
            app_model=app_model,
            app_model_config=current_app_model_config,
            app_model_config_dict=app_model_config.to_dict(),
            user=user,
            invoke_from=invoke_from,
            inputs=message.inputs,
            query=message.query,
            files=file_objs,
            conversation=None,
            stream=streaming,
            extras={
                "auto_generate_conversation_name": False
            }
        )

