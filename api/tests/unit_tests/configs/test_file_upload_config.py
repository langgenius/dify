from configs.feature import FileUploadConfig
from tests.unit_tests.configs._isolated_settings import InitSettingsOnly


class _IsolatedFileUploadConfig(InitSettingsOnly, FileUploadConfig):
    pass


def test_paid_plan_file_size_limit_uses_its_default() -> None:
    config = _IsolatedFileUploadConfig(UPLOAD_FILE_SIZE_LIMIT="23")

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 15


def test_paid_plan_file_size_limit_can_be_configured_separately() -> None:
    config = _IsolatedFileUploadConfig(
        UPLOAD_FILE_SIZE_LIMIT="23",
        KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN="50",
    )

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 50
