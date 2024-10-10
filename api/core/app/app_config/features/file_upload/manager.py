from collections.abc import Mapping
from typing import Any

from core.file.models import FileExtraConfig
from models import FileUploadConfig


class FileUploadConfigManager:
    @classmethod
    def convert(cls, config: Mapping[str, Any], is_vision: bool = True):
        """
        Convert model config to model config

        :param config: model config args
        :param is_vision: if True, the feature is vision feature
        """
        file_upload_dict = config.get("file_upload")
        if file_upload_dict:
            if file_upload_dict.get("enabled"):
                data = {
                    "image_config": {
                        "number_limits": file_upload_dict["number_limits"],
                        "transfer_methods": file_upload_dict["allowed_file_upload_methods"],
                    }
                }

                if is_vision:
                    data["image_config"]["detail"] = file_upload_dict.get("image", {}).get("detail", "low")

                return FileExtraConfig.model_validate(data)

    @classmethod
    def validate_and_set_defaults(cls, config: dict, is_vision: bool = True) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for file upload feature

        :param config: app model config args
        :param is_vision: if True, the feature is vision feature
        """
        if not config.get("file_upload"):
            config["file_upload"] = {}
        else:
            FileUploadConfig.model_validate(config["file_upload"])

        return config, ["file_upload"]
