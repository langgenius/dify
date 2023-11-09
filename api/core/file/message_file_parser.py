from typing import List, Union, Optional

from core.model_providers.models.entity.message import PromptMessageFile, ImagePromptMessageFile
from models.account import Account
from models.model import MessageFile, EndUser, AppModelConfig


class MessageFileParser:
    @classmethod
    def parse_arg_files(cls, files: List[dict], app_model_config: AppModelConfig,
                        user: Union[Account, EndUser]) -> List[PromptMessageFile]:
        return cls._parse_files_helper(files, app_model_config, user, cls._parse_arg_file)

    @classmethod
    def parse_message_files(cls, message_files: List[MessageFile], app_model_config: AppModelConfig,
                            user: Union[Account, EndUser]) -> List[PromptMessageFile]:
        return cls._parse_files_helper(message_files, app_model_config, user, cls._parse_message_file)

    @classmethod
    def _parse_files_helper(cls, files: List[Union[dict, MessageFile]], app_model_config: AppModelConfig,
                            user: Union[Account, EndUser], parse_func) -> List[PromptMessageFile]:
        file_upload_config = app_model_config.file_upload_dict

        message_files = []
        for file in files:
            message_file = parse_func(file, file_upload_config, user)
            if message_file:
                message_files.append(message_file)

        return message_files

    @classmethod
    def _parse_arg_file(cls, file: dict, file_upload_config: dict,
                        user: Union[Account, EndUser]) -> Optional[PromptMessageFile]:
        # Currently only support image
        if file.get('type') != 'image':
            return None

        if not file_upload_config.get('image'):
            return None

        image_config = file_upload_config.get('image')

        if not image_config['enabled']:
            return None

        if file.get('transfer_method') not in image_config['transfer_methods']:
            return None

        detail = image_config['detail']

        url = cls._get_preview_url(file, file.get('transfer_method'), user)

        if not url:
            return None

        return ImagePromptMessageFile(
            detail=detail,
            data=url
        )

    @classmethod
    def _parse_message_file(cls, message_file: MessageFile, file_upload_config: dict,
                            user: Union[Account, EndUser]) -> Optional[PromptMessageFile]:
        # Currently only support image
        if message_file.type != 'image':
            return None

        image_config = file_upload_config.get('image')
        detail = image_config['detail']

        file = {
            'type': message_file.type,
            'transfer_method': message_file.transfer_method,
            'url': message_file.url,
            'upload_file_id': message_file.upload_file_id,
        }

        url = cls._get_preview_url(message_file, message_file.transfer_method, user)

        if not url:
            return None

        return ImagePromptMessageFile(
            detail=detail,
            data=url
        )

    @classmethod
    def _get_preview_url(cls, file: dict, transfer_method: str,
                         user: Union[Account, EndUser]) -> Optional[str]:
        if transfer_method == 'remote_url':
            url = file.get('url')
        elif transfer_method == 'local_file':
            # TODO: get signed url from upload file
            url = ''
        else:
            return None
        return url
