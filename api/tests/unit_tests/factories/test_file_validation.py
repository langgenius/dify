"""Unit tests for is_file_valid_with_config."""

from __future__ import annotations

import pytest

from factories.file_factory.validation import is_file_valid_with_config
from graphon.file import FileTransferMethod, FileType, FileUploadConfig


def _validate(
    *,
    input_file_type: str,
    file_extension: str = ".png",
    file_transfer_method: FileTransferMethod = FileTransferMethod.LOCAL_FILE,
    config: FileUploadConfig,
) -> bool:
    return is_file_valid_with_config(
        input_file_type=input_file_type,
        file_extension=file_extension,
        file_transfer_method=file_transfer_method,
        config=config,
    )


@pytest.mark.parametrize(
    ("input_file_type", "file_extension", "allowed_file_types", "allowed_file_extensions", "expected"),
    [
        # round-1 happy path: literal "custom" mapping, ext whitelisted
        ("custom", ".png", [FileType.CUSTOM], [".png"], True),
        # round-2 replay: MessageFile.type is the resolved type, but config still allows CUSTOM
        ("image", ".png", [FileType.CUSTOM], [".png"], True),
        ("document", ".pdf", [FileType.CUSTOM], [".pdf"], True),
        # mixed bucket [IMAGE, CUSTOM]: document falls into CUSTOM bucket via extension
        ("document", ".pdf", [FileType.IMAGE, FileType.CUSTOM], [".pdf"], True),
        ("document", ".exe", [FileType.IMAGE, FileType.CUSTOM], [".pdf"], False),
        ("image", ".jpg", [FileType.IMAGE], [], True),
        ("video", ".mp4", [FileType.IMAGE, FileType.DOCUMENT], [], False),
        ("custom", ".exe", [FileType.CUSTOM], [".png"], False),
        # empty allowed_file_types == no type restriction
        ("video", ".mp4", [], [], True),
    ],
)
def test_bucket_semantics(input_file_type, file_extension, allowed_file_types, allowed_file_extensions, expected):
    config = FileUploadConfig(
        allowed_file_types=allowed_file_types,
        allowed_file_extensions=allowed_file_extensions,
    )
    assert _validate(input_file_type=input_file_type, file_extension=file_extension, config=config) is expected


@pytest.mark.parametrize("whitelist_entry", [".png", ".PNG", "png", "PNG", " .Png ", "PnG"])
def test_extension_match_is_case_and_dot_insensitive(whitelist_entry):
    config = FileUploadConfig(
        allowed_file_types=[FileType.CUSTOM],
        allowed_file_extensions=[whitelist_entry],
    )
    assert _validate(input_file_type="custom", file_extension=".png", config=config) is True


def test_extension_mismatch_still_rejected_after_normalization():
    config = FileUploadConfig(
        allowed_file_types=[FileType.CUSTOM],
        allowed_file_extensions=[".png", ".jpg"],
    )
    assert _validate(input_file_type="custom", file_extension=".pdf", config=config) is False


def test_mixed_case_whitelist_replicating_real_user_config():
    config = FileUploadConfig(
        allowed_file_types=[FileType.CUSTOM],
        allowed_file_extensions=[".PNG", "png", "JPG", ".WEBP", "SVG", "GIF"],
    )
    for ext in (".png", ".jpg", ".webp", ".svg", ".gif"):
        assert _validate(input_file_type="custom", file_extension=ext, config=config) is True


def test_tool_file_always_passes():
    config = FileUploadConfig(allowed_file_types=[FileType.CUSTOM], allowed_file_extensions=[".pdf"])
    assert (
        _validate(
            input_file_type="image",
            file_extension=".png",
            file_transfer_method=FileTransferMethod.TOOL_FILE,
            config=config,
        )
        is True
    )


def test_transfer_method_gate_for_non_image():
    config = FileUploadConfig(
        allowed_file_types=[FileType.DOCUMENT],
        allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE],
    )
    assert (
        _validate(
            input_file_type="document",
            file_extension=".pdf",
            file_transfer_method=FileTransferMethod.LOCAL_FILE,
            config=config,
        )
        is True
    )
    assert (
        _validate(
            input_file_type="document",
            file_extension=".pdf",
            file_transfer_method=FileTransferMethod.REMOTE_URL,
            config=config,
        )
        is False
    )


def test_history_replay_matches_round_1_outcome_under_unchanged_config():
    """A file that passes round 1 must pass history replay when config is unchanged."""
    config = FileUploadConfig(
        allowed_file_types=[FileType.CUSTOM],
        allowed_file_extensions=[".png"],
    )
    assert _validate(input_file_type="custom", file_extension=".png", config=config) is True
    assert _validate(input_file_type="image", file_extension=".png", config=config) is True


def test_empty_whitelist_in_custom_bucket_denies_by_default():
    """Defensive: when a file lands in the CUSTOM bucket, an empty
    allowed_file_extensions list rejects. The UI never submits empty;
    this guards DSL / API paths that bypass the UI from accidentally
    widening what's accepted."""
    config = FileUploadConfig(
        allowed_file_types=[FileType.CUSTOM],
        allowed_file_extensions=[],
    )
    assert _validate(input_file_type="custom", file_extension=".png", config=config) is False
    assert _validate(input_file_type="image", file_extension=".png", config=config) is False


def test_normalize_handles_whitespace_and_empty_consistently():
    """Whitespace-only or empty entries in the whitelist must not match real
    extensions (regression guard for _normalize_extension edge cases)."""
    for noisy_entry in ("", "   ", "\t"):
        config = FileUploadConfig(
            allowed_file_types=[FileType.CUSTOM],
            allowed_file_extensions=[noisy_entry],
        )
        assert _validate(input_file_type="custom", file_extension=".png", config=config) is False


def test_empty_extension_does_not_spuriously_match_empty_whitelist_entry():
    """Defensive: even if the whitelist contains an empty / whitespace entry
    (e.g., a stray comma in DSL), an extensionless file must not pass via
    a both-sides-empty match. Real entries in the same whitelist still match."""
    config = FileUploadConfig(
        allowed_file_types=[FileType.CUSTOM],
        allowed_file_extensions=["", ".png"],
    )
    assert _validate(input_file_type="custom", file_extension=".png", config=config) is True
    assert _validate(input_file_type="custom", file_extension="", config=config) is False
