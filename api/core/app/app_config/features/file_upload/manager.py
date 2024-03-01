from typing import Optional

from core.app.app_config.entities import FileUploadEntity


class FileUploadConfigManager:
    @classmethod
    def convert(cls, config: dict) -> Optional[FileUploadEntity]:
        """
        Convert model config to model config

        :param config: model config args
        """
        file_upload_dict = config.get('file_upload')
        if file_upload_dict:
            if 'image' in file_upload_dict and file_upload_dict['image']:
                if 'enabled' in file_upload_dict['image'] and file_upload_dict['image']['enabled']:
                    return FileUploadEntity(
                        image_config={
                            'number_limits': file_upload_dict['image']['number_limits'],
                            'detail': file_upload_dict['image']['detail'],
                            'transfer_methods': file_upload_dict['image']['transfer_methods']
                        }
                    )

        return None

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for file upload feature

        :param config: app model config args
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
