from collections.abc import Mapping
from typing import Any, Optional

from core.file.file_obj import FileExtraConfig


class FileUploadConfigManager:
    @classmethod
    def convert(cls, config: Mapping[str, Any], is_vision: bool = True) -> Optional[FileExtraConfig]:
        """
        Convert model config to model config

        :param config: model config args
        :param is_vision: if True, the feature is vision feature
        """
        file_upload_dict = config.get('file_upload')
        if file_upload_dict:
            if file_upload_dict.get('image'):
                if 'enabled' in file_upload_dict['image'] and file_upload_dict['image']['enabled']:
                    image_config = {
                        'number_limits': file_upload_dict['image']['number_limits'],
                        'transfer_methods': file_upload_dict['image']['transfer_methods']
                    }

                    if is_vision:
                        image_config['detail'] = file_upload_dict['image']['detail']

                    return FileExtraConfig(
                        image_config=image_config
                    )

        return None

    @classmethod
    def validate_and_set_defaults(cls, config: dict, is_vision: bool = True) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for file upload feature

        :param config: app model config args
        :param is_vision: if True, the feature is vision feature
        """
        if not config.get("file_upload"):
            config["file_upload"] = {}

        if not isinstance(config["file_upload"], dict):
            raise ValueError("file_upload must be of dict type")

        # check image config
        if not config["file_upload"].get("image"):
            config["file_upload"]["image"] = {"enabled": False}

        if config['file_upload']['image']['enabled']:
            number_limits = config['file_upload']['image']['number_limits']
            if number_limits < 1 or number_limits > 6:
                raise ValueError("number_limits must be in [1, 6]")

            if is_vision:
                detail = config['file_upload']['image']['detail']
                if detail not in ['high', 'low']:
                    raise ValueError("detail must be in ['high', 'low']")

            transfer_methods = config['file_upload']['image']['transfer_methods']
            if not isinstance(transfer_methods, list):
                raise ValueError("transfer_methods must be of list type")
            for method in transfer_methods:
                if method not in ['remote_url', 'local_file']:
                    raise ValueError("transfer_methods must be in ['remote_url', 'local_file']")

        return config, ["file_upload"]
