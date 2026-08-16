import pytest

from configs.feature import FileUploadConfig


def test_paid_plan_file_size_limit_uses_its_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UPLOAD_FILE_SIZE_LIMIT", "23")
    monkeypatch.delenv("KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN", raising=False)

    config = FileUploadConfig()

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 15


def test_paid_plan_file_size_limit_can_be_configured_separately(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UPLOAD_FILE_SIZE_LIMIT", "23")
    monkeypatch.setenv("KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN", "50")

    config = FileUploadConfig()

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 50
