from collections.abc import Mapping
from typing import Any

from core.file import FileUploadConfig


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
                transform_methods = file_upload_dict.get("allowed_file_upload_methods", [])
                file_upload_dict["image_config"] = {
                    "number_limits": file_upload_dict.get("number_limits", 1),
                    "transfer_methods": transform_methods,
                }

                if is_vision:
                    file_upload_dict["image_config"]["detail"] = file_upload_dict.get("image", {}).get("detail", "high")

                return FileUploadConfig.model_validate(file_upload_dict)

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for file upload feature

        :param config: app model config args
        """
        if not config.get("file_upload"):
            config["file_upload"] = {}
        else:
            FileUploadConfig.model_validate(config["file_upload"])

        return config, ["file_upload"]
