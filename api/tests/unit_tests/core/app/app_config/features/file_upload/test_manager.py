from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.file.models import FileTransferMethod, FileUploadConfig, ImageConfig
from core.model_runtime.entities.message_entities import ImagePromptMessageContent


def test_convert_with_vision():
    config = {
        "file_upload": {
            "enabled": True,
            "number_limits": 5,
            "allowed_file_upload_methods": [FileTransferMethod.REMOTE_URL],
            "image": {"detail": "high"},
        }
    }
    result = FileUploadConfigManager.convert(config, is_vision=True)
    expected = FileUploadConfig(
        image_config=ImageConfig(
            number_limits=5,
            transfer_methods=[FileTransferMethod.REMOTE_URL],
            detail=ImagePromptMessageContent.DETAIL.HIGH,
        )
    )
    assert result == expected


def test_convert_without_vision():
    config = {
        "file_upload": {
            "enabled": True,
            "number_limits": 5,
            "allowed_file_upload_methods": [FileTransferMethod.REMOTE_URL],
        }
    }
    result = FileUploadConfigManager.convert(config, is_vision=False)
    expected = FileUploadConfig(
        image_config=ImageConfig(number_limits=5, transfer_methods=[FileTransferMethod.REMOTE_URL])
    )
    assert result == expected


def test_validate_and_set_defaults():
    config = {}
    result, keys = FileUploadConfigManager.validate_and_set_defaults(config)
    assert "file_upload" in result
    assert keys == ["file_upload"]


def test_validate_and_set_defaults_with_existing_config():
    config = {
        "file_upload": {
            "enabled": True,
            "number_limits": 5,
            "allowed_file_upload_methods": [FileTransferMethod.REMOTE_URL],
        }
    }
    result, keys = FileUploadConfigManager.validate_and_set_defaults(config)
    assert "file_upload" in result
    assert keys == ["file_upload"]
    assert result["file_upload"]["enabled"] is True
    assert result["file_upload"]["number_limits"] == 5
    assert result["file_upload"]["allowed_file_upload_methods"] == [FileTransferMethod.REMOTE_URL]
