"""Defensive tests for UploadFileContentLoader (Stage 4 §6).

Loader must never raise on pathological inputs and must map all failure
modes to a deterministic ``LoadedFileContent`` / ``None`` shape so the
executor can produce a clean SKIPPED result.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import DataError, SQLAlchemyError

from core.workflow.nodes.agent_v2.output_check_executor import LoadedFileContent
from core.workflow.nodes.agent_v2.upload_file_content_loader import UploadFileContentLoader

VALID_UUID = "550e8400-e29b-41d4-a716-446655440000"


def _make_upload_file(*, tenant_id: str = "tenant-1", extension: str = "pdf"):
    """Tiny stand-in for ``UploadFile`` ORM object."""
    upload = MagicMock()
    upload.tenant_id = tenant_id
    upload.extension = extension
    return upload


# ──────────────────────────────────────────────────────────────────────────────
# Pre-DB short-circuits
# ──────────────────────────────────────────────────────────────────────────────


def test_empty_inputs_short_circuit_without_db_hit():
    loader = UploadFileContentLoader()
    with patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory:
        assert loader.load(file_id="", tenant_id="t-1") is None
        assert loader.load(file_id="abc", tenant_id="") is None
    factory.create_session.assert_not_called()


@pytest.mark.parametrize("bad", ["not-a-uuid", "🤖", "../etc/passwd", VALID_UUID + "-trailing"])
def test_non_uuid_file_ids_short_circuit_without_db_hit(bad: str):
    loader = UploadFileContentLoader()
    with patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory:
        assert loader.load(file_id=bad, tenant_id="t-1") is None
    factory.create_session.assert_not_called()


# ──────────────────────────────────────────────────────────────────────────────
# DB errors / cross-tenant
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("error_cls", [SQLAlchemyError, DataError])
def test_db_errors_return_none(error_cls):
    loader = UploadFileContentLoader()
    with patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory:
        factory.create_session.return_value.__enter__.return_value.scalar.side_effect = (
            error_cls("boom") if error_cls is SQLAlchemyError else error_cls("x", "y", "z")
        )
        assert loader.load(file_id=VALID_UUID, tenant_id="t-1") is None


def test_missing_upload_file_returns_none():
    loader = UploadFileContentLoader()
    with patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory:
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = None
        assert loader.load(file_id=VALID_UUID, tenant_id="t-1") is None


def test_cross_tenant_returns_none():
    loader = UploadFileContentLoader()
    upload = _make_upload_file(tenant_id="other-tenant")
    with patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory:
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = upload
        assert loader.load(file_id=VALID_UUID, tenant_id="t-1") is None


# ──────────────────────────────────────────────────────────────────────────────
# Extension routing
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "extension",
    ["png", "jpg", "mp4", "zip", "exe", ".gif", "WEBP"],  # mix lowercase / dotted / upper
)
def test_unsupported_extensions_short_circuit_before_extraction(extension: str):
    loader = UploadFileContentLoader()
    upload = _make_upload_file(extension=extension)
    with (
        patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory,
        patch(
            "core.workflow.nodes.agent_v2.upload_file_content_loader.ExtractProcessor.load_from_upload_file"
        ) as extract,
    ):
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = upload
        result = loader.load(file_id=VALID_UUID, tenant_id="tenant-1")
    assert result == LoadedFileContent(text="", unsupported=True)
    extract.assert_not_called()


def test_extension_with_leading_dot_is_normalized():
    loader = UploadFileContentLoader()
    upload = _make_upload_file(extension=".png")
    with patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory:
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = upload
        result = loader.load(file_id=VALID_UUID, tenant_id="tenant-1")
    assert result is not None
    assert result.unsupported is True


# ──────────────────────────────────────────────────────────────────────────────
# Extraction success / failure
# ──────────────────────────────────────────────────────────────────────────────


def test_successful_extraction_returns_loaded_content():
    loader = UploadFileContentLoader()
    upload = _make_upload_file(extension="pdf")
    with (
        patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory,
        patch(
            "core.workflow.nodes.agent_v2.upload_file_content_loader.ExtractProcessor.load_from_upload_file"
        ) as extract,
    ):
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = upload
        extract.return_value = "extracted pdf text"
        result = loader.load(file_id=VALID_UUID, tenant_id="tenant-1")
    assert result == LoadedFileContent(text="extracted pdf text")
    extract.assert_called_once_with(upload, return_text=True)


def test_extractor_raising_falls_back_to_unsupported():
    loader = UploadFileContentLoader()
    upload = _make_upload_file(extension="pdf")
    with (
        patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory,
        patch(
            "core.workflow.nodes.agent_v2.upload_file_content_loader.ExtractProcessor.load_from_upload_file"
        ) as extract,
    ):
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = upload
        extract.side_effect = RuntimeError("corrupt file")
        result = loader.load(file_id=VALID_UUID, tenant_id="tenant-1")
    assert result == LoadedFileContent(text="", unsupported=True)


def test_extractor_returning_non_string_is_treated_as_unsupported():
    """``ExtractProcessor.load_from_upload_file`` returns ``list[Document]`` when
    ``return_text=False``; defensive path in case any caller refactors away the
    flag."""
    loader = UploadFileContentLoader()
    upload = _make_upload_file(extension="pdf")
    with (
        patch("core.workflow.nodes.agent_v2.upload_file_content_loader.session_factory") as factory,
        patch(
            "core.workflow.nodes.agent_v2.upload_file_content_loader.ExtractProcessor.load_from_upload_file"
        ) as extract,
    ):
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = upload
        extract.return_value = [object()]  # not a string
        result = loader.load(file_id=VALID_UUID, tenant_id="tenant-1")
    assert result == LoadedFileContent(text="", unsupported=True)
